// Procurement completion: manual purchase requests (draft → submitted → approved / rejected → PO) and supplier
// invoices matched three ways (PO ↔ goods receipt ↔ invoice). Invoices never move stock; debt stays in the ledger.
import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,Modal,MoneyInput,ResourceTable,Select,StatusBadge,Textarea,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {Tone} from '../../../shared/ui'
import type {PurchaseOrder,PurchaseRequest,SupplierInvoice} from '../../../types'
import {invoiceMatch,invoiceOpen} from '../../../domain/actions'
import {findLink} from '../../../domain/supplierMaterials'
import {addDays,todayISO} from '../../../utils/dates'
import {money,num,qty} from '../../../utils/format'
import {employeeName,materialName,supplierName,warehouseName} from '../../common/lookups'

type State=ReturnType<typeof useApp>['state']
const REQUEST_TONE:Record<PurchaseRequest['status'],Tone>={'Qoralama':'neutral','Yuborilgan':'warning','Tasdiqlangan':'success','Rad etilgan':'danger','Buyurtma qilingan':'info','Bekor':'neutral'}
const unitOf=(s:State,id:string)=>s.rawMaterials.find(m=>m.id===id)?.unit||''

export function PurchaseRequestsSection(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status')
  const [id,setId]=useRecordParam('pr')
  const [form,setForm]=useState<PurchaseRequest|'new'|null>(null)
  const rows=(s.purchaseRequests||[]).filter(r=>!status||r.status===status)
  const selected=(s.purchaseRequests||[]).find(r=>r.id===id)
  return <>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="PR, material, izoh..." onRow={r=>setId(r.id)} exportName="purchase-requests" resetKey={status}
      actions={<button type="button" className="primary-glass-btn compact" disabled={!app.can('purchases','create')} onClick={()=>setForm('new')}><Icon name="plus" size={15}/>Yangi so‘rov</button>}
      filters={<FilterSelect label="Holat" value={status} onChange={setStatus} options={['Qoralama','Yuborilgan','Tasdiqlangan','Rad etilgan','Buyurtma qilingan','Bekor']}/>} filtersActive={Boolean(status)} onResetFilters={()=>setStatus('')}
      emptyText="Bo‘lim ehtiyojini xarid so‘rovi sifatida kiriting; tasdiqlangach PO yaratiladi."
      columns={[
        {key:'code',label:'So‘rov',value:r=>r.code,render:r=><div className="cell-main"><b>{r.code}</b><small>{r.createdAt.slice(0,10)} · {employeeName(s,r.createdBy)}</small></div>},
        {key:'items',label:'Materiallar',value:r=>r.lines.map(l=>materialName(s,l.materialId)).join(', '),render:r=><span className="truncate">{r.lines.map(l=>`${materialName(s,l.materialId)} ${num(l.qty)} ${unitOf(s,l.materialId)}`).join(', ')}</span>},
        {key:'warehouse',label:'Ombor',value:r=>warehouseName(s,r.warehouseId),priority:'low'},
        {key:'neededBy',label:'Kerakli sana',value:r=>r.neededBy},
        {key:'status',label:'Holat',value:r=>r.status,render:r=><StatusBadge tone={REQUEST_TONE[r.status]}>{r.status}</StatusBadge>},
      ]}/>
    {form&&<RequestFormModal request={form==='new'?undefined:form} onClose={()=>setForm(null)} onSaved={setId}/>}
    {selected&&<RequestDrawer key={selected.id} request={selected} onClose={()=>setId(null)} onEdit={()=>setForm(selected)}/>}
  </>
}

