import {useRef,useState} from 'react'
import type {CSSProperties} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Checkbox,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,Progress,ResourceTable,Select,StatusBadge,Tabs,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {CurrencyCode,PurchaseOrder,SubcontractOrder,Supplier,SupplierMaterial} from '../../../types'
import {activeBomFor,createMrpPlan,perUnit,stockOf} from '../../../domain/manufacturingEngine'
import {needsSecondApprover,referenceBlocker} from '../../../domain/actions'
import {SUPPLY_CURRENCIES,linkBlock,linksOfSupplier,receiptQuantities,rejectedOpen,supplierPerformance,supplierPurchaseHistory} from '../../../domain/supplierMaterials'
import {QualityResolveModal} from '../../common/QualityResolveModal'
import {CURRENCIES,quoteMoney} from '../../../utils/format'
import {LinkTermsTable,PurchasePlanModal,SourcingModal,SupplierMaterialModal,conversionText,quoteText} from '../components/Sourcing'
import type {SourcingNeed} from '../components/Sourcing'
import {addDays,todayISO} from '../../../utils/dates'
import {compactMoney,money,num,qty} from '../../../utils/format'
import {employeeName,materialName,productName,supplierName,warehouseName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'
import {BarList} from '../../common/charts'

export default function Purchases(){
  const [sp]=useSearchParams(),view=sp.get('view')||'overview'
  if(view==='orders')return <Orders/>
  if(view==='suppliers')return <Suppliers/>
  if(view==='receiving')return <Receiving/>
  if(view==='requests')return <Requests/>
  if(view==='subcontracting')return <Subcontracting/>
  return <Overview/>
}

const OPEN_PO=['Qoralama','Tasdiqlangan','Yo‘lda','Qisman qabul']

export {supplierPerformance}

function Overview(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const open=s.purchaseOrders.filter(p=>OPEN_PO.includes(p.status))
  const late=open.filter(p=>p.expectedDate<todayISO()&&p.status!=='Qoralama')
  const plan=createMrpPlan(s)
  return <div className="page-stack">
    <PageHeader title="Xaridlar" subtitle="Yetishmovchilik → PO → qabul → zaxira"/>
    <div className="kpi-grid">
      <KPI label="Ochiq PO" value={open.length} sub={compactMoney(open.reduce((a,p)=>a+p.items.reduce((x,i)=>x+(i.qty-i.received)*i.price,0),0))} icon={<Icon name="cart"/>} onClick={()=>navigate('/purchases?view=orders')}/>
      <KPI label="Kechikkan" value={late.length} sub="Sana o‘tgan" tone="pink" icon={<Icon name="clock"/>} onClick={()=>navigate('/purchases?view=orders&late=1')}/>
      <KPI label="Xarid tavsiyalari" value={plan.purchases.filter(p=>p.suggested>0).length} sub="MRP" tone="orange" icon={<Icon name="warning"/>} onClick={()=>navigate('/purchases?view=requests')}/>
      <KPI label="Supplier qarzi" value={compactMoney(s.suppliers.reduce((a,b)=>a+b.debt,0))} tone="purple" icon={<Icon name="wallet"/>} onClick={()=>navigate('/purchases?view=suppliers')}/>
    </div>
    <div className="two-col">
      <Card title="Kutilayotgan qabullar" subtitle="Sana bo‘yicha" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/purchases?view=receiving')}>Qabul <Icon name="chevron" size={13}/></button>}>
        {open.length?<div className="stack-list">{[...open].sort((a,b)=>a.expectedDate.localeCompare(b.expectedDate)).map(p=><button type="button" className="list-row is-clickable" key={p.id} onClick={()=>navigate(`/purchases?view=orders&id=${p.id}`)}><span className="list-row-copy"><b>{p.code} · {supplierName(s,p.supplierId)}</b><small>{p.items.map(i=>`${materialName(s,i.materialId)} ${num(i.qty-i.received)}`).join(', ')} · {p.expectedDate}</small></span><span className="list-row-meta"><StatusBadge tone={late.includes(p)?'danger':undefined}>{late.includes(p)?'Kechikmoqda':p.status}</StatusBadge></span></button>)}</div>:<Empty compact title="Ochiq xarid yo‘q"/>}
      </Card>
      <Card title="Supplier performance" subtitle="vaqtida yetkazish" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/purchases?view=suppliers')}>Supplierlar <Icon name="chevron" size={13}/></button>}>
        <BarList rows={s.suppliers.map(x=>{const p=supplierPerformance(s,x.id);return {label:x.name,sub:`${p.receipts} qabul · rad ${p.rejectionPct??'—'}% · lead ${p.avgLead??'—'} kun`,value:p.onTimePct??0,tone:(p.onTimePct===null?undefined:p.onTimePct>=90?'success':p.onTimePct>=70?'warning':'danger') as 'success'|'warning'|'danger'|undefined}})} unit="%" max={100}/>
      </Card>
    </div>
  </div>
}

function Requests(){
  const app=useApp(),s=app.state
  const plan=createMrpPlan(s)
  const [selected,setSelected]=useState<string[]>([])
  const [sourcing,setSourcing]=useState<SourcingNeed|null>(null),[planned,setPlanned]=useState<SourcingNeed[]|null>(null)
  const rows=plan.purchases.filter(p=>p.suggested>0)
  const needOf=(p:typeof rows[number]):SourcingNeed=>({materialId:p.materialId,need:p.suggested,needBy:p.needBy,source:'Purchase request'})
  const canBuy=app.can('purchases','create')
  return <div className="page-stack">
    <PageHeader title="Purchase Requests" subtitle="MRP netting · supplier tanlang · bir supplierga bitta PO"
      actions={<button type="button" className="primary-glass-btn" disabled={!selected.length||!canBuy} onClick={()=>setPlanned(rows.filter(r=>selected.includes(r.materialId)).map(needOf))}><Icon name="cart"/>Tanlanganlardan PO ({selected.length})</button>}/>
    {rows.length?<Card className="flush"><div className="table-scroll"><table><thead><tr><th><span className="sr-only">Tanlash</span></th><th>Material</th><th className="align-right">Talab</th><th className="align-right">Available</th><th className="align-right">Yo‘lda</th><th className="align-right">Tavsiya</th><th>Supplier</th><th>Kerak sana</th><th/></tr></thead><tbody>{rows.map(p=>{const m=s.rawMaterials.find(x=>x.id===p.materialId)!;return <tr key={p.materialId}>
      <td><Checkbox checked={selected.includes(p.materialId)} onChange={v=>setSelected(x=>v?[...x,p.materialId]:x.filter(i=>i!==p.materialId))} label={<span className="sr-only">{m.name}</span>}/></td>
      <td><div className="cell-main"><b>{m.name}</b><small>{m.sku}</small></div></td><td className="align-right">{qty(p.required,m.unit)}</td><td className="align-right">{num(p.available)}</td><td className="align-right">{num(p.incoming)}</td><td className="align-right"><b>{qty(p.suggested,m.unit)}</b></td>
      <td>{p.supplierId?supplierName(s,p.supplierId):p.supplierCount>1?<span className="warning-text">{p.supplierCount} ta — tanlang</span>:<span className="negative">Supplier yo‘q</span>}</td><td>{p.needBy}</td>
      <td className="align-right"><button type="button" className="soft-glass-btn compact" disabled={!canBuy} onClick={()=>setSourcing(needOf(p))}><Icon name="truck" size={14}/>Supplier</button></td>
    </tr>})}</tbody></table></div></Card>:<Card><Empty icon="check" title="Xarid talab qilinmaydi" text="Talab qoplangan"/></Card>}
    {sourcing&&<SourcingModal need={sourcing} onClose={()=>setSourcing(null)}/>}
    {planned&&<PurchasePlanModal needs={planned} title="Tanlangan talablar" onClose={()=>{setPlanned(null);setSelected([])}}/>}
  </div>
}

function Orders(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[supplier,setSupplier]=useSearchParamState('supplier'),[late,setLate]=useSearchParamState('late')
  const [id,setId]=useRecordParam()
  const [create,setCreate]=useState(false)
  const rows=s.purchaseOrders.filter(p=>(!status||p.status===status)&&(!supplier||p.supplierId===supplier)&&(late!=='1'||(OPEN_PO.includes(p.status)&&p.status!=='Qoralama'&&p.expectedDate<todayISO())))
  return <div className="page-stack">
    <PageHeader title="Purchase Orders" subtitle="Qoralama → tasdiqlangan → yo‘lda → qabul"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('purchases','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi PO</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="PO, supplier, material..." onRow={p=>setId(p.id)} exportName="purchase-orders" resetKey={`${status}|${supplier}|${late}`}
      filtersActive={Boolean(status||supplier||late)} onResetFilters={()=>{setStatus('');setSupplier('');setLate('')}}
      filters={<><FilterSelect label="Status" value={status} onChange={setStatus} options={['Qoralama','Tasdiqlangan','Yo‘lda','Qisman qabul','Qabul qilindi','Bekor']}/><FilterSelect label="Supplier" value={supplier} onChange={setSupplier} options={s.suppliers.map(x=>({value:x.id,label:x.name}))}/><Checkbox checked={late==='1'} onChange={v=>setLate(v?'1':'')} label="Kechikkan"/></>}
      rowClassName={p=>OPEN_PO.includes(p.status)&&p.status!=='Qoralama'&&p.expectedDate<todayISO()?'row-danger':undefined}
      columns={[
        {key:'code',label:'PO',value:p=>p.code,render:p=><div className="cell-main"><b>{p.code}</b><small title={p.source}>{p.createdAt.slice(0,10)}</small></div>},
        {key:'supplier',label:'Supplier',value:p=>supplierName(s,p.supplierId)},
        {key:'items',label:'Materiallar',value:p=>p.items.map(i=>materialName(s,i.materialId)).join(', '),render:p=><span className="truncate">{p.items.map(i=>materialName(s,i.materialId)).join(', ')}</span>,priority:'low'},
        {key:'received',label:'Qabul',align:'right',value:p=>p.items.reduce((a,i)=>a+i.received,0)/Math.max(1,p.items.reduce((a,i)=>a+i.qty,0))*100,render:p=>{const pct=p.items.reduce((a,i)=>a+i.received,0)/Math.max(1,p.items.reduce((a,i)=>a+i.qty,0))*100;return <div className="progress-cell"><Progress value={pct}/><small>{Math.round(pct)}%</small></div>}},
        {key:'status',label:'Status',value:p=>p.status,render:p=><StatusBadge>{p.status}</StatusBadge>},
        {key:'total',label:'Summa',align:'right',value:p=>p.total,render:p=>money(p.total)},
        {key:'payment',label:'To‘lov',value:p=>p.paymentStatus,render:p=><StatusBadge>{p.paymentStatus}</StatusBadge>,priority:'low'},
        {key:'expected',label:'Expected',value:p=>p.expectedDate},
      ]}/>
    {create&&<PurchaseFormModal onClose={()=>setCreate(false)} onCreated={v=>setId(v)}/>}
    <PurchaseDrawer poId={id} onClose={()=>setId(null)}/>
  </div>
}

type Line={linkId:string;units:string;price:string}
/** Manual PO: only materials linked to the chosen supplier, in its purchase units, currency and MOQ. With `po` it edits a draft. */
function PurchaseFormModal({onClose,onCreated,supplierId,po}:{onClose:()=>void;onCreated?:(id:string)=>void;supplierId?:string;po?:PurchaseOrder}){
  const app=useApp(),s=app.state
  const fixedSupplier=po?.supplierId||supplierId
  const suppliers=s.suppliers.filter(x=>x.status==='Faol'||x.id===fixedSupplier)
  const orderable=(sid:string)=>linksOfSupplier(s,sid).filter(l=>!linkBlock(s,l))
  const defaultUnits=(l:{moq:number;unitFactor:number})=>String(l.moq>0?l.moq:l.unitFactor===1?100:1)
  const lineFor=(l?:ReturnType<typeof orderable>[number]):Line=>({linkId:l?.id||'',units:l?defaultUnits(l):'',price:l?String(l.price):''})
  const [sid,setSid]=useState(()=>fixedSupplier||suppliers.find(x=>orderable(x.id).length)?.id||suppliers[0]?.id||'')
  const links=orderable(sid)
  const lead=(ls:Line[])=>Math.max(0,...ls.map(l=>s.supplierMaterials.find(x=>x.id===l.linkId)?.leadTime??0))
  // A draft's lines come back in purchase units and the supplier's currency, as they were entered.
  const [lines,setLines]=useState<Line[]>(()=>{
    if(po)return po.items.map(i=>{const link=s.supplierMaterials.find(l=>l.id===i.linkId)||links.find(l=>l.materialId===i.materialId);return {linkId:link?.id||'',units:String(Math.round(i.qty/(i.unitFactor||link?.unitFactor||1)*1000)/1000),price:String(i.unitPrice??link?.price??i.price)}})
    const first=orderable(sid)[0];return first?[lineFor(first)]:[]
  })
  const [expectedDate,setExpectedDate]=useState(()=>po?.expectedDate||addDays(todayISO(),lead(lines)||s.suppliers.find(x=>x.id===sid)?.leadTime||4))
  const [warehouseId,setWarehouseId]=useState(()=>po?.warehouseId||rawStores(s).find(w=>w.id===s.settings.defaultWarehouseId)?.id||rawStores(s)[0]?.id||'')
  const [draft,setDraft]=useState(false),[belowMoq,setBelowMoq]=useState(false),[submitted,setSubmitted]=useState(false)
  const changeSupplier=(v:string)=>{setSid(v);const first=orderable(v)[0];const next=first?[lineFor(first)]:[];setLines(next);setExpectedDate(addDays(todayISO(),lead(next)||s.suppliers.find(x=>x.id===v)?.leadTime||4))}
  const rows=lines.map(l=>{
    const link=s.supplierMaterials.find(x=>x.id===l.linkId),m=s.rawMaterials.find(x=>x.id===link?.materialId)
    const units=Number(l.units)||0,price=Number(l.price),perStock=link?price*CURRENCIES[link.currency].rate/link.unitFactor:0
    const error=!link?'Material':!(units>0)?'Miqdor > 0':link.unitFactor!==1&&units%1?`Butun ${link.purchaseUnit}`:l.price===''||!(price>=0)?'Narx':lines.filter(x=>x.linkId===l.linkId).length>1?'Takror':undefined
    return {l,link,m,units,stockQty:link?units*link.unitFactor:0,perStock,error,below:Boolean(link&&link.moq>0&&units>0&&units<link.moq)}
  })
  const anyBelow=rows.some(r=>r.below)
  const hasErrors=rows.some(r=>r.error)||!rows.length||(anyBelow&&!belowMoq)
  const total=rows.reduce((a,r)=>a+r.stockQty*r.perStock,0)
  // Without the approve right, or above the dual-approval amount, a PO starts as a draft that someone else approves (A-M6).
  const draftOnly=!app.can('purchases','approve')?'Tasdiqlash huquqingiz yo‘q — qoralama sifatida saqlanadi':needsSecondApprover(s,Math.round(total))?'Ikki kishilik tasdiq: boshqa xodim tasdiqlaydi':''
  const setLine=(i:number,patch:Partial<Line>)=>setLines(x=>x.map((y,j)=>j===i?{...y,...patch}:y))
  const submit=()=>{
    setSubmitted(true)
    if(hasErrors)return
    const payload=rows.map(x=>({materialId:x.link!.materialId,qty:x.stockQty,price:Math.round(x.perStock*100)/100}))
    const r=po
      ?app.updatePurchaseDraft(po.id,{lines:payload,expectedDate,warehouseId,allowBelowMoq:belowMoq})
      :app.createPurchaseOrder({supplierId:sid,lines:payload,expectedDate,warehouseId,status:draft||draftOnly?'Qoralama':'Tasdiqlangan',allowBelowMoq:belowMoq})
    if(r.ok){onCreated?.(r.id!);onClose()}
  }
  return <Modal open onClose={onClose} title={po?`${po.code} — qoralamani tahrirlash`:'Yangi Purchase Order'} subtitle={po?'Qatorlar, ombor va sana tasdiqlanguncha o‘zgaradi':'Faqat supplierga biriktirilgan materiallar · tasdiqlangan PO “yo‘lda” bo‘ladi'} size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><span className="spacer"/><span className="soft-meta">Jami: <b>{money(total)}</b></span><button type="button" className="primary-glass-btn" disabled={!links.length} onClick={submit}><Icon name="check" size={16}/>{po?'Saqlash':draft?'Qoralama saqlash':'Yaratish va tasdiqlash'}</button></>}>
    <div className="form-stack">
      <div className="form-grid">
        <Field label="Supplier" required><Select value={sid} disabled={Boolean(po)} onChange={changeSupplier}>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name} · {orderable(x.id).length} material</option>)}</Select></Field>
        <Field label="Expected date" hint={lines.length?`Lead time ${lead(lines)} kun`:undefined}><Input type="date" value={expectedDate} onChange={e=>setExpectedDate(e.target.value)}/></Field>
        <Field label="Qabul ombori"><Select value={warehouseId} onChange={setWarehouseId}>{rawStores(s).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      </div>
      {links.length?<section className="editor-section">
        <div className="editor-head"><h4>Qatorlar</h4><button type="button" className="secondary-glass-btn compact" disabled={lines.length>=links.length} onClick={()=>setLines(x=>[...x,lineFor(links.find(l=>!x.some(y=>y.linkId===l.id)))])}><Icon name="plus" size={14}/>Qator</button></div>
        <div className="table-scroll"><table className="fit editor-table"><thead><tr><th>Material</th><th className="align-right">Miqdor</th><th className="align-right">Narx</th><th className="align-right">Summa</th><th/></tr></thead><tbody>{rows.map((r,i)=><tr key={i} className={submitted&&r.error?'row-danger':undefined}>
          <td className="wide-cell"><Select value={r.l.linkId} onChange={v=>{const l=links.find(x=>x.id===v);setLine(i,lineFor(l))}} ariaLabel={`Material ${i+1}`}>{links.map(x=><option key={x.id} value={x.id}>{s.rawMaterials.find(m=>m.id===x.materialId)?.name}{x.supplierSku?` · ${x.supplierSku}`:''}</option>)}</Select>{r.link&&<small className="cell-sub">{quoteText(r.link)}{r.link.moq?` · MOQ ${num(r.link.moq,3)}`:''}{conversionText(r.link,r.m?.unit||'')?` · ${conversionText(r.link,r.m?.unit||'')}`:''}</small>}</td>
          <td className="align-right"><span className="unit-input"><input className="ui-input cell-input" type="number" min="0" step={r.link&&r.link.unitFactor!==1?'1':'any'} aria-label="Miqdor" value={r.l.units} onChange={e=>setLine(i,{units:e.target.value})}/><small>{r.link?.purchaseUnit}</small></span>{r.link&&r.link.unitFactor!==1&&<small className="cell-sub">= {qty(r.stockQty,r.m?.unit)}</small>}</td>
          <td className="align-right"><span className="unit-input"><input className="ui-input cell-input" type="number" min="0" step="any" aria-label="Narx" value={r.l.price} onChange={e=>setLine(i,{price:e.target.value})}/><small>{r.link?CURRENCIES[r.link.currency].symbol:''}</small></span></td>
          <td className="align-right">{money(r.stockQty*r.perStock)}{r.below&&<small className="cell-sub warning-text">MOQ’dan kam</small>}</td>
          <td className="align-right"><button type="button" className="icon-ghost danger" disabled={lines.length<2} aria-label="Qatorni o‘chirish" onClick={()=>setLines(x=>x.filter((_,j)=>j!==i))}><Icon name="trash" size={15}/></button></td>
        </tr>)}</tbody></table></div>
        {submitted&&rows.some(r=>r.error)&&<small className="field-error">Har bir qatorda material, musbat (butun xarid birligidagi) miqdor va narx bo‘lishi kerak; material takrorlanmasin.</small>}
      </section>:<Empty compact icon="truck" title="Bu supplierga faol material biriktirilmagan" text="Supplier → Materiallar bo‘limida material biriktiring yoki boshqa supplier tanlang."/>}
      {anyBelow&&<div className="inline-note warning"><Icon name="warning"/><span>Ba’zi qatorlar MOQ’dan kam.<Checkbox checked={belowMoq} onChange={setBelowMoq} label="Supplier bilan kelishilgan — MOQ’dan kam buyurtma"/></span></div>}
      {!po&&<Checkbox checked={draft||Boolean(draftOnly)} disabled={Boolean(draftOnly)} onChange={setDraft} label="Qoralama (RFQ)" description={draftOnly||'Tasdiqlanmaguncha incoming’ga qo‘shilmaydi'}/>}
    </div>
  </Modal>
}

