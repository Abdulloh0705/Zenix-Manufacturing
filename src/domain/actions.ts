// Pure manufacturing business actions. Each action takes the current state and returns the next
// state plus a synchronous result — no React, no side effects — so UI feedback is always accurate
// and every workflow can be unit-tested and replayed to build consistent seed data.
import type {
  ActionResult,Attachment,Bom,BomOperation,CostSnapshot,CustomerReturn,DowntimeReason,EcoChange,EngineeringChange,Employee,LotRecord,ManufacturingState,MaterialConsumption,MaterialReservation,PermissionAction,
  PermissionMap,ProductVariant,ProductionOrder,ProductionStatus,PurchaseLine,PurchaseOrder,QualityCheck,QualityControlPoint,Role,SalesOrder,StockMovement,Supplier,SupplierMaterial,WorkOrder,WorkOrderEvent,
} from '../types'
import {
  activeBomFor,actualOrderCost,componentSourceWarehouses,energyRateOf,estimateOrderCost,finalWorkOrder,isOpenOrder,isOpenWorkOrder,isReturnRework,issueUnitCost,issuedQty,lotOrigin,machineRateOf,operationInput,orderQcHold,returnSources,unbuildSource,orderReservations,plannedIssue,rawWarehouseFor,rollUpStandardCosts,isProductItem,itemName,itemUnit,orderMaterialPlan,orderRequirements,perUnit,remainingQty,stockOf,
} from './manufacturingEngine'
import {findBomCycle,orderSpan,runMrp,scheduleConflicts,scheduleOperations} from './planning'
import {maintenanceClashes,maintenanceDue,nextDueDate,planOf} from './maintenance'
import {cleanLink,findLink,linkBlock,linkUnitCost,openPurchasesFor,orderProposal,receiptQuantities,rejectedOpen,validateLink} from './supplierMaterials'
import type {LinkInput} from './supplierMaterials'
import {CURRENCIES} from '../utils/format'
import {employeeRemovalBlocker,employeeWriteBlocker,hasPermission,operatorScopeBlocker,roleManageBlocker,roleOf,rolePermissionBlocker} from './access'
import {addDays,compactCode,isoDate,minutesBetween,parseDate,stamp} from '../utils/dates'

export type Ctx={now:Date;user:Employee;id:(prefix:string)=>string}
export type Outcome={state:ManufacturingState;result:ActionResult}
type S=ManufacturingState

export type EntityKey='products'|'rawMaterials'|'suppliers'|'customers'|'employees'|'expenses'|'qualityAlerts'|'maintenanceOrders'|'engineeringChanges'|'qualityControlPoints'|'maintenanceRequests'|'subcontractOrders'|'repairOrders'|'warehouses'|'workCenters'|'productionLines'|'equipment'|'branches'

const ok=(state:S,message:string,id?:string):Outcome=>({state,result:{ok:true,message,id}})
const fail=(state:S,message:string):Outcome=>({state,result:{ok:false,message}})
const q3=(n:number)=>Math.round(n*1000)/1000
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v))

/* ------------------------------------------------------------- audit -- */

/**
 * The stock ledger and time logs are never truncated (BUG-07): balances must always equal their movements.
 * The activity feed is not cut here either: the app keeps the newest ACTIVITY_LIMIT entries in the working data
 * and moves older ones to a separate archive (splitActivityOverflow), so the audit trail is not silently lost.
 * Browser storage (~5 MB) still bounds both; a durable audit trail needs a backend.
 */
export const ACTIVITY_LIMIT=3000

export function logActivity(s:S,ctx:Ctx,action:string,module:string,source?:string,severity:'info'|'warning'|'danger'|'success'='info',detail=''):S{
  return {...s,activity:[{id:ctx.id('act'),date:stamp(ctx.now),user:ctx.user?.name||'System',userId:ctx.user?.id||undefined,action,module,source,severity,detail},...s.activity]}
}

/** Entries beyond the newest `limit` (the oldest ones), to be archived by the caller before they leave the data. */
export function splitActivityOverflow(s:S,limit=ACTIVITY_LIMIT):{state:S;overflow:S['activity']}{
  if(s.activity.length<=limit)return {state:s,overflow:[]}
  return {state:{...s,activity:s.activity.slice(0,limit)},overflow:s.activity.slice(limit)}
}

const NOTIFY_TOGGLE:Record<string,keyof S['settings']['notifications']|undefined>={'low-stock':'lowStock',quality:'quality',maintenance:'maintenance',delay:'delay',ai:'ai'}

export function notify(s:S,ctx:Ctx,type:string,title:string,text:string,severity:'info'|'warning'|'danger'|'success'='info',path?:string):S{
  const toggle=NOTIFY_TOGGLE[type]
  if(toggle&&s.settings.notifications[toggle]===false)return s
  return {...s,notifications:[{id:ctx.id('n'),type,title,text,severity,read:false,date:stamp(ctx.now),path},...s.notifications].slice(0,150)}
}

function nextCode(existing:string[],prefix:string,now:Date,width=3){
  const base=`${prefix}-${compactCode(now)}-`
  let n=existing.filter(c=>c.startsWith(base)).length+1
  let code=base+String(n).padStart(width,'0')
  while(existing.includes(code)){n+=1;code=base+String(n).padStart(width,'0')}
  return code
}

/** Next free document reference `PREFIX-yymmdd-NNN` among the stock ledger's sources — never a repeat (BUG-07). */
function nextRef(s:S,prefix:string,now:Date){
  return nextCode([...new Set(s.stockMovements.map(m=>m.source))],prefix,now)
}

/* ------------------------------------------------------------- stock -- */

export {rawWarehouseFor}

export function finishedWarehouseFor(s:S,lineId?:string){
  const branch=s.productionLines.find(l=>l.id===lineId)?.branchId
  const finished=(w:S['warehouses'][number])=>w.status==='Faol'&&(w.type==='Finished'||w.type==='Mixed')
  // Never an archived store or one that cannot hold finished goods: no such store means no target (P1-10).
  return s.warehouses.find(w=>w.branchId===branch&&finished(w))?.id||s.warehouses.find(finished)?.id||''
}


/** A stock change that would drive a balance below zero. Actions check stock first; this is the engine's last line of defence. */
export class StockError extends Error{
  constructor(message:string){super(message);this.name='StockError'}
}

const BALANCE_FIELDS=['onHand','reserved','incoming','quarantine'] as const
const FIELD_LABEL:Record<typeof BALANCE_FIELDS[number],string>={onHand:'qoldiq',reserved:'rezerv',incoming:'yo‘ldagi',quarantine:'karantin'}

/** Applies a balance delta. A result below zero is refused (never clamped), so balances always match the movements written beside them. */
function changeBalance(s:S,ctx:Ctx,warehouseId:string,itemId:string,delta:{onHand?:number;reserved?:number;incoming?:number;quarantine?:number},lot?:string):S{
  const index=s.stockBalances.findIndex(b=>b.warehouseId===warehouseId&&b.itemId===itemId)
  const balances=[...s.stockBalances]
  const b=index<0?undefined:balances[index]
  const values={} as Record<typeof BALANCE_FIELDS[number],number>
  for(const field of BALANCE_FIELDS){
    const current=b?(b[field]||0):0
    const value=q3(current+(delta[field]||0))
    if(value<-1e-6){
      const warehouse=s.warehouses.find(w=>w.id===warehouseId)?.name||warehouseId
      throw new StockError(`${itemName(s,itemId)} · ${warehouse}: ${FIELD_LABEL[field]} manfiy bo‘lib qoladi (${q3(current)} ${(delta[field]||0)<0?'−':'+'} ${q3(Math.abs(delta[field]||0))} ${itemUnit(s,itemId)}) — amal bajarilmadi`)
    }
    // Only a rounding remainder can sit between −1e-6 and 0.
    values[field]=Math.max(0,value)
  }
  if(!b)balances.push({id:ctx.id('st'),warehouseId,itemId,itemType:isProductItem(s,itemId)?'finished':'raw',...values,unit:itemUnit(s,itemId),lot})
  else balances[index]={...b,...values,lot:lot||b.lot}
  return {...s,stockBalances:balances}
}

/**
 * How much of a commitment (reservation / incoming) can be released: never more than the balance still carries.
 * Releasing a promise cannot create or remove physical stock, so older inconsistent data must not block a cancel or receipt.
 */
function releasable(s:S,warehouseId:string,itemId:string,field:'reserved'|'incoming',qty:number){
  const b=s.stockBalances.find(x=>x.warehouseId===warehouseId&&x.itemId===itemId)
  return q3(Math.min(Math.max(0,qty),b?.[field]||0))
}

function addMove(s:S,ctx:Ctx,move:Omit<StockMovement,'id'|'date'|'user'>):S{
  return {...s,stockMovements:[{id:ctx.id('mv'),date:stamp(ctx.now),user:ctx.user?.name||'System',...move,qty:q3(move.qty)},...s.stockMovements]}
}

function lotCode(s:S,sku:string,now:Date){
  const base=`LOT-${sku}-${compactCode(now)}-`
  let n=s.lots.filter(l=>l.code.startsWith(base)).length+1
  while(s.lots.some(l=>l.code===base+n))n+=1
  return base+n
}

/** A lot past its expiry date (B3-05). */
export const isExpired=(l:Pick<LotRecord,'expiry'>,today:string)=>Boolean(l.expiry&&l.expiry<today)

/** Usable stock of an item in a warehouse that sits in expired lots — it must not be issued or shipped (B3-05). */
function expiredQty(s:S,itemId:string,warehouseId:string,today:string){
  return q3(s.lots.filter(l=>l.itemId===itemId&&l.warehouseId===warehouseId&&l.qty>0&&isExpired(l,today)&&!['quarantine','hold','rework'].includes(l.status||'available')).reduce((a,l)=>a+l.qty,0))
}

/** FEFO lot allocation. Returns allocations; stock without lot records is allocated as "untracked". `today` skips expired lots. */
function takeLots(s:S,itemId:string,qty:number,consumer:string,warehouseId?:string,lotCodeOnly?:string,today?:string):{state:S;allocations:{lot?:string;qty:number}[];remaining:number}{
  let remaining=qty
  const allocations:{lot?:string;qty:number}[]=[]
  const lots=s.lots.map(l=>({...l}))
  const eligible=lots.filter(l=>l.itemId===itemId&&l.qty>0&&(!warehouseId||l.warehouseId===warehouseId)&&(!lotCodeOnly||l.code===lotCodeOnly)&&!['quarantine','hold','rework'].includes(l.status||'available')&&!(today&&isExpired(l,today))).sort((a,b)=>(a.expiry||'9999-12-31').localeCompare(b.expiry||'9999-12-31')||a.createdAt.localeCompare(b.createdAt))
  for(const lot of eligible){
    if(remaining<=1e-9)break
    const take=Math.min(remaining,lot.qty)
    lot.qty=q3(lot.qty-take)
    if(!lot.consumedBy.includes(consumer))lot.consumedBy=[...lot.consumedBy,consumer]
    allocations.push({lot:lot.code,qty:take})
    remaining=q3(remaining-take)
  }
  if(remaining>1e-9&&!lotCodeOnly)allocations.push({qty:remaining})
  return {state:{...s,lots},allocations,remaining}
}

/** Net need per component: what the BOM plan still allows to issue (plan − already issued), so material issued ahead of output is not reserved twice. */
function netNeeds(s:S,order:ProductionOrder):{materialId:string;qty:number}[]{
  const ids=[...new Set(order.bomSnapshot.components.map(c=>c.materialId))]
  return ids.map(materialId=>({materialId,qty:q3(Math.max(0,plannedIssue(order,materialId)-issuedQty(order,materialId)))})).filter(r=>r.qty>0)
}

/** Free stock of an item in one store: on hand − every reservation − quarantine (stock waiting for QC is not usable yet). */
function freeIn(s:S,warehouseId:string,itemId:string){
  const b=s.stockBalances.find(x=>x.warehouseId===warehouseId&&x.itemId===itemId)
  return b?Math.max(0,b.onHand-b.reserved-(b.quarantine||0)):0
}

/**
 * Stores an order may take a component from (componentSourceWarehouses: preferred store, then the branch's other
 * stores of that kind). A role bound to one warehouse works only with that one.
 */
function sourcesFor(s:S,ctx:Ctx,order:ProductionOrder,itemId:string){
  const all=componentSourceWarehouses(s,order,itemId)
  const home=roleOf(s,ctx.user?.id)?.scope==='warehouse'?ctx.user?.warehouseId:undefined
  return home?all.filter(w=>w===home):all
}

function missingFor(s:S,ctx:Ctx,order:ProductionOrder){
  return netNeeds(s,order).map(need=>{
    const available=sourcesFor(s,ctx,order,need.materialId).reduce((a,w)=>a+freeIn(s,w,need.materialId),0)
    return {itemId:need.materialId,missing:Math.max(0,need.qty-available)}
  }).filter(x=>x.missing>1e-6)
}

/** Reserves every component's net need — preferred store first, the rest from the branch's other stores — all or nothing. */
function reserveFor(s:S,ctx:Ctx,order:ProductionOrder):{state:S;reservations:MaterialReservation[]}|null{
  if(missingFor(s,ctx,order).length)return null
  let next=s
  const reservations:MaterialReservation[]=[]
  for(const need of netNeeds(s,order)){
    let left=need.qty
    for(const w of sourcesFor(s,ctx,order,need.materialId)){
      if(left<=1e-9)break
      const take=q3(Math.min(left,freeIn(next,w,need.materialId)))
      if(take<=0)continue
      next=changeBalance(next,ctx,w,need.materialId,{reserved:take})
      reservations.push({materialId:need.materialId,warehouseId:w,qty:take})
      left=q3(left-take)
    }
  }
  return {state:next,reservations}
}

type Draw={warehouseId:string;qty:number;own:number}

/**
 * Where `qty` of a component comes from: the order's own reservation rows first (store by store), then free stock
 * of its source stores (on hand − every reservation − quarantine); expired lots are never usable (B3-05).
 * Another order's reservation is never touched; if the stores cannot give everything, nothing is drawn.
 */
function planDraws(s:S,ctx:Ctx,order:ProductionOrder,materialId:string,qty:number,opts:{own:boolean;only?:string}):{draws:Draw[]}|{error:string}{
  const today=isoDate(ctx.now)
  const held=opts.own?orderReservations(s,order).filter(r=>r.materialId===materialId):[]
  const stores=[...new Set([...held.map(r=>r.warehouseId),...sourcesFor(s,ctx,order,materialId)])].filter(w=>!opts.only||w===opts.only)
  const draws:Draw[]=[]
  let left=q3(qty),reachable=0
  for(const w of stores){
    const b=s.stockBalances.find(x=>x.warehouseId===w&&x.itemId===materialId)
    if(!b)continue
    const own=Math.min(held.filter(r=>r.warehouseId===w).reduce((a,r)=>a+r.qty,0),b.reserved)
    const free=Math.max(0,b.onHand-b.reserved-(b.quarantine||0))
    const usable=Math.max(0,b.onHand-(b.quarantine||0)-expiredQty(s,materialId,w,today))
    const cap=Math.min(own+free,usable)
    reachable+=cap
    const can=q3(Math.min(cap,left))
    if(can<=0)continue
    draws.push({warehouseId:w,qty:can,own:q3(Math.min(can,own))})
    left=q3(left-can)
  }
  const unit=itemUnit(s,materialId)
  if(left>1e-6)return {error:opts.own
    ?`${itemName(s,materialId)}: buyurtma rezervi va bo‘sh qoldiq yetarli emas (kerak ${q3(qty)}, mavjud ${q3(reachable)} ${unit})`
    :`${itemName(s,materialId)}: bo‘sh qoldiq yetarli emas (kerak ${q3(qty)}, bo‘sh ${q3(reachable)} ${unit})`}
  return {draws}
}

/** Posts planned draws: balances (own reservation first), FEFO lots, ledger rows, and consumption rows valued at issue. */
function applyDraws(s:S,ctx:Ctx,order:ProductionOrder,materialId:string,draws:Draw[],note:string,lotOnly?:string):{state:S;consumed:MaterialConsumption[];remaining:number}{
  let next=s,remaining=0
  const consumed:MaterialConsumption[]=[]
  const itemType=isProductItem(s,materialId)?'finished' as const:'raw' as const
  for(const d of draws){
    next=changeBalance(next,ctx,d.warehouseId,materialId,{onHand:-d.qty,reserved:-d.own})
    const taken=takeLots(next,materialId,d.qty,order.code,d.warehouseId,lotOnly,isoDate(ctx.now))
    next=taken.state;remaining+=taken.remaining
    for(const a of taken.allocations.length?taken.allocations:[{qty:d.qty}]){
      consumed.push({materialId,itemType,qty:q3(a.qty),lot:a.lot,date:stamp(ctx.now),unitCost:Math.round(issueUnitCost(s,materialId,a.lot)*100)/100})
      next=addMove(next,ctx,{type:'Material Issue -',itemId:materialId,itemType,warehouseId:d.warehouseId,qty:-a.qty,source:order.code,note,lot:a.lot})
    }
  }
  return {state:next,consumed,remaining:q3(remaining)}
}

/** The order's reservation rows after the draws took their own part from them. */
function reservationsAfter(s:S,order:ProductionOrder,materialId:string,draws:Draw[]):MaterialReservation[]|undefined{
  if(!order.materialReserved)return order.reservations
  const rows=orderReservations(s,order).map(r=>({...r}))
  for(const d of draws){
    let left=d.own
    for(const r of rows.filter(x=>x.materialId===materialId&&x.warehouseId===d.warehouseId)){const t=Math.min(left,r.qty);r.qty=q3(r.qty-t);left=q3(left-t)}
  }
  return rows.filter(r=>r.qty>1e-9)
}

/**
 * Issues `qty` of a component to an order: from the order's own reservation first, the rest only from free
 * stock of its source stores, never beyond the BOM plan. Another order's reservation is never touched; when
 * stock is short nothing is issued at all.
 */
function issueToOrder(s:S,ctx:Ctx,order:ProductionOrder,materialId:string,qty:number,note:string,lot?:{code:string;warehouseId:string}):{state:S;consumed:MaterialConsumption[];reservations:MaterialReservation[]|undefined;remaining:number}|{error:string}{
  const unit=itemUnit(s,materialId)
  const plan=plannedIssue(order,materialId),issued=issuedQty(order,materialId)
  // 0.001 absorbs the q3 rounding of step-wise backflush; a scan never gets that far (it is capped to the plan).
  if(issued+qty>plan+1e-3)return {error:`${itemName(s,materialId)}: BOM rejasidan ortiq chiqim bloklangan (reja ${plan}, berilgan ${issued} ${unit})`}
  const planned=planDraws(s,ctx,order,materialId,qty,{own:true,only:lot?.warehouseId})
  if('error' in planned)return planned
  const applied=applyDraws(s,ctx,order,materialId,planned.draws,note,lot?.code)
  return {...applied,reservations:reservationsAfter(s,order,materialId,planned.draws)}
}

/** Releases exactly what the order still holds, never more than the balance carries, so other orders keep theirs. */
function releaseFor(s:S,ctx:Ctx,order:ProductionOrder):S{
  let next=s
  for(const r of orderReservations(s,order)){
    const b=next.stockBalances.find(x=>x.warehouseId===r.warehouseId&&x.itemId===r.materialId)
    const qty=q3(Math.min(r.qty,b?.reserved||0))
    if(qty>0)next=changeBalance(next,ctx,r.warehouseId,r.materialId,{reserved:-qty})
  }
  return next
}

/** Backflush component consumption for `units` (good + scrap). */
function consumeFor(s:S,ctx:Ctx,order:ProductionOrder,units:number,note:string):{state:S;consumed:MaterialConsumption[];reservations:MaterialReservation[]|undefined}|{error:string}{
  let next=s
  const consumed:MaterialConsumption[]=[]
  let working=order
  const targetUnits=order.completed+order.scrap+Math.max(0,units)
  for(const {component,required:targetRequired} of orderRequirements(order,targetUnits)){
    const already=order.consumed.filter(c=>c.materialId===component.materialId).reduce((a,c)=>a+c.qty,0)
    const required=q3(Math.max(0,targetRequired-already))
    if(required<=0)continue
    const drawn=issueToOrder(next,ctx,working,component.materialId,required,note)
    if('error' in drawn)return {error:drawn.error}
    next=drawn.state
    consumed.push(...drawn.consumed)
    // The next components' reservation / plan checks see what this one already took.
    working={...working,reservations:drawn.reservations,consumed:[...working.consumed,...drawn.consumed]}
  }
  return {state:lowStockSignals(next,ctx),consumed,reservations:working.reservations}
}

function lowStockSignals(s:S,ctx:Ctx):S{
  let next=s
  for(const m of s.rawMaterials){
    const stock=stockOf(s,m.id)
    if(stock.available+stock.incoming>=m.reorderPoint)continue
    // Matched by the material's own link, not by SKU text (one SKU can be part of another — N-25).
    const path=`/materials?view=all&id=${m.id}`
    if(next.notifications.some(n=>!n.read&&n.type==='low-stock'&&n.path===path))continue
    next=notify(next,ctx,'low-stock',`${m.name} qoldig‘i past`,`${m.sku}: available ${Math.round(stock.available)} ${m.unit}, reorder point ${m.reorderPoint}. Xarid tavsiya qilinadi.`,'warning',path)
  }
  return next
}

/* ------------------------------------------------------- production -- */

export function buildWorkOrders(bom:Bom,quantity:number,ctx:Ctx):WorkOrder[]{
  return bom.operations.map((op,i)=>({id:ctx.id('wo'),operationId:op.id,name:op.name,workCenterId:op.workCenterId,sequence:i+1,status:'Kutilmoqda',plannedMin:op.setupMin+op.runMin*quantity,actualMin:0,dependsOn:op.dependsOn||[]}))
}

/** One line of a job card's history, stamped with the actor. */
function woEvent(ctx:Ctx,action:WorkOrderEvent['action'],extra:Omit<WorkOrderEvent,'at'|'action'|'by'>={}):WorkOrderEvent{
  return {at:stamp(ctx.now),action,by:ctx.user?.id||'',...extra}
}
const withEvent=(w:WorkOrder,e:WorkOrderEvent):WorkOrder=>({...w,history:[...(w.history||[]),e]})

function refreshReadyWorkOrders(order:ProductionOrder):ProductionOrder{
  const done=new Set(order.workOrders.filter(w=>w.status==='Yakunlangan').map(w=>w.operationId))
  return {...order,workOrders:order.workOrders.map(w=>w.status==='Kutilmoqda'&&w.dependsOn.every(d=>done.has(d))?{...w,status:'Tayyor'}:w)}
}

function replanWorkOrders(order:ProductionOrder):ProductionOrder{
  return {...order,workOrders:order.workOrders.map(w=>{const op=order.bomSnapshot.operations.find(o=>o.id===w.operationId);return op?{...w,plannedMin:op.setupMin+op.runMin*order.quantity}:w})}
}

function setOrder(s:S,order:ProductionOrder):S{
  return {...s,productionOrders:s.productionOrders.map(o=>o.id===order.id?order:o)}
}

function progressOf(order:ProductionOrder){
  if(order.status==='Yakunlangan')return 100
  const produced=order.completed+order.scrap
  // Reported output is the truth once it exists; before that, finished operation time is the best signal.
  if(produced>0)return Math.min(99,Math.round(order.quantity?produced/order.quantity*100:0))
  const totalPlanned=order.workOrders.reduce((a,w)=>a+w.plannedMin,0)
  const byWork=totalPlanned?order.workOrders.reduce((a,w)=>a+(w.status==='Yakunlangan'?w.plannedMin:Math.min(w.plannedMin,w.actualMin)),0)/totalPlanned*100:0
  return Math.min(95,Math.round(byWork*.9))
}

/**
 * Why a BOM (or an order's frozen snapshot) cannot drive production (P1-11): a component that no longer exists or is
 * archived, a non-positive or non-finite quantity, negative waste, the product inside itself, or a line in another
 * unit than the item's stock (BUG-12).
 */
export function bomBlocker(s:S,bom:Pick<Bom,'code'|'productId'|'components'>):string|null{
  for(const c of bom.components){
    const item=s.rawMaterials.find(m=>m.id===c.materialId)||s.products.find(p=>p.id===c.materialId)
    if(!item)return `${bom.code}: komponent ${c.materialId} topilmadi — BOM’ni tuzating`
    if(item.status==='Arxiv')return `${bom.code}: ${item.name} arxivlangan — BOM’ni tuzating`
    if(c.materialId===bom.productId)return `${bom.code}: mahsulot o‘z tarkibida bo‘lishi mumkin emas`
    if(!Number.isFinite(Number(c.qty))||Number(c.qty)<=0)return `${bom.code}: ${item.name} miqdori 0 dan katta bo‘lishi kerak`
    if(!Number.isFinite(Number(c.waste))||Number(c.waste)<0)return `${bom.code}: ${item.name} chiqindi foizi manfiy bo‘lmasin`
    if(c.unit!==item.unit)return `${bom.code}: ${item.name} birligi (${c.unit}) ombor birligiga (${item.unit}) mos emas — BOM’ni tuzating`
  }
  return null
}

export type CreateOrderPayload={productId:string;quantity:number;bomId?:string;lineId?:string;warehouseId?:string;workCenterId?:string;responsibleId?:string;start?:string;due?:string;priority?:ProductionOrder['priority'];salesOrderId?:string;source?:string;reworkOf?:string;variantId?:string}

/** An active variant of the product, or why it cannot be used. */
function variantFor(s:S,productId:string,variantId?:string):{variant?:ProductVariant}|{error:string}{
  if(!variantId)return {}
  const product=s.products.find(p=>p.id===productId)
  const variant=product?.variants.find(v=>v.id===variantId)
  if(!variant)return {error:`${product?.name||'Mahsulot'}: variant topilmadi`}
  if(variant.status!=='Faol')return {error:`${variant.code} varianti arxivlangan`}
  return {variant}
}

export function createProductionOrder(s:S,ctx:Ctx,p:CreateOrderPayload):Outcome{
  const product=s.products.find(x=>x.id===p.productId)
  if(!product)return fail(s,'Mahsulot tanlanmagan')
  const quantity=Math.floor(Number(p.quantity)||0)
  if(quantity<=0)return fail(s,'Miqdor 0 dan katta bo‘lishi kerak')
  const picked=variantFor(s,product.id,p.variantId)
  if('error' in picked)return fail(s,picked.error)
  // A variant uses its own active BOM when it has one, else the product's general BOM.
  const bom=(p.bomId&&s.boms.find(b=>b.id===p.bomId&&b.status==='Faol'&&b.productId===product.id&&(!b.variantId||b.variantId===p.variantId)))||activeBomFor(s,product.id,p.variantId)
  if(!bom)return fail(s,`${product.name} uchun faol BOM yo‘q. Avval BOM yarating va faollashtiring.`)
  // A BOM line in another unit than the item's stock would reserve and issue wrong quantities (BUG-12); a stale or archived component could never be issued (P1-11).
  const invalidBom=p.reworkOf?null:bomBlocker(s,bom)
  if(invalidBom)return fail(s,invalidBom)
  const snapshot:Bom=p.reworkOf?{...clone(bom),components:[],byProducts:[]}:clone(bom)
  const lineId=p.lineId||s.settings.defaultLineId
  if(p.lineId&&!s.productionLines.some(l=>l.id===p.lineId))return fail(s,'Ishlab chiqarish liniyasi topilmadi')
  // Output lands in an existing, active store that holds finished goods — resolved from the data, never assumed (P1-10).
  const target=s.warehouses.find(w=>w.id===(p.warehouseId||finishedWarehouseFor(s,lineId)))
  if(!target||target.status!=='Faol'||!['Finished','Mixed','WIP'].includes(target.type))return fail(s,p.warehouseId?'Tayyor mahsulot ombori mavjud emas, arxivlangan yoki bu turdagi itemni saqlamaydi':'Faol tayyor mahsulot ombori topilmadi — avval ombor yarating')
  const id=ctx.id('mo'),code=nextCode(s.productionOrders.map(o=>o.code),'MO',ctx.now)
  const start=p.start||isoDate(ctx.now)
  // A due date before the start is a data-entry error, not something to replace silently (B3-14 / N-23).
  if(p.due&&p.due<start)return fail(s,`Muddat (${p.due}) boshlanish sanasidan (${start}) oldin bo‘lishi mumkin emas`)
  const order:ProductionOrder={id,code,productId:product.id,quantity,completed:0,scrap:0,bomId:bom.id,bomVersion:bom.version,bomSnapshot:snapshot,
    warehouseId:target.id,lineId,workCenterId:p.workCenterId||bom.operations[0]?.workCenterId||s.workCenters[0]?.id||'',
    responsibleId:p.responsibleId||ctx.user.id,status:'Qoralama',start,due:p.due||addDays(start,Math.max(1,product.leadTime)),progress:0,priority:p.priority||'Normal',
    salesOrderId:p.salesOrderId,estimatedCost:0,actualCost:0,materialReserved:false,qualityStatus:'Pending',createdAt:stamp(ctx.now),source:p.source,reworkOf:p.reworkOf,
    workOrders:buildWorkOrders(snapshot,quantity,ctx),consumed:[],qcHeld:0,variantId:picked.variant?.id}
  order.estimatedCost=Math.round(estimateOrderCost(s,order).total)
  let next={...s,productionOrders:[order,...s.productionOrders]}
  next=logActivity(next,ctx,'Ishlab chiqarish buyurtmasini yaratdi','Ishlab chiqarish',code,'info',`${product.name}${picked.variant?` (${picked.variant.code})`:''} · ${quantity} ${product.unit} · ${bom.code} ${bom.version}`)
  return ok(next,`${code} yaratildi`,id)
}

export function updateProductionOrder(s:S,ctx:Ctx,id:string,patch:Partial<Pick<ProductionOrder,'quantity'|'due'|'start'|'priority'|'lineId'|'responsibleId'>>):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  if(!isOpenOrder(o))return fail(s,'Yopilgan buyurtmani tahrirlab bo‘lmaydi')
  let updated={...o}
  if(patch.quantity!==undefined&&patch.quantity!==o.quantity){
    const quantity=Math.floor(Number(patch.quantity)||0)
    if(o.status!=='Qoralama')return fail(s,'Miqdorni faqat Qoralama holatida o‘zgartirish mumkin (yoki Split ishlating)')
    if(quantity<=0)return fail(s,'Miqdor 0 dan katta bo‘lishi kerak')
    updated={...updated,quantity}
    updated=replanWorkOrders(updated)
    updated.estimatedCost=Math.round(estimateOrderCost(s,updated).total)
  }
  if(patch.start)updated.start=patch.start
  if(patch.due)updated.due=patch.due
  if(updated.due<updated.start)return fail(s,'Due sana boshlanish sanasidan oldin bo‘lishi mumkin emas')
  if(patch.priority)updated.priority=patch.priority
  if(patch.responsibleId)updated.responsibleId=patch.responsibleId
  if(patch.lineId&&patch.lineId!==o.lineId){
    if(o.materialReserved)return fail(s,'Rezerv qilingan buyurtma liniyasini o‘zgartirib bo‘lmaydi')
    updated={...updated,lineId:patch.lineId,warehouseId:finishedWarehouseFor(s,patch.lineId)}
  }
  const next=logActivity(setOrder(s,updated),ctx,'Buyurtmani tahrirladi','Ishlab chiqarish',o.code)
  return ok(next,`${o.code} yangilandi`,id)
}

function tryReserve(s:S,ctx:Ctx,order:ProductionOrder):{state:S;order:ProductionOrder;reserved:boolean}{
  if(order.materialReserved)return {state:s,order,reserved:true}
  const reserved=reserveFor(s,ctx,order)
  if(!reserved)return {state:s,order,reserved:false}
  return {state:reserved.state,order:{...order,materialReserved:true,reservations:reserved.reservations},reserved:true}
}

/** Re-check orders waiting for material (after receipts/adjustments). */
function retryWaitingOrders(s:S,ctx:Ctx):S{
  let next=s
  // Earliest due first, the same order material pegging uses, so the most urgent order gets the stock.
  for(const o of s.productionOrders.filter(x=>x.status==='Material kutilmoqda').sort((a,b)=>a.due.localeCompare(b.due)||a.createdAt.localeCompare(b.createdAt))){
    const r=tryReserve(next,ctx,o)
    if(!r.reserved)continue
    next=setOrder(r.state,{...r.order,status:'Tasdiqlangan'})
    next=notify(next,ctx,'production','Material rezerv qilindi',`${o.code} uchun material yetarli — buyurtma tasdiqlandi.`,'success','/production?view=orders&id='+o.id)
    next=logActivity(next,ctx,'Material avtomatik rezerv qilindi','Ishlab chiqarish',o.code,'success')
  }
  return next
}

/** A small stable hash, so a random sample decision is the same every time the same event is replayed. */
function stableHash(text:string){
  let h=2166136261
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return h>>>0
}

/**
 * Whether a control point asks for a check at this event (BUG-17). "Every time": always; "On demand": never
 * automatically (an inspector creates it); "Random": a sample of `sampleRate` % chosen by the event key;
 * "Periodic": every N-th event, N = 100 / sampleRate. Without a control point the caller's policy decides.
 */
export function controlPointDue(qcp:Pick<QualityControlPoint,'frequency'|'sampleRate'>|undefined,eventKey:string,sequence:number){
  if(!qcp)return true
  const rate=Math.min(100,Math.max(0,Number(qcp.sampleRate)||0))
  if(qcp.frequency==='On demand')return false
  if(qcp.frequency==='Random')return rate>=100||stableHash(eventKey)%100<rate
  if(qcp.frequency==='Periodic'){const every=Math.max(1,Math.round(100/Math.max(1,rate)));return sequence%every===0}
  return true
}

