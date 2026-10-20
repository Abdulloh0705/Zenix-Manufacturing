// Supplier ↔ material sourcing: which supplier can deliver which material, on what terms, and how the
// options for one material compare when a shortage has to be bought. Pure functions over state.
import type {CurrencyCode,ManufacturingState,PurchaseOrder,SupplierMaterial} from '../types'
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
      expectedDate,onTime:needBy?expectedDate<=needBy:null,preferred:link.supplierId===preferred,cheapest:false,fastest:false,recommended:false,reason:undefined as string|undefined,onTimePct:supplierPerformance(s,link.supplierId).onTimePct}
  })
  const eligible=rows.filter(r=>!r.blocked)
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
    pick.reason=eligible.length===1?'Yagona faol supplier':inTime.length?(needBy?`Muddatga ulguradi · ${cheapestText}`:cheapestText[0].toUpperCase()+cheapestText.slice(1)):'Hech biri muddatga ulgurmaydi — eng tez yetkazadi'
  }
  return rows.sort((a,b)=>Number(Boolean(a.blocked))-Number(Boolean(b.blocked))||Number(b.recommended)-Number(a.recommended)||a.expectedDate.localeCompare(b.expectedDate)||a.total-b.total)
}

/** Delivery and incoming-quality track record of a supplier, from its POs and receipts. */
export function supplierPerformance(s:S,supplierId:string){
  const pos=s.purchaseOrders.filter(p=>p.supplierId===supplierId&&p.status!=='Bekor')
  const receipts=pos.flatMap(p=>p.receipts.map(r=>({...r,po:p})))
  const onTime=receipts.filter(r=>r.date.slice(0,10)<=r.po.expectedDate).length
  const checks=s.qualityChecks.filter(q=>q.sourceType==='purchase'&&pos.some(p=>p.id===q.sourceId)&&q.status!=='Pending')
  const passed=checks.filter(q=>q.status==='Passed').length
  const leads=pos.filter(p=>p.receipts.length).map(p=>Math.max(0,daysBetween(p.createdAt,p.receipts[0].date)))
  return {orders:pos.length,spend:pos.reduce((a,p)=>a+p.total,0),openValue:pos.filter(p=>OPEN_PO.includes(p.status)).reduce((a,p)=>a+p.items.reduce((x,i)=>x+(i.qty-i.received)*i.price,0),0),onTimePct:receipts.length?Math.round(onTime/receipts.length*100):null,qualityPct:checks.length?Math.round(passed/checks.length*100):null,avgLead:leads.length?Math.round(leads.reduce((a,b)=>a+b,0)/leads.length*10)/10:null,receipts:receipts.length}
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
