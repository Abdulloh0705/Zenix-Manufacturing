import {useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Confirm,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,ResourceTable,Select,StatusBadge,positive,required,useForm,useSearchParamState} from '../../../shared/ui'
import type {Expense} from '../../../types'
import {orderCosting} from '../../../domain/manufacturingEngine'
import {customerBalance} from '../../../domain/receivables'
import {addDays,formatMinutes,periodStart,todayISO} from '../../../utils/dates'
import {cls,compactMoney,money,num} from '../../../utils/format'
import {productName} from '../../common/lookups'
import {BarList,StackedBar} from '../../common/charts'

export default function Costs(){
  const [sp]=useSearchParams(),view=sp.get('view')||'overview'
  if(view==='expenses')return <Expenses/>
  if(view==='costing')return <Costing/>
  if(view==='labor')return <Labor/>
  if(view==='machine')return <Machine/>
  if(view==='overhead')return <Overhead/>
  return <Overview/>
}

const TYPES:Expense['type'][]=['Electricity','Labor','Machine','Maintenance','Transport','Overhead']
const TYPE_LABEL:Record<Expense['type'],string>={Electricity:'Elektr energiya',Labor:'Mehnat',Machine:'Uskuna',Maintenance:'Maintenance',Transport:'Transport',Overhead:'Overhead'}

function Overview(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const since=periodStart(30)
  const expenses=s.expenses.filter(e=>e.date>=since)
  const total=expenses.reduce((a,e)=>a+e.amount,0)
  const receivable=s.customers.reduce((a,c)=>a+Math.max(0,customerBalance(s,c.id)),0)
  const done=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&(o.completedAt||'').slice(0,10)>=since).map(o=>({o,c:orderCosting(s,o)}))
  const actual=done.reduce((a,x)=>a+x.c.actual.total,0),planned=done.reduce((a,x)=>a+x.c.planned.total,0)
  const sum=(side:'planned'|'actual',k:'material'|'labor'|'machine'|'overhead')=>done.reduce((a,x)=>a+x.c[side][k],0)
  const waste=done.reduce((a,x)=>a+x.c.waste,0)
  const elements:Array<[string,number|null,number]>=[['Material',sum('planned','material'),sum('actual','material')],['Mehnat',sum('planned','labor'),sum('actual','labor')],['Uskuna',sum('planned','machine'),sum('actual','machine')],['Overhead',sum('planned','overhead'),sum('actual','overhead')]]
  const pct=(a:number,p:number)=>p?Math.round((a-p)/p*100):0
  return <div className="page-stack">
    <PageHeader title="Xarajatlar va tannarx" subtitle="Tannarx = material + mehnat + uskuna + overhead · 30 kun"/>
    <div className="kpi-grid">
      <KPI label="Ishlab chiqarish tannarxi" value={compactMoney(actual)} sub={`${done.length} yakunlangan MO`} tone="mfg" icon={<Icon name="factory"/>} onClick={()=>navigate('/costs?view=costing&status=closed&range=30')}/>
      <KPI label="Amalda vs standart" value={`${actual-planned>0?'+':''}${planned?pct(actual,planned):0}%`} sub={`${actual-planned>0?'+':''}${compactMoney(actual-planned)}`} deltaTone={actual>planned?'down':'up'} tone={actual>planned?'pink':'mint'} icon={<Icon name="chart"/>} onClick={()=>navigate('/reports?view=costs&days=30')}/>
      <KPI label="Scrap yo‘qotishi" value={compactMoney(waste)} sub={actual?`${(waste/actual*100).toFixed(1)}% tannarxdan`:undefined} tone="orange" icon={<Icon name="trash"/>} onClick={()=>navigate('/quality?view=scrap')}/>
      <KPI label="Davr xarajatlari" value={compactMoney(total)} sub={`${expenses.length} yozuv`} tone="purple" icon={<Icon name="wallet"/>} onClick={()=>navigate('/costs?view=expenses')}/>
      {/* Receivables: the same ledger balance as the customer card and Sales (audit #19). */}
      <KPI label="Debitorlik qarzi" value={compactMoney(receivable)} sub="mijozlar · ledger" tone="orange" icon={<Icon name="users"/>} onClick={app.can('sales','view')?()=>navigate('/sales?view=receivables'):undefined}/>
    </div>
    <div className="split-even">
      <Card title="Tannarx tarkibi" subtitle="standart vs amalda · yakunlangan MO">
        {done.length?<>
          <StackedBar title="Amaldagi tannarx tarkibi" segments={elements.map(([label,,a],i)=>({label,value:Math.round(a),slot:i+1}))} format={v=>compactMoney(v)}/>
          <div className="table-scroll cost-compare"><table className="fit"><thead><tr><th>Element</th><th className="align-right">Standart</th><th className="align-right">Amalda</th><th className="align-right">Farq</th></tr></thead><tbody>
            {elements.map(([label,p,a])=><tr key={label}><td>{label}</td><td className="align-right">{compactMoney(p||0)}</td><td className="align-right">{compactMoney(a)}</td><td className="align-right"><VarianceCell pct={pct(a,p||0)}/></td></tr>)}
            <tr><td>Waste (scrap)</td><td className="align-right muted">—</td><td className="align-right">{compactMoney(waste)}</td><td className="align-right muted">ichida</td></tr>
            <tr className="total"><td>Jami</td><td className="align-right">{compactMoney(planned)}</td><td className="align-right">{compactMoney(actual)}</td><td className="align-right"><VarianceCell pct={pct(actual,planned)}/></td></tr>
          </tbody></table></div>
        </>:<Empty compact title="Yakunlangan MO yo‘q" text="30 kun ichida yakunlangan buyurtma tannarxi shu yerda"/>}
      </Card>
      <Card title="Variance · MO" subtitle="amalda − standart" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/costs?view=costing&status=closed&range=30')}>Costing <Icon name="chevron" size={13}/></button>}>{done.length?<div className="stack-list">{done.sort((a,b)=>Math.abs(b.c.variance)-Math.abs(a.c.variance)).map(({o,c})=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/production?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>{money(c.actual.total)} · birlik {money(c.unitCost)}</small></span><VarianceCell pct={c.variancePct}/></button>)}</div>:<Empty compact title="Yakunlangan MO yo‘q"/>}</Card>
    </div>
    <Card title="Davr xarajatlari" subtitle="30 kun · tur bo‘yicha" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/costs?view=expenses')}>Xarajatlar <Icon name="chevron" size={13}/></button>}>{total?<BarList rows={TYPES.map(t=>({label:TYPE_LABEL[t],value:expenses.filter(e=>e.type===t).reduce((a,e)=>a+e.amount,0)})).filter(r=>r.value>0).sort((a,b)=>b.value-a.value)} valueFormat={v=>compactMoney(v)}/>:<Empty compact title="Xarajat yo‘q"/>}</Card>
  </div>
}