function RequestFormModal({request,onClose,onSaved}:{request?:PurchaseRequest;onClose:()=>void;onSaved:(id:string)=>void}){
  const app=useApp(),s=app.state
  const materials=s.rawMaterials.filter(m=>m.status!=='Arxiv')
  const stores=s.warehouses.filter(w=>w.status==='Faol'&&['Raw','Mixed'].includes(w.type))
  const [lines,setLines]=useState(()=>request?request.lines.map(l=>({materialId:l.materialId,qty:String(l.qty)})):[{materialId:materials[0]?.id||'',qty:''}])
  const [warehouseId,setWarehouseId]=useState(request?.warehouseId||stores[0]?.id||''),[neededBy,setNeededBy]=useState(request?.neededBy||addDays(todayISO(),7)),[note,setNote]=useState(request?.note||'')
  const [touched,setTouched]=useState(false)
  const lineError=(l:{materialId:string;qty:string})=>!l.materialId?'Material':!(Number(l.qty)>0)?'Miqdor':lines.filter(x=>x.materialId===l.materialId).length>1?'Takror':null
  const errors=[...lines.map(lineError).filter(Boolean),...(neededBy<todayISO()?['Sana o‘tgan']:[]),...(!warehouseId?['Ombor']:[])]
  const save=(submit:boolean)=>{
    setTouched(true)
    if(errors.length)return
    const payload={lines:lines.map(l=>({materialId:l.materialId,qty:Number(l.qty)})),warehouseId,neededBy,note}
    const r=request?app.updatePurchaseRequest(request.id,payload):app.createPurchaseRequest({...payload,submit})
    if(!r.ok)return
    const id=request?.id||r.id!
    if(request&&submit)app.submitPurchaseRequest(id)
    onSaved(id);onClose()
  }
  return <Modal open onClose={onClose} title={request?`${request.code} tahrirlash`:'Yangi xarid so‘rovi'} subtitle="Qoralama sifatida saqlang yoki darhol tasdiqlashga yuboring" size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><span className="spacer"/><button type="button" className="secondary-glass-btn" onClick={()=>save(false)}>Qoralama saqlash</button><button type="button" className="primary-glass-btn" onClick={()=>save(true)}><Icon name="check" size={16}/>Tasdiqlashga yuborish</button></>}>
    <div className="form-stack">
      <div className="form-grid">
        <Field label="Qabul ombori" required><Select value={warehouseId} onChange={setWarehouseId}>{stores.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Kerakli sana" required error={touched&&neededBy<todayISO()?'O‘tgan sana':undefined}><Input type="date" value={neededBy} onChange={e=>setNeededBy(e.target.value)}/></Field>
        <Field className="span-2" label="Izoh / asos"><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Masalan: 2-liniya oylik ehtiyoji"/></Field>
      </div>
      <div className="table-scroll"><table className="fit editor-table"><thead><tr><th>Material</th><th className="align-right">Miqdor</th><th/></tr></thead><tbody>{lines.map((l,i)=>{const err=touched?lineError(l):null;return <tr key={i} className={err?'row-danger':undefined}>
        <td className="wide-cell"><Select value={l.materialId} onChange={v=>setLines(x=>x.map((y,j)=>j===i?{...y,materialId:v}:y))} ariaLabel={`Material ${i+1}`}>{materials.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</Select>{err&&<small className="field-error">{err==='Takror'?'Bu material boshqa qatorda bor':err==='Miqdor'?'Musbat miqdor kiriting':'Material tanlang'}</small>}</td>
        <td className="align-right"><div className="inline-row"><input className="ui-input cell-input" type="number" min="0" step="any" aria-label={`Miqdor ${i+1}`} value={l.qty} onChange={e=>setLines(x=>x.map((y,j)=>j===i?{...y,qty:e.target.value}:y))}/><span className="soft-meta">{unitOf(s,l.materialId)}</span></div></td>
        <td className="align-right"><button type="button" className="icon-ghost danger" disabled={lines.length<2} aria-label="Qatorni o‘chirish" onClick={()=>setLines(x=>x.filter((_,j)=>j!==i))}><Icon name="trash" size={15}/></button></td>
      </tr>})}</tbody></table></div>
      <div><button type="button" className="secondary-glass-btn compact" onClick={()=>setLines(x=>[...x,{materialId:materials.find(m=>!x.some(y=>y.materialId===m.id))?.id||'',qty:''}])}><Icon name="plus" size={14}/>Qator</button></div>
      {touched&&errors.length>0&&<div className="inline-note warning" role="alert"><Icon name="warning"/>Har qatorda material va musbat miqdor bo‘lsin; kerakli sana bugundan oldin bo‘lmasin.</div>}
    </div>
  </Modal>
}

function RequestDrawer({request:r,onClose,onEdit}:{request:PurchaseRequest;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [decide,setDecide]=useState<'approve'|'reject'|'cancel'|null>(null),[note,setNote]=useState(''),[order,setOrder]=useState(false)
  const own=r.createdBy===app.currentEmployee?.id
  const canDecide=r.status==='Yuborilgan'&&app.can('purchases','approve')
  const run=()=>{const out=decide==='cancel'?app.cancelPurchaseRequest(r.id,note):app.decidePurchaseRequest(r.id,decide!,note);if(out.ok){setDecide(null);setNote('')}}
  return <Drawer open onClose={onClose} title={r.code} eyebrow="Xarid so‘rovi" icon="cart" size="md" subtitle={`${warehouseName(s,r.warehouseId)} · kerak ${r.neededBy}`} headerExtra={<StatusBadge tone={REQUEST_TONE[r.status]}>{r.status}</StatusBadge>}
    actions={<>
      {app.can('purchases','edit')&&!['Buyurtma qilingan','Bekor'].includes(r.status)&&<button type="button" className="ghost-btn" onClick={()=>{setNote('');setDecide('cancel')}}><Icon name="x" size={15}/>Bekor qilish</button>}
      <span className="spacer"/>
      {['Qoralama','Rad etilgan'].includes(r.status)&&app.can('purchases','create')&&<button type="button" className="secondary-glass-btn" onClick={onEdit}><Icon name="edit" size={15}/>Tahrirlash</button>}
      {r.status==='Qoralama'&&app.can('purchases','create')&&<button type="button" className="primary-glass-btn" onClick={()=>app.submitPurchaseRequest(r.id)}><Icon name="check" size={15}/>Tasdiqlashga yuborish</button>}
      {canDecide&&<><button type="button" className="danger-glass-btn" disabled={own} onClick={()=>{setNote('');setDecide('reject')}}>Rad etish</button><button type="button" className="primary-glass-btn" disabled={own} title={own?'O‘zingiz yaratgan so‘rovni boshqa xodim tasdiqlaydi':undefined} onClick={()=>{setNote('');setDecide('approve')}}><Icon name="check" size={15}/>Tasdiqlash</button></>}
      {r.status==='Tasdiqlangan'&&app.can('purchases','create')&&<button type="button" className="primary-glass-btn" onClick={()=>setOrder(true)}><Icon name="cart" size={15}/>PO yaratish</button>}
    </>}>
    {canDecide&&own&&<div className="inline-note"><Icon name="info"/>O‘zingiz yaratgan so‘rovni boshqa xodim tasdiqlaydi yoki rad etadi.</div>}
    <div className="table-scroll"><table className="fit"><thead><tr><th>Material</th><th className="align-right">Miqdor</th><th className="align-right">Hozir available</th></tr></thead><tbody>{r.lines.map(l=><tr key={l.materialId}><td>{materialName(s,l.materialId)}</td><td className="align-right">{qty(l.qty,unitOf(s,l.materialId))}</td><td className="align-right">{num(s.stockBalances.filter(b=>b.itemId===l.materialId).reduce((a,b)=>a+Math.max(0,b.onHand-b.reserved-(b.quarantine||0)),0),1)}</td></tr>)}</tbody></table></div>
    {r.note&&<div className="inline-note"><Icon name="info"/>{r.note}</div>}
    {r.decisionNote&&<div className={`inline-note ${r.status==='Rad etilgan'?'warning':''}`}><Icon name="info"/>Qaror izohi: {r.decisionNote}</div>}
    {(r.purchaseOrderIds||[]).map(id=>{const po=s.purchaseOrders.find(p=>p.id===id);return po?<button type="button" key={id} className="list-row is-clickable" onClick={()=>navigate(`/purchases?view=orders&id=${id}`)}><span className="list-row-copy"><b>{po.code}</b><small>{supplierName(s,po.supplierId)} · {money(po.total)}</small></span><StatusBadge>{po.status}</StatusBadge></button>:null})}
    <div className="stack-list">{[...r.history].reverse().map((h,i)=><div className="list-row" key={i}><span className="list-row-copy"><b>{h.action}</b><small>{h.at.slice(0,16)} · {employeeName(s,h.by)}{h.note?` · ${h.note}`:''}</small></span></div>)}</div>
    {decide&&<Modal open onClose={()=>setDecide(null)} title={decide==='approve'?'So‘rovni tasdiqlash':decide==='reject'?'So‘rovni rad etish':'So‘rovni bekor qilish'} size="sm"
      footer={<><button type="button" className="secondary-glass-btn" onClick={()=>setDecide(null)}>Ortga</button><button type="button" className={decide==='approve'?'primary-glass-btn':'danger-glass-btn'} disabled={decide!=='approve'&&note.trim().length<5} onClick={run}>{decide==='approve'?'Tasdiqlash':decide==='reject'?'Rad etish':'Bekor qilish'}</button></>}>
      <Field label={decide==='approve'?'Izoh':'Sabab'} required={decide!=='approve'} hint={decide==='approve'?'Ixtiyoriy':'Kamida 5 belgi'}><Textarea value={note} onChange={e=>setNote(e.target.value)}/></Field>
    </Modal>}
    {order&&<RequestToPoModal request={r} onClose={()=>setOrder(false)} onCreated={id=>navigate(`/purchases?view=orders&id=${id}`)}/>}
  </Drawer>
}

function RequestToPoModal({request,onClose,onCreated}:{request:PurchaseRequest;onClose:()=>void;onCreated:(id:string)=>void}){
  const app=useApp(),s=app.state
  // Suppliers linked to every requested material (a PO goes to one supplier).
  const suppliers=s.suppliers.filter(x=>x.status==='Faol'&&request.lines.every(l=>findLink(s,x.id,l.materialId)))
  const [supplierId,setSupplierId]=useState(suppliers[0]?.id||'')
  const create=()=>{const r=app.purchaseOrderFromRequest(request.id,{supplierId});if(r.ok&&r.id){onClose();onCreated(r.id)}}
  return <Modal open onClose={onClose} title="So‘rovdan PO" eyebrow={request.code} subtitle="PO qoralama sifatida yaratiladi va PO tasdiqlash jarayonidan o‘tadi" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={!supplierId} onClick={create}><Icon name="cart" size={15}/>PO yaratish</button></>}>
    {suppliers.length?<Field label="Supplier" required hint="Barcha materiallarga biriktirilgan faol supplierlar"><Select value={supplierId} onChange={setSupplierId}>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
      :<div className="inline-note warning" role="alert"><Icon name="warning"/>Barcha materiallarni yetkazadigan faol supplier yo‘q — avval supplierni materiallarga biriktiring yoki so‘rovni bo‘ling.</div>}
  </Modal>
}

/* ------------------------------------------------------------ invoices -- */

const INVOICE_TONE:Record<SupplierInvoice['status'],Tone>={'Tekshirilmoqda':'warning','Tasdiqlangan':'success','Rad etilgan':'danger','Bekor':'neutral'}

/** Invoices of one PO with their three-way match and actions. */
export function PurchaseInvoices({po}:{po:PurchaseOrder}){
  const app=useApp(),s=app.state
  const [add,setAdd]=useState(false),[openId,setOpenId]=useState<string|null>(null)
  const list=(s.supplierInvoices||[]).filter(x=>x.purchaseOrderId===po.id)
  const canAdd=app.can('purchases','edit')&&!['Qoralama','Bekor'].includes(po.status)
  const selected=list.find(x=>x.id===openId)
  return <Card title="Supplier invoice’lari" subtitle="PO ↔ qabul (GRN) ↔ invoice solishtiriladi · invoice zaxirani o‘zgartirmaydi" actions={canAdd?<button type="button" className="secondary-glass-btn compact" onClick={()=>setAdd(true)}><Icon name="plus" size={14}/>Invoice kiritish</button>:undefined}>
    {list.length?<div className="stack-list">{list.map(v=>{const m=invoiceMatch(s,v);return <button type="button" key={v.id} className="list-row is-clickable" onClick={()=>setOpenId(v.id)}><span className="list-row-copy"><b>{v.code} · №{v.number}</b><small>{v.date}{v.dueDate?` · muddat ${v.dueDate}`:''} · {money(v.total)}{v.status==='Tasdiqlangan'?` · qoldiq ${money(invoiceOpen(s,v))}`:''}</small></span><span className="badge-row">{v.status==='Tekshirilmoqda'&&<StatusBadge tone={m.matched?'success':'danger'}>{m.matched?'Mos':'Farq bor'}</StatusBadge>}<StatusBadge tone={INVOICE_TONE[v.status]}>{v.status}</StatusBadge></span></button>})}</div>
      :<Empty compact icon="wallet" title="Invoice kiritilmagan" text={po.status==='Qoralama'?'Tasdiqlangan PO bo‘yicha invoice kiritiladi.':'Supplierdan kelgan hisob-fakturani kiriting.'}/>}
    {add&&<InvoiceModal po={po} onClose={()=>setAdd(false)} onSaved={setOpenId}/>}
    {selected&&<InvoiceDrawer key={selected.id} invoice={selected} onClose={()=>setOpenId(null)}/>}
  </Card>
}

function InvoiceModal({po,onClose,onSaved}:{po:PurchaseOrder;onClose:()=>void;onSaved:(id:string)=>void}){
  const app=useApp(),s=app.state
  const [key]=useState(()=>`sinv-${po.id}-${Date.now().toString(36)}`)
  const [number,setNumber]=useState(''),[date,setDate]=useState(todayISO()),[dueDate,setDueDate]=useState(addDays(todayISO(),30))
  // Defaults: what was received and is not yet billed, at the PO price.
  const draft={id:'draft',purchaseOrderId:po.id,lines:po.items.map(i=>({materialId:i.materialId,qty:0,price:i.price}))}
  const base=invoiceMatch(s,draft)
  const [lines,setLines]=useState(()=>po.items.map(i=>({materialId:i.materialId,qty:String(base.lines.find(l=>l.materialId===i.materialId)?.invoiceable||0),price:String(i.price)})))
  const typed={...draft,lines:lines.map(l=>({materialId:l.materialId,qty:Number(l.qty)||0,price:Number(l.price)||0})).filter(l=>l.qty>0)}
  const m=invoiceMatch(s,typed)
  const numberOk=/^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/.test(number.trim())
  const total=typed.lines.reduce((a,l)=>a+l.qty*l.price,0)
  const save=()=>{const r=app.registerSupplierInvoice({purchaseOrderId:po.id,number,date,dueDate,lines:typed.lines,key});if(r.ok&&r.id){onSaved(r.id);onClose()}}
  return <Modal open onClose={onClose} title="Supplier invoice" eyebrow={po.code} subtitle={supplierName(s,po.supplierId)} size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><span className="spacer"/><span className="soft-meta">Jami: <b>{money(total)}</b></span><button type="button" className="primary-glass-btn" disabled={!numberOk||!typed.lines.length||!date} onClick={save}><Icon name="check" size={16}/>Kiritish</button></>}>
    <div className="form-stack">
      <div className="form-grid">
        <Field label="Invoice raqami" required error={number&&!numberOk?'Harf, raqam, / . _ -':undefined}><Input value={number} onChange={e=>setNumber(e.target.value)} placeholder="Supplier hujjat raqami"/></Field>
        <Field label="Invoice sanasi" required><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
        <Field label="To‘lov muddati"><Input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></Field>
      </div>
      <MatchTable lines={m.lines} edit={{values:lines,set:(i,f,v)=>setLines(x=>x.map((y,j)=>j===i?{...y,[f]:v}:y))}}/>
      <MatchVerdict m={m}/>
    </div>
  </Modal>
}

