// Supplier ↔ material sourcing: which supplier can deliver which material, on what terms, and how the
// options for one material compare when a shortage has to be bought. Pure functions over state.
import type {CurrencyCode,ManufacturingState,PurchaseOrder,PurchaseReceipt,QualityCheck,SupplierMaterial} from '../types'
import {CURRENCIES} from '../utils/format'
import {addDays,daysBetween,todayISO} from '../utils/dates'

type S=ManufacturingState

export const SUPPLY_CURRENCIES:CurrencyCode[]=['UZS','USD','RUB']
/** POs whose open quantity is real supply on the way (drafts are only RFQs). */
export const SUPPLYING_PO:PurchaseOrder['status'][]=['Tasdiqlangan','Yo‘lda','Qisman qabul']
const OPEN_PO:PurchaseOrder['status'][]=['Qoralama',...SUPPLYING_PO]

export const linksOfMaterial=(s:S,materialId:string)=>(s.supplierMaterials||[]).filter(l=>l.materialId===materialId)
export const linksOfSupplier=(s:S,supplierId:string)=>(s.supplierMaterials||[]).filter(l=>l.supplierId===supplierId)
export const findLink=(s:S,supplierId:string,materialId:string)=>(s.supplierMaterials||[]).find(l=>l.supplierId===supplierId&&l.materialId===materialId)

/** Price of one material stock unit in the base currency (UZS). */
export function linkUnitCost(link:Pick<SupplierMaterial,'price'|'currency'|'unitFactor'>){
  return link.price*(CURRENCIES[link.currency]?.rate??1)/Math.max(1e-9,link.unitFactor||1)
}

/** Why this link cannot be ordered from right now (undefined = it can). */
export function linkBlock(s:S,link:SupplierMaterial):string|undefined{
  const supplier=s.suppliers.find(x=>x.id===link.supplierId)
  if(!supplier)return 'Supplier topilmadi'
  if(supplier.status!=='Faol')return 'Supplier nofaol'
  if(!link.active)return 'Aloqa nofaol'
  const material=s.rawMaterials.find(m=>m.id===link.materialId)
  if(!material)return 'Material topilmadi'
  if(material.status==='Arxiv')return 'Material arxivda'
  return undefined
}

export const orderableLinks=(s:S,materialId:string)=>linksOfMaterial(s,materialId).filter(l=>!linkBlock(s,l))

/**
 * Supplier MRP proposes for a material: the person's preferred ("Asosiy") supplier when its link can be
 * ordered, otherwise the only orderable one. With several and no preference the choice is left to people.
 */
export function preferredSupplierId(s:S,materialId:string){
  const eligible=orderableLinks(s,materialId)
  const preferred=s.rawMaterials.find(m=>m.id===materialId)?.supplierId
  if(preferred&&eligible.some(l=>l.supplierId===preferred))return preferred
  return eligible.length===1?eligible[0].supplierId:undefined
}

/** Whole purchase units covering `need` stock units, raised to the MOQ; the excess stays visible. */
export function orderProposal(link:Pick<SupplierMaterial,'unitFactor'|'moq'>,need:number){
  const factor=link.unitFactor>0?link.unitFactor:1
  const units=need>0?Math.ceil(need/factor-1e-9):0
  const moq=Math.max(0,link.moq||0)
  const purchaseQty=units>0?Math.max(units,moq):0
  const stockQty=Math.round(purchaseQty*factor*1000)/1000
  return {purchaseQty,stockQty,excess:Math.max(0,Math.round((stockQty-Math.max(0,need))*1000)/1000),moqRaised:units>0&&moq>units}
}

export type SupplierOption={
  link:SupplierMaterial;supplierName:string;blocked?:string;unitCost:number;proposal:ReturnType<typeof orderProposal>;total:number;
  expectedDate:string;onTime:boolean|null;preferred:boolean;cheapest:boolean;fastest:boolean;recommended:boolean;reason?:string;onTimePct:number|null;
  /** Terms the comparison could not use (e.g. no quoted price) — shown, never guessed. */
  missing?:string;
}