function ensureFinalCheck(s:S,ctx:Ctx,order:ProductionOrder):S{
  if(s.qualityChecks.some(q=>q.sourceId===order.id&&q.type==='Final'&&q.status==='Pending'))return s
  const qcp=s.qualityControlPoints.find(c=>c.active&&c.scope==='Final'&&(!c.productId||c.productId===order.productId))
  // With Final QC required every order is inspected; otherwise the control point's frequency decides.
  const earlier=s.productionOrders.filter(o=>o.productId===order.productId&&o.id!==order.id&&o.status==='Yakunlangan').length
  if(!s.settings.policies.requireFinalQc&&!controlPointDue(qcp,order.id,earlier))return s
  const check:QualityCheck={id:ctx.id('qc'),type:'Final',sourceType:'production',sourceId:order.id,itemId:order.productId,status:'Pending',inspectorId:s.employees.find(e=>e.department==='Quality')?.id||ctx.user.id,date:stamp(ctx.now),controlPointId:qcp?.id,lot:order.lot}
  return {...s,qualityChecks:[check,...s.qualityChecks]}
}

function closeRunningWork(s:S,ctx:Ctx,order:ProductionOrder,final:boolean):{state:S;order:ProductionOrder}{
  let next=s
  const now=stamp(ctx.now)
  const workOrders=order.workOrders.map(w=>{
    if(w.status!=='Jarayonda')return final&&w.status!=='Yakunlangan'?{...w,status:'Yakunlangan' as const,completedAt:now}:w
    const elapsed=w.lastStartAt?minutesBetween(w.lastStartAt,now):0
    return withEvent({...w,actualMin:w.actualMin+elapsed,lastStartAt:undefined,status:final?'Yakunlangan' as const:'Pauzada' as const,completedAt:final?now:w.completedAt},woEvent(ctx,final?'complete':'pause',{minutes:elapsed}))
  })
  next={...next,timeLogs:next.timeLogs.map(t=>t.orderId===order.id&&!t.end?{...t,end:now,minutes:minutesBetween(t.start,now)}:t)}
  return {state:next,order:{...order,workOrders}}
}

/** Receive good output into finished stock with lot / serial assignment. */
function receiveOutput(s:S,ctx:Ctx,order:ProductionOrder,good:number):{state:S;order:ProductionOrder}{
  if(good<=0)return {state:s,order}
  const product=s.products.find(p=>p.id===order.productId)
  let next=s
  const updated={...order}
  if(order.reworkOf){
    // In-place rework: units are already in stock, nothing new is received. A production rework takes the reworked
    // units over from its source order's Final QC hold, so its own pass releases them and the source's pass does not.
    const source=isReturnRework(next,order)?undefined:next.productionOrders.find(o=>o.id===order.reworkOf)
    if(!source)return {state:next,order:{...updated,completed:updated.completed+good}}
    const sourceHold=orderQcHold(next,source),take=Math.min(good,sourceHold)
    next=setOrder(next,{...source,qcHeld:sourceHold-take})
    return {state:next,order:{...updated,completed:updated.completed+good,qcHeld:orderQcHold(s,order)+take}}
  }
  const tracking=product?.tracking||'none'
  const qcHold=Boolean(next.settings.policies.requireFinalQc)
  let lotRef:string|undefined
  if(tracking==='lot'){
    // A lot already released by QC is not re-quarantined as a whole: new held output starts a new lot (B3-08).
    const current=updated.lot?next.lots.find(l=>l.code===updated.lot&&l.itemId===order.productId):undefined
    const reuse=updated.lot&&!(qcHold&&current&&current.status!=='quarantine')
    const code=reuse?updated.lot!:lotCode(next,product?.sku||order.productId,ctx.now)
    updated.lot=code
    lotRef=code
    const existing=next.lots.find(l=>l.code===code)
    next=existing
      ?{...next,lots:next.lots.map(l=>l.code===code?{...l,qty:q3(l.qty+good)}:l)}
      :{...next,lots:[{id:ctx.id('lot'),code,kind:'lot',itemId:order.productId,itemType:'finished',qty:good,warehouseId:order.warehouseId,sourceType:'production',sourceId:order.id,sourceCode:order.code,createdAt:stamp(ctx.now),consumedBy:[]},...next.lots]}
  }else if(tracking==='serial'){
    const prefix=`SN-${(product?.sku||'').replace(/^FG-/,'').replace(/-/g,'')}-`
    const last=next.lots.filter(l=>l.kind==='serial'&&l.serialTo?.startsWith(prefix)).reduce((max,l)=>Math.max(max,Number(l.serialTo!.slice(prefix.length))||0),0)
    const from=`${prefix}${String(last+1).padStart(6,'0')}`,to=`${prefix}${String(last+good).padStart(6,'0')}`
    lotRef=`${from}…${to.slice(prefix.length)}`
    updated.serialRange=updated.serialRange?`${updated.serialRange.split('…')[0]}…${to.slice(prefix.length)}`:lotRef
    next={...next,lots:[{id:ctx.id('lot'),code:lotRef,kind:'serial',itemId:order.productId,itemType:'finished',qty:good,warehouseId:order.warehouseId,sourceType:'production',sourceId:order.id,sourceCode:order.code,createdAt:stamp(ctx.now),serialFrom:from,serialTo:to,consumedBy:[]},...next.lots]}
  }
  next=changeBalance(next,ctx,order.warehouseId,order.productId,{onHand:good,quarantine:qcHold?good:0},lotRef)
  // Output added after an earlier Final pass is uninspected again: the order needs a new Final pass (N-01).
  if(qcHold&&updated.qualityStatus==='Passed')updated.qualityStatus='Pending'
  if(lotRef&&qcHold)next={...next,lots:next.lots.map(l=>l.code===lotRef&&l.itemId===order.productId?{...l,status:'quarantine' as const}:l)}
  next=addMove(next,ctx,{type:'Production +',itemId:order.productId,itemType:'finished',warehouseId:order.warehouseId,qty:good,source:order.code,note:qcHold?'Finished production · QC quarantine':'Finished production',lot:lotRef})
  for(const bp of order.bomSnapshot.byProducts||[]){
    const qty=q3(bp.qty*good)
    next=changeBalance(next,ctx,order.warehouseId,bp.productId,{onHand:qty})
    next=addMove(next,ctx,{type:'Production +',itemId:bp.productId,itemType:'finished',warehouseId:order.warehouseId,qty,source:order.code,note:'By-product / co-product'})
  }
  return {state:next,order:{...updated,completed:updated.completed+good,qcHeld:orderQcHold(s,order)+(qcHold?good:0)}}
}

export function reportOutput(s:S,ctx:Ctx,id:string,good:number,scrap=0,reason='Shop Floor scrap',key?:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  // The same report submitted twice (double click, second tab) is posted once (BUG-13).
  if(key&&o.outputKeys?.includes(key))return fail(s,'Bu natija allaqachon qayd etilgan — qayta yozilmadi')
  if(!['Jarayonda','Pauzada'].includes(o.status))return fail(s,'Natija faqat jarayondagi buyurtmaga yoziladi')
  const g=Math.floor(Number(good)||0),sc=Math.floor(Number(scrap)||0)
  if(g<0||sc<0||g+sc<=0)return fail(s,'Tayyor yoki scrap miqdorini kiriting')
  if(g+sc>remainingQty(o))return fail(s,`Qolgan miqdor ${remainingQty(o)} dan oshib ketdi`)
  const consumed=consumeFor(s,ctx,o,g+sc,sc?`Production consumption (+${sc} scrap)`:'Production consumption')
  if('error' in consumed)return fail(s,consumed.error)
  let next=consumed.state
  const received=receiveOutput(next,ctx,{...o,consumed:[...o.consumed,...consumed.consumed],reservations:consumed.reservations},g)
  next=received.state
  let updated={...received.order,scrap:o.scrap+sc,...(key?{outputKeys:[...(o.outputKeys||[]),key].slice(-50)}:{})}
  updated={...updated,progress:progressOf(updated)}
  next=setOrder(next,updated)
  if(sc>0)next=scrapAlert(next,ctx,o,sc,reason)
  next=logActivity(next,ctx,'Natija qayd etdi','Ishlab chiqarish',o.code,'info',`${g} tayyor${sc?`, ${sc} scrap`:''}`)
  return ok(next,`${o.code}: ${g} tayyor${sc?` · ${sc} scrap`:''} qayd etildi`)
}

function scrapAlert(s:S,ctx:Ctx,o:ProductionOrder,amount:number,reason:string):S{
  const alert={id:ctx.id('qa'),title:`${o.code} — scrap ${amount} ${itemUnit(s,o.productId)}`,sourceId:o.id,severity:(amount/Math.max(1,o.quantity)>.05?'Yuqori':'O‘rta') as 'Yuqori'|'O‘rta',status:'Ochiq' as const,reason:reason||'Shop Floor scrap',ownerId:o.responsibleId,createdAt:stamp(ctx.now)}
  return notify({...s,qualityAlerts:[alert,...s.qualityAlerts]},ctx,'quality','Scrap qayd etildi',`${o.code}: ${amount} · ${reason}`,'warning','/quality?view=scrap')
}

export function recordScrap(s:S,ctx:Ctx,id:string,qty:number,reason:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  const amount=Math.floor(Number(qty)||0)
  if(amount<=0||amount>remainingQty(o))return fail(s,`Scrap miqdori 1–${remainingQty(o)} oralig‘ida bo‘lishi kerak`)
  if(!['Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status))return fail(s,'Scrap faqat ishlab chiqarish jarayonida yoziladi')
  const consumed=consumeFor(s,ctx,o,amount,'Scrap consumption')
  if('error' in consumed)return fail(s,consumed.error)
  let next=consumed.state
  const updated={...o,scrap:o.scrap+amount,consumed:[...o.consumed,...consumed.consumed],reservations:consumed.reservations}
  next=setOrder(next,{...updated,progress:progressOf(updated)})
  next=scrapAlert(next,ctx,o,amount,reason)
  next=logActivity(next,ctx,'Scrap qayd etdi','Ishlab chiqarish',o.code,'warning',reason)
  return ok(next,`${amount} ${itemUnit(s,o.productId)} scrap qayd etildi`)
}

export function transitionProduction(s:S,ctx:Ctx,id:string,status:ProductionStatus):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  if(!isOpenOrder(o))return fail(s,`${o.code} allaqachon yopilgan`)
  let next=s,updated:ProductionOrder={...o}

  if(status==='Tasdiqlangan'){
    if(!['Qoralama','Material kutilmoqda'].includes(o.status))return fail(s,'Faqat qoralama buyurtma tasdiqlanadi')
    const invalid=bomBlocker(s,o.bomSnapshot)
    if(invalid)return fail(s,invalid)
    const r=tryReserve(next,ctx,updated)
    next=r.state;updated=r.order
    if(!r.reserved){
      const missing=missingFor(next,ctx,o).map(m=>`${itemName(s,m.itemId)} ${Math.ceil(m.missing)} ${itemUnit(s,m.itemId)}`).join(', ')
      updated={...updated,status:'Material kutilmoqda'}
      next=notify(setOrder(next,updated),ctx,'low-stock','Material yetishmayapti',`${o.code}: ${missing}. MRP/xarid tavsiyasini tekshiring.`,'warning','/materials?view=requirements&short=1')
      next=logActivity(next,ctx,'Status → Material kutilmoqda','Ishlab chiqarish',o.code,'warning',missing)
      return {state:next,result:{ok:false,message:`Material yetarli emas: ${missing}. Buyurtma “Material kutilmoqda” holatida.`}}
    }
  }
  if(status==='Jarayonda'){
    // From QC an order may go back to production while quantity is still open, so the rest can be produced (BUG-06).
    const backFromQc=o.status==='Sifat nazoratida'&&remainingQty(o)>0
    if(!['Tasdiqlangan','Pauzada'].includes(o.status)&&!backFromQc)return fail(s,o.status==='Sifat nazoratida'?'Qolgan miqdor yo‘q — buyurtmani QC orqali yakunlang':'Jarayonga faqat tasdiqlangan yoki pauzadagi buyurtma o‘tadi')
    if(!updated.materialReserved&&updated.bomSnapshot.components.length)return fail(s,'Material rezerv qilinmagan')
    const invalid=bomBlocker(s,o.bomSnapshot)
    if(invalid)return fail(s,invalid)
    updated={...refreshReadyWorkOrders(updated),startedAt:o.startedAt||stamp(ctx.now)}
  }
  if(status==='Pauzada'){
    if(o.status!=='Jarayonda')return fail(s,'Faqat jarayondagi buyurtma pauza qilinadi')
    const closed=closeRunningWork(next,ctx,updated,false)
    next=closed.state;updated=closed.order
  }
  if(status==='Sifat nazoratida'){
    if(!['Jarayonda','Pauzada'].includes(o.status))return fail(s,'Sifat nazoratiga faqat jarayondagi buyurtma yuboriladi')
    const unfinished=updated.workOrders.filter(w=>w.status!=='Yakunlangan')
    if(unfinished.length)return fail(s,`Avval barcha operatsiyalarni yakunlang: ${unfinished.map(w=>w.name).join(', ')}`)
    // Without reported output QC has nothing to inspect and the order would be stuck there (BUG-06).
    if(o.completed+o.scrap<=0)return fail(s,'Sifat nazoratiga yuborishdan oldin tayyor yoki scrap natijasini qayd eting')
    // Units added after an earlier pass are still held: they need their own Final check (N-01 / B3-08).
    const stillHeld=orderQcHold(next,o)>0
    updated={...updated,qualityStatus:updated.qualityStatus==='Passed'&&!stillHeld?'Passed':'Pending'}
    if(next.settings.policies.autoQualityChecks||next.settings.policies.requireFinalQc)next=ensureFinalCheck(next,ctx,updated)
  }
  if(status==='Yakunlangan'){
    if(o.status!=='Sifat nazoratida')return fail(s,'Yakunlashdan oldin buyurtmani sifat nazoratiga yuboring')
    const held=orderQcHold(s,o)
    // A Final scrap decision that removed every held unit leaves nothing to inspect: the order may close (N-02).
    const scrappedOut=o.qualityStatus==='Scrap'&&held<=0
    if(['Failed','Scrap','Rework','Hold'].includes(o.qualityStatus)&&!scrappedOut)return fail(s,'Final QC o‘tmadi. Rework yoki scrap qaror qabul qiling, keyin qayta tekshiruv o‘tkazing.')
    if(next.settings.policies.requireFinalQc&&o.qualityStatus!=='Passed'&&!scrappedOut)return fail(s,'Final quality check hali Passed emas. Sifat → Tekshiruvlar bo‘limida natijani kiriting.')
    // In-process inspections still open would be skipped silently (N-13).
    const openChecks=s.qualityChecks.filter(q=>q.sourceType==='production'&&q.sourceId===o.id&&q.status==='Pending')
    if(openChecks.length)return fail(s,`${openChecks.length} ta tekshiruv hali Pending — avval natijasini kiriting`)
    const rest=remainingQty(o)
    if(rest>0)return fail(s,`Qolgan ${rest} ${itemUnit(s,o.productId)} avtomatik ishlab chiqarilmaydi. Natija kiriting, Backorder yoki Short close tanlang.`)
    const unfinished=updated.workOrders.filter(w=>w.status!=='Yakunlangan')
    if(unfinished.length)return fail(s,`Yakunlanmagan operatsiyalar bor: ${unfinished.map(w=>w.name).join(', ')}`)
    // Whatever the order still holds (rounding remainder, older data) goes back to free stock instead of staying reserved forever.
    if(o.materialReserved)next=releaseFor(next,ctx,o)
    // Final QC switched off after this output was quarantined: nothing will ever inspect it, so it is released here (N-08).
    if(!next.settings.policies.requireFinalQc&&held>0){
      const balance=next.stockBalances.find(b=>b.warehouseId===o.warehouseId&&b.itemId===o.productId)
      const release=q3(Math.min(held,balance?.quarantine||0))
      if(release>0)next=changeBalance(next,ctx,o.warehouseId,o.productId,{quarantine:-release})
      next={...next,lots:next.lots.map(l=>l.sourceType==='production'&&l.sourceId===o.id&&l.status==='quarantine'?{...l,status:'available' as const}:l)}
    }
    updated={...updated,materialReserved:false,reservations:undefined,progress:100,completedAt:stamp(ctx.now),qcHeld:0}
    if(updated.salesOrderId){
      const so=next.salesOrders.find(x=>x.id===updated.salesOrderId)
      if(so&&!['Yetkazildi','Bekor'].includes(so.status))next=reserveSales(next,ctx,so).state
    }
    next=setOrder(next,{...updated,status:'Yakunlangan'})
    // Cost is frozen at completion with the same formulas the reports use, so later price changes keep history (BUG-08).
    next={...next,productionOrders:next.productionOrders.map(x=>{
      if(x.id!==id)return x
      const planned=roundCost(estimateOrderCost(next,x)),actual=roundCost(actualOrderCost(next,x))
      return {...x,actualCost:Math.round(actual.total),costSnapshot:{planned,actual,at:stamp(ctx.now)}}
    })}
    next=notify(next,ctx,'production','Ishlab chiqarish yakunlandi',`${o.code} · ${itemName(s,o.productId)} ${updated.completed} ${itemUnit(s,o.productId)} qabul qilindi${updated.lot?` (${updated.lot})`:''}.`,'success','/production?view=orders&id='+o.id)
    next=logActivity(next,ctx,'Status → Yakunlangan','Ishlab chiqarish',o.code,'success',`${updated.completed} tayyor · ${updated.scrap} scrap`)
    return ok(next,`${o.code} yakunlandi · ${updated.completed} ${itemUnit(s,o.productId)} omborga kirim qilindi`)
  }
  if(status==='Bekor qilingan'){
    // Output already in Final QC quarantine would stay held forever with no check able to release it (B3-07).
    if(orderQcHold(s,o)>0)return fail(s,`${o.code}: ${orderQcHold(s,o)} ${itemUnit(s,o.productId)} natija QC karantinida — bekor qilish o‘rniga QC qarorini kiriting yoki Short close qiling`)
    if(o.materialReserved)next=releaseFor(next,ctx,o)
    const closed=closeRunningWork(next,ctx,updated,false)
    // Open job cards end as cancelled; their time, quantities and history stay on the record.
    next=closed.state;updated={...closed.order,materialReserved:false,reservations:undefined,workOrders:closed.order.workOrders.map(w=>isOpenWorkOrder(w)?withEvent({...w,status:'Bekor qilingan' as const},woEvent(ctx,'cancel',{note:'MO bekor qilindi'})):w)}
    // Open inspections of a cancelled order can no longer be acted on.
    next={...next,qualityChecks:next.qualityChecks.map(q=>q.sourceType==='production'&&q.sourceId===o.id&&q.status==='Pending'?{...q,status:'Hold' as const,reason:`${q.reason?`${q.reason} · `:''}MO bekor qilindi`}:q)}
    if(o.salesOrderId)next={...next,salesOrders:next.salesOrders.map(so=>so.id===o.salesOrderId&&so.status==='Ishlab chiqarishda'?{...so,status:'Tasdiqlangan'}:so)}
    next=notify(next,ctx,'production','Buyurtma bekor qilindi',`${o.code} bekor qilindi, material rezervi qaytarildi.`,'warning',`/production?view=orders&status=Bekor qilingan&id=${o.id}`)
  }
  updated={...updated,status}
  updated={...updated,progress:progressOf(updated)}
  next=setOrder(next,updated)
  next=logActivity(next,ctx,`Status → ${status}`,'Ishlab chiqarish',o.code,status==='Bekor qilingan'?'warning':'info')
  return ok(next,`${o.code}: ${status}`)
}

export function shortCloseProduction(s:S,ctx:Ctx,id:string,reason='Qolgan miqdor bekor qilindi'):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  if(!['Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status))return fail(s,'Short close faqat ishlab chiqarish jarayonidagi buyurtmada mumkin')
  const rest=remainingQty(o)
  if(rest<=0)return fail(s,'Qolgan miqdor yo‘q')
  // Short-closing an order with no output would complete it with quantity 0 (BUG-06): that is a cancellation.
  if(o.completed+o.scrap<=0)return fail(s,'Hali natija yo‘q — short close o‘rniga buyurtmani bekor qiling')
  let next=s
  if(o.materialReserved)next=releaseFor(next,ctx,o)
  const newQty=o.completed+o.scrap
  const updated=replanWorkOrders({...o,quantity:newQty,materialReserved:false,reservations:undefined,progress:newQty?Math.min(99,Math.round((o.completed+o.scrap)/newQty*100)):0,source:`${o.source||''}${o.source?' · ':''}Short close: ${reason}`})
  next=setOrder(next,updated)
  next=logActivity(next,ctx,'Qolgan miqdor short close qilindi','Ishlab chiqarish',o.code,'warning',`${rest} ${itemUnit(s,o.productId)} · ${reason}`)
  return ok(next,`${o.code}: qolgan ${rest} ${itemUnit(s,o.productId)} yopildi`)
}

/** Whole so‘m per part; the total stays the exact sum of the stored parts. */
const roundCost=(c:CostSnapshot):CostSnapshot=>{
  const material=Math.round(c.material),labor=Math.round(c.labor),machine=Math.round(c.machine),energy=Math.round(c.energy||0),overhead=Math.round(c.overhead)
  return {material,labor,machine,energy,overhead,total:material+labor+machine+energy+overhead}
}

export function checkAvailability(s:S,ctx:Ctx,id:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o||o.status!=='Material kutilmoqda')return fail(s,'Buyurtma material kutish holatida emas')
  return transitionProduction(s,ctx,id,'Tasdiqlangan')
}

/* ------------------------------------------------------- work orders -- */

/**
 * Mandatory in-process inspections (control point marked blocking) of the operations this one waits for that are
 * not passed yet: the next operation may not start on uninspected or rejected work.
 */
function qualityGate(s:S,o:ProductionOrder,wo:WorkOrder){
  // The newest mandatory check of each predecessor decides (checks are stored newest first): a passed re-inspection lifts a failure.
  const open=o.workOrders.filter(w=>wo.dependsOn.includes(w.operationId)).flatMap(w=>{
    const q=s.qualityChecks.find(x=>x.sourceType==='production'&&x.sourceId===o.id&&x.workOrderId===w.id&&s.qualityControlPoints.find(c=>c.id===x.controlPointId)?.blocking)
    return q&&q.status!=='Passed'?[`${w.name} (${q.status})`]:[]
  })
  return open.length?`Majburiy sifat tekshiruvi o‘tmagan: ${open.join(', ')}`:null
}

export function startWorkOrder(s:S,ctx:Ctx,orderId:string,workOrderId:string,employeeId?:string):Outcome{
  let o=s.productionOrders.find(x=>x.id===orderId)
  if(!o)return fail(s,'Buyurtma topilmadi')
  const target=o.workOrders.find(w=>w.id===workOrderId)
  if(!target)return fail(s,'Operatsiya topilmadi')
  if(target.status==='Bekor qilingan')return fail(s,`${target.name} bekor qilingan`)
  // Time is booked to the person who starts the work (BUG-18); someone named explicitly must be allowed to work there.
  const operatorId=employeeId||ctx.user.id
  const operator=s.employees.find(e=>e.id===operatorId)
  if(employeeId){const blocked=operatorScopeBlocker(s,operator,target.workCenterId);if(blocked)return fail(s,blocked)}
  const gate=qualityGate(s,o,target)
  if(gate)return fail(s,gate)
  let next=s
  if(o.status==='Tasdiqlangan'||o.status==='Pauzada'){
    const started=transitionProduction(next,ctx,orderId,'Jarayonda')
    if(!started.result.ok)return started
    next=started.state
    o=next.productionOrders.find(x=>x.id===orderId)!
  }
  if(o.status!=='Jarayonda')return fail(s,'Operatsiyani boshlash uchun buyurtma jarayonda bo‘lishi kerak')
  o=refreshReadyWorkOrders(o)
  const wo=o.workOrders.find(w=>w.id===workOrderId)
  if(!wo)return fail(s,'Operatsiya topilmadi')
  if(wo.status==='Yakunlangan')return fail(s,`${wo.name} allaqachon yakunlangan`)
  if(wo.status==='Jarayonda')return fail(s,`${wo.name} allaqachon ishlamoqda`)
  if(wo.status==='Kutilmoqda'){
    const blocking=o.workOrders.filter(w=>wo.dependsOn.includes(w.operationId)&&w.status!=='Yakunlangan').map(w=>w.name)
    return fail(s,`Avval tugatilishi kerak: ${blocking.join(', ')}`)
  }
  const machineDown=next.equipment.some(e=>e.workCenterId===wo.workCenterId&&e.status==='To‘xtagan')
  if(machineDown)return fail(s,'Work center uskunasi to‘xtagan. Avval downtime/maintenance’ni yoping.')
  const now=stamp(ctx.now)
  const resumed=wo.status==='Pauzada'
  // Machine and energy rates are frozen at the first start, so the job card keeps its cost when rates change later.
  const updated={...o,workOrders:o.workOrders.map(w=>w.id===workOrderId?withEvent({...w,status:'Jarayonda' as const,startedAt:w.startedAt||now,lastStartAt:now,
    machineRate:w.machineRate??machineRateOf(next,w.workCenterId),energyRate:w.energyRate??energyRateOf(next,w.workCenterId),
    operatorIds:w.operatorIds?.includes(operatorId)?w.operatorIds:[...(w.operatorIds||[]),operatorId]},woEvent(ctx,resumed?'resume':'start',{note:operator?.name})):w)}
  next=setOrder(next,{...updated,progress:progressOf(updated)})
  next={...next,timeLogs:[{id:ctx.id('tl'),orderId,workOrderId,employeeId:operatorId,workCenterId:wo.workCenterId,start:now,minutes:0,hourlyRate:operator?.hourlyCost,kind:wo.setupActualMin!==undefined?'run' as const:undefined},...next.timeLogs]}
  next=logActivity(next,ctx,`Operatsiya ${resumed?'davom ettirildi':'boshlandi'}: ${wo.name}`,'Ishlab chiqarish',o.code)
  return ok(next,`${wo.name} ${resumed?'davom ettirildi':'boshlandi'}`)
}

function stopWorkOrder(s:S,ctx:Ctx,orderId:string,workOrderId:string,finish:boolean):Outcome{
  const o=s.productionOrders.find(x=>x.id===orderId)
  const wo=o?.workOrders.find(w=>w.id===workOrderId)
  if(!o||!wo)return fail(s,'Operatsiya topilmadi')
  // A closed (cancelled/completed) order's operations are frozen (N-09).
  if(!['Jarayonda','Pauzada'].includes(o.status))return fail(s,`${o.code} ${o.status} holatida — operatsiyani o‘zgartirib bo‘lmaydi`)
  if(!finish&&wo.status!=='Jarayonda')return fail(s,`${wo.name} ishlamayapti`)
  if(finish&&!['Jarayonda','Pauzada'].includes(wo.status))return fail(s,`${wo.name} avval boshlanishi kerak`)
  const now=stamp(ctx.now)
  const elapsed=wo.status==='Jarayonda'&&wo.lastStartAt?minutesBetween(wo.lastStartAt,now):0
  let updated:ProductionOrder={...o,workOrders:o.workOrders.map(w=>w.id===workOrderId?withEvent({...w,actualMin:w.actualMin+elapsed,lastStartAt:undefined,status:finish?'Yakunlangan' as const:'Pauzada' as const,completedAt:finish?now:w.completedAt},woEvent(ctx,finish?'complete':'pause',{minutes:elapsed})):w)}
  if(finish)updated=refreshReadyWorkOrders(updated)
  updated={...updated,progress:progressOf(updated)}
  let next=setOrder(s,updated)
  next={...next,timeLogs:next.timeLogs.map(t=>t.workOrderId===workOrderId&&!t.end?{...t,end:now,minutes:minutesBetween(t.start,now)}:t)}
  const op=o.bomSnapshot.operations.find(x=>x.id===wo.operationId)
  const inProcess=finish&&op?.qualityCheck&&next.settings.policies.autoQualityChecks?next.qualityControlPoints.find(c=>c.active&&c.scope==='In-process'&&(!c.productId||c.productId===o.productId)&&(!c.operationName||c.operationName===op.name)):undefined
  const earlierRuns=s.productionOrders.filter(x=>x.productId===o.productId&&x.workOrders.some(w=>w.name===wo.name&&w.status==='Yakunlangan')).length
  // One in-process check per operation run: a repeated completion event never opens a second one.
  const already=s.qualityChecks.some(q=>q.sourceType==='production'&&q.sourceId===o.id&&q.workOrderId===wo.id)
  if(finish&&!already&&op?.qualityCheck&&next.settings.policies.autoQualityChecks&&controlPointDue(inProcess,`${o.id}:${wo.id}`,earlierRuns)){
    const qcp=inProcess
    const operatorId=s.timeLogs.find(t=>t.workOrderId===wo.id)?.employeeId
    next={...next,qualityChecks:[{id:ctx.id('qc'),type:'Jarayon',sourceType:'production',sourceId:o.id,itemId:o.productId,status:'Pending',inspectorId:next.employees.find(e=>e.department==='Quality')?.id||ctx.user.id,date:now,controlPointId:qcp?.id,reason:`${op.name} operatsiyasidan keyin`,workOrderId:wo.id,operatorId,lot:o.lot},...next.qualityChecks]}
  }
  next=logActivity(next,ctx,`Operatsiya ${finish?'yakunlandi':'pauza'}: ${wo.name}`,'Ishlab chiqarish',o.code,'info',`${elapsed} min`)
  return ok(next,`${wo.name} ${finish?'yakunlandi':'pauza qilindi'}`)
}

export const pauseWorkOrder=(s:S,ctx:Ctx,orderId:string,workOrderId:string)=>stopWorkOrder(s,ctx,orderId,workOrderId,false)
export const finishWorkOrder=(s:S,ctx:Ctx,orderId:string,workOrderId:string)=>stopWorkOrder(s,ctx,orderId,workOrderId,true)

/**
 * Ends the setup part of a running operation: the time so far is setup (kept in setupActualMin and on its time
 * log), the work continues as run time in a new interval without a gap.
 */
export function markSetupDone(s:S,ctx:Ctx,orderId:string,workOrderId:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===orderId)
  const wo=o?.workOrders.find(w=>w.id===workOrderId)
  if(!o||!wo)return fail(s,'Operatsiya topilmadi')
  if(wo.status!=='Jarayonda'||!wo.lastStartAt)return fail(s,`${wo.name} ishlamayapti — setup faqat ishlayotgan operatsiyada belgilanadi`)
  if(wo.setupActualMin!==undefined)return fail(s,`${wo.name}: setup allaqachon belgilangan (${wo.setupActualMin} min)`)
  const now=stamp(ctx.now),elapsed=minutesBetween(wo.lastStartAt,now)
  const setup=wo.actualMin+elapsed
  let next=setOrder(s,{...o,workOrders:o.workOrders.map(w=>w.id===wo.id?withEvent({...w,actualMin:setup,setupActualMin:setup,lastStartAt:now},woEvent(ctx,'setup',{minutes:setup})):w)})
  const log=s.timeLogs.find(t=>t.workOrderId===wo.id&&!t.end)
  next={...next,timeLogs:[...(log?[{id:ctx.id('tl'),orderId,workOrderId,employeeId:log.employeeId,workCenterId:wo.workCenterId,start:now,minutes:0,hourlyRate:log.hourlyRate,kind:'run' as const}]:[]),
    ...next.timeLogs.map(t=>t.id===log?.id?{...t,end:now,minutes:minutesBetween(t.start,now),kind:'setup' as const}:t)]}
  next=logActivity(next,ctx,`Setup yakunlandi: ${wo.name}`,'Ishlab chiqarish',o.code,'info',`${setup} min`)
  return ok(next,`${wo.name}: setup ${setup} min — run vaqti boshlandi`)
}

export type OperationReportOptions={reason?:string;
  /** Why more units than reached the operation are reported (min. 3 characters); without it the excess is refused. */
  override?:string;key?:string}

/**
 * Good and scrap units of one operation (job card). Up to what reached the operation (operationInput) minus what it
 * already reported; more needs a written override and never exceeds the order quantity. Scrap at an intermediate
 * operation is booked on the order at once (material consumed, NCR); the final operation's report is the order's
 * output (backflush, finished stock, QC hold) — both through the same order actions, so nothing is posted twice.
 */
export function reportOperationOutput(s:S,ctx:Ctx,orderId:string,workOrderId:string,good:number,scrap=0,opts:OperationReportOptions={}):Outcome{
  const o=s.productionOrders.find(x=>x.id===orderId)
  const wo=o?.workOrders.find(w=>w.id===workOrderId)
  if(!o||!wo)return fail(s,'Operatsiya topilmadi')
  if(opts.key&&wo.reportKeys?.includes(opts.key))return fail(s,'Bu natija allaqachon qayd etilgan — qayta yozilmadi')
  if(!['Jarayonda','Pauzada'].includes(o.status))return fail(s,'Natija faqat jarayondagi buyurtmaga yoziladi')
  if(!['Jarayonda','Pauzada'].includes(wo.status))return fail(s,`${wo.name}: natija operatsiya boshlangandan keyin, yakunlanishidan oldin yoziladi`)
  const g=Number(good),sc=Number(scrap)
  if(!Number.isInteger(g)||!Number.isInteger(sc)||g<0||sc<0||g+sc<=0)return fail(s,'Tayyor yoki scrap miqdorini butun son bilan kiriting')
  const unit=itemUnit(s,o.productId)
  const input=operationInput(o,wo),done=(wo.goodQty||0)+(wo.scrapQty||0),allowed=Math.max(0,input-done)
  const excess=g+sc-allowed,why=(opts.override||'').trim()
  if(excess>0&&why.length<3)return fail(s,`${wo.name}: ruxsat etilgan ${allowed} ${unit} (kirgan ${input}, qayd etilgan ${done}) — ortig‘ini faqat sabab bilan tasdiqlang`)
  if(done+g+sc>o.quantity)return fail(s,`${wo.name}: jami ${done+g+sc} ${unit} buyurtma miqdori ${o.quantity} dan oshadi`)
  const reason=opts.reason?.trim()||'Operatsiya scrap'
  let next=s
  if(finalWorkOrder(o)?.id===wo.id){
    const out=reportOutput(s,ctx,o.id,g,sc,`${reason} · ${wo.name}`,opts.key?`op:${opts.key}`:undefined)
    if(!out.result.ok)return out
    next=out.state
  }else if(sc>0){
    const out=recordScrap(s,ctx,o.id,sc,`${reason} · ${wo.name}`)
    if(!out.result.ok)return out
    next=out.state
  }
  const current=next.productionOrders.find(x=>x.id===o.id)!
  const event=woEvent(ctx,'output',{good:g,scrap:sc,note:excess>0?`Ruxsatdan ortiq ${excess} ${unit}: ${why}`:undefined})
  next=setOrder(next,{...current,workOrders:current.workOrders.map(w=>w.id===wo.id?withEvent({...w,goodQty:(w.goodQty||0)+g,scrapQty:(w.scrapQty||0)+sc,reportKeys:opts.key?[...(w.reportKeys||[]),opts.key].slice(-50):w.reportKeys},event):w)})
  const message=`${wo.name}: ${g} tayyor${sc?` · ${sc} scrap`:''} qayd etildi`
  next=logActivity(next,ctx,'Operatsiya natijasi','Ishlab chiqarish',o.code,excess>0?'warning':'info',`${message}${excess>0?` · override: ${why}`:''}`)
  return ok(next,message)
}

