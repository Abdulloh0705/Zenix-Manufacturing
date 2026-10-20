import type {Bom,BomComponent,LotRecord,ManufacturingState,MaterialReservation,ProductionOrder,WorkOrder} from '../types'
import {addDays,daysBetween,minutesBetween,periodStart,stamp,todayISO,weekStart,weekdayShort} from '../utils/dates'
import {SUPPLYING_PO,orderableLinks,preferredSupplierId} from './supplierMaterials'

export type OeeInput={plannedMinutes:number;downtimeMinutes:number;idealCycleMinutes:number;totalCount:number;goodCount:number}
export type OeeResult={availability:number;performance:number;quality:number;oee:number}

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value))
const round=(value:number)=>Math.round(value)
const q3=(value:number)=>Math.round(value*1000)/1000
const CLOSED:ProductionOrder['status'][]=['Yakunlangan','Bekor qilingan']

export const isOpenOrder=(o:ProductionOrder)=>!CLOSED.includes(o.status)

export function availableQuantity(balance:{onHand:number;reserved:number;quarantine?:number}){
  return Math.max(0,balance.onHand-balance.reserved-(balance.quarantine||0))
}

/** Quantity of one component needed per finished unit, including planned waste. */
export function perUnit(component:Pick<BomComponent,'qty'|'waste'>){
  return component.qty*(1+component.waste/100)
}

export function remainingQty(order:Pick<ProductionOrder,'quantity'|'completed'|'scrap'>){
  return Math.max(0,order.quantity-order.completed-order.scrap)
}

export function isProductItem(state:ManufacturingState,itemId:string){
  return state.products.some(p=>p.id===itemId)
}

export function itemName(state:ManufacturingState,itemId:string){
  return state.products.find(p=>p.id===itemId)?.name||state.rawMaterials.find(m=>m.id===itemId)?.name||itemId
}

export function itemUnit(state:ManufacturingState,itemId:string){
  return state.products.find(p=>p.id===itemId)?.unit||state.rawMaterials.find(m=>m.id===itemId)?.unit||'birlik'
}

/** Aggregated stock of an item across warehouses. */
export function stockOf(state:ManufacturingState,itemId:string,warehouseId?:string){
  const rows=state.stockBalances.filter(b=>b.itemId===itemId&&(!warehouseId||b.warehouseId===warehouseId))
  const onHand=rows.reduce((a,b)=>a+b.onHand,0),reserved=rows.reduce((a,b)=>a+b.reserved,0),incoming=rows.reduce((a,b)=>a+b.incoming,0),quarantine=rows.reduce((a,b)=>a+(b.quarantine||0),0)
  return {onHand,reserved,incoming,quarantine,available:Math.max(0,onHand-reserved-quarantine)}
}

export function orderRequirements(order:Pick<ProductionOrder,'bomSnapshot'>,units:number){
  return order.bomSnapshot.components.map(component=>({component,required:perUnit(component)*Math.max(0,units)}))
}

/** 0–100 readiness of components for the remaining quantity of an order. */
export function materialReadiness(state:ManufacturingState,order:ProductionOrder){
  if(order.materialReserved||!order.bomSnapshot.components.length)return 100
  if(remainingQty(order)<=0)return 100
  const ratios=orderMaterialPlan(state,order).filter(l=>l.required>0).map(l=>Math.min(100,l.covered/l.required*100))
  return round(Math.min(100,...ratios))
}

/**
 * Raw-material warehouse of a branch: the warehouse an order of that branch reserves and issues raw materials from.
 * Stable when warehouses are added (BUG-04): the branch's default warehouse if it is an active raw store, otherwise
 * the branch's oldest active raw store (new records are prepended, so the oldest is the last one).
 */
export function rawWarehouseFor(state:ManufacturingState,warehouseId:string){
  const branch=state.warehouses.find(w=>w.id===warehouseId)?.branchId
  const candidates=state.warehouses.filter(w=>w.branchId===branch&&w.status==='Faol'&&(w.type==='Raw'||w.type==='Mixed'))
  const preferred=candidates.find(w=>w.id===state.settings?.defaultWarehouseId)
  return preferred?.id||candidates.at(-1)?.id
    ||state.warehouses.filter(w=>w.type==='Raw').at(-1)?.id||state.warehouses[0]?.id||''
}

/** Where an order takes a component from: sub-assemblies from its own warehouse, raw materials from the branch raw store. */
export function componentSourceWarehouse(state:ManufacturingState,order:Pick<ProductionOrder,'warehouseId'>,itemId:string){
  return isProductItem(state,itemId)?order.warehouseId:rawWarehouseFor(state,order.warehouseId)
}

/** BOM quantity of one component (incl. planned waste) for the whole order — the most that may ever be issued to it. */
/** What the order may issue of an item: its BOM plan plus any approved extra issue (N-20). */
export function plannedIssue(order:Pick<ProductionOrder,'bomSnapshot'|'quantity'>&{extraIssues?:ProductionOrder['extraIssues']},itemId:string){
  const extra=(order.extraIssues||[]).filter(x=>x.materialId===itemId).reduce((a,x)=>a+x.qty,0)
  return q3(orderRequirements(order,order.quantity).filter(r=>r.component.materialId===itemId).reduce((a,r)=>a+r.required,0)+extra)
}

export function issuedQty(order:Pick<ProductionOrder,'consumed'>,itemId:string){
  return q3(order.consumed.filter(c=>c.materialId===itemId).reduce((a,c)=>a+c.qty,0))
}

/**
 * Stock an order still holds in reserve, per component and warehouse. Orders saved before reservations were
 * stored per order derive it: planned issue minus what was already issued, from the current source warehouse.
 */
export function orderReservations(state:ManufacturingState,order:ProductionOrder):MaterialReservation[]{
  if(!order.materialReserved)return []
  if(order.reservations)return order.reservations
  const ids=[...new Set(order.bomSnapshot.components.map(c=>c.materialId))]
  return ids.map(materialId=>({materialId,warehouseId:componentSourceWarehouse(state,order,materialId),qty:q3(Math.max(0,plannedIssue(order,materialId)-issuedQty(order,materialId)))})).filter(r=>r.qty>0)
}

/** A rework order opened by a customer-return disposition (its units came back from the customer, not from its source order). */
export function isReturnRework(state:ManufacturingState,order:Pick<ProductionOrder,'id'|'reworkOf'>){
  return Boolean(order.reworkOf)&&state.returns.some(r=>r.reworkOrderId===order.id)
}

/** Output an order received into Final QC quarantine, read from its production movements (all output if the log no longer has them). */
function quarantinedOutput(state:ManufacturingState,order:ProductionOrder){
  const moves=state.stockMovements.filter(m=>m.type==='Production +'&&m.source===order.code&&m.itemId===order.productId)
  return moves.length?moves.filter(m=>m.note.includes('QC quarantine')).reduce((a,m)=>a+m.qty,0):order.completed
}

/**
 * Finished units an order still holds in Final QC quarantine, in its own warehouse — what its Final pass may release.
 * Orders saved before holds were stored per order derive it: nothing once a Final check passed; a customer-return
 * rework holds the returned units; a production rework holds what it reworked; any other order holds its quarantined
 * output minus what its production reworks took over.
 */
