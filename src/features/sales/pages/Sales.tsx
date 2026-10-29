import {useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Checkbox,Confirm,Drawer,RecordUnavailable,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,Progress,ResourceTable,Segmented,Select,StatusBadge,Tabs,Textarea,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {Customer,CustomerReturn,SalesOrder} from '../../../types'
import {productStockOf,returnSources} from '../../../domain/manufacturingEngine'
import {serialTracked} from '../../../domain/serials'
import {referenceBlocker,salesAvailable} from '../../../domain/actions'
import {addDays,todayISO} from '../../../utils/dates'
import {cls,compactMoney,money,num} from '../../../utils/format'
import {customerName,productName,warehouseName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'
import {QualityResolveModal} from '../../common/QualityResolveModal'
import {AdjustModal,LedgerList,OrderReceivableInfo,PaymentModal,ReceivablesView} from '../components/Receivables'
import {customerBalance,orderReceivable,paymentStatusOf} from '../../../domain/receivables'

export default function Sales(){
  const [sp]=useSearchParams(),view=sp.get('view')||'overview'
  if(view==='orders')return <Orders/>
  if(view==='customers')return <Customers/>
  if(view==='delivery')return <Delivery/>
  if(view==='returns')return <Returns/>
  if(view==='receivables')return <ReceivablesView/>
  return <Overview/>
}

const OPEN_SO:SalesOrder['status'][]=['Yangi','Tasdiqlangan','Ishlab chiqarishda','Tayyor']
const openQty=(o:SalesOrder)=>o.items.reduce((a,i)=>a+i.qty-i.delivered,0)
const reservedQty=(o:SalesOrder)=>o.items.reduce((a,i)=>a+(i.reserved||0),0)

function Overview(){
  const s=useApp().state,navigate=useNavigate()
  const open=s.salesOrders.filter(o=>OPEN_SO.includes(o.status))
  const late=open.filter(o=>o.deliveryDate<todayISO())
  const finished=s.products.filter(p=>p.type==='finished'||s.salesOrders.some(o=>o.items.some(i=>i.productId===p.id)))
  return <div className="page-stack">
    <PageHeader title="Sotuv" subtitle="MTS — ombordan rezerv · MTO — MO ochiladi"/>
    <div className="kpi-grid">
      <KPI label="Ochiq buyurtmalar" value={open.length} sub={compactMoney(open.reduce((a,o)=>a+o.total,0))} icon={<Icon name="truck"/>} onClick={()=>navigate('/sales?view=orders')}/>
      <KPI label="Yetkazishga tayyor" value={open.filter(o=>o.status==='Tayyor').length} sub="To‘liq rezerv" tone="mint" icon={<Icon name="check"/>} onClick={()=>navigate('/sales?view=delivery')}/>
      <KPI label="Ishlab chiqarishda (MTO)" value={open.filter(o=>o.status==='Ishlab chiqarishda').length} tone="purple" icon={<Icon name="factory"/>} onClick={()=>navigate('/sales?view=orders&status=Ishlab chiqarishda')}/>
      <KPI label="Kechikkan" value={late.length} sub="Sana o‘tgan" tone="pink" icon={<Icon name="clock"/>} onClick={()=>navigate('/sales?view=orders&late=1')}/>
      <KPI label="Debitorlik qarzi" value={compactMoney(s.customers.reduce((a,c)=>a+Math.max(0,customerBalance(s,c.id)),0))} sub="ledger bo‘yicha" tone="orange" icon={<Icon name="wallet"/>} onClick={()=>navigate('/sales?view=receivables')}/>
    </div>
    <div className="two-col">
      <Card title="Ochiq buyurtmalar" subtitle="manba: rezerv yoki MO" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/sales?view=orders')}>Barchasi <Icon name="chevron" size={13}/></button>}>
        {open.length?<div className="stack-list">{open.map(o=>{const mo=s.productionOrders.find(m=>m.id===o.productionOrderId);return <button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/sales?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code} · {customerName(s,o.customerId)}</b><small>{o.items.map(i=>`${productName(s,i.productId)} ${num(i.qty)}`).join(', ')} · {mo?`${mo.code} (${mo.status})`:`rezerv ${num(reservedQty(o))}/${num(openQty(o))}`}</small></span><StatusBadge>{o.status}</StatusBadge></button>})}</div>:<Empty compact title="Ochiq buyurtma yo‘q"/>}
      </Card>
      <Card title="Tayyor mahsulot" subtitle="sotuvga bo‘sh" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/warehouse?view=stock&type=finished')}>Ombor <Icon name="chevron" size={13}/></button>}>
        <div className="stack-list">{finished.map(p=>{const st=productStockOf(s,p.id);return <div className="list-row" key={p.id}><span className="list-row-copy"><b>{p.name}</b><small>on hand {num(st.onHand)} · rezerv {num(st.reserved)}</small></span><b className="num">{num(st.available)} {p.unit}</b></div>})}</div>
      </Card>
    </div>
  </div>
}

function Orders(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status','open'),[mode,setMode]=useSearchParamState('mode'),[late,setLate]=useSearchParamState('late')
  const [id,setId]=useRecordParam()
  const [create,setCreate]=useState(false)
  const rows=s.salesOrders.filter(o=>(status==='all'||(status==='open'?OPEN_SO.includes(o.status):o.status===status))&&(!mode||o.mode===mode)&&(late!=='1'||(OPEN_SO.includes(o.status)&&o.deliveryDate<todayISO())))
  return <div className="page-stack">
    <PageHeader title="Sales Orders" subtitle="Rezerv yoki MO → yetkazish → qaytarish" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('sales','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi buyurtma</button>}/>
    <Segmented ariaLabel="Status" items={[{value:'open',label:'Ochiq'},{value:'Tayyor',label:'Tayyor'},{value:'Ishlab chiqarishda',label:'Ishlab chiqarishda'},{value:'Yetkazildi',label:'Yetkazilgan'},{value:'Bekor',label:'Bekor'},{value:'all',label:'Barchasi'}]} value={status} onChange={setStatus}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="SO, mijoz, mahsulot..." onRow={o=>setId(o.id)} exportName="sales-orders" resetKey={`${status}|${mode}|${late}`}
      filtersActive={Boolean(mode||late)} onResetFilters={()=>{setMode('');setLate('')}}
      filters={<><FilterSelect label="Rejim" value={mode} onChange={setMode} options={['Make-to-stock','Make-to-order']}/><Checkbox checked={late==='1'} onChange={v=>setLate(v?'1':'')} label="Kechikkan"/></>}
      rowClassName={o=>OPEN_SO.includes(o.status)&&o.deliveryDate<todayISO()?'row-danger':undefined}
      columns={[
        {key:'code',label:'SO',value:o=>o.code,render:o=><div className="cell-main"><b>{o.code}</b><small>{o.createdAt.slice(0,10)}</small></div>},
        {key:'customer',label:'Mijoz',value:o=>customerName(s,o.customerId)},
        {key:'items',label:'Mahsulot',value:o=>o.items.map(i=>productName(s,i.productId)).join(', '),render:o=>{const t=o.items.map(i=>`${productName(s,i.productId)} × ${num(i.qty)}`).join(', ');return <span className="truncate" title={t}>{t}</span>}},
        {key:'mode',label:'Rejim',value:o=>o.mode,render:o=><StatusBadge>{o.mode}</StatusBadge>,priority:'low'},
        {key:'status',label:'Status',value:o=>o.status,render:o=><StatusBadge>{o.status}</StatusBadge>},
        {key:'reserved',label:'Rezerv',align:'right',value:o=>OPEN_SO.includes(o.status)?reservedQty(o)/Math.max(1,openQty(o))*100:100,render:o=>OPEN_SO.includes(o.status)?<div className="progress-cell"><Progress value={reservedQty(o)/Math.max(1,openQty(o))*100}/><small>{Math.round(reservedQty(o)/Math.max(1,openQty(o))*100)}%</small></div>:<span className="muted">—</span>},
        {key:'total',label:'Summa',align:'right',value:o=>o.total,render:o=>money(o.total)},
        {key:'delivery',label:'Yetkazish',value:o=>o.deliveryDate},
      ]}/>
    {create&&<SalesFormModal onClose={()=>setCreate(false)} onCreated={v=>setId(v)}/>}
    <SalesDrawer soId={id} onClose={()=>setId(null)}/>
  </div>
}

type Line={productId:string;qty:string;price:string;variantId?:string}
function SalesFormModal({onClose,onCreated,customerId}:{onClose:()=>void;onCreated?:(id:string)=>void;customerId?:string}){
  const app=useApp(),s=app.state
  const products=s.products.filter(p=>p.status==='Faol'&&p.salePrice>0)
  const [lines,setLines]=useState<Line[]>([{productId:products[0]?.id||'',qty:'100',price:String(products[0]?.salePrice||0)}])
  const form=useForm({customerId:customerId||s.customers.find(c=>c.status==='Faol')?.id||'',mode:'Make-to-stock' as SalesOrder['mode'],deliveryDate:addDays(todayISO(),3),branchId:''},v=>({customerId:required(v.customerId,'Mijoz'),deliveryDate:v.deliveryDate<todayISO()?'O‘tgan sana':undefined}))
  // Free stock the seller could reserve now, of the line's own variant when the product tracks variant stock (audit #15).
  const available=(l:Line)=>salesAvailable(s,app.currentEmployee,l.productId,todayISO(),l.variantId||undefined)
  const needsVariant=(l:Line)=>Boolean(products.find(p=>p.id===l.productId)?.variantStock)&&!l.variantId
  const mto=form.values.mode==='Make-to-order'
  const visible=mto?lines.slice(0,1):lines
  const lineError=(l:Line)=>!l.productId||!(Number(l.qty)>0)||Number(l.qty)%1!==0||Number(l.price)<0||needsVariant(l)
  const hasErrors=visible.some(lineError)
  const total=visible.reduce((a,l)=>a+(Number(l.qty)||0)*(Number(l.price)||0),0)
  const submit=()=>form.submit(v=>{if(hasErrors)return false;const r=app.createSalesOrder({customerId:v.customerId,mode:v.mode,deliveryDate:v.deliveryDate,branchId:v.branchId||undefined,lines:visible.map(l=>({productId:l.productId,variantId:l.variantId||undefined,qty:Number(l.qty),price:Number(l.price)}))});if(r.ok){onCreated?.(r.id!);onClose()}return r.ok})
  return <Modal open onClose={onClose} title="Yangi Sales Order" size="lg"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><span className="spacer"/><span className="soft-meta">Jami: <b>{money(total)}</b></span><button type="button" className="primary-glass-btn" onClick={submit}><Icon name="check" size={16}/>Yaratish</button></>}>
    <div className="form-stack">
      <div className="form-grid">
        <Field label="Mijoz" required error={form.error('customerId')}><Select value={form.values.customerId} onChange={v=>form.set('customerId',v)}>{s.customers.filter(c=>c.status!=='Arxiv').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Yetkazish sanasi" error={form.error('deliveryDate')}><Input type="date" {...form.input('deliveryDate')}/></Field>
        <Field label="Sotuv filiali (MRP)" hint="Bo‘sh: sizning filialingiz yoki rezerv ombori bo‘yicha"><Select value={form.values.branchId} onChange={v=>form.set('branchId',v)}><option value="">Avtomatik</option>{s.branches.filter(b=>b.status!=='Arxiv').map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <div className="field span-2"><label>Rejim</label><Segmented ariaLabel="Rejim" items={[{value:'Make-to-stock',label:'Ombordan (MTS)'},{value:'Make-to-order',label:'Buyurtmaga (MTO)'}]} value={form.values.mode} onChange={v=>form.set('mode',v as SalesOrder['mode'])}/></div>
      </div>
      <section className="editor-section">
        <div className="editor-head"><h4>Mahsulotlar</h4>{!mto&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setLines(x=>[...x,{productId:products[0]?.id||'',qty:'1',price:String(products[0]?.salePrice||0)}])}><Icon name="plus" size={14}/>Qator</button>}</div>
        <div className="table-scroll"><table className="fit editor-table"><thead><tr><th>Mahsulot</th><th className="align-right">Miqdor</th><th className="align-right">Narx</th><th className="align-right">Available</th><th/></tr></thead><tbody>{visible.map((l,i)=>{const free=available(l);return <tr key={i} className={lineError(l)?'row-danger':undefined}>
          <td className="wide-cell"><Select value={l.productId} onChange={v=>setLines(x=>x.map((y,j)=>j===i?{...y,productId:v,variantId:'',price:String(products.find(p=>p.id===v)?.salePrice||0)}:y))} ariaLabel={`Mahsulot ${i+1}`}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            {(()=>{const p=products.find(x=>x.id===l.productId),vs=(p?.variants||[]).filter(v=>v.status==='Faol');return vs.length?<Select size="sm" value={l.variantId||''} onChange={v=>setLines(x=>x.map((y,j)=>j===i?{...y,variantId:v,price:String((p?.salePrice||0)+(vs.find(z=>z.id===v)?.priceDelta||0))}:y))} ariaLabel={`Variant ${i+1}`}>{p?.variantStock?<option value="">Variant tanlang</option>:<option value="">Variantsiz</option>}{vs.map(v=><option key={v.id} value={v.id}>{v.code} · {v.attributes}</option>)}</Select>:null})()}</td>
          <td className="align-right"><input className="ui-input cell-input" type="number" min="1" step="1" aria-label="Miqdor" value={l.qty} onChange={e=>setLines(x=>x.map((y,j)=>j===i?{...y,qty:e.target.value}:y))}/></td>
          <td className="align-right"><div className="cell-money"><MoneyInput min="0" aria-label="Narx" value={l.price} onValue={v=>setLines(x=>x.map((y,j)=>j===i?{...y,price:v}:y))}/></div></td>
          <td className={`align-right ${!mto&&free<(Number(l.qty)||0)?'negative':''}`} title={products.find(p=>p.id===l.productId)?.variantStock?'Faqat shu variant qoldig‘i':undefined}>{needsVariant(l)?'—':num(free)}</td>
          <td className="align-right"><button type="button" className="icon-ghost danger" disabled={visible.length<2} aria-label="Qatorni o‘chirish" onClick={()=>setLines(x=>x.filter((_,j)=>j!==i))}><Icon name="trash" size={15}/></button></td>
        </tr>})}</tbody></table></div>
        {hasErrors&&<small className="field-error">Har qatorda mahsulot{visible.some(needsVariant)?', variant (variant bo‘yicha qoldiq)':''} va butun musbat miqdor bo‘lishi kerak.</small>}
      </section>
      <div className={`inline-note ${!mto&&visible.some(l=>available(l)<(Number(l.qty)||0))?'warning':''}`}><Icon name="info"/>{mto?'MO (qoralama) ochiladi; yakunlanganda shu buyurtmaga rezerv qilinadi.':visible.some(l=>available(l)<(Number(l.qty)||0))?'Yetarli emas — mavjud qismi rezerv qilinadi, qolgani uchun MO kerak.':'Tayyor mahsulot darhol rezerv qilinadi.'}</div>
    </div>
  </Modal>
}

function SalesDrawer({soId,onClose}:{soId:string|null;onClose:()=>void}){
  const app=useApp()
  const so=app.state.salesOrders.find(o=>o.id===soId)
  if(!so)return soId?<RecordUnavailable label="Sales order" onClose={onClose}/>:null
  return <SalesDrawerBody key={so.id} so={so} onClose={onClose}/>
}

function SalesDrawerBody({so,onClose}:{so:SalesOrder;onClose:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState('lines'),[cancel,setCancel]=useState(false),[deliver,setDeliver]=useState(false),[ret,setRet]=useState(false),[pay,setPay]=useState(false)
  const mo=s.productionOrders.find(o=>o.id===so.productionOrderId)
  const open=OPEN_SO.includes(so.status)
  const canEdit=app.can('sales','edit')
  const shipments=s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===so.code)
  const customer=s.customers.find(c=>c.id===so.customerId)
  const ledgerStatus=orderReceivable(s,so.id).status
  const returns=s.returns.filter(r=>r.salesOrderId===so.id)
  // Only stock this person may ship counts: active Finished/Mixed stores in their scope, unexpired, unreserved (audit #5).
  const shortage=so.items.some(i=>i.qty-i.delivered-(i.reserved||0)>salesAvailable(s,app.currentEmployee,i.productId,todayISO(),i.variantId))
  return <Drawer open onClose={onClose} title={so.code} eyebrow="Sales order" icon="truck" size="lg" subtitle={`${customerName(s,so.customerId)} · yetkazish ${so.deliveryDate}`}
    headerExtra={<><StatusBadge>{so.status}</StatusBadge><StatusBadge>{so.mode}</StatusBadge><StatusBadge>{paymentStatusOf(s,so)}</StatusBadge></>}
    actions={<>
      {open&&canEdit&&<button type="button" className="ghost-btn" onClick={()=>setCancel(true)}><Icon name="x" size={15}/>Bekor qilish</button>}
      {so.status==='Yetkazildi'&&app.can('sales','create')&&<button type="button" className="secondary-glass-btn" onClick={()=>setRet(true)}><Icon name="undo" size={15}/>Qaytarish</button>}
      <span className="spacer"/>
      {open&&so.status!=='Tayyor'&&canEdit&&<button type="button" className="secondary-glass-btn" onClick={()=>app.reserveSalesOrder(so.id)}><Icon name="refresh" size={15}/>Rezervni tekshirish</button>}
      {open&&canEdit&&<button type="button" className="primary-glass-btn" disabled={shortage} title={shortage?'Tayyor mahsulot yetarli emas':undefined} onClick={()=>setDeliver(true)}><Icon name="truck" size={16}/>Yetkazib berish</button>}
    </>}>
    <Tabs items={[{value:'lines',label:'Qatorlar'},{value:'fulfil',label:'Bajarilish'},{value:'finance',label:'To‘lov'},{value:'returns',label:'Qaytarishlar',count:returns.length},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {tab==='lines'&&<div className="table-scroll"><table className="fit"><thead><tr><th>Mahsulot</th><th className="align-right">Miqdor</th><th className="align-right">Rezerv</th><th className="align-right">Yetkazilgan</th><th className="align-right">Narx</th><th className="align-right">Summa</th></tr></thead><tbody>{so.items.map(i=><tr key={i.productId}><td><div className="cell-main"><b>{productName(s,i.productId)}</b><small>{[i.variantId?s.products.find(p=>p.id===i.productId)?.variants.find(v=>v.id===i.variantId)?.code:'',i.warehouseId?warehouseName(s,i.warehouseId):''].filter(Boolean).join(' · ')}</small></div></td><td className="align-right">{num(i.qty)}</td><td className="align-right">{num(i.reserved||0)}</td><td className="align-right">{num(i.delivered)}</td><td className="align-right">{money(i.price)}</td><td className="align-right">{money(i.qty*i.price)}</td></tr>)}<tr className="total"><td>Jami</td><td/><td/><td/><td/><td className="align-right">{money(so.total)}</td></tr></tbody></table></div>}
    {tab==='fulfil'&&<>
      {mo?<button type="button" className="list-row is-clickable" onClick={()=>navigate(`/production?view=orders&id=${mo.id}`)}><span className="list-row-copy"><b>{mo.code} · MTO ishlab chiqarish</b><small>{num(mo.completed)}/{num(mo.quantity)} · due {mo.due} · {mo.progress}%</small></span><StatusBadge>{mo.status}</StatusBadge></button>:<p className="soft-meta">Make-to-stock: tayyor mahsulot ombordan rezerv qilinadi.</p>}
      {shipments.length?<div className="stack-list">{shipments.map(m=><div className="list-row" key={m.id}><span className="list-row-copy"><b>{productName(s,m.itemId)} · {num(-m.qty)}</b><small>{m.date} · {warehouseName(s,m.warehouseId)}{m.lot?` · ${m.lot}`:''}</small></span>{m.lot&&<button type="button" className="ghost-btn" onClick={()=>navigate(`/reports?view=traceability&q=${encodeURIComponent(m.lot!.split('…')[0])}`)}>Trace</button>}</div>)}</div>:open?<Empty compact title="Hali jo‘natilmagan"/>:null}
    </>}
    {tab==='finance'&&<div className="form-stack">
      <OrderReceivableInfo so={so}/>
      <div className="form-grid">
        {/* An invoiced order's payment status follows its ledger; only an order from before the ledger keeps a typed status. */}
        <Field label="To‘lov holati" hint={ledgerStatus?'To‘lovlardan hisoblanadi':'Ledgerdan oldingi buyurtma'}><Select value={paymentStatusOf(s,so)} disabled={!canEdit||so.status==='Bekor'||Boolean(ledgerStatus)} onChange={v=>app.updateSalesMeta(so.id,{paymentStatus:v})}>{['To‘lanmagan','Qisman','To‘langan'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
        <Field label="Yetkazish sanasi"><Input type="date" value={so.deliveryDate} disabled={!canEdit||!open} onChange={e=>e.target.value&&app.updateSalesMeta(so.id,{deliveryDate:e.target.value})}/></Field>
      </div>
      <InfoGrid items={[{label:'Buyurtma summasi',value:money(so.total)},{label:'Mijoz qarzi (ledger)',value:money(customerBalance(s,so.customerId))}]}/>
      {canEdit&&customer&&ledgerStatus&&ledgerStatus!=='To‘langan'&&<div><button type="button" className="primary-glass-btn compact" onClick={()=>setPay(true)}><Icon name="wallet" size={15}/>To‘lov qabul qilish</button></div>}
    </div>}
    {pay&&customer&&<PaymentModal customer={customer} order={so} onClose={()=>setPay(false)}/>}
    {tab==='returns'&&(returns.length?<div className="stack-list">{returns.map(r=><button type="button" key={r.id} className="list-row is-clickable" onClick={()=>navigate(`/sales?view=returns&id=${r.id}`)}><span className="list-row-copy"><b>{r.code} · {productName(s,r.productId)} {num(r.qty)}</b><small>{r.reason}</small></span><StatusBadge>{r.status}</StatusBadge></button>)}</div>:<Empty compact title="Qaytarish yo‘q"/>)}
    {tab==='docs'&&<AttachmentsPanel entityType="sales" entityId={so.id} canEdit={canEdit}/>}
    {tab==='history'&&<ActivityPanel sources={[so.code]}/>}
    <Confirm open={cancel} onClose={()=>setCancel(false)} onConfirm={()=>app.cancelSalesOrder(so.id)} danger title={`${so.code} bekor qilinsinmi?`} text={`Rezerv qaytariladi.${mo?` Bog‘langan ${mo.code}: qoralama bo‘lsa bekor qilinadi, aks holda ombor uchun davom etadi.`:''}`} confirmText="Buyurtmani bekor qilish"/>
    <Confirm open={deliver} onClose={()=>setDeliver(false)} onConfirm={()=>app.deliverSalesOrder(so.id)} title="Yetkazib berish" text={`${so.items.map(i=>`${productName(s,i.productId)} × ${num(i.qty-i.delivered)}`).join(', ')} ombordan chiqim qilinadi (rezerv qilingan lotlar, keyin FEFO).`} confirmText="Yetkazildi"/>
    {ret&&<ReturnModal defaultSo={so.id} onClose={()=>setRet(false)}/>}
  </Drawer>
}

function Customers(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[type,setType]=useSearchParamState('type')
  const [id,setId]=useRecordParam()
  const [edit,setEdit]=useState<Customer|null|'new'>(null)
  const rows=s.customers.filter(c=>!type||c.type===type)
  const customer=s.customers.find(c=>c.id===id)
  return <div className="page-stack">
    <PageHeader title="Mijozlar" subtitle="Buyurtmalar, qaytarishlar va qarz" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('sales','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Mijoz qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Nomi, telefon, email..." onRow={c=>setId(c.id)} exportName="customers"
      filters={<FilterSelect label="Tur" value={type} onChange={setType} options={[...new Set(s.customers.map(c=>c.type))]}/>} filtersActive={Boolean(type)} onResetFilters={()=>setType('')}
      columns={[
        {key:'name',label:'Mijoz',value:c=>c.name,render:c=><div className="cell-main"><b>{c.name}</b><small>{c.phone}{c.email?` · ${c.email}`:''}</small></div>},
        {key:'type',label:'Tur',value:c=>c.type},
        {key:'status',label:'Status',value:c=>c.status,render:c=><StatusBadge>{c.status}</StatusBadge>},
        {key:'orders',label:'Buyurtmalar',align:'right',value:c=>s.salesOrders.filter(o=>o.customerId===c.id).length},
        {key:'revenue',label:'Savdo hajmi',align:'right',value:c=>s.salesOrders.filter(o=>o.customerId===c.id&&o.status!=='Bekor').reduce((a,o)=>a+o.total,0),render:c=>compactMoney(s.salesOrders.filter(o=>o.customerId===c.id&&o.status!=='Bekor').reduce((a,o)=>a+o.total,0))},
        {key:'debt',label:'Qarz',align:'right',value:c=>customerBalance(s,c.id),render:c=>money(customerBalance(s,c.id))},
      ]}/>
    {edit&&<CustomerModal customer={edit==='new'?undefined:edit} onClose={()=>setEdit(null)}/>}
    {customer&&<CustomerDrawer key={customer.id} customer={customer} onClose={()=>setId(null)} onEdit={()=>setEdit(customer)}/>}
  </div>
}

function CustomerModal({customer,onClose}:{customer?:Customer;onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({name:customer?.name||'',phone:customer?.phone||'+998 ',email:customer?.email||'',type:customer?.type||'B2B',status:customer?.status||'Faol',debt:''},v=>({name:required(v.name,'Nomi')||(s.customers.some(c=>c.id!==customer?.id&&c.name.toLowerCase()===v.name.trim().toLowerCase())?'Bu mijoz mavjud':undefined),phone:/\d{7,}/.test(v.phone.replace(/\D/g,''))?undefined:'Telefonni to‘liq kiriting',email:v.email&&!/^\S+@\S+\.\S+$/.test(v.email)?'Email noto‘g‘ri':undefined,debt:!v.debt||Number(v.debt)>=0?undefined:'Qarz manfiy bo‘lmasin'}))
  return <Modal open onClose={onClose} title={customer?'Mijozni tahrirlash':'Yangi mijoz'} size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const payload={name:v.name.trim(),phone:v.phone.trim(),email:v.email.trim()||undefined,type:v.type,status:v.status,...(customer?{}:{debt:Number(v.debt)||0})};const r=customer?app.updateEntity('customers',customer.id,payload):app.createEntity('customers',payload);if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Telefon" required error={form.error('phone')}><Input type="tel" {...form.input('phone')}/></Field>
      <Field label="Email" error={form.error('email')}><Input type="email" {...form.input('email')}/></Field>
      <Field label="Tur"><Select value={form.values.type} onChange={v=>form.set('type',v)}>{['B2B','Diler','Distribyutor','B2C'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Status"><Select value={form.values.status} onChange={v=>form.set('status',v)}><option value="Faol">Faol</option><option value="Arxiv">Arxiv</option></Select></Field>
      {customer?<Field label="Qarz (ledger)" hint="To‘lov, qaytarish yoki tasdiqlangan tuzatish orqali o‘zgaradi"><Input readOnly value={money(customerBalance(s,customer.id))}/></Field>
        :<Field label="Boshlang‘ich qarz" hint="Ixtiyoriy · ledgerga boshlang‘ich qoldiq bo‘lib yoziladi" error={form.error('debt')}><MoneyInput min="0" {...form.money('debt')}/></Field>}
    </div>
  </Modal>
}

function CustomerDrawer({customer,onClose,onEdit}:{customer:Customer;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [remove,setRemove]=useState(false),[order,setOrder]=useState(false),[pay,setPay]=useState(false),[adjust,setAdjust]=useState(false),[tab,setTab]=useState('orders')
  const balance=customerBalance(s,customer.id)
  const orders=s.salesOrders.filter(o=>o.customerId===customer.id)
  const returns=s.returns.filter(r=>r.customerId===customer.id)
  const blocker=referenceBlocker(s,'customers',customer.id)
  const customerLedgerCount=(s.receivables||[]).filter(e=>e.customerId===customer.id).length
  return <Drawer open onClose={onClose} title={customer.name} eyebrow="Mijoz" icon="users" size="lg" subtitle={`${customer.phone}${customer.email?` · ${customer.email}`:''} · ${customer.type}`} headerExtra={<StatusBadge>{customer.status}</StatusBadge>}
    actions={<>{app.can('sales','delete')&&<button type="button" className="ghost-btn" onClick={()=>setRemove(true)}><Icon name="trash" size={15}/>O‘chirish</button>}<span className="spacer"/>{app.can('sales','create')&&customer.status==='Faol'&&<button type="button" className="secondary-glass-btn" onClick={()=>setOrder(true)}><Icon name="plus" size={15}/>Yangi buyurtma</button>}{app.can('sales','edit')&&<button type="button" className="primary-glass-btn" onClick={onEdit}><Icon name="edit" size={16}/>Tahrirlash</button>}</>}>
    <InfoGrid items={[{label:'Buyurtmalar',value:orders.length},{label:'Savdo hajmi',value:money(orders.filter(o=>o.status!=='Bekor').reduce((a,o)=>a+o.total,0))},{label:'Ochiq',value:orders.filter(o=>OPEN_SO.includes(o.status)).length},{label:'Qarz (ledger)',value:money(balance),tone:balance>0.005?'warning':undefined},{label:'Qaytarishlar',value:returns.length}]}/>
    <div className="form-actions">{app.can('sales','edit')&&<button type="button" className="secondary-glass-btn compact" disabled={balance<=0.005} title={balance<=0.005?'Ochiq qarz yo‘q':undefined} onClick={()=>setPay(true)}><Icon name="wallet" size={15}/>To‘lov qabul qilish</button>}{app.can('sales','approve')&&<button type="button" className="ghost-btn compact" onClick={()=>setAdjust(true)}><Icon name="edit" size={15}/>Qarzni tuzatish</button>}</div>
    <Tabs items={[{value:'orders',label:'Buyurtmalar',count:orders.length},{value:'ledger',label:'Qarz tarixi',count:customerLedgerCount}]} active={tab} onChange={setTab}/>
    {tab==='ledger'?<LedgerList customerId={customer.id}/>:orders.length?<div className="stack-list">{orders.map(o=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/sales?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code}</b><small>{o.items.map(i=>`${productName(s,i.productId)} ${num(i.qty)}`).join(', ')} · {o.deliveryDate}</small></span><span className="list-row-meta"><b>{compactMoney(o.total)}</b><StatusBadge>{paymentStatusOf(s,o)}</StatusBadge><StatusBadge>{o.status}</StatusBadge></span></button>)}</div>:<Empty compact title="Buyurtma yo‘q"/>}
    {pay&&<PaymentModal customer={customer} onClose={()=>setPay(false)}/>}
    {adjust&&<AdjustModal customer={customer} onClose={()=>setAdjust(false)}/>}
    <AttachmentsPanel entityType="customer" entityId={customer.id} canEdit={app.can('sales','edit')}/>
    {order&&<SalesFormModal customerId={customer.id} onClose={()=>setOrder(false)}/>}
    <Confirm open={remove} onClose={()=>setRemove(false)} onConfirm={()=>{if(app.deleteEntity('customers',customer.id).ok)onClose()}} danger title="Mijoz o‘chirilsinmi?" text={blocker?`O‘chirib bo‘lmaydi: ${blocker}. Status’ni “Arxiv” qiling.`:'Mijoz butunlay o‘chiriladi.'} confirmText="O‘chirish"/>
  </Drawer>
}

function Delivery(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [confirm,setConfirm]=useState<SalesOrder|null>(null)
  const rows=s.salesOrders.filter(o=>OPEN_SO.includes(o.status)).sort((a,b)=>a.deliveryDate.localeCompare(b.deliveryDate))
  return <div className="page-stack">
    <PageHeader title="Yetkazib berish" subtitle="Sana bo‘yicha navbat · lot FIFO"/>
    {rows.length?<div className="card flush"><div className="table-scroll"><table className="delivery-table"><thead><tr><th>Buyurtma</th><th>Mahsulot</th><th className="align-right">Yetkaziladi</th><th className="align-right">Rezerv</th><th className="align-right">Available</th><th>Sana</th><th>Holat</th><th className="align-right">Amal</th></tr></thead><tbody>
      {rows.map(o=>{const ready=o.items.some(i=>(i.reserved||0)+salesAvailable(s,app.currentEmployee,i.productId,todayISO(),i.variantId)>0);const late=o.deliveryDate<todayISO();return o.items.map((i,idx)=><tr key={o.id+i.productId} className={cls(idx===0&&'group-start',late&&'row-danger')}>
        {idx===0&&<td rowSpan={o.items.length}><div className="cell-main"><button type="button" className="link-btn" onClick={()=>navigate(`/sales?view=orders&id=${o.id}`)}><b>{o.code}</b></button><small>{customerName(s,o.customerId)} · {o.mode}</small></div></td>}
        <td>{productName(s,i.productId)}</td>
        <td className="align-right"><b>{num(i.qty-i.delivered)}</b></td>
        <td className="align-right">{num(i.reserved||0)}</td>
        <td className="align-right">{num(salesAvailable(s,app.currentEmployee,i.productId,todayISO(),i.variantId))}</td>
        {idx===0&&<td rowSpan={o.items.length} className={late?'negative':undefined}>{o.deliveryDate}</td>}
        {idx===0&&<td rowSpan={o.items.length}><StatusBadge tone={late?'danger':ready?'success':'warning'}>{late?'Kechikkan':ready?'Tayyor':o.status}</StatusBadge></td>}
        {idx===0&&<td rowSpan={o.items.length} className="align-right"><button type="button" className="primary-glass-btn compact" disabled={!ready||!app.can('sales','edit')} title={ready?undefined:'Yetkazish uchun available yoki rezerv stock yo‘q'} onClick={()=>setConfirm(o)}><Icon name="truck" size={14}/>Yetkazildi</button></td>}
      </tr>)})}
    </tbody></table></div></div>:<Card><Empty icon="check" title="Yetkaziladigan buyurtma yo‘q"/></Card>}
    {confirm&&<DeliveryModal order={confirm} onClose={()=>setConfirm(null)}/>}
  </div>
}

function DeliveryModal({order,onClose}:{order:SalesOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [amounts,setAmounts]=useState<Record<string,string>>(()=>Object.fromEntries(order.items.map(i=>[i.productId,String(i.qty-i.delivered)])))
  const errors=order.items.map(i=>{const open=i.qty-i.delivered,v=Number(amounts[i.productId]||0);return !Number.isFinite(v)||v<0||v>open?`${productName(s,i.productId)}: 0–${open}`:null}).filter(Boolean)
  const total=order.items.reduce((a,i)=>a+(Number(amounts[i.productId])||0),0)
  const save=()=>{if(errors.length||total<=0)return;const r=app.deliverSalesOrder(order.id,Object.fromEntries(order.items.map(i=>[i.productId,Number(amounts[i.productId])||0])));if(r.ok)onClose()}
  return <Modal open onClose={onClose} title="Yetkazib berish" eyebrow={order.code} subtitle="Qisman yoki to‘liq yetkazish · rezerv avval ishlatiladi" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={Boolean(errors.length)||total<=0||!app.can('sales','edit')} onClick={save}><Icon name="truck" size={15}/>Yetkazishni tasdiqlash</button></>}>
    <div className="stack-list">{order.items.map(i=>{const open=i.qty-i.delivered,available=salesAvailable(s,app.currentEmployee,i.productId,todayISO(),i.variantId);return <div className="list-row" key={i.productId}><span className="list-row-copy"><b>{productName(s,i.productId)}</b><small>Qolgan {num(open)} · rezerv {num(i.reserved||0)} · available {num(available)}</small></span><div style={{width:120}}><Input type="number" min="0" max={open} step="1" value={amounts[i.productId]||''} onChange={e=>setAmounts(x=>({...x,[i.productId]:e.target.value}))}/></div></div>})}</div>
    {errors.length>0&&<div className="inline-note warning"><Icon name="warning"/>{errors[0]}</div>}
  </Modal>
}

function ReturnModal({defaultSo,onClose}:{defaultSo?:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const delivered=s.salesOrders.filter(o=>o.items.some(i=>i.delivered>0))
  const form=useForm({salesOrderId:defaultSo||delivered[0]?.id||'',productId:'',qty:'1',reason:''},v=>{const so=s.salesOrders.find(o=>o.id===v.salesOrderId);const line=so?.items.find(i=>i.productId===(v.productId||so?.items[0]?.productId));const returned=s.returns.filter(r=>r.salesOrderId===v.salesOrderId&&r.productId===line?.productId).reduce((a,r)=>a+r.qty,0);const max=(line?.delivered||0)-returned;return {salesOrderId:so?undefined:'Buyurtma tanlang',qty:!(Number(v.qty)>0)?'Miqdor kiriting':Number(v.qty)>max?`Maksimum ${max}`:undefined,reason:required(v.reason,'Sabab')}})
  const so=s.salesOrders.find(o=>o.id===form.values.salesOrderId)
  const productId=form.values.productId||so?.items[0]?.productId||''
  // Serial-tracked units come back by their numbers: the units this order shipped and no return took back (audit #25).
  const units=so&&serialTracked(s,productId)?returnSources(s,so,productId,0).units:[]
  const [serials,setSerials]=useState<string[]>([])
  const serialError=units.length&&serials.length!==Number(form.values.qty)?`${form.values.qty} ta serial tanlang (${serials.length})`:undefined
  return <Modal open onClose={onClose} title="Mijoz qaytarishi" subtitle="Inspection → omborga / rework / scrap" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={Boolean(serialError)} onClick={()=>form.submit(v=>{const r=app.createReturn({salesOrderId:v.salesOrderId,productId,qty:Number(v.qty),reason:v.reason,...(units.length?{serials}:{})});if(r.ok)onClose();return r.ok})}>Inspectionga yuborish</button></>}>
    {delivered.length?<div className="form-grid">
      <Field label="Sales order" required error={form.error('salesOrderId')}><Select value={form.values.salesOrderId} onChange={v=>{form.set('salesOrderId',v);form.set('productId','')}}>{delivered.map(o=><option key={o.id} value={o.id}>{o.code} · {customerName(s,o.customerId)}</option>)}</Select></Field>
      <Field label="Mahsulot"><Select value={productId} onChange={v=>form.set('productId',v)}>{(so?.items||[]).filter(i=>i.delivered>0).map(i=><option key={i.productId} value={i.productId}>{productName(s,i.productId)} · {num(i.delivered)} yetkazilgan</option>)}</Select></Field>
      <Field label="Miqdor" required error={form.error('qty')}><Input type="number" min="1" {...form.input('qty')}/></Field>
      {units.length>0&&<div className="field span-2"><label>Qaytarilayotgan serial raqamlar {serialError?<small className="field-error">{serialError}</small>:null}</label>
        <div className="badge-row">{units.map(code=><Checkbox key={code} label={code} checked={serials.includes(code)} onChange={on=>setSerials(x=>on?[...x,code]:x.filter(c=>c!==code))}/>)}</div></div>}
      <Field className="span-2" label="Sabab" required error={form.error('reason')}><Textarea {...form.input('reason')} placeholder="Nuqson tavsifi"/></Field>
    </div>:<Empty compact title="Yetkazilgan buyurtma yo‘q"/>}
  </Modal>
}

function Returns(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status')
  const [id,setId]=useRecordParam()
  const [create,setCreate]=useState(false),[check,setCheck]=useState<string|null>(null)
  const [decide,setDecide]=useState<{ret:CustomerReturn;decision:'Omborga qaytarildi'|'Rework'|'Scrap'}|null>(null)
  const rows=s.returns.filter(r=>!status||r.status===status)
  const selected=s.returns.find(r=>r.id===id)
  return <div className="page-stack">
    <PageHeader title="Qaytarishlar" subtitle="Inspection → omborga · rework · scrap"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('sales','create')&&!app.can('quality','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Qaytarish qabul qilish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="RET, mijoz, mahsulot, lot..." onRow={r=>setId(r.id)} exportName="returns"
      filters={<FilterSelect label="Holat" value={status} onChange={setStatus} options={['Inspection','Omborga qaytarildi','Rework','Scrap']}/>} filtersActive={Boolean(status)} onResetFilters={()=>setStatus('')}
      emptyText="Yetkazilgan buyurtma bo‘yicha qaytarish qabul qiling"
      columns={[
        {key:'code',label:'Qaytarish',value:r=>r.code,render:r=><div className="cell-main"><b>{r.code}</b><small>{r.createdAt}</small></div>},
        {key:'customer',label:'Mijoz',value:r=>customerName(s,r.customerId)},
        {key:'product',label:'Mahsulot',value:r=>productName(s,r.productId),render:r=><span>{productName(s,r.productId)} × {num(r.qty)}<small className="cell-sub">{r.lot||'—'}</small></span>},
        {key:'reason',label:'Sabab',value:r=>r.reason,render:r=><span className="truncate">{r.reason}</span>},
        {key:'status',label:'Holat',value:r=>r.status,render:r=><StatusBadge>{r.status}</StatusBadge>},
      ]}/>
    {selected&&<Drawer open onClose={()=>setId(null)} title={selected.code} eyebrow="Customer return" icon="undo" size="md" subtitle={`${customerName(s,selected.customerId)} · ${s.salesOrders.find(o=>o.id===selected.salesOrderId)?.code}`} headerExtra={<StatusBadge>{selected.status}</StatusBadge>}
      actions={selected.status==='Inspection'&&app.can('quality','edit')?<><button type="button" className="danger-glass-btn" onClick={()=>setDecide({ret:selected,decision:'Scrap'})}>Scrap</button><button type="button" className="warning-glass-btn" onClick={()=>setDecide({ret:selected,decision:'Rework'})}>Rework</button><span className="spacer"/><button type="button" className="primary-glass-btn" onClick={()=>setDecide({ret:selected,decision:'Omborga qaytarildi'})}><Icon name="check" size={16}/>Yaroqli — omborga</button></>:undefined}>
      <InfoGrid items={[{label:'Mahsulot',value:productName(s,selected.productId)},{label:'Miqdor',value:num(selected.qty)},{label:'Lot',value:selected.lot},{label:'Sana',value:selected.createdAt}]}/>
      <div className="inline-note"><Icon name="info"/>{selected.reason}</div>
      {selected.qualityCheckId&&<button type="button" className="list-row is-clickable" onClick={()=>setCheck(selected.qualityCheckId!)}><span className="list-row-copy"><b>Inspection</b><small>{s.qualityChecks.find(q=>q.id===selected.qualityCheckId)?.reason}</small></span><StatusBadge>{s.qualityChecks.find(q=>q.id===selected.qualityCheckId)?.status||'—'}</StatusBadge></button>}
      {selected.reworkOrderId&&<p className="soft-meta">Rework MO: {s.productionOrders.find(o=>o.id===selected.reworkOrderId)?.code}</p>}
      <ActivityPanel sources={[selected.code]}/>
    </Drawer>}
    {create&&<ReturnModal onClose={()=>setCreate(false)}/>}
    <QualityResolveModal checkId={check} onClose={()=>setCheck(null)}/>
    <Confirm open={!!decide} onClose={()=>setDecide(null)} onConfirm={()=>decide&&app.dispositionReturn(decide.ret.id,decide.decision)} danger={decide?.decision==='Scrap'} title={`Qaror: ${decide?.decision}`} text={decide?.decision==='Omborga qaytarildi'?'Mahsulot tayyor mahsulot omboriga “Return +” bilan kirim qilinadi.':decide?.decision==='Rework'?'Mahsulot QC/Rework hold holatida omborga olinadi; sotuv uchun available bo‘lmaydi. Rework buyurtmasi (MO) ochiladi.':'Mahsulot omborga olinmaydi, inspection Scrap bilan yopiladi.'} confirmText="Tasdiqlash"/>
  </div>
}