/** Puts people on a job card. Each must be active, allowed to run production and work at that work center by scope. */
export function assignWorkOrder(s:S,ctx:Ctx,orderId:string,workOrderId:string,employeeIds:string[]):Outcome{
  const o=s.productionOrders.find(x=>x.id===orderId)
  const wo=o?.workOrders.find(w=>w.id===workOrderId)
  if(!o||!wo)return fail(s,'Operatsiya topilmadi')
  if(!isOpenOrder(o)||!isOpenWorkOrder(wo))return fail(s,`${wo.name} yopilgan — operator biriktirib bo‘lmaydi`)
  const ids=[...new Set(employeeIds.filter(Boolean))]
  for(const id of ids){
    const blocked=operatorScopeBlocker(s,s.employees.find(e=>e.id===id),wo.workCenterId)
    if(blocked)return fail(s,blocked)
  }
  const names=ids.map(id=>s.employees.find(e=>e.id===id)!.name).join(', ')||'—'
  let next=setOrder(s,{...o,workOrders:o.workOrders.map(w=>w.id===wo.id?withEvent({...w,operatorIds:ids},woEvent(ctx,'assign',{note:names})):w)})
  next=logActivity(next,ctx,`Operator biriktirildi: ${wo.name}`,'Ishlab chiqarish',o.code,'info',names)
  return ok(next,`${wo.name}: ${names}`)
}

/** Shop-floor scan: confirms that a scanned SKU / lot belongs to the order's BOM and records it. */
/**
 * Controlled over-issue (N-20): material on top of the BOM plan, e.g. to replace what scrap used up. It needs a
 * reason, comes from free stock only (never another order's reservation), is capped at the BOM plan itself and
 * is recorded on the order, in the ledger and in the activity log, so costing and audits see it.
 */
export function issueExtraMaterial(s:S,ctx:Ctx,orderId:string,materialId:string,qty:number,reason:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===orderId)
  if(!o)return fail(s,'Buyurtma topilmadi')
  if(!['Jarayonda','Pauzada'].includes(o.status))return fail(s,'Qo‘shimcha chiqim faqat jarayondagi yoki pauzadagi buyurtmaga')
  const component=o.bomSnapshot.components.find(c=>c.materialId===materialId)
  if(!component)return fail(s,'Material bu buyurtma BOM’ida yo‘q')
  const amount=q3(Number(qty)||0)
  if(amount<=0)return fail(s,'Miqdorni kiriting')
  const why=reason.trim()
  if(why.length<3)return fail(s,'Qo‘shimcha chiqim sababini yozing')
  const unit=itemUnit(s,materialId)
  const base=plannedIssue({...o,extraIssues:[]},materialId)
  const already=(o.extraIssues||[]).filter(x=>x.materialId===materialId).reduce((a,x)=>a+x.qty,0)
  if(already+amount>base+1e-6)return fail(s,`${itemName(s,materialId)}: qo‘shimcha chiqim BOM rejasidan (${base} ${unit}) oshmasin — berilgan qo‘shimcha ${q3(already)} ${unit}`)
  // Free stock only (never this or another order's reservation), from any source store of the branch.
  const planned=planDraws(s,ctx,o,materialId,amount,{own:false})
  if('error' in planned)return fail(s,planned.error)
  const applied=applyDraws(s,ctx,o,materialId,planned.draws,`Qo‘shimcha chiqim: ${why}`)
  const extra={materialId,qty:amount,reason:why,by:ctx.user?.id||'',at:stamp(ctx.now)}
  let next=setOrder(applied.state,{...o,consumed:[...o.consumed,...applied.consumed],extraIssues:[...(o.extraIssues||[]),extra]})
  next=lowStockSignals(next,ctx)
  const message=`${itemName(s,materialId)}: ${amount} ${unit} qo‘shimcha berildi`
  next=logActivity(next,ctx,'Qo‘shimcha material chiqimi','Ishlab chiqarish',o.code,'warning',`${message} · ${why}`)
  return ok(next,message)
}

export function recordMaterialScan(s:S,ctx:Ctx,orderId:string,code:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===orderId)
  if(!o)return fail(s,'Buyurtma topilmadi')
  if(!['Jarayonda','Pauzada'].includes(o.status))return fail(s,'Material issue faqat jarayondagi buyurtmada mumkin')
  const token=code.trim().toLowerCase()
  if(!token)return fail(s,'Barcode / lot kiriting')
  const component=o.bomSnapshot.components.find(c=>{const material=s.rawMaterials.find(m=>m.id===c.materialId),product=s.products.find(p=>p.id===c.materialId);return [c.materialId,material?.sku,product?.sku].some(v=>v?.toLowerCase()===token)})
    ||o.bomSnapshot.components.find(c=>s.lots.some(l=>l.itemId===c.materialId&&l.code.toLowerCase()===token))
  if(!component)return fail(s,'Bu kod BOM komponentlariga tegishli emas')
  const stores=[...orderReservations(s,o).filter(r=>r.materialId===component.materialId).map(r=>r.warehouseId),...sourcesFor(s,ctx,o,component.materialId)]
  const exactLot=s.lots.find(l=>l.itemId===component.materialId&&l.code.toLowerCase()===token&&stores.includes(l.warehouseId))||s.lots.find(l=>l.itemId===component.materialId&&l.code.toLowerCase()===token)
  if(exactLot&&!stores.includes(exactLot.warehouseId))return fail(s,`${exactLot.code} boshqa omborda`)
  if(exactLot&&['quarantine','hold','rework'].includes(exactLot.status||'available'))return fail(s,`${exactLot.code} QC/hold holatida — issue mumkin emas`)
  if(exactLot&&isExpired(exactLot,isoDate(ctx.now)))return fail(s,`${exactLot.code} yaroqlilik muddati o‘tgan (${exactLot.expiry}) — issue mumkin emas`)
  const plan=plannedIssue(o,component.materialId),left=q3(plan-issuedQty(o,component.materialId))
  if(left<=1e-6)return fail(s,`${itemName(s,component.materialId)}: BOM rejasidagi ${plan} ${itemUnit(s,component.materialId)} to‘liq berilgan — ortiqcha chiqim bloklangan`)
  // One scan issues one unit's worth; the last one only what the plan still allows.
  const issue=q3(Math.min(perUnit(component),left))
  const drawn=issueToOrder(s,ctx,o,component.materialId,issue,'Barcode/lot issue',exactLot?{code:exactLot.code,warehouseId:exactLot.warehouseId}:undefined)
  if('error' in drawn)return fail(s,drawn.error)
  if(exactLot&&drawn.remaining>1e-9)return fail(s,`${exactLot.code} qoldig‘i yetarli emas`)
  let next=setOrder(drawn.state,{...o,consumed:[...o.consumed,...drawn.consumed],reservations:drawn.reservations})
  next=lowStockSignals(next,ctx)
  next=logActivity(next,ctx,'Material issue scan','Ishlab chiqarish',o.code,'success',`${itemName(s,component.materialId)} ${issue} ${itemUnit(s,component.materialId)}${exactLot?` · ${exactLot.code}`:''}`)
  return ok(next,`${itemName(s,component.materialId)}: ${issue} ${itemUnit(s,component.materialId)} issue qilindi`)
}

export function splitProduction(s:S,ctx:Ctx,id:string,splitQty:number):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  const qty=Math.floor(Number(splitQty)||0)
  if(!o||!isOpenOrder(o))return fail(s,'Split uchun ochiq buyurtma tanlang')
  if(qty<=0||qty>=remainingQty(o))return fail(s,`Split miqdori 1–${remainingQty(o)-1} oralig‘ida bo‘lishi kerak`)
  let next=o.materialReserved?releaseFor(s,ctx,o):s
  let left=replanWorkOrders({...o,quantity:o.quantity-qty,materialReserved:false,reservations:undefined})
  left.estimatedCost=Math.round(estimateOrderCost(s,left).total)
  const childNo=s.productionOrders.filter(x=>x.parentOrderId===o.id).length+2
  // The child is a new order on the same frozen BOM: the parent's extra issues, output keys and history stay with the parent (P1-33/34).
  let child:ProductionOrder={...clone(o),id:ctx.id('mo'),code:`${o.code}-S${childNo}`,quantity:qty,completed:0,scrap:0,progress:0,status:o.status==='Material kutilmoqda'?'Qoralama':o.status==='Qoralama'?'Qoralama':'Tasdiqlangan',parentOrderId:o.id,source:`Split: ${o.code}`,actualCost:0,materialReserved:false,reservations:undefined,createdAt:stamp(ctx.now),startedAt:undefined,completedAt:undefined,workOrders:buildWorkOrders(o.bomSnapshot,qty,ctx),consumed:[],lot:undefined,serialRange:undefined,qcHeld:0,qualityStatus:'Pending',outputKeys:undefined,costSnapshot:undefined,extraIssues:undefined}
  child.estimatedCost=Math.round(estimateOrderCost(s,child).total)
  // Both sides keep a trace of the split on their job cards; the parent's time and quantities stay where they are.
  child={...child,workOrders:child.workOrders.map(w=>withEvent(w,woEvent(ctx,'split',{note:`${o.code} dan ajratildi`})))}
  left={...left,workOrders:left.workOrders.map(w=>isOpenWorkOrder(w)?withEvent(w,woEvent(ctx,'split',{note:`${qty} → ${child.code}`})):w)}
  if(o.materialReserved){
    const a=tryReserve(next,ctx,left);next=a.state;left=a.order
    // The parent only gives stock back; if it cannot hold its smaller need again the data is inconsistent — change nothing.
    if(!a.reserved)return fail(s,`${o.code}: qolgan miqdor uchun rezervni qayta tiklab bo‘lmadi — split bajarilmadi`)
    const b=tryReserve(next,ctx,child);next=b.state;child=b.order
    if(!b.reserved)child={...child,status:'Material kutilmoqda'}
  }
  next={...setOrder(next,{...left,progress:progressOf(left)}),productionOrders:[child,...next.productionOrders.map(x=>x.id===left.id?{...left,progress:progressOf(left)}:x)]}
  // A make-to-order child serves the same sales order: the SO lists it too (N-24).
  if(child.salesOrderId)next={...next,salesOrders:next.salesOrders.map(so=>{
    if(so.id!==child.salesOrderId)return so
    const ids=so.productionOrderIds?.length?so.productionOrderIds:so.productionOrderId?[so.productionOrderId]:[]
    return {...so,productionOrderIds:[...ids,child.id]}
  })}
  const message=`${o.code} split qilindi: ${left.quantity} + ${qty}`
  return ok(logActivity(next,ctx,'Production Order split','Ishlab chiqarish',o.code,'info',message),message,child.id)
}

export function mergeProduction(s:S,ctx:Ctx,ids:string[]):Outcome{
  const unique=[...new Set(ids)]
  const orders=unique.map(id=>s.productionOrders.find(o=>o.id===id)).filter(Boolean) as ProductionOrder[]
  if(orders.length<2)return fail(s,'Kamida 2 ta MO tanlang')
  const first=orders[0]
  if(orders.some(o=>o.productId!==first.productId||o.bomId!==first.bomId||o.completed+o.scrap>0||!['Qoralama','Tasdiqlangan','Material kutilmoqda'].includes(o.status)))return fail(s,'Faqat bir xil mahsulot/BOM va boshlanmagan MOlarni birlashtirish mumkin')
  // One merged order can serve one sales order only; merging two would orphan the other SO (N-04).
  if(new Set(orders.map(o=>o.salesOrderId||'')).size>1)return fail(s,'Turli sotuv buyurtmalariga (yoki SO’siz MO bilan) bog‘langan MOlarni birlashtirib bo‘lmaydi')
  if(orders.some(o=>o.reworkOf))return fail(s,'Rework MOlarini birlashtirib bo‘lmaydi')
  // The merged order keeps one frozen BOM, so every order must carry the same snapshot (P1-19/33).
  const recipe=(o:ProductionOrder)=>JSON.stringify([o.bomVersion,o.bomSnapshot.components,o.bomSnapshot.operations,o.bomSnapshot.byProducts||[]])
  if(orders.some(o=>recipe(o)!==recipe(first)))return fail(s,'MOlar BOMning turli versiyasi (snapshot) bilan ochilgan — birlashtirib bo‘lmaydi')
  let next=s
  for(const o of orders)if(o.materialReserved)next=releaseFor(next,ctx,o)
  const total=orders.reduce((a,o)=>a+o.quantity,0)
  let merged:ProductionOrder={...clone(first),id:ctx.id('mo'),code:nextCode(s.productionOrders.map(o=>o.code),'MO',ctx.now),quantity:total,completed:0,scrap:0,progress:0,status:'Qoralama',materialReserved:false,reservations:undefined,actualCost:0,source:`Merge: ${orders.map(o=>o.code).join(', ')}`,createdAt:stamp(ctx.now),startedAt:undefined,parentOrderId:undefined,backorderOf:undefined,extraIssues:undefined,outputKeys:undefined,costSnapshot:undefined,qcHeld:0,qualityStatus:'Pending',lot:undefined,serialRange:undefined,due:orders.map(o=>o.due).sort()[0],priority:orders.some(o=>o.priority==='Kritik')?'Kritik':orders.some(o=>o.priority==='Yuqori')?'Yuqori':first.priority,workOrders:buildWorkOrders(first.bomSnapshot,total,ctx),consumed:[]}
  merged.estimatedCost=Math.round(estimateOrderCost(s,merged).total)
  if(orders.some(o=>o.materialReserved)){
    const r=tryReserve(next,ctx,merged);next=r.state;merged={...r.order,status:r.reserved?'Tasdiqlangan':'Material kutilmoqda'}
  }
  next={...next,productionOrders:[merged,...next.productionOrders.map(o=>unique.includes(o.id)?{...o,status:'Bekor qilingan' as const,materialReserved:false,reservations:undefined,source:`Merged → ${merged.code}`,
    workOrders:o.workOrders.map(w=>isOpenWorkOrder(w)?withEvent({...w,status:'Bekor qilingan' as const},woEvent(ctx,'cancel',{note:`Merge → ${merged.code}`})):w)}:o)]}
  // The sales order now follows the merged order instead of the cancelled ones (N-04).
  if(merged.salesOrderId)next={...next,salesOrders:next.salesOrders.map(so=>{
    if(so.id!==merged.salesOrderId)return so
    const ids=(so.productionOrderIds?.length?so.productionOrderIds:so.productionOrderId?[so.productionOrderId]:[]).filter(x=>!unique.includes(x))
    return {...so,productionOrderId:so.productionOrderId&&unique.includes(so.productionOrderId)?merged.id:so.productionOrderId,productionOrderIds:[...ids,merged.id]}
  })}
  const message=`${orders.length} ta MO ${merged.code} ga birlashtirildi`
  return ok(logActivity(next,ctx,'Production Order merge','Ishlab chiqarish',merged.code,'info',message),message,merged.id)
}

export function createBackorder(s:S,ctx:Ctx,id:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  const remaining=remainingQty(o)
  if(o.completed<=0)return fail(s,'Backorder uchun avval tayyor natija qayd eting')
  if(remaining<=0)return fail(s,'Qolgan miqdor yo‘q')
  if(!['Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status))return fail(s,'Backorder faqat jarayondagi buyurtma uchun')
  const unfinished=o.workOrders.filter(w=>w.status!=='Yakunlangan')
  if(unfinished.length)return fail(s,`Backorderdan oldin operatsiyalarni yakunlang: ${unfinished.map(w=>w.name).join(', ')}`)
  let next=o.materialReserved?releaseFor(s,ctx,o):s
  const original:ProductionOrder={...o,quantity:o.completed+o.scrap,materialReserved:false,reservations:undefined,status:'Sifat nazoratida'}
  const codes=new Set(s.productionOrders.map(x=>x.code))
  let code=`${o.code}-BO`
  for(let n=2;codes.has(code);n+=1)code=`${o.code}-BO${n}`
  const back:ProductionOrder={...clone(o),id:ctx.id('mo'),code,quantity:remaining,completed:0,scrap:0,progress:0,status:'Qoralama',materialReserved:false,reservations:undefined,backorderOf:o.id,source:`Backorder: ${o.code}`,actualCost:0,createdAt:stamp(ctx.now),startedAt:undefined,completedAt:undefined,workOrders:buildWorkOrders(o.bomSnapshot,remaining,ctx),consumed:[],lot:undefined,serialRange:undefined,qualityStatus:'Pending',qcHeld:0,extraIssues:undefined,outputKeys:undefined,costSnapshot:undefined}
  back.estimatedCost=Math.round(estimateOrderCost(s,back).total)
  next={...next,productionOrders:[back,...next.productionOrders.map(x=>x.id===o.id?{...original,progress:progressOf(original)}:x)]}
  // A make-to-order backorder still serves the sales order, which keeps waiting for it (P1-25).
  if(back.salesOrderId)next={...next,salesOrders:next.salesOrders.map(so=>{
    if(so.id!==back.salesOrderId)return so
    const ids=so.productionOrderIds?.length?so.productionOrderIds:so.productionOrderId?[so.productionOrderId]:[]
    return {...so,productionOrderIds:[...ids.filter(x=>x!==back.id),back.id]}
  })}
  next=ensureFinalCheck(next,ctx,original)
  const message=`${back.code} · ${remaining} ${itemUnit(s,o.productId)} backorder yaratildi; ${o.code} sifat nazoratiga yuborildi`
  return ok(logActivity(next,ctx,'Production backorder','Ishlab chiqarish',back.code,'warning',message),message,back.id)
}

export type UnbuildLine={materialId:string;qty:number}
/**
 * Material content of finished units that are taken apart (N-19/B3-15). Each lot is traced to the MO that made it:
 * that MO's BOM snapshot (not today's BOM), limited to what the MO really consumed per unit made; a lot without an
 * MO falls back to the active BOM. Only the net BOM quantity counts — process waste is not inside the product.
 */
export function unbuildContent(s:S,productId:string,allocations:{lot?:string;qty:number}[]):{lines:UnbuildLine[];basis:string[]}{
  const totals=new Map<string,number>(),basis=new Set<string>()
  const active=activeBomFor(s,productId)
  for(const a of allocations){
    const lot=a.lot?lotOrigin(s,a.lot,productId):undefined
    const mo=lot?.sourceType==='production'?s.productionOrders.find(o=>o.id===lot.sourceId):undefined
    let perUnit:UnbuildLine[]=[]
    if(mo){
      const made=mo.completed+mo.scrap
      const used=new Map<string,number>()
      for(const c of mo.consumed)used.set(c.materialId,(used.get(c.materialId)||0)+c.qty)
      const fromBom=mo.bomSnapshot.components.map(c=>({materialId:c.materialId,qty:made>0&&used.size?Math.min(c.qty,(used.get(c.materialId)||0)/made):c.qty}))
      // A substitute that the MO consumed but the BOM did not list is in the product too.
      const extra=made>0?[...used].filter(([id])=>!mo.bomSnapshot.components.some(c=>c.materialId===id)).map(([materialId,q])=>({materialId,qty:q/made})):[]
      perUnit=[...fromBom,...extra]
      basis.add(`${mo.code} · BOM ${mo.bomVersion}${made>0&&used.size?' · haqiqiy sarf':''}`)
    }else if(active){
      perUnit=active.components.map(c=>({materialId:c.materialId,qty:c.qty}))
      basis.add(`Faol BOM ${active.version}`)
    }
    for(const p of perUnit)totals.set(p.materialId,(totals.get(p.materialId)||0)+p.qty*a.qty)
  }
  return {lines:[...totals].map(([materialId,qty])=>({materialId,qty:q3(qty)})).filter(l=>l.qty>0),basis:[...basis]}
}

/** What an unbuild of `qty` units would take and return, without changing anything (for the dialog). */
export function unbuildPreview(s:S,productId:string,qty:number,recoveryPct=100){
  const amount=Math.floor(Number(qty)||0)
  const fg=unbuildSource(s,productId)
  if(!fg||amount<=0)return {warehouseId:fg?.warehouseId,lines:[] as UnbuildLine[],basis:[] as string[]}
  const taken=takeLots(s,productId,amount,'preview',fg.warehouseId)
  const content=unbuildContent(s,productId,[...taken.allocations,...(taken.remaining>0?[{qty:taken.remaining}]:[])])
  return {warehouseId:fg.warehouseId,basis:content.basis,lines:content.lines.map(l=>({...l,qty:q3(l.qty*recoveryPct/100)}))}
}

/** Takes finished units apart; `recoveryPct` is the share of their material content that comes back usable. */
export function unbuildProduct(s:S,ctx:Ctx,productId:string,qty:number,recoveryPct=100):Outcome{
  const amount=Math.floor(Number(qty)||0)
  const pct=Number(recoveryPct)
  if(!Number.isFinite(pct)||pct<0||pct>100)return fail(s,'Qayta tiklash ulushi 0–100% bo‘lsin')
  const product=s.products.find(p=>p.id===productId)
  if(!product)return fail(s,'Mahsulot topilmadi')
  if(amount<=0)return fail(s,'Miqdorni kiriting')
  const fg=unbuildSource(s,productId)
  if(!fg||fg.onHand-fg.reserved-(fg.quarantine||0)<amount)return fail(s,`Available tayyor mahsulot yetarli emas (${Math.floor(fg?fg.onHand-fg.reserved-(fg.quarantine||0):0)})`)
  const source=nextRef(s,'UNB',ctx.now)
  let next=changeBalance(s,ctx,fg.warehouseId,productId,{onHand:-amount})
  const taken=takeLots(next,productId,amount,source,fg.warehouseId);next=taken.state
  for(const a of taken.allocations)next=addMove(next,ctx,{type:'Unbuild -',itemId:productId,itemType:'finished',warehouseId:fg.warehouseId,qty:-a.qty,source,note:'Unbuild / disassembly',lot:a.lot})
  const rawWh=rawWarehouseFor(s,fg.warehouseId)
  const content=unbuildContent(s,productId,[...taken.allocations,...(taken.remaining>0?[{qty:taken.remaining}]:[])])
  if(!content.lines.length)return fail(s,`${product.name}: tarkibi aniqlanmadi — lot MO’ga bog‘lanmagan va faol BOM yo‘q`)
  for(const c of content.lines){
    const recovered=q3(c.qty*pct/100)
    if(recovered<=0)continue
    const wh=isProductItem(s,c.materialId)?fg.warehouseId:rawWh
    next=changeBalance(next,ctx,wh,c.materialId,{onHand:recovered})
    next=addMove(next,ctx,{type:'Return +',itemId:c.materialId,itemType:isProductItem(s,c.materialId)?'finished':'raw',warehouseId:wh,qty:recovered,source,note:`Disassembly · ${pct}% · ${content.basis.join('; ')}`})
  }
  next=retryWaitingOrders(next,ctx)
  const message=`${product.name}: ${amount} ${product.unit} disassembly qilindi`
  return ok(logActivity(next,ctx,'Unbuild / disassembly','Ishlab chiqarish',source,'warning',message),message)
}

export function createReworkOrder(s:S,ctx:Ctx,sourceOrderId:string,qty:number,reason:string):Outcome{
  const o=s.productionOrders.find(x=>x.id===sourceOrderId)
  if(!o)return fail(s,'Manba buyurtma topilmadi')
  const amount=Math.floor(Number(qty)||0)
  if(amount<=0)return fail(s,'Rework miqdorini kiriting')
  // Only units that exist and have not been reworked already can be reworked (N-06).
  const alreadyReworked=s.productionOrders.filter(r=>r.reworkOf===o.id&&r.status!=='Bekor qilingan').reduce((a,r)=>a+r.quantity,0)
  const reworkable=Math.max(0,o.completed-alreadyReworked)
  if(amount>reworkable)return fail(s,`Rework miqdori ${reworkable} ${itemUnit(s,o.productId)} dan oshmasligi kerak (tayyor ${o.completed}, rework’da ${alreadyReworked})`)
  const created=createProductionOrder(s,ctx,{productId:o.productId,quantity:amount,lineId:o.lineId,warehouseId:o.warehouseId,priority:'Yuqori',source:`Rework: ${o.code} · ${reason}`,reworkOf:o.id,responsibleId:o.responsibleId})
  if(!created.result.ok)return created
  let next={...created.state,productionOrders:created.state.productionOrders.map(x=>x.id===o.id&&x.qualityStatus==='Failed'?{...x,qualityStatus:'Rework'}:x)}
  next=logActivity(next,ctx,'Rework buyurtmasi yaratildi','Sifat',o.code,'warning',reason)
  return ok(next,`Rework MO yaratildi (${amount} ${itemUnit(s,o.productId)})`,created.result.id)
}

/* ------------------------------------------------------------ quality -- */

export function createQualityCheck(s:S,ctx:Ctx,payload:Partial<QualityCheck>):Outcome{
  if(!payload.sourceId||!payload.itemId)return fail(s,'Manba va item tanlanishi shart')
  const sourceType=payload.sourceType||'production'
  // Customer returns are inspected through their own disposition (N-05).
  if(sourceType==='return')return fail(s,'Mijoz qaytarishi Sotuv → Qaytarishlar bo‘limida qaror bilan tekshiriladi')
  if(sourceType==='production'&&payload.type==='Final'){
    const mo=s.productionOrders.find(o=>o.id===payload.sourceId)
    if(!mo||!isOpenOrder(mo))return fail(s,'Final tekshiruv faqat ochiq ishlab chiqarish buyurtmasi uchun yaratiladi')
    // A Final check inspects reported output; with nothing produced it could only pass units that do not exist yet (N-01).
    if(mo.completed<=0)return fail(s,`${mo.code}: hali tayyor natija yo‘q — Final tekshiruv natija qayd etilgandan keyin`)
    if(s.qualityChecks.some(q=>q.sourceId===mo.id&&q.type==='Final'&&q.status==='Pending'))return fail(s,`${mo.code} uchun kutilayotgan Final tekshiruv allaqachon bor`)
  }
  if(sourceType==='purchase'){
    // An incoming check decides about one receipt; without it the result would land on whichever receipt matches first (B3-03).
    const po=s.purchaseOrders.find(p=>p.id===payload.sourceId)
    const receipt=po?.receipts.find(r=>r.id===payload.receiptId)
    if(!receipt||receipt.materialId!==payload.itemId)return fail(s,'Kirish tekshiruvi uchun aniq qabul (receipt) tanlang')
    if(s.qualityChecks.some(q=>q.receiptId===receipt.id&&q.sourceType==='purchase'))return fail(s,'Bu qabul uchun tekshiruv allaqachon mavjud')
  }
  // A re-inspection of one operation names its work order, so the newest result of that operation decides its gate.
  if(payload.workOrderId&&!s.productionOrders.find(o=>o.id===payload.sourceId)?.workOrders.some(w=>w.id===payload.workOrderId))return fail(s,'Operatsiya bu buyurtmaga tegishli emas')
  const id=ctx.id('qc')
  const row:QualityCheck={id,type:payload.type||'Jarayon',sourceType,sourceId:payload.sourceId,itemId:payload.itemId,status:'Pending',inspectorId:payload.inspectorId||ctx.user.id,date:stamp(ctx.now),controlPointId:payload.controlPointId,lot:payload.lot,reason:payload.reason,receiptId:payload.receiptId,workOrderId:payload.workOrderId}
  const next=logActivity({...s,qualityChecks:[row,...s.qualityChecks]},ctx,'Quality check yaratdi','Sifat',sourceLabel(s,row.sourceId))
  return ok(next,'Quality check yaratildi',id)
}

/**
 * Records an inspection decision. An in-process Scrap with `qty` scraps those units on the order (material consumed,
 * scrap counted, NCR opened) and moves them from the inspected operation's good to its scrap count.
 */
export function resolveQuality(s:S,ctx:Ctx,id:string,status:QualityCheck['status'],reason='',measured='',qty?:number):Outcome{
  const q=s.qualityChecks.find(x=>x.id===id)
  if(!q)return fail(s,'Tekshiruv topilmadi')
  if(status==='Pending')return fail(s,'Natijani tanlang')
  // A decision is final: re-deciding would move stock a second time (BUG-05b). Re-inspection is a new check.
  if(q.status!=='Pending')return fail(s,`Bu tekshiruv allaqachon hal qilingan (${q.status}) — qayta tekshiruv uchun yangi tekshiruv yarating`)
  if(q.sourceType==='return')return fail(s,'Mijoz qaytarishi Sotuv → Qaytarishlar bo‘limida qaror bilan yopiladi')
  if(status!=='Passed'&&!reason.trim())return fail(s,'Failed / Rework / Scrap uchun sabab yozilishi shart')
  if(q.sourceType==='production'&&q.type==='Final'){
    const mo=s.productionOrders.find(o=>o.id===q.sourceId)
    // Nothing produced yet: a pass would clear units that do not exist and skip inspecting the real output (N-01).
    if(mo&&mo.completed<=0)return fail(s,`${mo.code}: tekshiriladigan tayyor natija yo‘q`)
  }
  let next:S={...s,qualityChecks:s.qualityChecks.map(x=>x.id===id?{...x,status,reason:reason||x.reason,measured:measured||x.measured,inspectorId:ctx.user.id,date:stamp(ctx.now)}:x)}
  if(q.sourceType==='production'&&q.type==='Final'&&status==='Scrap'){
    // A Final scrap decision removes the order's held units from stock as scrap, so they can never be released later (N-02).
    const mo=next.productionOrders.find(o=>o.id===q.sourceId)
    if(mo){
      const hold=orderQcHold(s,s.productionOrders.find(o=>o.id===mo.id)!)
      const balance=next.stockBalances.find(b=>b.warehouseId===mo.warehouseId&&b.itemId===mo.productId)
      const amount=q3(Math.min(hold,balance?.quarantine||0,balance?.onHand||0))
      if(amount>0){
        next=changeBalance(next,ctx,mo.warehouseId,mo.productId,{onHand:-amount,quarantine:-amount})
        let left=amount
        const ret=s.returns.find(x=>x.reworkOrderId===mo.id)
        next={...next,lots:next.lots.map(l=>{
          const held=(l.sourceType==='production'&&l.sourceId===mo.id&&l.status==='quarantine')||(Boolean(ret)&&l.sourceType==='return'&&l.sourceId===ret?.id&&l.status==='rework')
          if(left<=1e-9||!held)return l
          const take=Math.min(left,l.qty);left=q3(left-take)
          return {...l,qty:q3(l.qty-take),status:l.qty-take>1e-9?l.status:'hold' as const}
        })}
        next=addMove(next,ctx,{type:'QC Scrap -',itemId:mo.productId,itemType:'finished',warehouseId:mo.warehouseId,qty:-amount,source:mo.code,note:reason||'Final QC scrap',lot:mo.lot})
      }
      const moved=Math.min(amount,mo.completed)
      next=setOrder(next,{...mo,completed:mo.completed-moved,scrap:mo.scrap+moved,qcHeld:Math.max(0,hold-amount)})
    }
  }
  let scrappedNow=false
  if(q.sourceType==='production'&&q.type!=='Final'&&status==='Scrap'&&qty!==undefined&&qty!==null&&String(qty)!==''){
    const amount=Number(qty)
    if(!Number.isInteger(amount)||amount<=0)return fail(s,'Scrap miqdori musbat butun son bo‘lsin')
    const scrapped=recordScrap(next,ctx,q.sourceId,amount,`In-process QC: ${reason}`)
    if(!scrapped.result.ok)return fail(s,scrapped.result.message)
    next=scrapped.state;scrappedNow=true
    if(q.workOrderId)next={...next,productionOrders:next.productionOrders.map(o=>o.id!==q.sourceId?o:{...o,workOrders:o.workOrders.map(w=>w.id===q.workOrderId&&w.goodQty!==undefined?{...w,goodQty:Math.max(0,w.goodQty-amount),scrapQty:(w.scrapQty||0)+amount}:w)})}
  }
  if(q.sourceType==='production'){
    next={...next,productionOrders:next.productionOrders.map(o=>{
      if(o.id!==q.sourceId)return o
      if(status!=='Passed')return {...o,qualityStatus:status}
      if(q.type==='Final')return {...o,qualityStatus:'Passed'}
      // A passed re-inspection lifts an earlier in-process hold; final release still needs a Final check.
      return ['Failed','Rework','Hold'].includes(o.qualityStatus)?{...o,qualityStatus:'Pending'}:o
    })}
    if(q.type==='Final'&&status==='Passed'){
      const mo=next.productionOrders.find(o=>o.id===q.sourceId)
      if(mo){
        // Only this order's own Final QC hold is released, never other orders' units sharing the warehouse balance.
        // Read from the state before this result, so an order saved before holds were stored still derives its hold.
        const hold=orderQcHold(s,s.productionOrders.find(o=>o.id===mo.id)!)
        const balance=next.stockBalances.find(b=>b.warehouseId===mo.warehouseId&&b.itemId===mo.productId)
        const release=Math.min(hold,balance?.quarantine||0)
        if(release>0)next=changeBalance(next,ctx,mo.warehouseId,mo.productId,{quarantine:-release})
        next=setOrder(next,{...mo,qcHeld:0})
        next={...next,lots:next.lots.map(l=>l.sourceType==='production'&&l.sourceId===mo.id?{...l,status:'available' as const}:l)}
        // A customer-return rework that passed puts the returned lot back into service (BUG-18).
        const ret=s.returns.find(x=>x.reworkOrderId===mo.id)
        if(ret)next={...next,lots:next.lots.map(l=>l.itemId===mo.productId&&l.status==='rework'&&(l.sourceType==='return'?l.sourceId===ret.id:Boolean(ret.lot)&&l.code===ret.lot)?{...l,status:'available' as const}:l)}
      }
    }
  }
  if(q.sourceType==='subcontract'){
    // A subcontract receipt is accepted into stock or written off as a whole (N-07).
    const sc=s.subcontractOrders.find(o=>o.id===q.sourceId)
    if(!sc)return fail(s,'Subcontract order topilmadi')
    if(status!=='Passed'&&status!=='Scrap')return fail(s,'Subcontract qabuli: Passed (omborga) yoki Scrap (hisobdan chiqarish) — nuqsonli partiyani Scrap qiling')
    const wh=sc.warehouseId||finishedWarehouseFor(s,s.settings.defaultLineId)
    const balance=next.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===sc.productId)
    const amount=q3(Math.min(sc.qcHeld??sc.qty,balance?.quarantine||0))
    if(status==='Passed'){
      if(amount>0)next=changeBalance(next,ctx,wh,sc.productId,{quarantine:-amount})
      next={...next,lots:next.lots.map(l=>l.sourceId===sc.id&&l.itemId===sc.productId&&l.status==='quarantine'?{...l,status:'available' as const}:l)}
      next=retryWaitingOrders(next,ctx)
    }else{
      if(amount>0){
        next=changeBalance(next,ctx,wh,sc.productId,{onHand:-amount,quarantine:-amount})
        next=addMove(next,ctx,{type:'QC Scrap -',itemId:sc.productId,itemType:'finished',warehouseId:wh,qty:-amount,source:sc.code,note:reason||'Subcontract QC scrap'})
      }
      next={...next,lots:next.lots.map(l=>l.sourceId===sc.id&&l.itemId===sc.productId?{...l,qty:0,status:'hold' as const}:l)}
    }
    next={...next,subcontractOrders:next.subcontractOrders.map(o=>o.id===sc.id?{...o,qcHeld:0}:o)}
  }
  if(q.sourceType==='purchase'){
    const po=next.purchaseOrders.find(p=>p.id===q.sourceId)
    // Checks saved before they carried a receipt id are matched only when exactly one receipt fits (B3-03).
    const legacy=po?.receipts.filter(r=>r.materialId===q.itemId&&(!q.lot||r.lot===q.lot))||[]
    const receipt=q.receiptId?po?.receipts.find(r=>r.id===q.receiptId):legacy.length===1?legacy[0]:undefined
    if(po&&!receipt&&(status==='Passed'||status==='Scrap'))return fail(s,'Tekshiruv qaysi qabulga tegishli ekani aniq emas — natija qayd etilmadi')
    if(po&&receipt&&(status==='Passed'||status==='Scrap')&&s.qualityChecks.some(x=>x.id!==q.id&&x.sourceType==='purchase'&&x.sourceId===po.id&&x.receiptId===receipt.id&&['Passed','Scrap'].includes(x.status)))return fail(s,'Bu qabul bo‘yicha qaror allaqachon qayd etilgan')
    if(po&&receipt){
      const qty=receipt.qty,wh=receipt.warehouseId||po.warehouseId
      const held=s.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===q.itemId)
      const unit=itemUnit(s,q.itemId)
      if((status==='Passed'||status==='Scrap')&&(held?.quarantine||0)<qty-1e-6)return fail(s,`${itemName(s,q.itemId)}: karantinda ${q3(held?.quarantine||0)} ${unit} bor, bu qabul ${qty} ${unit} — natija qayd etilmadi`)
      if(status==='Scrap'&&(held?.onHand||0)<qty-1e-6)return fail(s,`${itemName(s,q.itemId)}: omborda ${q3(held?.onHand||0)} ${unit} bor, ${qty} ${unit} scrap qilib bo‘lmaydi — avval qoldiqni tekshiring`)
      if(status==='Passed'){
        next=changeBalance(next,ctx,wh,q.itemId,{quarantine:-qty})
        if(q.lot)next={...next,lots:next.lots.map(l=>l.code===q.lot&&l.itemId===q.itemId?{...l,status:'available' as const}:l)}
        next=suggestReservations(retryWaitingOrders(next,ctx),ctx,po)
      }else if(status==='Scrap'){
        next=changeBalance(next,ctx,wh,q.itemId,{onHand:-qty,quarantine:-qty})
        if(q.lot)next={...next,lots:next.lots.map(l=>l.code===q.lot&&l.itemId===q.itemId?{...l,qty:0,status:'hold' as const}:l)}
        next=addMove(next,ctx,{type:'QC Scrap -',itemId:q.itemId,itemType:'raw',warehouseId:wh,qty:-qty,source:po.code,note:reason||'Incoming QC scrap',lot:q.lot})
      }else if(q.lot){
        next={...next,lots:next.lots.map(l=>l.code===q.lot&&l.itemId===q.itemId?{...l,status:status==='Rework'?'rework' as const:'hold' as const}:l)}
      }
      // The receipt records the split: everything accepted, or everything rejected (kept in quarantine until returned or scrapped).
      const decided=status==='Passed'?{inspection:'accepted' as const,accepted:qty,rejected:0}:{inspection:'rejected' as const,accepted:0,rejected:qty,...(status==='Scrap'?{scrapped:qty}:{})}
      next=setReceipt(next,po.id,receipt.id,decided)
      next={...next,qualityChecks:next.qualityChecks.map(x=>x.id===id?{...x,acceptedQty:decided.accepted,rejectedQty:decided.rejected}:x)}
    }
  }
  // The scrap posting above already opened its NCR; one event, one NCR.
  if((status==='Failed'||status==='Scrap')&&!scrappedNow){
    const label=sourceLabel(next,q.sourceId)
    next={...next,qualityAlerts:[{id:ctx.id('qa'),title:`${label} — ${status==='Scrap'?'scrap qarori':'sifat muammosi'}`,sourceId:q.sourceId,severity:'Yuqori',status:'Ochiq',reason:reason||'Quality check failed',ownerId:ctx.user.id,createdAt:stamp(ctx.now)},...next.qualityAlerts]}
    next=notify(next,ctx,'quality','Quality failure',`${label} bo‘yicha ${q.type.toLowerCase()} tekshiruvi: ${status}. ${reason}`,'danger',`/quality?view=checks&status=${status}`)
  }
  next=logActivity(next,ctx,`Quality → ${status}`,'Sifat',sourceLabel(s,q.sourceId),status==='Passed'?'success':status==='Failed'?'danger':'warning',reason)
  return ok(next,`Quality: ${status}`)
}