export function orderQcHold(state:ManufacturingState,order:ProductionOrder):number{
  if(order.qcHeld!==undefined)return Math.max(0,order.qcHeld)
  if(state.qualityChecks.some(q=>q.type==='Final'&&q.sourceType==='production'&&q.sourceId===order.id&&q.status==='Passed'))return 0
  const ret=order.reworkOf?state.returns.find(r=>r.reworkOrderId===order.id):undefined
  if(ret)return ret.qty
  if(order.reworkOf){
    const source=state.productionOrders.find(o=>o.id===order.reworkOf)
    return source?Math.min(order.completed,quarantinedOutput(state,source)):order.completed
  }
  // While this order has no stored hold no rework took units over through it (that stores it), so all rework output counts.
  const reworked=state.productionOrders.filter(r=>r.reworkOf===order.id&&!isReturnRework(state,r)).reduce((a,r)=>a+r.completed,0)
  return Math.max(0,quarantinedOutput(state,order)-reworked)
}

export function calculateOEE(input:OeeInput&{runMinutes?:number}):OeeResult{
  // Run time is planned time minus stops, unless measured: then unexplained idle time also lowers availability.
  const runMinutes=Math.max(0,input.runMinutes??input.plannedMinutes-input.downtimeMinutes)
  const availability=clamp(input.plannedMinutes>0?runMinutes/input.plannedMinutes:0)
  const performance=clamp(runMinutes>0?(input.idealCycleMinutes*input.totalCount)/runMinutes:0)
  const quality=clamp(input.totalCount>0?input.goodCount/input.totalCount:0)
  return {
    availability:round(availability*100),
    performance:round(performance*100),
    quality:round(quality*100),
    oee:round(availability*performance*quality*100),
  }
}

/* ---------------------------------------------------------------- MPS -- */

function activeProductionQty(state:ManufacturingState,productId:string,until?:string,from?:string){
  return state.productionOrders
    .filter(o=>o.productId===productId&&isOpenOrder(o)&&!o.reworkOf&&(!until||o.due<=until)&&(!from||o.due>=from))
    .reduce((sum,o)=>sum+remainingQty(o),0)
}

function openSalesLines(state:ManufacturingState,productId:string){
  return state.salesOrders
    .filter(o=>o.status!=='Bekor'&&o.status!=='Yetkazildi')
    .flatMap(o=>o.items.filter(i=>i.productId===productId).map(i=>({order:o,open:Math.max(0,i.qty-i.delivered),reserved:i.reserved||0})))
}

function openSalesDemand(state:ManufacturingState,productId:string){
  return openSalesLines(state,productId).reduce((sum,l)=>sum+l.open,0)
}

/**
 * Projected availability of an item: available (on hand − reserved) + incoming − demand that is not
 * reserved yet (component needs of open, unreserved MOs for materials; open sales lines for products).
 */
export function projectedStock(state:ManufacturingState,itemId:string){
  const stock=stockOf(state,itemId)
  const productionNeed=state.productionOrders.filter(o=>isOpenOrder(o)&&!o.materialReserved&&!o.reworkOf)
    .reduce((sum,o)=>sum+orderRequirements(o,remainingQty(o)).filter(r=>r.component.materialId===itemId).reduce((a,r)=>a+r.required,0),0)
  const salesNeed=openSalesLines(state,itemId).reduce((sum,l)=>sum+Math.max(0,l.open-l.reserved),0)
  const demand=productionNeed+salesNeed
  return {...stock,demand,projected:stock.available+stock.incoming-demand}
}

export type MpsWeek={week:string;forecast:number;sales:number;demand:number;scheduled:number;projected:number;suggested:number}

/**
 * Time-phased Master Production Schedule. Demand per week = max(forecast, confirmed sales).
 * Stock already reserved for sales is excluded from "available" so it is not counted twice.
 */
export function createMpsRows(state:ManufacturingState,horizonWeeks=4){
  const firstWeek=weekStart(todayISO())
  const weeks=Array.from({length:horizonWeeks},(_,i)=>addDays(firstWeek,i*7))
  return state.products.filter(p=>p.status!=='Arxiv'&&p.procurement!=='buy').map(product=>{
    const balance=stockOf(state,product.id)
    const salesLines=openSalesLines(state,product.id)
    const sales=salesLines.reduce((a,l)=>a+l.open,0)
    const reservedForSales=salesLines.reduce((a,l)=>a+l.reserved,0)
    const available=Math.max(0,balance.available)
    const lotSize=1
    let projected=available
    const buckets:MpsWeek[]=weeks.map((week,index)=>{
      const end=addDays(week,6)
      const forecast=state.forecasts.filter(f=>f.productId===product.id&&f.period===week).reduce((a,f)=>a+f.qty,0)
      const weekSales=salesLines.filter(l=>index===0?l.order.deliveryDate<=end:l.order.deliveryDate>=week&&l.order.deliveryDate<=end).reduce((a,l)=>a+Math.max(0,l.open-l.reserved),0)
      const demand=Math.max(forecast,weekSales)
      const scheduled=index===0?activeProductionQty(state,product.id,end):activeProductionQty(state,product.id,end,week)
      projected=projected+scheduled-demand
      let suggested=0
      if(projected<0){suggested=Math.ceil(-projected/lotSize)*lotSize;projected+=suggested}
      return {week,forecast,sales:weekSales,demand,scheduled,projected,suggested}
    })
    const forecast=buckets.reduce((a,b)=>a+b.forecast,0)
    const scheduled=activeProductionQty(state,product.id)
    const demand=buckets.reduce((a,b)=>a+b.demand,0)
    const required=Math.max(0,demand-available-scheduled)
    const suggested=buckets.reduce((a,b)=>a+b.suggested,0)
    return {product,forecast,sales,reservedForSales,available,scheduled,demand,required,suggested,weeks:buckets}
  })
}

/* ---------------------------------------------------------------- MRP -- */

export function explodeBomRequirements(state:ManufacturingState,bomId:string,quantity:number){
  const totals=new Map<string,{materialId:string;required:number;unit:string}>()
  const walk=(currentBomId:string,currentQty:number,stack:Set<string>)=>{
    if(stack.has(currentBomId))return
    const bom=state.boms.find(b=>b.id===currentBomId)
    if(!bom)return
    const nextStack=new Set(stack).add(currentBomId)
    for(const component of bom.components){
      const required=currentQty*perUnit(component)
      if(component.subBomId){
        walk(component.subBomId,required,nextStack)
        continue
      }
      const previous=totals.get(component.materialId)
      totals.set(component.materialId,{materialId:component.materialId,required:(previous?.required??0)+required,unit:component.unit})
    }
  }
  walk(bomId,Math.max(0,quantity),new Set())
  return [...totals.values()]
}

export function activeBomFor(state:ManufacturingState,productId:string):Bom|undefined{
  const product=state.products.find(p=>p.id===productId)
  return state.boms.find(b=>b.id===product?.defaultBomId&&b.status==='Faol')??state.boms.find(b=>b.productId===productId&&b.status==='Faol')
}

