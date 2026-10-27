// Time-phased planning: multi-level BOM explosion with cycle detection, MRP netting per date bucket with demand
// pegging, and finite forward scheduling of work orders on work-center calendars. Everything here is a pure read
// of the state — planning never changes stock; suggestions become documents only through domain actions.
import type {Bom,BomComponent,ManufacturingState,ProductionOrder} from '../types'
import {
  SHIFT_START_MINUTE,activeBomFor,bucketDemand,estimateOrderCost,incomingSupply,isMakeToOrder,isOpenOrder,isOpenWorkOrder,isProductItem,itemName,itemUnit,
  perUnit,remainingQty,stockOf,workCenterDay,workOrderRemainingMinutes,
} from './manufacturingEngine'
import {chooseSupplier,findLink,linkUnitCost,orderProposal,orderableLinks,preferredSupplierId} from './supplierMaterials'
import {addDays,daysBetween,isoDate,minutesBetween,parseDate,stamp,todayISO,weekStart} from '../utils/dates'

type S=ManufacturingState
const q3=(n:number)=>Math.round(n*1000)/1000

/* ----------------------------------------------------- BOM explosion -- */

/** BOM a component explodes into: its explicit sub-BOM, else the active BOM of a product made in-house. */
function childBom(s:S,c:BomComponent,override?:Bom):Bom|undefined{
  if(c.subBomId)return override&&override.id===c.subBomId?override:s.boms.find(b=>b.id===c.subBomId)
  const product=s.products.find(p=>p.id===c.materialId)
  if(!product||product.procurement==='buy')return undefined
  if(override&&override.productId===product.id)return override
  return activeBomFor(s,product.id)
}

const bomLabel=(s:S,b:Bom)=>`${b.code} (${itemName(s,b.productId)})`

/**
 * The first circular reference reachable from `bom` (a product that ends up inside itself through sub-assemblies),
 * as a readable path, or null. `bom` may be a draft that is not saved yet: it stands in for its product's BOM.
 */
export function findBomCycle(s:S,bom:Bom):string[]|null{
  const walk=(current:Bom,stack:Bom[]):string[]|null=>{
    const seen=stack.findIndex(b=>b.id===current.id||b.productId===current.productId)
    if(seen>=0)return [...stack.slice(seen),current].map(b=>bomLabel(s,b))
    for(const c of current.components){
      if(c.materialId===current.productId)return [bomLabel(s,current),bomLabel(s,current)]
      const child=childBom(s,c,bom)
      if(!child)continue
      const found=walk(child,[...stack,current])
      if(found)return found
    }
    return null
  }
  return walk(bom,[])
}

export type ExplosionLine={itemId:string;level:number;qty:number;unit:string;parentId:string;path:string[];kind:'product'|'material';exploded:boolean}
export type Explosion={lines:ExplosionLine[];totals:{itemId:string;qty:number;unit:string}[];error?:string}

/**
 * Multi-level explosion of `quantity` units of a BOM: every line with its level and path, and the totals of the
 * leaves (raw materials and bought items) including planned waste. A circular reference or an invalid quantity
 * returns an error and no partial result.
 */
export function explodeBom(s:S,bomId:string,quantity:number):Explosion{
  const root=s.boms.find(b=>b.id===bomId)
  if(!root)return {lines:[],totals:[],error:'BOM topilmadi'}
  if(!Number.isFinite(quantity)||quantity<0)return {lines:[],totals:[],error:'Miqdor 0 yoki musbat son bo‘lishi kerak'}
  const cycle=findBomCycle(s,root)
  if(cycle)return {lines:[],totals:[],error:`Aylanma BOM: ${cycle.join(' → ')}`}
  const lines:ExplosionLine[]=[],totals=new Map<string,{itemId:string;qty:number;unit:string}>()
  const walk=(bom:Bom,qty:number,level:number,path:string[])=>{
    for(const c of bom.components){
      const need=qty*perUnit(c)
      const child=childBom(s,c)
      const kind=isProductItem(s,c.materialId)?'product':'material'
      lines.push({itemId:c.materialId,level,qty:q3(need),unit:c.unit,parentId:bom.productId,path:[...path,c.materialId],kind,exploded:Boolean(child)})
      if(child){walk(child,need,level+1,[...path,c.materialId]);continue}
      const t=totals.get(c.materialId)
      totals.set(c.materialId,{itemId:c.materialId,qty:(t?.qty??0)+need,unit:c.unit})
    }
  }
  walk(root,quantity,1,[root.productId])
  return {lines,totals:[...totals.values()].map(t=>({...t,qty:q3(t.qty)}))}
}