export function sourceLabel(s:S,id:string){
  return s.productionOrders.find(x=>x.id===id)?.code||s.purchaseOrders.find(x=>x.id===id)?.code||s.subcontractOrders.find(x=>x.id===id)?.code||s.returns.find(x=>x.id===id)?.code||s.salesOrders.find(x=>x.id===id)?.code||id
}

export function createQualityAlert(s:S,ctx:Ctx,payload:{title:string;sourceId:string;severity:'Past'|'O‘rta'|'Yuqori';reason:string;ownerId?:string}):Outcome{
  if(!payload.title.trim()||!payload.reason.trim())return fail(s,'Sarlavha va sabab majburiy')
  const id=ctx.id('qa')
  const next=logActivity({...s,qualityAlerts:[{id,title:payload.title.trim(),sourceId:payload.sourceId,severity:payload.severity,status:'Ochiq',reason:payload.reason.trim(),ownerId:payload.ownerId||ctx.user.id,createdAt:stamp(ctx.now)},...s.qualityAlerts]},ctx,'NCR ochildi','Sifat',sourceLabel(s,payload.sourceId),'warning',payload.title)
  return ok(next,'NCR / Quality Alert ochildi',id)
}

/* ---------------------------------------------------------- purchasing -- */

/** `qty` in material stock units; `price` in UZS per stock unit (defaults to the supplier link's price). */
export type PurchaseLineInput={materialId:string;qty:number;price?:number}
export type PurchasePayload={supplierId:string;lines?:PurchaseLineInput[];materialId?:string;qty?:number;price?:number;warehouseId?:string;expectedDate?:string;status?:'Qoralama'|'Tasdiqlangan';source?:string;productionOrderIds?:string[];allowBelowMoq?:boolean}

/** Lines of a PO checked against the supplier ↔ material links: linked, orderable, whole purchase units, MOQ. */
function purchaseLines(s:S,supplierId:string,inputs:PurchaseLineInput[],allowBelowMoq=false):{lines:PurchaseLine[]}|{error:string}{
  const supplier=s.suppliers.find(x=>x.id===supplierId)
  if(!supplier)return {error:'Supplier tanlanmagan'}
  const lines:PurchaseLine[]=[]
  for(const input of inputs){
    const qty=q3(Math.max(0,Number(input.qty)||0))
    if(!input.materialId||qty<=0)continue
    const name=itemName(s,input.materialId)
    if(lines.some(l=>l.materialId===input.materialId))return {error:`${name} ikki qatorda — miqdorni bitta qatorga jamlang`}
    const link=findLink(s,supplierId,input.materialId)
    if(!link)return {error:`${name}: ${supplier.name} bu materialning yetkazib beruvchisi sifatida biriktirilmagan`}
    const blocked=linkBlock(s,link)
    if(blocked)return {error:`${name} · ${supplier.name}: ${blocked}`}
    const purchaseQty=qty/link.unitFactor
    if(link.unitFactor!==1&&Math.abs(purchaseQty-Math.round(purchaseQty))>1e-6)return {error:`${name}: miqdor butun ${link.purchaseUnit} bo‘lsin (1 ${link.purchaseUnit} = ${link.unitFactor} ${itemUnit(s,input.materialId)})`}
    if(link.moq>0&&purchaseQty<link.moq-1e-9&&!allowBelowMoq)return {error:`${name}: MOQ ${link.moq} ${link.purchaseUnit}, buyurtma ${q3(purchaseQty)} ${link.purchaseUnit}`}
    const price=input.price!==undefined&&input.price!==null&&String(input.price)!==''?Math.max(0,Number(input.price)||0):Math.round(linkUnitCost(link)*100)/100
    lines.push({materialId:input.materialId,qty,received:0,price,linkId:link.id,purchaseUnit:link.purchaseUnit,unitFactor:link.unitFactor,currency:link.currency,unitPrice:q3(price*link.unitFactor/(CURRENCIES[link.currency]?.rate||1))})
  }
  if(!lines.length)return {error:'Kamida bitta material va miqdor kiriting'}
  return {lines}
}

/** A confirmed PO is a purchase: it becomes the link's "last purchase" price and date. */
function recordLastPurchase(s:S,po:PurchaseOrder):S{
  return {...s,supplierMaterials:s.supplierMaterials.map(l=>{
    const line=po.items.find(i=>i.linkId===l.id||(l.supplierId===po.supplierId&&i.materialId===l.materialId))
    return line&&l.supplierId===po.supplierId?{...l,lastPrice:line.price,lastPurchaseDate:po.createdAt.slice(0,10),lastPurchaseOrderId:po.id}:l
  })}
}

/** Separation of duties (A-M6): from this amount on, a PO is approved by someone other than the person who created it. */
export function needsSecondApprover(s:S,total:number){
  const p=s.settings.policies
  return p.poDualApproval===true&&total>=(p.poDualApprovalFrom??0)
}

export function createPurchaseOrder(s:S,ctx:Ctx,p:PurchasePayload):Outcome{
  const supplier=s.suppliers.find(x=>x.id===p.supplierId)
  if(!supplier)return fail(s,'Supplier tanlanmagan')
  const built=purchaseLines(s,supplier.id,p.lines||(p.materialId?[{materialId:p.materialId,qty:p.qty||0,price:p.price}]:[]),p.allowBelowMoq)
  if('error' in built)return fail(s,built.error)
  const lines=built.lines
  const warehouseId=p.warehouseId||rawWarehouseFor(s,s.settings.defaultWarehouseId||finishedWarehouseFor(s,s.settings.defaultLineId))
  const wh=s.warehouses.find(w=>w.id===warehouseId)
  if(!wh||wh.status!=='Faol'||!['Raw','Mixed'].includes(wh.type))return fail(s,'Xomashyo uchun faol Raw yoki Mixed ombor tanlang')
  const orderIds=[...new Set((p.productionOrderIds||[]).filter(x=>s.productionOrders.some(o=>o.id===x)))]
  const id=ctx.id('po'),code=nextCode(s.purchaseOrders.map(x=>x.code),'PO',ctx.now)
  const status=p.status||'Tasdiqlangan'
  const lead=Math.max(0,...lines.map(l=>s.supplierMaterials.find(x=>x.id===l.linkId)?.leadTime??supplier.leadTime??4))
  const total=Math.round(lines.reduce((a,l)=>a+l.qty*l.price,0))
  if(status==='Tasdiqlangan'&&needsSecondApprover(s,total))return fail(s,`PO summasi ikki kishilik tasdiq chegarasidan yuqori — qoralama sifatida saqlang, uni boshqa xodim tasdiqlaydi`)
  const row:PurchaseOrder={id,code,supplierId:supplier.id,warehouseId,status,items:lines,total,invoiceStatus:'Kutilmoqda',paymentStatus:'To‘lanmagan',expectedDate:p.expectedDate||addDays(isoDate(ctx.now),lead),createdAt:isoDate(ctx.now),receipts:[],source:p.source,productionOrderIds:orderIds.length?orderIds:undefined,createdBy:ctx.user.id||undefined,approvedBy:status==='Tasdiqlangan'?ctx.user.id||undefined:undefined}
  let next:S={...s,purchaseOrders:[row,...s.purchaseOrders]}
  if(status==='Tasdiqlangan'){
    for(const l of lines)next=changeBalance(next,ctx,warehouseId,l.materialId,{incoming:l.qty})
    next=recordLastPurchase(next,row)
  }
  const mos=orderIds.map(x=>s.productionOrders.find(o=>o.id===x)!.code)
  next=logActivity(next,ctx,'Purchase Order yaratdi','Xaridlar',code,'info',`${lines.map(l=>`${itemName(s,l.materialId)} ${l.qty} ${itemUnit(s,l.materialId)}`).join(', ')}${mos.length?` · ${mos.join(', ')} uchun`:''}`)
  for(const mo of mos)next=logActivity(next,ctx,`Xarid boshlandi: ${code}`,'Ishlab chiqarish',mo,'info',supplier.name)
  next=notify(next,ctx,'purchase','Yangi Purchase Order',`${code} (${supplier.name}) ${status==='Tasdiqlangan'?'tasdiqlandi — incoming sifatida rejalashtirildi':'qoralama sifatida saqlandi'}.`,'info','/purchases?view=orders&id='+id)
  return ok(next,`${code} yaratildi`,id)
}

/** Several POs at once (e.g. one per supplier from an order's shortages): all are created or none. */
export function createPurchaseOrders(s:S,ctx:Ctx,orders:PurchasePayload[]):Outcome{
  if(!orders.length)return fail(s,'PO uchun qator tanlanmagan')
  let next=s
  const ids:string[]=[]
  for(const p of orders){
    const out=createPurchaseOrder(next,ctx,p)
    if(!out.result.ok)return fail(s,`${s.suppliers.find(x=>x.id===p.supplierId)?.name||'Supplier'}: ${out.result.message}. Hech qaysi PO yaratilmadi.`)
    next=out.state;ids.push(out.result.id!)
  }
  const codes=ids.map(x=>next.purchaseOrders.find(p=>p.id===x)!.code)
  return ok(next,codes.length===1?`${codes[0]} yaratildi`:`${codes.length} ta PO yaratildi: ${codes.join(', ')}`,ids[0])
}

export function confirmPurchase(s:S,ctx:Ctx,id:string):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===id)
  if(!po||po.status!=='Qoralama')return fail(s,'Faqat qoralama PO tasdiqlanadi')
  if(po.createdBy&&po.createdBy===ctx.user.id&&needsSecondApprover(s,po.total))return fail(s,`${po.code}: o‘zingiz yaratgan PO’ni boshqa xodim tasdiqlaydi (ikki kishilik tasdiq)`)
  for(const i of po.items){
    const link=findLink(s,po.supplierId,i.materialId)
    const blocked=link?linkBlock(s,link):'supplier bu materialga biriktirilmagan'
    if(blocked)return fail(s,`${itemName(s,i.materialId)}: ${blocked} — PO tasdiqlanmadi`)
  }
  let next=s
  for(const i of po.items)next=changeBalance(next,ctx,po.warehouseId,i.materialId,{incoming:i.qty-i.received})
  next={...next,purchaseOrders:next.purchaseOrders.map(x=>x.id===id?{...x,status:'Tasdiqlangan' as const,approvedBy:ctx.user.id||undefined}:x)}
  next=recordLastPurchase(next,po)
  return ok(logActivity(next,ctx,'PO tasdiqlandi','Xaridlar',po.code,'success'),`${po.code} tasdiqlandi`)
}

export function markPurchaseInTransit(s:S,ctx:Ctx,id:string):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===id)
  if(!po||po.status!=='Tasdiqlangan')return fail(s,'Faqat tasdiqlangan PO yo‘lga chiqadi')
  const next={...s,purchaseOrders:s.purchaseOrders.map(x=>x.id===id?{...x,status:'Yo‘lda' as const}:x)}
  return ok(logActivity(next,ctx,'PO yo‘lda','Xaridlar',po.code),`${po.code}: Yo‘lda`)
}

/**
 * Edits a draft PO (RFQ): lines, receiving store and expected date. Lines are checked against the supplier's links
 * exactly like a new PO; a confirmed PO is never edited — its lines change only through receiving or closing.
 */
export function updatePurchaseDraft(s:S,ctx:Ctx,id:string,p:{lines:PurchaseLineInput[];warehouseId?:string;expectedDate?:string;allowBelowMoq?:boolean}):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===id)
  if(!po)return fail(s,'PO topilmadi')
  if(po.status!=='Qoralama')return fail(s,`${po.code}: faqat qoralama PO tahrirlanadi (holat: ${po.status})`)
  const built=purchaseLines(s,po.supplierId,p.lines,p.allowBelowMoq)
  if('error' in built)return fail(s,built.error)
  const warehouseId=p.warehouseId||po.warehouseId
  const wh=s.warehouses.find(w=>w.id===warehouseId)
  if(!wh||wh.status!=='Faol'||!['Raw','Mixed'].includes(wh.type))return fail(s,'Xomashyo uchun faol Raw yoki Mixed ombor tanlang')
  const expectedDate=p.expectedDate||po.expectedDate
  if(!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate))return fail(s,'Expected date noto‘g‘ri')
  const total=Math.round(built.lines.reduce((a,l)=>a+l.qty*l.price,0))
  const updated:PurchaseOrder={...po,items:built.lines,warehouseId,expectedDate,total}
  const before=po.items.map(i=>`${itemName(s,i.materialId)} ${i.qty}×${i.price}`).join(', '),after=built.lines.map(i=>`${itemName(s,i.materialId)} ${i.qty}×${i.price}`).join(', ')
  const next=logActivity({...s,purchaseOrders:s.purchaseOrders.map(x=>x.id===id?updated:x)},ctx,'PO qoralamasi tahrirlandi','Xaridlar',po.code,'info',before===after?`${wh.name} · ${expectedDate}`:`${before} → ${after}`)
  return ok(next,`${po.code} saqlandi`,id)
}

/** Header-only PO edits (invoice, payment, expected date). Lines and receipts change only via receiving. */
export function updatePurchaseMeta(s:S,ctx:Ctx,id:string,patch:{invoiceStatus?:string;paymentStatus?:string;expectedDate?:string}):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===id)
  if(!po)return fail(s,'PO topilmadi')
  if(po.status==='Bekor')return fail(s,'Bekor qilingan PO tahrirlanmaydi')
  const clean=Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined&&v!==''))
  const next={...s,purchaseOrders:s.purchaseOrders.map(x=>x.id===id?{...x,...clean}:x)}
  return ok(logActivity(next,ctx,'PO ma’lumotlari yangilandi','Xaridlar',po.code,'info',Object.entries(clean).map(([k,v])=>`${k}: ${v}`).join(', ')),'PO yangilandi')
}

export function cancelPurchase(s:S,ctx:Ctx,id:string):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===id)
  if(!po)return fail(s,'PO topilmadi')
  if(po.items.some(i=>i.received>0))return fail(s,'Qisman qabul qilingan PO bekor qilinmaydi — qabul qilingan zaxira saqlanadi, kelmaydigan qismini “Qoldiqni yopish” bilan yoping')
  if(['Bekor','Qabul qilindi'].includes(po.status))return fail(s,'PO allaqachon yopilgan')
  let next=s
  if(po.status!=='Qoralama')for(const i of po.items)next=changeBalance(next,ctx,po.warehouseId,i.materialId,{incoming:-releasable(next,po.warehouseId,i.materialId,'incoming',i.qty-i.received)})
  next={...next,purchaseOrders:next.purchaseOrders.map(x=>x.id===id?{...x,status:'Bekor' as const}:x)}
  return ok(logActivity(next,ctx,'PO bekor qilindi','Xaridlar',po.code,'warning'),`${po.code} bekor qilindi`)
}

/**
 * Closes the open rest of a partially received PO (BUG-09): what was received stays, the rest is no longer
 * expected, so its incoming quantity stops promising stock to MRP. The PO is then complete.
 */
export function closePurchaseShort(s:S,ctx:Ctx,id:string,reason:string):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===id)
  if(!po)return fail(s,'PO topilmadi')
  if(!['Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(po.status))return fail(s,'Faqat ochiq, tasdiqlangan PO qoldig‘ini yopish mumkin')
  if(!po.items.some(i=>i.received>0))return fail(s,'Hali hech narsa qabul qilinmagan — PO’ni bekor qiling')
  if(!reason.trim())return fail(s,'Yopish sababini yozing')
  const open=po.items.filter(i=>i.qty-i.received>1e-9)
  if(!open.length)return fail(s,'PO to‘liq qabul qilingan')
  let next=s
  for(const i of open)next=changeBalance(next,ctx,po.warehouseId,i.materialId,{incoming:-releasable(next,po.warehouseId,i.materialId,'incoming',i.qty-i.received)})
  const detail=open.map(i=>`${itemName(s,i.materialId)} ${q3(i.qty-i.received)} ${itemUnit(s,i.materialId)}`).join(', ')
  next={...next,purchaseOrders:next.purchaseOrders.map(x=>x.id===id?{...x,status:'Qabul qilindi' as const,receivedAt:stamp(ctx.now),closedShort:{date:stamp(ctx.now),reason:reason.trim(),open:detail}}:x)}
  return ok(logActivity(next,ctx,'PO qoldig‘i yopildi','Xaridlar',po.code,'warning',`${detail} · ${reason.trim()}`),`${po.code}: qoldiq yopildi (${detail})`)
}

/**
 * Draft orders this PO was raised for whose material is now fully covered by usable stock: they are not
 * reserved or released automatically — planners get a prompt to confirm (reserve) them.
 */
function suggestReservations(s:S,ctx:Ctx,po:PurchaseOrder):S{
  let next=s
  for(const id of po.productionOrderIds||[]){
    const o=next.productionOrders.find(x=>x.id===id)
    if(!o||o.status!=='Qoralama'||o.materialReserved)continue
    if(orderMaterialPlan(next,o,isoDate(ctx.now)).some(l=>l.shortage>0))continue
    const text=`${o.code}: ${po.code} qabul qilindi, material yetarli. Tasdiqlab rezerv qiling.`
    if(next.notifications.some(n=>!n.read&&n.text===text))continue
    next=notify(next,ctx,'production','Rezerv qilish mumkin',text,'info','/production?view=orders&id='+o.id)
  }
  return next
}

export type ReceiveOptions={warehouseId?:string;key?:string;
  /** The supplier's own lot number (kept beside the internal lot) and the storage location inside the warehouse. */
  supplierLot?:string;location?:string}

const setReceipt=(s:S,poId:string,receiptId:string,patch:Partial<PurchaseOrder['receipts'][number]>):S=>({...s,purchaseOrders:s.purchaseOrders.map(p=>p.id!==poId?p:{...p,receipts:p.receipts.map(r=>r.id===receiptId?{...r,...patch}:r)})})

/**
 * Posts a goods receipt: only here does on-hand stock grow (a PO only books "incoming"). `key` makes a
 * repeated submit of the same receipt a no-op; `warehouseId` receives into another raw store of choice.
 */
export function receivePurchase(s:S,ctx:Ctx,purchaseId:string,materialId:string,qty:number,lotOverride?:string,expiryOverride?:string,opts:ReceiveOptions={}):Outcome{
  const po=s.purchaseOrders.find(x=>x.id===purchaseId),item=po?.items.find(i=>i.materialId===materialId)
  if(!po||!item)return fail(s,'Noto‘g‘ri qabul ma’lumoti')
  if(opts.key&&po.receipts.some(r=>r.key===opts.key))return fail(s,'Bu qabul allaqachon qayd etilgan — zaxira qayta oshirilmadi')
  if(['Qoralama','Bekor'].includes(po.status))return fail(s,'Avval PO tasdiqlanishi kerak')
  const amount=q3(Number(qty)||0)
  if(amount<=0)return fail(s,'Qabul miqdorini kiriting')
  const remaining=q3(item.qty-item.received)
  if(remaining<=0)return fail(s,'Bu pozitsiya to‘liq qabul qilingan')
  if(amount>remaining)return fail(s,`Qabul miqdori qolgan ${remaining} dan oshmasligi kerak`)
  const warehouseId=opts.warehouseId||po.warehouseId
  const wh=s.warehouses.find(w=>w.id===warehouseId)
  if(!wh||wh.status!=='Faol'||!['Raw','Mixed'].includes(wh.type))return fail(s,'Xomashyo faqat faol Raw yoki Mixed omborga qabul qilinadi')
  const location=opts.location?.trim()||undefined
  if(location&&!wh.locations.includes(location))return fail(s,`${wh.name}da “${location}” joyi yo‘q`)
  const supplierLot=opts.supplierLot?.trim()||undefined
  const actual=amount
  const material=s.rawMaterials.find(m=>m.id===materialId)
  const expiry=expiryOverride?.trim()||undefined
  if(material?.expiryTracking&&!expiry)return fail(s,'Yaroqlilik muddati kuzatiladigan material uchun expiry sanasini kiriting')
  if(expiry&&expiry<isoDate(ctx.now))return fail(s,`Yaroqlilik muddati o‘tgan (${expiry}) material qabul qilinmaydi — supplierga qaytaring`)
  let next=s,lot:string|undefined
  if(material?.lotTracking!==false){
    lot=lotOverride?.trim()||lotCode(next,material?.sku||materialId,ctx.now)
    // One internal lot = one receipt: a reused code would let one inspection decide about another receipt's units.
    if(next.lots.some(l=>l.itemId===materialId&&l.code===lot))return fail(s,`Lot ${lot} allaqachon mavjud — boshqa ichki lot kiriting (supplier lotini alohida maydonga yozing)`)
    const record:LotRecord={id:ctx.id('lot'),code:lot,kind:'lot',itemId:materialId,itemType:'raw',qty:actual,originalQty:actual,warehouseId,status:'available',sourceType:'purchase',sourceId:po.id,sourceCode:po.code,createdAt:stamp(ctx.now),expiry,consumedBy:[]}
    next={...next,lots:[record,...next.lots]}
  }
  // The material's own control point wins over a general one; a mandatory (blocking) point always inspects,
  // whatever the automatic-check policy or sampling frequency says.
  const points=next.qualityControlPoints.filter(c=>c.active&&c.scope==='Incoming'&&(!c.productId||c.productId===materialId))
  const mandatory=points.find(c=>c.blocking&&c.productId===materialId)||points.find(c=>c.blocking)
  const qcp=mandatory||points.find(c=>c.productId===materialId)||points[0]
  const earlierReceipts=s.purchaseOrders.reduce((a,p)=>a+p.receipts.filter(r=>r.materialId===materialId).length,0)
  const needsQc=Boolean(mandatory||(qcp&&next.settings.policies.autoQualityChecks&&controlPointDue(qcp,`${po.id}:${materialId}:${earlierReceipts}`,earlierReceipts)))
  // Incoming was booked on the PO warehouse; the goods land where they are actually received.
  if(warehouseId===po.warehouseId)next=changeBalance(next,ctx,warehouseId,materialId,{onHand:actual,incoming:-releasable(next,warehouseId,materialId,'incoming',actual),quarantine:needsQc?actual:0},lot)
  else{
    next=changeBalance(next,ctx,po.warehouseId,materialId,{incoming:-releasable(next,po.warehouseId,materialId,'incoming',actual)})
    next=changeBalance(next,ctx,warehouseId,materialId,{onHand:actual,quarantine:needsQc?actual:0},lot)
  }
  if(lot&&needsQc)next={...next,lots:next.lots.map(l=>l.code===lot&&l.itemId===materialId?{...l,status:'quarantine' as const}:l)}
  next=addMove(next,ctx,{type:'Purchase +',itemId:materialId,itemType:'raw',warehouseId,qty:actual,source:po.code,note:`${needsQc?'Purchase receiving · QC quarantine':'Purchase receiving'}${supplierLot?` · supplier lot ${supplierLot}`:''}${location?` · ${location}`:''}`,lot})
  const items=po.items.map(i=>i.materialId===materialId?{...i,received:q3(i.received+actual)}:i)
  const done=items.every(i=>i.received>=i.qty-1e-9)
  const receiptId=ctx.id('rc'),checkId=needsQc?ctx.id('qc'):undefined
  const updated:PurchaseOrder={...po,items,status:done?'Qabul qilindi':'Qisman qabul',receivedAt:done?stamp(ctx.now):po.receivedAt,
    receipts:[...po.receipts,{id:receiptId,date:stamp(ctx.now),materialId,qty:actual,lot:lot||'',warehouseId,key:opts.key,supplierLot,location,receivedBy:ctx.user?.id||undefined,
      inspection:needsQc?'pending':'none',qualityCheckId:checkId,accepted:needsQc?0:actual,rejected:0}]}
  next={...next,purchaseOrders:next.purchaseOrders.map(x=>x.id===purchaseId?updated:x)}
  if(needsQc){
    next={...next,qualityChecks:[{id:checkId!,type:'Kirish',sourceType:'purchase',sourceId:po.id,itemId:materialId,status:'Pending',inspectorId:next.employees.find(e=>e.department==='Quality')?.id||ctx.user.id,date:stamp(ctx.now),controlPointId:qcp!.id,lot,receiptId},...next.qualityChecks]}
  }else next=suggestReservations(retryWaitingOrders(next,ctx),ctx,updated)
  next=logActivity(next,ctx,'Xaridni qabul qildi','Xaridlar',po.code,'success',`${itemName(s,materialId)} ${actual}${lot?` · ${lot}`:''}${supplierLot?` · supplier ${supplierLot}`:''}${warehouseId!==po.warehouseId?` · ${wh.name}`:''}`)
  const rest=q3(remaining-actual)
  return ok(next,`${actual} ${material?.unit||''} qabul qilindi${lot?` · ${lot}`:''}${needsQc?' · QC kutilmoqda':''}${rest>0?` · qolgan ${rest}`:''}`)
}


/**
 * Incoming inspection with a split result: `accepted` units of the receipt go to available stock, the rest stays in
 * quarantine as rejected (lot split: available part + held part) until it is returned to the supplier or scrapped.
 * Everything accepted = Passed; nothing accepted = Failed (both through resolveQuality).
 */
export function inspectReceipt(s:S,ctx:Ctx,qualityCheckId:string,accepted:number,reason='',measured=''):Outcome{
  const q=s.qualityChecks.find(x=>x.id===qualityCheckId)
  if(!q||q.sourceType!=='purchase')return fail(s,'Kirish tekshiruvi topilmadi')
  if(q.status!=='Pending')return fail(s,`Bu tekshiruv allaqachon hal qilingan (${q.status})`)
  const po=s.purchaseOrders.find(p=>p.id===q.sourceId)
  const receipt=po?.receipts.find(r=>r.id===q.receiptId)
  if(!po||!receipt)return fail(s,'Tekshiruv qaysi qabulga tegishli ekani aniq emas — natija qayd etilmadi')
  const total=receipt.qty,unit=itemUnit(s,q.itemId)
  const good=q3(Number(accepted))
  if(!Number.isFinite(good)||good<0||good>total+1e-9)return fail(s,`Qabul qilinadigan miqdor 0 dan ${total} ${unit} gacha bo‘lsin`)
  if(good>=total-1e-9)return resolveQuality(s,ctx,qualityCheckId,'Passed','',measured)
  if(!reason.trim())return fail(s,'Rad etilgan qism uchun sabab yozing')
  if(good<=1e-9)return resolveQuality(s,ctx,qualityCheckId,'Failed',reason,measured)
  const rejected=q3(total-good),wh=receipt.warehouseId||po.warehouseId
  const held=s.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===q.itemId)
  if((held?.quarantine||0)<total-1e-6)return fail(s,`${itemName(s,q.itemId)}: karantinda ${q3(held?.quarantine||0)} ${unit} bor, bu qabul ${total} ${unit} — natija qayd etilmadi`)
  let next=changeBalance(s,ctx,wh,q.itemId,{quarantine:-good})
  if(q.lot){
    const lot=next.lots.find(l=>l.code===q.lot&&l.itemId===q.itemId&&l.warehouseId===wh&&l.status==='quarantine')
    if(lot){
      const rest:LotRecord={...lot,id:ctx.id('lot'),qty:rejected,originalQty:rejected,status:'hold',consumedBy:[]}
      next={...next,lots:[...next.lots.map(l=>l.id===lot.id?{...l,qty:q3(Math.max(0,l.qty-rejected)),originalQty:good,status:'available' as const}:l),rest]}
    }
  }
  next={...next,qualityChecks:next.qualityChecks.map(x=>x.id===q.id?{...x,status:'Failed' as const,reason:reason.trim(),measured:measured||x.measured,inspectorId:ctx.user.id,date:stamp(ctx.now),acceptedQty:good,rejectedQty:rejected}:x)}
  next=setReceipt(next,po.id,receipt.id,{inspection:'partial',accepted:good,rejected})
  next=suggestReservations(retryWaitingOrders(next,ctx),ctx,po)
  next={...next,qualityAlerts:[{id:ctx.id('qa'),title:`${po.code} — ${itemName(s,q.itemId)}: ${rejected} ${unit} rad etildi`,sourceId:po.id,severity:'O‘rta',status:'Ochiq',reason:reason.trim(),ownerId:ctx.user.id,createdAt:stamp(ctx.now)},...next.qualityAlerts]}
  next=notify(next,ctx,'quality','Kirish tekshiruvi: qisman rad',`${po.code}: ${good} ${unit} qabul, ${rejected} ${unit} rad etildi. ${reason.trim()}`,'warning',`/purchases?view=orders&id=${po.id}`)
  next=logActivity(next,ctx,'Kirish tekshiruvi: qisman qabul','Sifat',po.code,'warning',`${itemName(s,q.itemId)}: ${good} qabul · ${rejected} rad · ${reason.trim()}`)
  return ok(next,`${good} ${unit} omborga, ${rejected} ${unit} rad etildi (karantinda)`)
}

