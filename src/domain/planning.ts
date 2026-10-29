// Time-phased planning: multi-level BOM explosion with cycle detection, MRP netting per date bucket with demand
// pegging, and finite forward scheduling of work orders on work-center calendars. Everything here is a pure read
// of the state — planning never changes stock; suggestions become documents only through domain actions.
import type {Bom,BomComponent,ManufacturingState,ProductionOrder,RawMaterial,SalesOrder} from '../types'
import {
  activeBomFor,bucketDemand,estimateOrderCost,incomingSupply,isMakeToOrder,isOpenOrder,isOpenWorkOrder,isProductItem,itemName,itemUnit,
  perUnit,remainingQty,unconvertedLine,workCenterDay,workCenterWindows,workOrderRemainingMinutes,
} from './manufacturingEngine'
import {baseId,itemKeyFor,keyOf,splitKey,stockKey} from './inventory'
import {chooseSupplier,findLink,linkUnitCost,orderProposal,orderableLinks,preferredSupplierId} from './supplierMaterials'
import {addDays,daysBetween,isoDate,parseDate,stamp,todayISO,weekStart} from '../utils/dates'

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
      // perUnit is in the component's stock unit (BOM line UoM factor applied), so totals of one item always add up.
      const unit=itemUnit(s,c.materialId)
      lines.push({itemId:c.materialId,level,qty:q3(need),unit,parentId:bom.productId,path:[...path,c.materialId],kind,exploded:Boolean(child)})
      if(child){walk(child,need,level+1,[...path,c.materialId]);continue}
      const t=totals.get(c.materialId)
      totals.set(c.materialId,{itemId:c.materialId,qty:(t?.qty??0)+need,unit})
    }
  }
  walk(root,quantity,1,[root.productId])
  return {lines,totals:[...totals.values()].map(t=>({...t,qty:q3(t.qty)}))}
}

/* ---------------------------------------------------------------- MRP -- */