/** Low-level code: 0 for top-level items, parent level + 1 for sub-assemblies. */
function lowLevelCodes(state:ManufacturingState){
  const levels=new Map<string,number>(state.products.map(p=>[p.id,0]))
  for(let pass=0;pass<8;pass++){
    let changed=false
    for(const bom of state.boms.filter(b=>b.status==='Faol')){
      const parent=levels.get(bom.productId)??0
      for(const c of bom.components.filter(c=>c.subBomId||levels.has(c.materialId))){
        if((levels.get(c.materialId)??0)<parent+1){levels.set(c.materialId,parent+1);changed=true}
      }
    }
    if(!changed)break
  }
  return levels
}

export type MrpMaterialLine={component:BomComponent;material:ManufacturingState['rawMaterials'][number]|undefined;required:number;available:number;incoming:number;shortage:number}
export type PlannedOrder={productId:string;qty:number;level:number;reason:string}
export type PurchaseSuggestion={materialId:string;required:number;available:number;incoming:number;safety:number;shortage:number;suggested:number;supplierId?:string;supplierCount:number;needBy:string}

/**
 * Multi-level MRP: nets each level against its own stock before exploding the next level,
 * so a sub-assembly on hand is consumed before raw materials are requested (make-or-buy).
 */
export function createMrpPlan(state:ManufacturingState){
  const mps=createMpsRows(state)
  const levels=lowLevelCodes(state)
  const gross=new Map<string,number>()
  const planned:PlannedOrder[]=[]
  const rawNeed=new Map<string,number>()
  const mpsByProduct=new Map(mps.map(row=>[row.product.id,row]))
  // When each item is first needed (N-14): a draft order's start, or the first MPS week that is short,
  // moved earlier by the parent's production time for its components.
  const today=todayISO()
  const needDate=new Map<string,string>()
  const needOn=(id:string,date:string)=>{const d=date<today?today:date;const cur=needDate.get(id);if(!cur||d<cur)needDate.set(id,d)}
  const productionDays=(bom:NonNullable<ReturnType<typeof activeBomFor>>,qty:number)=>Math.max(1,Math.ceil(bom.operations.reduce((a,op)=>a+(op.setupMin||0)+(op.runMin||0)*qty,0)/Math.max(60,state.settings.policies.shiftMinutes||480)))

  // Draft orders are demand that has not reserved anything yet.
  for(const o of state.productionOrders.filter(o=>['Qoralama','Material kutilmoqda'].includes(o.status)&&!o.materialReserved)){
    for(const {component,required} of orderRequirements(o,remainingQty(o))){
      if(isProductItem(state,component.materialId))gross.set(`dep:${component.materialId}`,(gross.get(`dep:${component.materialId}`)??0)+required)
      else rawNeed.set(component.materialId,(rawNeed.get(component.materialId)??0)+required)
      needOn(component.materialId,o.start||today)
    }
  }

  const ordered=[...state.products].filter(p=>p.status!=='Arxiv').sort((a,b)=>(levels.get(a.id)??0)-(levels.get(b.id)??0))
  for(const product of ordered){
    const level=levels.get(product.id)??0
    const row=mpsByProduct.get(product.id)
    const dependent=gross.get(`dep:${product.id}`)??0
    let qty=row?.suggested??0
    if(dependent>0){
      // Independent (MPS) and dependent (parent BOM) demand share one stock pool: net them together once.
      const net=Math.max(0,(row?.demand??0)+dependent-stockOf(state,product.id).available-activeProductionQty(state,product.id))
      qty=net>0?Math.ceil(net):0
    }
    if(qty<=0)continue
    const bom=activeBomFor(state,product.id)
    if(product.procurement==='buy'||!bom){planned.push({productId:product.id,qty,level,reason:'Buy — BOM yo‘q'});continue}
    planned.push({productId:product.id,qty,level,reason:level===0?'MPS talabi':'Sub-assembly talabi'})
    const due=[needDate.get(product.id),row?.weeks.find(w=>w.suggested>0)?.week].filter((d):d is string=>Boolean(d)).sort()[0]||today
    const componentsBy=addDays(due,-productionDays(bom,qty))
    for(const component of bom.components){
      needOn(component.materialId,componentsBy)
      const need=qty*perUnit(component)
      if(component.subBomId||isProductItem(state,component.materialId))gross.set(`dep:${component.materialId}`,(gross.get(`dep:${component.materialId}`)??0)+need)
      else rawNeed.set(component.materialId,(rawNeed.get(component.materialId)??0)+need)
    }
  }

  const purchases:PurchaseSuggestion[]=state.rawMaterials.filter(m=>m.status!=='Arxiv').map(material=>{
    const stock=stockOf(state,material.id)
    const required=rawNeed.get(material.id)??0
    const safety=material.minStock
    const shortage=Math.max(0,required+safety-stock.available-stock.incoming)
    const suggested=shortage>0?Math.ceil(shortage):0
    // Preferred or only orderable supplier link; with several and no preference people choose (supplierOptions).
    const supplierId=preferredSupplierId(state,material.id)
    return {materialId:material.id,required,available:stock.available,incoming:stock.incoming,safety,shortage,suggested,supplierId,supplierCount:orderableLinks(state,material.id).length,needBy:needDate.get(material.id)??addDays(today,material.leadTime)}
  })
  return {mps,planned,purchases}
}

/** Per-product MRP view kept for pages/tests: planned quantity and the materials it explodes into. */
export function createMrpRows(state:ManufacturingState){
  const plan=createMrpPlan(state)
  return plan.mps.map(row=>{
    const bom=activeBomFor(state,row.product.id)
    const plannedQty=plan.planned.filter(p=>p.productId===row.product.id).reduce((a,p)=>a+p.qty,0)
    const productionQty=Math.max(plannedQty,row.suggested)
    const materials:MrpMaterialLine[]=(bom?.components||[]).map(component=>{
      const material=state.rawMaterials.find(m=>m.id===component.materialId)
      const stock=stockOf(state,component.materialId)
      const required=productionQty*perUnit(component)
      const globalShortage=plan.purchases.find(p=>p.materialId===component.materialId)?.shortage??Math.max(0,required-stock.available-stock.incoming)
      return {component,material,required,available:stock.available,incoming:stock.incoming,shortage:required>0?Math.min(required,globalShortage):0}
    })
    return {...row,bom,plannedQty,materials,shortage:materials.reduce((sum,m)=>sum+m.shortage,0)}
  })
}

/* ---------------------------------------------------- Material health -- */

export type MaterialStockState='Shortage'|'Kritik'|'Reorder'|'Normal'
export const MATERIAL_STOCK_STATES:MaterialStockState[]=['Shortage','Kritik','Reorder','Normal']

/** Stock state of one raw material: projected < 0 → Shortage, then available vs min stock / reorder point. */
export function materialStockState(material:Pick<ManufacturingState['rawMaterials'][number],'minStock'|'reorderPoint'>,available:number,projected:number):MaterialStockState{
  return projected<0?'Shortage':available<material.minStock?'Kritik':available<material.reorderPoint?'Reorder':'Normal'
}