type Match=ReturnType<typeof invoiceMatch>
function MatchVerdict({m}:{m:Match}){
  if(!m.lines.length)return null
  if(m.matched)return <div className="inline-note success"><Icon name="check"/>PO narxi va qabul qilingan miqdor bilan mos.</div>
  return <div className="inline-note warning" role="alert"><Icon name="warning"/><span>{m.overBilled.length?`Qabul qilinmagan miqdor: ${m.overBilled.map(l=>`${l.qty} > ${l.invoiceable}`).join(', ')} — bunday invoice tasdiqlanmaydi. `:''}{m.priced.length?`Narx farqi ${money(m.variance)} — faqat istisno sababi bilan tasdiqlanadi.`:''}</span></div>
}

function MatchTable({lines,edit}:{lines:Match['lines'];edit?:{values:{materialId:string;qty:string;price:string}[];set:(i:number,f:'qty'|'price',v:string)=>void}}){
  const s=useApp().state
  const rows=edit?edit.values.map(v=>lines.find(l=>l.materialId===v.materialId)):lines
  return <div className="table-scroll"><table className="fit match-table"><thead><tr><th>Material</th><th className="align-right">PO</th><th className="align-right">Qabul (GRN)</th><th className="align-right">Avval invoice</th><th className="align-right">Invoice miqdori</th><th className="align-right">PO narxi</th><th className="align-right">Invoice narxi</th><th className="align-right">Farq</th></tr></thead><tbody>
    {(edit?edit.values:lines).map((v,i)=>{const l=rows[i],unit=unitOf(s,v.materialId),over=Boolean(l&&l.qtyOver>1e-6),priced=Boolean(l&&Math.abs(l.priceDiff)>0.005)
      return <tr key={v.materialId} className={over?'row-danger':priced?'row-warning':undefined}>
        <td><b>{materialName(s,v.materialId)}</b></td>
        <td className="align-right">{num(l?.ordered??0,3)}</td>
        <td className="align-right">{num((l?.received??0)-(l?.returned??0),3)}{l?.returned?<small className="cell-sub">qaytgan {num(l.returned,3)}</small>:null}</td>
        <td className="align-right">{num(l?.invoicedBefore??0,3)}</td>
        <td className="align-right">{edit?<input className="ui-input cell-input" type="number" min="0" step="any" aria-label={`${materialName(s,v.materialId)} invoice miqdori`} value={edit.values[i].qty} onChange={e=>edit.set(i,'qty',e.target.value)}/>:`${num(l?.qty??0,3)} ${unit}`}{over&&<small className="field-error">maks. {num(l!.invoiceable,3)}</small>}</td>
        <td className="align-right">{money(l?.poPrice??0)}</td>
        <td className="align-right">{edit?<div className="cell-money"><MoneyInput min="0" aria-label={`${materialName(s,v.materialId)} invoice narxi`} value={edit.values[i].price} onValue={x=>edit.set(i,'price',x)}/></div>:money(l?.price??0)}</td>
        <td className={`align-right ${l&&l.variance<0?'negative':''}`}>{l&&Math.abs(l.variance)>0.005?<b>{l.variance>0?'+':''}{money(l.variance)}</b>:<span className="soft-meta">—</span>}</td>
      </tr>})}
  </tbody></table></div>
}