/* ---------------------------------------------------------------- MRP -- */

export type DemandRef={kind:'sales'|'forecast'|'mo'|'planned'|'safety';id:string;code:string;itemId:string;qty:number;date:string}
export type MrpBucket={start:string;end:string;gross:number;scheduled:number;projected:number;net:number;plannedReceipt:number;plannedRelease:number}
export type MrpSuggestion={
  /** Stable identity: type, item and need date — one suggestion per item and bucket, never two for the same demand. */
  key:string;type:'make'|'buy';itemId:string;level:number;
  /** Lot-sized quantity to order / produce, and the net requirement it covers. */
  qty:number;netQty:number;needDate:string;releaseDate:string;pastDue:boolean;leadTime:number;
  supplierId?:string;unitCost?:number;makeOrBuy:string;
  /** Demand this receipt covers (pegging) and, through parent planned orders, the independent demand it comes from. */
  refs:DemandRef[];origins:DemandRef[];
  /** A draft PO already raised for this suggestion; confirming again would duplicate it. */
  existing?:string;
  /** Why the suggestion cannot be confirmed automatically. */
  blocked?:string;issues:string[];
}
export type MrpRow={itemId:string;name:string;kind:'product'|'material';level:number;unit:string;procurement:'make'|'buy';
  leadTime:number;leadTimeSource:'supplier'|'material'|'product'|'routing'|'missing';
  onHand:number;reserved:number;quarantine:number;available:number;safety:number;buckets:MrpBucket[];issues:string[]}
export type MrpOptions={today?:string;bucket?:'week'|'day';horizonWeeks?:number;horizonDays?:number}

const OPEN_SALES=(status:string)=>status!=='Bekor'&&status!=='Yetkazildi'

/**
 * Time-phased MRP. Buckets are weeks (Monday–Sunday) or days from today; anything due earlier falls into the
 * first bucket. Per item, lowest BOM level first:
 *   gross requirement = unreserved sales (make-to-stock consumes the forecast, make-to-order comes on top)
 *                     + component needs of open MOs that hold no reservation + component needs of parent planned orders
 *   scheduled receipt = open MO quantity at its due date / confirmed PO open quantity at its expected date
 *   projected available = previous + scheduled − gross, starting from available stock (on hand − reserved − quarantine)
 *   net requirement = max(0, safety stock − projected available) → planned receipt (lot-sized), released lead time earlier.
 * Reserved stock is outside "available" and the orders / sales lines holding it are outside gross, so nothing is
 * counted twice. Quarantined stock is not counted until QC releases it.
 */