/** Actual vs standard at a glance: signed %, red when over, green when under, muted when on standard. */
function VarianceCell({pct}:{pct:number}){
  return <b className={cls('variance',pct>2?'negative':pct<-2?'positive':'muted')}>{pct>0?'+':''}{pct}%</b>
}

function ExpenseModal({expense,onClose}:{expense?:Expense;onClose:()=>void}){
  const app=useApp(),s=app.state
  const sources=[{value:'manual',label:'Umumiy (manual)'},...s.productionLines.map(l=>({value:l.id,label:l.name})),...s.equipment.map(e=>({value:e.id,label:e.name})),...s.branches.map(b=>({value:b.id,label:b.name}))]
  const form=useForm({date:expense?.date||todayISO(),type:expense?.type||'Electricity',sourceId:expense?.sourceId||'manual',branchId:expense?.branchId||s.branches.find(b=>b.id===s.settings.defaultBranchId)?.id||s.branches[0]?.id||'',amount:String(expense?.amount??''),note:expense?.note||''},v=>({branchId:v.branchId?undefined:'Filialni tanlang',amount:positive(v.amount,'Summa'),note:required(v.note,'Izoh'),date:v.date>todayISO()?'Kelajak sana':undefined}))
  return <Modal open onClose={onClose} title={expense?'Xarajatni tahrirlash':'Yangi xarajat'} size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const payload={...v,amount:Number(v.amount),note:v.note.trim()};const r=expense?app.updateEntity('expenses',expense.id,payload):app.createEntity('expenses',payload);if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <div className="form-grid">
      <Field label="Sana" error={form.error('date')}><Input type="date" {...form.input('date')}/></Field>
      <Field label="Tur"><Select value={form.values.type} onChange={v=>form.set('type',v as Expense['type'])}>{TYPES.map(t=><option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select></Field>
      <Field label="Manba (cost center)"><Select value={form.values.sourceId} onChange={v=>form.set('sourceId',v)}>{sources.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
      <Field label="Filial" required error={form.error('branchId')}><Select value={form.values.branchId} onChange={v=>form.set('branchId',v)}>{s.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <Field label="Summa" required error={form.error('amount')}><MoneyInput min="0" {...form.money('amount')}/></Field>
      <Field className="span-2" label="Izoh" required error={form.error('note')}><Input {...form.input('note')}/></Field>
    </div>
  </Modal>
}

function Expenses(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[type,setType]=useSearchParamState('type'),[range,setRange]=useSearchParamState('range','30')
  const [edit,setEdit]=useState<Expense|null|'new'>(null),[remove,setRemove]=useState<Expense|null>(null)
  const since=addDays(todayISO(),-Number(range||30))
  const rows=s.expenses.filter(e=>(!type||e.type===type)&&(range==='all'||e.date>=since))
  const sourceName=(id:string)=>s.productionLines.find(l=>l.id===id)?.name||s.equipment.find(e=>e.id===id)?.name||s.branches.find(b=>b.id===id)?.name||s.customers.find(c=>c.id===id)?.name||s.subcontractOrders.find(o=>o.id===id)?.code||(id==='manual'?'Umumiy':id)
  return <div className="page-stack">
    <PageHeader title="Xarajatlar" subtitle="Cost center bo‘yicha · maintenance va subcontract avtomatik" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('costs','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Xarajat qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Izoh, manba..." onRow={e=>app.can('costs','edit')&&setEdit(e)} exportName="expenses" resetKey={`${type}|${range}`} initialSort={{key:'date',dir:-1}}
      filtersActive={Boolean(type)||range!=='30'} onResetFilters={()=>{setType('');setRange('30')}}
      filters={<><FilterSelect label="Davr" value={range} onChange={setRange} defaultValue="30" options={[{value:'7',label:'7 kun'},{value:'30',label:'30 kun'},{value:'90',label:'90 kun'},{value:'all',label:'Butun davr'}]}/><FilterSelect label="Tur" value={type} onChange={setType} options={TYPES.map(t=>({value:t,label:TYPE_LABEL[t]}))}/></>}
      columns={[
        {key:'date',label:'Sana',value:e=>e.date},
        {key:'type',label:'Tur',value:e=>TYPE_LABEL[e.type],render:e=><StatusBadge tone="info">{TYPE_LABEL[e.type]}</StatusBadge>},
        {key:'source',label:'Manba',value:e=>sourceName(e.sourceId)},
        {key:'note',label:'Izoh',value:e=>e.note},
        {key:'amount',label:'Summa',align:'right',value:e=>e.amount,render:e=><b>{money(e.amount)}</b>},
        {key:'del',label:'',sortable:false,searchable:false,render:e=>app.can('costs','delete')?<button type="button" className="icon-ghost danger" aria-label="Xarajatni o‘chirish" onClick={()=>setRemove(e)}><Icon name="trash" size={15}/></button>:null},
      ]}/>
    <p className="soft-meta">Jami: <b>{money(rows.reduce((a,e)=>a+e.amount,0))}</b></p>
    {edit&&<ExpenseModal expense={edit==='new'?undefined:edit} onClose={()=>setEdit(null)}/>}
    <Confirm open={!!remove} onClose={()=>setRemove(null)} onConfirm={()=>remove&&app.deleteEntity('expenses',remove.id)} danger title="Xarajat o‘chirilsinmi?" text={`${remove?.note} · ${money(remove?.amount||0)}`} confirmText="O‘chirish"/>
  </div>
}

function Costing(){
  const s=useApp().state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[range,setRange]=useSearchParamState('range')
  const since=range?periodStart(Number(range)):''
  // Period = completion day for finished orders, otherwise start (or creation) day.
  const rows=s.productionOrders.filter(o=>o.status!=='Bekor qilingan'&&(!status||(status==='closed'?o.status==='Yakunlangan':o.status!=='Yakunlangan'))&&(o.completedAt||o.startedAt||o.createdAt).slice(0,10)>=since).map(o=>({...o,c:orderCosting(s,o)}))
  const actual=rows.reduce((a,o)=>a+o.c.actual.total,0),standard=rows.reduce((a,o)=>a+o.c.earned,0)
  return <div className="page-stack">
    <PageHeader title="Production costing" subtitle="MO bo‘yicha standart va amalda · ochiqlari bajarilgan hajmga nisbatan · waste = scrap birliklarga tushgan ulush"/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="MO, mahsulot..." onRow={o=>navigate(`/production?view=orders&id=${o.id}`)} exportName="production-costing"
      filters={<><FilterSelect label="Holat" value={status} onChange={setStatus} options={[{value:'closed',label:'Yakunlangan'},{value:'open',label:'Ochiq'}]}/><FilterSelect label="Davr" value={range} onChange={setRange} allLabel="Butun davr" options={[{value:'7',label:'7 kun'},{value:'30',label:'30 kun'},{value:'90',label:'90 kun'}]}/></>} filtersActive={Boolean(status||range)} onResetFilters={()=>{setStatus('');setRange('')}} resetKey={`${status}|${range}`}
      rowClassName={o=>o.c.variancePct>5?'row-danger':undefined}
      columns={[
        {key:'code',label:'MO',value:o=>o.code,render:o=><div className="cell-main"><b>{o.code}</b><small>{productName(s,o.productId)} · {num(o.completed)}/{num(o.quantity)}</small></div>},
        {key:'material',label:'Material',align:'right',value:o=>o.c.actual.material,render:o=>compactMoney(o.c.actual.material)},
        {key:'labor',label:'Mehnat',align:'right',value:o=>o.c.actual.labor,render:o=>compactMoney(o.c.actual.labor)},
        {key:'machine',label:'Uskuna',align:'right',value:o=>o.c.actual.machine,render:o=>compactMoney(o.c.actual.machine)},
        {key:'energy',label:'Energiya',align:'right',value:o=>o.c.actual.energy,render:o=>o.c.actual.energy?compactMoney(o.c.actual.energy):<span className="muted" title="Work center energiya tarifi kiritilmagan">—</span>,priority:'low'},
        {key:'overhead',label:'Overhead',align:'right',value:o=>o.c.actual.overhead,render:o=>compactMoney(o.c.actual.overhead),priority:'low'},
        {key:'waste',label:'Waste',align:'right',value:o=>o.c.waste,render:o=>o.c.waste?<span className="negative">{compactMoney(o.c.waste)}</span>:<span className="muted">—</span>,priority:'low'},
        {key:'total',label:'Amalda',align:'right',value:o=>o.c.actual.total,render:o=><><b>{compactMoney(o.c.actual.total)}</b>{o.c.incomplete.length>0&&<small className="cell-sub warning-text" title={o.c.incomplete.join(' · ')}>qisman taxminiy</small>}</>},
        {key:'wip',label:'WIP',align:'right',value:o=>o.c.wip,render:o=>o.c.wip?compactMoney(o.c.wip):<span className="muted">—</span>,priority:'low'},
        {key:'earned',label:'Standart',align:'right',value:o=>o.c.earned,render:o=>compactMoney(o.c.earned)},
        {key:'variance',label:'Farq',align:'right',value:o=>o.c.variancePct,render:o=>o.c.earned?<VarianceCell pct={o.c.variancePct}/>:<span className="muted">—</span>},
        {key:'unit',label:'Birlik',align:'right',value:o=>o.c.unitCost,render:o=>money(o.c.unitCost),priority:'low'},
      ]}/>
    <p className="soft-meta">Jami · {rows.length} MO: amalda <b>{compactMoney(actual)}</b> · standart <b>{compactMoney(standard)}</b> · farq <b className={actual>standard?'negative':undefined}>{actual-standard>0?'+':''}{compactMoney(actual-standard)}</b></p>
  </div>
}

function Labor(){
  const s=useApp().state,navigate=useNavigate()
  const since=addDays(todayISO(),-30)
  const logs=s.timeLogs.filter(t=>t.start.slice(0,10)>=since)
  const byEmployee=s.employees.map(e=>{const minutes=logs.filter(t=>t.employeeId===e.id).reduce((a,t)=>a+t.minutes,0);return {e,minutes,cost:minutes/60*e.hourlyCost}}).filter(x=>x.minutes>0).sort((a,b)=>b.cost-a.cost)
  const expenses=s.expenses.filter(e=>e.type==='Labor'&&e.date>=since)
  return <div className="page-stack">
    <PageHeader title="Labor cost" subtitle="Bevosita: vaqt × stavka · bilvosita: davr xarajati"/>
    <div className="kpi-grid cols-3">
      <KPI label="Bevosita (30 kun)" value={compactMoney(byEmployee.reduce((a,x)=>a+x.cost,0))} sub={formatMinutes(byEmployee.reduce((a,x)=>a+x.minutes,0))} icon={<Icon name="users"/>}/>
      <KPI label="Bilvosita" value={compactMoney(expenses.reduce((a,e)=>a+e.amount,0))} sub={`${expenses.length} yozuv`} tone="purple" icon={<Icon name="wallet"/>} onClick={()=>navigate('/costs?view=expenses&type=Labor')}/>
      <KPI label="O‘rtacha stavka" value={compactMoney(s.employees.reduce((a,e)=>a+e.hourlyCost,0)/Math.max(1,s.employees.length))} sub="soatiga" tone="mint" icon={<Icon name="clock"/>} onClick={()=>navigate('/employees?view=all')}/>
    </div>
    <Card title="Xodimlar bo‘yicha">{byEmployee.length?<BarList rows={byEmployee.map(x=>({label:x.e.name,sub:`${formatMinutes(x.minutes)} × ${compactMoney(x.e.hourlyCost)}`,value:x.cost}))} valueFormat={v=>compactMoney(v)}/>:<Empty compact title="Qayd etilgan vaqt yo‘q"/>}</Card>
  </div>
}

function Machine(){
  const s=useApp().state,navigate=useNavigate()
  const rows=s.workCenters.map(w=>{const minutes=s.productionOrders.reduce((a,o)=>a+o.workOrders.filter(x=>x.workCenterId===w.id).reduce((b,x)=>b+x.actualMin,0),0);return {w,minutes,cost:minutes/60*w.costPerHour}}).sort((a,b)=>b.cost-a.cost)
  const maintenance=s.expenses.filter(e=>e.type==='Maintenance'||e.type==='Electricity')
  return <div className="page-stack">
    <PageHeader title="Machine cost" subtitle="Work center soati × stavka" actions={<button type="button" className="secondary-glass-btn" onClick={()=>navigate('/equipment?view=work-centers')}><Icon name="edit"/>Stavkalar</button>}/>
    <div className="two-col">
      <Card title="Work center bo‘yicha">{rows.some(r=>r.minutes)?<BarList rows={rows.map(r=>({label:r.w.name,sub:`${formatMinutes(r.minutes)} × ${compactMoney(r.w.costPerHour)}/soat`,value:r.cost}))} valueFormat={v=>compactMoney(v)}/>:<Empty compact title="Uskuna vaqti qayd etilmagan"/>}</Card>
      <Card title="Energiya va maintenance"><InfoGrid columns={2} items={[{label:'Elektr energiya',value:money(maintenance.filter(e=>e.type==='Electricity').reduce((a,e)=>a+e.amount,0))},{label:'Maintenance',value:money(maintenance.filter(e=>e.type==='Maintenance').reduce((a,e)=>a+e.amount,0))}]}/></Card>
    </div>
  </div>
}

function Overhead(){
  const s=useApp().state,navigate=useNavigate()
  const done=s.productionOrders.filter(o=>o.status!=='Bekor qilingan').map(o=>({o,c:orderCosting(s,o).actual}))
  const allocated=done.reduce((a,x)=>a+x.c.overhead,0)
  const actual=s.expenses.filter(e=>e.type==='Overhead').reduce((a,e)=>a+e.amount,0)
  return <div className="page-stack">
    <PageHeader title="Overhead" subtitle={`${s.settings.policies.overheadRate}% stavka · taqsimlangan vs haqiqiy`} actions={<button type="button" className="secondary-glass-btn" onClick={()=>navigate('/settings?view=manufacturing')}><Icon name="settings"/>Stavka</button>}/>
    <div className="kpi-grid cols-3">
      <KPI label="Taqsimlangan overhead" value={compactMoney(allocated)} sub="MO tannarxlarida" icon={<Icon name="layers"/>}/>
      <KPI label="Haqiqiy overhead xarajati" value={compactMoney(actual)} sub="Davr xarajatlari" tone="purple" icon={<Icon name="wallet"/>}/>
      <KPI label={allocated>=actual?'Over-absorption':'Under-absorption'} value={compactMoney(Math.abs(allocated-actual))} tone={allocated>=actual?'mint':'pink'} icon={<Icon name="chart"/>}/>
    </div>
    <Card title="Overhead xarajatlari">{s.expenses.filter(e=>e.type==='Overhead').length?<div className="stack-list">{s.expenses.filter(e=>e.type==='Overhead').map(e=><div className="list-row" key={e.id}><span className="list-row-copy"><b>{e.note}</b><small>{e.date}</small></span><b className="num">{money(e.amount)}</b></div>)}</div>:<Empty compact title="Overhead xarajati yo‘q"/>}</Card>
  </div>
}
