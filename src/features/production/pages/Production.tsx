import {useMemo,useState} from 'react'
import type {DragEvent} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {unbuildPreview} from '../../../domain/actions'
import {Card,Checkbox,Confirm,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoreFilters,PageHeader,Progress,ResourceTable,Segmented,Select,StatusBadge,positive,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {DowntimeReason,ProductionOrder} from '../../../types'
import {calculateCapacityLoads,createMpsRows,createMrpPlan,deliveryRisk,isOpenOrder,mpsCapacityByWeek,operationQueues,orderBlocker,remainingQty,stockOf,weeklyProductionPlan} from '../../../domain/manufacturingEngine'
import {addDays,daysBetween,formatMinutes,shortDate,stamp,todayISO} from '../../../utils/dates'
import {cls,num,qty} from '../../../utils/format'
import {employeeName,materialName,productName,supplierName,useNow,workCenterCode,workCenterName} from '../../common/lookups'
import {BLOCKER_LABEL,OPEN_STATUSES,OrderDrawer,OrderFormModal,OutputModal,PRIORITIES,ScrapModal,WorkOrderList,liveMinutes} from '../components/OrderParts'
import {Overview} from './Overview'
import {PurchasePlanModal,SourcingModal} from '../../purchases/components/Sourcing'
import type {SourcingNeed} from '../../purchases/components/Sourcing'

type Open=(id:string)=>void

export default function Production(){
  const [sp]=useSearchParams()
  const view=sp.get('view')||'overview'
  const [id,setId]=useRecordParam()
  const open:Open=v=>setId(v)
  const body=view==='orders'?<Orders open={open}/>:view==='planning'?<Planning open={open}/>:view==='mps'?<MPS/>:view==='mrp'?<MRP open={open}/>:view==='operations'?<Operations open={open}/>:view==='advanced'?<Advanced/>:view==='shop-floor'?<ShopFloor open={open}/>:<Overview open={open}/>
  return <>{body}<OrderDrawer orderId={id} onClose={()=>setId(null)}/></>
}

/* ----------------------------------------------------------------- orders -- */
const DUE_OPTIONS=[{value:'overdue',label:'Kechikkan'},{value:'today',label:'Bugun'},{value:'week',label:'7 kun ichida'},{value:'month',label:'30 kun ichida'}]
function dueMatches(due:string,filter:string,today:string){
  if(!filter)return true
  if(filter==='overdue')return due<today
  if(filter==='today')return due===today
  return due>=today&&due<=addDays(today,filter==='week'?7:30)
}

function Orders({open}:{open:Open}){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status','open'),[priority,setPriority]=useSearchParamState('priority'),[center,setCenter]=useSearchParamState('wc'),[due,setDue]=useSearchParamState('due'),[line,setLine]=useSearchParamState('line'),[risk,setRisk]=useSearchParamState('risk'),[blocked,setBlocked]=useSearchParamState('blocked')
  const [create,setCreate]=useState(false)
  const today=todayISO()
  const counts=useMemo(()=>{const c:Record<string,number>={open:0,all:s.productionOrders.length};for(const o of s.productionOrders){c[o.status]=(c[o.status]||0)+1;if(isOpenOrder(o))c.open+=1}return c},[s.productionOrders])
  const rows=s.productionOrders.filter(o=>(status==='all'||(status==='open'?isOpenOrder(o):o.status===status))&&(!priority||o.priority===priority)&&(!center||o.workCenterId===center)&&(!line||o.lineId===line)&&dueMatches(o.due,due,today)&&(risk!=='1'||deliveryRisk(s,o))&&(blocked!=='1'||Boolean(orderBlocker(s,o))))
  const statusOptions=[{value:'open',label:`Ochiq · ${counts.open}`},...OPEN_STATUSES.map(x=>({value:x,label:`${x} · ${counts[x]||0}`})),{value:'Yakunlangan',label:`Yakunlangan · ${counts['Yakunlangan']||0}`},{value:'Bekor qilingan',label:`Bekor · ${counts['Bekor qilingan']||0}`},{value:'all',label:`Barchasi · ${counts.all}`}]
  const late=s.productionOrders.filter(o=>isOpenOrder(o)&&deliveryRisk(s,o)).length
  return <div className="page-stack">
    <PageHeader title="Ishlab chiqarish buyurtmalari" subtitle={`${counts.open} ochiq · ${counts['Jarayonda']||0} jarayonda${late?` · ${late} muddat riskida`:''}`}
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('production','create')} title={app.can('production','create')?undefined:'Buyurtma yaratish uchun ruxsat yo‘q'} onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi buyurtma</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="MO, mahsulot, mas’ul..." onRow={o=>open(o.id)} exportName="production-orders" resetKey={`${status}|${priority}|${center}|${due}|${line}|${risk}|${blocked}`}
      filtersActive={status!=='open'||Boolean(priority||center||due||line||risk||blocked)} onResetFilters={()=>{setStatus('open');setPriority('');setCenter('');setDue('');setLine('');setRisk('');setBlocked('')}}
      filters={<>
        <FilterSelect label="Status" value={status} onChange={setStatus} defaultValue="open" options={statusOptions}/>
        <FilterSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITIES}/>
        <FilterSelect label="Work center" value={center} onChange={setCenter} options={s.workCenters.map(w=>({value:w.id,label:w.name}))}/>
        <FilterSelect label="Due" value={due} onChange={setDue} options={DUE_OPTIONS}/>
        <MoreFilters><FilterSelect label="Liniya" value={line} onChange={setLine} options={s.productionLines.map(l=>({value:l.id,label:l.name}))}/><Checkbox checked={risk==='1'} onChange={v=>setRisk(v?'1':'')} label="Muddat riski"/><Checkbox checked={blocked==='1'} onChange={v=>setBlocked(v?'1':'')} label="Bloklangan" description="QC to‘sig‘i yoki uskuna to‘xtagan"/></MoreFilters>
      </>}
      rowClassName={o=>deliveryRisk(s,o)?'row-danger':undefined}
      emptyText="Yangi buyurtma yarating yoki MRP tavsiyasidan foydalaning"
      columns={[
        {key:'code',label:'MO',value:o=>o.code,render:o=><b>{o.code}</b>},
        {key:'product',label:'Mahsulot',value:o=>productName(s,o.productId),render:o=><div className="cell-main"><b>{productName(s,o.productId)}</b><small>{s.products.find(p=>p.id===o.productId)?.sku} · {o.bomVersion}</small></div>},
        {key:'qty',label:'Miqdor',align:'right',value:o=>o.quantity,render:o=><span className="num">{num(o.completed)} / {num(o.quantity)}{o.scrap?<small className="cell-sub negative">{o.scrap} scrap</small>:null}</span>},
        {key:'progress',label:'Progress',value:o=>o.progress,render:o=><div className="progress-cell"><Progress value={o.progress}/><small>{o.progress}%</small></div>},
        {key:'status',label:'Status',value:o=>o.status,render:o=>{const b=orderBlocker(s,o);return <><StatusBadge>{o.status}</StatusBadge>{b&&<small className="cell-sub negative">{BLOCKER_LABEL[b]}</small>}</>}},
        {key:'priority',label:'Priority',value:o=>PRIORITIES.indexOf(o.priority),render:o=><StatusBadge>{o.priority}</StatusBadge>},
        {key:'due',label:'Due',value:o=>o.due,render:o=><span className={deliveryRisk(s,o)?'negative':undefined}>{o.due}</span>},
        {key:'wc',label:'Work center',value:o=>workCenterName(s,o.workCenterId),priority:'low'},
        {key:'responsible',label:'Mas’ul',value:o=>employeeName(s,o.responsibleId),priority:'low'},
      ]}/>
    {create&&<OrderFormModal onClose={()=>setCreate(false)}/>}
  </div>
}

