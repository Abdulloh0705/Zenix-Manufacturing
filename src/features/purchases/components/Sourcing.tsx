// Supplier ↔ material sourcing UI: link terms, supplier comparison for a need, the PO draft it opens,
// a multi-material purchase plan, and the production-order material panel that starts all of it.
import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Checkbox,Empty,Field,Icon,InfoGrid,Input,Modal,Select,StatusBadge,nonNegative,positive,required,useForm} from '../../../shared/ui'
import type {CurrencyCode,ProductionOrder,SupplierMaterial} from '../../../types'
import {orderMaterialPlan,rawWarehouseFor} from '../../../domain/manufacturingEngine'
import {needsSecondApprover} from '../../../domain/actions'
import type {MaterialPlanLine} from '../../../domain/manufacturingEngine'
import {SUPPLY_CURRENCIES,findLink,linkBlock,linkUnitCost,linksOfMaterial,orderProposal,orderableLinks,preferredSupplierId,supplierOptions} from '../../../domain/supplierMaterials'
import {addDays,todayISO} from '../../../utils/dates'
import {CURRENCIES,money,num,qty,quoteMoney} from '../../../utils/format'
import {materialName,supplierName,warehouseName} from '../../common/lookups'

const PURCHASE_UNITS=['kg','t','dona','list','m','l','m²','quti','paket','rulon']
const q3=(n:number)=>Math.round(n*1000)/1000

/** "14 200 so‘m/kg" — the supplier's own quote. */
export const quoteText=(l:Pick<SupplierMaterial,'price'|'currency'|'purchaseUnit'>)=>`${quoteMoney(l.price,l.currency)}/${l.purchaseUnit}`
/** "1 list = 25 kg" when the supplier sells in another unit. */
export const conversionText=(l:Pick<SupplierMaterial,'purchaseUnit'|'unitFactor'>,stockUnit:string)=>l.purchaseUnit===stockUnit&&l.unitFactor===1?'':`1 ${l.purchaseUnit} = ${num(l.unitFactor,3)} ${stockUnit}`

/* ----------------------------------------------------------- link editor -- */