export type DemandRef={kind:'sales'|'forecast'|'mo'|'planned'|'safety';id:string;code:string;itemId:string;qty:number;date:string}
export type MrpBucket={start:string;end:string;gross:number;scheduled:number;projected:number;net:number;plannedReceipt:number;plannedRelease:number}
export type MrpSuggestion={
  /** Stable identity: type, item, need date and site — one suggestion per item, bucket and site, never two for the same demand. */
  key:string;type:'make'|'buy';itemId:string;level:number;
  /** Planning site (branch): a buy becomes a PO into this branch's raw store, a make an MO on this branch's line. */
  branchId:string;
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
/**
 * Another site holds stock the requesting site could use instead of buying or making: a recommendation only. Nothing
 * moves until someone posts an actual warehouse transfer (transferStock); the buy/make suggestion stays beside it.
 */
export type MrpTransfer={key:string;itemId:string;fromBranchId:string;toBranchId:string;qty:number;needDate:string;forSuggestion:string;refs:DemandRef[]}
export type MrpRow={itemId:string;name:string;kind:'product'|'material';level:number;unit:string;procurement:'make'|'buy';
  /** Planning site: stock, receipts and demand of this branch only (audit #16). */
  branchId:string;
  leadTime:number;leadTimeSource:'supplier'|'material'|'product'|'routing'|'missing';
  onHand:number;reserved:number;quarantine:number;available:number;safety:number;buckets:MrpBucket[];issues:string[]}
export type MrpOptions={today?:string;bucket?:'week'|'day';horizonWeeks?:number;horizonDays?:number;
  /** Plan one site only; without it every active branch is planned on its own and the results are listed together. */
  branchId?:string}

const OPEN_SALES=(status:string)=>status!=='Bekor'&&status!=='Yetkazildi'

/** Branch of a warehouse id. */
const branchOfWarehouse=(s:S,warehouseId?:string)=>s.warehouses.find(w=>w.id===warehouseId)?.branchId
/** Planning site of a production order: its output store's branch, else its line's. */
export const orderSite=(s:S,o:Pick<ProductionOrder,'warehouseId'|'lineId'>)=>branchOfWarehouse(s,o.warehouseId)||s.productionLines.find(l=>l.id===o.lineId)?.branchId||''
/**
 * Selling site of a sales order (audit #16): its own branch; for an order saved before that field, where it reserved
 * stock, else where its MOs deliver, else the company's default branch.
 */
export function salesSite(s:S,so:SalesOrder){
  if(so.branchId)return so.branchId
  for(const i of so.items)for(const r of i.reservations||[]){const b=branchOfWarehouse(s,r.warehouseId);if(b)return b}
  for(const i of so.items){const b=branchOfWarehouse(s,i.warehouseId);if(b)return b}
  for(const id of so.productionOrderIds?.length?so.productionOrderIds:so.productionOrderId?[so.productionOrderId]:[]){const o=s.productionOrders.find(x=>x.id===id);if(o)return orderSite(s,o)}
  return s.settings.defaultBranchId||s.branches[0]?.id||''
}
const forecastSite=(s:S,f:S['forecasts'][number])=>f.branchId||s.settings.defaultBranchId||s.branches[0]?.id||''

/**
 * Safety stock of a material at one planning site: its own `siteSafety` entry, else `minStock` at the default branch
 * (the figure saved before sites) and none elsewhere — a site never borrows another site's safety stock.
 */
export function siteSafetyStock(s:S,material:Pick<RawMaterial,'minStock'|'siteSafety'>,site:string){
  const own=material.siteSafety?.[site]
  if(typeof own==='number'&&Number.isFinite(own))return Math.max(0,own)
  return site===(s.settings.defaultBranchId||s.branches[0]?.id||'')?Math.max(0,material.minStock||0):0
}

/** Stock of one item key in one branch's warehouses. */
function siteStock(s:S,key:string,branchId:string){
  const rows=s.stockBalances.filter(b=>keyOf(b)===key&&branchOfWarehouse(s,b.warehouseId)===branchId)
  const onHand=rows.reduce((a,b)=>a+b.onHand,0),reserved=rows.reduce((a,b)=>a+b.reserved,0),quarantine=rows.reduce((a,b)=>a+(b.quarantine||0),0)
  return {onHand,reserved,quarantine,available:Math.max(0,onHand-reserved-quarantine)}
}

/**
 * Time-phased MRP per planning site (audit #16). Buckets are weeks (Monday–Sunday) or days from today; anything due
 * earlier falls into the first bucket. Every branch is netted on its own — its stores' stock, its POs, its MOs, the
 * sales orders it sells and its forecasts — so branch A never treats branch B stock as available. Per item (product,
 * variant of a variant-tracked product, material), lowest BOM level first:
 *   gross requirement = unreserved sales (make-to-stock consumes the forecast, make-to-order comes on top)
 *                     + component needs of open MOs that hold no reservation + component needs of parent planned orders
 *   scheduled receipt = open MO quantity at its due date / confirmed PO open quantity at its expected date
 *   projected available = previous + scheduled − gross, starting from available stock (on hand − reserved − quarantine)
 *   net requirement = max(0, safety stock − projected available) → planned receipt (lot-sized), released lead time earlier.
 * BOM quantities are in stock units (perUnit applies the UoM factor saved on the BOM line). Reserved stock is outside
 * "available" and the orders / sales lines holding it are outside gross, so nothing is counted twice. Quarantined stock
 * is not counted until QC releases it. Where another site could spare stock, a transfer recommendation is listed.
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
  const levelOf=(key:string)=>levels.get(baseId(key))??0

  // Planned items: a variant-tracked product plans each active variant on its own, plus its legacy unassigned stock.
  const itemKeys=[
    ...s.products.filter(p=>p.status!=='Arxiv').flatMap(p=>[p.id,...(p.variantStock?p.variants.filter(v=>v.status==='Faol').map(v=>stockKey(p.id,v.id)):[])]).map(id=>({id,kind:'product' as const})),
    ...s.rawMaterials.filter(m=>m.status!=='Arxiv').map(m=>({id:m.id,kind:'material' as const})),
  ].sort((x,y)=>levelOf(x.id)-levelOf(y.id)||Number(x.kind==='material')-Number(y.kind==='material'))
  const sites=s.branches.filter(b=>b.status!=='Arxiv'&&(!opts.branchId||b.id===opts.branchId)).map(b=>b.id)
  const drafts=s.purchaseOrders.filter(p=>p.status==='Qoralama'&&p.source)
  const rows:MrpRow[]=[],suggestions:MrpSuggestion[]=[]
  // Lowest projected availability over the horizon before any planned receipt, per site and item: what it could spare.
  const spare=new Map<string,{min:number;safety:number}>()

  for(const site of sites){
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

    // Independent demand of this site: its sales per item bucket, combined with its forecast consumption.
    for(const so of s.salesOrders.filter(o=>OPEN_SALES(o.status)&&salesSite(s,o)===site))for(const line of so.items){
      const open=Math.max(0,line.qty-line.delivered-(line.reserved||0))
      const b=bucketOf(so.deliveryDate)
      if(open<=0||b<0)continue
      const key=itemKeyFor(s,line.productId,line.variantId)
      const a=of(key)
      if(isMakeToOrder(so))a.mto[b]+=open;else a.mts[b]+=open
      a.refs[b].push({kind:'sales',id:so.id,code:so.code,itemId:key,qty:open,date:so.deliveryDate})
    }
    for(const f of s.forecasts){
      if(f.period<weekStart(today)||f.qty<=0||forecastSite(s,f)!==site)continue
      const b=bucketOf(f.period)
      if(b<0)continue
      const a=of(itemKeyFor(s,f.productId,f.variantId));a.forecast[b]+=f.qty;a.forecastIds[b].push(f.id)
    }
    for(const [itemId,a] of acc)a.gross=a.gross.map((g,b)=>{
      const total=bucketDemand(a.forecast[b],a.mts[b],a.mto[b])
      const extra=total-a.mts[b]-a.mto[b]
      if(extra>0)a.refs[b].push({kind:'forecast',id:a.forecastIds[b].join(','),code:`Forecast ${periods[b].start}`,itemId,qty:extra,date:periods[b].start})
      return g+total
    })

    // This site's open orders: remaining output (the variant made) is a scheduled receipt; unreserved ones need components.
    for(const o of s.productionOrders.filter(x=>isOpenOrder(x)&&!x.reworkOf&&orderSite(s,x)===site)){
      const rest=remainingQty(o)
      const b=bucketOf(o.due)
      if(rest>0&&b>=0)of(itemKeyFor(s,o.productId,o.variantId)).scheduled[b]+=rest
      if(o.materialReserved||rest<=0)continue
      for(const c of o.bomSnapshot.components){
        if(unconvertedLine(s,c)){issues.push(`${o.code}: ${itemName(s,c.materialId)} BOM birligi ${c.unit} uchun konversiya yo‘q — talabga qo‘shilmadi`);continue}
        const when=o.start<today?today:o.start
        addGross(c.materialId,when,{kind:'mo',id:o.id,code:o.code,itemId:c.materialId,qty:perUnit(c)*rest,date:when})
      }
    }
    // Confirmed purchase orders into this site's stores: open quantity on the expected date (overdue ones arrive now).
    for(const m of s.rawMaterials)for(const sup of incomingSupply(s,m.id)){
      if(branchOfWarehouse(s,sup.warehouseId)!==site)continue
      const b=bucketOf(sup.expectedDate)
      if(b>=0)of(m.id).scheduled[b]+=sup.qty
    }

    // Independent demand behind each planned order, so a component suggestion can name the sales order it serves.
    const parentOrigins=new Map<string,DemandRef[]>()
    for(const item of itemKeys){
      const {itemId:baseItem,variantId}=splitKey(item.id)
      const product=item.kind==='product'?s.products.find(p=>p.id===baseItem)!:undefined
      const material=item.kind==='material'?s.rawMaterials.find(m=>m.id===item.id)!:undefined
      const a=of(item.id)
      const stock=siteStock(s,item.id,site)
      // Each site holds its own safety stock (siteSafetyStock) against its own stock, reservations and receipts.
      const safety=material?siteSafetyStock(s,material,site):0
      // A site with no stock, no demand and no receipts of an item has nothing to plan or show.
      const touched=stock.onHand>1e-9||stock.reserved>1e-9||a.gross.some(g=>g>1e-9)||a.scheduled.some(g=>g>1e-9)||safety>0&&s.warehouses.some(w=>w.branchId===site&&w.status==='Faol'&&(w.type==='Raw'||w.type==='Mixed'))
      if(!touched)continue
      const rowIssues:string[]=[]
      const procurement:'make'|'buy'=product?(product.procurement==='buy'?'buy':'make'):'buy'
      const bom=product&&procurement==='make'?activeBomFor(s,product.id,variantId):undefined
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
        else if(product.variantStock&&!variantId)blocked='Variant tanlanmagan — talab yoki forecast variantga bog‘lanmagan (variant bo‘yicha qoldiq)'
        else if(!bom)blocked='Faol BOM yo‘q'
        else if(!bom.operations.length)rowIssues.push('Routing yo‘q — sig‘im rejalashtirilmaydi')
        else if(bom.operations.some(op=>!s.workCenters.some(w=>w.id===op.workCenterId)))rowIssues.push('Routing work center topilmadi — sig‘im ma’lumoti yo‘q')
        if(!blocked&&!s.productionLines.some(l=>l.branchId===site&&l.status!=='Arxiv'))blocked='Bu filialda ishlab chiqarish liniyasi yo‘q — boshqa filialdan transfer qiling'
      }
      if(product&&procurement==='buy')blocked='Mahsulot “buy” — PO faqat xomashyo uchun, qo‘lda hal qiling'
      if(material&&!orderableLinks(s,material.id).length)rowIssues.push('Supplier biriktirilmagan')
      if(material&&!s.warehouses.some(w=>w.branchId===site&&w.status==='Faol'&&(w.type==='Raw'||w.type==='Mixed')))blocked='Bu filialda xomashyo ombori yo‘q'

      // Netting with FIFO pegging: stock and receipts above safety stock cover the earliest demand first; a planned
      // receipt is pegged to the demand still uncovered, and what it adds beyond that restores safety stock / lot size.
      const queue:{ref:DemandRef;open:number}[]=[]
      let pool=stock.available,projected=stock.available,bare=stock.available,bareMin=stock.available
      const buckets:MrpBucket[]=periods.map((p,b)=>{
        const gross=q3(a.gross[b]),scheduled=q3(a.scheduled[b])
        projected=projected+scheduled-gross
        bare=bare+scheduled-gross;bareMin=Math.min(bareMin,bare)
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
          const legacyKey=`${type}:${item.id}:${needDate}`,key=`${legacyKey}@${site}`
          const origins=refs.flatMap(r=>r.kind==='planned'?(parentOrigins.get(r.id)||[]):[r])
          const unitCost=type==='make'&&bom?estimateOrderCost(s,{bomSnapshot:bom,quantity:Math.max(1,lot)}).total/Math.max(1,lot):buyLink&&buyLink.price>0?linkUnitCost(buyLink):material?.standardCost
          const makeOrBuy=type==='make'?`Make — ${bom?`${bom.code} ${bom.version}`:'BOM yo‘q'}`:material?`Buy — ${supplierId?s.suppliers.find(x=>x.id===supplierId)?.name:'supplier tanlanmagan'}`:'Buy — mahsulot'
          const issues=[...rowIssues,...(choice&&!fixedSupplier?[`Supplier: ${choice.supplierName} — ${choice.reason||'tavsiya'}`]:[]),...(choice?.missing?[`${choice.supplierName}: ${choice.missing}`]:[]),...(choice&&choice.onTime===false?[`${choice.supplierName} muddatga ulgurmaydi (${choice.expectedDate})`]:[])]
          // A draft already raised for this suggestion (or, before sites, for the same item and date into this site).
          const existing=drafts.find(d=>d.source!.includes(`MRP ${key}`)||(new RegExp(`MRP ${legacyKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?!@)`).test(d.source!)&&branchOfWarehouse(s,d.warehouseId)===site))?.code
          const suggestion:MrpSuggestion={key,type,itemId:item.id,level:levelOf(item.id),branchId:site,qty:q3(lot),netQty:net,needDate,releaseDate,pastDue:releaseDate<today,leadTime:lead,
            supplierId,unitCost,makeOrBuy,refs,origins,existing,
            blocked:blocked||(type==='buy'&&!supplierId?'Supplier tanlanmagan':undefined),issues}
          suggestions.push(suggestion)
          parentOrigins.set(key,origins)
          // A make suggestion releases its components lead time earlier: dependent demand of the next level, same site.
          if(type==='make'&&bom&&!blocked)for(const c of bom.components){
            if(unconvertedLine(s,c)){rowIssues.push(`${itemName(s,c.materialId)}: BOM birligi ${c.unit} uchun konversiya yo‘q`);continue}
            const when=releaseDate<today?today:releaseDate
            addGross(c.materialId,when,{kind:'planned',id:key,code:`MRP ${itemName(s,item.id)}`,itemId:c.materialId,qty:perUnit(c)*lot,date:when})
          }
        }
        return {start:p.start,end:p.end,gross,scheduled,projected:q3(projected),net,plannedReceipt:q3(receipt),plannedRelease:q3(release)}
      })
      spare.set(`${site}|${item.id}`,{min:q3(bareMin),safety})
      rows.push({itemId:item.id,name:itemName(s,item.id),kind:item.kind,level:levelOf(item.id),unit:itemUnit(s,item.id),procurement,branchId:site,leadTime,leadTimeSource,
        onHand:q3(stock.onHand),reserved:q3(stock.reserved),quarantine:q3(stock.quarantine),available:q3(stock.available),safety,buckets,issues:rowIssues})
    }
  }

  // Transfer recommendations: a site whose projection never drops below its own safety stock over the horizon could
  // spare the difference. Each unit is offered once; the buy/make suggestion stays, since nothing has moved yet.
  const transfers:MrpTransfer[]=[]
  const offered=new Map<string,number>()
  for(const sug of suggestions){
    let need=sug.netQty
    for(const site of sites){
      if(site===sug.branchId||need<=1e-9)continue
      const k=`${site}|${sug.itemId}`,sp=spare.get(k)
      if(!sp)continue
      const free=q3(Math.max(0,sp.min-sp.safety)-(offered.get(k)||0))
      if(free<=1e-9)continue
      const qty=q3(Math.min(free,need))
      offered.set(k,q3((offered.get(k)||0)+qty));need=q3(need-qty)
      transfers.push({key:`transfer:${sug.itemId}:${sug.needDate}@${site}>${sug.branchId}`,itemId:sug.itemId,fromBranchId:site,toBranchId:sug.branchId,qty,needDate:sug.needDate,forSuggestion:sug.key,refs:sug.origins.length?sug.origins:sug.refs})
    }
  }
  return {today,bucket:daily?'day' as const:'week' as const,periods,rows,suggestions,transfers,issues,sites}
}
export type MrpResult=ReturnType<typeof runMrp>

/* ---------------------------------------------------- Finite schedule -- */

const PRIORITY_RANK:Record<ProductionOrder['priority'],number>={Past:0,Normal:1,Yuqori:2,Kritik:3}
const RUNNING:ProductionOrder['status'][]=['Jarayonda','Pauzada','Sifat nazoratida']

export type ScheduledOperation={orderId:string;orderCode:string;workOrderId:string;name:string;workCenterId:string;start:string;end:string;
  /** Remaining routing minutes and the clock minutes they take at the work center's efficiency. */
  workMinutes:number;clockMinutes:number;late:boolean;
  /**
   * Planned machine (Phase 5): the registered machine of the work center this operation is booked on. A plan, not a
   * record — absent for an operation already started (which machine runs it is not recorded) and for work centers without machines.
   */
  machineId?:string}
export type OrderSchedule={orderId:string;code:string;start?:string;end?:string;due:string;late:boolean;unscheduled?:string}

const MS=60000
const toStamp=(ms:number)=>stamp(new Date(ms))

/**
 * Finite forward schedule of every open work order on sub-day work-center intervals (audit #23): orders in progress
 * first, then by due date and priority. Each operation starts after all its predecessors end, after the order's start
 * day and after now; it runs only inside its work center's productive windows (shifts minus breaks, minus planned
 * maintenance, logged downtime and machines stopped now — workCenterWindows), at the share of machines available
 * there, and at most `parallel` operations of one work center run at the same time. An operation may pause across a
 * break or shift end and continue in the next window. Completed work is never moved; work that does not fit the
 * horizon is reported, not invented.
 * Work centers with registered machines are scheduled per machine (Phase 5): every machine is its own lane with its own
 * stops and services, runs one operation at a time and an operation stays on the machine that starts it; at most
 * `parallel` (default: number of machines) run at once. The earliest-finishing machine is chosen.
 */
export function scheduleOperations(s:S,{now=new Date(),horizonDays=60,orders:only}:{now?:Date;horizonDays?:number;orders?:ProductionOrder[]}={}){
  const today=isoDate(now),horizonEnd=addDays(today,horizonDays-1),nowMs=now.getTime()
  // Busy intervals per work center (ms) and booked clock minutes per work center and day.
  const booked=new Map<string,Array<[number,number]>>()
  const laneBooked=new Map<string,Array<[number,number]>>()
  const used=new Map<string,number>()
  const windowCache=new Map<string,ReturnType<typeof workCenterWindows>>()
  const windowsOf=(wc:S['workCenters'][number],date:string)=>{
    const k=`${wc.id}|${date}`
    let v=windowCache.get(k)
    if(!v){v=workCenterWindows(s,wc,date,now);windowCache.set(k,v)}
    return v
  }
  const list=(only||s.productionOrders).filter(o=>isOpenOrder(o)&&o.workOrders.some(isOpenWorkOrder))
    .sort((a,b)=>Number(RUNNING.includes(b.status))-Number(RUNNING.includes(a.status))||a.due.localeCompare(b.due)||PRIORITY_RANK[b.priority]-PRIORITY_RANK[a.priority]||a.createdAt.localeCompare(b.createdAt)||a.code.localeCompare(b.code))
  const operations:ScheduledOperation[]=[],orders=new Map<string,OrderSchedule>()
  for(const order of list){
    // Finished operations end "now" for their successors; null = a predecessor could not be scheduled.
    const ends=new Map<string,number|null>()
    for(const w of order.workOrders.filter(x=>!isOpenWorkOrder(x)))ends.set(w.operationId,nowMs)
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
      // Earliest: now, the order's start day, the end of its latest predecessor.
      const ready=Math.max(nowMs,order.start>today?parseDate(order.start).getTime():nowMs,...(preds as number[]))
      const busy=booked.get(wc.id)||[]
      let start:number|undefined,end:number|undefined,machineId:string|undefined
      if(need<=1e-9)start=end=ready
      const lanes=need>1e-9?windowsOf(wc,isoDate(new Date(ready))).machines?.map(m=>m.id):undefined
      if(lanes?.length){
        // Each machine is tried as it stands; the one that finishes first takes the whole operation.
        let best:{id:string;start:number;end:number;pieces:Array<[number,number,string,number]>}|undefined
        for(const id of [...lanes].sort()){
          const own=laneBooked.get(id)||[]
          let left=need,first:number|undefined,last:number|undefined
          const pieces:Array<[number,number,string,number]>=[]
          for(let day=isoDate(new Date(ready));left>1e-9&&day<=horizonEnd;day=addDays(day,1)){
            const cal=windowsOf(wc,day)
            for(const [wf,wt] of cal.machines?.find(m=>m.id===id)?.free||[]){
              if(wt<=ready||left<=1e-9)continue
              const from=Math.max(wf,ready)
              const cuts=new Set([from,wt])
              for(const [a,b] of [...own,...busy]){if(a>from&&a<wt)cuts.add(a);if(b>from&&b<wt)cuts.add(b)}
              const points=[...cuts].sort((a,b)=>a-b)
              for(let i=0;i<points.length-1&&left>1e-9;i++){
                const a=points[i],b=points[i+1],mid=(a+b)/2
                if(own.some(([p,q])=>p<=mid&&mid<q))continue
                if(busy.filter(([p,q])=>p<=mid&&mid<q).length>=cal.parallel)continue
                const take=Math.min(left,(b-a)/MS)
                const stop=left-take<=1e-9?a+Math.ceil(take*MS/1000)*1000:b
                pieces.push([a,Math.min(b,stop),day,take]);left-=take
                first??=a;last=Math.min(b,stop)
              }
            }
          }
          if(left>1e-9||first===undefined||last===undefined)continue
          if(!best||last<best.end||(last===best.end&&first<best.start))best={id,start:first,end:last,pieces}
        }
        if(best){
          const own=laneBooked.get(best.id)||[]
          for(const [a,b,day,take] of best.pieces){own.push([a,b]);busy.push([a,b]);used.set(`${wc.id}|${day}`,(used.get(`${wc.id}|${day}`)??0)+take)}
          laneBooked.set(best.id,own)
          need=0;start=best.start;end=best.end
          if(!wo.startedAt)machineId=best.id
        }
      }
      for(let day=isoDate(new Date(ready));!lanes?.length&&need>1e-9&&day<=horizonEnd;day=addDays(day,1)){
        const cal=windowsOf(wc,day)
        for(const w of cal.windows){
          if(w.to<=ready||need<=1e-9)continue
          const from=Math.max(w.from,ready)
          // Split the window where other operations start or end; a piece is free while fewer than `parallel` run.
          const cuts=new Set([from,w.to])
          for(const [a,b] of busy){if(a>from&&a<w.to)cuts.add(a);if(b>from&&b<w.to)cuts.add(b)}
          const points=[...cuts].sort((a,b)=>a-b)
          for(let i=0;i<points.length-1&&need>1e-9;i++){
            const a=points[i],b=points[i+1],mid=(a+b)/2
            if(busy.filter(([p,q])=>p<=mid&&mid<q).length>=cal.parallel)continue
            const take=Math.min(need,(b-a)/MS*w.rate)
            const stop=need-take<=1e-9?a+Math.ceil(take/w.rate*MS/1000)*1000:b
            busy.push([a,Math.min(b,stop)])
            used.set(`${wc.id}|${day}`,(used.get(`${wc.id}|${day}`)??0)+take)
            need-=take
            start??=a;end=Math.min(b,stop)
          }
        }
      }
      booked.set(wc.id,busy)
      if(need>1e-9||start===undefined||end===undefined){ends.set(wo.operationId,null);row.unscheduled=`${wo.name}: ${horizonDays} kunlik oraliqqa sig‘madi`;continue}
      ends.set(wo.operationId,end)
      const startStamp=toStamp(start),endStamp=toStamp(end)
      const late=endStamp.slice(0,10)>order.due
      operations.push({orderId:order.id,orderCode:order.code,workOrderId:wo.id,name:wo.name,workCenterId:wc.id,start:startStamp,end:endStamp,workMinutes:Math.round(work),clockMinutes,late,...(machineId?{machineId}:{})})
      row.start=!row.start||startStamp<row.start?startStamp:row.start
      row.end=!row.end||endStamp>row.end?endStamp:row.end
    }
    row.late=Boolean(row.end&&row.end.slice(0,10)>order.due)||Boolean(row.unscheduled)
    orders.set(order.id,row)
  }
  return {from:today,horizonDays,operations,orders,usage:used}
}

/**
 * Why an order cannot start on `date` as planned: work centers of its first open operations that do not work that
 * day (calendar), have no productive interval left (maintenance, a stop, breaks), or a date in the past. Empty = no conflict.
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