/**
 * Every supplier linked to a material, compared for buying `need` stock units by `needBy`.
 * The recommendation is not "cheapest": among orderable links it keeps those that arrive in time
 * (lead time vs need date) and then takes the lowest total for the quantity that must really be
 * ordered (whole purchase units and MOQ included). If none arrives in time, the fastest one.
 */
export function supplierOptions(s:S,materialId:string,need:number,needBy?:string,today=todayISO()):SupplierOption[]{
  const preferred=s.rawMaterials.find(m=>m.id===materialId)?.supplierId
  const rows=linksOfMaterial(s,materialId).map(link=>{
    const blocked=linkBlock(s,link)
    const unitCost=linkUnitCost(link)
    const proposal=orderProposal(link,need)
    const expectedDate=addDays(today,Math.max(0,link.leadTime))
    return {link,supplierName:s.suppliers.find(x=>x.id===link.supplierId)?.name||link.supplierId,blocked,unitCost,proposal,total:proposal.stockQty*unitCost,
      expectedDate,onTime:needBy?expectedDate<=needBy:null,preferred:link.supplierId===preferred,cheapest:false,fastest:false,recommended:false,reason:undefined as string|undefined,onTimePct:supplierPerformance(s,link.supplierId,today).onTimePct,
      missing:link.price>0?undefined:'Narx kiritilmagan'}
  })
  // A link without a quoted price is not "cheapest": it is compared only when no supplier has a price.
  const orderable=rows.filter(r=>!r.blocked),priced=orderable.filter(r=>!r.missing)
  const eligible=priced.length?priced:orderable
  if(eligible.length>1){
    const minCost=Math.min(...eligible.map(r=>r.unitCost)),minLead=Math.min(...eligible.map(r=>r.link.leadTime))
    for(const r of eligible){r.cheapest=r.unitCost===minCost;r.fastest=r.link.leadTime===minLead}
  }
  if(eligible.length){
    const inTime=eligible.filter(r=>r.onTime!==false)
    // With no quantity to buy yet there is no order total to compare, so the unit price decides.
    const cost=(r:typeof rows[number])=>need>0?r.total:r.unitCost
    const pick=inTime.length
      ?[...inTime].sort((a,b)=>cost(a)-cost(b)||a.link.leadTime-b.link.leadTime)[0]
      :[...eligible].sort((a,b)=>a.link.leadTime-b.link.leadTime||cost(a)-cost(b))[0]
    pick.recommended=true
    const cheapestText=need>0?'jami summa eng past (MOQ bilan)':'birlik narxi eng past'
    pick.reason=!priced.length?'Narx kiritilmagan — muddat bo‘yicha tanlandi':eligible.length===1?(orderable.length>1?'Yagona narxi kiritilgan supplier':'Yagona faol supplier'):inTime.length?(needBy?`Muddatga ulguradi · ${cheapestText}`:cheapestText[0].toUpperCase()+cheapestText.slice(1)):'Hech biri muddatga ulgurmaydi — eng tez yetkazadi'
  }
  return rows.sort((a,b)=>Number(Boolean(a.blocked))-Number(Boolean(b.blocked))||Number(b.recommended)-Number(a.recommended)||a.expectedDate.localeCompare(b.expectedDate)||a.total-b.total)
}

const q3=(n:number)=>Math.round(n*1000)/1000

/**
 * Inspection split of a receipt. Receipts saved before the split existed are read from their incoming check:
 * none → released on receipt, Pending → waiting, Passed → all accepted, any rejecting result → all rejected.
 */