/** One row per raw material: on hand, reserved, available, incoming, unreserved demand, projection and state. */
export function materialStockRows(state:ManufacturingState){
  return state.rawMaterials.map(m=>{const p=projectedStock(state,m.id);return {id:m.id,m,p,state:materialStockState(m,p.available,p.projected)}})
}

/**
 * Materials to act on: an MRP shortage (need + safety > available + incoming) or available below the
 * reorder point. The Shortages page and the dashboard count exactly these rows.
 */
export function materialShortages(state:ManufacturingState,plan=createMrpPlan(state)){
  return plan.purchases.flatMap(p=>{
    const m=state.rawMaterials.find(x=>x.id===p.materialId)
    if(!m||!(p.shortage>0||p.available<m.reorderPoint))return []
    return [{...p,id:p.materialId,m,critical:p.shortage>0||p.available<m.minStock}]
  })
}

/* ----------------------------------------------------------- Capacity -- */

export function workOrderRemainingMinutes(order:ProductionOrder,wo:WorkOrder){
  if(wo.status==='Yakunlangan')return 0
  const op=order.bomSnapshot.operations.find(o=>o.id===wo.operationId)
  if(!op)return Math.max(0,wo.plannedMin-wo.actualMin)
  const setup=wo.actualMin>0?0:op.setupMin
  return setup+op.runMin*remainingQty(order)
}

/**
 * Rough-cut capacity check for the MPS horizon: routing minutes needed for each week's scheduled +
 * suggested quantity (run time per unit, setup once per product-week) against the week's available
 * work-center minutes (shift × efficiency × working days).
 */
export function mpsCapacityByWeek(state:ManufacturingState,rows:ReturnType<typeof createMpsRows>,shiftMinutes=state.settings?.policies?.shiftMinutes||480,workDays=5){
  const capacity=state.workCenters.reduce((a,w)=>a+round(shiftMinutes*w.efficiency/100),0)*workDays
  const weeks=rows[0]?.weeks.map(w=>w.week)??[]
  return weeks.map((week,i)=>{
    const load=rows.reduce((a,r)=>{
      const ops=activeBomFor(state,r.product.id)?.operations??[]
      const qty=(r.weeks[i]?.scheduled??0)+(r.weeks[i]?.suggested??0)
      return qty>0?a+qty*ops.reduce((x,op)=>x+op.runMin,0)+ops.reduce((x,op)=>x+op.setupMin,0):a
    },0)
    return {week,load:round(load),capacity,utilization:capacity>0?round(load/capacity*100):0}
  })
}

export type CapacityDay={date:string;load:number;capacity:number;utilization:number}

/** Finite capacity over a horizon: open work-order minutes spread over each order's start→due window. */
export function calculateCapacityLoads(state:ManufacturingState,horizonDays=5,shiftMinutes=state.settings?.policies?.shiftMinutes||480){
  const today=todayISO()
  const days=Array.from({length:horizonDays},(_,i)=>addDays(today,i))
  return state.workCenters.map(workCenter=>{
    const machines=state.equipment.filter(e=>e.workCenterId===workCenter.id)
    const down=machines.length>0&&machines.every(e=>e.status==='To‘xtagan')
    const dailyCapacity=round(shiftMinutes*workCenter.efficiency/100)
    const load=new Map(days.map(d=>[d,0]))
    const orders=state.productionOrders.filter(o=>isOpenOrder(o)&&o.workOrders.some(w=>w.workCenterId===workCenter.id&&w.status!=='Yakunlangan'))
    let loadMinutes=0
    for(const order of orders){
      const minutes=order.workOrders.filter(w=>w.workCenterId===workCenter.id).reduce((a,w)=>a+workOrderRemainingMinutes(order,w),0)
      loadMinutes+=minutes
      const from=order.start<today?today:order.start
      const to=order.due<from?from:order.due
      const span=Math.max(1,daysBetween(from,to)+1)
      for(let i=0;i<span;i++){
        const day=addDays(from,i)
        if(load.has(day))load.set(day,(load.get(day)??0)+minutes/span)
      }
    }
    const perDay:CapacityDay[]=days.map((date,i)=>{
      const capacity=down&&i===0?0:dailyCapacity
      const l=load.get(date)??0
      return {date,load:round(l),capacity,utilization:capacity>0?round(l/capacity*100):l>0?999:0}
    })
    const capacityMinutes=Math.max(1,perDay.reduce((a,d)=>a+d.capacity,0))
    const horizonLoad=perDay.reduce((a,d)=>a+d.load,0)
    const utilization=round(Math.min(999,horizonLoad/capacityMinutes*100))
    return {workCenter,orders,loadMinutes:round(loadMinutes),capacityMinutes,utilization,overloaded:perDay.some(d=>d.utilization>100),days:perDay,down}
  })
}

/* ---------------------------------------------------------------- OEE -- */

/**
 * OEE of one work center over the last `windowDays` days (BUG-16). Planned time is one shift (policies.shiftMinutes)
 * for each day the work center ran or stood still, so idle time with no recorded stop lowers availability as well;
 * a stop that is still open counts until `now`. Performance weighs each order's ideal cycle by the units it made.
 */
export function workCenterOee(state:ManufacturingState,workCenterId:string,windowDays=7,now=new Date()){
  const since=periodStart(windowDays)
  const orders=state.productionOrders.filter(o=>o.workOrders.some(w=>w.workCenterId===workCenterId&&w.actualMin>0)&&(o.startedAt||o.createdAt).slice(0,10)>=since)
  const runMinutes=orders.reduce((a,o)=>a+o.workOrders.filter(w=>w.workCenterId===workCenterId).reduce((x,w)=>x+w.actualMin,0),0)
  const stops=state.downtimeEvents.filter(d=>d.workCenterId===workCenterId&&d.start.slice(0,10)>=since)
  const openFor=(start:string)=>Math.max(0,Math.round((now.getTime()-new Date(start).getTime())/60000))
  const downtimeMinutes=stops.reduce((a,d)=>a+(d.end?d.minutes:Math.max(d.minutes,openFor(d.start))),0)
  const days=new Set([
    ...state.timeLogs.filter(l=>l.workCenterId===workCenterId&&l.start.slice(0,10)>=since).map(l=>l.start.slice(0,10)),
    ...orders.map(o=>(o.startedAt||o.createdAt).slice(0,10)),
    ...stops.map(d=>d.start.slice(0,10)),
  ])
  const shift=Math.max(60,state.settings.policies.shiftMinutes||480)
  const plannedMinutes=runMinutes+downtimeMinutes>0?Math.max(days.size*shift,runMinutes+downtimeMinutes):0
  const idleMinutes=Math.max(0,plannedMinutes-runMinutes-downtimeMinutes)
  const totalCount=orders.reduce((a,o)=>a+o.completed+o.scrap,0)
  const goodCount=orders.reduce((a,o)=>a+o.completed,0)
  const idealMinutes=orders.reduce((a,o)=>a+(o.bomSnapshot.operations.find(op=>op.workCenterId===workCenterId)?.runMin??0)*(o.completed+o.scrap),0)
  const idealCycleMinutes=totalCount?idealMinutes/totalCount:0
  return {...calculateOEE({plannedMinutes,downtimeMinutes,idealCycleMinutes,totalCount,goodCount,runMinutes}),runMinutes,downtimeMinutes,idleMinutes,plannedMinutes,totalCount,goodCount}
}