function InvoiceDrawer({invoice:v,onClose}:{invoice:SupplierInvoice;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [decide,setDecide]=useState<'approve'|'reject'|null>(null),[note,setNote]=useState('')
  const m=invoiceMatch(s,v)
  const pending=v.status==='Tekshirilmoqda'&&app.can('purchases','approve')
  const needReason=decide==='reject'||(decide==='approve'&&m.priced.length>0)
  const run=()=>{const out=decide==='approve'?app.approveSupplierInvoice(v.id,note):app.rejectSupplierInvoice(v.id,note);if(out.ok){setDecide(null);setNote('')}}
  return <Drawer open onClose={onClose} title={`${v.code} · №${v.number}`} eyebrow="Supplier invoice" icon="wallet" size="lg" subtitle={`${supplierName(s,v.supplierId)} · ${v.date}${v.dueDate?` · muddat ${v.dueDate}`:''}`} headerExtra={<StatusBadge tone={INVOICE_TONE[v.status]}>{v.status}</StatusBadge>}
    actions={pending?<><span className="spacer"/><button type="button" className="danger-glass-btn" onClick={()=>{setNote('');setDecide('reject')}}>Rad etish</button><button type="button" className="primary-glass-btn" disabled={m.overBilled.length>0} title={m.overBilled.length?'Qabul qilinmagan miqdor uchun tasdiqlanmaydi':undefined} onClick={()=>{setNote('');setDecide('approve')}}><Icon name="check" size={15}/>{m.priced.length?'Istisno bilan tasdiqlash':'Tasdiqlash'}</button></>:undefined}>
    <InfoGrid columns={4} items={[{label:'Invoice summasi',value:money(v.total)},{label:'Narx farqi',value:money(v.status==='Tasdiqlangan'?v.variance||0:m.variance),tone:Math.abs(m.variance)>0.005?'warning':undefined},{label:'To‘lanmagan',value:v.status==='Tasdiqlangan'?money(invoiceOpen(s,v)):'—'},{label:'Kiritgan',value:employeeName(s,v.createdBy)}]}/>
    {v.status==='Tekshirilmoqda'&&<MatchVerdict m={m}/>}
    <MatchTable lines={m.lines}/>
    {v.exceptionReason&&<div className="inline-note warning"><Icon name="info"/>Istisno sababi: {v.exceptionReason}</div>}
    <div className="stack-list">{[...v.history].reverse().map((h,i)=><div className="list-row" key={i}><span className="list-row-copy"><b>{h.action}</b><small>{h.at.slice(0,16)} · {employeeName(s,h.by)}{h.note?` · ${h.note}`:''}</small></span></div>)}</div>
    {decide&&<Modal open onClose={()=>setDecide(null)} title={decide==='approve'?'Invoice’ni tasdiqlash':'Invoice’ni rad etish'} size="sm"
      footer={<><button type="button" className="secondary-glass-btn" onClick={()=>setDecide(null)}>Ortga</button><button type="button" className={decide==='approve'?'primary-glass-btn':'danger-glass-btn'} disabled={needReason&&note.trim().length<5} onClick={run}>{decide==='approve'?'Tasdiqlash':'Rad etish'}</button></>}>
      <div className="form-stack">
        {decide==='approve'&&m.priced.length>0&&<div className="inline-note warning"><Icon name="warning"/>Narx farqi {money(m.variance)} supplier qarziga yoziladi.</div>}
        {decide==='approve'&&!m.priced.length&&<div className="inline-note"><Icon name="info"/>Qarz qabul (GRN) paytida yozilgan; invoice uni qayta yozmaydi.</div>}
        <Field label={decide==='approve'?'Istisno sababi':'Sabab'} required={needReason} hint={needReason?'Kamida 5 belgi':'Ixtiyoriy'}><Textarea value={note} onChange={e=>setNote(e.target.value)}/></Field>
      </div>
    </Modal>}
  </Drawer>
}