export function receiptQuantities(s:S,po:Pick<PurchaseOrder,'id'>,r:PurchaseReceipt){
  const check:QualityCheck|undefined=s.qualityChecks.find(q=>q.sourceType==='purchase'&&q.sourceId===po.id&&(q.id===r.qualityCheckId||q.receiptId===r.id))
  if(r.inspection){
    const accepted=r.accepted??0,rejected=r.rejected??0
    return {inspection:r.inspection,accepted,rejected,returned:r.returned??0,scrapped:r.scrapped??0,pending:q3(Math.max(0,r.qty-accepted-rejected)),check}
  }
  if(!check)return {inspection:'none' as const,accepted:r.qty,rejected:0,returned:0,scrapped:0,pending:0,check}
  if(check.status==='Pending')return {inspection:'pending' as const,accepted:0,rejected:0,returned:0,scrapped:0,pending:r.qty,check}
  if(check.status==='Passed')return {inspection:'accepted' as const,accepted:r.qty,rejected:0,returned:0,scrapped:0,pending:0,check}
  const returned=check.returnedQty??(check.reason?.includes('Supplierga qaytarildi')?r.qty:0)
  return {inspection:'rejected' as const,accepted:0,rejected:r.qty,returned,scrapped:check.status==='Scrap'?r.qty:0,pending:0,check}
}

/** Rejected units of a receipt still waiting for a return or scrap decision. */
export function rejectedOpen(s:S,po:Pick<PurchaseOrder,'id'>,r:PurchaseReceipt){
  const q=receiptQuantities(s,po,r)
  return q3(Math.max(0,q.rejected-q.returned-q.scrapped))
}

/** Every PO line placed with a supplier (drafts and cancelled ones included, marked by status), newest first. */
export function supplierPurchaseHistory(s:S,supplierId:string){
  return s.purchaseOrders.filter(p=>p.supplierId===supplierId).flatMap(p=>p.items.map(i=>{
    const receipts=p.receipts.filter(r=>r.materialId===i.materialId)
    const split=receipts.map(r=>receiptQuantities(s,p,r))
    return {po:p,line:i,date:p.createdAt.slice(0,10),lastReceipt:receipts.map(r=>r.date).sort().at(-1),
      accepted:q3(split.reduce((a,x)=>a+x.accepted,0)),rejected:q3(split.reduce((a,x)=>a+x.rejected,0)),returned:q3(split.reduce((a,x)=>a+x.returned,0))}
  })).sort((a,b)=>b.date.localeCompare(a.date)||b.po.code.localeCompare(a.po.code))
}

/**
 * Supplier KPIs from recorded POs, receipts and inspections only (the stored rating is not used):
 * - on time: PO lines that are due (expected date passed, closed short) or complete, fully received by the expected date;
 * - lead time: days from the PO to the receipt that completed a line;
 * - rejection: rejected / inspected quantity of decided incoming inspections;
 * - price variance: ordered value at PO prices against the materials' standard cost;
 * - fulfilment: received minus returned against ordered quantity on closed POs.
 * A KPI without data is null and "missing" says what is lacking.
 */