export function productionOee(state:ManufacturingState,windowDays=7){
  const rows=state.workCenters.map(w=>workCenterOee(state,w.id,windowDays)).filter(r=>r.plannedMinutes>0)
  const weight=rows.reduce((a,r)=>a+r.plannedMinutes,0)
  if(!weight)return {availability:0,performance:0,quality:0,oee:0}
  const avg=(key:keyof OeeResult)=>round(rows.reduce((a,r)=>a+r[key]*r.plannedMinutes,0)/weight)
  return {availability:avg('availability'),performance:avg('performance'),quality:avg('quality'),oee:avg('oee')}
}

/** Downtime events that started in the last N days (`windowDays` 0 = all history). */
export function downtimeInPeriod(state:ManufacturingState,windowDays=30){
  const since=windowDays>0?periodStart(windowDays):''
  return state.downtimeEvents.filter(d=>d.start.slice(0,10)>=since)
}

export function downtimeByReason(state:ManufacturingState,windowDays=30){
  const totals=new Map<string,number>()
  for(const d of downtimeInPeriod(state,windowDays))totals.set(d.reason,(totals.get(d.reason)??0)+d.minutes)
  const sum=[...totals.values()].reduce((a,b)=>a+b,0)
  return [...totals.entries()].map(([reason,minutes])=>({reason,minutes,share:sum?round(minutes/sum*100):0})).sort((a,b)=>b.minutes-a.minutes)
}

/** Logged downtime minutes in the period, the top reason, and the stops that are still open. */
export function downtimeSummary(state:ManufacturingState,windowDays=7){
  const events=downtimeInPeriod(state,windowDays)
  const reasons=downtimeByReason(state,windowDays)
  return {events:events.length,minutes:reasons.reduce((a,r)=>a+r.minutes,0),top:reasons[0],reasons,open:state.downtimeEvents.filter(d=>!d.end)}
}

/* ------------------------------------------------------------ Costing -- */

export type CostBreakdown={material:number;labor:number;machine:number;overhead:number;total:number}

function componentCost(state:ManufacturingState,itemId:string){
  return state.rawMaterials.find(m=>m.id===itemId)?.standardCost??state.products.find(p=>p.id===itemId)?.standardCost??0
}

/**
 * Planned hourly wage of an operation: the production staff of its work center, else all production staff,
 * else everyone (N-15 — management and support wages no longer inflate planned labor).
 */
function plannedWage(state:ManufacturingState,workCenterId:string){
  const active=state.employees.filter(e=>e.status!=='Arxiv')
  const production=active.filter(e=>e.department==='Production')
  const pool=[production.filter(e=>e.workCenterId===workCenterId),production,active].find(list=>list.length)
  return pool?pool.reduce((a,e)=>a+e.hourlyCost,0)/pool.length:40000
}

export function estimateOrderCost(state:ManufacturingState,order:Pick<ProductionOrder,'bomSnapshot'|'quantity'>):CostBreakdown{
  const policies=state.settings?.policies
  const material=order.bomSnapshot.components.reduce((a,c)=>a+perUnit(c)*order.quantity*componentCost(state,c.materialId),0)
  let labor=0,machine=0
  for(const op of order.bomSnapshot.operations){
    const minutes=op.setupMin+op.runMin*order.quantity
    labor+=minutes/60*plannedWage(state,op.workCenterId)*Math.max(1,op.employeeCount)
    machine+=minutes/60*(state.workCenters.find(w=>w.id===op.workCenterId)?.costPerHour??policies?.machineRatePerHour??0)
  }
  const overhead=(material+labor+machine)*(policies?.overheadRate??0)/100
  return {material,labor,machine,overhead,total:material+labor+machine+overhead}
}

/** Standard cost roll-up: children first (by BOM level) so sub-assembly costs flow into parents. */
export function rollUpStandardCosts(state:ManufacturingState,referenceQty=100):ManufacturingState{
  const levels=lowLevelCodes(state)
  let next=state
  const ordered=[...state.products].sort((a,b)=>(levels.get(b.id)??0)-(levels.get(a.id)??0))
  for(const product of ordered){
    const bom=activeBomFor(next,product.id)
    if(!bom)continue
    const unit=Math.round(estimateOrderCost(next,{bomSnapshot:bom,quantity:referenceQty}).total/referenceQty)
    next={...next,products:next.products.map(p=>p.id===product.id?{...p,standardCost:unit}:p)}
  }
  return next
}

/** Actual cost from what really happened: consumed materials, logged labor and machine minutes. */
export function actualOrderCost(state:ManufacturingState,order:ProductionOrder):CostBreakdown{
  const policies=state.settings?.policies
  const material=order.consumed.reduce((a,c)=>a+c.qty*componentCost(state,c.materialId),0)
  const labor=state.timeLogs.filter(t=>t.orderId===order.id).reduce((a,t)=>a+t.minutes/60*(state.employees.find(e=>e.id===t.employeeId)?.hourlyCost??0),0)
  const machine=order.workOrders.reduce((a,w)=>a+w.actualMin/60*(state.workCenters.find(c=>c.id===w.workCenterId)?.costPerHour??policies?.machineRatePerHour??0),0)
  const overhead=(material+labor+machine)*(policies?.overheadRate??0)/100
  return {material,labor,machine,overhead,total:material+labor+machine+overhead}
}

export function orderCosting(state:ManufacturingState,order:ProductionOrder){
  // A completed order reports the cost frozen at completion; price changes afterwards do not rewrite it (BUG-08).
  const frozen=order.status==='Yakunlangan'?order.costSnapshot:undefined
  const planned=frozen?.planned??estimateOrderCost(state,order)
  const actual=frozen?.actual??actualOrderCost(state,order)
  const produced=order.completed+order.scrap
  // Planned cost scaled to what has actually been produced so far gives a fair variance mid-run.
  const progressShare=order.quantity?Math.min(1,produced/order.quantity):0
  const earned=planned.total*(order.status==='Yakunlangan'?1:progressShare)
  const variance=actual.total-earned
  const unitCost=order.completed>0?actual.total/order.completed:planned.total/Math.max(1,order.quantity)
  // Share of actual cost absorbed by scrapped units (already inside actual.total — shown, not added).
  const waste=produced>0?actual.total*order.scrap/produced:0
  return {planned,actual,earned,variance,variancePct:earned?round(variance/earned*100):0,unitCost,waste}
}

/* ------------------------------------------------------- Traceability -- */

export function lotRemaining(lot:LotRecord){
  return Math.max(0,lot.qty)
}