export function runMrp(s:S,opts:MrpOptions={}){
  const today=opts.today??todayISO()
  const daily=opts.bucket==='day'
  const count=Math.max(1,Math.min(daily?60:26,Math.floor(daily?opts.horizonDays??14:opts.horizonWeeks??8)))
  const first=daily?today:weekStart(today)
  const periods=Array.from({length:count},(_,i)=>{const start=addDays(first,daily?i:i*7);return {start,end:daily?start:addDays(start,6)}})
  const horizonEnd=periods[periods.length-1].end
  const bucketOf=(date:string)=>date<=periods[0].end?0:date>horizonEnd?-1:periods.findIndex(p=>date>=p.start&&date<=p.end)
  const issues:string[]=[]

  // Low-level codes over item edges (parent product → component), with circular references found on the way.
  const levels=new Map<string,number>(),cyclic=new Set<string>()
  const visit=(productId:string,depth:number,stack:string[])=>{
    if(stack.includes(productId)){for(const p of stack.slice(stack.indexOf(productId)))cyclic.add(p);return}
    const known=levels.get(productId)
    if(known!==undefined&&known>=depth&&stack.length)return
    levels.set(productId,Math.max(known??0,depth))
    for(const c of activeBomFor(s,productId)?.components||[]){
      if(isProductItem(s,c.materialId))visit(c.materialId,depth+1,[...stack,productId])
      else levels.set(c.materialId,Math.max(levels.get(c.materialId)??0,depth+1))
    }
  }
  for(const p of s.products)visit(p.id,levels.get(p.id)??0,[])
  if(cyclic.size)issues.push(`Aylanma BOM: ${[...cyclic].map(id=>itemName(s,id)).join(', ')} — bu mahsulotlar portlatilmadi`)

  type Acc={gross:number[];scheduled:number[];refs:DemandRef[][];mts:number[];mto:number[];forecast:number[];forecastIds:string[][]}
  const acc=new Map<string,Acc>()
  const of=(itemId:string)=>{
    let a=acc.get(itemId)
    if(!a){const z=()=>periods.map(()=>0);a={gross:z(),scheduled:z(),refs:periods.map(()=>[]),mts:z(),mto:z(),forecast:z(),forecastIds:periods.map(()=>[])};acc.set(itemId,a)}
    return a
  }
  const addGross=(itemId:string,date:string,ref:DemandRef)=>{
    const b=bucketOf(date)
    if(b<0||ref.qty<=0)return
    const a=of(itemId);a.gross[b]+=ref.qty;a.refs[b].push(ref)
  }

  // Independent demand: sales and forecast per product bucket, combined with forecast consumption.
  for(const so of s.salesOrders.filter(o=>OPEN_SALES(o.status)))for(const line of so.items){
    const open=Math.max(0,line.qty-line.delivered-(line.reserved||0))
    const b=bucketOf(so.deliveryDate)
    if(open<=0||b<0)continue
    const a=of(line.productId)
    if(isMakeToOrder(so))a.mto[b]+=open;else a.mts[b]+=open
    a.refs[b].push({kind:'sales',id:so.id,code:so.code,itemId:line.productId,qty:open,date:so.deliveryDate})
  }
  for(const f of s.forecasts){
    if(f.period<weekStart(today)||f.qty<=0)continue
    const b=bucketOf(f.period)
    if(b<0)continue
    const a=of(f.productId);a.forecast[b]+=f.qty;a.forecastIds[b].push(f.id)
  }
  for(const [itemId,a] of acc)a.gross=a.gross.map((g,b)=>{
    const total=bucketDemand(a.forecast[b],a.mts[b],a.mto[b])
    const extra=total-a.mts[b]-a.mto[b]
    if(extra>0)a.refs[b].push({kind:'forecast',id:a.forecastIds[b].join(','),code:`Forecast ${periods[b].start}`,itemId,qty:extra,date:periods[b].start})
    return g+total
  })

  // Open orders: their remaining output is a scheduled receipt; unreserved ones still need their components.
  for(const o of s.productionOrders.filter(x=>isOpenOrder(x)&&!x.reworkOf)){
    const rest=remainingQty(o)
    const b=bucketOf(o.due)
    if(rest>0&&b>=0)of(o.productId).scheduled[b]+=rest
    if(o.materialReserved||rest<=0)continue
    for(const c of o.bomSnapshot.components){
      if(c.unit&&c.unit!==itemUnit(s,c.materialId)){issues.push(`${o.code}: ${itemName(s,c.materialId)} BOM birligi ${c.unit} ≠ ombor birligi — talabga qo‘shilmadi`);continue}
      const when=o.start<today?today:o.start
      addGross(c.materialId,when,{kind:'mo',id:o.id,code:o.code,itemId:c.materialId,qty:perUnit(c)*rest,date:when})
    }
  }
  // Confirmed purchase orders: open quantity on the expected date (overdue ones count as arriving now).
  for(const m of s.rawMaterials)for(const sup of incomingSupply(s,m.id)){
    const b=bucketOf(sup.expectedDate)
    if(b>=0)of(m.id).scheduled[b]+=sup.qty
  }

  const items=[...s.products.filter(p=>p.status!=='Arxiv').map(p=>({id:p.id,kind:'product' as const})),...s.rawMaterials.filter(m=>m.status!=='Arxiv').map(m=>({id:m.id,kind:'material' as const}))]
    .sort((x,y)=>(levels.get(x.id)??0)-(levels.get(y.id)??0)||Number(x.kind==='material')-Number(y.kind==='material'))
  const rows:MrpRow[]=[],suggestions:MrpSuggestion[]=[]
  // Independent demand behind each planned order, so a component suggestion can name the sales order it serves.
  const parentOrigins=new Map<string,DemandRef[]>()
  const drafts=s.purchaseOrders.filter(p=>p.status==='Qoralama'&&p.source)

  for(const item of items){
    const product=item.kind==='product'?s.products.find(p=>p.id===item.id)!:undefined
    const material=item.kind==='material'?s.rawMaterials.find(m=>m.id===item.id)!:undefined
    const a=of(item.id)
    const stock=stockOf(s,item.id)
    const safety=material?Math.max(0,material.minStock||0):0
    const rowIssues:string[]=[]
    const procurement:'make'|'buy'=product?(product.procurement==='buy'?'buy':'make'):'buy'
    const bom=product&&procurement==='make'?activeBomFor(s,product.id):undefined
    // Lead time: the preferred supplier's terms, else the item's own; production: the product's, else the routing's.
    // Without a preferred supplier each buy suggestion picks its own (lead time vs need date, price with MOQ).
    const fixedSupplier=material?preferredSupplierId(s,material.id):undefined
    const link=fixedSupplier&&material?findLink(s,fixedSupplier,material.id):undefined
    let leadTime=0,leadTimeSource:MrpRow['leadTimeSource']='missing'
    if(material){
      if(link&&link.leadTime>0){leadTime=link.leadTime;leadTimeSource='supplier'}
      else if(material.leadTime>0){leadTime=material.leadTime;leadTimeSource='material'}
    }else if(product){
      if(product.leadTime>0){leadTime=product.leadTime;leadTimeSource='product'}
      else if(bom?.operations.length){
        const shift=Math.max(60,s.settings.policies.shiftMinutes||480)
        leadTime=Math.max(1,Math.ceil(bom.operations.reduce((x,op)=>x+op.setupMin+op.runMin,0)/shift));leadTimeSource='routing'
      }
    }
    if(leadTimeSource==='missing')rowIssues.push('Lead time kiritilmagan — 0 kun deb hisoblandi')
    let blocked:string|undefined
    if(product&&procurement==='make'){
      if(cyclic.has(product.id))blocked='Aylanma BOM — tuzatilmaguncha rejalashtirilmaydi'
      else if(!bom)blocked='Faol BOM yo‘q'
      else if(!bom.operations.length)rowIssues.push('Routing yo‘q — sig‘im rejalashtirilmaydi')
      else if(bom.operations.some(op=>!s.workCenters.some(w=>w.id===op.workCenterId)))rowIssues.push('Routing work center topilmadi — sig‘im ma’lumoti yo‘q')
    }
    if(product&&procurement==='buy')blocked='Mahsulot “buy” — PO faqat xomashyo uchun, qo‘lda hal qiling'
    if(material&&!orderableLinks(s,material.id).length)rowIssues.push('Supplier biriktirilmagan')

    // Netting with FIFO pegging: stock and receipts above safety stock cover the earliest demand first; a planned
    // receipt is pegged to the demand still uncovered, and what it adds beyond that restores safety stock / lot size.
    const queue:{ref:DemandRef;open:number}[]=[]
    let pool=stock.available,projected=stock.available
    const buckets:MrpBucket[]=periods.map((p,b)=>{
      const gross=q3(a.gross[b]),scheduled=q3(a.scheduled[b])
      projected=projected+scheduled-gross
      pool+=scheduled
      for(const ref of a.refs[b])queue.push({ref,open:ref.qty})
      const cover=(take?:(q:{ref:DemandRef;open:number},t:number)=>void)=>{for(const q of queue){const free=pool-safety;if(free<=1e-9)break;if(q.open<=1e-9)continue;const t=Math.min(free,q.open);q.open-=t;pool-=t;take?.(q,t)}}
      cover()
      let net=0,receipt=0,release=0
      if(projected<safety-1e-9){
        net=q3(safety-projected)
        const demandDates=a.refs[b].map(r=>r.date).filter(d=>d>=p.start).sort()
        const needDate=b===0&&demandDates.length===0?(p.start<today?today:p.start):demandDates[0]||p.start
        // The supplier of this receipt: lead time against the need date, then price with its purchase unit and MOQ.
        const choice=material?chooseSupplier(s,material.id,net,needDate,today):undefined
        const buyLink=choice?.link
        const supplierId=buyLink?.supplierId
        const lead=material?(buyLink&&buyLink.leadTime>0?buyLink.leadTime:material.leadTime>0?material.leadTime:0):leadTime
        const lot=material&&buyLink?orderProposal(buyLink,net).stockQty:Math.ceil(net-1e-9)
        receipt=lot;projected+=lot;pool+=lot
        const refs:DemandRef[]=[]
        cover((q,t)=>refs.push({...q.ref,qty:q3(t)}))
        const covered=refs.reduce((x,r)=>x+r.qty,0)
        if(lot-covered>1e-6)refs.push({kind:'safety',id:item.id,code:safety>0?'Safety stock / lot':'Lot o‘lchami',itemId:item.id,qty:q3(lot-covered),date:p.start})
        const releaseDate=addDays(needDate,-lead)
        release=lot
        const type:'make'|'buy'=procurement==='make'&&product?'make':'buy'
        const key=`${type}:${item.id}:${needDate}`
        const origins=refs.flatMap(r=>r.kind==='planned'?(parentOrigins.get(r.id)||[]):[r])
        const unitCost=type==='make'&&bom?estimateOrderCost(s,{bomSnapshot:bom,quantity:Math.max(1,lot)}).total/Math.max(1,lot):buyLink&&buyLink.price>0?linkUnitCost(buyLink):material?.standardCost
        const makeOrBuy=type==='make'?`Make — ${bom?`${bom.code} ${bom.version}`:'BOM yo‘q'}`:material?`Buy — ${supplierId?s.suppliers.find(x=>x.id===supplierId)?.name:'supplier tanlanmagan'}`:'Buy — mahsulot'
        const issues=[...rowIssues,...(choice&&!fixedSupplier?[`Supplier: ${choice.supplierName} — ${choice.reason||'tavsiya'}`]:[]),...(choice?.missing?[`${choice.supplierName}: ${choice.missing}`]:[]),...(choice&&choice.onTime===false?[`${choice.supplierName} muddatga ulgurmaydi (${choice.expectedDate})`]:[])]
        const suggestion:MrpSuggestion={key,type,itemId:item.id,level:levels.get(item.id)??0,qty:q3(lot),netQty:net,needDate,releaseDate,pastDue:releaseDate<today,leadTime:lead,
          supplierId,unitCost,makeOrBuy,refs,origins,existing:drafts.find(d=>d.source!.includes(`MRP ${key}`))?.code,
          blocked:blocked||(type==='buy'&&!supplierId?'Supplier tanlanmagan':undefined),issues}
        suggestions.push(suggestion)
        parentOrigins.set(key,origins)
        // A make suggestion releases its components lead time earlier: dependent demand of the next level.
        if(type==='make'&&bom&&!blocked)for(const c of bom.components){
          if(c.unit&&c.unit!==itemUnit(s,c.materialId)){rowIssues.push(`${itemName(s,c.materialId)}: BOM birligi ${c.unit} ≠ ombor birligi`);continue}
          const when=releaseDate<today?today:releaseDate
          addGross(c.materialId,when,{kind:'planned',id:key,code:`MRP ${itemName(s,item.id)}`,itemId:c.materialId,qty:perUnit(c)*lot,date:when})
        }
      }
      return {start:p.start,end:p.end,gross,scheduled,projected:q3(projected),net,plannedReceipt:q3(receipt),plannedRelease:q3(release)}
    })
    rows.push({itemId:item.id,name:itemName(s,item.id),kind:item.kind,level:levels.get(item.id)??0,unit:itemUnit(s,item.id),procurement,leadTime,leadTimeSource,
      onHand:q3(stock.onHand),reserved:q3(stock.reserved),quarantine:q3(stock.quarantine),available:q3(stock.available),safety,buckets,issues:rowIssues})
  }
  return {today,bucket:daily?'day' as const:'week' as const,periods,rows,suggestions,issues}
}
export type MrpResult=ReturnType<typeof runMrp>