export function supplierPerformance(s:S,supplierId:string,today=todayISO()){
  const pos=s.purchaseOrders.filter(p=>p.supplierId===supplierId&&p.status!=='Bekor')
  const placed=pos.filter(p=>p.status!=='Qoralama')
  const receipts=placed.flatMap(p=>p.receipts.map(r=>({...r,po:p})))
  const lines=placed.flatMap(p=>p.items.map(i=>{
    const own=p.receipts.filter(r=>r.materialId===i.materialId).sort((a,b)=>a.date.localeCompare(b.date))
    let sum=0,completedAt:string|undefined
    for(const r of own){sum+=r.qty;if(!completedAt&&sum>=i.qty-1e-9)completedAt=r.date.slice(0,10)}
    return {po:p,line:i,completedAt}
  }))
  const due=lines.filter(l=>l.completedAt||l.po.expectedDate<today||l.po.closedShort)
  const onTime=due.filter(l=>l.completedAt&&l.completedAt<=l.po.expectedDate).length
  const leads=lines.filter(l=>l.completedAt).map(l=>Math.max(0,daysBetween(l.po.createdAt,l.completedAt!)))
  let inspected=0,rejected=0
  for(const r of receipts){const q=receiptQuantities(s,r.po,r);if(q.inspection==='none'||q.inspection==='pending')continue;inspected+=q.accepted+q.rejected;rejected+=q.rejected}
  const checks=s.qualityChecks.filter(q=>q.sourceType==='purchase'&&pos.some(p=>p.id===q.sourceId)&&q.status!=='Pending')
  const passed=checks.filter(q=>q.status==='Passed').length
  let stdValue=0,priceValue=0
  for(const l of lines){const std=s.rawMaterials.find(m=>m.id===l.line.materialId)?.standardCost||0;if(std<=0)continue;stdValue+=l.line.qty*std;priceValue+=l.line.qty*l.line.price}
  const closed=placed.filter(p=>p.status==='Qabul qilindi')
  let ordered=0,delivered=0
  for(const p of closed)for(const i of p.items){
    ordered+=i.qty
    const returned=p.receipts.filter(r=>r.materialId===i.materialId).reduce((a,r)=>a+receiptQuantities(s,p,r).returned,0)
    delivered+=Math.max(0,i.received-returned)
  }
  const pct=(a:number,b:number)=>b>0?Math.round(a/b*1000)/10:null
  const missing:string[]=[]
  if(!due.length)missing.push('Muddati kelgan PO qatori yo‘q — vaqtida yetkazish hisoblanmaydi')
  if(!leads.length)missing.push('To‘liq qabul qilingan qator yo‘q — lead time hisoblanmaydi')
  if(inspected<=0)missing.push('Kirish tekshiruvi qarori yo‘q — rad etish ulushi hisoblanmaydi')
  if(stdValue<=0)missing.push('Materiallarning standart narxi yo‘q — narx farqi hisoblanmaydi')
  if(ordered<=0)missing.push('Yopilgan PO yo‘q — bajarilish darajasi hisoblanmaydi')
  return {orders:pos.length,spend:pos.reduce((a,p)=>a+p.total,0),openValue:pos.filter(p=>OPEN_PO.includes(p.status)).reduce((a,p)=>a+p.items.reduce((x,i)=>x+(i.qty-i.received)*i.price,0),0),
    onTimePct:due.length?Math.round(onTime/due.length*100):null,dueLines:due.length,
    qualityPct:checks.length?Math.round(passed/checks.length*100):null,
    avgLead:leads.length?Math.round(leads.reduce((a,b)=>a+b,0)/leads.length*10)/10:null,
    rejectionPct:pct(rejected,inspected),inspectedQty:q3(inspected),rejectedQty:q3(rejected),
    priceVariancePct:stdValue>0?Math.round((priceValue-stdValue)/stdValue*1000)/10:null,
    fulfillmentPct:pct(delivered,ordered),
    receipts:receipts.length,missing}
}

/**
 * The supplier MRP buys a material from for `need` stock units by `needBy`: the preferred ("Asosiy") supplier when it
 * can be ordered, otherwise the comparison's recommendation (in time first, then lowest total with MOQ; unpriced
 * links only when nobody has a price). Undefined when no supplier can be ordered from.
 */
export function chooseSupplier(s:S,materialId:string,need:number,needBy?:string,today=todayISO()){
  const fixed=preferredSupplierId(s,materialId)
  const options=supplierOptions(s,materialId,need,needBy,today)
  if(fixed){
    const o=options.find(x=>x.link.supplierId===fixed)
    return o?{...o,reason:s.rawMaterials.find(m=>m.id===materialId)?.supplierId===fixed?'Asosiy supplier':'Yagona faol supplier'}:undefined
  }
  return options.find(o=>o.recommended)
}

export type LinkInput=Omit<SupplierMaterial,'id'|'createdAt'|'lastPrice'|'lastPurchaseDate'|'lastPurchaseOrderId'>