export function buildTraceability(state:ManufacturingState,orderId:string){
  const order=state.productionOrders.find(o=>o.id===orderId)
  if(!order)return {order:undefined,upstreamLots:[] as LotRecord[],qualityChecks:[] as ManufacturingState['qualityChecks'],movements:[] as ManufacturingState['stockMovements'],downstreamSales:[] as ManufacturingState['salesOrders'],outputLots:[] as LotRecord[],purchases:[] as ManufacturingState['purchaseOrders']}
  const consumedLots=new Set(order.consumed.map(c=>c.lot).filter(Boolean) as string[])
  const upstreamLots=state.lots.filter(l=>consumedLots.has(l.code)||l.consumedBy.includes(order.code))
  const outputLots=state.lots.filter(l=>l.sourceType==='production'&&l.sourceId===order.id)
  const outputCodes=new Set(outputLots.map(l=>l.code))
  const qualityChecks=state.qualityChecks.filter(q=>q.sourceType==='production'&&q.sourceId===order.id)
  const movements=state.stockMovements.filter(m=>m.source===order.code||m.source===order.id)
  const salesCodes=new Set(state.stockMovements.filter(m=>m.type==='Sale -'&&m.lot&&outputCodes.has(m.lot)).map(m=>m.source))
  const downstreamSales=state.salesOrders.filter(s=>s.productionOrderId===order.id||salesCodes.has(s.code))
  const purchaseIds=new Set(upstreamLots.filter(l=>l.sourceType==='purchase').map(l=>l.sourceId))
  const purchases=state.purchaseOrders.filter(p=>purchaseIds.has(p.id))
  return {order,upstreamLots,qualityChecks,movements,downstreamSales,outputLots,purchases}
}