/** Create or edit one supplier ↔ material link. Fixed ends (from a supplier or a material page) are locked. */
export function SupplierMaterialModal({link,supplierId,materialId,onClose}:{link?:SupplierMaterial;supplierId?:string;materialId?:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const fixedSupplier=link?.supplierId||supplierId,fixedMaterial=link?.materialId||materialId
  const taken=(sid:string,mid:string)=>s.supplierMaterials.some(l=>l.id!==link?.id&&l.supplierId===sid&&l.materialId===mid)
  const suppliers=s.suppliers.filter(x=>x.status!=='Arxiv'||x.id===fixedSupplier)
  const materials=s.rawMaterials.filter(m=>m.status!=='Arxiv'||m.id===fixedMaterial)
  const unitOf=(mid:string)=>s.rawMaterials.find(m=>m.id===mid)?.unit||''
  const form=useForm(()=>{
    const mid=fixedMaterial||materials.find(m=>!fixedSupplier||!taken(fixedSupplier,m.id))?.id||''
    const sid=fixedSupplier||suppliers.find(x=>!taken(x.id,mid))?.id||''
    return {supplierId:sid,materialId:mid,supplierSku:link?.supplierSku||'',price:link?String(link.price):'',currency:(link?.currency||'UZS') as CurrencyCode,purchaseUnit:link?.purchaseUnit||unitOf(mid),unitFactor:String(link?.unitFactor??1),moq:String(link?.moq??0),leadTime:String(link?.leadTime??s.suppliers.find(x=>x.id===sid)?.leadTime??3),active:link?.active??true}
  },v=>({
    supplierId:v.supplierId?undefined:'Supplier tanlang',
    materialId:!v.materialId?'Material tanlang':taken(v.supplierId,v.materialId)?'Bu juftlik allaqachon biriktirilgan':undefined,
    price:nonNegative(v.price,'Narx'),purchaseUnit:required(v.purchaseUnit,'Xarid birligi'),
    unitFactor:positive(v.unitFactor,'Konversiya')||(v.purchaseUnit.trim()===unitOf(v.materialId)&&Number(v.unitFactor)!==1?`Birlik ${unitOf(v.materialId)} bo‘lsa 1 bo‘ladi`:undefined),
    moq:nonNegative(v.moq,'MOQ'),leadTime:nonNegative(v.leadTime,'Lead time'),
  }))
  const v=form.values,stockUnit=unitOf(v.materialId)
  const perStock=linkUnitCost({price:Number(v.price)||0,currency:v.currency,unitFactor:Number(v.unitFactor)||1})
  const submit=()=>form.submit(x=>{
    const payload={supplierId:x.supplierId,materialId:x.materialId,supplierSku:x.supplierSku,price:Number(x.price),currency:x.currency,purchaseUnit:x.purchaseUnit,unitFactor:Number(x.unitFactor),moq:Number(x.moq),leadTime:Number(x.leadTime),active:x.active}
    const r=link?app.updateSupplierMaterial(link.id,payload):app.linkSupplierMaterial(payload)
    if(r.ok)onClose()
    return r.ok
  })
  return <Modal open onClose={onClose} size="lg" eyebrow={link?'Shartlarni tahrirlash':'Material biriktirish'} title={link?`${supplierName(s,link.supplierId)} → ${materialName(s,link.materialId)}`:'Supplier ↔ material'} subtitle="Narx supplier valyutasida, xarid birligi uchun"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Saqlash</button></>}>
    <div className="form-grid">
      <Field label="Supplier" required error={form.error('supplierId')}><Select value={v.supplierId} disabled={Boolean(fixedSupplier)} onChange={x=>{form.set('supplierId',x);const sup=s.suppliers.find(y=>y.id===x);if(sup&&!link)form.set('leadTime',String(sup.leadTime))}}>{suppliers.map(x=><option key={x.id} value={x.id} disabled={taken(x.id,v.materialId)}>{x.name}{x.status!=='Faol'?` · ${x.status}`:''}</option>)}</Select></Field>
      <Field label="Material" required error={form.error('materialId')}><Select value={v.materialId} disabled={Boolean(fixedMaterial)} onChange={x=>{form.set('materialId',x);if(!link){form.set('purchaseUnit',unitOf(x));form.set('unitFactor','1')}}}>{materials.map(m=><option key={m.id} value={m.id} disabled={taken(v.supplierId,m.id)}>{m.name} · {m.sku}</option>)}</Select></Field>
      <Field label="Supplier SKU" hint="Supplier katalogidagi kod (ixtiyoriy)"><Input {...form.input('supplierSku')} placeholder="—"/></Field>
      <Field label="Lead time (kun)" required error={form.error('leadTime')}><Input type="number" min="0" step="1" {...form.input('leadTime')}/></Field>
      <div className="form-group-title">Narx va birlik</div>
      <Field label={`Narx (${CURRENCIES[v.currency].symbol} / ${v.purchaseUnit||'birlik'})`} required error={form.error('price')} hint={stockUnit&&Number(v.price)>0?`≈ ${money(perStock)} / ${stockUnit}`:undefined}><Input type="number" min="0" step="any" inputMode="decimal" {...form.input('price')}/></Field>
      <Field label="Valyuta"><Select value={v.currency} onChange={x=>form.set('currency',x as CurrencyCode)}>{SUPPLY_CURRENCIES.map(c=><option key={c} value={c}>{c} · {CURRENCIES[c].label}</option>)}</Select></Field>
      <Field label="Xarid birligi" required error={form.error('purchaseUnit')} hint={`Ombor birligi: ${stockUnit||'—'}`}><Input list="purchase-units" {...form.input('purchaseUnit')}/></Field>
      <Field label={`Konversiya: 1 ${v.purchaseUnit||'birlik'} = ? ${stockUnit}`} required error={form.error('unitFactor')}><Input type="number" min="0" step="any" inputMode="decimal" {...form.input('unitFactor')}/></Field>
      <Field label={`MOQ (${v.purchaseUnit||'birlik'})`} error={form.error('moq')} hint="0 — cheklov yo‘q"><Input type="number" min="0" step="any" {...form.input('moq')}/></Field>
      <div className="field"><label>Holat</label><Checkbox checked={v.active} onChange={x=>form.set('active',x)} label="Faol" description="Nofaol aloqa xarid tavsiyalarida qatnashmaydi"/></div>
    </div>
    {v.currency!=='UZS'&&<div className="inline-note"><Icon name="info"/>Narx {v.currency}da saqlanadi; PO summasi so‘mga demo kurs bo‘yicha o‘tkaziladi (1 {v.currency} = {num(CURRENCIES[v.currency].rate)} so‘m).</div>}
    <datalist id="purchase-units">{PURCHASE_UNITS.map(u=><option key={u} value={u}/>)}</datalist>
  </Modal>
}