/* --------------------------------------------------------------- planning -- */
function Planning({open}:{open:Open}){
  const app=useApp(),s=app.state
  const [mode,setMode]=useSearchParamState('mode','Gantt'),[line,setLine]=useSearchParamState('line'),[load,setLoad]=useSearchParamState('load')
  const today=todayISO()
  const [offset,setOffset]=useState(-2)
  const span=14
  const days=Array.from({length:span},(_,i)=>addDays(today,offset+i))
  const orders=s.productionOrders.filter(o=>isOpenOrder(o)&&(!line||o.lineId===line)).sort((a,b)=>a.start.localeCompare(b.start))
  const loads=calculateCapacityLoads(s,7)
  const capacity=loads.filter(c=>(!line||c.workCenter.lineId===line)&&(load!=='over'||c.overloaded)&&(load!=='high'||c.utilization>85))
  const dayTotal=(i:number)=>{const l=capacity.reduce((a,c)=>a+c.days[i].load,0),cap=capacity.reduce((a,c)=>a+c.days[i].capacity,0);return {l,cap,pct:cap?Math.round(l/cap*100):0}}
  const horizon=capacity.reduce((a,c)=>({l:a.l+c.days.reduce((x,d)=>x+d.load,0),cap:a.cap+c.days.reduce((x,d)=>x+d.capacity,0)}),{l:0,cap:0})
  const reschedule=(o:ProductionOrder,day:string)=>{const duration=Math.max(0,daysBetween(o.start,o.due));if(day===o.start)return;app.updateProductionOrder(o.id,{start:day,due:addDays(day,duration)})}
  const onDrop=(e:DragEvent,day:string)=>{e.preventDefault();const o=orders.find(x=>x.id===e.dataTransfer.getData('text/plain'));if(o)reschedule(o,day)}
  return <div className="page-stack">
    <PageHeader title="Rejalashtirish" subtitle="Sudrab ko‘chiring — davomiylik saqlanadi"
      actions={<Segmented ariaLabel="Ko‘rinish" items={['Gantt','Calendar','Capacity']} value={mode} onChange={setMode}/>}/>
    <div className="filter-strip">
      <FilterSelect label="Liniya" value={line} onChange={setLine} options={s.productionLines.map(l=>({value:l.id,label:l.name}))}/>
      {mode==='Capacity'&&<FilterSelect label="Yuklama" value={load} onChange={setLoad} options={[{value:'over',label:'Overload (>100%)'},{value:'high',label:'Yuqori (>85%)'}]}/>}
      {mode!=='Capacity'&&<div className="range-nav"><button type="button" className="icon-btn" aria-label="Oldingi hafta" onClick={()=>setOffset(v=>v-7)}><Icon name="chevron" style={{transform:'rotate(180deg)'}}/></button><button type="button" className="secondary-glass-btn compact" onClick={()=>setOffset(-2)}>Bugun</button><button type="button" className="icon-btn" aria-label="Keyingi hafta" onClick={()=>setOffset(v=>v+7)}><Icon name="chevron"/></button><span className="soft-meta">{shortDate(days[0])} — {shortDate(days[days.length-1])}</span></div>}
    </div>
    {mode==='Capacity'?<div className="card flush"><div className="table-scroll"><table className="capacity-table"><thead><tr><th>Work center</th>{capacity[0]?.days.map(d=><th key={d.date} className="align-center">{shortDate(d.date)}</th>)}<th className="align-right">7 kun</th></tr></thead><tbody>{!capacity.length&&<tr><td colSpan={9} className="muted">Filtrga mos work center yo‘q</td></tr>}{capacity.map(c=><tr key={c.workCenter.id}>
      <td><div className="cell-main"><b>{c.workCenter.name}</b><small>{c.workCenter.code} · eff {c.workCenter.efficiency}%{c.down?' · to‘xtagan':''}</small></div></td>
      {c.days.map(d=><td key={d.date} className="align-center"><span className={cls('load-cell',d.utilization>100?'over':d.utilization>85?'high':d.load>0?'ok':'idle')} title={`${num(d.load)} / ${num(d.capacity)} min`}>{d.capacity===0?'Stop':d.load?`${Math.min(d.utilization,999)}%`:'—'}</span></td>)}
      <td className="align-right"><b className={c.utilization>100?'negative':undefined}>{c.utilization}%</b></td>
    </tr>)}</tbody>{capacity.length>0&&<tfoot><tr className="total"><td>Jami</td>{capacity[0].days.map((d,i)=>{const x=dayTotal(i);return <td key={d.date} className="align-center" title={`${num(x.l)} / ${num(x.cap)} min`}>{x.cap?`${x.pct}%`:'—'}</td>})}<td className="align-right"><b className={horizon.cap&&horizon.l/horizon.cap>1?'negative':undefined}>{horizon.cap?Math.round(horizon.l/horizon.cap*100):0}%</b></td></tr></tfoot>}</table></div><p className="table-note">Qolgan setup + run vaqti, start→due oralig‘iga taqsimlangan · 100%+ = overload</p></div>
    :mode==='Calendar'?<div className="calendar-grid">{days.slice(0,7).map(d=><div key={d} className={cls('calendar-day',d===today&&'today')} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,d)}>
      <div className="calendar-day-head"><b>{shortDate(d)}</b><small>{orders.filter(o=>o.start===d).length} MO</small></div>
      {orders.filter(o=>o.start===d).map(o=><button type="button" key={o.id} draggable={app.can('production','edit')} onDragStart={e=>e.dataTransfer.setData('text/plain',o.id)} className={`calendar-task p-${o.priority.toLowerCase()}`} onClick={()=>open(o.id)}><b>{o.code}</b><span>{productName(s,o.productId)}</span><small>{num(o.quantity)} · {o.status}</small></button>)}
    </div>)}</div>
    :<div className="card flush gantt"><div className="gantt-scroll"><div className="gantt-grid" style={{['--days' as string]:span}}>
      <div className="gantt-head"><span>Buyurtma</span>{days.map(d=><b key={d} className={cls(d===today&&'today')}>{shortDate(d)}</b>)}</div>
      {orders.length?orders.map(o=>{
        const startIdx=Math.max(0,daysBetween(days[0],o.start)),endIdx=Math.min(span-1,daysBetween(days[0],o.due))
        const visible=endIdx>=0&&startIdx<=span-1
        return <div className="gantt-row" key={o.id}>
          <button type="button" className="gantt-label" onClick={()=>open(o.id)}><b>{o.code}</b><small>{productName(s,o.productId)} · {workCenterCode(s,o.workCenterId)}</small></button>
          {days.map(d=><div key={d} className={cls('gantt-cell',d===today&&'today')} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,d)}/>)}
          {visible&&<button type="button" draggable={app.can('production','edit')} onDragStart={e=>e.dataTransfer.setData('text/plain',o.id)} onClick={()=>open(o.id)} className={cls('gantt-bar',`p-${o.priority.toLowerCase()}`,deliveryRisk(s,o)&&'risk')} style={{gridColumn:`${startIdx+2} / ${endIdx+3}`}} title={`${o.code}: ${o.start} → ${o.due} · ${o.progress}%`}>
            <span className="gantt-progress" style={{width:`${o.progress}%`}}/><span className="gantt-text">{o.code} · {o.progress}%</span>
          </button>}
        </div>}):<Empty compact title="Rejada buyurtma yo‘q"/>}
    </div></div></div>}
  </div>
}