/** Resolve a free-text trace query (MO code, lot, serial number, SKU) to a production order. */
export function findTraceOrder(state:ManufacturingState,query:string){
  const q=query.trim().toLowerCase()
  if(!q)return undefined
  const byCode=state.productionOrders.find(o=>o.code.toLowerCase()===q||o.lot?.toLowerCase()===q)
  if(byCode)return byCode
  const lot=state.lots.find(l=>l.code.toLowerCase()===q||serialInRange(l,q))
  if(lot?.sourceType==='production')return state.productionOrders.find(o=>o.id===lot.sourceId)
  if(lot)return state.productionOrders.find(o=>o.consumed.some(c=>c.lot===lot.code))
  const product=state.products.find(p=>p.sku.toLowerCase()===q||p.name.toLowerCase().includes(q))
  if(product)return [...state.productionOrders].filter(o=>o.productId===product.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
  return state.productionOrders.find(o=>o.code.toLowerCase().includes(q))
}

export function serialInRange(lot:LotRecord,query:string){
  if(lot.kind!=='serial'||!lot.serialFrom||!lot.serialTo)return false
  const q=query.toUpperCase()
  const prefix=lot.serialFrom.replace(/\d+$/,'')
  if(!q.startsWith(prefix))return false
  const n=Number(q.slice(prefix.length)),from=Number(lot.serialFrom.slice(prefix.length)),to=Number(lot.serialTo.slice(prefix.length))
  return Number.isFinite(n)&&n>=from&&n<=to
}

/* ------------------------------------------------------------ Signals -- */

/** Failed or scrapped inspection (Quality → Brak). */
export const isDefect=(q:Pick<ManufacturingState['qualityChecks'][number],'status'>)=>q.status==='Failed'||q.status==='Scrap'
/** Inspection still waiting for a rework decision (Quality → Rework queue). */
export const awaitsRework=(q:Pick<ManufacturingState['qualityChecks'][number],'status'|'sourceType'>)=>q.status==='Rework'||(q.status==='Failed'&&q.sourceType==='production')

export function isOverdue(order:ProductionOrder,today=todayISO()){
  return isOpenOrder(order)&&order.due<today
}

/** Open, not yet overdue order whose remaining work no longer fits the shift time left before its due date. */
export function scheduleRisk(state:ManufacturingState,order:ProductionOrder,today=todayISO()){
  if(!isOpenOrder(order)||order.due<today)return false
  const daysLeft=daysBetween(today,order.due)
  const remainingMinutes=order.workOrders.reduce((a,w)=>a+workOrderRemainingMinutes(order,w),0)
  const shift=state.settings?.policies?.shiftMinutes||480
  return remainingMinutes>(daysLeft+1)*shift
}

export function deliveryRisk(state:ManufacturingState,order:ProductionOrder,today=todayISO()){
  if(!isOpenOrder(order))return false
  return order.due<today||scheduleRisk(state,order,today)||order.status==='Material kutilmoqda'
}

/* ------------------------------------------------- Production control -- */

/* ---------------------------------------------------- Material pegging -- */

export type IncomingSupply={purchaseId:string;code:string;supplierId:string;warehouseId:string;qty:number;expectedDate:string;forOrders:string[]}

/** Open quantity (ordered − received) of confirmed POs for a material, earliest expected first. Drafts are not supply. */
export function incomingSupply(state:ManufacturingState,materialId:string,warehouseId?:string):IncomingSupply[]{
  return state.purchaseOrders.filter(p=>SUPPLYING_PO.includes(p.status)&&(!warehouseId||p.warehouseId===warehouseId))
    .flatMap(p=>p.items.filter(i=>i.materialId===materialId&&i.qty-i.received>1e-9).map(i=>({purchaseId:p.id,code:p.code,supplierId:p.supplierId,warehouseId:p.warehouseId,qty:q3(i.qty-i.received),expectedDate:p.expectedDate,forOrders:p.productionOrderIds||[]})))
    .sort((a,b)=>a.expectedDate.localeCompare(b.expectedDate)||a.code.localeCompare(b.code))
}

export type MaterialPlanLine={
  component:BomComponent;materialId:string;unit:string;stockUnit:string;unitMismatch:boolean;purchasable:boolean;warehouseId:string;
  /** Gross requirement for the remaining quantity (component unit). */
  required:number;reserved:boolean;
  /** Taken from available stock of the source warehouse (the order's own reservation when reserved). */
  covered:number;
  /** Covered by open PO quantity pegged to this order. */
  incoming:number;
  /** Not covered by stock now (required − covered). */
  shortage:number;
  /** Covered neither by stock nor by incoming POs — what still has to be bought or made. */
  toBuy:number;
  supply:{purchaseId:string;code:string;qty:number;expectedDate:string}[];arrives?:string;lateForDue:boolean;afterStart:boolean;overduePo:boolean;
  /** Available in other warehouses (needs a transfer, not counted as coverage). */
  elsewhere:number;
}

const pegCache=new WeakMap<ManufacturingState,{today:string;plan:Map<string,MaterialPlanLine[]>}>()

/**
 * Pegs every open order's remaining component need to supply, most urgent first (due, priority, age):
 * reserved orders hold their own reservation; others take available stock of their source warehouse
 * (on hand − all reservations − quarantine, so a reservation is subtracted once), then open PO quantity
 * by expected date — a PO raised for specific orders goes to those orders first, and only what they do
 * not need is offered to others afterwards. Each unit of stock or incoming is given to one order only.
 */
export function materialPegging(state:ManufacturingState,today=todayISO()){
  const hit=pegCache.get(state)
  if(hit&&hit.today===today)return hit.plan
  const plan=new Map<string,MaterialPlanLine[]>()
  const pools=new Map<string,{available:number;supply:IncomingSupply[]}>()
  const pool=(materialId:string,warehouseId:string,raw:boolean)=>{
    const key=`${materialId}|${warehouseId}`
    let p=pools.get(key)
    if(!p){
      const b=state.stockBalances.find(x=>x.itemId===materialId&&x.warehouseId===warehouseId)
      p={available:b?Math.max(0,b.onHand-b.reserved-(b.quarantine||0)):0,supply:raw?incomingSupply(state,materialId,warehouseId).map(x=>({...x})):[]}
      pools.set(key,p)
    }
    return p
  }
  type Open={line:MaterialPlanLine;order:ProductionOrder;rest:number;pool:{available:number;supply:IncomingSupply[]}}
  const pending:Open[]=[]
  const take=(o:Open,eligible:(s:IncomingSupply)=>boolean)=>{
    for(const s of o.pool.supply){
      if(o.rest<=1e-9)break
      if(s.qty<=1e-9||!eligible(s))continue
      const qty=Math.min(o.rest,s.qty)
      s.qty-=qty;o.rest-=qty;o.line.incoming+=qty
      o.line.supply.push({purchaseId:s.purchaseId,code:s.code,qty:q3(qty),expectedDate:s.expectedDate})
    }
  }
  const orders=state.productionOrders.filter(o=>isOpenOrder(o)&&!o.reworkOf)
    .sort((a,b)=>a.due.localeCompare(b.due)||PRIORITY_RANK[b.priority]-PRIORITY_RANK[a.priority]||a.createdAt.localeCompare(b.createdAt))
  for(const order of orders){
    plan.set(order.id,orderRequirements(order,remainingQty(order)).map(({component,required}):MaterialPlanLine=>{
      const materialId=component.materialId,raw=!isProductItem(state,materialId)
      const warehouseId=componentSourceWarehouse(state,order,materialId)
      const stockUnit=itemUnit(state,materialId),unitMismatch=Boolean(component.unit)&&component.unit!==stockUnit
      const elsewhere=q3(state.stockBalances.filter(b=>b.itemId===materialId&&b.warehouseId!==warehouseId).reduce((a,b)=>a+Math.max(0,b.onHand-b.reserved-(b.quarantine||0)),0))
      const base={component,materialId,unit:component.unit,stockUnit,unitMismatch,purchasable:raw&&!unitMismatch,warehouseId,required:q3(required),reserved:order.materialReserved,supply:[],lateForDue:false,afterStart:false,overduePo:false,elsewhere}
      if(order.materialReserved)return {...base,covered:q3(required),incoming:0,shortage:0,toBuy:0}
      // Quantities in different units are never added: a mismatched BOM line stays uncovered until it is fixed.
      if(unitMismatch)return {...base,covered:0,incoming:0,shortage:q3(required),toBuy:q3(required)}
      const p=pool(materialId,warehouseId,raw)
      const covered=Math.min(required,p.available)
      p.available-=covered
      const line:MaterialPlanLine={...base,covered:q3(covered),incoming:0,shortage:q3(required-covered),toBuy:0}
      const open={line,order,rest:required-covered,pool:p}
      // Pass 1: POs raised for this order, then POs raised for no order in particular.
      take(open,s=>s.forOrders.includes(order.id))
      take(open,s=>!s.forOrders.length)
      pending.push(open)
      return line
    }))
  }
  // Pass 2: what dedicated POs leave over (e.g. MOQ excess) goes to the remaining need, most urgent first.
  for(const o of pending)if(o.rest>1e-9)take(o,()=>true)
  for(const {line,order,rest} of pending){
    line.incoming=q3(line.incoming)
    line.toBuy=q3(Math.max(0,rest))
    line.supply.sort((a,b)=>a.expectedDate.localeCompare(b.expectedDate))
    line.arrives=line.supply.length?line.supply[line.supply.length-1].expectedDate:undefined
    line.lateForDue=Boolean(line.arrives&&line.arrives>order.due)
    line.afterStart=Boolean(line.arrives&&line.arrives>order.start)
    line.overduePo=line.supply.some(x=>x.expectedDate<today)
  }
  pegCache.set(state,{today,plan})
  return plan
}

/** Material plan of one order (closed orders have no open need). */
export function orderMaterialPlan(state:ManufacturingState,order:ProductionOrder,today=todayISO()):MaterialPlanLine[]{
  const pegged=materialPegging(state,today).get(order.id)
  if(pegged)return pegged
  return orderRequirements(order,remainingQty(order)).map(({component,required})=>({component,materialId:component.materialId,unit:component.unit,stockUnit:itemUnit(state,component.materialId),unitMismatch:false,purchasable:false,warehouseId:componentSourceWarehouse(state,order,component.materialId),required,reserved:order.materialReserved,covered:required,incoming:0,shortage:0,toBuy:0,supply:[],lateForDue:false,afterStart:false,overduePo:false,elsewhere:0}))
}

/** Coverage of each component for the remaining quantity of an order (Xomashyo → Material talabi rows). */
export function orderMaterialLines(state:ManufacturingState,order:ProductionOrder){
  return orderMaterialPlan(state,order)
}

export type OrderMaterialStatus='Rezervda'|'Available'|'Shortage'
/** Reserved, coverable from available stock, or short — the "Holat" of the order's requirement rows. */
export function orderMaterialStatus(state:ManufacturingState,order:ProductionOrder):OrderMaterialStatus{
  if(order.materialReserved)return 'Rezervda'
  return orderMaterialLines(state,order).some(l=>l.shortage>0)?'Shortage':'Available'
}

export type OrderUrgency='overdue'|'risk'|'material'|'priority'|'soon'|'normal'
export const ORDER_URGENCY:OrderUrgency[]=['overdue','risk','material','priority','soon','normal']
const PRIORITY_RANK:Record<ProductionOrder['priority'],number>={Past:0,Normal:1,Yuqori:2,Kritik:3}

/** Why an open order comes first: overdue → schedule risk → waiting for material → high priority → due within 3 days. */
export function orderUrgency(state:ManufacturingState,order:ProductionOrder,today=todayISO()):OrderUrgency{
  if(order.due<today)return 'overdue'
  if(scheduleRisk(state,order,today))return 'risk'
  if(order.status==='Material kutilmoqda')return 'material'
  if(PRIORITY_RANK[order.priority]>=2)return 'priority'
  return order.due<=addDays(today,3)?'soon':'normal'
}

/** Open orders, most urgent first; ties by due date, then priority. */
export function prioritizedOrders(state:ManufacturingState,today=todayISO()){
  return state.productionOrders.filter(isOpenOrder).map(order=>({order,urgency:orderUrgency(state,order,today)}))
    .sort((a,b)=>ORDER_URGENCY.indexOf(a.urgency)-ORDER_URGENCY.indexOf(b.urgency)||a.order.due.localeCompare(b.order.due)||PRIORITY_RANK[b.order.priority]-PRIORITY_RANK[a.order.priority])
}

export type OrderBlocker='quality'|'machine'
/**
 * Open order that cannot move on: a Failed / Rework / Scrap quality result holds its completion, or the
 * machine of its next operation is stopped. Waiting for material is a status of its own, not a blocker here.
 */
export function orderBlocker(state:ManufacturingState,order:ProductionOrder):OrderBlocker|undefined{
  if(!isOpenOrder(order))return undefined
  if(['Failed','Rework','Scrap'].includes(order.qualityStatus))return 'quality'
  if(!['Tasdiqlangan','Jarayonda','Pauzada'].includes(order.status))return undefined
  const next=order.workOrders.find(w=>w.status!=='Yakunlangan')
  return next&&state.equipment.some(e=>e.workCenterId===next.workCenterId&&e.status==='To‘xtagan')?'machine':undefined
}

/** Work-center queues: open operations of released orders, running first, then by due date (Operatsiyalar page). */
export function operationQueues(state:ManufacturingState){
  const active=state.productionOrders.filter(o=>['Tasdiqlangan','Jarayonda','Pauzada'].includes(o.status))
  return state.workCenters.map(workCenter=>({
    workCenter,down:state.equipment.some(e=>e.workCenterId===workCenter.id&&e.status==='To‘xtagan'),
    queue:active.flatMap(order=>order.workOrders.filter(w=>w.workCenterId===workCenter.id&&w.status!=='Yakunlangan').map(workOrder=>({order,workOrder})))
      .sort((a,b)=>(a.workOrder.status==='Jarayonda'?-1:0)-(b.workOrder.status==='Jarayonda'?-1:0)||a.order.due.localeCompare(b.order.due)),
  }))
}

/** Load above capacity across the horizon, in minutes. */
export const capacityShortage=(days:CapacityDay[])=>days.reduce((a,d)=>a+Math.max(0,d.load-d.capacity),0)

/**
 * Work centers that limit the plan — stopped, over capacity on some day, or above 85% over the horizon
 * (the "high" band of Planning → Capacity) — worst first. The first one is the bottleneck.
 */
export function capacityConstraints(loads:ReturnType<typeof calculateCapacityLoads>){
  return loads.map(l=>({...l,shortage:capacityShortage(l.days)})).filter(l=>l.down||l.overloaded||l.utilization>85)
    .sort((a,b)=>b.shortage-a.shortage||b.utilization-a.utilization)
}

export type ScrapEvent={id:string;orderId:string;date:string;qty:number;reason:string}
/** Dated scrap postings: every reportOutput / recordScrap with scrap opens an NCR titled "<MO> — scrap <qty> <unit>". */
export function scrapEvents(state:ManufacturingState,windowDays=0):ScrapEvent[]{
  const since=windowDays>0?periodStart(windowDays):''
  return state.qualityAlerts.flatMap(a=>{
    const qty=Number(a.title.match(/scrap (\d+)/)?.[1]||0)
    return qty>0&&a.createdAt.slice(0,10)>=since?[{id:a.id,orderId:a.sourceId,date:a.createdAt,qty,reason:a.reason.split(':')[0]}]:[]
  })
}

/** Rework orders created in the last N days (`windowDays` 0 = all history). */
export function reworkOrders(state:ManufacturingState,windowDays=0){
  const since=windowDays>0?periodStart(windowDays):''
  return state.productionOrders.filter(o=>o.reworkOf&&o.createdAt.slice(0,10)>=since)
}

export type EquipmentActivity='running'|'idle'|'down'
/**
 * What each machine is doing now: stopped, running (its work center has an operation in progress) or idle.
 * Operations are tracked per work center, so every machine of a busy center counts as running.
 */
export function equipmentActivity(state:ManufacturingState){
  const running=state.productionOrders.filter(o=>o.status==='Jarayonda').flatMap(order=>order.workOrders.filter(w=>w.status==='Jarayonda').map(workOrder=>({order,workOrder})))
  return state.equipment.map(equipment=>{
    const job=running.find(r=>r.workOrder.workCenterId===equipment.workCenterId)
    const activity:EquipmentActivity=equipment.status==='To‘xtagan'?'down':job?'running':'idle'
    return {equipment,activity,job:activity==='running'?job:undefined,stop:state.downtimeEvents.find(d=>d.equipmentId===equipment.id&&!d.end)}
  })
}

/**
 * This week's production plan per manufactured product: what is still scheduled to finish this week
 * (MPS first week "Rejada (MO)") plus what has already been received into stock since Monday.
 */
export function weeklyProductionPlan(state:ManufacturingState,rows=createMpsRows(state)){
  const week=weekStart(todayISO())
  const products=rows.map(r=>{
    const produced=round(state.stockMovements.filter(m=>m.type==='Production +'&&m.itemId===r.product.id&&m.date.slice(0,10)>=week&&!m.note.includes('By-product')).reduce((a,m)=>a+m.qty,0))
    const remaining=r.weeks[0]?.scheduled??0
    return {product:r.product,planned:produced+remaining,produced,remaining,suggested:r.weeks[0]?.suggested??0,completion:produced+remaining?round(produced/(produced+remaining)*100):null}
  })
  const sum=(key:'planned'|'produced'|'remaining'|'suggested')=>products.reduce((a,p)=>a+p[key],0)
  const planned=sum('planned'),produced=sum('produced')
  return {week,products,planned,produced,remaining:sum('remaining'),suggested:sum('suggested'),completion:planned?round(produced/planned*100):null}
}

/** Who is on the clock right now: open time logs, their operators, and the operations in progress. */
export function laborNow(state:ManufacturingState){
  const logs=state.timeLogs.filter(t=>!t.end)
  return {logs,operators:[...new Set(logs.map(t=>t.employeeId))],
    operations:state.productionOrders.flatMap(order=>order.workOrders.filter(w=>w.status==='Jarayonda').map(workOrder=>({order,workOrder})))}
}

/** Minutes logged on work orders in the last N days; a running log counts up to `now` (Xodimlar → Ish vaqti). */
export function loggedMinutes(state:ManufacturingState,windowDays=7,now=new Date()){
  const since=periodStart(windowDays),until=stamp(now)
  return state.timeLogs.filter(t=>t.start.slice(0,10)>=since).reduce((a,t)=>a+(t.end?t.minutes:minutesBetween(t.start,until)),0)
}

export function outputByDay(state:ManufacturingState,days=7){
  const today=todayISO()
  return Array.from({length:days},(_,i)=>{
    const date=addDays(today,i-days+1)
    const produced=state.stockMovements.filter(m=>m.type==='Production +'&&m.date.slice(0,10)===date&&!m.note.includes('By-product')).reduce((a,m)=>a+m.qty,0)
    const planned=state.productionOrders.filter(o=>o.status!=='Bekor qilingan'&&o.start<=date&&o.due>=date).reduce((a,o)=>a+o.quantity/Math.max(1,daysBetween(o.start,o.due)+1),0)
    return {date,label:weekdayShort(date),produced:round(produced),planned:round(planned)}
  })
}