/**
 * Rejected units of a receipt leave quarantine: shipped back to the supplier or written off as scrap. Only what the
 * inspection rejected and is still undecided can go, so the accepted part and other receipts are never touched (N-03).
 */
function disposeRejected(s:S,ctx:Ctx,qualityCheckId:string,mode:'return'|'scrap',qty?:number,note=''):Outcome{
  const q=s.qualityChecks.find(x=>x.id===qualityCheckId)
  if(!q||q.sourceType!=='purchase')return fail(s,mode==='return'?'Supplier return uchun incoming QC tanlang':'Kirish tekshiruvi topilmadi')
  if(!['Failed','Hold','Rework'].includes(q.status))return fail(s,`Faqat Failed / Hold / Rework material ${mode==='return'?'supplierga qaytariladi':'hisobdan chiqariladi'}`)
  const po=s.purchaseOrders.find(p=>p.id===q.sourceId)
  if(!po)return fail(s,'Purchase Order topilmadi')
  const receipt=q.receiptId?po.receipts.find(r=>r.id===q.receiptId):po.receipts.find(r=>r.materialId===q.itemId&&(!q.lot||r.lot===q.lot))
  if(!receipt)return fail(s,'Qabul yozuvi topilmadi')
  const unit=itemUnit(s,q.itemId),split=receiptQuantities(s,po,receipt)
  const open=rejectedOpen(s,po,receipt)
  if(open<=1e-9)return fail(s,split.returned>0&&mode==='return'?'Bu qabul supplierga allaqachon qaytarilgan':'Bu qabulda qaror kutayotgan rad etilgan qoldiq yo‘q')
  const amount=qty===undefined||qty===null||String(qty)===''?open:q3(Number(qty))
  if(!(amount>0))return fail(s,'Miqdor 0 dan katta bo‘lsin')
  if(amount>open+1e-9)return fail(s,`Rad etilgan qoldiq ${open} ${unit} — ${amount} ${unit} bo‘lmaydi`)
  if(mode==='scrap'&&!note.trim())return fail(s,'Hisobdan chiqarish sababini yozing')
  const wh=receipt.warehouseId||po.warehouseId
  const balance=s.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===q.itemId)
  const verb=mode==='return'?'qaytarib':'hisobdan chiqarib'
  if((balance?.quarantine||0)<amount-1e-6)return fail(s,`${itemName(s,q.itemId)}: karantinda ${q3(balance?.quarantine||0)} ${unit} bor, ${amount} ${unit} ${verb} bo‘lmaydi`)
  if((balance?.onHand||0)<amount-1e-6)return fail(s,`${itemName(s,q.itemId)}: omborda ${q3(balance?.onHand||0)} ${unit} bor, ${amount} ${unit} ${verb} bo‘lmaydi — avval qoldiqni tekshiring`)
  let next=changeBalance(s,ctx,wh,q.itemId,{onHand:-amount,quarantine:-amount})
  if(q.lot){
    // The held (rejected) part of the lot; never its released, available part.
    let left=amount
    const blocked=(l:LotRecord)=>l.code===q.lot&&l.itemId===q.itemId&&l.warehouseId===wh&&(l.status||'available')!=='available'
    const any=next.lots.some(l=>blocked(l)&&l.qty>0)
    next={...next,lots:next.lots.map(l=>{
      if(left<=1e-9||!(any?blocked(l):l.code===q.lot&&l.itemId===q.itemId&&l.warehouseId===wh))return l
      const take=Math.min(left,l.qty);left=q3(left-take)
      return {...l,qty:q3(l.qty-take),status:'hold' as const}
    })}
  }
  const supplier=s.suppliers.find(v=>v.id===po.supplierId)
  next=addMove(next,ctx,mode==='return'
    ?{type:'Supplier Return -',itemId:q.itemId,itemType:'raw',warehouseId:wh,qty:-amount,source:po.code,note:`Incoming QC ${q.status} · supplierga qaytarildi${note?` · ${note}`:''}`,lot:q.lot}
    :{type:'QC Scrap -',itemId:q.itemId,itemType:'raw',warehouseId:wh,qty:-amount,source:po.code,note:`Rad etilgan kirim scrap · ${note.trim()}`,lot:q.lot})
  const base=receipt.inspection?{}:{inspection:split.inspection,accepted:split.accepted,rejected:split.rejected,scrapped:split.scrapped}
  next=setReceipt(next,po.id,receipt.id,mode==='return'?{...base,returned:q3(split.returned+amount)}:{...base,returned:split.returned,scrapped:q3(split.scrapped+amount)})
  next={...next,qualityChecks:next.qualityChecks.map(x=>x.id===q.id?(mode==='return'
    ?{...x,returnedQty:q3(split.returned+amount),reason:`${x.reason||q.status} · Supplierga qaytarildi (${amount} ${unit})`}
    :{...x,reason:`${x.reason||q.status} · Scrap (${amount} ${unit})`}):x)}
  next=logActivity(next,ctx,mode==='return'?'Supplier return':'Rad etilgan kirim scrap','Xaridlar',po.code,'warning',`${itemName(s,q.itemId)} ${amount} ${unit}${mode==='return'?` → ${supplier?.name||'supplier'}`:` · ${note.trim()}`}`)
  return ok(next,mode==='return'?`${amount} ${unit} supplierga qaytarildi`:`${amount} ${unit} hisobdan chiqarildi (scrap)`)
}

/** Ships rejected receipt units back to the supplier (all still undecided, or `qty` of them). */
export function returnPurchaseToSupplier(s:S,ctx:Ctx,qualityCheckId:string,qty?:number,note=''):Outcome{
  return disposeRejected(s,ctx,qualityCheckId,'return',qty,note)
}

/** Writes rejected receipt units off as scrap (with a reason). */
export function scrapRejectedReceipt(s:S,ctx:Ctx,qualityCheckId:string,reason:string,qty?:number):Outcome{
  return disposeRejected(s,ctx,qualityCheckId,'scrap',qty,reason)
}

/* ------------------------------------------------- supplier ↔ material -- */

const linkLabel=(s:S,l:Pick<SupplierMaterial,'supplierId'|'materialId'>)=>`${s.suppliers.find(x=>x.id===l.supplierId)?.name||'Supplier'} → ${itemName(s,l.materialId)}`
const linkTerms=(l:LinkInput)=>`${l.price} ${l.currency}/${l.purchaseUnit}${l.unitFactor!==1?` (=${l.unitFactor})`:''} · MOQ ${l.moq||'—'} · ${l.leadTime} kun${l.active?'':' · nofaol'}`
const clearPreferred=(s:S,supplierId:string,materialId:string):S=>({...s,rawMaterials:s.rawMaterials.map(m=>m.id===materialId&&m.supplierId===supplierId?{...m,supplierId:''}:m)})
const openPoBlocker=(s:S,l:SupplierMaterial)=>{const open=openPurchasesFor(s,l.supplierId,l.materialId);return open.length?`ochiq PO bor (${open.map(p=>p.code).join(', ')}) — aloqani nofaol qiling`:null}

export function linkSupplierMaterial(s:S,ctx:Ctx,input:LinkInput):Outcome{
  const link=cleanLink(input)
  const error=validateLink(s,link)
  if(error)return fail(s,error)
  const row:SupplierMaterial={id:ctx.id('sm'),...link,createdAt:isoDate(ctx.now)}
  const next=logActivity({...s,supplierMaterials:[row,...s.supplierMaterials]},ctx,'Material supplierga biriktirildi','Xaridlar',linkLabel(s,row),'info',linkTerms(row))
  return ok(next,`${linkLabel(s,row)} biriktirildi`,row.id)
}

export function updateSupplierMaterial(s:S,ctx:Ctx,id:string,patch:Partial<LinkInput>):Outcome{
  const current=s.supplierMaterials.find(l=>l.id===id)
  if(!current)return fail(s,'Aloqa topilmadi')
  if((patch.supplierId&&patch.supplierId!==current.supplierId)||(patch.materialId&&patch.materialId!==current.materialId))return fail(s,'Supplier yoki materialni almashtirib bo‘lmaydi — yangi aloqa yarating')
  const link=cleanLink({...current,...patch})
  const error=validateLink(s,link,id)
  if(error)return fail(s,error)
  let next:S={...s,supplierMaterials:s.supplierMaterials.map(l=>l.id===id?{...l,...link}:l)}
  // An inactive link cannot stay the material's preferred supplier.
  if(!link.active)next=clearPreferred(next,link.supplierId,link.materialId)
  next=logActivity(next,ctx,'Supplier shartlari yangilandi','Xaridlar',linkLabel(s,current),'info',linkTerms(link))
  return ok(next,'Shartlar saqlandi',id)
}

export function removeSupplierMaterial(s:S,ctx:Ctx,id:string):Outcome{
  const link=s.supplierMaterials.find(l=>l.id===id)
  if(!link)return fail(s,'Aloqa topilmadi')
  const blocker=openPoBlocker(s,link)
  if(blocker)return fail(s,`O‘chirib bo‘lmaydi: ${blocker}`)
  const next=logActivity(clearPreferred({...s,supplierMaterials:s.supplierMaterials.filter(l=>l.id!==id)},link.supplierId,link.materialId),ctx,'Material supplierdan ajratildi','Xaridlar',linkLabel(s,link),'warning')
  return ok(next,`${linkLabel(s,link)} aloqasi o‘chirildi`)
}

/** Preferred ("Asosiy") supplier of a material — only an orderable linked supplier, or none. */
export function setPreferredSupplier(s:S,ctx:Ctx,materialId:string,supplierId:string):Outcome{
  const material=s.rawMaterials.find(m=>m.id===materialId)
  if(!material)return fail(s,'Material topilmadi')
  if(supplierId){
    const link=findLink(s,supplierId,materialId)
    if(!link)return fail(s,'Avval supplierni shu materialga biriktiring')
    const blocked=linkBlock(s,link)
    if(blocked)return fail(s,`Asosiy qilib bo‘lmaydi: ${blocked}`)
  }
  const next=logActivity({...s,rawMaterials:s.rawMaterials.map(m=>m.id===materialId?{...m,supplierId}:m)},ctx,'Asosiy supplier o‘zgardi','Xomashyo',material.name,'info',supplierId?s.suppliers.find(x=>x.id===supplierId)?.name:'—')
  return ok(next,supplierId?`${s.suppliers.find(x=>x.id===supplierId)?.name} — asosiy supplier`:'Asosiy supplier olib tashlandi')
}

export type SupplierInput=Pick<Supplier,'name'|'phone'|'leadTime'|'rating'|'status'>&{email?:string}
export type SupplierLinkRow=Omit<LinkInput,'supplierId'>&{id?:string}

/** Creates or edits a supplier together with the materials it supplies, in one step (all or nothing). */
export function saveSupplier(s:S,ctx:Ctx,p:{id?:string;supplier:SupplierInput;links:SupplierLinkRow[]}):Outcome{
  const name=p.supplier.name.trim()
  if(!name)return fail(s,'Supplier nomi majburiy')
  if(s.suppliers.some(x=>x.id!==p.id&&x.name.trim().toLowerCase()===name.toLowerCase()))return fail(s,'Bu nomli supplier bor')
  const existing=p.id?s.suppliers.find(x=>x.id===p.id):undefined
  if(p.id&&!existing)return fail(s,'Supplier topilmadi')
  const supplierId=existing?.id||ctx.id('su')
  const fields={name,phone:p.supplier.phone.trim(),email:p.supplier.email?.trim()||undefined,leadTime:Math.max(0,Number(p.supplier.leadTime)||0),rating:Math.min(5,Math.max(0,Number(p.supplier.rating)||0)),status:p.supplier.status}
  let next:S=existing
    ?{...s,suppliers:s.suppliers.map(x=>x.id===supplierId?{...x,...fields}:x)}
    :{...s,suppliers:[{id:supplierId,debt:0,...fields},...s.suppliers]}
  const keep=new Set(p.links.map(l=>l.id).filter(Boolean))
  for(const old of next.supplierMaterials.filter(l=>l.supplierId===supplierId&&!keep.has(l.id))){
    const blocker=openPoBlocker(next,old)
    if(blocker)return fail(s,`${itemName(s,old.materialId)}: ${blocker}`)
    next=clearPreferred({...next,supplierMaterials:next.supplierMaterials.filter(l=>l.id!==old.id)},supplierId,old.materialId)
  }
  for(const row of p.links){
    const link=cleanLink({...row,supplierId})
    const error=validateLink(next,link,row.id)
    if(error)return fail(s,`${itemName(s,link.materialId)}: ${error}`)
    if(row.id&&next.supplierMaterials.some(l=>l.id===row.id&&l.supplierId===supplierId)){
      next={...next,supplierMaterials:next.supplierMaterials.map(l=>l.id===row.id?{...l,...link}:l)}
      if(!link.active)next=clearPreferred(next,supplierId,link.materialId)
    }else next={...next,supplierMaterials:[{id:ctx.id('sm'),...link,createdAt:isoDate(ctx.now)},...next.supplierMaterials]}
  }
  next=logActivity(next,ctx,existing?'Supplier tahrirlandi':'Supplier yaratildi','Xaridlar',name,'info',`${p.links.length} material`)
  return ok(next,existing?'Supplier saqlandi':`${name} qo‘shildi`,supplierId)
}

/* -------------------------------------------------------------- sales -- */

function reserveSales(s:S,ctx:Ctx,so:SalesOrder):{state:S;so:SalesOrder}{
  let next=s
  const items=so.items.map(item=>{
    let need=Math.max(0,item.qty-item.delivered-(item.reserved||0))
    const reservations=(item.reservations?.length?item.reservations:(item.warehouseId&&item.reserved?[{warehouseId:item.warehouseId,qty:item.reserved}]:[])).map(r=>({...r}))
    if(need>0){
      const candidates=next.stockBalances.filter(b=>b.itemId===item.productId&&b.onHand-b.reserved-(b.quarantine||0)>0).sort((a,b)=>(b.onHand-b.reserved-(b.quarantine||0))-(a.onHand-a.reserved-(a.quarantine||0)))
      for(const b of candidates){
        if(need<=1e-9)break
        const take=Math.min(need,b.onHand-b.reserved-(b.quarantine||0))
        if(take<=0)continue
        next=changeBalance(next,ctx,b.warehouseId,item.productId,{reserved:take})
        const prev=reservations.find(r=>r.warehouseId===b.warehouseId)
        if(prev)prev.qty=q3(prev.qty+take);else reservations.push({warehouseId:b.warehouseId,qty:q3(take)})
        need=q3(need-take)
      }
    }
    const reserved=reservations.reduce((a,r)=>a+r.qty,0)
    return {...item,reserved:q3(reserved),warehouseId:reservations.length===1?reservations[0].warehouseId:undefined,reservations}
  })
  const fully=items.every(i=>i.delivered+(i.reserved||0)>=i.qty)
  const linkedIds=so.productionOrderIds?.length?so.productionOrderIds:so.productionOrderId?[so.productionOrderId]:[]
  const linkedOpen=linkedIds.some(id=>next.productionOrders.some(o=>o.id===id&&isOpenOrder(o)))
  const status:SalesOrder['status']=fully?'Tayyor':linkedOpen?'Ishlab chiqarishda':'Tasdiqlangan'
  const updated={...so,items,status}
  return {state:{...next,salesOrders:next.salesOrders.map(x=>x.id===so.id?updated:x)},so:updated}
}

export type SalesPayload={customerId:string;lines?:{productId:string;qty:number;price?:number;variantId?:string}[];productId?:string;qty?:number;mode:SalesOrder['mode'];deliveryDate?:string}

export function createSalesOrder(s:S,ctx:Ctx,p:SalesPayload):Outcome{
  const customer=s.customers.find(c=>c.id===p.customerId)
  if(!customer)return fail(s,'Mijoz tanlanmagan')
  const inputs=(p.lines||(p.productId?[{productId:p.productId,qty:p.qty||0}]:[])).filter(l=>l.productId&&Math.floor(Number(l.qty)||0)>0)
  for(const l of inputs){const v=variantFor(s,l.productId,l.variantId);if('error' in v)return fail(s,v.error)}
  // A variant's price is the product price plus its price difference, unless a price is given.
  const lines=inputs.map(l=>{const product=s.products.find(x=>x.id===l.productId);const variant=product?.variants.find(v=>v.id===l.variantId);return {productId:l.productId,qty:Math.floor(Number(l.qty)||0),price:l.price??((product?.salePrice??0)+(variant?.priceDelta??0)),delivered:0,reserved:0,...(variant?{variantId:variant.id}:{})}})
  if(!lines.length)return fail(s,'Kamida bitta mahsulot va miqdor kiriting')
  // Delivery and returns are keyed by product, so one product must sit on one line (B3-04).
  const dup=lines.find((l,i)=>lines.findIndex(x=>x.productId===l.productId)!==i)
  if(dup)return fail(s,`${itemName(s,dup.productId)} ikki qatorda — miqdorni bitta qatorga jamlang`)
  const id=ctx.id('so'),code=nextCode(s.salesOrders.map(x=>x.code),'SO',ctx.now)
  const deliveryDate=p.deliveryDate||addDays(isoDate(ctx.now),3)
  let row:SalesOrder={id,code,customerId:customer.id,status:'Tasdiqlangan',mode:p.mode,items:lines,total:lines.reduce((a,l)=>a+l.qty*l.price,0),paymentStatus:'To‘lanmagan',deliveryDate,createdAt:isoDate(ctx.now)}
  let next:S={...s,salesOrders:[row,...s.salesOrders]}
  let message=`${code} yaratildi`
  if(p.mode==='Make-to-order'){
    const productionOrderIds:string[]=[]
    // Production is due the day before delivery, but never before today (a same-day delivery is due today).
    const today=isoDate(ctx.now),due=addDays(deliveryDate,-1)<today?today:addDays(deliveryDate,-1)
    for(const line of lines){
      const created=createProductionOrder(next,ctx,{productId:line.productId,variantId:line.variantId,quantity:line.qty,due,salesOrderId:id,priority:'Yuqori',source:`MTO: ${code}`})
      if(!created.result.ok)return fail(s,`MTO ${itemName(s,line.productId)}: ${created.result.message}`)
      next=created.state
      if(created.result.id)productionOrderIds.push(created.result.id)
    }
    row={...row,productionOrderId:productionOrderIds[0],productionOrderIds,status:'Ishlab chiqarishda'}
    next={...next,salesOrders:next.salesOrders.map(x=>x.id===id?row:x)}
    message=`${code} yaratildi · ${productionOrderIds.length} ta MTO ishlab chiqarish buyurtmasi ochildi`
  }else{
    const reserved=reserveSales(next,ctx,row)
    next=reserved.state
    message=reserved.so.status==='Tayyor'?`${code} yaratildi · stock rezerv qilindi`:`${code} yaratildi · stock yetarli emas, qisman rezerv`
  }
  next=logActivity(next,ctx,'Sales Order yaratdi','Sotuv',code,'info',`${customer.name} · ${p.mode}`)
  next=notify(next,ctx,'sales','Yangi Sales Order',message,'info','/sales?view=orders&id='+id)
  return ok(next,message,id)
}

export function reserveSalesOrder(s:S,ctx:Ctx,id:string):Outcome{
  const so=s.salesOrders.find(x=>x.id===id)
  if(!so||['Yetkazildi','Bekor'].includes(so.status))return fail(s,'Buyurtma yopilgan')
  const r=reserveSales(s,ctx,so)
  return ok(logActivity(r.state,ctx,'Stock rezerv tekshirildi','Sotuv',so.code),r.so.status==='Tayyor'?`${so.code}: to‘liq rezerv qilindi`:`${so.code}: stock hali yetarli emas`)
}

export function deliverSalesOrder(s:S,ctx:Ctx,id:string,quantities?:Record<string,number>):Outcome{
  const so=s.salesOrders.find(x=>x.id===id)
  if(!so)return fail(s,'Buyurtma topilmadi')
  if(['Yetkazildi','Bekor'].includes(so.status))return fail(s,'Buyurtma allaqachon yopilgan')
  const targets=so.items.map(item=>{
    const open=Math.max(0,item.qty-item.delivered)
    const requested=quantities?Math.floor(Number(quantities[item.productId])||0):open
    return {item,target:Math.max(0,requested),open}
  })
  if(!targets.some(x=>x.target>0))return fail(s,'Yetkazish uchun kamida bitta miqdor kiriting')
  for(const {item,target,open} of targets){
    if(target>open)return fail(s,`${itemName(s,item.productId)}: maksimum ${open}`)
    const reserved=Math.min(item.reserved||0,target)
    const extra=target-reserved
    if(extra>0&&stockOf(s,item.productId).available<extra)return fail(s,`${itemName(s,item.productId)}: available stock yetarli emas`)
  }
  // The reserved part leaves the reserving warehouse, so that warehouse must still physically hold it.
  const fromReserved=new Map<string,{warehouseId:string;productId:string;qty:number}>()
  for(const {item,target} of targets){
    let left=target
    for(const r of item.reservations?.length?item.reservations:(item.warehouseId&&item.reserved?[{warehouseId:item.warehouseId,qty:item.reserved}]:[])){
      if(left<=1e-9)break
      const take=Math.min(left,r.qty),key=`${r.warehouseId}|${item.productId}`
      fromReserved.set(key,{warehouseId:r.warehouseId,productId:item.productId,qty:(fromReserved.get(key)?.qty||0)+take});left-=take
    }
  }
  for(const x of fromReserved.values()){
    const b=s.stockBalances.find(v=>v.warehouseId===x.warehouseId&&v.itemId===x.productId)
    if((b?.onHand||0)<x.qty-1e-6)return fail(s,`${itemName(s,x.productId)}: rezerv omborida ${q3(b?.onHand||0)} ${itemUnit(s,x.productId)} bor, yetkazish uchun ${q3(x.qty)} kerak — avval qoldiqni tekshiring`)
  }
  let next=s
  const nextItems=so.items.map(item=>{
    const target=targets.find(x=>x.item===item)?.target||0
    if(target<=0)return item
    let left=target
    const reservations=(item.reservations?.length?item.reservations:(item.warehouseId&&item.reserved?[{warehouseId:item.warehouseId,qty:item.reserved}]:[])).map(r=>({...r}))
    const issues:{warehouseId:string;qty:number}[]=[]
    for(const r of reservations){
      if(left<=1e-9)break
      const take=Math.min(left,r.qty)
      if(take<=0)continue
      next=changeBalance(next,ctx,r.warehouseId,item.productId,{onHand:-take,reserved:-releasable(next,r.warehouseId,item.productId,'reserved',take)})
      r.qty=q3(r.qty-take);left=q3(left-take);issues.push({warehouseId:r.warehouseId,qty:take})
    }
    for(const b of next.stockBalances.filter(b=>b.itemId===item.productId&&b.onHand-b.reserved-(b.quarantine||0)>0)){
      if(left<=1e-9)break
      const take=Math.min(left,b.onHand-b.reserved-(b.quarantine||0))
      next=changeBalance(next,ctx,b.warehouseId,item.productId,{onHand:-take})
      left=q3(left-take);issues.push({warehouseId:b.warehouseId,qty:take})
    }
    if(left>1e-6)throw new Error(`${itemName(s,item.productId)} allocation mismatch`)
    for(const issue of issues){
      const taken=takeLots(next,item.productId,issue.qty,so.code,issue.warehouseId);next=taken.state
      for(const a of taken.allocations)next=addMove(next,ctx,{type:'Sale -',itemId:item.productId,itemType:'finished',warehouseId:issue.warehouseId,qty:-a.qty,source:so.code,note:'Sales delivery',lot:a.lot})
    }
    const cleanReservations=reservations.filter(r=>r.qty>1e-9)
    return {...item,delivered:q3(item.delivered+target),reserved:q3(cleanReservations.reduce((a,r)=>a+r.qty,0)),warehouseId:cleanReservations.length===1?cleanReservations[0].warehouseId:undefined,reservations:cleanReservations}
  })
  const complete=nextItems.every(i=>i.delivered>=i.qty)
  const status:SalesOrder['status']=complete?'Yetkazildi':nextItems.every(i=>i.delivered+(i.reserved||0)>=i.qty)?'Tayyor':'Tasdiqlangan'
  next={...next,salesOrders:next.salesOrders.map(x=>x.id===id?{...x,status,deliveredAt:complete?stamp(ctx.now):x.deliveredAt,items:nextItems}:x)}
  next=logActivity(next,ctx,complete?'Sotuv to‘liq yetkazildi':'Sotuv qisman yetkazildi','Sotuv',so.code,'success',targets.filter(x=>x.target>0).map(x=>`${itemName(s,x.item.productId)} ${x.target}`).join(', '))
  return ok(next,complete?`${so.code} to‘liq yetkazildi`:`${so.code}: qisman yetkazildi`)
}

export function updateSalesMeta(s:S,ctx:Ctx,id:string,patch:{paymentStatus?:string;deliveryDate?:string}):Outcome{
  const so=s.salesOrders.find(x=>x.id===id)
  if(!so)return fail(s,'Buyurtma topilmadi')
  if(so.status==='Bekor')return fail(s,'Bekor qilingan buyurtma tahrirlanmaydi')
  if(patch.deliveryDate&&so.status==='Yetkazildi')return fail(s,'Yetkazilgan buyurtma sanasi o‘zgarmaydi')
  const clean=Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined&&v!==''))
  const next={...s,salesOrders:s.salesOrders.map(x=>x.id===id?{...x,...clean}:x)}
  return ok(logActivity(next,ctx,'Sales Order yangilandi','Sotuv',so.code,'info',Object.entries(clean).map(([k,v])=>`${k}: ${v}`).join(', ')),'Buyurtma yangilandi')
}

export function cancelSalesOrder(s:S,ctx:Ctx,id:string):Outcome{
  const so=s.salesOrders.find(x=>x.id===id)
  if(!so)return fail(s,'Buyurtma topilmadi')
  if(['Yetkazildi','Bekor'].includes(so.status))return fail(s,'Yopilgan buyurtma bekor qilinmaydi')
  let next=s
  for(const item of so.items)for(const r of item.reservations?.length?item.reservations:(item.warehouseId&&item.reserved?[{warehouseId:item.warehouseId,qty:item.reserved}]:[]))next=changeBalance(next,ctx,r.warehouseId,item.productId,{reserved:-releasable(next,r.warehouseId,item.productId,'reserved',r.qty)})
  let message=`${so.code} bekor qilindi`
  const moIds=so.productionOrderIds?.length?so.productionOrderIds:so.productionOrderId?[so.productionOrderId]:[]
  const linked=moIds.map(mid=>next.productionOrders.find(o=>o.id===mid)).filter((o):o is ProductionOrder=>Boolean(o))
  const cancelledCodes:string[]=[], detachedCodes:string[]=[]
  for(const mo of linked){
    if(['Qoralama','Material kutilmoqda'].includes(mo.status)){
      const cancelled=transitionProduction(next,ctx,mo.id,'Bekor qilingan')
      if(cancelled.result.ok){next=cancelled.state;cancelledCodes.push(mo.code)}
    }else if(isOpenOrder(mo)){
      detachedCodes.push(mo.code)
      next={...next,productionOrders:next.productionOrders.map(o=>o.id===mo.id?{...o,salesOrderId:undefined,source:`${o.source||''} · SO bekor`}:o)}
    }
  }
  if(cancelledCodes.length)message+=` · ${cancelledCodes.join(', ')} ham bekor qilindi`
  if(detachedCodes.length)message+=` · ${detachedCodes.join(', ')} make-to-stock sifatida davom etmoqda`
  next={...next,salesOrders:next.salesOrders.map(x=>x.id===id?{...x,status:'Bekor' as const,items:x.items.map(i=>({...i,reserved:0,reservations:[]}))}:x)}
  return ok(logActivity(next,ctx,'Sales Order bekor qilindi','Sotuv',so.code,'warning',message),message)
}

export function createReturn(s:S,ctx:Ctx,p:{salesOrderId:string;productId:string;qty:number;reason:string}):Outcome{
  const so=s.salesOrders.find(x=>x.id===p.salesOrderId)
  if(!so)return fail(s,'Sotuv buyurtmasi tanlanmagan')
  const line=so.items.find(i=>i.productId===p.productId)
  const qty=Math.floor(Number(p.qty)||0)
  const alreadyReturned=s.returns.filter(r=>r.salesOrderId===so.id&&r.productId===p.productId).reduce((a,r)=>a+r.qty,0)
  if(!line||line.delivered<=0)return fail(s,'Faqat yetkazilgan mahsulot qaytariladi')
  if(qty<=0||qty>line.delivered-alreadyReturned)return fail(s,`Qaytarish miqdori 1–${line.delivered-alreadyReturned} oralig‘ida`)
  if(!p.reason.trim())return fail(s,'Qaytarish sababini yozing')
  const id=ctx.id('ret'),code=nextCode(s.returns.map(r=>r.code),'RET',ctx.now)
  const checkId=ctx.id('qc')
  // The units are received into quarantine at once, so stock and the ledger show them while they wait for inspection (P1-26).
  const received=receiveReturn(s,ctx,{id,code,salesOrderId:so.id,customerId:so.customerId,productId:p.productId,qty,reason:p.reason.trim(),status:'Inspection',createdAt:stamp(ctx.now),qualityCheckId:checkId},so)
  if('error' in received)return fail(s,received.error)
  const row=received.row,lot=row.lot
  const check:QualityCheck={id:checkId,type:'Final',sourceType:'return',sourceId:id,itemId:p.productId,status:'Pending',inspectorId:s.employees.find(e=>e.department==='Quality')?.id||ctx.user.id,date:stamp(ctx.now),lot,reason:`Customer return: ${p.reason.trim()}`}
  let next={...received.state,returns:[row,...received.state.returns],qualityChecks:[check,...received.state.qualityChecks]}
  next=logActivity(next,ctx,'Mijoz qaytarishi qabul qilindi','Sotuv',code,'warning',`${so.code} · ${qty} ${itemUnit(s,p.productId)}`)
  next=notify(next,ctx,'quality','Customer return',`${code}: ${itemName(s,p.productId)} ${qty} — inspectionga yuborildi.`,'warning',`/sales?view=returns&id=${id}`)
  return ok(next,`${code} yaratildi va inspectionga yuborildi`,id)
}

/**
 * Receives a customer return into quarantine (P1-26): into the warehouse that shipped most of it (an active one), as
 * the shipped lots it came back from (P1-29) — each a lot record of its own, so the decision moves exactly these units.
 */
function receiveReturn(s:S,ctx:Ctx,r:CustomerReturn,so:Pick<SalesOrder,'id'|'code'>):{state:S;row:CustomerReturn}|{error:string}{
  const src=returnSources(s,so,r.productId,r.qty,r.id)
  const active=(id?:string)=>Boolean(id&&s.warehouses.some(w=>w.id===id&&w.status==='Faol'))
  const wh=active(src.warehouseId)?src.warehouseId!:finishedWarehouseFor(s,s.settings.defaultLineId)
  if(!active(wh))return {error:'Qaytarishni qabul qiladigan faol ombor topilmadi'}
  const allocations=src.unexplained>0?[...src.allocations,{qty:src.unexplained}]:src.allocations
  let next=changeBalance(s,ctx,wh,r.productId,{onHand:r.qty,quarantine:r.qty})
  for(const a of allocations){
    next=addMove(next,ctx,{type:'Return +',itemId:r.productId,itemType:'finished',warehouseId:wh,qty:a.qty,source:r.code,note:'Customer return · karantin (inspection)',lot:a.lot})
    if(!a.lot)continue
    const origin=lotOrigin(s,a.lot,r.productId)
    next={...next,lots:[{id:ctx.id('lot'),code:a.lot,kind:origin?.kind||'lot',itemId:r.productId,itemType:'finished',qty:a.qty,originalQty:a.qty,warehouseId:wh,status:'quarantine',sourceType:'return',sourceId:r.id,sourceCode:r.code,createdAt:stamp(ctx.now),expiry:origin?.expiry,consumedBy:[]},...next.lots]}
  }
  return {state:next,row:{...r,warehouseId:wh,allocations,lot:allocations.find(a=>a.lot)?.lot}}
}