/* ---------------------------------------------------- Finite schedule -- */

const PRIORITY_RANK:Record<ProductionOrder['priority'],number>={Past:0,Normal:1,Yuqori:2,Kritik:3}
const RUNNING:ProductionOrder['status'][]=['Jarayonda','Pauzada','Sifat nazoratida']

export type ScheduledOperation={orderId:string;orderCode:string;workOrderId:string;name:string;workCenterId:string;start:string;end:string;
  /** Remaining routing minutes and the clock minutes they take at the work center's efficiency. */
  workMinutes:number;clockMinutes:number;late:boolean}
export type OrderSchedule={orderId:string;code:string;start?:string;end?:string;due:string;late:boolean;unscheduled?:string}

const at=(date:string,minute:number)=>stamp(new Date(parseDate(date).getTime()+(SHIFT_START_MINUTE+minute)*60000))

/**
 * Finite forward schedule of every open work order: orders in progress first, then by due date and priority.
 * Each operation starts after its predecessors end and after the order's start, at its work center's next free
 * clock time; it fills working days only (calendar, shifts, maintenance, stops — workCenterDay) and never overlaps
 * another operation on the same work center. Work that does not fit the horizon is reported, not invented.
 */
export function scheduleOperations(s:S,{now=new Date(),horizonDays=60,orders:only}:{now?:Date;horizonDays?:number;orders?:ProductionOrder[]}={}){
  const today=isoDate(now),horizonEnd=addDays(today,horizonDays-1)
  const nowOffset=Math.max(0,minutesBetween(at(today,0),stamp(now)))
  const used=new Map<string,number>()
  const dayCache=new Map<string,number>()
  const clockOf=(wcId:string,date:string)=>{
    const k=`${wcId}|${date}`
    let v=dayCache.get(k)
    if(v===undefined){const wc=s.workCenters.find(w=>w.id===wcId);v=wc?workCenterDay(s,wc,date,now).clock:0;dayCache.set(k,v)}
    return v
  }
  const list=(only||s.productionOrders).filter(o=>isOpenOrder(o)&&o.workOrders.some(isOpenWorkOrder))
    .sort((a,b)=>Number(RUNNING.includes(b.status))-Number(RUNNING.includes(a.status))||a.due.localeCompare(b.due)||PRIORITY_RANK[b.priority]-PRIORITY_RANK[a.priority]||a.createdAt.localeCompare(b.createdAt)||a.code.localeCompare(b.code))
  const operations:ScheduledOperation[]=[],orders=new Map<string,OrderSchedule>()
  for(const order of list){
    const ends=new Map<string,{date:string;offset:number}|null>()
    for(const w of order.workOrders.filter(x=>!isOpenWorkOrder(x)))ends.set(w.operationId,{date:today,offset:0})
    const pending=order.workOrders.filter(isOpenWorkOrder).sort((a,b)=>a.sequence-b.sequence)
    const row:OrderSchedule={orderId:order.id,code:order.code,due:order.due,late:false}
    let guard=pending.length*pending.length+1
    while(pending.length&&guard-->0){
      const index=pending.findIndex(w=>w.dependsOn.every(d=>ends.has(d)||!order.workOrders.some(x=>x.operationId===d)))
      if(index<0){row.unscheduled='Operatsiyalar bog‘liqligi aylanma';break}
      const wo=pending.splice(index,1)[0]
      const preds=wo.dependsOn.map(d=>ends.get(d)).filter(x=>x!==undefined)
      if(preds.some(p=>p===null)){ends.set(wo.operationId,null);row.unscheduled??='Oldingi operatsiya rejalashtirish oralig‘idan tashqarida';continue}
      const wc=s.workCenters.find(w=>w.id===wo.workCenterId)
      const work=workOrderRemainingMinutes(order,wo)
      if(!wc||wc.efficiency<=0){ends.set(wo.operationId,null);row.unscheduled=`${wo.name}: work center ma’lumoti yo‘q`;continue}
      let need=work/(wc.efficiency/100)
      const clockMinutes=Math.round(need)
      // Earliest: now (or the order's start day), then after the latest predecessor.
      let day=order.start>today?order.start:today,offset=order.start>today?0:nowOffset
      for(const p of preds as {date:string;offset:number}[])if(p.date>day||(p.date===day&&p.offset>offset)){day=p.date;offset=p.offset}
      let start:{date:string;offset:number}|undefined,end:{date:string;offset:number}|undefined
      if(need<=1e-9){start=end={date:day,offset}}
      while(need>1e-9&&day<=horizonEnd){
        const cap=clockOf(wc.id,day),k=`${wc.id}|${day}`
        const begin=Math.max(used.get(k)??0,offset)
        if(begin<cap){
          const take=Math.min(need,cap-begin)
          used.set(k,begin+take);need-=take
          start??={date:day,offset:begin};end={date:day,offset:begin+take}
          if(need<=1e-9)break
        }
        day=addDays(day,1);offset=0
      }
      if(need>1e-9||!start||!end){ends.set(wo.operationId,null);row.unscheduled=`${wo.name}: ${horizonDays} kunlik oraliqqa sig‘madi`;continue}
      ends.set(wo.operationId,end)
      const late=end.date>order.due
      operations.push({orderId:order.id,orderCode:order.code,workOrderId:wo.id,name:wo.name,workCenterId:wc.id,start:at(start.date,start.offset),end:at(end.date,end.offset),workMinutes:Math.round(work),clockMinutes,late})
      row.start=!row.start||at(start.date,start.offset)<row.start?at(start.date,start.offset):row.start
      row.end=!row.end||at(end.date,end.offset)>row.end?at(end.date,end.offset):row.end
    }
    row.late=Boolean(row.end&&row.end.slice(0,10)>order.due)||Boolean(row.unscheduled)
    orders.set(order.id,row)
  }
  return {from:today,horizonDays,operations,orders,usage:used}
}