function rawStores(s:ReturnType<typeof useApp>['state']){
  return s.warehouses.filter(w=>w.status==='Faol'&&(w.type==='Raw'||w.type==='Mixed'))
}

/** Receipt state: stock is usable only once incoming QC (if any) has passed; rejected units wait for return / scrap. */
function receiptStatus(s:ReturnType<typeof useApp>['state'],po:PurchaseOrder,r:PurchaseOrder['receipts'][number]):{label:string;tone:'success'|'warning'|'danger'|'neutral'}{
  const q=receiptQuantities(s,po,r),open=rejectedOpen(s,po,r)
  if(q.inspection==='pending')return {label:'QC kutilmoqda',tone:'warning'}
  if(q.inspection==='none'||q.inspection==='accepted')return {label:'Omborda',tone:'success'}
  if(open>0)return {label:q.inspection==='partial'?'Qisman rad · qaror kutilmoqda':'Rad · qaror kutilmoqda',tone:'danger'}
  return {label:q.returned>0?'Rad etilgan qism qaytarildi':'Rad etilgan qism yopildi',tone:'neutral'}
}

function PurchaseDrawer({poId,onClose}:{poId:string|null;onClose:()=>void}){
  const app=useApp()
  const po=app.state.purchaseOrders.find(p=>p.id===poId)
  if(!po)return null
  return <PurchaseDrawerBody key={po.id} po={po} onClose={onClose}/>
}