export function dispositionReturn(s:S,ctx:Ctx,id:string,decision:'Omborga qaytarildi'|'Rework'|'Scrap'):Outcome{
  const found=s.returns.find(x=>x.id===id)
  if(!found)return fail(s,'Qaytarish topilmadi')
  if(found.status!=='Inspection'&&found.status!=='Qabul qilindi')return fail(s,'Qaror allaqachon qabul qilingan')
  if(!['Omborga qaytarildi','Rework','Scrap'].includes(decision))return fail(s,'Qaror noto‘g‘ri')
  let next=s,r=found
  // A return registered before returns were received into quarantine is received now, then decided (P1-26).
  if(!r.warehouseId){
    const so=s.salesOrders.find(x=>x.id===r.salesOrderId)
    if(!so)return fail(s,'Qaytarishning sotuv buyurtmasi topilmadi')
    const received=receiveReturn(s,ctx,r,so)
    if('error' in received)return fail(s,received.error)
    next=received.state;r=received.row
  }
  const wh=r.warehouseId!
  const balance=next.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===r.productId)
  if((balance?.quarantine||0)<r.qty-1e-6||(balance?.onHand||0)<r.qty-1e-6)return fail(s,`${r.code}: karantinda ${q3(balance?.quarantine||0)} ${itemUnit(s,r.productId)} bor, qaytarish ${r.qty} — avval qoldiqni tekshiring`)
  const own=(l:LotRecord)=>l.sourceType==='return'&&l.sourceId===r.id&&l.itemId===r.productId
  let reworkOrderId:string|undefined
  if(decision==='Omborga qaytarildi'){
    next=changeBalance(next,ctx,wh,r.productId,{quarantine:-r.qty})
    next={...next,lots:next.lots.map(l=>own(l)?{...l,status:'available' as const}:l)}
    next=retryWaitingOrders(next,ctx)
  }
  if(decision==='Scrap'){
    next=changeBalance(next,ctx,wh,r.productId,{onHand:-r.qty,quarantine:-r.qty})
    for(const a of r.allocations?.length?r.allocations:[{qty:r.qty,lot:r.lot}])next=addMove(next,ctx,{type:'QC Scrap -',itemId:r.productId,itemType:'finished',warehouseId:wh,qty:-a.qty,source:r.code,note:'Customer return → scrap',lot:a.lot})
    next={...next,lots:next.lots.map(l=>own(l)?{...l,qty:0,status:'hold' as const}:l)}
  }
  if(decision==='Rework'){
    // Only an order that made the returned lot is its source; otherwise the rework belongs to the return itself (B3-13).
    const origin=r.lot?lotOrigin(s,r.lot,r.productId):undefined
    const sourceOrder=origin?.sourceType==='production'?s.productionOrders.find(o=>o.id===origin.sourceId&&o.productId===r.productId):undefined
    const created=createProductionOrder(next,ctx,{productId:r.productId,quantity:r.qty,priority:'Yuqori',source:`Rework: ${r.code}`,reworkOf:sourceOrder?.id||r.id,warehouseId:wh})
    if(!created.result.ok)return fail(s,created.result.message)
    reworkOrderId=created.result.id
    // The returned units stay in quarantine for this rework order's Final pass, not for its source order's.
    next={...created.state,productionOrders:created.state.productionOrders.map(o=>o.id===reworkOrderId?{...o,qcHeld:r.qty}:o),lots:created.state.lots.map(l=>own(l)?{...l,status:'rework' as const}:l)}
  }
  const checkStatus:QualityCheck['status']=decision==='Omborga qaytarildi'?'Passed':decision==='Rework'?'Rework':'Scrap'
  next={...next,returns:next.returns.map(x=>x.id===id?{...r,status:decision,reworkOrderId}:x),qualityChecks:next.qualityChecks.map(q=>q.id===r.qualityCheckId&&q.status==='Pending'?{...q,status:checkStatus,date:stamp(ctx.now),inspectorId:ctx.user.id}:q)}
  next=logActivity(next,ctx,`Return disposition → ${decision}`,'Sotuv',r.code,decision==='Scrap'?'danger':'info')
  return ok(next,`${r.code}: ${decision}`)
}

/* ---------------------------------------------------------- inventory -- */

export function transferStock(s:S,ctx:Ctx,itemId:string,from:string,to:string,qty:number):Outcome{
  const amount=Number(qty)||0
  if(!itemId||!from||!to)return fail(s,'Item va omborlarni tanlang')
  if(from===to)return fail(s,'Manba va qabul qiluvchi ombor bir xil bo‘lmasin')
  if(amount<=0)return fail(s,'Miqdorni kiriting')
  const target=s.warehouses.find(w=>w.id===to)
  // Only into an existing, active warehouse that stores this kind of item (N-21 / B3-11).
  if(!target||target.status!=='Faol')return fail(s,'Qabul qiluvchi ombor mavjud emas yoki arxivlangan')
  const raw=!isProductItem(s,itemId)
  if(raw?!['Raw','Mixed','WIP'].includes(target.type):!['Finished','Mixed','WIP'].includes(target.type))return fail(s,`${target.name} (${target.type}) bu turdagi itemni saqlamaydi`)
  const source=s.stockBalances.find(b=>b.warehouseId===from&&b.itemId===itemId)
  if(!source||source.onHand-source.reserved-(source.quarantine||0)<amount)return fail(s,`Available qoldiq yetarli emas (${Math.floor(source?source.onHand-source.reserved-(source.quarantine||0):0)})`)
  const ref=nextRef(s,'TR',ctx.now)
  let next=changeBalance(s,ctx,from,itemId,{onHand:-amount})
  next=changeBalance(next,ctx,to,itemId,{onHand:amount},source.lot)
  const lotTake=takeLots(next,itemId,amount,ref,from)
  next=lotTake.state
  for(const a of lotTake.allocations){
    if(a.lot){
      const src=s.lots.find(l=>l.code===a.lot&&l.itemId===itemId&&l.warehouseId===from)
      // The copy keeps where the lot came from (PO / MO / return), so traceability and unbuild still find it (P1-29/30).
      if(src)next={...next,lots:[{...src,id:ctx.id('lot'),qty:a.qty,originalQty:a.qty,warehouseId:to,createdAt:stamp(ctx.now),consumedBy:[]},...next.lots]}
    }
    next=addMove(next,ctx,{type:'Transfer -',itemId,itemType:source.itemType,warehouseId:from,qty:-a.qty,source:ref,note:`→ ${s.warehouses.find(w=>w.id===to)?.name}`,lot:a.lot})
    next=addMove(next,ctx,{type:'Transfer +',itemId,itemType:source.itemType,warehouseId:to,qty:a.qty,source:ref,note:`← ${s.warehouses.find(w=>w.id===from)?.name}`,lot:a.lot})
  }
  next=retryWaitingOrders(next,ctx)
  return ok(logActivity(next,ctx,'Ombor transferi','Ombor',ref,'info',`${itemName(s,itemId)} ${amount}`),`${ref}: transfer yakunlandi`)
}

export function adjustStock(s:S,ctx:Ctx,itemId:string,warehouseId:string,delta:number,note:string):Outcome{
  const d=Number(delta)||0
  if(!d)return fail(s,'Farq 0 bo‘lmasligi kerak')
  if(!note.trim())return fail(s,'Adjustment sababini yozing')
  const b=s.stockBalances.find(x=>x.warehouseId===warehouseId&&x.itemId===itemId)
  if(!b&&d<0)return fail(s,'Stock line topilmadi')
  // Reserved and quarantined units are both promised; a count may not take stock below them (BUG-10).
  if(b&&b.onHand+d<b.reserved+(b.quarantine||0)-1e-6)return fail(s,`Qoldiq rezerv (${q3(b.reserved)}) va karantin (${q3(b.quarantine||0)}) yig‘indisidan kam bo‘lib qoladi`)
  const ref=nextRef(s,'ADJ',ctx.now)
  let next=changeBalance(s,ctx,warehouseId,itemId,{onHand:d})
  // Found stock of a lot-tracked item gets its own lot, so traceability keeps covering the whole balance (N-22).
  const material=s.rawMaterials.find(m=>m.id===itemId),product=s.products.find(p=>p.id===itemId)
  const lotTracked=material?material.lotTracking!==false:product?.tracking==='lot'
  let lot:string|undefined
  if(d>0&&lotTracked){
    lot=lotCode(next,material?.sku||product?.sku||itemId,ctx.now)
    next={...next,lots:[{id:ctx.id('lot'),code:lot,kind:'lot',itemId,itemType:product?'finished':'raw',qty:d,originalQty:d,warehouseId,status:'available',sourceType:'adjustment',sourceId:ref,sourceCode:ref,createdAt:stamp(ctx.now),consumedBy:[]},...next.lots]}
  }
  next=addMove(next,ctx,{type:d>0?'Adjustment +':'Adjustment -',itemId,itemType:isProductItem(s,itemId)?'finished':'raw',warehouseId,qty:d,source:ref,note,lot})
  if(d<0)next=takeLots(next,itemId,-d,ref,warehouseId).state
  if(d>0)next=retryWaitingOrders(next,ctx)
  next=lowStockSignals(next,ctx)
  return ok(logActivity(next,ctx,'Inventarizatsiya adjustment','Ombor',ref,'warning',`${itemName(s,itemId)} ${d>0?'+':''}${d} · ${note}`),`${ref}: qoldiq tuzatildi (${d>0?'+':''}${d})`)
}

export function countStock(s:S,ctx:Ctx,balanceId:string,counted:number,note:string):Outcome{
  const b=s.stockBalances.find(x=>x.id===balanceId)
  if(!b)return fail(s,'Stock line topilmadi')
  const value=Number(counted)
  if(!Number.isFinite(value)||value<0)return fail(s,'Sanalgan miqdor noto‘g‘ri')
  const delta=q3(value-b.onHand)
  if(!delta)return ok(logActivity(s,ctx,'Cycle count — farq yo‘q','Ombor',itemName(s,b.itemId),'success'),'Sanoq tizim qoldig‘i bilan mos keldi')
  return adjustStock(s,ctx,b.itemId,b.warehouseId,delta,note||'Cycle count')
}

/* -------------------------------------------------------- maintenance -- */

function setEquipmentStatus(s:S,equipmentId:string,status:ManufacturingState['equipment'][number]['status']):S{
  return {...s,equipment:s.equipment.map(e=>e.id===equipmentId?{...e,status}:e)}
}

export function startDowntime(s:S,ctx:Ctx,equipmentId:string,reason:DowntimeReason,note='',sourceId?:string):Outcome{
  const eq=s.equipment.find(e=>e.id===equipmentId)
  if(!eq)return fail(s,'Uskuna topilmadi')
  if(s.downtimeEvents.some(d=>d.equipmentId===equipmentId&&!d.end))return fail(s,`${eq.name} uchun ochiq downtime allaqachon mavjud`)
  let next:S={...s,downtimeEvents:[{id:ctx.id('dt'),equipmentId,workCenterId:eq.workCenterId,reason,start:stamp(ctx.now),minutes:0,note,sourceId},...s.downtimeEvents]}
  next=setEquipmentStatus(next,equipmentId,'To‘xtagan')
  // Pause any running operation on that work center.
  for(const o of next.productionOrders.filter(o=>o.workOrders.some(w=>w.workCenterId===eq.workCenterId&&w.status==='Jarayonda'))){
    for(const w of o.workOrders.filter(w=>w.workCenterId===eq.workCenterId&&w.status==='Jarayonda'))next=pauseWorkOrder(next,ctx,o.id,w.id).state
  }
  next=notify(next,ctx,'maintenance','Uskuna to‘xtadi',`${eq.name}: ${reason}${note?` — ${note}`:''}`,'danger','/equipment?view=downtime')
  return ok(logActivity(next,ctx,'Downtime boshlandi','Uskunalar',eq.name,'danger',reason),`${eq.name}: downtime ochildi`)
}

export function endDowntime(s:S,ctx:Ctx,eventId:string):Outcome{
  const ev=s.downtimeEvents.find(d=>d.id===eventId)
  if(!ev||ev.end)return fail(s,'Ochiq downtime topilmadi')
  const end=stamp(ctx.now),minutes=minutesBetween(ev.start,end)
  let next:S={...s,downtimeEvents:s.downtimeEvents.map(d=>d.id===eventId?{...d,end,minutes}:d)}
  // Back in service, but a machine whose service date is near stays flagged for planners (N-26).
  const eq=s.equipment.find(e=>e.id===ev.equipmentId)
  next=setEquipmentStatus(next,ev.equipmentId,eq?.nextMaintenance&&eq.nextMaintenance<=addDays(isoDate(ctx.now),3)?'Servis yaqin':'Ishlamoqda')
  next={...next,equipment:next.equipment.map(e=>e.id===ev.equipmentId?{...e,downtime:Math.round((e.downtime+minutes/60)*10)/10}:e)}
  return ok(logActivity(next,ctx,'Downtime yopildi','Uskunalar',s.equipment.find(e=>e.id===ev.equipmentId)?.name,'success',`${minutes} min`),`Downtime yopildi (${minutes} min)`)
}

const maintEvent=(ctx:Ctx,action:string,note?:string)=>({at:stamp(ctx.now),by:ctx.user?.id||'',action,...(note?{note}:{})})
const withMaintEvent=(s:S,id:string,patch:Partial<S['maintenanceOrders'][number]>,event:ReturnType<typeof maintEvent>):S=>({...s,maintenanceOrders:s.maintenanceOrders.map(m=>m.id===id?{...m,...patch,history:[...(m.history||[]),event]}:m)})
/** The first active employee who may do maintenance work (equipment.edit), the department's people first. */
const defaultTechnician=(s:S,fallback:string)=>{
  const able=s.employees.filter(e=>e.status!=='Arxiv'&&hasPermission(roleOf(s,e.id),'equipment','edit'))
  return (able.find(e=>e.department==='Maintenance')||s.employees.find(e=>e.department==='Maintenance'&&e.status!=='Arxiv')||able[0])?.id||fallback
}
/** Why someone cannot be the technician of a maintenance order. */
function technicianBlocker(s:S,id:string){
  const e=s.employees.find(x=>x.id===id)
  if(!e)return 'Texnik tanlanmagan'
  if(e.status==='Arxiv')return `${e.name} arxivlangan`
  if(!hasPermission(roleOf(s,e.id),'equipment','edit')&&!hasPermission(roleOf(s,e.id),'equipment','execute'))return `${e.name}: roli texnik xizmat ishlarini bajara olmaydi`
  return null
}
const MAINTENANCE_TYPES=['Preventive','Corrective','Emergency']

export type MaintenanceInput={equipmentId:string;type:S['maintenanceOrders'][number]['type'];scheduled:string;plannedHours?:number;technicianId?:string;note?:string;
  /** Plan it although another service of the same machine overlaps (both stay; the reason is recorded). */
  override?:string}

/** Validated schedule of a maintenance order: start, duration, technician and overlaps with other services of the machine. */
function maintenancePlanCheck(s:S,ctx:Ctx,p:MaintenanceInput,except?:string):{start:string;hours?:number;technicianId:string}|{error:string;code?:'needs-override'}{
  const eq=s.equipment.find(e=>e.id===p.equipmentId)
  if(!eq)return {error:'Uskuna topilmadi'}
  if(!MAINTENANCE_TYPES.includes(p.type))return {error:'Maintenance turi noto‘g‘ri'}
  const start=(p.scheduled||'').trim().length===10?`${p.scheduled.trim()} 09:00`:(p.scheduled||'').trim()
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(start))return {error:'Rejalashtirilgan sana/vaqt noto‘g‘ri'}
  if(!except&&start.slice(0,10)<isoDate(ctx.now))return {error:`${start.slice(0,10)} o‘tgan sana — bugundan keyingi sanani tanlang`}
  const hours=p.plannedHours===undefined||p.plannedHours===null||String(p.plannedHours)===''?undefined:Number(p.plannedHours)
  if(hours!==undefined&&(!Number.isFinite(hours)||hours<=0||hours>168))return {error:'Davomiylik 0 dan katta va 168 soatdan oshmasin'}
  const technicianId=p.technicianId||defaultTechnician(s,ctx.user.id)
  const tech=technicianBlocker(s,technicianId)
  if(tech)return {error:tech}
  const end=hours?stamp(new Date(parseDate(start).getTime()+hours*3600000)):`${start.slice(0,10)} 23:59`
  const clash=maintenanceClashes(s,eq.id,start,end,except)
  if(clash.length&&!p.override?.trim())return {error:`${eq.name}: ${clash.map(m=>`${m.code} (${m.scheduled})`).join(', ')} bilan vaqt kesishadi — sababini yozib tasdiqlang yoki boshqa vaqt tanlang`,code:'needs-override'}
  return {start,hours,technicianId}
}

/** Plans a maintenance order directly (corrective / emergency work, or a preventive service outside the plan). */
export function createMaintenanceOrder(s:S,ctx:Ctx,p:MaintenanceInput):Outcome{
  const checked=maintenancePlanCheck(s,ctx,p)
  if('error' in checked)return {state:s,result:{ok:false,message:checked.error,code:checked.code}}
  const eq=s.equipment.find(e=>e.id===p.equipmentId)!
  const id=ctx.id('ma'),code=nextCode(s.maintenanceOrders.map(m=>m.code),p.type==='Preventive'?'PM':'MA',ctx.now,2)
  const override=p.override?.trim()?{by:ctx.user.id,at:stamp(ctx.now),reason:p.override.trim()}:undefined
  let next:S={...s,maintenanceOrders:[{id,code,equipmentId:eq.id,type:p.type,status:'Rejada',scheduled:checked.start,plannedHours:checked.hours,technicianId:checked.technicianId,cost:0,note:(p.note||'').trim()||`${p.type} maintenance`,override,history:[maintEvent(ctx,'Rejalashtirildi',override?`Kesishuv tasdiqlandi: ${override.reason}`:undefined)]},...s.maintenanceOrders]}
  if(p.type==='Emergency')next=notify(next,ctx,'maintenance','Favqulodda maintenance',`${eq.name}: ${code} · ${checked.start}`,'danger','/equipment?view=maintenance&id='+id)
  next=logActivity(next,ctx,'Maintenance rejalashtirildi','Uskunalar',code,p.type==='Emergency'?'danger':'info',`${eq.name} · ${p.type} · ${checked.start}${checked.hours?` · ${checked.hours} soat`:''}`)
  return ok(next,`${code} rejalashtirildi`,id)
}

/** Reschedules / reassigns a planned order (not one that started). */
export function updateMaintenanceOrder(s:S,ctx:Ctx,id:string,patch:{scheduled?:string;plannedHours?:number;technicianId?:string;note?:string;override?:string}):Outcome{
  const m=s.maintenanceOrders.find(x=>x.id===id)
  if(!m)return fail(s,'Maintenance topilmadi')
  if(m.status!=='Rejada')return fail(s,`${m.code}: faqat rejalashtirilgan buyurtma o‘zgartiriladi (holat: ${m.status})`)
  const checked=maintenancePlanCheck(s,ctx,{equipmentId:m.equipmentId,type:m.type,scheduled:patch.scheduled??m.scheduled,plannedHours:'plannedHours' in patch?patch.plannedHours:m.plannedHours,technicianId:patch.technicianId??m.technicianId,override:patch.override},id)
  if('error' in checked)return {state:s,result:{ok:false,message:checked.error,code:checked.code}}
  if(patch.scheduled&&checked.start.slice(0,10)<isoDate(ctx.now))return fail(s,'O‘tgan sanaga ko‘chirib bo‘lmaydi')
  const changes=[checked.start!==m.scheduled&&`${m.scheduled} → ${checked.start}`,checked.hours!==m.plannedHours&&`${m.plannedHours??'—'} → ${checked.hours??'—'} soat`,checked.technicianId!==m.technicianId&&`texnik → ${s.employees.find(e=>e.id===checked.technicianId)?.name}`].filter(Boolean).join(' · ')
  const override=patch.override?.trim()?{by:ctx.user.id,at:stamp(ctx.now),reason:patch.override.trim()}:m.override
  const next=withMaintEvent(s,id,{scheduled:checked.start,plannedHours:checked.hours,technicianId:checked.technicianId,note:patch.note!==undefined?patch.note.trim()||m.note:m.note,override},maintEvent(ctx,'O‘zgartirildi',changes||undefined))
  return ok(logActivity(next,ctx,'Maintenance o‘zgartirildi','Uskunalar',m.code,'info',changes),`${m.code} saqlandi`,id)
}

export function approveMaintenanceRequest(s:S,ctx:Ctx,id:string):Outcome{
  const r=s.maintenanceRequests.find(x=>x.id===id)
  if(!r||r.status!=='Yangi')return fail(s,'Faqat yangi so‘rov tasdiqlanadi')
  if(!s.equipment.some(e=>e.id===r.equipmentId))return fail(s,'So‘rovdagi uskuna topilmadi')
  const orderId=ctx.id('ma'),code=nextCode(s.maintenanceOrders.map(m=>m.code),'MA',ctx.now,2)
  const technician=defaultTechnician(s,ctx.user.id)
  // An undated request is planned for today; its expected stop length becomes the planned duration.
  const scheduled=!r.scheduled?`${isoDate(ctx.now)} 09:00`:r.scheduled.length===10?`${r.scheduled} 09:00`:r.scheduled
  let next:S={...s,maintenanceRequests:s.maintenanceRequests.map(x=>x.id===id?{...x,status:'Tasdiqlangan' as const}:x),maintenanceOrders:[{id:orderId,code,equipmentId:r.equipmentId,type:r.type,status:'Rejada',scheduled,plannedHours:r.downtimeHours>0?r.downtimeHours:undefined,technicianId:technician,cost:0,note:r.reason,requestId:r.id,history:[maintEvent(ctx,'So‘rovdan rejalashtirildi',r.code)]},...s.maintenanceOrders]}
  next=logActivity(next,ctx,'Maintenance so‘rovi tasdiqlandi','Uskunalar',r.code,'success',`→ ${code}`)
  return ok(next,`${r.code} tasdiqlandi · ${code} rejalashtirildi`,orderId)
}

export function startMaintenance(s:S,ctx:Ctx,id:string):Outcome{
  const m=s.maintenanceOrders.find(x=>x.id===id)
  if(!m||m.status!=='Rejada')return fail(s,'Faqat rejalashtirilgan maintenance boshlanadi')
  const other=s.maintenanceOrders.find(x=>x.id!==id&&x.equipmentId===m.equipmentId&&x.status==='Jarayonda')
  if(other)return fail(s,`${other.code} shu uskunada davom etmoqda — avval uni yakunlang`)
  let next:S=withMaintEvent(s,id,{status:'Jarayonda',startedAt:stamp(ctx.now)},maintEvent(ctx,'Boshlandi'))
  next={...next,maintenanceRequests:next.maintenanceRequests.map(r=>r.id===m.requestId?{...r,status:'Jarayonda' as const,startedAt:stamp(ctx.now)}:r)}
  // A machine that is already down (breakdown) is repaired within that stop instead of being refused (BUG-11).
  next=adoptOrStartDowntime(next,ctx,m.equipmentId,'Maintenance',m.code,m.id)
  return ok(logActivity(next,ctx,'Maintenance boshlandi','Uskunalar',m.code),`${m.code} boshlandi — uskuna to‘xtatildi`)
}

/**
 * Closes the work: ends its machine stop (its minutes become the order's downtime), books the cost, and — for a
 * preventive service — restarts the plan: next date from the plan interval, runtime counter from the latest reading.
 */
export function completeMaintenance(s:S,ctx:Ctx,id:string,cost?:number,note=''):Outcome{
  const m=s.maintenanceOrders.find(x=>x.id===id)
  if(!m||m.status!=='Jarayonda')return fail(s,'Maintenance avval boshlanishi kerak')
  const eq=s.equipment.find(e=>e.id===m.equipmentId)
  const finalCost=Number(cost??m.cost)
  if(!Number.isFinite(finalCost)||finalCost<0)return fail(s,'Xarajat manfiy bo‘lmasin')
  let next=s
  const open=next.downtimeEvents.find(d=>d.equipmentId===m.equipmentId&&!d.end)
  if(open)next=endDowntime(next,ctx,open.id).state
  const stopMinutes=next.downtimeEvents.filter(d=>d.sourceId===m.id).reduce((a,d)=>a+d.minutes,0)
  const today=isoDate(ctx.now)
  const preventive=m.type==='Preventive'
  next=withMaintEvent(next,id,{status:'Yakunlangan',completed:stamp(ctx.now),cost:finalCost,downtimeMinutes:stopMinutes},maintEvent(ctx,'Yakunlandi',note.trim()||undefined))
  next={...next,
    maintenanceRequests:next.maintenanceRequests.map(r=>r.id===m.requestId?{...r,status:'Yakunlangan' as const}:r),
    equipment:next.equipment.map(e=>{
      if(e.id!==m.equipmentId)return e
      const plan=planOf(e)
      // Corrective work fixes a failure; it does not move the preventive plan.
      return preventive
        ?{...e,status:'Ishlamoqda' as const,lastMaintenance:today,nextMaintenance:nextDueDate(plan,today)||(plan?.unit==='runtime'?'':e.nextMaintenance),runtimeAtService:e.runtimeHours??e.runtimeAtService,maintenanceCost:e.maintenanceCost+finalCost}
        :{...e,status:'Ishlamoqda' as const,lastMaintenance:today,maintenanceCost:e.maintenanceCost+finalCost}
    }),
  }
  if(finalCost>0)next={...next,expenses:[{id:ctx.id('ex'),date:today,type:'Maintenance',sourceId:m.equipmentId,amount:finalCost,note:`${m.code} · ${eq?.name||''}`},...next.expenses]}
  return ok(logActivity(next,ctx,'Maintenance yakunlandi','Uskunalar',m.code,'success',`${stopMinutes} min to‘xtash${finalCost?` · ${finalCost}`:''}`),`${m.code} yakunlandi`)
}

export function cancelMaintenance(s:S,ctx:Ctx,id:string,reason=''):Outcome{
  const m=s.maintenanceOrders.find(x=>x.id===id)
  if(!m||m.status!=='Rejada')return fail(s,'Faqat rejalashtirilgan maintenance bekor qilinadi')
  const next=withMaintEvent(s,id,{status:'Bekor'},maintEvent(ctx,'Bekor qilindi',reason.trim()||undefined))
  return ok(logActivity(next,ctx,'Maintenance bekor qilindi','Uskunalar',m.code,'warning',reason.trim()),`${m.code} bekor qilindi`)
}

/**
 * Sets a machine's preventive plan; the next calendar date is recalculated from the last service (or today), unless a
 * planner gives the next date explicitly (not in the past).
 */
export function saveMaintenancePlan(s:S,ctx:Ctx,equipmentId:string,plan:{unit:string;interval:number;durationHours?:number}|null,nextDate?:string):Outcome{
  const eq=s.equipment.find(e=>e.id===equipmentId)
  if(!eq)return fail(s,'Uskuna topilmadi')
  const today=isoDate(ctx.now)
  if(!plan){
    const next=logActivity({...s,equipment:s.equipment.map(e=>e.id===equipmentId?{...e,maintenancePlan:undefined,maintenanceIntervalDays:0,nextMaintenance:''}:e)},ctx,'Preventive reja olib tashlandi','Uskunalar',eq.name,'warning')
    return ok(next,`${eq.name}: preventive reja olib tashlandi`)
  }
  if(!['day','week','month','runtime'].includes(plan.unit))return fail(s,'Interval turi noto‘g‘ri')
  const interval=Number(plan.interval)
  if(!Number.isInteger(interval)||interval<=0)return fail(s,'Interval musbat butun son bo‘lsin')
  const duration=plan.durationHours===undefined||plan.durationHours===null||String(plan.durationHours)===''?undefined:Number(plan.durationHours)
  if(duration!==undefined&&(!Number.isFinite(duration)||duration<=0||duration>168))return fail(s,'Servis davomiyligi 0–168 soat')
  const clean={unit:plan.unit as 'day'|'week'|'month'|'runtime',interval,durationHours:duration}
  if(nextDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)||nextDate<today))return fail(s,'Keyingi servis sanasi bugundan oldin bo‘lmasin')
  const computed=clean.unit==='runtime'?'':(nextDate||nextDueDate(clean,eq.lastMaintenance||today)||'')
  const next=logActivity({...s,equipment:s.equipment.map(e=>e.id===equipmentId?{...e,maintenancePlan:clean,maintenanceIntervalDays:clean.unit==='day'?interval:clean.unit==='week'?interval*7:e.maintenanceIntervalDays,nextMaintenance:computed,runtimeAtService:clean.unit==='runtime'?(e.runtimeAtService??e.runtimeHours):e.runtimeAtService}:e)},ctx,'Preventive reja saqlandi','Uskunalar',eq.name,'info',`${interval} ${clean.unit}${duration?` · ${duration} soat`:''}`)
  return ok(next,`${eq.name}: preventive reja saqlandi${computed?` · keyingi servis ${computed}`:''}`)
}

/** Records a running-hours meter reading; readings only grow. */
export function recordEquipmentRuntime(s:S,ctx:Ctx,equipmentId:string,hours:number):Outcome{
  const eq=s.equipment.find(e=>e.id===equipmentId)
  if(!eq)return fail(s,'Uskuna topilmadi')
  const value=Math.round(Number(hours)*10)/10
  if(!Number.isFinite(value)||value<0)return fail(s,'Ish soati manfiy bo‘lmasin')
  if(eq.runtimeHours!==undefined&&value<eq.runtimeHours)return fail(s,`Hisoblagich kamaya olmaydi (oxirgi: ${eq.runtimeHours} soat)`)
  let next=logActivity({...s,equipment:s.equipment.map(e=>e.id===equipmentId?{...e,runtimeHours:value,runtimeReadAt:stamp(ctx.now),runtimeAtService:e.runtimeAtService??(eq.runtimeHours===undefined?value:undefined)}:e)},ctx,'Ish soati qayd etildi','Uskunalar',eq.name,'info',`${eq.runtimeHours??'—'} → ${value} soat`)
  const due=maintenanceDue(next.equipment.find(e=>e.id===equipmentId)!,isoDate(ctx.now))
  if(due.plan?.unit==='runtime'&&(due.state==='due'||due.state==='overdue'))next=notify(next,ctx,'maintenance','Servis vaqti keldi',`${eq.name}: ${due.reason}`,'warning','/equipment?view=preventive')
  return ok(next,`${eq.name}: ${value} soat qayd etildi${due.plan?.unit==='runtime'?` · ${due.reason}`:''}`)
}

/**
 * Preventive orders for every machine whose plan falls due within the horizon (overdue ones are planned for today);
 * machines without a plan or without the data a plan needs are reported, not guessed.
 */
export function planPreventiveMaintenance(s:S,ctx:Ctx,horizonDays=14):Outcome{
  const today=isoDate(ctx.now),until=addDays(today,horizonDays)
  let next=s,created=0
  const skipped:string[]=[]
  for(const e of s.equipment){
    if(next.maintenanceOrders.some(m=>m.equipmentId===e.id&&m.type==='Preventive'&&['Rejada','Jarayonda'].includes(m.status)))continue
    const due=maintenanceDue(e,today)
    if(due.state==='no-plan'||due.state==='no-data'){skipped.push(`${e.name}: ${due.reason}`);continue}
    const inWindow=due.dueDate?due.dueDate<=until:['soon','due','overdue'].includes(due.state)
    if(!inWindow)continue
    const date=!due.dueDate||due.dueDate<today?today:due.dueDate
    const code=nextCode(next.maintenanceOrders.map(m=>m.code),'PM',ctx.now,2)
    const id=ctx.id('ma')
    next={...next,maintenanceOrders:[{id,code,equipmentId:e.id,type:'Preventive',status:'Rejada',scheduled:`${date} 09:00`,plannedHours:due.plan?.durationHours,technicianId:defaultTechnician(s,ctx.user.id),cost:0,note:`Rejali servis · ${due.reason}`,history:[maintEvent(ctx,'Reja bo‘yicha yaratildi',due.reason)]},...next.maintenanceOrders]}
    if(due.state==='overdue')next=notify(next,ctx,'maintenance','Servis kechikdi',`${e.name}: ${due.reason} — ${code} bugunga rejalashtirildi`,'warning','/equipment?view=maintenance&id='+id)
    created+=1
  }
  const note=skipped.length?` · ${skipped.length} ta uskunada reja ma’lumoti yo‘q`:''
  if(!created)return ok(s,`${horizonDays} kun ichida yangi preventive maintenance kerak emas${note}`)
  return ok(logActivity(next,ctx,'Preventive maintenance rejalashtirildi','Uskunalar',undefined,'info',`${created} ta${skipped.length?` · o‘tkazildi: ${skipped.join('; ')}`:''}`),`${created} ta preventive maintenance order yaratildi${note}`)
}

/** Starts a downtime for the work, or — when the machine is already stopped — makes the open stop part of it, so ending the work ends it. */
function adoptOrStartDowntime(s:S,ctx:Ctx,equipmentId:string,reason:DowntimeReason,note:string,sourceId:string):S{
  const open=s.downtimeEvents.find(d=>d.equipmentId===equipmentId&&!d.end)
  if(open)return {...s,downtimeEvents:s.downtimeEvents.map(d=>d.id===open.id?{...d,sourceId:d.sourceId||sourceId,note:d.note?`${d.note} · ${note}`:note}:d)}
  const dt=startDowntime(s,ctx,equipmentId,reason,note,sourceId)
  return dt.result.ok?dt.state:s
}