/**
 * Why an order cannot start on `date` as planned: work centers of its first open operations that do not work that
 * day (calendar), are fully taken by maintenance or a stop, or a date in the past. Empty = no conflict.
 */
export function scheduleConflicts(s:S,order:ProductionOrder,date:string,now=new Date()):string[]{
  const conflicts:string[]=[]
  if(date<isoDate(now))conflicts.push(`${date} o‘tgan sana`)
  const open=order.workOrders.filter(isOpenWorkOrder)
  const firsts=open.filter(w=>!w.dependsOn.some(d=>open.some(x=>x.operationId===d)))
  for(const wc of [...new Set(firsts.map(w=>w.workCenterId))].map(id=>s.workCenters.find(w=>w.id===id))){
    if(!wc){conflicts.push('Work center topilmadi');continue}
    const day=workCenterDay(s,wc,date,now)
    if(!day.working)conflicts.push(`${wc.name} ${date} kuni ishlamaydi (kalendar)`)
    else if(day.clock<=0)conflicts.push(`${wc.name} ${date} kuni band: texnik xizmat yoki to‘xtash (${day.blocked} min)`)
  }
  return conflicts
}

/** Days between the order's start and due (kept when an order is moved). */
export const orderSpan=(o:Pick<ProductionOrder,'start'|'due'>)=>Math.max(0,daysBetween(o.start,o.due))