/** BUG-09: a partially received PO whose rest will not come is closed, so its incoming stops misleading MRP. */
function CloseRestModal({po,onClose}:{po:PurchaseOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({reason:''},v=>({reason:required(v.reason,'Sabab')}))
  const open=po.items.filter(i=>i.qty-i.received>1e-9)
  return <Modal open onClose={onClose} title={`${po.code}: qoldiqni yopish`} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" onClick={()=>form.submit(v=>{const r=app.closePurchaseShort(po.id,v.reason);if(r.ok)onClose();return r.ok})}>Qoldiqni yopish</button></>}>
    <div className="form-stack">
      <p className="soft-meta">Qabul qilingan miqdor qoladi. Kelmaydigan qism “yo‘lda” hisobidan chiqariladi va PO yakunlanadi.</p>
      <div className="stack-list">{open.map(i=>{const m=s.rawMaterials.find(x=>x.id===i.materialId);return <div className="list-row" key={i.materialId}><span className="list-row-copy"><b>{m?.name}</b><small>qabul {num(i.received,1)} / {num(i.qty,1)}</small></span><b className="num">{qty(i.qty-i.received,m?.unit)}</b></div>})}</div>
      <Field label="Sabab" required error={form.error('reason')}><Input {...form.input('reason')} autoFocus placeholder="Masalan: supplier qolganini yetkaza olmaydi"/></Field>
    </div>
  </Modal>
}

function PurchaseDrawerBody({po,onClose}:{po:PurchaseOrder;onClose:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState('lines'),[cancel,setCancel]=useState(false),[closeRest,setCloseRest]=useState(false),[edit,setEdit]=useState(false),[check,setCheck]=useState<string|null>(null)
  const canEdit=app.can('purchases','edit')
  const receivable=['Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(po.status)
  const checks=s.qualityChecks.filter(q=>q.sourceType==='purchase'&&q.sourceId===po.id)
  const late=OPEN_PO.includes(po.status)&&po.status!=='Qoralama'&&po.expectedDate<todayISO()
  return <Drawer open onClose={onClose} title={po.code} eyebrow="Purchase order" icon="cart" size="lg" subtitle={`${supplierName(s,po.supplierId)} · ${warehouseName(s,po.warehouseId)} · expected ${po.expectedDate}`}
    headerExtra={<><StatusBadge>{po.status}</StatusBadge>{late&&<StatusBadge tone="danger">Kechikmoqda</StatusBadge>}<StatusBadge>{po.paymentStatus}</StatusBadge>{po.source&&<span className="chip">{po.source}</span>}</>}
    actions={<>
      {canEdit&&!['Bekor','Qabul qilindi'].includes(po.status)&&!po.items.some(i=>i.received>0)&&<button type="button" className="ghost-btn" onClick={()=>setCancel(true)}><Icon name="x" size={15}/>Bekor qilish</button>}
      {canEdit&&receivable&&po.items.some(i=>i.received>0)&&<button type="button" className="ghost-btn" onClick={()=>setCloseRest(true)}><Icon name="x" size={15}/>Qoldiqni yopish</button>}
      <span className="spacer"/>
      {po.status==='Qoralama'&&canEdit&&<button type="button" className="secondary-glass-btn" onClick={()=>setEdit(true)}><Icon name="edit" size={15}/>Tahrirlash</button>}
      {po.status==='Qoralama'&&app.can('purchases','approve')&&<button type="button" className="primary-glass-btn" disabled={po.createdBy===app.currentEmployee.id&&needsSecondApprover(app.state,po.total)} title={po.createdBy===app.currentEmployee.id&&needsSecondApprover(app.state,po.total)?'Ikki kishilik tasdiq: o‘zingiz yaratgan PO’ni boshqa xodim tasdiqlaydi':undefined} onClick={()=>app.confirmPurchase(po.id)}><Icon name="check" size={16}/>Tasdiqlash</button>}
      {po.status==='Tasdiqlangan'&&canEdit&&<button type="button" className="secondary-glass-btn" onClick={()=>app.markPurchaseInTransit(po.id)}><Icon name="truck" size={16}/>Yo‘lda</button>}
      {receivable&&(canEdit||app.can('warehouse','edit'))&&<button type="button" className="primary-glass-btn" onClick={()=>navigate(`/purchases?view=receiving&po=${po.id}`)}><Icon name="download" size={16}/>Qabul qilish</button>}
    </>}>
    <Tabs items={[{value:'lines',label:'Qatorlar',count:po.items.length},{value:'receipts',label:'Qabullar',count:po.receipts.length},{value:'finance',label:'Invoice / to‘lov'},{value:'quality',label:'Sifat',count:checks.length},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {po.closedShort&&<div className="inline-note warning"><Icon name="info"/><span>Qoldiq yopilgan ({po.closedShort.date}): {po.closedShort.open} · {po.closedShort.reason}</span></div>}
    {(po.productionOrderIds||[]).length>0&&<div className="inline-note"><Icon name="factory"/><span>Ishlab chiqarish uchun: {(po.productionOrderIds||[]).map((id,i)=>{const o=s.productionOrders.find(x=>x.id===id);return o?<span key={id}>{i?', ':''}<button type="button" className="link-btn" onClick={()=>navigate(`/production?view=orders&id=${id}`)}>{o.code}</button> <small className="muted">({o.status})</small></span>:null})}</span></div>}
    {tab==='lines'&&<div className="table-scroll"><table className="fit"><thead><tr><th>Material</th><th className="align-right">Buyurtma</th><th className="align-right">Qabul</th><th className="align-right">Qolgan</th><th className="align-right">Narx</th><th className="align-right">Summa</th><th>Progress</th></tr></thead><tbody>{po.items.map(i=>{const m=s.rawMaterials.find(x=>x.id===i.materialId);const conv=i.purchaseUnit&&i.unitFactor&&(i.purchaseUnit!==m?.unit||i.unitFactor!==1);return <tr key={i.materialId}><td><div className="cell-main"><b>{m?.name}</b><small>{m?.sku}{conv?` · ${num(i.qty/i.unitFactor!,3)} ${i.purchaseUnit} × ${num(i.unitFactor!,3)} ${m?.unit}`:''}</small></div></td><td className="align-right">{qty(i.qty,m?.unit)}</td><td className="align-right">{num(i.received,1)}</td><td className="align-right">{i.qty-i.received>0?<b>{num(i.qty-i.received,1)}</b>:<span className="muted">—</span>}</td><td className="align-right"><div className="cell-main"><b>{money(i.price)}/{m?.unit}</b>{i.currency&&i.currency!=='UZS'&&i.unitPrice!==undefined&&<small>{quoteMoney(i.unitPrice,i.currency)}/{i.purchaseUnit}</small>}</div></td><td className="align-right">{money(i.qty*i.price)}</td><td><div className="progress-cell"><Progress value={i.received/Math.max(1e-9,i.qty)*100}/><small>{Math.round(i.received/Math.max(1e-9,i.qty)*100)}%</small></div></td></tr>})}<tr className="total"><td>Jami</td><td/><td/><td/><td/><td className="align-right">{money(po.total)}</td><td/></tr></tbody></table></div>}
    {tab==='receipts'&&(po.receipts.length?<div className="table-scroll"><table className="fit"><thead><tr><th>Qabul</th><th className="align-right">Qabul qilingan</th><th className="align-right">Omborga</th><th className="align-right">Rad</th><th className="align-right">Qaytarilgan / scrap</th><th>Holat</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>{po.receipts.map(r=>{
      const st=receiptStatus(s,po,r),q=receiptQuantities(s,po,r),unit=s.rawMaterials.find(m=>m.id===r.materialId)?.unit
      return <tr key={r.id}>
        <td><div className="cell-main"><b>{materialName(s,r.materialId)}</b><small>{r.date} · {warehouseName(s,r.warehouseId||po.warehouseId)}{r.location?` / ${r.location}`:''}{r.lot?` · ${r.lot}`:''}{r.supplierLot?` · supplier lot ${r.supplierLot}`:''}{r.receivedBy?` · ${employeeName(s,r.receivedBy)}`:''}</small></div></td>
        <td className="align-right">{qty(r.qty,unit)}</td>
        <td className="align-right">{q.inspection==='pending'?<span className="muted">—</span>:num(q.accepted,3)}</td>
        <td className="align-right">{q.rejected?<span className="negative">{num(q.rejected,3)}</span>:<span className="muted">—</span>}</td>
        <td className="align-right">{q.returned||q.scrapped?`${num(q.returned,3)} / ${num(q.scrapped,3)}`:<span className="muted">—</span>}</td>
        <td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
        <td className="align-right"><span className="badge-row">{q.check&&<button type="button" className="ghost-btn" onClick={()=>setCheck(q.check!.id)}>{q.check.status==='Pending'?'Tekshirish':'QC'}</button>}{r.lot&&<button type="button" className="ghost-btn" onClick={()=>navigate(`/reports?view=traceability&q=${encodeURIComponent(r.lot)}`)}>Trace</button>}</span></td>
      </tr>})}</tbody></table></div>:<Empty compact title="Hali qabul qilinmagan"/>)}
    {tab==='finance'&&<div className="form-grid">
      <Field label="Invoice holati"><Select value={po.invoiceStatus} disabled={!canEdit} onChange={v=>app.updatePurchaseMeta(po.id,{invoiceStatus:v})}>{['Kutilmoqda','Qabul qilindi','Tekshirildi','Yo‘q'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="To‘lov holati"><Select value={po.paymentStatus} disabled={!canEdit} onChange={v=>app.updatePurchaseMeta(po.id,{paymentStatus:v})}>{['To‘lanmagan','Qisman','To‘langan'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <InfoGrid items={[{label:'PO summasi',value:money(po.total)},{label:'Qabul qilingan qiymat',value:money(po.items.reduce((a,i)=>a+i.received*i.price,0))},{label:'Supplier qarzi',value:money(s.suppliers.find(x=>x.id===po.supplierId)?.debt||0)}]}/>
    </div>}
    {tab==='quality'&&(checks.length?<div className="stack-list">{checks.map(q=><button type="button" className="list-row is-clickable" key={q.id} onClick={()=>setCheck(q.id)}><span className="list-row-copy"><b>{materialName(s,q.itemId)}{q.lot?` · ${q.lot}`:''}</b><small>{q.date}{q.acceptedQty!==undefined?` · ${num(q.acceptedQty,3)} qabul / ${num(q.rejectedQty||0,3)} rad`:''}{q.reason?` · ${q.reason}`:''}</small></span><StatusBadge>{q.status}</StatusBadge></button>)}</div>:<Empty compact title="Incoming tekshiruv yo‘q"/>)}
    {tab==='docs'&&<AttachmentsPanel entityType="purchase" entityId={po.id} canEdit={canEdit}/>}
    {tab==='history'&&<ActivityPanel sources={[po.code]}/>}
    {closeRest&&<CloseRestModal po={po} onClose={()=>setCloseRest(false)}/>}
    {edit&&<PurchaseFormModal po={po} onClose={()=>setEdit(false)}/>}
    <QualityResolveModal checkId={check} onClose={()=>setCheck(null)}/>
    <Confirm open={cancel} onClose={()=>setCancel(false)} onConfirm={()=>app.cancelPurchase(po.id)} danger title={`${po.code} bekor qilinsinmi?`} text="Incoming miqdor zaxiradan olib tashlanadi." confirmText="PO’ni bekor qilish"/>
  </Drawer>
}

/** Only in-app paths may be returned to (no external or protocol-relative URLs). */
const safeReturn=(path:string)=>path.startsWith('/')&&!path.startsWith('//')?path:''

function Suppliers(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[material,setMaterial]=useSearchParamState('material')
  const [id,setId]=useRecordParam()
  // ?create=1&returnTo=… — opened from another form (e.g. a raw material): create here, then go back to it.
  const [createParam]=useSearchParamState('create'),[returnParam]=useSearchParamState('returnTo')
  const returnTo=safeReturn(returnParam)
  const [edit,setEdit]=useState<Supplier|null|'new'>(()=>createParam==='1'&&app.can('purchases','create')?'new':null)
  const created=useRef('')
  const closeEdit=()=>{
    if(edit==='new'&&returnTo){const back=new URL(returnTo,window.location.origin);if(created.current)back.searchParams.set('supplier',created.current);navigate(back.pathname+back.search,{replace:true});return}
    setEdit(null)
    if(createParam||returnParam)navigate('/purchases?view=suppliers'+(created.current?`&id=${created.current}`:''),{replace:true})
  }
  const rows=s.suppliers.filter(x=>(!status||x.status===status)&&(!material||linksOfSupplier(s,x.id).some(l=>l.materialId===material)))
  const supplier=s.suppliers.find(x=>x.id===id)
  const materialsText=(sid:string)=>linksOfSupplier(s,sid).map(l=>s.rawMaterials.find(m=>m.id===l.materialId)?.name).filter(Boolean).join(', ')
  return <div className="page-stack">
    <PageHeader title="Yetkazib beruvchilar" subtitle="Qaysi materialni kim, qanday narx, MOQ va muddatda yetkazadi" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('purchases','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Supplier qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Nomi, telefon, material..." onRow={x=>setId(x.id)} exportName="suppliers" resetKey={`${status}|${material}`}
      filters={<><FilterSelect label="Status" value={status} onChange={setStatus} options={['Faol','Arxiv']}/><FilterSelect label="Material" value={material} onChange={setMaterial} options={s.rawMaterials.map(m=>({value:m.id,label:m.name}))}/></>} filtersActive={Boolean(status||material)} onResetFilters={()=>{setStatus('');setMaterial('')}}
      columns={[
        {key:'name',label:'Supplier',value:x=>x.name,render:x=><div className="cell-main"><b>{x.name}</b><small>{x.phone}{x.email?` · ${x.email}`:''}</small></div>},
        {key:'status',label:'Status',value:x=>x.status,render:x=><StatusBadge>{x.status}</StatusBadge>},
        {key:'materials',label:'Materiallar',value:x=>materialsText(x.id),render:x=>{const links=linksOfSupplier(s,x.id);return links.length?<div className="cell-main"><b>{links.filter(l=>!linkBlock(s,l)).length} faol</b><small title={materialsText(x.id)}>{materialsText(x.id)}</small></div>:<span className="negative">Biriktirilmagan</span>}},
        {key:'ontime',label:'Vaqtida',align:'right',value:x=>supplierPerformance(s,x.id).onTimePct??-1,render:x=>{const v=supplierPerformance(s,x.id).onTimePct;return v===null?'—':`${v}%`}},
        {key:'quality',label:'Sifat',align:'right',value:x=>supplierPerformance(s,x.id).qualityPct??-1,render:x=>{const v=supplierPerformance(s,x.id).qualityPct;return v===null?'—':`${v}%`},priority:'low'},
        {key:'lead',label:'Lead time',align:'right',value:x=>x.leadTime,render:x=>`${x.leadTime} kun`,priority:'low'},
        {key:'spend',label:'Xarid hajmi',align:'right',value:x=>supplierPerformance(s,x.id).spend,render:x=>compactMoney(supplierPerformance(s,x.id).spend),priority:'low'},
        {key:'debt',label:'Qarz',align:'right',value:x=>x.debt,render:x=>money(x.debt)},
      ]}/>
    {returnTo&&!edit&&<div className="inline-note"><Icon name="info"/><span>Xomashyo formasidan keldingiz.</span><button type="button" className="link-btn" onClick={()=>navigate(returnTo,{replace:true})}>Formaga qaytish</button></div>}
    {edit&&<SupplierModal supplier={edit==='new'?undefined:edit} subtitle={edit==='new'&&returnTo?'Saqlangach xomashyo formasiga qaytasiz va supplier tanlangan bo‘ladi':undefined} onClose={closeEdit} onSaved={v=>{if(edit!=='new')return;created.current=v;if(!returnTo&&!createParam)setId(v)}}/>}
    {supplier&&<SupplierDrawer key={supplier.id} supplier={supplier} onClose={()=>setId(null)} onEdit={()=>setEdit(supplier)}/>}
  </div>
}

type LinkRow={id?:string;materialId:string;supplierSku:string;price:string;currency:CurrencyCode;purchaseUnit:string;unitFactor:string;moq:string;leadTime:string;active:boolean}

/** Supplier card and the materials it supplies, saved together (one action, all or nothing). */
function SupplierModal({supplier,subtitle,onClose,onSaved}:{supplier?:Supplier;subtitle?:string;onClose:()=>void;onSaved?:(id:string)=>void}){
  const app=useApp(),s=app.state
  const form=useForm({name:supplier?.name||'',phone:supplier?.phone||'+998 ',email:supplier?.email||'',leadTime:String(supplier?.leadTime??3),rating:String(supplier?.rating??5),status:supplier?.status||'Faol'},v=>({name:required(v.name,'Nomi')||(s.suppliers.some(x=>x.id!==supplier?.id&&x.name.toLowerCase()===v.name.trim().toLowerCase())?'Bu nom band':undefined),phone:/\d{7,}/.test(v.phone.replace(/\D/g,''))?undefined:'Telefon raqamini to‘liq kiriting',email:v.email&&!/^\S+@\S+\.\S+$/.test(v.email)?'Email noto‘g‘ri':undefined,leadTime:Number(v.leadTime)>=0?undefined:'Lead time noto‘g‘ri'}))
  const [links,setLinks]=useState<LinkRow[]>(()=>supplier?linksOfSupplier(s,supplier.id).map(l=>({id:l.id,materialId:l.materialId,supplierSku:l.supplierSku,price:String(l.price),currency:l.currency,purchaseUnit:l.purchaseUnit,unitFactor:String(l.unitFactor),moq:String(l.moq),leadTime:String(l.leadTime),active:l.active})):[])
  const [submitted,setSubmitted]=useState(false)
  const unitOf=(mid:string)=>s.rawMaterials.find(m=>m.id===mid)?.unit||''
  const free=s.rawMaterials.filter(m=>m.status!=='Arxiv'&&!links.some(l=>l.materialId===m.id))
  const add=()=>{const m=free[0];if(m)setLinks(x=>[...x,{materialId:m.id,supplierSku:'',price:'',currency:'UZS',purchaseUnit:m.unit,unitFactor:'1',moq:'0',leadTime:form.values.leadTime||'0',active:true}])}
  const setLink=(i:number,patch:Partial<LinkRow>)=>setLinks(x=>x.map((y,j)=>j===i?{...y,...patch}:y))
  const rowError=(l:LinkRow)=>!l.materialId?'Material':l.price===''||!(Number(l.price)>=0)?'Narx':!l.purchaseUnit.trim()?'Birlik':!(Number(l.unitFactor)>0)?'Konversiya':l.purchaseUnit.trim()===unitOf(l.materialId)&&Number(l.unitFactor)!==1?'Konversiya 1':!(Number(l.moq)>=0)?'MOQ':!(Number(l.leadTime)>=0)?'Lead':links.filter(x=>x.materialId===l.materialId).length>1?'Takror':undefined
  const removable=(l:LinkRow)=>!supplier||!l.id||!s.purchaseOrders.some(p=>p.supplierId===supplier.id&&['Qoralama','Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(p.status)&&p.items.some(i=>i.materialId===l.materialId&&i.received<i.qty))
  const submit=()=>{
    setSubmitted(true)
    if(links.some(rowError))return
    form.submit(v=>{
      const r=app.saveSupplier({id:supplier?.id,supplier:{name:v.name,phone:v.phone,email:v.email,leadTime:Number(v.leadTime),rating:Number(v.rating),status:v.status},links:links.map(l=>({id:l.id,materialId:l.materialId,supplierSku:l.supplierSku,price:Number(l.price),currency:l.currency,purchaseUnit:l.purchaseUnit,unitFactor:Number(l.unitFactor),moq:Number(l.moq),leadTime:Number(l.leadTime),active:l.active}))})
      if(r.ok){onSaved?.(r.id!);onClose()}
      return r.ok
    })
  }
  return <Modal open onClose={onClose} title={supplier?'Supplierni tahrirlash':'Yangi supplier'} subtitle={subtitle||'Yetkazadigan materiallar va shartlari bilan'} size="xl"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Saqlash</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Telefon" required error={form.error('phone')}><Input type="tel" {...form.input('phone')}/></Field>
      <Field label="Email" error={form.error('email')}><Input type="email" {...form.input('email')}/></Field>
      <Field label="Odatiy lead time (kun)" error={form.error('leadTime')} hint="Yangi material qatorlari uchun"><Input type="number" min="0" {...form.input('leadTime')}/></Field>
      <Field label="Status"><Select value={form.values.status} onChange={v=>form.set('status',v)}><option value="Faol">Faol</option><option value="Arxiv">Arxiv</option></Select></Field>
    </div>
    <section className="editor-section">
      <div className="editor-head"><h4>Yetkazadigan materiallar</h4><button type="button" className="secondary-glass-btn compact" disabled={!free.length} onClick={add}><Icon name="plus" size={14}/>Material</button></div>
      {links.length?<div className="table-scroll"><table className="fit editor-table link-editor"><thead><tr><th>Material</th><th>SKU</th><th className="align-right">Narx</th><th>Valyuta</th><th>Xarid birligi</th><th className="align-right">= ombor birligi</th><th className="align-right">MOQ</th><th className="align-right">Lead</th><th>Faol</th><th/></tr></thead><tbody>
        {links.map((l,i)=>{const err=submitted?rowError(l):undefined,stock=unitOf(l.materialId);return <tr key={l.id||`new-${i}`} className={err?'row-danger':undefined}>
          <td className="wide-cell"><Select value={l.materialId} disabled={Boolean(l.id)} onChange={v=>setLink(i,{materialId:v,purchaseUnit:unitOf(v),unitFactor:'1'})} ariaLabel={`Material ${i+1}`}>{s.rawMaterials.filter(m=>m.id===l.materialId||(m.status!=='Arxiv'&&!links.some(x=>x.materialId===m.id))).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</Select>{err&&<small className="cell-sub negative">{err}</small>}</td>
          <td><input className="ui-input cell-input wide" aria-label="Supplier SKU" value={l.supplierSku} placeholder="—" onChange={e=>setLink(i,{supplierSku:e.target.value})}/></td>
          <td className="align-right"><input className="ui-input cell-input" type="number" min="0" step="any" aria-label="Narx" value={l.price} onChange={e=>setLink(i,{price:e.target.value})}/></td>
          <td><Select size="sm" value={l.currency} onChange={v=>setLink(i,{currency:v as CurrencyCode})} ariaLabel="Valyuta">{SUPPLY_CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</Select></td>
          <td><input className="ui-input cell-input" list="supplier-units" aria-label="Xarid birligi" value={l.purchaseUnit} onChange={e=>setLink(i,{purchaseUnit:e.target.value})}/></td>
          <td className="align-right"><span className="unit-input"><input className="ui-input cell-input" type="number" min="0" step="any" aria-label="Konversiya" value={l.unitFactor} onChange={e=>setLink(i,{unitFactor:e.target.value})}/><small>{stock}</small></span></td>
          <td className="align-right"><input className="ui-input cell-input" type="number" min="0" step="any" aria-label="MOQ" value={l.moq} onChange={e=>setLink(i,{moq:e.target.value})}/></td>
          <td className="align-right"><input className="ui-input cell-input" type="number" min="0" step="1" aria-label="Lead time" value={l.leadTime} onChange={e=>setLink(i,{leadTime:e.target.value})}/></td>
          <td><Checkbox checked={l.active} onChange={v=>setLink(i,{active:v})} label={<span className="sr-only">Faol</span>}/></td>
          <td className="align-right"><button type="button" className="icon-ghost danger" disabled={!removable(l)} title={removable(l)?undefined:'Ochiq PO bor — o‘chirish o‘rniga nofaol qiling'} aria-label="Materialni olib tashlash" onClick={()=>setLinks(x=>x.filter((_,j)=>j!==i))}><Icon name="trash" size={15}/></button></td>
        </tr>})}
      </tbody></table></div>:<Empty compact icon="layers" title="Material biriktirilmagan" text="Supplier xarid tavsiyalarida faqat biriktirilgan materiallar uchun chiqadi."/>}
      <p className="soft-meta">Narx — xarid birligi uchun, supplier valyutasida. Konversiya: 1 xarid birligida nechta ombor birligi bor. MOQ — xarid birligida.</p>
      <datalist id="supplier-units">{['kg','t','dona','list','m','l','m²','quti','paket','rulon'].map(u=><option key={u} value={u}/>)}</datalist>
    </section>
  </Modal>
}

function SupplierDrawer({supplier,onClose,onEdit}:{supplier:Supplier;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState('materials'),[remove,setRemove]=useState(false),[po,setPo]=useState(false)
  const [linkEdit,setLinkEdit]=useState<SupplierMaterial|'new'|null>(null),[unlink,setUnlink]=useState<SupplierMaterial|null>(null),[buy,setBuy]=useState<SourcingNeed|null>(null)
  const perf=supplierPerformance(s,supplier.id)
  const pos=s.purchaseOrders.filter(p=>p.supplierId===supplier.id)
  const links=linksOfSupplier(s,supplier.id)
  const blocker=referenceBlocker(s,'suppliers',supplier.id)
  const canLink=app.can('purchases','edit')||app.can('materials','edit')
  return <Drawer open onClose={onClose} title={supplier.name} eyebrow="Yetkazib beruvchi" icon="truck" subtitle={`${supplier.phone}${supplier.email?` · ${supplier.email}`:''}`} size="xl" headerExtra={<StatusBadge>{supplier.status}</StatusBadge>}
    actions={<>{app.can('purchases','delete')&&<button type="button" className="ghost-btn" onClick={()=>setRemove(true)}><Icon name="trash" size={15}/>O‘chirish</button>}<span className="spacer"/>{app.can('purchases','create')&&supplier.status==='Faol'&&<button type="button" className="secondary-glass-btn" onClick={()=>setPo(true)}><Icon name="cart" size={15}/>Yangi PO</button>}{app.can('purchases','edit')&&<button type="button" className="primary-glass-btn" onClick={onEdit}><Icon name="edit" size={16}/>Tahrirlash</button>}</>}>
    <Tabs items={[{value:'materials',label:'Materiallar',count:links.length},{value:'orders',label:'Purchase Orders',count:pos.length},{value:'history',label:'Xarid tarixi'},{value:'overview',label:'Ko‘rsatkichlar'},{value:'docs',label:'Hujjatlar'}]} active={tab} onChange={setTab}/>
    {tab==='materials'&&<div className="stack-list">
      {supplier.status!=='Faol'&&<div className="inline-note warning"><Icon name="warning"/>Supplier nofaol — uning materiallari xarid tavsiyalarida va yangi PO’da qatnashmaydi.</div>}
      {links.length?<LinkTermsTable links={links} side="supplier" onEdit={canLink?l=>setLinkEdit(l):undefined} onRemove={canLink?l=>setUnlink(l):undefined} onBuy={app.can('purchases','create')?l=>setBuy({materialId:l.materialId,need:0,source:supplier.name}):undefined}/>:<Empty compact icon="layers" title="Material biriktirilmagan" text="Biriktirilgan materiallar MO yetishmovchiligida shu supplierni taklif qiladi."/>}
      {canLink&&<div className="row-actions"><button type="button" className="secondary-glass-btn compact" onClick={()=>setLinkEdit('new')}><Icon name="plus" size={14}/>Material biriktirish</button></div>}
    </div>}
    {tab==='overview'&&<>
      <InfoGrid items={[
        {label:'Vaqtida yetkazish',value:perf.onTimePct===null?'Ma’lumot yo‘q':`${perf.onTimePct}% · ${perf.dueLines} qator`,tone:perf.onTimePct!==null&&perf.onTimePct<80?'warning':undefined},
        {label:'O‘rtacha lead time (amalda)',value:perf.avgLead===null?'Ma’lumot yo‘q':`${perf.avgLead} kun`},
        {label:'Rad etish ulushi',value:perf.rejectionPct===null?'Ma’lumot yo‘q':`${perf.rejectionPct}% · ${num(perf.rejectedQty,1)} / ${num(perf.inspectedQty,1)}`,tone:perf.rejectionPct!==null&&perf.rejectionPct>5?'danger':undefined},
        {label:'Narx farqi (standartga)',value:perf.priceVariancePct===null?'Ma’lumot yo‘q':`${perf.priceVariancePct>0?'+':''}${perf.priceVariancePct}%`,tone:perf.priceVariancePct!==null&&perf.priceVariancePct>5?'warning':undefined},
        {label:'Bajarilish darajasi',value:perf.fulfillmentPct===null?'Ma’lumot yo‘q':`${perf.fulfillmentPct}%`,tone:perf.fulfillmentPct!==null&&perf.fulfillmentPct<95?'warning':undefined},
        {label:'Xarid hajmi',value:money(perf.spend)},{label:'Ochiq PO qiymati',value:money(perf.openValue)},{label:'Qarz',value:money(supplier.debt)},{label:'Faol materiallar',value:`${links.filter(l=>!linkBlock(s,l)).length} / ${links.length}`}]}/>
      {perf.missing.length>0&&<div className="inline-note"><Icon name="info"/><span>{perf.missing.join(' · ')}</span></div>}
      <p className="soft-meta">Ko‘rsatkichlar faqat qayd etilgan PO, qabul va kirish tekshiruvlaridan hisoblanadi; reja lead time: {supplier.leadTime} kun.</p>
    </>}
    {tab==='history'&&<SupplierHistory supplierId={supplier.id}/>}
    {tab==='orders'&&(pos.length?<div className="stack-list">{pos.map(p=><button type="button" className="list-row is-clickable" key={p.id} onClick={()=>navigate(`/purchases?view=orders&id=${p.id}`)}><span className="list-row-copy"><b>{p.code}</b><small>{p.items.map(i=>`${materialName(s,i.materialId)} ${num(i.qty)}`).join(', ')} · {p.createdAt} → {p.expectedDate}{p.receivedAt?` · qabul ${p.receivedAt.slice(0,10)}`:''}</small></span><span className="list-row-meta"><b>{money(p.total)}</b><StatusBadge>{p.status}</StatusBadge></span></button>)}</div>:<Empty compact title="PO yo‘q"/>)}
    {tab==='docs'&&<AttachmentsPanel entityType="supplier" entityId={supplier.id} canEdit={app.can('purchases','edit')}/>}
    {po&&<PurchaseFormModal supplierId={supplier.id} onClose={()=>setPo(false)}/>}
    {linkEdit&&<SupplierMaterialModal link={linkEdit==='new'?undefined:linkEdit} supplierId={supplier.id} onClose={()=>setLinkEdit(null)}/>}
    {buy&&<SourcingModal need={buy} onClose={()=>setBuy(null)}/>}
    <Confirm open={Boolean(unlink)} onClose={()=>setUnlink(null)} onConfirm={()=>{if(unlink)app.removeSupplierMaterial(unlink.id)}} danger title="Material aloqasi o‘chirilsinmi?" text={unlink?`${supplier.name} → ${materialName(s,unlink.materialId)}. Ochiq PO bo‘lsa o‘chirilmaydi — nofaol qiling. PO tarixi saqlanadi.`:''} confirmText="Aloqani o‘chirish"/>
    <Confirm open={remove} onClose={()=>setRemove(false)} onConfirm={()=>{if(app.deleteEntity('suppliers',supplier.id).ok)onClose()}} danger title="Supplier o‘chirilsinmi?" text={blocker?`O‘chirib bo‘lmaydi: ${blocker}. Status’ni “Arxiv” qiling.`:'Supplier va uning material aloqalari butunlay o‘chiriladi.'} confirmText="O‘chirish"/>
  </Drawer>
}

/** Every PO line placed with the supplier, with what arrived, was accepted, rejected and returned. */
function SupplierHistory({supplierId}:{supplierId:string}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const rows=supplierPurchaseHistory(s,supplierId)
  if(!rows.length)return <Empty compact title="Xarid tarixi yo‘q"/>
  return <div className="table-scroll"><table className="fit is-interactive"><thead><tr><th>PO</th><th>Material</th><th className="align-right">Buyurtma</th><th className="align-right">Narx</th><th className="align-right">Qabul</th><th className="align-right">Rad / qaytarilgan</th><th>Status</th></tr></thead><tbody>
    {rows.map(r=>{const m=s.rawMaterials.find(x=>x.id===r.line.materialId);return <tr key={`${r.po.id}-${r.line.materialId}`} tabIndex={0} onClick={()=>navigate(`/purchases?view=orders&id=${r.po.id}`)} onKeyDown={e=>{if(e.key==='Enter')navigate(`/purchases?view=orders&id=${r.po.id}`)}}>
      <td><div className="cell-main"><b>{r.po.code}</b><small>{r.date}{r.lastReceipt?` → ${r.lastReceipt.slice(0,10)}`:''} · exp {r.po.expectedDate}</small></div></td>
      <td>{m?.name}</td>
      <td className="align-right">{qty(r.line.qty,m?.unit)}</td>
      <td className="align-right">{money(r.line.price)}</td>
      <td className="align-right">{num(r.line.received,3)}</td>
      <td className="align-right">{r.rejected||r.returned?`${num(r.rejected,3)} / ${num(r.returned,3)}`:<span className="muted">—</span>}</td>
      <td><StatusBadge>{r.po.status}</StatusBadge></td>
    </tr>})}
  </tbody></table></div>
}

function Receiving(){
  const app=useApp(),s=app.state
  const receivable=s.purchaseOrders.filter(p=>['Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(p.status))
  const [poId,setPoId]=useSearchParamState('po',receivable[0]?.id||'')
  const po=receivable.find(p=>p.id===poId)||receivable[0]
  return <div className="page-stack">
    <PageHeader title="Qabul qilish" subtitle="Qisman yoki to‘liq · incoming QC bo‘lsa avval quarantine, Passed bo‘lgach available"/>
    {po?<Card>
      <div className="receiving-head"><Field label="Purchase Order"><Select value={po.id} onChange={setPoId}>{receivable.map(p=><option value={p.id} key={p.id}>{p.code} · {supplierName(s,p.supplierId)} · {p.status}</option>)}</Select></Field><InfoGrid columns={3} items={[{label:'Ombor',value:warehouseName(s,po.warehouseId)},{label:'Expected',value:po.expectedDate,tone:po.expectedDate<todayISO()?'danger':undefined},{label:'Status',value:<StatusBadge>{po.status}</StatusBadge>}]}/></div>
      <div className="receive-lines">{po.items.map(item=><ReceiveLine key={`${po.id}-${item.materialId}-${item.received}`} po={po} item={item}/>)}</div>
    </Card>:<Card><Empty icon="check" title="Qabul qilinadigan PO yo‘q" text="Tasdiqlangan yoki yo‘ldagi PO shu yerda ko‘rinadi"/></Card>}
  </div>
}

function ReceiveLine({po,item}:{po:PurchaseOrder;item:PurchaseOrder['items'][number]}){
  const app=useApp(),s=app.state
  const m=s.rawMaterials.find(x=>x.id===item.materialId)
  const remaining=Math.round((item.qty-item.received)*1000)/1000
  const [amount,setAmount]=useState(String(remaining)),[lot,setLot]=useState(''),[supplierLot,setSupplierLot]=useState(''),[location,setLocation]=useState(''),[expiry,setExpiry]=useState(''),[warehouseId,setWarehouseId]=useState(po.warehouseId)
  const locations=s.warehouses.find(w=>w.id===warehouseId)?.locations||[]
  // One key per receipt form: a repeated submit of the same receipt is refused by the domain, never double-posted.
  const [key]=useState(()=>`${po.id}-${item.materialId}-${item.received}-${Date.now().toString(36)}`)
  const value=Number(amount)
  const error=remaining<=0?undefined:!(value>0)?'Miqdor kiriting':value>remaining?`Maksimum ${num(remaining,3)}`:undefined
  const expiryError=m?.expiryTracking&&!expiry?'Expiry sanasini kiriting':undefined
  const points=s.qualityControlPoints.filter(c=>c.active&&c.scope==='Incoming'&&(!c.productId||c.productId===item.materialId))
  const mandatory=points.some(c=>c.blocking)
  const needsQc=mandatory||(s.settings.policies.autoQualityChecks&&points.length>0)
  const conv=item.purchaseUnit&&item.unitFactor&&(item.purchaseUnit!==m?.unit||item.unitFactor!==1)
  const fields=3+(m?.lotTracking!==false?2:0)+(m?.expiryTracking?1:0)
  return <div className="receive-line receive-line-wh" style={{'--receive-fields':remaining>0?fields:0} as CSSProperties}>
    <div className="receive-copy"><b>{m?.name}</b><small>{m?.sku} · {num(item.received,3)}/{num(item.qty,3)} {m?.unit} · qolgan {num(remaining,3)}{conv?` · ${num(remaining/item.unitFactor!,3)} ${item.purchaseUnit}`:''}{needsQc?mandatory?' · majburiy kirish QC (karantin)':' · incoming QC':''}</small><Progress value={item.received/Math.max(1e-9,item.qty)*100}/></div>
    {remaining>0?<>
      <Field label={`Miqdor (${m?.unit||''})`} error={error}><Input type="number" min="0" step="any" max={remaining} value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
      <Field label="Ombor"><Select value={warehouseId} onChange={v=>{setWarehouseId(v);setLocation('')}}>{rawStores(s).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      <Field label="Joy"><Select value={location} onChange={setLocation}><option value="">—</option>{locations.map(l=><option key={l} value={l}>{l}</option>)}</Select></Field>
      {m?.lotTracking!==false&&<Field label="Supplier lot"><Input value={supplierLot} onChange={e=>setSupplierLot(e.target.value)} placeholder="Supplier hujjatidagi lot"/></Field>}
      {m?.lotTracking!==false&&<Field label="Ichki lot"><Input value={lot} onChange={e=>setLot(e.target.value)} placeholder="Bo‘sh — avtomatik" title="Bo‘sh qoldirilsa ichki lot raqami avtomatik beriladi"/></Field>}
      {m?.expiryTracking&&<Field label="Expiry" required error={expiryError}><Input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></Field>}
      <button type="button" className="primary-glass-btn receive-btn" disabled={Boolean(error||expiryError)||!(app.can('purchases','edit')||app.can('warehouse','edit'))} onClick={()=>app.receivePurchase(po.id,item.materialId,value,lot,expiry,{warehouseId,key,supplierLot,location})}><Icon name="download" size={16}/>{value<remaining?'Qisman qabul':'Qabul'}</button>
    </>:<StatusBadge tone="success">To‘liq qabul qilingan</StatusBadge>}
  </div>
}

function Subcontracting(){
  const app=useApp(),s=app.state
  const [create,setCreate]=useState(false)
  const next:Record<string,string>={'Draft':'Materialni yuborish','Material yuborildi':'Ishlab chiqarishda','Ishlab chiqarishda':'Qabul qilish'}
  return <div className="page-stack">
    <PageHeader title="Subcontracting" subtitle="Komponent yuborish → tashqi ishlab chiqarish → qabul"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('purchases','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Subcontract order</button>}/>
    {s.subcontractOrders.length?<div className="card flush"><div className="table-scroll"><table className="sub-table"><thead><tr><th>Buyurtma</th><th>Mahsulot</th><th className="align-right">Miqdor</th><th>Komponentlar</th><th className="align-right">Xizmat</th><th>Expected</th><th>Status</th><th className="align-right">Keyingi qadam</th></tr></thead><tbody>
      {s.subcontractOrders.map(o=>{const bom=activeBomFor(s,o.productId);return <tr key={o.id}>
        <td><div className="cell-main"><b>{o.code}</b><small>{supplierName(s,o.supplierId)}</small></div></td>
        <td>{productName(s,o.productId)}</td>
        <td className="align-right"><b>{num(o.qty)}</b></td>
        <td className="wrap"><span className="badge-row">{(bom?.components||[]).map(c=>{const need=perUnit(c)*o.qty,ok=stockOf(s,c.materialId).available>=need;return <span key={c.id} className={`chip ${ok?'':'chip-danger'}`} title={`available ${num(stockOf(s,c.materialId).available)}`}>{materialName(s,c.materialId)} · {qty(need,c.unit)}</span>})}</span></td>
        <td className="align-right">{compactMoney(o.cost)}</td>
        <td>{o.expectedDate}</td>
        <td><StatusBadge>{o.status}</StatusBadge></td>
        <td className="align-right">{next[o.status]?<button type="button" className="soft-glass-btn compact" disabled={!app.can('purchases','edit')} onClick={()=>app.advanceSubcontract(o.id)}>{next[o.status]}</button>:<StatusBadge tone="success">Yopilgan</StatusBadge>}</td>
      </tr>})}
    </tbody></table></div></div>:<Card><Empty title="Subcontract order yo‘q" action={<button type="button" className="primary-glass-btn compact" onClick={()=>setCreate(true)}>Yaratish</button>}/></Card>}
    {create&&<SubcontractModal onClose={()=>setCreate(false)}/>}
  </div>
}

function SubcontractModal({onClose}:{onClose:()=>void}){
  const app=useApp(),s=app.state
  const products=s.products.filter(p=>activeBomFor(s,p.id))
  const form=useForm({supplierId:s.suppliers[0]?.id||'',productId:products[0]?.id||'',qty:'50',cost:'45000',expectedDate:addDays(todayISO(),5)},v=>({qty:Number(v.qty)>0?undefined:'Miqdor > 0',cost:Number(v.cost)>=0?undefined:'Narx noto‘g‘ri'}))
  return <Modal open onClose={onClose} title="Subcontract order" subtitle="Draft · komponentlar “Materialni yuborish”da chiqim qilinadi" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const bom=activeBomFor(s,v.productId);const r=app.createEntity('subcontractOrders',{code:`SUB-${Date.now().toString().slice(-6)}`,supplierId:v.supplierId,productId:v.productId,qty:Number(v.qty),status:'Draft',materialIds:(bom?.components||[]).map(c=>c.materialId),expectedDate:v.expectedDate,cost:Number(v.qty)*Number(v.cost)} satisfies Omit<SubcontractOrder,'id'>);if(r.ok)onClose();return r.ok})}>Yaratish</button></>}>
    <div className="form-grid">
      <Field label="Supplier"><Select value={form.values.supplierId} onChange={v=>form.set('supplierId',v)}>{s.suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
      <Field label="Mahsulot"><Select value={form.values.productId} onChange={v=>form.set('productId',v)}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Miqdor" required error={form.error('qty')}><Input type="number" min="1" {...form.input('qty')}/></Field>
      <Field label="Xizmat narxi / dona" error={form.error('cost')}><MoneyInput min="0" {...form.money('cost')}/></Field>
      <Field label="Expected date"><Input type="date" {...form.input('expectedDate')}/></Field>
    </div>
  </Modal>
}