const REPAIR_FLOW:Record<string,ManufacturingState['repairOrders'][number]['status']>={'Yangi':'Diagnostika','Diagnostika':'Ta’mirda','Ta’mirda':'Sinov','Sinov':'Yakunlangan'}
export function advanceRepair(s:S,ctx:Ctx,id:string):Outcome{
  const r=s.repairOrders.find(x=>x.id===id)
  const target=r&&REPAIR_FLOW[r.status]
  if(!r||!target)return fail(s,'Repair order yopilgan')
  let next:S={...s,repairOrders:s.repairOrders.map(x=>x.id===id?{...x,status:target}:x)}
  if(target==='Ta’mirda')next=adoptOrStartDowntime(next,ctx,r.equipmentId,'Unplanned stop',r.issue,r.id)
  if(target==='Yakunlangan'){
    const open=next.downtimeEvents.find(d=>d.equipmentId===r.equipmentId&&!d.end&&d.sourceId===r.id)
    if(open)next=endDowntime(next,ctx,open.id).state
    // Parts and the technician's hours are a real maintenance cost of the machine (N-26).
    const rate=s.employees.find(e=>e.id===r.technicianId)?.hourlyCost||0
    const cost=Math.round(Math.max(0,Number(r.partsCost)||0)+Math.max(0,Number(r.laborHours)||0)*rate)
    if(cost>0){
      const eq=s.equipment.find(e=>e.id===r.equipmentId)
      next={...next,expenses:[{id:ctx.id('ex'),date:isoDate(ctx.now),type:'Maintenance',sourceId:r.equipmentId,amount:cost,note:`${r.code} · ${eq?.name||''} · ta’mir`},...next.expenses],equipment:next.equipment.map(e=>e.id===r.equipmentId?{...e,maintenanceCost:e.maintenanceCost+cost}:e)}
    }
  }
  return ok(logActivity(next,ctx,`Repair → ${target}`,'Uskunalar',r.code),`${r.code}: ${target}`)
}

/* -------------------------------------------------------- engineering -- */

function bumpVersion(version:string){
  const n=Number.parseFloat(version.replace(/[^0-9.]/g,''))||1
  return `v${(Math.round((n+.1)*10)/10).toFixed(1)}`
}

const OPEN_ECO:EngineeringChange['status'][]=['Draft','Review','Approved']
/** The open engineering change that owns a draft revision. */
const ecoOf=(s:S,bomId:string,except?:string)=>s.engineeringChanges.find(e=>e.newBomId===bomId&&OPEN_ECO.includes(e.status)&&e.id!==except)
const sameVariant=(a?:string,b?:string)=>(a||'')===(b||'')
const variantLabel=(s:S,productId:string,variantId?:string)=>variantId?` · ${s.products.find(p=>p.id===productId)?.variants.find(v=>v.id===variantId)?.code||variantId}`:''

/**
 * Why a routing cannot drive job cards: unnamed operations, missing or archived work centers, negative or empty
 * times, no operator, a dependency on a step that is not in the routing, or a dependency loop.
 */
export function routingBlocker(s:S,ops:BomOperation[]):string|null{
  const ids=new Set<string>()
  for(const [i,o] of ops.entries()){
    if(!o.name?.trim())return `${i+1}-operatsiya: nom kiritilmagan`
    if(!o.id||ids.has(o.id))return `${o.name}: operatsiya identifikatori takrorlangan`
    ids.add(o.id)
    const wc=s.workCenters.find(w=>w.id===o.workCenterId)
    if(!wc)return `${o.name}: work center topilmadi`
    if(wc.status==='Arxiv')return `${o.name}: ${wc.name} arxivlangan`
    if(!Number.isFinite(Number(o.setupMin))||o.setupMin<0||!Number.isFinite(Number(o.runMin))||o.runMin<0)return `${o.name}: setup va run vaqti manfiy bo‘lmasin`
    if(o.setupMin+o.runMin<=0)return `${o.name}: setup yoki run vaqti 0 dan katta bo‘lsin`
    if(!Number.isInteger(Number(o.employeeCount))||o.employeeCount<1)return `${o.name}: operatorlar soni butun son va kamida 1`
  }
  for(const o of ops)for(const d of o.dependsOn||[]){
    if(d===o.id)return `${o.name}: operatsiya o‘ziga bog‘liq bo‘la olmaydi`
    if(!ids.has(d))return `${o.name}: bog‘liq operatsiya bu routingda yo‘q`
  }
  const pending=new Map(ops.map(o=>[o.id,o.dependsOn||[]]))
  let moved=true
  while(pending.size&&moved){moved=false;for(const [id,deps] of pending)if(deps.every(d=>!pending.has(d))){pending.delete(id);moved=true}}
  if(pending.size)return `Operatsiyalar bog‘liqligi aylanma: ${[...pending.keys()].map(id=>ops.find(o=>o.id===id)?.name).join(', ')}`
  return null
}

/** Content an approval covers: everything but bookkeeping fields (id, status, dates of creation and release). */
export function bomFingerprint(b:Bom){
  return JSON.stringify({c:b.components.map(c=>[c.materialId,c.qty,c.unit,c.waste,c.subBomId||'']),o:b.operations.map(o=>[o.id,o.name,o.workCenterId,o.setupMin,o.runMin,o.employeeCount,o.instructions,o.qualityCheck,(o.dependsOn||[]).join(','),o.worksheet||'',Boolean(o.barcodeStep)]),
    b:(b.byProducts||[]).map(x=>[x.productId,x.qty,x.unit]),w:b.waste,v:b.version,e:b.effectiveDate,variant:b.variantId||'',n:b.notes})
}

/** Field-level difference between two revisions: what an engineering change adds, removes or changes (old → proposed). */
export function ecoChanges(s:S,from?:Bom,to?:Bom):EcoChange[]{
  if(!from||!to)return []
  const out:EcoChange[]=[]
  const wc=(id:string)=>s.workCenters.find(w=>w.id===id)?.name||id
  for(const c of to.components){
    const old=from.components.find(x=>x.materialId===c.materialId),name=itemName(s,c.materialId)
    if(!old){out.push({kind:'add',area:'component',target:name,proposed:`${c.qty} ${c.unit}`,text:`${name} qo‘shildi (${c.qty} ${c.unit}, waste ${c.waste}%)`});continue}
    if(old.qty!==c.qty)out.push({kind:'change',area:'component',target:name,field:'qty',old:`${old.qty} ${old.unit}`,proposed:`${c.qty} ${c.unit}`,text:`${name}: miqdor ${old.qty} → ${c.qty} ${c.unit}`})
    if(old.waste!==c.waste)out.push({kind:'change',area:'component',target:name,field:'waste',old:`${old.waste}%`,proposed:`${c.waste}%`,text:`${name}: waste ${old.waste}% → ${c.waste}%`})
    if((old.subBomId||'')!==(c.subBomId||''))out.push({kind:'change',area:'component',target:name,field:'subBom',old:old.subBomId||'—',proposed:c.subBomId||'—',text:`${name}: sub-BOM o‘zgardi`})
  }
  for(const c of from.components)if(!to.components.some(x=>x.materialId===c.materialId)){const name=itemName(s,c.materialId);out.push({kind:'remove',area:'component',target:name,old:`${c.qty} ${c.unit}`,text:`${name} olib tashlandi`})}
  for(const o of to.operations){
    const old=from.operations.find(x=>x.id===o.id)||from.operations.find(x=>x.name===o.name)
    if(!old){out.push({kind:'add',area:'operation',target:o.name,proposed:`${wc(o.workCenterId)} · ${o.setupMin}+${o.runMin} min`,text:`Operatsiya qo‘shildi: ${o.name}`});continue}
    const fields:[string,string,string][]=[['name',old.name,o.name],['setupMin',`${old.setupMin} min`,`${o.setupMin} min`],['runMin',`${old.runMin} min`,`${o.runMin} min`],['workCenter',wc(old.workCenterId),wc(o.workCenterId)],['employees',String(old.employeeCount),String(o.employeeCount)],['instructions',old.instructions,o.instructions],['qualityCheck',old.qualityCheck?'ha':'yo‘q',o.qualityCheck?'ha':'yo‘q'],['dependsOn',(old.dependsOn||[]).join(','),(o.dependsOn||[]).join(',')]]
    for(const [field,a,b] of fields)if(a!==b)out.push({kind:'change',area:'operation',target:o.name,field,old:a,proposed:b,text:`${o.name}: ${field==='instructions'?'ko‘rsatma yangilandi':field==='dependsOn'?'bog‘liqlik o‘zgardi':`${field} ${a} → ${b}`}`})
  }
  for(const o of from.operations)if(!to.operations.some(x=>x.id===o.id||x.name===o.name))out.push({kind:'remove',area:'operation',target:o.name,old:wc(o.workCenterId),text:`Operatsiya olib tashlandi: ${o.name}`})
  for(const b of to.byProducts||[]){const old=(from.byProducts||[]).find(x=>x.productId===b.productId),name=itemName(s,b.productId);if(!old)out.push({kind:'add',area:'byproduct',target:name,proposed:`${b.qty} ${b.unit}`,text:`By-product qo‘shildi: ${name}`});else if(old.qty!==b.qty)out.push({kind:'change',area:'byproduct',target:name,field:'qty',old:String(old.qty),proposed:String(b.qty),text:`${name}: by-product ${old.qty} → ${b.qty}`})}
  for(const b of from.byProducts||[])if(!(to.byProducts||[]).some(x=>x.productId===b.productId))out.push({kind:'remove',area:'byproduct',target:itemName(s,b.productId),text:`By-product olib tashlandi: ${itemName(s,b.productId)}`})
  if(from.waste!==to.waste)out.push({kind:'change',area:'header',target:'BOM',field:'waste',old:`${from.waste}%`,proposed:`${to.waste}%`,text:`Umumiy waste ${from.waste}% → ${to.waste}%`})
  return out
}

export function createBomDraft(s:S,ctx:Ctx,productId:string,fromBomId?:string,variantId?:string):Outcome{
  const product=s.products.find(p=>p.id===productId)
  if(!product)return fail(s,'Mahsulot tanlanmagan')
  const picked=variantFor(s,productId,variantId)
  if('error' in picked)return fail(s,picked.error)
  const base=(fromBomId&&s.boms.find(b=>b.id===fromBomId))||activeBomFor(s,productId,variantId)
  const existing=s.boms.filter(b=>b.productId===productId)
  if(existing.some(b=>b.status==='Draft'&&sameVariant(b.variantId,variantId)))return fail(s,`Bu mahsulot${variantLabel(s,productId,variantId)} uchun Draft BOM allaqachon mavjud — uni tahrirlang`)
  const id=ctx.id('bom')
  const own=base?.productId===productId
  const version=existing.length?bumpVersion(existing.map(b=>b.version).sort().at(-1)||'v1.0'):'v1.0'
  const code=own?base!.code:`BOM-${product.sku.replace(/^FG-/,'')}`
  // A revision of another product's BOM (duplicate) starts that product's own history.
  const bom:Bom=base
    ?{...clone(base),id,code,productId,variantId:variantId||undefined,version,revision:own?(Math.max(0,...existing.map(b=>b.revision||0))+1):1,status:'Draft',effectiveDate:addDays(isoDate(ctx.now),7),previousBomId:own?base.id:undefined,createdAt:stamp(ctx.now),
      components:base.components.filter(c=>c.materialId!==productId).map(c=>({...c,id:ctx.id('bc')})),operations:base.operations.map(o=>({...o})),releasedAt:undefined,releasedBy:undefined,ecoId:undefined,archivedAt:undefined}
    :{id,code,productId,variantId:variantId||undefined,version,revision:1,status:'Draft',effectiveDate:isoDate(ctx.now),waste:0,components:[],operations:[],byProducts:[],notes:'',createdAt:stamp(ctx.now)}
  const next=logActivity({...s,boms:[bom,...s.boms]},ctx,'BOM draft yaratildi','PLM',bom.code,'info',`${version}${variantLabel(s,productId,variantId)}${base&&!own?` · ${base.code} ${base.version} nusxasi`:''}`)
  return ok(next,`${bom.code} ${version} draft yaratildi`,id)
}

export function saveBom(s:S,ctx:Ctx,bom:Bom):Outcome{
  if(!bom.productId)return fail(s,'Mahsulot tanlanmagan')
  const current=s.boms.find(b=>b.id===bom.id)
  // Released and archived revisions are history that orders, costs and ECOs point at: they never change.
  if(current&&current.status!=='Draft')return fail(s,`${current.code} ${current.version} — ${current.status==='Faol'?'faol':'arxiv'} revision o‘zgartirilmaydi. Yangi revision (draft) yarating`)
  if(!current&&bom.status!=='Draft')return fail(s,'Yangi BOM faqat Draft sifatida saqlanadi')
  if(current&&current.productId!==bom.productId)return fail(s,'BOM mahsulotini almashtirib bo‘lmaydi')
  const locked=current&&ecoOf(s,current.id)
  if(locked&&locked.status!=='Draft')return fail(s,`${locked.code} ${locked.status==='Review'?'ko‘rib chiqilmoqda':'tasdiqlangan'} — draft qulflangan. O‘zgartirish uchun ECO’ni rad eting`)
  const product=s.products.find(p=>p.id===bom.productId)
  if(!product)return fail(s,'Mahsulot topilmadi')
  if(bom.variantId){const v=variantFor(s,bom.productId,bom.variantId);if('error' in v)return fail(s,v.error)}
  if(s.boms.some(b=>b.id!==bom.id&&b.productId===bom.productId&&b.status==='Draft'&&sameVariant(b.variantId,bom.variantId)))return fail(s,`Bu mahsulot${variantLabel(s,bom.productId,bom.variantId)} uchun boshqa Draft BOM bor`)
  if(!bom.version.trim())return fail(s,'BOM versiyasi majburiy')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(bom.effectiveDate||''))return fail(s,'Effective date noto‘g‘ri')
  if(!Number.isFinite(Number(bom.waste))||bom.waste<0||bom.waste>100)return fail(s,'Umumiy waste 0–100% oralig‘ida bo‘lsin')
  if(bom.components.some(c=>!s.rawMaterials.some(m=>m.id===c.materialId)&&!s.products.some(p=>p.id===c.materialId)))return fail(s,'BOM’da mavjud bo‘lmagan komponent bor')
  for(const b of bom.byProducts||[]){
    const by=s.products.find(p=>p.id===b.productId)
    if(!by)return fail(s,'By-product mahsuloti topilmadi')
    if(by.id===bom.productId)return fail(s,'Mahsulot o‘ziga by-product bo‘la olmaydi')
    if(!Number.isFinite(Number(b.qty))||b.qty<=0)return fail(s,`${by.name}: by-product miqdori 0 dan katta bo‘lsin`)
    if(b.unit!==by.unit)return fail(s,`${by.name}: by-product birligi (${b.unit}) ombor birligiga (${by.unit}) mos emas`)
  }
  const routing=routingBlocker(s,bom.operations)
  if(routing)return fail(s,routing)
  if(bom.components.some(c=>!c.materialId||!Number.isFinite(c.qty)||c.qty<=0))return fail(s,'BOM komponentlarida material va musbat miqdor shart')
  if(bom.components.some(c=>!Number.isFinite(c.waste)||c.waste<0||c.waste>100))return fail(s,'Waste 0–100% oralig‘ida bo‘lishi kerak')
  const ids=bom.components.map(c=>c.materialId)
  if(new Set(ids).size!==ids.length)return fail(s,'Bir material BOM’da takrorlangan. Miqdorlarni bitta qatorga birlashtiring.')
  // Quantities are reserved and issued in the item's stock unit; there is no unit conversion (BUG-12).
  const wrongUnit=bom.components.find(c=>c.unit!==itemUnit(s,c.materialId))
  if(wrongUnit)return fail(s,`${itemName(s,wrongUnit.materialId)}: BOM birligi (${wrongUnit.unit}) ombor birligiga (${itemUnit(s,wrongUnit.materialId)}) mos emas`)
  const ownProduct=bom.productId
  if(bom.components.some(c=>c.materialId===ownProduct))return fail(s,'Mahsulot o‘z BOM’iga komponent bo‘la olmaydi')
  if(s.boms.some(b=>b.id!==bom.id&&b.productId===bom.productId&&b.version.trim().toLowerCase()===bom.version.trim().toLowerCase()))return fail(s,`Bu mahsulotda ${bom.version} versiya allaqachon mavjud`)
  const visit=(productId:string,seen:Set<string>):boolean=>{
    if(productId===ownProduct)return true
    if(seen.has(productId))return false
    const active=s.boms.find(b=>b.productId===productId&&b.status!=='Arxiv')
    if(!active)return false
    const nextSeen=new Set(seen).add(productId)
    return active.components.some(c=>isProductItem(s,c.materialId)&&visit(c.materialId,nextSeen))
  }
  if(bom.components.some(c=>isProductItem(s,c.materialId)&&visit(c.materialId,new Set())))return fail(s,'Recursive BOM aniqlandi. BOM zanjiri o‘z mahsulotiga qaytmasligi kerak.')
  // Explicit sub-BOM links and active BOMs together: the product must never end up inside itself.
  const cycle=findBomCycle(s,bom)
  if(cycle)return fail(s,`Aylanma BOM: ${cycle.join(' → ')}`)
  const saved:Bom={...bom,status:'Draft',variantId:bom.variantId||undefined}
  const next={...s,boms:current?s.boms.map(b=>b.id===bom.id?saved:b):[saved,...s.boms]}
  return ok(logActivity(next,ctx,'BOM saqlandi','Mahsulotlar',bom.code,'info',`${bom.version}${current?` · ${ecoChanges(s,current,saved).length} o‘zgarish`:''}`),'BOM saqlandi',bom.id)
}

/** Saves only the routing (operations) of a draft revision; the same rules as a full BOM save apply. */
export function saveRouting(s:S,ctx:Ctx,bomId:string,operations:BomOperation[]):Outcome{
  const bom=s.boms.find(b=>b.id===bomId)
  if(!bom)return fail(s,'BOM topilmadi')
  const out=saveBom(s,ctx,{...bom,operations})
  return out.result.ok?ok(out.state,`${bom.code} ${bom.version}: routing saqlandi (${operations.length} operatsiya)`,bomId):out
}

/** Copies another revision's routing into a draft (new operation ids, dependencies remapped). */
export function copyRouting(s:S,ctx:Ctx,targetBomId:string,sourceBomId:string):Outcome{
  const target=s.boms.find(b=>b.id===targetBomId),source=s.boms.find(b=>b.id===sourceBomId)
  if(!target||!source)return fail(s,'BOM topilmadi')
  if(target.id===source.id)return fail(s,'Manba va maqsad bir xil')
  if(!source.operations.length)return fail(s,`${source.code} ${source.version}da routing yo‘q`)
  const ids=new Map(source.operations.map(o=>[o.id,ctx.id('bo')]))
  const operations=source.operations.map(o=>({...o,id:ids.get(o.id)!,dependsOn:(o.dependsOn||[]).map(d=>ids.get(d)||d)}))
  const out=saveBom(s,ctx,{...target,operations})
  if(!out.result.ok)return out
  return ok(logActivity(out.state,ctx,'Routing nusxalandi','PLM',target.code,'info',`${source.code} ${source.version} → ${target.version}`),`${source.code} ${source.version} routingi ${target.version} draftga nusxalandi`,target.id)
}

export function activateBom(s:S,ctx:Ctx,id:string):Outcome{
  return releaseBom(s,ctx,id)
}

function releaseBom(s:S,ctx:Ctx,id:string,viaEcoId?:string):Outcome{
  const bom=s.boms.find(b=>b.id===id)
  if(!bom)return fail(s,'BOM topilmadi')
  if(bom.status!=='Draft')return fail(s,'Faqat Draft BOM faollashtiriladi')
  // A draft under an open engineering change is released only by applying that change (B3-06).
  const eco=ecoOf(s,id,viaEcoId)
  if(eco)return fail(s,`${eco.code} bu draftga bog‘langan — BOM ECO qo‘llanganda faollashadi`)
  if(!bom.components.length&&!bom.operations.length)return fail(s,'Bo‘sh BOM faollashtirilmaydi')
  const invalid=bomBlocker(s,bom)||routingBlocker(s,bom.operations)
  if(invalid)return fail(s,`${invalid} — faollashtirilmadi`)
  const cycle=findBomCycle(s,bom)
  if(cycle)return fail(s,`Aylanma BOM: ${cycle.join(' → ')} — faollashtirilmadi`)
  const now=stamp(ctx.now)
  // One active revision per product and variant: the previous one becomes history.
  let next:S={...s,boms:s.boms.map(b=>b.id===id?{...b,status:'Faol' as const,effectiveDate:b.effectiveDate<isoDate(ctx.now)?isoDate(ctx.now):b.effectiveDate,releasedAt:now,releasedBy:ctx.user?.id||undefined,ecoId:viaEcoId}
    :b.productId===bom.productId&&b.status==='Faol'&&sameVariant(b.variantId,bom.variantId)?{...b,status:'Arxiv' as const,archivedAt:now}:b),
    products:bom.variantId?s.products:s.products.map(p=>p.id===bom.productId?{...p,defaultBomId:id}:p)}
  next=logActivity(next,ctx,'BOM faollashtirildi','PLM',bom.code,'success',`${bom.version}${variantLabel(s,bom.productId,bom.variantId)}`)
  return ok(next,`${bom.code} ${bom.version} faol BOM bo‘ldi. Mavjud MOlar o‘z snapshotini saqlaydi.`)
}

/**
 * Takes a revision out of use. An active one leaves the product (or variant) without an active BOM until another is
 * released; orders keep their snapshots. A draft under an open ECO is archived only by cancelling that ECO.
 */
export function archiveBom(s:S,ctx:Ctx,id:string,reason:string):Outcome{
  const bom=s.boms.find(b=>b.id===id)
  if(!bom)return fail(s,'BOM topilmadi')
  if(bom.status==='Arxiv')return fail(s,`${bom.code} ${bom.version} allaqachon arxivda`)
  const eco=ecoOf(s,id)
  if(eco)return fail(s,`${eco.code} bu revisionga bog‘langan — avval ECO’ni bekor qiling yoki rad eting`)
  if(!reason.trim())return fail(s,'Arxivlash sababini yozing')
  const open=s.productionOrders.filter(o=>o.bomId===id&&isOpenOrder(o)).length
  let next:S={...s,boms:s.boms.map(b=>b.id===id?{...b,status:'Arxiv' as const,archivedAt:stamp(ctx.now)}:b),products:s.products.map(p=>p.id===bom.productId&&p.defaultBomId===id?{...p,defaultBomId:''}:p)}
  next=logActivity(next,ctx,'BOM arxivlandi','PLM',bom.code,'warning',`${bom.version} · ${reason.trim()}`)
  return ok(next,`${bom.code} ${bom.version} arxivlandi${bom.status==='Faol'?' — mahsulotda faol BOM qolmadi':''}${open?` · ${open} ta ochiq MO o‘z snapshoti bilan davom etadi`:''}`)
}

export function deleteBomDraft(s:S,ctx:Ctx,id:string):Outcome{
  const bom=s.boms.find(b=>b.id===id)
  if(!bom||bom.status!=='Draft')return fail(s,'Faqat Draft BOM o‘chiriladi')
  const eco=ecoOf(s,id)
  if(eco)return fail(s,`${eco.code} bu draftga bog‘langan — avval ECO’ni rad eting`)
  if(s.productionOrders.some(o=>o.bomId===id))return fail(s,'Bu revision ishlab chiqarish tarixida bor — o‘chirib bo‘lmaydi, arxivlang')
  const next=logActivity({...s,boms:s.boms.filter(b=>b.id!==id)},ctx,'BOM draft o‘chirildi','PLM',bom.code,'warning',bom.version)
  return ok(next,`${bom.code} ${bom.version} draft o‘chirildi`)
}

/**
 * Saves a product variant: a unique code (no other variant, product or material SKU), a unique barcode, at least one
 * attribute and an attribute combination no other variant of the product has. Stock stays on the product.
 */
export function saveVariant(s:S,ctx:Ctx,productId:string,input:{id?:string;code:string;values:Record<string,string>;barcode?:string;priceDelta:number;status:ProductVariant['status']}):Outcome{
  const product=s.products.find(p=>p.id===productId)
  if(!product)return fail(s,'Mahsulot topilmadi')
  const current=input.id?product.variants.find(v=>v.id===input.id):undefined
  if(input.id&&!current)return fail(s,'Variant topilmadi')
  const code=input.code.trim().toUpperCase()
  if(!code)return fail(s,'Variant kodi (SKU) majburiy')
  const values=Object.fromEntries(Object.entries(input.values||{}).map(([k,v])=>[k.trim(),String(v).trim()]).filter(([k,v])=>k&&v))
  if(!Object.keys(values).length)return fail(s,'Kamida bitta atribut va qiymat kiriting')
  const norm=(v:string)=>v.trim().toLowerCase()
  if(s.products.some(p=>p.variants.some(v=>v.id!==current?.id&&norm(v.code)===norm(code))))return fail(s,`Variant kodi ${code} band`)
  if([...s.products,...s.rawMaterials].some(x=>norm(x.sku)===norm(code)))return fail(s,`${code} mahsulot yoki xomashyo SKU’si sifatida band`)
  const barcode=input.barcode?.trim()||undefined
  if(barcode&&s.products.some(p=>p.variants.some(v=>v.id!==current?.id&&v.barcode&&norm(v.barcode)===norm(barcode))))return fail(s,`Shtrix-kod ${barcode} boshqa variantda bor`)
  const combo=(v:Record<string,string>)=>Object.entries(v).map(([k,x])=>`${norm(k)}=${norm(x)}`).sort().join('|')
  const parsed=(v:ProductVariant)=>v.values||variantValues(v.attributes)
  const twin=product.variants.find(v=>v.id!==current?.id&&combo(parsed(v))===combo(values))
  if(twin)return fail(s,`${twin.code} xuddi shu atributlar bilan mavjud`)
  const priceDelta=Number(input.priceDelta)
  if(!Number.isFinite(priceDelta))return fail(s,'Narx farqi noto‘g‘ri')
  if(product.salePrice+priceDelta<0)return fail(s,'Variant narxi manfiy bo‘lib qoladi')
  if(!['Faol','Arxiv'].includes(input.status))return fail(s,'Status noto‘g‘ri')
  const variant:ProductVariant={id:current?.id||ctx.id('var'),code,values,attributes:Object.entries(values).map(([k,v])=>`${k}: ${v}`).join(' · '),barcode,priceDelta,status:input.status}
  const variants=current?product.variants.map(v=>v.id===current.id?variant:v):[...product.variants,variant]
  const next=logActivity({...s,products:s.products.map(p=>p.id===productId?{...p,variants}:p)},ctx,current?'Variant tahrirlandi':'Variant qo‘shildi','Mahsulotlar',product.name,'info',`${code} · ${variant.attributes}${current&&current.status!==variant.status?` · ${variant.status}`:''}`)
  return ok(next,current?`${code} saqlandi`:`${code} qo‘shildi`,variant.id)
}

/**
 * Structured values of a variant saved before they existed, read from its text ("Rang: kumush · 6 m"): a part
 * without a name keeps its text under "Xususiyat N", so nothing is lost when the variant is edited.
 */
export function variantValues(text:string):Record<string,string>{
  const out:Record<string,string>={}
  text.split('·').map(x=>x.trim()).filter(Boolean).forEach((part,i)=>{
    const at=part.indexOf(':')
    if(at>0)out[part.slice(0,at).trim()]=part.slice(at+1).trim()
    else out[`Xususiyat ${i+1}`]=part
  })
  return out
}

const ecoEvent=(ctx:Ctx,action:string,note?:string)=>({at:stamp(ctx.now),by:ctx.user?.id||'',action,...(note?{note}:{})})
const withEco=(s:S,id:string,patch:Partial<EngineeringChange>,event:ReturnType<typeof ecoEvent>):S=>({...s,engineeringChanges:s.engineeringChanges.map(e=>e.id===id?{...e,...patch,history:[...(e.history||[]),event]}:e)})

export function createEngineeringChange(s:S,ctx:Ctx,p:{productId:string;title:string;reason:string;changeSummary:string;effectiveDate:string}):Outcome{
  const product=s.products.find(x=>x.id===p.productId)
  const active=product&&activeBomFor(s,product.id)
  if(!product||!active)return fail(s,'ECO uchun faol BOMli mahsulot tanlang')
  if(!p.reason.trim())return fail(s,'O‘zgarish sababini yozing')
  if(p.effectiveDate&&!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate))return fail(s,'Effective date noto‘g‘ri')
  let draft=s.boms.find(b=>b.productId===product.id&&b.status==='Draft'&&!b.variantId)
  // One draft revision answers to one open change at a time.
  const owner=draft&&ecoOf(s,draft.id)
  if(owner)return fail(s,`${owner.code} ${draft!.version} draftiga bog‘langan — o‘sha ECO’ni davom ettiring yoki bekor qiling`)
  let next=s
  if(!draft){const created=createBomDraft(s,ctx,product.id,active.id);if(!created.result.ok)return created;next=created.state;draft=next.boms.find(b=>b.id===created.result.id)!}
  const id=ctx.id('eco'),code=nextCode(next.engineeringChanges.map(e=>e.code),'ECO',ctx.now)
  next={...next,engineeringChanges:[{id,code,title:p.title.trim()||`${product.name} engineering change`,productId:product.id,bomId:active.id,newBomId:draft.id,fromVersion:active.version,toVersion:draft.version,status:'Draft',effectiveDate:p.effectiveDate||draft.effectiveDate,ownerId:ctx.user.id,reason:p.reason.trim(),changeSummary:p.changeSummary.trim(),documents:[],createdAt:stamp(ctx.now),history:[ecoEvent(ctx,'Yaratildi',p.reason.trim())]},...next.engineeringChanges]}
  return ok(logActivity(next,ctx,'ECO yaratildi','PLM',code,'info',p.reason),`${code} yaratildi · ${draft.version} draft BOM’ni tahrirlang`,id)
}

/**
 * ECO workflow: Draft → Review (the proposed revision is validated and its changes frozen) → Approved (by someone else
 * than the author, only if the revision still matches what was reviewed) or Rejected (back to editing).
 */
export function setEcoStatus(s:S,ctx:Ctx,id:string,status:'Review'|'Approved'|'Rejected',note=''):Outcome{
  const eco=s.engineeringChanges.find(e=>e.id===id)
  if(!eco)return fail(s,'ECO topilmadi')
  const allowed:Record<string,string[]>={Review:['Draft','Rejected'],Approved:['Review'],Rejected:['Review','Approved']}
  if(!allowed[status].includes(eco.status))return fail(s,`${eco.status} → ${status} o‘tish mumkin emas`)
  const draft=s.boms.find(b=>b.id===eco.newBomId),base=s.boms.find(b=>b.id===eco.bomId)
  let patch:Partial<EngineeringChange>={status}
  if(status==='Review'){
    if(!draft||draft.status!=='Draft')return fail(s,`${eco.code}: taklif qilingan draft BOM topilmadi`)
    const changes=ecoChanges(s,base,draft)
    if(!changes.length)return fail(s,`${eco.code}: draft joriy revisiondan farq qilmaydi — avval o‘zgarishlarni kiriting`)
    const invalid=bomBlocker(s,draft)||routingBlocker(s,draft.operations)
    if(invalid)return fail(s,invalid)
    patch={...patch,changes,fingerprint:bomFingerprint(draft),toVersion:draft.version,approvedBy:undefined,approvedAt:undefined}
  }
  if(status==='Approved'){
    // The author of a change does not approve it (N-12: four-eyes principle).
    if(eco.ownerId===ctx.user.id)return fail(s,`${eco.code}: o‘zingiz yaratgan ECO’ni tasdiqlay olmaysiz — boshqa mas’ul tasdiqlasin`)
    if(!draft||(eco.fingerprint&&bomFingerprint(draft)!==eco.fingerprint))return fail(s,`${eco.code}: draft review’dan keyin o‘zgargan — qayta reviewga yuboring`)
    patch={...patch,approvedBy:ctx.user.id,approvedAt:stamp(ctx.now)}
  }
  if(status==='Rejected')patch={...patch,approvedBy:undefined,approvedAt:undefined}
  const next=withEco(s,id,patch,ecoEvent(ctx,status==='Review'?'Reviewga yuborildi':status==='Approved'?'Tasdiqlandi':'Rad etildi',note.trim()||undefined))
  return ok(logActivity(next,ctx,`ECO → ${status}`,'PLM',eco.code,status==='Rejected'?'warning':'info',note.trim()),`${eco.code}: ${status}`)
}

/** Withdraws an engineering change that was not applied; its draft revision stays as an ordinary draft. */
export function cancelEngineeringChange(s:S,ctx:Ctx,id:string,reason:string):Outcome{
  const eco=s.engineeringChanges.find(e=>e.id===id)
  if(!eco)return fail(s,'ECO topilmadi')
  if(eco.status==='Applied')return fail(s,`${eco.code} qo‘llangan — bekor qilib bo‘lmaydi, yangi ECO oching`)
  if(eco.status==='Cancelled')return fail(s,`${eco.code} allaqachon bekor qilingan`)
  if(!reason.trim())return fail(s,'Bekor qilish sababini yozing')
  if(eco.ownerId!==ctx.user.id&&!hasPermission(roleOf(s,ctx.user.id),'products','approve'))return fail(s,`${eco.code}: ECO’ni faqat muallif yoki tasdiqlovchi bekor qiladi`)
  const next=withEco(s,id,{status:'Cancelled',approvedBy:undefined,approvedAt:undefined},ecoEvent(ctx,'Bekor qilindi',reason.trim()))
  return ok(logActivity(next,ctx,'ECO bekor qilindi','PLM',eco.code,'warning',reason.trim()),`${eco.code} bekor qilindi · draft BOM o‘zgarishsiz qoldi`)
}

/**
 * Releases exactly the approved revision: refused when it changed after approval, when another revision became active
 * since the ECO was raised, before its effective date, or a second time. Nothing changes unless all checks pass.
 */