/* -------------------------------------------------------------------- MPS -- */
const MPS_LINES:Array<{key:'forecast'|'sales'|'demand'|'scheduled'|'suggested'|'projected';label:string;strong?:boolean}>=[
  {key:'forecast',label:'Forecast'},{key:'sales',label:'Tasdiqlangan sotuv'},{key:'demand',label:'Talab',strong:true},
  {key:'scheduled',label:'Rejada (MO)'},{key:'suggested',label:'Tavsiya'},{key:'projected',label:'Proyeksiya',strong:true},
]

function MPS(){
  const app=useApp(),s=app.state
  const rows=createMpsRows(s)
  const capacity=mpsCapacityByWeek(s,rows)
  const thisWeek=weeklyProductionPlan(s,rows)
  const [create,setCreate]=useState<{productId:string;quantity:number;due:string}|null>(null)
  const weeks=rows[0]?.weeks.map(w=>w.week)||[]
  const toPlan=rows.filter(r=>r.suggested>0)
  const canCreate=app.can('production','create')
  const loadClass=(u:number)=>u>100?'over':u>85?'high':u>0?'ok':'idle'
  return <div className="page-stack">
    <PageHeader title="Master Production Schedule" subtitle={`${weeks.length} hafta · talab = max(forecast, sotuv) · butun songa yaxlitlanadi${toPlan.length?` · ${toPlan.length} mahsulotga MO kerak`:''}`}/>
    <div className="card flush"><div className="table-scroll"><table className="mps-grid">
      <thead><tr><th>Mahsulot</th><th>Qator</th>{weeks.map(w=><th key={w} className="align-right">{shortDate(w)}</th>)}<th className="align-right">Jami</th><th className="action-cell"><span className="sr-only">Amal</span></th></tr></thead>
      <tbody>{rows.map(r=>MPS_LINES.map((line,li)=>{
        const total=line.key==='projected'?r.weeks[r.weeks.length-1]?.projected??0:r.weeks.reduce((a,w)=>a+w[line.key],0)
        return <tr key={r.product.id+line.key} className={cls(li===0&&'group-start',line.strong&&'strong')}>
          {li===0&&<td rowSpan={MPS_LINES.length} className="mps-product"><div className="cell-main"><b>{r.product.name}</b><small>{r.product.sku}</small></div><small className="cell-sub">available {num(r.available)} · rezerv {num(r.reservedForSales)}</small><small className="cell-sub">shu hafta tayyor {num(thisWeek.products.find(p=>p.product.id===r.product.id)?.produced??0)}</small></td>}
          <td className="mps-line">{line.label}</td>
          {r.weeks.map(w=>{const v=w[line.key];return <td key={w.week} className={cls('align-right',line.key==='projected'&&v<0&&'negative')}>
            {line.key==='forecast'?<ForecastInput productId={r.product.id} period={w.week} value={v}/>:line.key==='suggested'?(v?<b className="mfg-text">+{num(v)}</b>:<span className="muted">—</span>):num(v)}
          </td>})}
          <td className="align-right"><b>{line.key==='suggested'&&!total?<span className="muted">—</span>:num(total)}</b></td>
          {li===0&&<td rowSpan={MPS_LINES.length} className="action-cell align-right">{r.suggested>0&&canCreate?<button type="button" className="primary-glass-btn compact" onClick={()=>setCreate({productId:r.product.id,quantity:r.suggested,due:addDays(r.weeks.find(w=>w.suggested>0)?.week||todayISO(),4)})}><Icon name="plus" size={14}/>MO · {num(r.suggested)}</button>:<StatusBadge tone="success">Qoplangan</StatusBadge>}</td>}
        </tr>}))}</tbody>
      <tfoot><tr className="group-start capacity-row"><td>Sig‘im yuklamasi</td><td className="mps-line">Routing / smena</td>{capacity.map(c=><td key={c.week} className="align-right"><span className={cls('load-cell',loadClass(c.utilization))} title={`${num(c.load)} / ${num(c.capacity)} min`}>{c.load?`${c.utilization}%`:'—'}</span></td>)}<td className="align-right soft-meta">{num(capacity[0]?.capacity||0)} min/hafta</td><td/></tr></tfoot>
    </table></div><p className="table-note">Tavsiya = proyeksiya manfiy bo‘lganda 50 lik lot · sig‘im = rejada + tavsiya miqdorlarining routing vaqti ÷ work center smenalari (5 kun)</p></div>
    {create&&<OrderFormModal defaults={create} onClose={()=>setCreate(null)}/>}
  </div>
}