/** Link terms as a table — from the material side (supplier column) or the supplier side (material column). */
export function LinkTermsTable({links,side,onEdit,onRemove,onPreferred,onBuy}:{links:SupplierMaterial[];side:'material'|'supplier';onEdit?:(l:SupplierMaterial)=>void;onRemove?:(l:SupplierMaterial)=>void;onPreferred?:(l:SupplierMaterial)=>void;onBuy?:(l:SupplierMaterial)=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  return <div className="table-scroll"><table className="fit link-table"><thead><tr><th>{side==='material'?'Supplier':'Material'}</th><th className="align-right">Narx</th><th className="align-right">MOQ</th><th className="align-right">Lead</th><th>Oxirgi xarid</th><th>Holat</th><th/></tr></thead><tbody>
    {links.map(l=>{
      const m=s.rawMaterials.find(x=>x.id===l.materialId),blocked=linkBlock(s,l),preferred=m?.supplierId===l.supplierId,conv=conversionText(l,m?.unit||'')
      return <tr key={l.id} className={blocked?'row-muted':undefined}>
        <td><div className="cell-main"><b>{side==='material'?supplierName(s,l.supplierId):m?.name}</b><small>{[side==='supplier'?m?.sku:'',l.supplierSku?`SKU ${l.supplierSku}`:'',conv].filter(Boolean).join(' · ')||' '}</small></div></td>
        <td className="align-right"><div className="cell-main"><b>{l.price>0?quoteText(l):<span className="negative">Narx yo‘q</span>}</b>{l.price>0&&(l.currency!=='UZS'||conv)?<small>≈ {money(linkUnitCost(l))}/{m?.unit}</small>:null}</div></td>
        <td className="align-right">{l.moq?`${num(l.moq,3)} ${l.purchaseUnit}`:<span className="muted">—</span>}</td>
        <td className="align-right">{l.leadTime} kun</td>
        <td>{l.lastPurchaseDate?<div className="cell-main"><b>{money(l.lastPrice||0)}/{m?.unit}</b><small>{l.lastPurchaseDate}{l.lastPurchaseOrderId&&<> · <button type="button" className="link-btn" onClick={()=>navigate(`/purchases?view=orders&id=${l.lastPurchaseOrderId}`)}>{s.purchaseOrders.find(p=>p.id===l.lastPurchaseOrderId)?.code||'PO'}</button></>}</small></div>:<span className="muted">Xarid yo‘q</span>}</td>
        <td><span className="badge-row">{blocked?<StatusBadge tone="neutral">{blocked}</StatusBadge>:<StatusBadge tone="success">Faol</StatusBadge>}{preferred&&<StatusBadge tone="info">Asosiy</StatusBadge>}</span></td>
        <td className="align-right"><div className="cell-actions">
          {onBuy&&!blocked&&<button type="button" className="soft-glass-btn compact" onClick={()=>onBuy(l)}><Icon name="cart" size={14}/>PO</button>}
          {onPreferred&&!blocked&&!preferred&&<button type="button" className="ghost-btn compact" onClick={()=>onPreferred(l)}>Asosiy qilish</button>}
          {onEdit&&<button type="button" className="icon-ghost" aria-label={`${side==='material'?supplierName(s,l.supplierId):m?.name} — shartlarni tahrirlash`} onClick={()=>onEdit(l)}><Icon name="edit" size={15}/></button>}
          {onRemove&&<button type="button" className="icon-ghost danger" aria-label={`${side==='material'?supplierName(s,l.supplierId):m?.name} — aloqani o‘chirish`} onClick={()=>onRemove(l)}><Icon name="trash" size={15}/></button>}
        </div></td>
      </tr>})}
  </tbody></table></div>
}

/* ------------------------------------------------ need → supplier → PO -- */

/** What has to be bought: stock units of one material, by when, for which production orders, into which store. */
export type SourcingNeed={materialId:string;need:number;needBy?:string;orderIds?:string[];warehouseId?:string;source?:string}

const deliveryBadge=(expected:string,needBy?:string)=>!needBy?null:expected<=needBy?<StatusBadge tone="success">Muddatga ulguradi</StatusBadge>:<StatusBadge tone="danger">Muddatdan kech</StatusBadge>

/**
 * Suppliers of one material compared for a need. Choosing one opens a pre-filled PO draft — or, with
 * `onPick`, hands the link back (used by the multi-material plan).
 */
export function SourcingModal({need,onClose,onPick}:{need:SourcingNeed;onClose:()=>void;onPick?:(link:SupplierMaterial)=>void}){
  const app=useApp(),s=app.state
  const [picked,setPicked]=useState<string|null>(null),[linking,setLinking]=useState(false)
  const m=s.rawMaterials.find(x=>x.id===need.materialId)
  const link=picked?s.supplierMaterials.find(l=>l.id===picked):undefined
  if(!m)return null
  if(link)return <PurchaseDraftModal link={link} need={need} onBack={()=>setPicked(null)} onClose={onClose}/>
  const options=supplierOptions(s,m.id,need.need,need.needBy)
  const canLink=app.can('purchases','edit')||app.can('materials','edit')
  const orders=(need.orderIds||[]).map(id=>s.productionOrders.find(o=>o.id===id)?.code).filter(Boolean)
  return <Modal open onClose={onClose} size="xl" eyebrow="Supplierlar" title={m.name} subtitle={`${m.sku} · ombor birligi ${m.unit}`}
    footer={<>{canLink&&<button type="button" className="secondary-glass-btn" onClick={()=>setLinking(true)}><Icon name="plus" size={15}/>Supplier biriktirish</button>}<span className="spacer"/><button type="button" className="secondary-glass-btn" onClick={onClose}>Yopish</button></>}>
    <InfoGrid columns={4} items={[{label:'Kerak',value:need.need>0?qty(need.need,m.unit):'—',tone:need.need>0?'danger':undefined},{label:'Kerak sana',value:need.needBy||'—'},{label:'Ombor',value:need.warehouseId?warehouseName(s,need.warehouseId):'—'},{label:'Manba',value:orders.join(', ')||need.source||'—'}]}/>
    {options.length?<div className="table-scroll"><table className="sourcing-table"><thead><tr><th>Supplier</th><th className="align-right">Narx</th><th className="align-right">Lead time</th><th className="align-right">MOQ</th><th className="align-right">Buyurtma</th><th className="align-right">Jami</th><th className="align-right">Vaqtida</th><th>Holat</th><th/></tr></thead><tbody>
      {options.map(o=>{const conv=conversionText(o.link,m.unit);return <tr key={o.link.id} className={o.blocked?'row-muted':o.recommended?'row-picked':undefined}>
        <td><div className="cell-main"><b>{o.supplierName}</b><small>{o.recommended?o.reason:o.link.supplierSku?`SKU ${o.link.supplierSku}`:conv||' '}</small></div>
          <span className="badge-row">{o.recommended&&<StatusBadge tone="success">Tavsiya</StatusBadge>}{o.preferred&&<StatusBadge tone="info">Asosiy</StatusBadge>}{o.cheapest&&<StatusBadge tone="neutral">Eng arzon</StatusBadge>}{o.fastest&&<StatusBadge tone="neutral">Eng tez</StatusBadge>}</span></td>
        <td className="align-right"><div className="cell-main"><b>{o.link.price>0?quoteText(o.link):<span className="negative">Narx yo‘q</span>}</b>{(o.link.currency!=='UZS'||conv)&&<small>≈ {money(o.unitCost)}/{m.unit}</small>}</div></td>
        <td className="align-right"><div className="cell-main"><b>{o.link.leadTime} kun</b><small>{o.expectedDate}</small></div></td>
        <td className="align-right">{o.link.moq?`${num(o.link.moq,3)} ${o.link.purchaseUnit}`:<span className="muted">—</span>}</td>
        <td className="align-right"><div className="cell-main"><b>{o.proposal.purchaseQty?`${num(o.proposal.purchaseQty,3)} ${o.link.purchaseUnit}`:'—'}</b><small>{o.proposal.excess>0?<span className="warning-text">+{qty(o.proposal.excess,m.unit)} ortiq{o.proposal.moqRaised?' (MOQ)':''}</span>:conv||' '}</small></div></td>
        <td className="align-right">{o.total?money(o.total):'—'}</td>
        <td className="align-right">{o.onTimePct===null?<span className="muted">—</span>:`${o.onTimePct}%`}</td>
        <td><span className="badge-row">{o.blocked?<StatusBadge tone="neutral">{o.blocked}</StatusBadge>:deliveryBadge(o.expectedDate,need.needBy)||<StatusBadge tone="success">Faol</StatusBadge>}</span></td>
        <td className="align-right"><button type="button" className={o.recommended?'primary-glass-btn compact':'soft-glass-btn compact'} disabled={Boolean(o.blocked)||(!onPick&&!app.can('purchases','create'))} title={o.blocked} onClick={()=>{if(onPick){onPick(o.link);onClose()}else setPicked(o.link.id)}}>Tanlash</button></td>
      </tr>})}
    </tbody></table></div>:<Empty icon="truck" title="Bu materialga supplier biriktirilmagan" text={canLink?'Supplier biriktiring — narx, MOQ va lead time bilan. Shundan keyin xarid boshlash mumkin.':'Supplier biriktirish uchun xarid yoki material tahrirlash ruxsati kerak.'} action={canLink?<button type="button" className="primary-glass-btn compact" onClick={()=>setLinking(true)}><Icon name="plus" size={14}/>Supplier biriktirish</button>:undefined}/>}
    {options.length>0&&<p className="soft-meta">Tavsiya: muddatga ulguradigan faol supplierlar ichida MOQ va butun birlik bilan jami summasi eng pasti. Eng arzon narx avtomatik tanlanmaydi — tanlov sizda.</p>}
    {linking&&<SupplierMaterialModal materialId={m.id} onClose={()=>setLinking(false)}/>}
  </Modal>
}

function rawStores(s:ReturnType<typeof useApp>['state']){
  return s.warehouses.filter(w=>w.status==='Faol'&&(w.type==='Raw'||w.type==='Mixed'))
}

/** Step 2: the PO pre-filled from the chosen supplier and the need; everything stays editable before confirming. */
function PurchaseDraftModal({link,need,onBack,onClose}:{link:SupplierMaterial;need:SourcingNeed;onBack:()=>void;onClose:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const m=s.rawMaterials.find(x=>x.id===link.materialId)!
  const proposal=orderProposal(link,need.need)
  const rate=CURRENCIES[link.currency].rate
  const stores=rawStores(s)
  const form=useForm({units:String(proposal.purchaseQty||Math.max(1,link.moq)),price:String(link.price),expectedDate:addDays(todayISO(),link.leadTime),warehouseId:need.warehouseId||rawWarehouseFor(s,s.settings.defaultWarehouseId),draft:false,belowMoq:false},x=>({
    units:positive(x.units,'Miqdor')||(link.unitFactor!==1&&Number(x.units)%1?`Butun ${link.purchaseUnit} kiriting`:undefined)||(link.moq>0&&Number(x.units)<link.moq&&!x.belowMoq?`MOQ ${num(link.moq,3)} ${link.purchaseUnit} — tasdiqlang yoki oshiring`:undefined),
    price:nonNegative(x.price,'Narx'),expectedDate:x.expectedDate?undefined:'Sanani kiriting',warehouseId:x.warehouseId?undefined:'Omborni tanlang',
  }))
  const v=form.values
  const units=Number(v.units)||0,stockQty=q3(units*link.unitFactor),perStock=(Number(v.price)||0)*rate/link.unitFactor
  const excess=q3(stockQty-need.need),below=link.moq>0&&units>0&&units<link.moq
  const late=Boolean(need.needBy&&v.expectedDate>need.needBy)
  const draftOnly=!app.can('purchases','approve')?'Tasdiqlash huquqingiz yo‘q — qoralama sifatida saqlanadi':needsSecondApprover(app.state,Math.round(stockQty*perStock))?'Ikki kishilik tasdiq: boshqa xodim tasdiqlaydi':''
  const submit=()=>form.submit(x=>{
    const r=app.createPurchaseOrder({supplierId:link.supplierId,lines:[{materialId:m.id,qty:stockQty,price:Math.round(perStock*100)/100}],expectedDate:x.expectedDate,warehouseId:x.warehouseId,status:x.draft||draftOnly?'Qoralama':'Tasdiqlangan',source:need.source||'Shortage',productionOrderIds:need.orderIds,allowBelowMoq:x.belowMoq})
    if(r.ok){onClose();if(!need.orderIds?.length)navigate(`/purchases?view=orders&id=${r.id}`)}
    return r.ok
  })
  return <Modal open onClose={onClose} size="lg" eyebrow={`Purchase Order · ${supplierName(s,link.supplierId)}`} title={m.name} subtitle={`${quoteText(link)} · lead ${link.leadTime} kun${link.moq?` · MOQ ${num(link.moq,3)} ${link.purchaseUnit}`:''}`}
    footer={<><button type="button" className="secondary-glass-btn" onClick={onBack}><Icon name="chevron" size={14} className="flip"/>Supplierlar</button><span className="spacer"/><span className="soft-meta">Jami: <b>{money(stockQty*perStock)}</b></span><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>{v.draft?'Qoralama saqlash':'PO yaratish'}</button></>}>
    <div className="form-grid">
      <Field label={`Miqdor (${link.purchaseUnit})`} required error={form.error('units')} hint={link.unitFactor!==1?`= ${qty(stockQty,m.unit)}`:need.need>0?`Kerak: ${qty(need.need,m.unit)}`:undefined}><Input type="number" min="0" step={link.unitFactor!==1?'1':'any'} inputMode="decimal" {...form.input('units')} autoFocus/></Field>
      <Field label={`Narx (${CURRENCIES[link.currency].symbol} / ${link.purchaseUnit})`} required error={form.error('price')} hint={link.currency!=='UZS'||link.unitFactor!==1?`≈ ${money(perStock)} / ${m.unit}`:undefined}><Input type="number" min="0" step="any" inputMode="decimal" {...form.input('price')}/></Field>
      <Field label="Kutilayotgan sana" required error={form.error('expectedDate')} hint={need.needBy?`Kerak: ${need.needBy}`:undefined}><Input type="date" {...form.input('expectedDate')}/></Field>
      <Field label="Qabul ombori" required error={form.error('warehouseId')}><Select value={v.warehouseId} onChange={x=>form.set('warehouseId',x)}>{stores.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
    </div>
    <div className="note-stack">
      {below&&<div className="inline-note warning"><Icon name="warning"/><span>Buyurtma MOQ’dan kam: {num(units,3)} &lt; {num(link.moq,3)} {link.purchaseUnit}. Supplier rad etishi mumkin.<Checkbox checked={v.belowMoq} onChange={x=>form.set('belowMoq',x)} label="Supplier bilan kelishilgan — MOQ’dan kam buyurtma"/></span></div>}
      {excess>0&&<div className="inline-note"><Icon name="info"/>Talabdan {qty(excess,m.unit)} ortiq ({proposal.moqRaised&&units===proposal.purchaseQty?'MOQ':'butun xarid birligi yoki tahrir'}). Ortiqcha qism omborda qoladi.</div>}
      {need.need>0&&stockQty>0&&stockQty<need.need-1e-9&&<div className="inline-note warning"><Icon name="warning"/>Talabning {qty(need.need-stockQty,m.unit)} qismi bu PO bilan qoplanmaydi.</div>}
      {late&&<div className="inline-note danger"><Icon name="clock"/>Kutilayotgan sana ({v.expectedDate}) kerakli sanadan ({need.needBy}) kech — ishlab chiqarish muddati xavf ostida.</div>}
      {(need.orderIds||[]).length>0&&<div className="inline-note"><Icon name="factory"/>PO {(need.orderIds||[]).map(id=>s.productionOrders.find(o=>o.id===id)?.code).join(', ')} bilan bog‘lanadi. Material qabul qilinmaguncha ombor qoldig‘i oshmaydi.</div>}
    </div>
    <Checkbox checked={v.draft||Boolean(draftOnly)} disabled={Boolean(draftOnly)} onChange={x=>form.set('draft',x)} label="Qoralama (RFQ)" description={draftOnly||'Tasdiqlanmaguncha “yo‘lda” hisoblanmaydi'}/>
  </Modal>
}

type PlanRow={supplierId:string;units:string}

/**
 * Several materials at once: a supplier per material (preferred / only one pre-selected, otherwise the
 * person picks), quantities in purchase units, then one PO per supplier and receiving store.
 */
export function PurchasePlanModal({needs,title='Xarid rejasi',subtitle,onClose}:{needs:SourcingNeed[];title?:string;subtitle?:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const initial=(n:SourcingNeed):PlanRow=>{const sid=preferredSupplierId(s,n.materialId)||'';const l=sid?findLink(s,sid,n.materialId):undefined;return {supplierId:sid,units:l?String(orderProposal(l,n.need).purchaseQty):''}}
  const [rows,setRows]=useState<PlanRow[]>(()=>needs.map(initial))
  const [compare,setCompare]=useState<number|null>(null),[linkFor,setLinkFor]=useState<string|null>(null),[belowMoq,setBelowMoq]=useState(false)
  const setRow=(i:number,patch:Partial<PlanRow>)=>setRows(x=>x.map((r,j)=>j===i?{...r,...patch}:r))
  const pick=(i:number,supplierId:string)=>{const l=findLink(s,supplierId,needs[i].materialId);setRow(i,{supplierId,units:l?String(orderProposal(l,needs[i].need).purchaseQty):''})}
  const lines=needs.map((n,i)=>{
    const r=rows[i],m=s.rawMaterials.find(x=>x.id===n.materialId),link=r.supplierId?findLink(s,r.supplierId,n.materialId):undefined
    const units=Number(r.units)||0,stockQty=link?q3(units*link.unitFactor):0,perStock=link?linkUnitCost(link):0
    const error=!link?undefined:!(units>0)?'Miqdor':link.unitFactor!==1&&units%1?'Butun birlik':undefined
    return {n,i,m,link,units,stockQty,perStock,total:stockQty*perStock,error,below:Boolean(link&&link.moq>0&&units>0&&units<link.moq),excess:link?q3(stockQty-n.need):0,short:link&&units>0?q3(n.need-stockQty):0,late:Boolean(link&&n.needBy&&addDays(todayISO(),link.leadTime)>n.needBy),options:orderableLinks(s,n.materialId)}
  })
  const chosen=lines.filter(l=>l.link&&!l.error)
  const groups=[...chosen.reduce((map,l)=>{const wh=l.n.warehouseId||rawWarehouseFor(s,s.settings.defaultWarehouseId);const key=`${l.link!.supplierId}|${wh}`;map.set(key,[...(map.get(key)||[]),l]);return map},new Map<string,typeof chosen>()).entries()]
  const anyBelow=chosen.some(l=>l.below)
  const blocked=lines.some(l=>l.error)||(anyBelow&&!belowMoq)||!groups.length
  const submit=()=>{
    const r=app.createPurchaseOrders(groups.map(([key,ls])=>{const [supplierId,warehouseId]=key.split('|');return {supplierId,warehouseId,lines:ls.map(l=>({materialId:l.n.materialId,qty:l.stockQty,price:Math.round(l.perStock*100)/100})),source:ls[0].n.source||'Shortage',productionOrderIds:[...new Set(ls.flatMap(l=>l.n.orderIds||[]))],allowBelowMoq:belowMoq,
      status:!app.can('purchases','approve')||needsSecondApprover(s,Math.round(ls.reduce((a,l)=>a+l.stockQty*l.perStock,0)))?'Qoralama' as const:undefined}}))
    if(r.ok)onClose()
  }
  return <Modal open onClose={onClose} size="xl" eyebrow="Purchase Orders" title={title} subtitle={subtitle||'Har material uchun supplier · bir supplierga bitta PO'}
    footer={<><span className="soft-meta">{groups.length} PO · {chosen.length}/{needs.length} material · jami <b>{money(chosen.reduce((a,l)=>a+l.total,0))}</b></span><span className="spacer"/><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={blocked||!app.can('purchases','create')} onClick={submit}><Icon name="cart" size={16}/>PO yaratish ({groups.length})</button></>}>
    <div className="table-scroll"><table className="sourcing-table plan-table"><thead><tr><th>Material</th><th className="align-right">Kerak</th><th>Supplier</th><th className="align-right">Miqdor</th><th className="align-right">Summa</th></tr></thead><tbody>
      {lines.map(l=><tr key={l.n.materialId+l.i} className={l.error?'row-danger':undefined}>
        <td><div className="cell-main"><b>{l.m?.name||l.n.materialId}</b><small>{(l.n.orderIds||[]).map(id=>s.productionOrders.find(o=>o.id===id)?.code).join(', ')||l.m?.sku}{l.n.needBy?` · kerak ${l.n.needBy}`:''}</small></div></td>
        <td className="align-right"><b>{qty(l.n.need,l.m?.unit)}</b></td>
        <td className="wide-cell">{l.options.length
          ?<div className="plan-supplier"><Select value={rows[l.i].supplierId} onChange={x=>pick(l.i,x)} ariaLabel={`${l.m?.name} supplier`} placeholder="Supplier tanlang">{l.options.map(o=><option key={o.id} value={o.supplierId}>{supplierName(s,o.supplierId)} · {quoteText(o)} · {o.leadTime} kun{o.moq?` · MOQ ${num(o.moq,3)}`:''}</option>)}</Select><button type="button" className="link-btn" onClick={()=>setCompare(l.i)}>Taqqoslash{l.options.length>1?` (${l.options.length})`:''}</button></div>
          :<div className="plan-supplier"><span className="negative">Faol supplier yo‘q</span>{(app.can('purchases','edit')||app.can('materials','edit'))&&<button type="button" className="link-btn" onClick={()=>setLinkFor(l.n.materialId)}>Biriktirish</button>}</div>}
          {(l.error||l.below||l.excess>0||l.short>0||l.late||(!l.link&&l.options.length>0))&&<span className="badge-row plan-notes">{l.error&&<StatusBadge tone="danger">{l.error}</StatusBadge>}{!l.link&&l.options.length>0&&<StatusBadge tone="warning">Tanlanmagan</StatusBadge>}{l.below&&<StatusBadge tone="warning">MOQ {num(l.link!.moq,3)} {l.link!.purchaseUnit}</StatusBadge>}{l.excess>0&&<StatusBadge tone="info">+{qty(l.excess,l.m?.unit)} ortiq</StatusBadge>}{l.short>0&&<StatusBadge tone="warning">{qty(l.short,l.m?.unit)} qoplanmaydi</StatusBadge>}{l.late&&<StatusBadge tone="danger">Muddatdan kech</StatusBadge>}</span>}</td>
        <td className="align-right">{l.link?<span className="unit-input"><input className="ui-input cell-input" type="number" min="0" step={l.link.unitFactor!==1?'1':'any'} aria-label={`${l.m?.name} miqdori`} value={rows[l.i].units} onChange={e=>setRow(l.i,{units:e.target.value})}/><small>{l.link.purchaseUnit}</small></span>:<span className="muted">—</span>}{l.link&&l.link.unitFactor!==1&&<small className="cell-sub">= {qty(l.stockQty,l.m?.unit)}</small>}</td>
        <td className="align-right">{l.link&&!l.error?money(l.total):<span className="muted">—</span>}</td>
      </tr>)}
    </tbody></table></div>
    {anyBelow&&<div className="inline-note warning"><Icon name="warning"/><span>Ba’zi qatorlar MOQ’dan kam.<Checkbox checked={belowMoq} onChange={setBelowMoq} label="Supplier bilan kelishilgan — MOQ’dan kam buyurtma"/></span></div>}
    {lines.some(l=>!l.link)&&<p className="soft-meta">Supplier tanlanmagan materiallar uchun PO yaratilmaydi.</p>}
    {compare!==null&&<SourcingModal need={needs[compare]} onPick={l=>pick(compare,l.supplierId)} onClose={()=>setCompare(null)}/>}
    {linkFor&&<SupplierMaterialModal materialId={linkFor} onClose={()=>setLinkFor(null)}/>}
  </Modal>
}

/* -------------------------------------------- production order materials -- */

/** Purchasable lines of an order that are covered neither by stock nor by incoming POs. */
export function orderPurchaseNeeds(s:ReturnType<typeof useApp>['state'],order:ProductionOrder):SourcingNeed[]{
  return orderMaterialPlan(s,order).filter(l=>l.purchasable&&l.toBuy>0).map(l=>({materialId:l.materialId,need:l.toBuy,needBy:order.due,orderIds:[order.id],warehouseId:l.warehouseId,source:`${order.code} yetishmovchilik`}))
}

function supplyCell(l:MaterialPlanLine){
  if(!l.incoming)return <span className="muted">—</span>
  return <div className="cell-main"><b>{num(l.incoming,1)}</b><small>{l.supply.map(x=>`${x.code} · ${x.expectedDate.slice(5)}`).join(', ')}</small></div>
}

/** Order → BOM → requirement → stock / incoming / to buy → suppliers → PO, without leaving the order. */
export function OrderMaterialsPanel({order}:{order:ProductionOrder}){
  const app=useApp(),s=app.state
  const [sourcing,setSourcing]=useState<SourcingNeed|null>(null),[plan,setPlan]=useState(false)
  const lines=orderMaterialPlan(s,order)
  const closed=['Yakunlangan','Bekor qilingan'].includes(order.status)
  const needs=orderPurchaseNeeds(s,order)
  const canBuy=app.can('purchases','create')
  const used=(materialId:string)=>order.consumed.filter(c=>c.materialId===materialId).reduce((a,c)=>a+c.qty,0)
  const open=(l:MaterialPlanLine)=>setSourcing({materialId:l.materialId,need:l.toBuy,needBy:order.due,orderIds:[order.id],warehouseId:l.warehouseId,source:`${order.code} yetishmovchilik`})
  if(closed||!lines.length)return <div className="table-scroll"><table className="fit"><thead><tr><th>Komponent</th><th className="align-right">Sarflangan</th></tr></thead><tbody>{order.bomSnapshot.components.map(c=><tr key={c.id}><td><div className="cell-main"><b>{materialName(s,c.materialId)}</b><small>{c.qty} {c.unit}/dona</small></div></td><td className="align-right">{qty(used(c.materialId),c.unit)}</td></tr>)}</tbody></table>{!order.bomSnapshot.components.length&&<Empty compact title="Komponent yo‘q"/>}</div>
  const elsewhere=lines.filter(l=>l.toBuy>0&&l.elsewhere>0)
  return <div className="stack-list order-materials-panel">
    {needs.length>0&&<div className="inline-note danger shortage-alert" role="alert"><Icon name="warning"/><span className="shortage-alert-copy"><b>{needs.length} material yetishmaydi</b><small>{needs.map(n=>materialName(s,n.materialId)).join(', ')} · ombor va yo‘ldagi PO hisobga olingan</small></span>{canBuy&&<button type="button" className="soft-glass-btn compact" onClick={()=>setPlan(true)}><Icon name="cart" size={14}/>Barchasiga PO</button>}</div>}
    <div className="table-card"><div className="table-scroll"><table className="order-materials"><thead><tr><th>Komponent</th><th className="align-right">Talab</th><th className="align-right">Ombordan</th><th className="align-right">Yo‘lda</th><th className="align-right">Xarid kerak</th><th>Supplier</th><th className="col-action"><span className="sr-only">Amal</span></th></tr></thead><tbody>
      {lines.map(l=>{
        const links=linksOfMaterial(s,l.materialId),orderable=links.filter(x=>!linkBlock(s,x)),preferred=preferredSupplierId(s,l.materialId)
        return <tr key={l.component.id} className={l.toBuy>0?'row-danger':l.lateForDue?'row-warning':undefined}>
          <td><div className="cell-main">{l.purchasable?<button type="button" className="link-btn" onClick={()=>open(l)}>{materialName(s,l.materialId)}</button>:<b>{materialName(s,l.materialId)}</b>}<small>{l.component.qty} {l.unit}/dona · waste {l.component.waste}%{l.component.subBomId||!l.purchasable&&!l.unitMismatch?' · sub-assembly':''}</small></div></td>
          <td className="align-right"><div className="cell-main"><b>{qty(l.required,l.unit)}</b>{used(l.materialId)>0&&<small>sarflangan {num(used(l.materialId),1)}</small>}</div></td>
          <td className="align-right"><div className="cell-main"><b>{num(l.covered,1)}</b><small>{l.reserved?'rezervda':warehouseName(s,l.warehouseId)}</small></div></td>
          <td className="align-right">{supplyCell(l)}</td>
          <td className="align-right">{l.unitMismatch?<StatusBadge tone="danger">Birlik mos emas</StatusBadge>:l.toBuy>0?<b className="negative">{qty(l.toBuy,l.unit)}</b>:<span className="badge-row end">{l.lateForDue?<StatusBadge tone="danger">PO muddatdan kech</StatusBadge>:l.overduePo?<StatusBadge tone="warning">PO kechikmoqda</StatusBadge>:l.afterStart?<StatusBadge tone="warning">Boshlanishdan keyin</StatusBadge>:l.shortage>0?<StatusBadge tone="info">Yo‘lda qoplanadi</StatusBadge>:<StatusBadge tone="success">{l.reserved?'Rezervda':'Yetarli'}</StatusBadge>}</span>}</td>
          <td>{!l.purchasable?<span className="muted">{l.unitMismatch?`BOM ${l.unit} · ombor ${l.stockUnit}`:'Ishlab chiqariladi'}</span>:!links.length?<span className="negative">Supplier yo‘q</span>:<div className="cell-main"><b>{preferred?supplierName(s,preferred):`${orderable.length} ta faol`}</b><small>{links.length} biriktirilgan{orderable.length<links.length?` · ${links.length-orderable.length} nofaol`:''}</small></div>}</td>
          <td className="col-action">{l.purchasable&&l.toBuy>0&&<button type="button" className="soft-glass-btn compact" onClick={()=>open(l)}><Icon name="truck" size={14}/>Supplier</button>}</td>
        </tr>})}
    </tbody></table></div></div>
    {elsewhere.map(l=><div key={l.component.id} className="inline-note"><Icon name="info"/>{materialName(s,l.materialId)}: boshqa omborlarda {qty(l.elsewhere,l.stockUnit)} bor — bu MO uchun hisobga olinmagan, kerak bo‘lsa transfer qiling.</div>)}
    <p className="soft-meta">Ombordan = available (on hand − barcha rezervlar − karantin), muddati yaqin MO’larga birinchi taqsimlanadi. Yo‘lda = tasdiqlangan PO qoldig‘i, har birligi bitta MO’ga beriladi. Xarid kerak = qolgani.</p>
    {sourcing&&<SourcingModal need={sourcing} onClose={()=>setSourcing(null)}/>}
    {plan&&<PurchasePlanModal needs={needs} title={`${order.code} — xarid`} subtitle="Yetishmayotgan materiallar · bir supplierga bitta PO" onClose={()=>setPlan(false)}/>}
  </div>
}

/** One-line material state of an order for its overview, with the next step. */
export function OrderMaterialNote({order,onOpenMaterials}:{order:ProductionOrder;onOpenMaterials:()=>void}){
  const s=useApp().state
  if(['Yakunlangan','Bekor qilingan'].includes(order.status)||order.materialReserved)return null
  const lines=orderMaterialPlan(s,order)
  const toBuy=lines.filter(l=>l.toBuy>0),late=lines.filter(l=>l.toBuy<=0&&l.lateForDue),incoming=lines.filter(l=>l.toBuy<=0&&l.shortage>0)
  if(toBuy.length)return <div className="inline-note danger"><Icon name="warning"/><span>Yetishmaydi: {toBuy.map(l=>`${materialName(s,l.materialId)} ${qty(l.toBuy,l.unit)}`).join(', ')}. <button type="button" className="link-btn" onClick={onOpenMaterials}>Supplier tanlash</button></span></div>
  if(late.length)return <div className="inline-note warning"><Icon name="clock"/><span>Material yo‘lda, lekin MO muddatidan ({order.due}) kech keladi: {late.map(l=>`${materialName(s,l.materialId)} — ${l.arrives}`).join(', ')}. <button type="button" className="link-btn" onClick={onOpenMaterials}>Batafsil</button></span></div>
  if(incoming.length)return <div className="inline-note"><Icon name="truck"/><span>Material yo‘lda: {incoming.map(l=>`${materialName(s,l.materialId)} ${l.supply.map(x=>`${x.code} (${x.expectedDate})`).join(', ')}`).join('; ')}. Qabul qilingach rezerv qilinadi.</span></div>
  if(order.status==='Qoralama')return <div className="inline-note success"><Icon name="check"/>Material yetarli — “Tasdiqlash va rezerv” bilan rezerv qiling.</div>
  if(order.status==='Material kutilmoqda')return <div className="inline-note success"><Icon name="check"/>Material endi yetarli — “Materialni qayta tekshirish” bilan rezerv qiling.</div>
  return null
}