/** Field and uniqueness rules for one link; `ignoreId` is the link being edited. */
export function validateLink(s:S,link:LinkInput,ignoreId?:string):string|undefined{
  if(!s.suppliers.some(x=>x.id===link.supplierId))return 'Supplier tanlanmagan'
  const material=s.rawMaterials.find(m=>m.id===link.materialId)
  if(!material)return 'Material tanlanmagan'
  if((s.supplierMaterials||[]).some(l=>l.id!==ignoreId&&l.supplierId===link.supplierId&&l.materialId===link.materialId))return `${material.name} bu supplierga allaqachon biriktirilgan`
  if(!(Number(link.price)>=0))return 'Narx manfiy bo‘lmasin'
  if(!SUPPLY_CURRENCIES.includes(link.currency))return 'Valyuta noto‘g‘ri'
  if(!link.purchaseUnit?.trim())return 'Xarid birligini kiriting'
  if(!(Number(link.unitFactor)>0))return 'Birlik konversiyasi 0 dan katta bo‘lsin'
  if(link.purchaseUnit.trim()===material.unit&&Number(link.unitFactor)!==1)return `Xarid birligi ${material.unit} bo‘lsa konversiya 1 bo‘ladi`
  if(!(Number(link.moq)>=0))return 'MOQ manfiy bo‘lmasin'
  if(!(Number(link.leadTime)>=0))return 'Lead time manfiy bo‘lmasin'
  return undefined
}

export function cleanLink(link:LinkInput):LinkInput{
  return {supplierId:link.supplierId,materialId:link.materialId,supplierSku:(link.supplierSku||'').trim(),price:Math.max(0,Number(link.price)||0),currency:link.currency,purchaseUnit:link.purchaseUnit.trim(),unitFactor:Number(link.unitFactor)||1,moq:Math.max(0,Number(link.moq)||0),leadTime:Math.max(0,Math.round(Number(link.leadTime)||0)),active:link.active!==false}
}

/** Open (not received, not cancelled) PO lines of this supplier for this material. */
export const openPurchasesFor=(s:S,supplierId:string,materialId:string)=>s.purchaseOrders.filter(p=>p.supplierId===supplierId&&OPEN_PO.includes(p.status)&&p.items.some(i=>i.materialId===materialId&&i.received<i.qty))

type LegacySupplier={id:string;leadTime?:number;materials?:string[]}
/**
 * Builds links for data saved before links existed, from relationships the data itself confirms:
 * the supplier's old material list and each material's default supplier. Terms come from the latest
 * PO of that pair when there is one; otherwise the price stays 0 (not quoted) — nothing is invented.
 */
export function migrateSupplierLinks(s:S,now=todayISO()):SupplierMaterial[]{
  const pairs=new Set<string>()
  for(const sup of s.suppliers as unknown as LegacySupplier[])for(const m of sup.materials||[])pairs.add(`${sup.id}|${m}`)
  for(const m of s.rawMaterials)if(m.supplierId)pairs.add(`${m.supplierId}|${m.id}`)
  const rows:SupplierMaterial[]=[]
  for(const pair of pairs){
    const [supplierId,materialId]=pair.split('|')
    const supplier=s.suppliers.find(x=>x.id===supplierId),material=s.rawMaterials.find(x=>x.id===materialId)
    if(!supplier||!material)continue
    const last=s.purchaseOrders.filter(p=>p.supplierId===supplierId&&p.status!=='Bekor'&&p.status!=='Qoralama'&&p.items.some(i=>i.materialId===materialId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
    const price=last?.items.find(i=>i.materialId===materialId)?.price??0
    rows.push({id:`sm-${supplierId}-${materialId}`,supplierId,materialId,supplierSku:'',price,currency:'UZS',purchaseUnit:material.unit,unitFactor:1,moq:0,leadTime:supplier.leadTime??material.leadTime??0,active:true,lastPrice:last?price:undefined,lastPurchaseDate:last?.createdAt.slice(0,10),lastPurchaseOrderId:last?.id,createdAt:now})
  }
  return rows
}
