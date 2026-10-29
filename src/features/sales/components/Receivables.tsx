import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,Field,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,ResourceTable,Select,StatusBadge,Textarea,useForm,useSearchParamState} from '../../../shared/ui'
import type {Customer,ManufacturingState,ReceivableEntry,SalesOrder} from '../../../types'
import {PAYMENT_METHODS,RECEIVABLE_KINDS,customerBalance,customerLedger,orderReceivable,receivableAging,returnCreditGap} from '../../../domain/receivables'
import {daysBetween,todayISO} from '../../../utils/dates'
import {compactMoney,money} from '../../../utils/format'
import {customerName} from '../../common/lookups'
import {BarList} from '../../common/charts'

const submitKey=(p:string)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`
const docOf=(s:ManufacturingState,e:ReceivableEntry)=>[s.salesOrders.find(o=>o.id===e.salesOrderId)?.code,s.returns.find(r=>r.id===e.returnId)?.code].filter(Boolean).join(' · ')

/**
 * Receives a customer payment (audit #19): against one order, or applied to the oldest open invoices. The key is made
 * once per open form, so a double click or a retried save cannot reduce the debt twice.
 */
export function PaymentModal({customer,order,onClose}:{customer:Customer;order?:SalesOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [key]=useState(()=>submitKey('pay'))
  const open=order?orderReceivable(s,order.id).outstanding:customerBalance(s,customer.id)
  const form=useForm({amount:open>0?String(open):'',method:PAYMENT_METHODS[0],note:''},v=>{const n=Number(v.amount);return {amount:!(n>0)?'Summa 0 dan katta bo‘lsin':n>open+0.005?`Ochiq qarzdan oshmasin (${money(open)})`:undefined}})
  return <Modal open onClose={onClose} title="To‘lov qabul qilish" eyebrow={customer.name} subtitle={order?`${order.code} · ochiq ${money(open)}`:`Ochiq qarz ${money(open)} · eng eski hisob-fakturalarga taqsimlanadi`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={open<=0.005} onClick={()=>form.submit(v=>{const r=app.recordCustomerPayment({customerId:customer.id,amount:Number(v.amount),key,salesOrderId:order?.id,method:v.method,note:v.note});if(r.ok)onClose();return r.ok})}><Icon name="check" size={16}/>To‘lovni qayd etish</button></>}>
    {open<=0.005?<div className="inline-note"><Icon name="info"/>{order?'Bu buyurtma bo‘yicha hisob-faktura qilingan ochiq qarz yo‘q.':'Mijozning ochiq qarzi yo‘q.'}</div>:<div className="form-grid">
      <Field label="Summa" required error={form.error('amount')}><MoneyInput min="0" {...form.money('amount')} autoFocus/></Field>
      <Field label="Usul"><Select value={form.values.method} onChange={v=>form.set('method',v)}>{PAYMENT_METHODS.map(m=><option key={m} value={m}>{m}</option>)}</Select></Field>
      <Field className="span-2" label="Izoh"><Input {...form.input('note')} placeholder="To‘lov hujjati raqami"/></Field>
    </div>}
  </Modal>
}

/** Authorised correction: a signed ledger entry with its reason and actor; the balance itself is never typed over. */
export function AdjustModal({customer,onClose}:{customer:Customer;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [key]=useState(()=>submitKey('adj'))
  const balance=customerBalance(s,customer.id)
  const form=useForm({direction:'down',amount:'',reason:''},v=>({amount:Number(v.amount)>0?undefined:'Summa 0 dan katta bo‘lsin',reason:v.reason.trim().length>=5?undefined:'Sababni yozing (kamida 5 belgi)'}))
  const signed=(form.values.direction==='up'?1:-1)*(Number(form.values.amount)||0)
  return <Modal open onClose={onClose} title="Qarzni tuzatish" eyebrow={customer.name} subtitle={`Joriy qarz ${money(balance)} · tuzatish ledgerga alohida yozuv bo‘lib tushadi`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><span className="spacer"/><span className="soft-meta">Keyin: <b>{money(balance+signed)}</b></span><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.adjustCustomerBalance({customerId:customer.id,amount:(v.direction==='up'?1:-1)*Number(v.amount),reason:v.reason,key});if(r.ok)onClose();return r.ok})}>Tasdiqlash</button></>}>
    <div className="form-grid">
      <Field label="Yo‘nalish"><Select value={form.values.direction} onChange={v=>form.set('direction',v)}><option value="down">Qarzni kamaytirish (−)</option><option value="up">Qarzni oshirish (+)</option></Select></Field>
      <Field label="Summa" required error={form.error('amount')}><MoneyInput min="0" {...form.money('amount')}/></Field>
      <Field className="span-2" label="Sabab" required error={form.error('reason')}><Textarea {...form.input('reason')} placeholder="Masalan: akt-sverka № 12 bo‘yicha farq"/></Field>
    </div>
  </Modal>
}

/** A customer's ledger, oldest first, with the running balance after every entry. */
export function LedgerList({customerId}:{customerId:string}){
  const s=useApp().state
  const rows=customerLedger(s,customerId)
  if(!rows.length)return <Empty compact title="Qarz harakati yo‘q" text="Yetkazish hisob-faktura, to‘lov va qaytarish shu yerda ko‘rinadi"/>
  let running=0
  const lines=rows.map(e=>{running=Math.round((running+e.amount)*100)/100;return {e,running}})
  return <div className="table-scroll"><table className="fit"><thead><tr><th>Sana</th><th>Turi</th><th>Hujjat</th><th className="align-right">Summa</th><th className="align-right">Qoldiq</th><th>Kim</th></tr></thead><tbody>
    {lines.reverse().map(({e,running:r})=><tr key={e.id}>
      <td>{e.date}</td>
      <td><StatusBadge tone={e.amount<0?'success':e.kind==='adjustment'?'warning':'neutral'}>{RECEIVABLE_KINDS[e.kind]}</StatusBadge></td>
      <td><div className="cell-main"><b>{docOf(s,e)||'—'}</b><small>{[e.method,e.reason,e.note].filter(Boolean).join(' · ')}</small></div></td>
      <td className={`align-right ${e.amount<0?'positive':''}`}>{e.amount>0?'+':'−'}{money(Math.abs(e.amount))}</td>
      <td className="align-right"><b>{money(r)}</b></td>
      <td>{e.byName||e.by||'—'}</td>
    </tr>)}
  </tbody></table></div>
}

/** Order receivable summary (Sales drawer, payment tab). */
export function OrderReceivableInfo({so}:{so:SalesOrder}){
  const s=useApp().state
  const r=orderReceivable(s,so.id)
  return r.status?<InfoGrid columns={4} items={[{label:'Hisob-faktura',value:money(r.invoiced)},{label:'To‘langan',value:money(r.paid)},{label:'Kredit-nota',value:money(r.credited)},{label:'Ochiq qoldiq',value:money(r.outstanding),tone:r.outstanding>0.005?'warning':'success'}]}/>:<div className="inline-note"><Icon name="info"/>{so.status==='Bekor'?'Bekor qilingan — hisob-faktura yo‘q.':'Hisob-faktura yetkazilganda ledgerga yoziladi.'}</div>
}

/** Receivables register (Sales → Debitorlik): balances, ageing and every ledger entry, exportable as filtered. */
export function ReceivablesView(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[kind,setKind]=useSearchParamState('kind')
  const [pay,setPay]=useState<Customer|null>(null)
  const today=todayISO()
  const balances=s.customers.map(c=>({c,balance:customerBalance(s,c.id)}))
  const total=balances.reduce((a,x)=>a+Math.max(0,x.balance),0)
  const credit=balances.reduce((a,x)=>a+Math.min(0,x.balance),0)
  const aging=receivableAging(s,undefined,today,daysBetween)
  const entries=(s.receivables||[]).filter(e=>!kind||e.kind===kind)
  return <div className="page-stack">
    <PageHeader title="Debitorlik" subtitle="Qarz = boshlang‘ich qoldiq + hisob-fakturalar − to‘lovlar − kredit-notalar ± tasdiqlangan tuzatishlar"/>
    <div className="kpi-grid">
      <KPI label="Debitorlik qarzi" value={compactMoney(total)} sub={`${balances.filter(x=>x.balance>0.005).length} mijoz`} tone="purple" icon={<Icon name="wallet"/>}/>
      <KPI label="30 kundan eski" value={compactMoney(aging.slice(1).reduce((a,b)=>a+b.amount,0))} tone="pink" icon={<Icon name="clock"/>}/>
      <KPI label="Mijoz krediti" value={compactMoney(-credit)} sub="ortiqcha to‘lov / kredit-nota" tone="mint" icon={<Icon name="undo"/>}/>
      <KPI label="Ledger yozuvlari" value={(s.receivables||[]).length} icon={<Icon name="layers"/>}/>
    </div>
    <div className="split-even">
      <Card title="Mijozlar qarzi" subtitle="ledger bo‘yicha">
        {balances.some(x=>Math.abs(x.balance)>0.005)?<div className="stack-list">{balances.filter(x=>Math.abs(x.balance)>0.005).sort((a,b)=>b.balance-a.balance).map(({c,balance})=><div className="list-row" key={c.id}>
          <button type="button" className="list-row-copy link-btn" onClick={()=>navigate(`/sales?view=customers&id=${c.id}`)}><b>{c.name}</b><small>{c.type}</small></button>
          <span className="list-row-meta"><b className={balance<0?'positive':undefined}>{money(balance)}</b>{balance>0.005&&app.can('sales','edit')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>setPay(c)}>To‘lov</button>}</span>
        </div>)}</div>:<Empty compact title="Ochiq qarz yo‘q"/>}
      </Card>
      <Card title="Qarz yoshi" subtitle="eng eski hisob-fakturadan yopiladi">{total>0?<BarList rows={aging.map(a=>({label:a.label,value:a.amount}))} valueFormat={v=>compactMoney(v)}/>:<Empty compact title="Ochiq qarz yo‘q"/>}</Card>
    </div>
    <ResourceTable rows={entries} query={q} onQuery={setQ} placeholder="Mijoz, hujjat, sabab..." exportName={`zenix-debitorlik-${today}`} resetKey={kind}
      filters={<Select size="sm" ariaLabel="Turi" value={kind} onChange={setKind}><option value="">Barcha turlar</option>{Object.entries(RECEIVABLE_KINDS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</Select>} filtersActive={Boolean(kind)} onResetFilters={()=>setKind('')}
      emptyText="Yetkazish, to‘lov yoki qaytarish bo‘lganda ledger yozuvlari paydo bo‘ladi"
      columns={[
        {key:'date',label:'Sana',value:e=>e.date},
        {key:'customer',label:'Mijoz',value:e=>customerName(s,e.customerId)},
        {key:'kind',label:'Turi',value:e=>RECEIVABLE_KINDS[e.kind],render:e=><StatusBadge tone={e.amount<0?'success':e.kind==='adjustment'?'warning':'neutral'}>{RECEIVABLE_KINDS[e.kind]}</StatusBadge>},
        {key:'doc',label:'Hujjat',value:e=>docOf(s,e)},
        {key:'detail',label:'Izoh',value:e=>[e.method,e.reason,e.note].filter(Boolean).join(' · '),render:e=><span className="truncate">{[e.method,e.reason,e.note].filter(Boolean).join(' · ')}</span>,priority:'low'},
        {key:'amount',label:'Summa',align:'right',value:e=>e.amount,render:e=><span className={e.amount<0?'positive':undefined}>{money(e.amount)}</span>},
        {key:'by',label:'Kim',value:e=>e.byName||e.by,priority:'low'},
      ]}/>
    <LegacyReturnCredits/>
    {pay&&<PaymentModal customer={pay} onClose={()=>setPay(null)}/>}
  </div>
}

/**
 * Returns of orders invoiced before the ledger (Phase 5): their credit is never guessed. Each waits here — opened at
 * the return, or found for returns registered earlier — for an authorised decision (sales.approve): credit or no credit.
 */
function LegacyReturnCredits(){
  const app=useApp(),s=app.state
  const [pick,setPick]=useState<{returnId:string;decision:'credit'|'no-credit'}|null>(null)
  const recs=s.receivableReconciliations||[]
  const decided=new Set(recs.filter(r=>r.status!=='open').map(r=>r.returnId))
  const open=s.returns.filter(r=>!decided.has(r.id)).map(r=>({r,gap:returnCreditGap(s,r.id)})).filter(x=>x.gap>0.005)
  const done=recs.filter(r=>r.status!=='open')
  if(!open.length&&!done.length)return null
  const can=app.can('sales','approve')
  return <Card title="Eski buyurtmalar qaytarishi — kredit qarori" subtitle="Ledger’dan oldingi hisob-faktura: kredit-nota avtomatik yozilmaydi, qaror tasdiqlanadi">
    {!can&&<div className="inline-note warning"><Icon name="lock"/>Qaror uchun sales.approve ruxsati kerak.</div>}
    <div className="table-scroll"><table className="fit"><thead><tr><th>Qaytarish</th><th>Buyurtma</th><th>Mijoz</th><th className="align-right">Ochiq qiymat</th><th>Holat</th><th/></tr></thead><tbody>
      {open.map(({r,gap})=><tr key={r.id}><td>{r.code}</td><td>{s.salesOrders.find(o=>o.id===r.salesOrderId)?.code||'—'}</td><td>{customerName(s,r.customerId)}</td><td className="align-right">{money(gap)}</td><td><StatusBadge tone="warning">Qaror kutilmoqda</StatusBadge></td>
        <td className="align-right"><span className="inline-row"><button type="button" className="primary-glass-btn compact" disabled={!can} onClick={()=>setPick({returnId:r.id,decision:'credit'})}>Kredit-nota</button><button type="button" className="ghost-btn compact" disabled={!can} onClick={()=>setPick({returnId:r.id,decision:'no-credit'})}>Kreditsiz</button></span></td></tr>)}
      {done.map(x=><tr key={x.id} className="row-muted"><td>{s.returns.find(r=>r.id===x.returnId)?.code||'—'}</td><td>{s.salesOrders.find(o=>o.id===x.salesOrderId)?.code||'—'}</td><td>{customerName(s,x.customerId)}</td><td className="align-right">{money(x.credited||0)}</td><td><StatusBadge tone={x.status==='credited'?'success':'neutral'}>{x.status==='credited'?'Kreditlandi':'Kreditsiz'}</StatusBadge></td><td><small className="cell-sub">{x.reason}</small></td></tr>)}
    </tbody></table></div>
    {pick&&<ReturnCreditModal {...pick} onClose={()=>setPick(null)}/>}
  </Card>
}

function ReturnCreditModal({returnId,decision,onClose}:{returnId:string;decision:'credit'|'no-credit';onClose:()=>void}){
  const app=useApp(),s=app.state
  const r=s.returns.find(x=>x.id===returnId)
  const gap=returnCreditGap(s,returnId)
  const form=useForm({reason:''},v=>({reason:v.reason.trim().length>=5?undefined:'Sabab (kamida 5 belgi)'}))
  return <Modal open onClose={onClose} title={decision==='credit'?'Kredit-nota yozish':'Kreditsiz yopish'} subtitle={`${r?.code||''} · ${decision==='credit'?`${money(gap)} kredit`:'qarz o‘zgarmaydi'}`} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const x=app.resolveReturnCredit({returnId,decision,reason:v.reason});if(x.ok)onClose();return x.ok})}>Tasdiqlash</button></>}>
    <Field label="Sabab / asos" required error={form.error('reason')}><Textarea {...form.input('reason')} placeholder="Solishtirish dalolatnomasi, kelishuv..."/></Field>
  </Modal>
}