export function applyEngineeringChange(s:S,ctx:Ctx,id:string):Outcome{
  const eco=s.engineeringChanges.find(e=>e.id===id)
  if(!eco)return fail(s,'ECO topilmadi')
  if(eco.status==='Applied')return fail(s,`${eco.code} allaqachon qo‘llangan (${eco.appliedAt||''}) — qayta qo‘llanmaydi`)
  if(eco.status!=='Approved')return fail(s,'ECO avval tasdiqlanishi (Approved) kerak')
  if(!eco.newBomId)return fail(s,'ECO bilan bog‘langan draft BOM yo‘q')
  const draft=s.boms.find(b=>b.id===eco.newBomId)
  if(!draft||draft.status!=='Draft')return fail(s,`${eco.code}: taklif qilingan revision draft holatida emas`)
  if(eco.fingerprint&&bomFingerprint(draft)!==eco.fingerprint)return fail(s,`${eco.code}: draft tasdiqlangandan keyin o‘zgargan — ECO qayta ko‘rib chiqilsin`)
  const active=activeBomFor(s,eco.productId,draft.variantId)
  if(active&&active.id!==eco.bomId)return fail(s,`${eco.code} ${eco.fromVersion} revisionga asoslangan, hozir ${active.version} faol — ECO’ni qayta ko‘rib chiqing`)
  // The change takes effect on its effective date, not earlier (N-12).
  if(eco.effectiveDate&&eco.effectiveDate>isoDate(ctx.now))return fail(s,`${eco.code} ${eco.effectiveDate} dan kuchga kiradi — shu sanadan keyin qo‘llang`)
  const activated=releaseBom(s,ctx,eco.newBomId,eco.id)
  if(!activated.result.ok)return activated
  let next=withEco(activated.state,id,{status:'Applied',appliedAt:stamp(ctx.now),appliedBy:ctx.user?.id||undefined},ecoEvent(ctx,'Qo‘llandi',`${eco.fromVersion} → ${draft.version}`))
  next=notify(next,ctx,'production','Engineering change applied',`${eco.code}: ${eco.fromVersion} → ${draft.version}. Eski MOlar snapshot bilan qoladi.`,'success',`/products?view=plm&id=${eco.id}`)
  return ok(logActivity(next,ctx,'ECO applied','PLM',eco.code,'success',eco.changeSummary),`${eco.code} qo‘llandi · BOM ${draft.version} faol`)
}

/* -------------------------------------------------------- subcontract -- */

export function advanceSubcontract(s:S,ctx:Ctx,id:string):Outcome{
  const o=s.subcontractOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Subcontract order topilmadi')
  const bom=activeBomFor(s,o.productId)
  let next=s
  if(o.status==='Draft'){
    const fgWh=finishedWarehouseFor(s,s.settings.defaultLineId),rawWh=rawWarehouseFor(s,fgWh)
    const whFor=(itemId:string)=>isProductItem(s,itemId)?fgWh:rawWh
    for(const c of bom?.components||[]){
      const need=q3(perUnit(c)*o.qty)
      const b=next.stockBalances.find(x=>x.warehouseId===whFor(c.materialId)&&x.itemId===c.materialId)
      // Material still in incoming QC quarantine is not released for use and cannot leave for the subcontractor (N-07).
      if(!b||b.onHand-b.reserved-(b.quarantine||0)<need)return fail(s,`${itemName(s,c.materialId)}: supplierga yuborish uchun available yetarli emas (kerak ${Math.ceil(need)}, karantin hisobga olinmaydi)`)
    }
    for(const c of bom?.components||[]){
      const need=q3(perUnit(c)*o.qty),wh=whFor(c.materialId)
      next=changeBalance(next,ctx,wh,c.materialId,{onHand:-need})
      next=takeLots(next,c.materialId,need,o.code,wh).state
      next=addMove(next,ctx,{type:'Subcontract -',itemId:c.materialId,itemType:isProductItem(s,c.materialId)?'finished':'raw',warehouseId:wh,qty:-need,source:o.code,note:`Supplierga yuborildi: ${s.suppliers.find(x=>x.id===o.supplierId)?.name}`})
    }
    next={...next,subcontractOrders:next.subcontractOrders.map(x=>x.id===id?{...x,status:'Material yuborildi' as const}:x)}
    return ok(logActivity(lowStockSignals(next,ctx),ctx,'Subcontract material yuborildi','Xaridlar',o.code),`${o.code}: material supplierga yuborildi`)
  }
  if(o.status==='Material yuborildi'){
    next={...next,subcontractOrders:next.subcontractOrders.map(x=>x.id===id?{...x,status:'Ishlab chiqarishda' as const}:x)}
    return ok(logActivity(next,ctx,'Subcontract ishlab chiqarishda','Xaridlar',o.code),`${o.code}: supplierda ishlab chiqarilmoqda`)
  }
  if(o.status==='Ishlab chiqarishda'){
    const wh=finishedWarehouseFor(s,s.settings.defaultLineId)
    const product=s.products.find(p=>p.id===o.productId)
    const lot=product?.tracking==='lot'?lotCode(next,product.sku,ctx.now):undefined
    // Work done outside is inspected like any incoming goods: with Final QC required it waits in quarantine (N-07).
    const inspect=s.settings.policies.requireFinalQc
    if(lot)next={...next,lots:[{id:ctx.id('lot'),code:lot,kind:'lot',itemId:o.productId,itemType:'finished',qty:o.qty,warehouseId:wh,status:inspect?'quarantine':undefined,sourceType:'purchase',sourceId:o.id,sourceCode:o.code,createdAt:stamp(ctx.now),consumedBy:[]},...next.lots]}
    next=changeBalance(next,ctx,wh,o.productId,{onHand:o.qty,...(inspect?{quarantine:o.qty}:{})},lot)
    next=addMove(next,ctx,{type:'Subcontract +',itemId:o.productId,itemType:'finished',warehouseId:wh,qty:o.qty,source:o.code,note:inspect?'Subcontract receipt · QC karantin':'Subcontract receipt',lot})
    if(inspect){
      next={...next,qualityChecks:[{id:ctx.id('qc'),type:'Kirish',sourceType:'subcontract',sourceId:o.id,itemId:o.productId,status:'Pending',inspectorId:'',date:stamp(ctx.now),lot},...next.qualityChecks]}
      next=notify(next,ctx,'quality','Subcontract qabul QC',`${o.code}: ${o.qty} ${product?.unit||''} karantinda — kirish tekshiruvi kutilmoqda`,'warning','/quality?view=checks&status=Pending')
    }
    next={...next,subcontractOrders:next.subcontractOrders.map(x=>x.id===id?{...x,status:'Qabul qilindi' as const,warehouseId:wh,qcHeld:inspect?o.qty:0}:x),expenses:[{id:ctx.id('ex'),date:isoDate(ctx.now),type:'Overhead',sourceId:o.id,amount:o.cost,note:`${o.code} subcontract service`},...next.expenses]}
    return ok(logActivity(next,ctx,'Subcontract qabul qilindi','Xaridlar',o.code,'success'),`${o.code}: ${o.qty} ${product?.unit||''} qabul qilindi`)
  }
  return fail(s,'Subcontract order yopilgan')
}

/* ---------------------------------------------------------- admin/misc -- */

const REFERENCE_CHECKS:Partial<Record<EntityKey,(s:S,id:string)=>string|null>>={
  products:(s,id)=>s.productionOrders.some(o=>o.productId===id||o.bomSnapshot.components.some(c=>c.materialId===id))?'ishlab chiqarish buyurtmalarida':s.salesOrders.some(o=>o.items.some(i=>i.productId===id))?'sotuv buyurtmalarida':s.boms.some(b=>b.productId===id&&b.status!=='Arxiv')?'mahsulotning faol yoki qoralama BOMi bor':s.boms.some(b=>b.components.some(c=>c.materialId===id))?'boshqa BOM komponentida':s.subcontractOrders.some(o=>o.productId===id)?'subcontract buyurtmalarida':s.returns.some(r=>r.productId===id)?'mijoz qaytarishlarida':stockOf(s,id).onHand>0?'omborda qoldiq bor':null,
  rawMaterials:(s,id)=>s.boms.some(b=>b.status!=='Arxiv'&&b.components.some(c=>c.materialId===id))?'faol BOM komponentida':s.productionOrders.some(o=>isOpenOrder(o)&&o.bomSnapshot.components.some(c=>c.materialId===id))?'ochiq ishlab chiqarish buyurtmasi BOMida':s.purchaseOrders.some(p=>p.items.some(i=>i.materialId===id))?'purchase orderlarda':s.subcontractOrders.some(o=>o.materialIds.includes(id))?'subcontract buyurtmalarida':stockOf(s,id).onHand>0?'omborda qoldiq bor':null,
  suppliers:(s,id)=>s.purchaseOrders.some(p=>p.supplierId===id)?'purchase orderlarda':s.subcontractOrders.some(o=>o.supplierId===id)?'subcontract buyurtmalarida':s.rawMaterials.some(m=>m.supplierId===id)?'material default supplieri':null,
  customers:(s,id)=>s.salesOrders.some(o=>o.customerId===id)?'sotuv buyurtmalarida':s.returns.some(r=>r.customerId===id)?'mijoz qaytarishlarida':null,
  employees:(s,id)=>s.productionOrders.some(o=>o.responsibleId===id&&isOpenOrder(o))?'ochiq MOlarga mas’ul':null,
  warehouses:(s,id)=>s.stockBalances.some(b=>b.warehouseId===id&&(b.onHand>0||b.reserved>0||b.incoming>0||(b.quarantine||0)>0))?'omborda qoldiq, rezerv yoki kutilayotgan kirim bor'
    :s.purchaseOrders.some(p=>p.warehouseId===id&&['Qoralama','Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(p.status))?'ochiq purchase orderlarda'
    :s.productionOrders.some(o=>o.warehouseId===id&&isOpenOrder(o))?'ochiq ishlab chiqarish buyurtmalarida'
    :s.settings.defaultWarehouseId===id?'standart ombor (Sozlamalar)'
    :s.employees.some(e=>e.warehouseId===id&&e.status!=='Arxiv')?'xodimlarning ish ombori':null,
  workCenters:(s,id)=>s.boms.some(b=>b.status!=='Arxiv'&&b.operations.some(o=>o.workCenterId===id))?'BOM operatsiyalarida'
    :s.productionOrders.some(o=>isOpenOrder(o)&&o.workOrders.some(w=>w.workCenterId===id))?'ochiq MO operatsiyalarida'
    :s.equipment.some(e=>e.workCenterId===id)?'uskunalar biriktirilgan'
    :s.employees.some(e=>e.workCenterId===id&&e.status!=='Arxiv')?'xodimlar biriktirilgan':null,
  productionLines:(s,id)=>s.settings.defaultLineId===id?'standart liniya (Sozlamalar)'
    :s.productionOrders.some(o=>o.lineId===id&&isOpenOrder(o))?'ochiq ishlab chiqarish buyurtmalarida'
    :s.workCenters.some(w=>w.lineId===id)?'work centerlar biriktirilgan':null,
  branches:(s,id)=>s.settings.defaultBranchId===id?'standart filial (Sozlamalar)'
    :s.warehouses.some(w=>w.branchId===id)?'filialda omborlar bor':s.productionLines.some(l=>l.branchId===id)?'filialda liniyalar bor':null,
  equipment:(s,id)=>s.maintenanceOrders.some(m=>m.equipmentId===id&&['Rejada','Jarayonda'].includes(m.status))?'ochiq maintenance bor'
    :s.repairOrders.some(r=>r.equipmentId===id&&r.status!=='Yakunlangan')?'ochiq ta’mir buyurtmasi bor'
    :s.downtimeEvents.some(d=>d.equipmentId===id&&!d.end)?'davom etayotgan to‘xtash bor':null,
}

type Row=Record<string,unknown>
const norm=(v:unknown)=>String(v??'').trim().toLowerCase()
/** Item stock, lots, BOM lines or document lines that were recorded in the item's unit. */
const itemInUse=(s:S,id:string)=>s.stockBalances.some(b=>b.itemId===id)||s.lots.some(l=>l.itemId===id)||s.boms.some(b=>b.components.some(c=>c.materialId===id))||s.purchaseOrders.some(p=>p.items.some(i=>i.materialId===id))||s.productionOrders.some(o=>o.productId===id||o.bomSnapshot.components.some(c=>c.materialId===id))||s.salesOrders.some(o=>o.items.some(i=>i.productId===id))

/**
 * Domain rules for generic master-data writes (BUG-15): the forms check them too, but a write that skips the
 * form must not create duplicates or change the meaning of recorded quantities.
 */
const ENTITY_RULES:Partial<Record<EntityKey,(s:S,row:Row,before?:Row)=>string|null>>={
  products:(s,row,before)=>{
    const sku=norm(row.sku)
    if(!sku)return 'SKU majburiy'
    if([...s.products,...s.rawMaterials].some(x=>x.id!==row.id&&norm(x.sku)===sku))return `SKU ${String(row.sku)} allaqachon mavjud (mahsulot yoki xomashyoda)`
    // Variant codes are SKUs too: unique across every product's variants and all item SKUs (a write that skips saveVariant).
    const variants=Array.isArray(row.variants)?row.variants as ProductVariant[]:[]
    const codes=variants.map(v=>norm(v.code))
    if(new Set(codes).size!==codes.length)return 'Variant kodlari takrorlanmasin'
    const clash=variants.find(v=>s.products.some(p=>p.id!==row.id&&p.variants.some(x=>norm(x.code)===norm(v.code)))||[...s.products,...s.rawMaterials].some(x=>norm(x.sku)===norm(v.code)))
    if(clash)return `Variant kodi ${clash.code} band`
    if(before){
      // A variant that orders or BOMs point at is archived, never removed.
      const removed=((before.variants as ProductVariant[]|undefined)||[]).filter(v=>!variants.some(x=>x.id===v.id))
      const used=removed.find(v=>s.productionOrders.some(o=>o.variantId===v.id)||s.salesOrders.some(o=>o.items.some(i=>i.variantId===v.id))||s.boms.some(b=>b.variantId===v.id))
      if(used)return `${used.code} buyurtma yoki BOM’da ishlatilgan — o‘chirmang, arxivlang`
    }
    if(before&&itemInUse(s,String(row.id))){
      if(row.unit!==before.unit)return 'Qoldiq yoki hujjatlari bor mahsulotning o‘lchov birligini o‘zgartirib bo‘lmaydi'
      if(row.tracking!==before.tracking)return 'Qoldiq yoki hujjatlari bor mahsulotning lot/serial rejimini o‘zgartirib bo‘lmaydi'
    }
    return null
  },
  rawMaterials:(s,row,before)=>{
    const sku=norm(row.sku)
    if(!sku)return 'SKU majburiy'
    if([...s.products,...s.rawMaterials].some(x=>x.id!==row.id&&norm(x.sku)===sku))return `SKU ${String(row.sku)} allaqachon mavjud (mahsulot yoki xomashyoda)`
    // Quantities already recorded in the old unit would silently change meaning (BUG-12).
    if(before&&row.unit!==before.unit&&itemInUse(s,String(row.id)))return 'Qoldiq, BOM yoki xaridda ishlatilgan materialning o‘lchov birligini o‘zgartirib bo‘lmaydi'
    return null
  },
  warehouses:(s,row,before)=>{
    if(!norm(row.code))return 'Ombor kodi majburiy'
    if(s.warehouses.some(w=>w.id!==row.id&&norm(w.code)===norm(row.code)))return `Ombor kodi ${String(row.code)} band`
    if(before&&row.type!==before.type&&s.stockBalances.some(b=>b.warehouseId===row.id&&(b.onHand>0||b.reserved>0||b.incoming>0)))return 'Qoldig‘i bor ombor turini o‘zgartirib bo‘lmaydi'
    return null
  },
  qualityAlerts:(_s,row,before)=>before&&row.status==='Yopilgan'&&before.status!=='Yopilgan'&&!norm(row.rootCause)?'NCR’ni yopish uchun asosiy sabab (root cause) kiritilishi shart':null,
}

export function createEntity(s:S,ctx:Ctx,key:EntityKey,payload:Record<string,unknown>,label:string=key):Outcome{
  const invalid=ENTITY_RULES[key]?.(s,{...payload,id:undefined})||(key==='employees'?employeeWriteBlocker(s,ctx.user,payload):null)
  if(invalid)return fail(s,invalid)
  const id=ctx.id(key.slice(0,2))
  const next=logActivity({...s,[key]:[{id,...payload},...(s[key] as unknown as Record<string,unknown>[])]} as S,ctx,`${label} yaratildi`,label,String(payload.code||payload.name||payload.title||id))
  return ok(next,'Saqlandi',id)
}

export function updateEntity(s:S,ctx:Ctx,key:EntityKey,id:string,patch:Record<string,unknown>,label:string=key):Outcome{
  const rows=s[key] as unknown as Record<string,unknown>[]
  const row=rows.find(x=>x.id===id)
  if(!row)return fail(s,'Yozuv topilmadi')
  // Role and blocking changes of people are checked against who is acting (A-C2 / A-H2).
  const invalid=ENTITY_RULES[key]?.(s,{...row,...patch,id},row)||(key==='employees'?employeeWriteBlocker(s,ctx.user,{...row,...patch},row as unknown as Employee):null)
  if(invalid)return fail(s,invalid)
  const roleChanged=key==='employees'&&patch.roleId!==undefined&&patch.roleId!==row.roleId
  let next=logActivity({...s,[key]:rows.map(x=>x.id===id?{...x,...patch,id}:x)} as S,ctx,`${label} tahrirlandi`,label,String(row.code||row.name||row.title||id))
  if(roleChanged)next=logActivity(next,ctx,'Rol o‘zgartirildi','Foydalanuvchilar',String(row.name||id),'warning',`${s.roles.find(r=>r.id===row.roleId)?.name||'—'} → ${s.roles.find(r=>r.id===patch.roleId)?.name||'—'}`)
  return ok(next,'O‘zgarishlar saqlandi',id)
}

export function deleteEntity(s:S,ctx:Ctx,key:EntityKey,id:string,label:string=key):Outcome{
  const rows=s[key] as unknown as Record<string,unknown>[]
  const row=rows.find(x=>x.id===id)
  if(!row)return fail(s,'Yozuv topilmadi')
  if(key==='employees'){const blocked=employeeRemovalBlocker(s,ctx.user,id);if(blocked)return fail(s,blocked)}
  const reference=REFERENCE_CHECKS[key]?.(s,id)
  if(reference)return fail(s,`O‘chirib bo‘lmaydi: ${reference}. Arxivlashdan foydalaning.`)
  // Sourcing links belong to both ends: they go with a deleted supplier or material.
  const supplierMaterials=key==='suppliers'?s.supplierMaterials.filter(l=>l.supplierId!==id):key==='rawMaterials'?s.supplierMaterials.filter(l=>l.materialId!==id):s.supplierMaterials
  const next=logActivity({...s,[key]:rows.filter(x=>x.id!==id),attachments:s.attachments.filter(a=>a.entityId!==id),supplierMaterials} as S,ctx,`${label} o‘chirildi`,label,String(row.code||row.name||row.title||id),'warning')
  return ok(next,'Yozuv o‘chirildi',id)
}

export function referenceBlocker(s:S,key:EntityKey,id:string){
  return REFERENCE_CHECKS[key]?.(s,id)??null
}

export function duplicateEntity(s:S,ctx:Ctx,key:EntityKey,id:string,label:string=key):Outcome{
  const rows=s[key] as unknown as Record<string,unknown>[]
  const row=rows.find(x=>x.id===id)
  if(!row)return fail(s,'Yozuv topilmadi')
  const copyId=ctx.id(key.slice(0,2))
  // Codes and SKUs of copies stay unique: -COPY, -COPY2, … (N-16).
  const taken=new Set([...rows.map(x=>norm(x.code)),...s.products.map(x=>norm(x.sku)),...s.rawMaterials.map(x=>norm(x.sku)),...s.products.flatMap(p=>p.variants.map(v=>norm(v.code)))])
  const free=(base:string)=>{let n=1,v=`${base}-COPY`;while(taken.has(norm(v))){n+=1;v=`${base}-COPY${n}`}return v}
  // A copied product's variants get their own codes and ids; barcodes are not copied (they identify one item).
  const variants=key==='products'?(row.variants as ProductVariant[]||[]).map(v=>{const code=free(v.code);taken.add(norm(code));const {barcode:_b,...rest}=v;return {...rest,id:ctx.id('var'),code}}):undefined
  const copy={...clone(row),id:copyId,...(row.name?{name:`${String(row.name)} — nusxa`}:{}),...(row.code?{code:free(String(row.code))}:{}),...(row.sku?{sku:free(String(row.sku))}:{}),...(key==='products'?{defaultBomId:'',status:'Faol',variants}:{}),...(key==='rawMaterials'?{supplierId:''}:{})}
  const invalid=ENTITY_RULES[key]?.(s,copy)
  if(invalid)return fail(s,invalid)
  const next=logActivity({...s,[key]:[copy,...rows]} as S,ctx,'Nusxa yaratdi',label,String(copy.name||copy.code||copyId))
  return ok(next,'Nusxa yaratildi',copyId)
}

/**
 * Switches one permission of a role. Nobody edits their own role, the Super Admin role, or a role at or above
 * their rank, and only permissions the actor holds can be granted or removed (A-C1). Turning "view" off clears
 * the module; turning anything else on also turns "view" on.
 */
export function updateRolePermission(s:S,ctx:Ctx,roleId:string,module:string,action:PermissionAction,value:boolean):Outcome{
  const role=s.roles.find(r=>r.id===roleId)
  if(!role)return fail(s,'Rol topilmadi')
  const blocked=rolePermissionBlocker(s,ctx.user,roleId,module,action)
  if(blocked)return fail(s,blocked)
  if(value&&action!=='view'&&!hasPermission(roleOf(s,ctx.user?.id),module,'view'))return fail(s,`Sizda “${module}.view” huquqi yo‘q`)
  const current=role.permissions[module]||{}
  const nextPerm={...current,[action]:value}
  if(action==='view'&&!value)for(const k of Object.keys(nextPerm))nextPerm[k as PermissionAction]=false
  if(action!=='view'&&value)nextPerm.view=true
  const next=logActivity({...s,roles:s.roles.map(r=>r.id===roleId?{...r,permissions:{...r.permissions,[module]:nextPerm}}:r)},ctx,'Ruxsat o‘zgartirildi','Rollar',role.name,'warning',`${module}.${action} = ${value?'ON':'OFF'}`)
  return ok(next,`${role.name}: ${module} · ${action} ${value?'yoqildi':'o‘chirildi'}`)
}

export type RoleInput={name:string;description?:string;scope?:Role['scope']}

/** A new custom role starts without permissions; it is filled in the matrix (by someone ranked above it). */
export function createRole(s:S,ctx:Ctx,p:RoleInput):Outcome{
  const name=p.name.trim()
  if(!name)return fail(s,'Rol nomi majburiy')
  if(s.roles.some(r=>r.name.trim().toLowerCase()===name.toLowerCase()))return fail(s,'Bu nomli rol bor')
  const id=ctx.id('role')
  const role:Role={id,name,scope:p.scope||'all',permissions:{},description:p.description?.trim()||'',createdAt:stamp(ctx.now)}
  return ok(logActivity({...s,roles:[...s.roles,role]},ctx,'Rol yaratildi','Rollar',name,'info'),`${name} roli yaratildi`,id)
}

/** Copies a role's permissions — only those the actor holds, so a copy cannot be used to escalate (A-C1). */
export function duplicateRole(s:S,ctx:Ctx,roleId:string,name?:string):Outcome{
  const source=s.roles.find(r=>r.id===roleId)
  if(!source)return fail(s,'Rol topilmadi')
  const mine=roleOf(s,ctx.user?.id)
  const permissions:PermissionMap=Object.fromEntries(Object.entries(source.permissions).map(([m,p])=>[m,Object.fromEntries(Object.entries(p).filter(([a,v])=>v&&hasPermission(mine,m,a as PermissionAction)))]))
  const base=(name||`${source.name} — nusxa`).trim()
  let label=base,n=1
  while(s.roles.some(r=>r.name.trim().toLowerCase()===label.toLowerCase())){n+=1;label=`${base} ${n}`}
  const id=ctx.id('role')
  const role:Role={id,name:label,scope:source.scope,permissions,description:source.description||'',createdAt:stamp(ctx.now)}
  return ok(logActivity({...s,roles:[...s.roles,role]},ctx,'Rol nusxalandi','Rollar',label,'info',source.name),`${label} yaratildi`,id)
}

export function updateRole(s:S,ctx:Ctx,roleId:string,patch:RoleInput):Outcome{
  const role=s.roles.find(r=>r.id===roleId)
  if(!role)return fail(s,'Rol topilmadi')
  const blocked=roleManageBlocker(s,ctx.user,roleId)
  if(blocked)return fail(s,blocked)
  const name=patch.name.trim()
  if(!name)return fail(s,'Rol nomi majburiy')
  if(s.roles.some(r=>r.id!==roleId&&r.name.trim().toLowerCase()===name.toLowerCase()))return fail(s,'Bu nomli rol bor')
  const next={...s,roles:s.roles.map(r=>r.id===roleId?{...r,name,description:patch.description?.trim()??r.description,scope:patch.scope||r.scope}:r)}
  return ok(logActivity(next,ctx,'Rol tahrirlandi','Rollar',name,'info',role.name!==name?`${role.name} → ${name}`:''),'Rol saqlandi',roleId)
}

/** System roles and roles still assigned to someone are never deleted. */
export function deleteRole(s:S,ctx:Ctx,roleId:string):Outcome{
  const role=s.roles.find(r=>r.id===roleId)
  if(!role)return fail(s,'Rol topilmadi')
  if(role.system||role.key)return fail(s,`${role.name} — tizim roli, o‘chirib bo‘lmaydi`)
  const blocked=roleManageBlocker(s,ctx.user,roleId)
  if(blocked)return fail(s,blocked)
  const users=s.employees.filter(e=>e.roleId===roleId)
  if(users.length)return fail(s,`${role.name} ${users.length} ta xodimga biriktirilgan — avval ularga boshqa rol bering`)
  return ok(logActivity({...s,roles:s.roles.filter(r=>r.id!==roleId)},ctx,'Rol o‘chirildi','Rollar',role.name,'warning'),`${role.name} o‘chirildi`)
}

export function addAttachment(s:S,ctx:Ctx,a:Omit<Attachment,'id'|'addedAt'|'addedBy'>):Outcome{
  if(!a.name.trim())return fail(s,'Fayl nomi bo‘sh')
  const id=ctx.id('att')
  const next=logActivity({...s,attachments:[{...a,id,addedAt:stamp(ctx.now),addedBy:ctx.user.name},...s.attachments]},ctx,'Hujjat biriktirildi',a.entityType,a.name)
  return ok(next,`${a.name} biriktirildi`,id)
}

export function removeAttachment(s:S,ctx:Ctx,id:string):Outcome{
  const a=s.attachments.find(x=>x.id===id)
  if(!a)return fail(s,'Hujjat topilmadi')
  return ok(logActivity({...s,attachments:s.attachments.filter(x=>x.id!==id)},ctx,'Hujjat o‘chirildi',a.entityType,a.name,'warning'),`${a.name} o‘chirildi`)
}

export function rollUpCosts(s:S,ctx:Ctx):Outcome{
  const next=rollUpStandardCosts(s)
  const changed=next.products.filter(p=>s.products.find(x=>x.id===p.id)?.standardCost!==p.standardCost)
  if(!changed.length)return ok(s,'Standart tannarxlar allaqachon BOM bilan mos')
  return ok(logActivity(next,ctx,'Standart tannarx roll-up','Mahsulotlar',undefined,'info',changed.map(p=>`${p.sku}: ${p.standardCost}`).join(', ')),`${changed.length} ta mahsulot tannarxi BOM bo‘yicha yangilandi`)
}

export type RescheduleOptions={override?:boolean;reason?:string}

/**
 * Moves an order that has not started to a new start day, keeping its span (start → due). A past or invalid date
 * and a running order are refused. A start on which a work center of its first operations does not work or is
 * taken by maintenance / a stop needs an explicit override (recorded on the order). The finite schedule after the
 * move is checked, and a finish after the due date is reported in the result.
 */
export function rescheduleProductionOrder(s:S,ctx:Ctx,id:string,start:string,opts:RescheduleOptions={}):Outcome{
  const o=s.productionOrders.find(x=>x.id===id)
  if(!o)return fail(s,'Buyurtma topilmadi')
  if(!isOpenOrder(o))return fail(s,'Yopilgan buyurtmani rejalashtirib bo‘lmaydi')
  if(['Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status))return fail(s,`${o.code} allaqachon boshlangan — boshlanish sanasi o‘zgarmaydi`)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(start))||isoDate(parseDate(start))!==start)return fail(s,`Sana noto‘g‘ri: ${start}`)
  if(start===o.start)return fail(s,'Sana o‘zgarmadi')
  if(start<isoDate(ctx.now))return fail(s,`${start} o‘tgan sana — rejalashtirib bo‘lmaydi`)
  const conflicts=scheduleConflicts(s,o,start,ctx.now)
  if(conflicts.length&&!opts.override)return {state:s,result:{ok:false,code:'needs-override',message:`${o.code}: ${conflicts.join('; ')}. Baribir rejalashtirish uchun tasdiqlang.`}}
  const due=addDays(start,orderSpan(o))
  let next=setOrder(s,{...o,start,due,scheduleOverride:conflicts.length?{by:ctx.user?.id||'',at:stamp(ctx.now),reason:opts.reason?.trim()||conflicts.join('; ')}:o.scheduleOverride})
  const plan=scheduleOperations(next,{now:ctx.now}).orders.get(o.id)
  const late=plan?.late?` · diqqat: ${plan.unscheduled||`sig‘im bo‘yicha ${plan.end?.slice(0,10)} da tugaydi (muddat ${due})`}`:''
  next=logActivity(next,ctx,'Buyurtma qayta rejalashtirildi','Rejalashtirish',o.code,conflicts.length||late?'warning':'info',`${o.start} → ${start}${conflicts.length?` · override: ${conflicts.join('; ')}`:''}${late}`)
  return ok(next,`${o.code}: ${start} → ${due}${late}`)
}

export type ConfirmSuggestionOptions={supplierId?:string;bucket?:'week'|'day';horizonWeeks?:number;horizonDays?:number}

/**
 * Turns one MRP suggestion into a document through the regular commands: a draft MO (make) or a draft PO (buy),
 * tagged "MRP <key>" with the demand it serves. The plan is recomputed from the current data first, so a stale or
 * already covered suggestion is refused, and a draft PO already raised for it is never duplicated.
 */
export function confirmMrpSuggestion(s:S,ctx:Ctx,key:string,opts:ConfirmSuggestionOptions={}):Outcome{
  const today=isoDate(ctx.now)
  const plan=runMrp(s,{today,bucket:opts.bucket,horizonWeeks:opts.horizonWeeks,horizonDays:opts.horizonDays})
  const sug=plan.suggestions.find(x=>x.key===key)
  if(!sug)return fail(s,'MRP tavsiyasi topilmadi yoki talab allaqachon qoplangan — rejani yangilang')
  if(sug.existing)return fail(s,`Bu tavsiya uchun ${sug.existing} allaqachon yaratilgan — o‘sha qoralamani tasdiqlang`)
  const name=itemName(s,sug.itemId)
  const demand=[...new Set((sug.origins.length?sug.origins:sug.refs).map(r=>r.code))].join(', ')
  const source=`MRP ${key}${demand?` · ${demand}`:''}`
  if(sug.type==='make'){
    if(sug.blocked)return fail(s,`${name}: ${sug.blocked}`)
    const start=sug.releaseDate<today?today:sug.releaseDate
    const salesIds=[...new Set(sug.origins.filter(r=>r.kind==='sales').map(r=>r.id))]
    const so=salesIds.length===1?s.salesOrders.find(x=>x.id===salesIds[0]&&x.mode==='Make-to-order'):undefined
    const out=createProductionOrder(s,ctx,{productId:sug.itemId,quantity:Math.ceil(sug.qty),start,due:sug.needDate<start?start:sug.needDate,source,salesOrderId:so?.id,priority:sug.pastDue?'Yuqori':undefined})
    if(!out.result.ok)return out
    return ok(logActivity(out.state,ctx,'MRP tavsiyasi → MO','Rejalashtirish',key,'info',source),`${out.result.message} (MRP)`,out.result.id)
  }
  if(isProductItem(s,sug.itemId))return fail(s,`${name}: ${sug.blocked||'mahsulotni PO bilan xarid qilib bo‘lmaydi'}`)
  const supplierId=opts.supplierId||sug.supplierId
  if(!supplierId)return fail(s,`${name}: supplier tanlanmagan — tavsiyada supplierni tanlang`)
  // Another supplier than the planned one gets its own purchase unit and MOQ applied to the net need.
  const link=findLink(s,supplierId,sug.itemId)
  const qty=link&&supplierId!==sug.supplierId?orderProposal(link,sug.netQty).stockQty:sug.qty
  const orders=[...new Set([...sug.refs,...sug.origins].filter(r=>r.kind==='mo').map(r=>r.id))]
  const out=createPurchaseOrder(s,ctx,{supplierId,lines:[{materialId:sug.itemId,qty}],status:'Qoralama',expectedDate:sug.pastDue?undefined:sug.needDate,source,productionOrderIds:orders})
  if(!out.result.ok)return out
  return ok(logActivity(out.state,ctx,'MRP tavsiyasi → PO qoralama','Rejalashtirish',key,'info',source),`${out.result.message} — qoralama, tasdiqlash kerak (MRP)`,out.result.id)
}

export function setForecast(s:S,ctx:Ctx,productId:string,period:string,qty:number):Outcome{
  const value=Math.max(0,Math.round(Number(qty)||0))
  const existing=s.forecasts.find(f=>f.productId===productId&&f.period===period)
  const forecasts=existing?s.forecasts.map(f=>f===existing?{...f,qty:value}:f):[...s.forecasts,{id:ctx.id('fc'),productId,period,qty:value}]
  return ok(logActivity({...s,forecasts},ctx,'Forecast yangilandi','Rejalashtirish',itemName(s,productId),'info',`${period}: ${value}`),'Forecast saqlandi')
}