function ForecastInput({productId,period,value}:{productId:string;period:string;value:number}){
  const app=useApp()
  const [draft,setDraft]=useState(String(value))
  const [editing,setEditing]=useState(false)
  const commit=()=>{setEditing(false);const n=Math.max(0,Math.round(Number(draft)||0));if(n!==value)app.setForecast(productId,period,n);setDraft(String(n))}
  if(!app.can('production','edit'))return <span>{num(value)}</span>
  return <input className="ui-input cell-input" type="number" min="0" aria-label={`Forecast ${period}`} value={editing?draft:String(value)} onFocus={()=>{setEditing(true);setDraft(String(value))}} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape'){setDraft(String(value));setEditing(false);(e.target as HTMLInputElement).blur()}}}/>
}

/* -------------------------------------------------------------------- MRP -- */
function MRP({open}:{open:Open}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const plan=createMrpPlan(s)
  const buys=plan.purchases.filter(p=>p.suggested>0)
  const shortages=plan.purchases.filter(p=>p.shortage>0)
  const [short,setShort]=useSearchParamState('short')
  const purchases=short==='1'?shortages:plan.purchases
  const [picked,setPicked]=useState<{productId:string;quantity:number}|null>(null)
  const [sourcing,setSourcing]=useState<SourcingNeed|null>(null),[planBuy,setPlanBuy]=useState(false)
  const needOf=(p:typeof buys[number]):SourcingNeed=>({materialId:p.materialId,need:p.suggested,needBy:p.needBy,source:'MRP'})
  const waiting=s.productionOrders.filter(o=>o.status==='Material kutilmoqda')
  const canBuy=app.can('purchases','create')
  return <div className="page-stack">
    <PageHeader title="MRP" subtitle="Ko‘p bosqichli netting: talab → rezerv → available → yo‘lda → yetishmovchilik → amal"
      actions={buys.length>0&&canBuy?<button type="button" className="primary-glass-btn" onClick={()=>setPlanBuy(true)}><Icon name="cart"/>Xarid rejasi ({buys.length})</button>:undefined}/>
    <div className="kpi-grid">
      <KPI label="Make tavsiyalari" value={plan.planned.length} tone="mfg" icon={<Icon name="factory"/>}/>
      <KPI label="Yetishmovchilik" value={shortages.length} sub={`${buys.length} ta xarid tavsiyasi`} tone={shortages.length?'pink':'mint'} icon={<Icon name="warning"/>} onClick={()=>navigate('/materials?view=shortages')}/>
      <KPI label="Material kutayotgan MO" value={waiting.length} sub={waiting.map(o=>o.code).join(', ')||undefined} tone="orange" icon={<Icon name="clock"/>} onClick={()=>navigate('/production?view=orders&status=Material kutilmoqda')}/>
      <KPI label="Yo‘ldagi xarid" value={num(s.purchaseOrders.filter(p=>['Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(p.status)).length)} tone="purple" icon={<Icon name="truck"/>} onClick={()=>navigate('/purchases?view=orders&status=Yo‘lda')}/>
    </div>
    <Card className="flush" title="Buy · xomashyo" subtitle="talab + safety − available − yo‘lda · butun birlikka yaxlitlanadi" actions={<Segmented ariaLabel="Material filtri" items={[{value:'',label:'Barchasi',count:plan.purchases.length},{value:'1',label:'Yetishmaydi',count:shortages.length}]} value={short==='1'?'1':''} onChange={setShort}/>}>
      {!purchases.length?<Empty compact icon="check" title="Material yetishmovchiligi yo‘q" text="Talab va safety stock available + yo‘ldagi xarid bilan qoplangan"/>:<div className="table-scroll"><table className="mrp-table"><thead><tr><th>Material</th><th className="align-right">Talab</th><th className="align-right">Rezerv</th><th className="align-right">Available</th><th className="align-right">Yo‘lda</th><th className="align-right">Safety</th><th className="align-right">Yetishmaydi</th><th className="align-right">Tavsiya</th><th>Supplier · kerak</th><th className="align-right">Amal</th></tr></thead><tbody>{purchases.map(p=>{const m=s.rawMaterials.find(x=>x.id===p.materialId)!,st=stockOf(s,p.materialId);return <tr key={p.materialId} className={p.shortage>0?'row-danger':p.suggested>0?'row-warning':undefined}>
        <td><div className="cell-main"><b>{m.name}</b><small>{m.sku} · {m.unit}</small></div></td>
        <td className="align-right">{num(p.required)}</td>
        <td className="align-right">{num(st.reserved)}</td>
        <td className="align-right">{num(p.available)}</td>
        <td className="align-right">{p.incoming?num(p.incoming):<span className="muted">—</span>}</td>
        <td className="align-right muted">{num(p.safety)}</td>
        <td className="align-right">{p.shortage>0?<b className="negative">{num(p.shortage)}</b>:<span className="muted">—</span>}</td>
        <td className="align-right">{p.suggested?<b>{qty(p.suggested,m.unit)}</b>:<StatusBadge tone="success">OK</StatusBadge>}</td>
        <td>{p.supplierId?supplierName(s,p.supplierId):p.supplierCount>1?<span className="warning-text">{p.supplierCount} ta — tanlang</span>:<span className="negative">Supplier yo‘q</span>}<small className="cell-sub">{p.needBy}</small></td>
        <td className="align-right">{p.suggested>0&&<button type="button" className="soft-glass-btn compact" disabled={!canBuy} onClick={()=>setSourcing(needOf(p))}><Icon name="truck" size={14}/>Supplier</button>}</td>
      </tr>})}</tbody></table></div>}
    </Card>
    <Card className="flush" title="Make · ishlab chiqarish" subtitle="L0 mustaqil talab · L1+ sub-assembly">
      {plan.planned.length?<div className="table-scroll"><table className="fit"><thead><tr><th>Mahsulot</th><th>Level</th><th>Sabab</th><th className="align-right">Miqdor</th><th className="align-right">Available</th><th className="align-right">Amal</th></tr></thead><tbody>{plan.planned.map(p=><tr key={p.productId+p.level}>
        <td><div className="cell-main"><b>{productName(s,p.productId)}</b><small>{s.products.find(x=>x.id===p.productId)?.sku}</small></div></td><td><StatusBadge tone={p.level?'purple':'mfg'}>L{p.level}</StatusBadge></td><td>{p.reason}</td><td className="align-right"><b>{num(p.qty)}</b></td><td className="align-right">{num(stockOf(s,p.productId).available)}</td>
        <td className="align-right">{p.reason.startsWith('Buy')?<StatusBadge tone="warning">Buy</StatusBadge>:<button type="button" className="soft-glass-btn compact" disabled={!app.can('production','create')} onClick={()=>setPicked({productId:p.productId,quantity:p.qty})}><Icon name="plus" size={14}/>MO</button>}</td>
      </tr>)}</tbody></table></div>:<Empty compact icon="check" title="Tavsiya yo‘q" text="Talab qoplangan"/>}
    </Card>
    {waiting.length>0&&<Card title="Material kutayotgan buyurtmalar">{waiting.map(o=><button type="button" key={o.id} className="list-row is-clickable" onClick={()=>open(o.id)}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>{num(o.quantity)} · due {o.due}</small></span><StatusBadge>{o.status}</StatusBadge><Icon name="chevron" size={13} className="list-row-chevron"/></button>)}</Card>}
    {picked&&<OrderFormModal defaults={picked} onClose={()=>setPicked(null)}/>}
    {sourcing&&<SourcingModal need={sourcing} onClose={()=>setSourcing(null)}/>}
    {planBuy&&<PurchasePlanModal needs={buys.map(needOf)} title="MRP — xarid" onClose={()=>setPlanBuy(false)}/>}
  </div>
}

/* ------------------------------------------------------- work order queue -- */
function Operations({open}:{open:Open}){
  const app=useApp(),s=app.state,now=useNow(30000)
  const [center,setCenter]=useSearchParamState('wc'),[status,setStatus]=useSearchParamState('status')
  const queues=operationQueues(s).filter(q=>!center||q.workCenter.id===center).map(q=>({w:q.workCenter,down:q.down,queue:q.queue.filter(x=>!status||x.workOrder.status===status).map(x=>({o:x.order,x:x.workOrder}))}))
  const total=queues.reduce((a,q)=>a+q.queue.length,0)
  return <div className="page-stack">
    <PageHeader title="Operatsiyalar" subtitle={`Work center navbati · ${total} ochiq operatsiya · reja / amalda vaqt`}/>
    <div className="filter-strip"><FilterSelect label="Work center" value={center} onChange={setCenter} options={s.workCenters.map(w=>({value:w.id,label:w.name}))}/><FilterSelect label="Status" value={status} onChange={setStatus} options={['Jarayonda','Pauzada','Tayyor','Kutilmoqda']}/></div>
    <div className="card flush"><div className="table-scroll"><table className="ops-table"><thead><tr><th>Operatsiya</th><th>MO</th><th>Mahsulot</th><th>Status</th><th className="align-right">Amalda / reja</th><th>Due</th></tr></thead><tbody>
      {queues.map(({w,down,queue})=>[
        <tr key={w.id} className="ops-group"><td colSpan={6}><span className="badge-row"><span>{w.name}</span><span className="soft-meta">{w.code} · {queue.length} navbatda</span>{down?<StatusBadge tone="danger">To‘xtagan</StatusBadge>:<StatusBadge tone="success">Ishlamoqda</StatusBadge>}</span></td></tr>,
        ...(queue.length?queue.map(({o,x})=>{const minutes=liveMinutes(x,now);return <tr key={x.id} className={deliveryRisk(s,o)?'row-danger':undefined}>
          <td><div className="cell-main"><b>{x.sequence}. {x.name}</b><small>{x.dependsOn.length&&x.status==='Kutilmoqda'?'oldingi operatsiyani kutmoqda':workCenterCode(s,x.workCenterId)}</small></div></td>
          <td><button type="button" className="link-btn" onClick={()=>open(o.id)}>{o.code}</button></td>
          <td><span className="truncate">{productName(s,o.productId)}</span></td>
          <td><StatusBadge>{x.status}</StatusBadge></td>
          <td className="align-right"><span className={minutes>x.plannedMin?'negative':undefined}>{formatMinutes(minutes)}</span> <span className="muted">/ {formatMinutes(x.plannedMin)}</span></td>
          <td className={deliveryRisk(s,o)?'negative':undefined}>{o.due}</td>
        </tr>}):[<tr key={`${w.id}-empty`}><td colSpan={6} className="muted">{status?'Bu statusda operatsiya yo‘q':'Navbat bo‘sh'}</td></tr>])
      ])}
    </tbody></table></div></div>
  </div>
}

/* --------------------------------------------------------------- advanced -- */
function Advanced(){
  const app=useApp(),s=app.state
  const [selected,setSelected]=useState<string[]>([])
  const [split,setSplit]=useState<ProductionOrder|null>(null)
  const [unbuild,setUnbuild]=useState(false)
  const [backorder,setBackorder]=useState<ProductionOrder|null>(null)
  const mergeable=s.productionOrders.filter(o=>['Qoralama','Tasdiqlangan','Material kutilmoqda'].includes(o.status)&&o.completed+o.scrap===0)
  const splittable=s.productionOrders.filter(o=>isOpenOrder(o)&&remainingQty(o)>1)
  const backorderable=s.productionOrders.filter(o=>['Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status)&&o.completed>0&&remainingQty(o)>0)
  const firstSelected=s.productionOrders.find(o=>o.id===selected[0])
  const canEdit=app.can('production','edit')
  return <div className="page-stack">
    <PageHeader title="Split · Merge · Backorder · Unbuild" subtitle="Rezerv, stock va audit saqlanadi"/>
    <div className="two-col">
      <Card title="Merge" subtitle="Bir xil mahsulot/BOM, boshlanmagan" actions={<button type="button" className="primary-glass-btn compact" disabled={!canEdit||selected.length<2} title={selected.length<2?'Kamida 2 ta MO tanlang':undefined} onClick={()=>{if(app.mergeProduction(selected).ok)setSelected([])}}><Icon name="merge" size={14}/>Birlashtirish ({selected.length})</button>}>
        {mergeable.length?<div className="stack-list">{mergeable.map(o=>{const incompatible=Boolean(firstSelected&&!selected.includes(o.id)&&(firstSelected.productId!==o.productId||firstSelected.bomId!==o.bomId));return <div className="list-row" key={o.id}><Checkbox checked={selected.includes(o.id)} disabled={incompatible||!canEdit} onChange={v=>setSelected(x=>v?[...x,o.id]:x.filter(i=>i!==o.id))} label={`${o.code} · ${productName(s,o.productId)}`} description={`${num(o.quantity)} · ${o.bomVersion} · ${o.status}${incompatible?' · boshqa mahsulot/BOM':''}`}/></div>})}</div>:<Empty compact title="Birlashtiriladigan MO yo‘q"/>}
      </Card>
      <Card title="Split" subtitle="Qolgan miqdorni ikkiga bo‘lish">
        {splittable.length?<div className="stack-list">{splittable.map(o=><div className="list-row" key={o.id}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>Qolgan {num(remainingQty(o))} · {o.status}</small></span><button type="button" className="secondary-glass-btn compact" disabled={!canEdit} onClick={()=>setSplit(o)}><Icon name="split" size={14}/>Split</button></div>)}</div>:<Empty compact title="Split uchun MO yo‘q"/>}
      </Card>
      <Card title="Backorder" subtitle="Tayyor qism → sifat, qolgani → yangi MO">
        {backorderable.length?<div className="stack-list">{backorderable.map(o=><div className="list-row" key={o.id}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>{num(o.completed)} tayyor · {num(remainingQty(o))} qolgan</small></span><button type="button" className="secondary-glass-btn compact" disabled={!canEdit} onClick={()=>setBackorder(o)}><Icon name="undo" size={14}/>Backorder</button></div>)}</div>:<Empty compact title="Backorder uchun MO yo‘q"/>}
      </Card>
      <Card title="Unbuild" subtitle="Komponentlarga ajratish · 97% yield" actions={<button type="button" className="warning-glass-btn compact" disabled={!canEdit} onClick={()=>setUnbuild(true)}><Icon name="refresh" size={14}/>Unbuild</button>}>
        <p className="soft-meta">Tayyor mahsulot kamayadi, komponentlar “Return +” bilan omborga qaytadi.</p>
      </Card>
    </div>
    {split&&<SplitModal order={split} onClose={()=>setSplit(null)}/>}
    {unbuild&&<UnbuildModal onClose={()=>setUnbuild(false)}/>}
    <Confirm open={!!backorder} onClose={()=>setBackorder(null)} onConfirm={()=>backorder&&app.createBackorder(backorder.id)} title="Backorder yaratilsinmi?" text={backorder?`${backorder.code}: ${num(backorder.completed)} tayyor qismi sifat nazoratiga yuboriladi, ${num(remainingQty(backorder))} qolgan qismi uchun yangi qoralama MO yaratiladi.`:''} confirmText="Backorder yaratish"/>
  </div>
}

function SplitModal({order,onClose}:{order:ProductionOrder;onClose:()=>void}){
  const app=useApp(),rest=remainingQty(order)
  const form=useForm({qty:String(Math.floor(rest/2))},v=>({qty:positive(v.qty,'Miqdor')||(Number(v.qty)>=rest?`${rest-1} dan oshmasin`:Number(v.qty)%1?'Butun son':undefined)}))
  return <Modal open onClose={onClose} title="Buyurtmani bo‘lish" eyebrow={order.code} subtitle={`Qolgan ${rest}. Yangi MO shu miqdor bilan yaratiladi.`} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.splitProduction(order.id,Number(v.qty));if(r.ok)onClose();return r.ok})}>Split qilish</button></>}>
    <Field label="Yangi MO miqdori" required error={form.error('qty')} hint={`Asl MO’da ${rest-(Number(form.values.qty)||0)} qoladi`}><Input type="number" min="1" max={rest-1} {...form.input('qty')}/></Field>
  </Modal>
}

function UnbuildModal({onClose}:{onClose:()=>void}){
  const app=useApp(),s=app.state
  const products=s.products.filter(p=>stockOf(s,p.id).available>0)
  const form=useForm({productId:products[0]?.id||'',qty:'1',pct:'100'},v=>({productId:v.productId?undefined:'Mahsulot tanlang',qty:positive(v.qty,'Miqdor')||(Number(v.qty)>stockOf(s,v.productId).available?`Available ${Math.floor(stockOf(s,v.productId).available)}`:undefined),pct:Number(v.pct)>=0&&Number(v.pct)<=100&&v.pct!==''?undefined:'0–100%'}))
  // The content comes from the MO that made the units taken (its BOM version and real consumption), not today's BOM (N-19).
  const preview=form.values.productId?unbuildPreview(s,form.values.productId,Number(form.values.qty)||0,Number(form.values.pct)||0):null
  return <Modal open onClose={onClose} title="Unbuild / Disassembly" size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="warning-glass-btn" onClick={()=>form.submit(v=>{const r=app.unbuildProduct(v.productId,Number(v.qty),Number(v.pct));if(r.ok)onClose();return r.ok})}>Unbuild</button></>}>
    <div className="form-stack">
      <Field label="Mahsulot" required error={form.error('productId')}><Select value={form.values.productId} onChange={v=>form.set('productId',v)}>{products.map(p=><option key={p.id} value={p.id}>{p.name} · available {Math.floor(stockOf(s,p.id).available)}</option>)}</Select></Field>
      <div className="form-grid">
        <Field label="Miqdor" required error={form.error('qty')}><Input type="number" min="1" {...form.input('qty')}/></Field>
        <Field label="Qayta tiklash %" required error={form.error('pct')} hint="Yaroqli qaytadigan ulush"><Input type="number" min="0" max="100" {...form.input('pct')}/></Field>
      </div>
      {preview&&preview.lines.length>0&&<div className="inline-note"><Icon name="info"/><span>Qaytadi: {preview.lines.map(l=>`${materialName(s,l.materialId)} ${num(l.qty,2)}`).join(', ')}<br/><small>Asos: {preview.basis.join('; ')}</small></span></div>}
      {preview&&!preview.lines.length&&Number(form.values.qty)>0&&<div className="inline-note warning"><Icon name="warning"/><span>Tarkib aniqlanmadi: lot MO’ga bog‘lanmagan va faol BOM yo‘q</span></div>}
    </div>
  </Modal>
}

/* ------------------------------------------------------------- shop floor -- */
function ShopFloor({open}:{open:Open}){
  const app=useApp(),s=app.state,now=useNow(10000)
  const active=s.productionOrders.filter(o=>['Tasdiqlangan','Jarayonda','Pauzada','Sifat nazoratida'].includes(o.status))
  const [selected,setSelected]=useSearchParamState('mo',active.find(o=>o.status==='Jarayonda')?.id||active[0]?.id||'')
  const [scan,setScan]=useState(''),[modal,setModal]=useState<'output'|'scrap'|'stop'|null>(null)
  const o=s.productionOrders.find(x=>x.id===selected)&&active.some(x=>x.id===selected)?s.productionOrders.find(x=>x.id===selected)!:active[0]
  if(!o)return <div className="page-stack"><PageHeader title="Shop Floor" subtitle="Operator ekrani"/><Card><Empty icon="factory" title="Faol buyurtma yo‘q" text="Tasdiqlangan yoki jarayondagi MO shu yerda ko‘rinadi"/></Card></div>
  const product=s.products.find(p=>p.id===o.productId)
  const current=o.workOrders.find(w=>w.status==='Jarayonda')||o.workOrders.find(w=>w.status==='Pauzada')||o.workOrders.find(w=>w.status==='Tayyor')||o.workOrders.find(w=>w.status==='Kutilmoqda'&&!w.dependsOn.length)
  const op=o.bomSnapshot.operations.find(x=>x.id===current?.operationId)
  const equipment=s.equipment.find(e=>e.workCenterId===current?.workCenterId)
  const openDowntime=equipment&&s.downtimeEvents.find(d=>d.equipmentId===equipment.id&&!d.end)
  const canEdit=app.can('production','edit')
  const running=['Jarayonda','Pauzada'].includes(o.status)
  const done=o.workOrders.filter(w=>w.status==='Yakunlangan').length
  const submitScan=()=>{if(!scan.trim())return;app.recordMaterialScan(o.id,scan);setScan('')}
  return <div className="page-stack shop-floor">
    <div className="shop-floor-top">
      <PageHeader title="Shop Floor" subtitle={<>Operator ekrani · <button type="button" className="link-btn" onClick={()=>open(o.id)}>{o.code}</button> · {product?.name}</>}/>
      <Select value={o.id} onChange={setSelected} ariaLabel="Buyurtma tanlash">{active.map(x=><option key={x.id} value={x.id}>{x.code} · {productName(s,x.productId)} · {x.status}</option>)}</Select>
    </div>
    <div className="shop-grid">
      <Card className="shop-main">
        <div className="shop-head">
          <div className="shop-op">
            <span className="eyebrow">Operatsiya {current?current.sequence:done}/{o.workOrders.length} · {workCenterName(s,current?.workCenterId)}</span>
            <h2>{current?.name||(o.status==='Sifat nazoratida'?'Sifat nazoratida':'Barcha operatsiyalar bajarilgan')}</h2>
            <div className="badge-row"><StatusBadge>{o.status}</StatusBadge>{current&&<StatusBadge>{current.status}</StatusBadge>}<StatusBadge>{o.priority}</StatusBadge></div>
          </div>
          {current&&<div className="shop-timer" aria-label="Operatsiya vaqti"><span className="live-timer"><Icon name="clock" size={18}/>{formatMinutes(liveMinutes(current,now))}</span><small>reja {formatMinutes(current.plannedMin)}</small></div>}
        </div>
        <div className="shop-stats">{[['Reja',o.quantity,''],['Tayyor',o.completed,'good'],['Scrap',o.scrap,o.scrap?'bad':''],['Qolgan',remainingQty(o),'']].map(([l,v,t])=><div key={String(l)} className={String(t)}><span>{l}</span><b>{num(Number(v))}</b><small>{product?.unit}</small></div>)}</div>
        <div className="progress-cell shop-progress"><Progress value={o.progress} label="Buyurtma progressi"/><small>{o.progress}%</small></div>
        <InfoGrid columns={4} items={[
          {label:'Mashina',value:equipment?<span className="shop-machine">{equipment.name}<StatusBadge>{equipment.status}</StatusBadge></span>:'—'},
          {label:'Operator',value:employeeName(s,o.responsibleId)},
          {label:'Material',value:o.materialReserved?'Rezervda':'Rezervsiz',tone:o.materialReserved?'success':'warning'},
          {label:'Final QC',value:o.qualityStatus||'Pending',tone:o.qualityStatus==='Passed'?'success':['Failed','Scrap'].includes(o.qualityStatus)?'danger':undefined},
        ]}/>
        {op?.instructions&&<p className="shop-instructions">{op.instructions}</p>}
        {op?.worksheet&&<div className="inline-note"><Icon name="file"/>Work instruction: <b>{op.worksheet}</b></div>}
        {openDowntime&&<div className="inline-note danger"><Icon name="warning"/>{equipment?.name} to‘xtagan: {openDowntime.reason} · {openDowntime.start}</div>}
        <div className="operator-actions">
          {current&&current.status!=='Jarayonda'&&<button type="button" className="operator-btn start" disabled={!canEdit||Boolean(openDowntime)||!['Tasdiqlangan','Jarayonda','Pauzada'].includes(o.status)} onClick={()=>app.startWorkOrder(o.id,current.id)}><Icon name="play" size={24}/><b>{current.status==='Pauzada'?'DAVOM ETTIRISH':'START'}</b></button>}
          {current?.status==='Jarayonda'&&<button type="button" className="operator-btn" disabled={!canEdit} onClick={()=>app.pauseWorkOrder(o.id,current.id)}><Icon name="pause" size={24}/><b>PAUZA</b></button>}
          {current&&['Jarayonda','Pauzada'].includes(current.status)&&<button type="button" className="operator-btn complete" disabled={!canEdit} onClick={()=>app.finishWorkOrder(o.id,current.id)}><Icon name="check" size={24}/><b>YAKUNLASH</b></button>}
          <button type="button" className="operator-btn" disabled={!canEdit||!running} onClick={()=>setModal('output')}><Icon name="plus" size={24}/><b>NATIJA</b></button>
          <button type="button" className="operator-btn warn" disabled={!canEdit||!running} onClick={()=>setModal('scrap')}><Icon name="trash" size={24}/><b>SCRAP</b></button>
          <button type="button" className="operator-btn" disabled={!canEdit||!running} onClick={()=>app.transitionProduction(o.id,'Sifat nazoratida')}><Icon name="shield" size={24}/><b>SIFAT NAZORATI</b></button>
          {equipment&&(openDowntime
            ?<button type="button" className="operator-btn warn" disabled={!canEdit} onClick={()=>app.endDowntime(openDowntime.id)}><Icon name="play" size={24}/><b>STOPNI YOPISH</b></button>
            :<button type="button" className="operator-btn danger" disabled={!canEdit} onClick={()=>setModal('stop')}><Icon name="stop" size={24}/><b>STOP</b></button>)}
        </div>
      </Card>
      <div className="shop-side">
        <Card title="Material" subtitle="scan: SKU / LOT → BOM bilan solishtiriladi">
          <form className="scanner-line" onSubmit={e=>{e.preventDefault();submitScan()}}><Input value={scan} onChange={e=>setScan(e.target.value)} placeholder="Scan: SKU / LOT..." aria-label="Material kodi"/><button type="submit" className="secondary-glass-btn" disabled={!scan.trim()||!canEdit}><Icon name="scan"/>Tekshirish</button></form>
          <div className="stack-list">{o.bomSnapshot.components.map(c=><div className="list-row" key={c.id}><span className="list-row-copy"><b>{materialName(s,c.materialId)}</b><small>{c.qty} {c.unit}/dona · FIFO lot {s.lots.filter(l=>l.itemId===c.materialId&&l.qty>0).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]?.code||'—'}</small></span><b className="num">{qty(c.qty*(1+c.waste/100)*remainingQty(o),c.unit)}</b></div>)}</div>
        </Card>
        <Card title="Operatsiyalar" subtitle={`${done}/${o.workOrders.length} bajarildi`}><WorkOrderList order={o} compact/></Card>
      </div>
    </div>
    {modal==='output'&&<OutputModal order={o} onClose={()=>setModal(null)}/>}
    {modal==='scrap'&&<ScrapModal order={o} onClose={()=>setModal(null)}/>}
    {modal==='stop'&&equipment&&<StopModal equipmentId={equipment.id} note={`Shop floor · ${o.code}`} onClose={()=>setModal(null)}/>}
    <p className="soft-meta">Oxirgi yangilanish: {stamp(now).slice(11)}</p>
  </div>
}


const STOP_REASONS:Array<{value:DowntimeReason;label:string}>=[{value:'Unplanned stop',label:'Kutilmagan to‘xtash (nosozlik)'},{value:'Setup / changeover',label:'Sozlash / almashtirish'},{value:'Material wait',label:'Material kutish'},{value:'Quality hold',label:'Sifat bo‘yicha to‘xtatish'},{value:'Maintenance',label:'Texnik xizmat'}]

/** Shop-floor STOP asks why the machine stopped, so downtime analysis is not all "unplanned" (N-17). */
function StopModal({equipmentId,note,onClose}:{equipmentId:string;note:string;onClose:()=>void}){
  const app=useApp()
  const [reason,setReason]=useState<DowntimeReason>('Unplanned stop'),[detail,setDetail]=useState('')
  const submit=()=>{const r=app.startDowntime(equipmentId,reason,detail.trim()?`${note} · ${detail.trim()}`:note);if(r.ok)onClose()}
  return <Modal open onClose={onClose} title="Uskunani to‘xtatish" subtitle={app.state.equipment.find(e=>e.id===equipmentId)?.name} size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" onClick={submit}><Icon name="stop" size={16}/>STOP</button></>}>
    <div className="form-stack">
      <Field label="Sabab" required><Select value={reason} onChange={v=>setReason(v as DowntimeReason)}>{STOP_REASONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
      <Field label="Izoh"><Input value={detail} onChange={e=>setDetail(e.target.value)} placeholder="Ixtiyoriy"/></Field>
    </div>
  </Modal>
}
