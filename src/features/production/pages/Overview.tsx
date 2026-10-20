import {Component,useMemo,useState} from 'react'
import type {ErrorInfo,ReactNode} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,Icon,KPI,PageHeader,Progress,Segmented,StatusBadge,useSearchParamState} from '../../../shared/ui'
import type {Tone} from '../../../shared/ui'
import type {ActivityItem,ManufacturingState} from '../../../types'
import {COST_VARIANCE_ALERT,CONTROL_PERIODS as P,QUEUE_FILTERS,inQueue,productionControl} from '../../../domain/productionControl'
import type {ControlExceptionId,OrderOperation,ProductionControl,QueueFilter} from '../../../domain/productionControl'
import type {EquipmentActivity,OrderMaterialStatus,OrderUrgency} from '../../../domain/manufacturingEngine'
import {addDays,daysBetween,formatMinutes,longDate,minutesBetween,shortDate,stamp} from '../../../utils/dates'
import {cls,compactDuration as hours,compactMoney,currencyMeta,num,qty,signed} from '../../../utils/format'
import {employeeName,equipmentName,itemUnitOf,materialName,productName,useNow,workCenterName} from '../../common/lookups'
import {BarList} from '../../common/charts'
import {StatStrip} from '../../common/StatStrip'
import {BLOCKER_LABEL,OrderFormModal} from '../components/OrderParts'

/* Every figure here comes from `productionControl` (src/domain/productionControl.ts); each link opens the
   page + filter whose rows or total equal the number that was clicked. Each block is its own component
   inside a `PanelBoundary`, so one block failing never takes the control centre down. */

const QUEUE_ROWS=8,MATERIAL_ROWS=5,ACTIVITY_ROWS=7
const ordersPath=(query='')=>`/production?view=orders${query?`&${query}`:''}`
const statusQuery=(status:string)=>`status=${encodeURIComponent(status)}`
const capacityPath=(load='')=>`/production?view=planning&mode=Capacity${load?`&load=${load}`:''}`
const queuePath=(workCenterId:string)=>`/production?view=operations&wc=${workCenterId}`
const checksPath=(status:string)=>`/quality?view=checks&status=${status}&range=${P.quality}`
const COST_PATH=`/costs?view=costing&status=closed&range=${P.cost}`
const SHORTAGES_PATH='/materials?view=shortages'
const TODAY_REPORT='/reports?view=production&days=1'
const signedMoney=(v:number)=>signed(v,x=>compactMoney(x,{symbol:false}))
const names=(list:string[])=>{const u=[...new Set(list)];return u.slice(0,3).join(', ')+(u.length>3?` +${u.length-3}`:'')}
const eventTime=(at:string,today:string)=>at.slice(0,10)===today?at.slice(11,16):`${shortDate(at)} ${at.slice(11,16)}`
const rowKey=(run:()=>void)=>(e:{key:string;preventDefault:()=>void})=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run()}}
const loadTone=(utilization:number,stopped=false)=>stopped||utilization>100?'danger' as const:utilization>85?'warning' as const:'success' as const

/** Quick filters of the queue → the Production Orders filter that lists the same rows. */
const QUEUE:Record<QueueFilter,{label:string;query:string;empty:string}>={
  all:{label:'Barchasi',query:'',empty:'Ochiq buyurtma yo‘q'},
  risk:{label:'Riskda',query:'risk=1',empty:'Muddat riskidagi buyurtma yo‘q'},
  late:{label:'Kechikkan',query:'due=overdue',empty:'Kechikkan buyurtma yo‘q'},
  today:{label:'Bugun',query:'due=today',empty:'Bugun muddati tugaydigan buyurtma yo‘q'},
  material:{label:'Material',query:statusQuery('Material kutilmoqda'),empty:'Material kutayotgan buyurtma yo‘q'},
  running:{label:'Jarayonda',query:statusQuery('Jarayonda'),empty:'Jarayondagi buyurtma yo‘q'},
  paused:{label:'Pauzada',query:statusQuery('Pauzada'),empty:'Pauzadagi buyurtma yo‘q'},
  critical:{label:'Kritik',query:'priority=Kritik',empty:'Kritik ustuvorlikdagi buyurtma yo‘q'},
}
const MATERIAL:Record<OrderMaterialStatus,{label:string;tone:Tone}>={Rezervda:{label:'Rezervda',tone:'success'},Available:{label:'Omborda bor',tone:'info'},Shortage:{label:'Yetishmaydi',tone:'danger'}}
const ACTIVITY:Record<EquipmentActivity,{label:string;tone:Tone}>={running:{label:'Ishlayapti',tone:'mfg'},idle:{label:'Bo‘sh',tone:'neutral'},down:{label:'To‘xtagan',tone:'danger'}}
const RISK_NOTE:Partial<Record<OrderUrgency,string>>={overdue:'kechikdi',risk:'ulgurmaydi',material:'material kutmoqda'}
const EXCEPTION:Record<ControlExceptionId,{title:string;path:string}>={
  late:{title:'Kechikkan buyurtmalar',path:ordersPath('due=overdue')},
  risk:{title:'Muddat riskidagi buyurtmalar',path:ordersPath('risk=1')},
  shortage:{title:'Material yetishmovchiligi',path:SHORTAGES_PATH},
  qc:{title:`QC failed · ${P.quality} kun`,path:checksPath('Failed')},
  down:{title:'Uskuna to‘xtagan',path:'/equipment?view=downtime'},
  overload:{title:'Sig‘imdan oshgan work center',path:capacityPath('over')},
  blocked:{title:'Bloklangan buyurtmalar',path:ordersPath('blocked=1')},
  service:{title:'Servis muddati 3 kun ichida',path:'/equipment?view=preventive'},
  cost:{title:`Tannarxi rejadan ${COST_VARIANCE_ALERT}%+ oshgan MO · ${P.cost} kun`,path:COST_PATH},
}

type Ctx={c:ProductionControl;s:ManufacturingState;now:Date;go:(path:string)=>void;open:(id:string)=>void;canCreate:boolean;onCreate:()=>void}
type PanelProps={x:Ctx}

function dueNote(due:string,urgency:OrderUrgency,today:string){
  const days=daysBetween(today,due)
  const when=days<0?`${-days} kun kechikdi`:days===0?'bugun':days===1?'ertaga':`${days} kun qoldi`
  return urgency==='risk'?`${when} · ulgurmaydi`:when
}
const operationNote=(op:OrderOperation)=>`${op.state==='next'?'keyingi: ':''}${op.workOrder.name} · ${op.done}/${op.total}`
const moreLink=(go:Ctx['go'],label:string,path:string)=><button type="button" className="ghost-btn" onClick={()=>go(path)}>{label}<Icon name="chevron" size={13}/></button>

/** The short reason behind each exception: who, how much, since when. */
function exceptionItems(id:ControlExceptionId,{c,s,now}:Ctx):string[]{
  switch(id){
    case 'late':return c.overdue.map(o=>`${o.code} · ${daysBetween(o.due,c.today)} kun`)
    case 'risk':return c.queue.filter(r=>r.risk).map(r=>`${r.order.code} · ${RISK_NOTE[r.urgency]||'xavf ostida'}`)
    case 'shortage':return c.materials.shortages.map(r=>r.shortage>0?`${r.m.name} −${qty(r.shortage,r.m.unit)}`:r.m.name)
    case 'qc':return c.quality.failed.map(q=>`${materialName(s,q.itemId)}${q.reason?` · ${q.reason}`:''}`)
    case 'down':return c.equipment.downtime.open.map(e=>`${equipmentName(s,e.equipmentId)} · ${e.reason} · ${formatMinutes(minutesBetween(e.start,stamp(now)))}`)
    case 'blocked':return c.blocked.map(r=>`${r.order.code} · ${r.blocker?BLOCKER_LABEL[r.blocker]:''}`)
    case 'service':return c.equipment.serviceDue.map(e=>`${e.name} · ${shortDate(e.nextMaintenance)}`)
    default:return c.exceptions.find(e=>e.id===id)?.items??[]
  }
}

/** Keeps a failing block local: the panel shows an error state with a retry, the other blocks keep working. */
class PanelBoundary extends Component<{area:string;title:string;resetKey:unknown;children:ReactNode},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(error:Error,info:ErrorInfo){console.error(`Nazorat markazi: “${this.props.title}” bloki ko‘rsatilmadi`,error,info.componentStack)}
  componentDidUpdate(prev:{resetKey:unknown}){if(this.state.failed&&prev.resetKey!==this.props.resetKey)this.setState({failed:false})}
  render(){
    if(!this.state.failed)return this.props.children
    return <Card className={`dash-panel ${this.props.area}`} title={this.props.title}>
      <Empty compact icon="warning" title="Blokni ko‘rsatib bo‘lmadi" text="Qolgan bloklar ishlayapti. Ma’lumotlar saqlangan."
        action={<button type="button" className="secondary-glass-btn compact" onClick={()=>this.setState({failed:false})}><Icon name="refresh" size={14}/>Qayta urinish</button>}/>
    </Card>
  }
}

/* ------------------------------------------------------------------ KPI -- */
function Kpis({x}:PanelProps){
  const {c,go}=x,{output,delivery,materials:mat}=c
  const planPct=output.planned?Math.round(output.good/output.planned*100):null
  return <div className="kpi-grid pc-kpis">
    <KPI label="Bugun ishlab chiqarildi" value={num(output.good)} sub={`yaroqli · reja ${num(output.planned)}${planPct===null?'':` · ${planPct}%`}`} tone="mfg" icon={<Icon name="factory"/>} onClick={()=>go(TODAY_REPORT)}/>
    <KPI label="Faol buyurtmalar" value={c.open.length} sub={`${c.queueCounts.running} jarayonda · ${c.queueCounts.paused} pauzada${c.risky.length?` · ${c.risky.length} riskda`:''}`} tone="mfg" icon={<Icon name="play"/>} onClick={()=>go(ordersPath())}/>
    <KPI label={`O‘z vaqtida · ${P.onTime} kun`} value={delivery.rate===null?'—':`${delivery.rate}%`} sub={delivery.completed?`${delivery.onTime} / ${delivery.completed} MO vaqtida`:'Yakunlangan MO yo‘q'} tone={delivery.rate===null?'neutral':delivery.rate<90?'orange':'mint'} icon={<Icon name="clock"/>} onClick={()=>go(`/reports?view=production&days=${P.onTime}`)}/>
    <KPI label="Material yetishmovchiligi" value={mat.rows.length?mat.shortages.length:'—'} sub={!mat.rows.length?'Xomashyo kiritilmagan':mat.shortages.length?`${mat.critical.length} kritik · ${mat.waiting.length} MO kutmoqda`:mat.waiting.length?`${mat.waiting.length} MO material kutmoqda`:'Talab qoplangan'} tone={!mat.rows.length?'neutral':mat.critical.length?'pink':mat.shortages.length||mat.waiting.length?'orange':'mint'} icon={<Icon name="layers"/>} onClick={()=>go(SHORTAGES_PATH)}/>
  </div>
}

/* ------------------------------------------------- Which orders first? -- */
function QueuePanel({x}:PanelProps){
  const {c,s,go,open,canCreate,onCreate}=x
  const [param,setFilter]=useSearchParamState('queue','all')
  const filter=QUEUE_FILTERS.find(f=>f===param)??'all'
  const rows=c.queue.filter(r=>inQueue(filter,r,c.today))
  return <Card className="dash-panel flush pc-queue" title="Buyurtmalar navbati" subtitle="xavf va muddat bo‘yicha" actions={moreLink(go,filter==='all'?'Barchasi':'Ro‘yxatda',ordersPath(QUEUE[filter].query))}>
    <div className="pc-filters" role="group" aria-label="Navbat filtri">{QUEUE_FILTERS.map(f=>
      <button type="button" key={f} className={cls('dash-chip',filter===f&&'is-active',!c.queueCounts[f]&&'is-empty')} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{QUEUE[f].label}<b>{c.queueCounts[f]}</b></button>)}</div>
    {rows.length?<div className="table-scroll"><table className="fit is-interactive dash-table pc-queue-table"><thead><tr><th className="c-mo">Buyurtma</th><th className="c-prog">Miqdor · progress</th><th className="c-status">Status</th><th className="c-mat">Material</th><th className="c-due">Muddat</th></tr></thead><tbody>
      {rows.slice(0,QUEUE_ROWS).map(({order:o,urgency,risk,material,blocker,operation})=>{
        const released=['Tasdiqlangan','Jarayonda','Pauzada'].includes(o.status)
        return <tr key={o.id} tabIndex={0} aria-label={`${o.code} — buyurtmani ochish`} onClick={()=>open(o.id)} onKeyDown={rowKey(()=>open(o.id))} className={risk?'row-danger':undefined}>
          <td className="c-mo"><span className="pc-mo"><b>{o.code}</b><StatusBadge>{o.priority}</StatusBadge></span><small className="cell-sub" title={productName(s,o.productId)}>{productName(s,o.productId)}</small></td>
          <td className="c-prog"><div className="progress-cell"><Progress value={o.progress} label={`${o.code} progress`}/><small>{o.progress}%</small></div><small className="cell-sub">{num(o.completed)} / {num(o.quantity)} {itemUnitOf(s,o.productId)}</small></td>
          <td className="c-status"><StatusBadge>{o.status}</StatusBadge>{blocker?<small className="cell-sub negative">{BLOCKER_LABEL[blocker]}</small>:released&&operation?<small className="cell-sub" title={operationNote(operation)}>{operationNote(operation)}</small>:null}</td>
          <td className="c-mat">{o.bomSnapshot.components.length?<StatusBadge tone={MATERIAL[material].tone}>{MATERIAL[material].label}</StatusBadge>:<span className="muted">—</span>}</td>
          <td className="c-due"><b>{shortDate(o.due)}</b><small className={cls('cell-sub',risk&&'negative')}>{dueNote(o.due,urgency,c.today)}</small></td>
        </tr>})}
    </tbody></table></div>
    :<Empty compact icon={filter==='all'?'box':'check'} title={QUEUE[filter].empty} text={filter==='all'?'Yangi buyurtma yarating yoki MRP tavsiyasidan foydalaning':''} action={filter==='all'&&canCreate?<button type="button" className="secondary-glass-btn compact" onClick={onCreate}><Icon name="plus" size={14}/>Buyurtma yaratish</button>:undefined}/>}
    {rows.length>QUEUE_ROWS&&<button type="button" className="pc-more" onClick={()=>go(ordersPath(QUEUE[filter].query))}>Yana {rows.length-QUEUE_ROWS} ta buyurtma<Icon name="chevron" size={13}/></button>}
  </Card>
}

/* ------------------------------------------- What needs action now? -- */
function AttentionPanel({x}:PanelProps){
  const {c,go}=x
  const critical=c.exceptions.filter(e=>e.tone==='danger').length,warnings=c.exceptions.length-critical
  const summary=[critical&&`${critical} kritik`,warnings&&`${warnings} ogohlantirish`].filter(Boolean).join(' · ')
  return <Card className="dash-panel pc-attention" title="Diqqat" subtitle={summary||undefined}>
    {c.exceptions.length?<div className="attention-list">{c.exceptions.map(e=><button type="button" key={e.id} className={`attention-row ${e.tone}`} onClick={()=>go(EXCEPTION[e.id].path)}>
      <i aria-hidden="true"/><span><b><span className="sr-only">{e.tone==='danger'?'Kritik: ':'Ogohlantirish: '}</span>{EXCEPTION[e.id].title}</b><small>{names(exceptionItems(e.id,x))}</small></span><strong>{e.count}</strong><Icon name="chevron" size={14}/>
    </button>)}</div>:<Empty compact icon="check" title="Muammo yo‘q" text="Kechikish, yetishmovchilik, QC failed, to‘xtash, overload yoki tannarx oshishi yo‘q"/>}
  </Card>
}

/* ------------------------------- How loaded is each work center today? -- */
function LoadPanel({x}:PanelProps){
  const {c,s,go}=x,cap=c.capacity,t=cap.today
  return <Card className="dash-panel pc-load" title="Ish markazlari" subtitle={`bugun · smena ${s.settings.policies.shiftMinutes} min`} actions={moreLink(go,'Capacity',capacityPath())}>
    {cap.loads.length?<>
      <StatStrip onGo={go} items={[
        {label:'Yuklama',value:`${t.utilization}%`,sub:`${num(t.load)} / ${num(t.capacity)} min`,tone:t.utilization>100?'danger':t.utilization>85?'warning':undefined,path:capacityPath()},
        {label:'Bo‘sh sig‘im',value:hours(t.free),sub:'bugun',path:capacityPath()},
        {label:'Overload',value:`${cap.overloaded.length} / ${cap.loads.length}`,sub:`${P.capacity} kun ichida`,tone:cap.overloaded.length?'danger':'success',path:capacityPath('over')},
        {label:'Navbat',value:cap.operations,sub:'ochiq operatsiya',path:'/production?view=operations'},
      ]}/>
      <ul className="pc-wc">{cap.loads.map(l=>{
        const d=l.today,next=l.queue[0]
        const badge=l.down?{label:'To‘xtagan',tone:'danger' as Tone}:d.utilization>100?{label:'Overload',tone:'danger' as Tone}:cap.bottleneck?.workCenter.id===l.workCenter.id?{label:'Tor joy',tone:'warning' as Tone}:d.utilization>85?{label:'Yuqori',tone:'warning' as Tone}:null
        const nowText=l.down?'uskuna to‘xtagan':l.current?`${l.current.order.code} · ${l.current.workOrder.name}`:next?`keyingi ${next.order.code} · ${next.workOrder.name}`:'navbat bo‘sh'
        const percent=d.capacity?`${d.utilization}%`:'Stop'
        return <li key={l.workCenter.id}><button type="button" className="pc-wc-row" aria-label={`${l.workCenter.name}: bugun ${d.capacity?`${d.utilization}%`:'to‘xtagan'}, navbatda ${l.queue.length} operatsiya — navbatni ochish`} onClick={()=>go(queuePath(l.workCenter.id))}>
          <span className="pc-wc-head"><b>{l.workCenter.name}</b>{badge&&<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}<strong>{percent}</strong></span>
          <span className="bar-list-track" aria-hidden="true"><span className={`tone-${loadTone(d.utilization,l.down)}`} style={{width:`${Math.min(100,Math.max(0,Math.min(150,d.utilization)/150*100))}%`}}/><i style={{left:`${100/150*100}%`}}/></span>
          <span className="pc-wc-meta">
            <span>Band <b>{num(d.load)} / {num(d.capacity)} min</b></span>
            {d.over>0?<span className="negative">Ortiqcha <b>{num(d.over)} min</b></span>:<span>Bo‘sh <b>{num(d.free)} min</b></span>}
            <span>Navbat <b>{l.queue.length}</b></span>
            <span className={cls('pc-wc-now',l.current&&!l.down&&'is-running',l.down&&'negative')}>{l.current&&!l.down?'Hozir: ':''}{nowText}</span>
          </span>
        </button></li>})}</ul>
    </>:<Empty compact icon="factory" title="Work center kiritilmagan" text="Yuklama work center va routing operatsiyalaridan hisoblanadi" action={<button type="button" className="secondary-glass-btn compact" onClick={()=>go('/equipment?view=work-centers')}>Work centers</button>}/>}
  </Card>
}

/* ------------------------------------ Which work center is the problem? -- */
function BottleneckPanel({x}:PanelProps){
  const {c,go}=x,cap=c.capacity,b=cap.bottleneck
  const others=cap.loads.filter(l=>l.workCenter.id!==b?.workCenter.id)
  return <Card className="dash-panel pc-bottleneck" title="Tor joy" subtitle={`bottleneck · ${P.capacity} kun`} actions={moreLink(go,'Work centers','/equipment?view=work-centers')}>
    {b?<>
      <div className="pc-hero"><div><b>{b.workCenter.name}</b><small>{b.workCenter.code}</small></div><StatusBadge tone={b.down||b.overloaded?'danger':'warning'}>{b.down?'To‘xtagan':b.overloaded?'Overload':'Yuqori yuklama'}</StatusBadge></div>
      <StatStrip onGo={go} items={[
        {label:'Yuklama',value:`${b.utilization}%`,sub:`${P.capacity} kun`,tone:b.utilization>100?'danger':b.utilization>85?'warning':undefined,path:capacityPath(b.overloaded?'over':b.utilization>85?'high':'')},
        {label:'Navbat',value:b.queue.length,sub:'operatsiya',path:queuePath(b.workCenter.id)},
        {label:'Kechikmoqda',value:b.delayed,sub:'riskdagi MO',tone:b.delayed?'danger':undefined,path:queuePath(b.workCenter.id)},
        {label:'Sig‘im yetishmaydi',value:b.shortage?hours(b.shortage):'—',sub:b.overDays?`${b.overDays} kun overload`:'kunlik sig‘im yetarli',tone:b.shortage?'danger':undefined,path:capacityPath(b.overloaded?'over':'')},
      ]}/>
      <div className="pc-days"><div className="mini-days" role="img" aria-label={`${b.workCenter.name}: ${P.capacity} kunlik yuklama`}>{b.days.map(d=><span key={d.date} className={d.utilization>100?'over':d.utilization>85?'high':d.load?'ok':''} title={`${shortDate(d.date)}: ${d.capacity?`${d.utilization}%`:'Stop'} · ${num(d.load)} / ${num(d.capacity)} min`}><i style={{height:`${Math.min(100,d.utilization)}%`}}/></span>)}</div>
        <small className="soft-meta">{shortDate(b.days[0].date)} — {shortDate(b.days[b.days.length-1].date)} · kunlik yuklama</small></div>
    </>:cap.loads.length?<div className="attention-row ok pc-ok"><i aria-hidden="true"/><span><b>Tor joy yo‘q — quvvat yetarli</b>
      <small>{cap.busiest?`Eng yuqori yuklama: ${cap.busiest.workCenter.name} ${cap.busiest.utilization}% · bo‘sh sig‘im ${hours(cap.freeMinutes)}`:'Yuklama yo‘q'}</small></span></div>
    :<Empty compact icon="factory" title="Work center kiritilmagan" text="Tor joy work center yuklamasidan aniqlanadi"/>}
    {others.length>0&&<div className="stack-list pc-week">{others.map(l=>{
      const constraint=cap.constraints.some(k=>k.workCenter.id===l.workCenter.id)
      return <button type="button" className="list-row is-clickable" key={l.workCenter.id} aria-label={`${l.workCenter.name}: ${P.capacity} kunda ${l.utilization}% — Capacity’ni ochish`} onClick={()=>go(capacityPath(l.overloaded?'over':''))}>
        <span className="list-row-copy"><b>{l.workCenter.name}</b><small>{l.down?'uskuna to‘xtagan · ':''}{l.orders.length} MO · {hours(l.days.reduce((a,d)=>a+d.load,0))} / {hours(l.capacityMinutes)}</small></span>
        <span className="mini-days" aria-hidden="true">{l.days.map(d=><span key={d.date} className={d.utilization>100?'over':d.utilization>85?'high':d.load?'ok':''} title={`${shortDate(d.date)}: ${d.capacity?`${d.utilization}%`:'Stop'}`}><i style={{height:`${Math.min(100,d.utilization)}%`}}/></span>)}</span>
        <span className="list-row-meta"><b className={l.utilization>100?'negative':undefined}>{l.utilization}%</b>{constraint&&<StatusBadge tone={l.down||l.overloaded?'danger':'warning'}>{l.down?'To‘xtagan':l.overloaded?'Overload':'Yuqori'}</StatusBadge>}</span>
      </button>})}</div>}
  </Card>
}

/* ------------------------------------------------ Is production on plan? -- */
function PlanPanel({x}:PanelProps){
  const {c,go}=x
  const [mode,setMode]=useSearchParamState('plan','week')
  const today=mode==='today',plan=today?c.dayPlan:c.plan
  const mps='/production?view=mps'
  const rows=today
    ?c.dayPlan.products.filter(p=>p.planned>0||p.produced>0).map(p=>({label:p.product.name,sub:p.remaining?`qoldi ${qty(p.remaining,p.product.unit)}`:'kunlik reja bajarildi',value:Math.min(100,p.completion??100),display:`${num(p.produced)} / ${num(p.planned)}`,
      ariaLabel:`${p.product.name}: bugun ${num(p.produced)} / ${num(p.planned)} — hisobotni ochish`,onClick:()=>go(TODAY_REPORT)}))
    :c.plan.products.filter(p=>p.planned>0).map(p=>({label:p.product.name,sub:`qoldi ${qty(p.remaining,p.product.unit)}${p.suggested?` · MPS tavsiya +${num(p.suggested)}`:''}`,value:p.completion??0,display:`${num(p.produced)} / ${num(p.planned)}`,
      ariaLabel:`${p.product.name}: ${num(p.produced)} / ${num(p.planned)} — MPS’ni ochish`,onClick:()=>go(mps)}))
  return <Card className="dash-panel pc-plan" title="Ishlab chiqarish rejasi" subtitle={today?`bugun · ${shortDate(c.today)}`:`shu hafta · ${shortDate(c.plan.week)} — ${shortDate(addDays(c.plan.week,6))}`}
    actions={<><Segmented ariaLabel="Reja davri" items={[{value:'today',label:'Bugun'},{value:'week',label:'Hafta'}]} value={today?'today':'week'} onChange={setMode}/>{moreLink(go,'MPS',mps)}</>}>
    {plan.planned||plan.produced?<>
      <StatStrip onGo={go} items={[
        {label:'Reja',value:num(plan.planned),sub:today?'kunlik ulush':'amalda + qoldi',path:today?'/?trend=7':mps},
        {label:'Amalda',value:num(plan.produced),sub:'tayyor kirim',path:today?TODAY_REPORT:mps},
        {label:'Qoldi',value:num(plan.remaining),sub:today?'rejagacha':'ochiq MO',path:today?ordersPath():mps},
        {label:'Bajarilish',value:plan.completion===null?'—':`${plan.completion}%`,sub:'amalda ÷ reja',tone:plan.completion!==null&&plan.completion>=100?'success':undefined,path:today?TODAY_REPORT:mps},
      ]}/>
      <BarList max={100} rows={rows}/>
      {!today&&c.plan.suggested>0&&<button type="button" className="pc-note" onClick={()=>go(mps)}><Icon name="info" size={14}/>MPS shu hafta uchun yana +{num(c.plan.suggested)} birlik MO tavsiya qiladi<Icon name="chevron" size={13}/></button>}
      <p className="pc-foot">{today
        ?'Kunlik reja = muddati bugunni qamragan MO miqdorining start→due kunlariga teng ulushi · amalda = bugungi tayyor kirim'
        :'Reja = shu hafta tayyor kirim + hafta oxirigacha muddati keladigan ochiq MO qoldig‘i (MPS birinchi haftasi)'}</p>
    </>:<Empty compact icon="calendar" title={today?'Bugun uchun reja yo‘q':'Bu hafta uchun reja yo‘q'} text={today?'Bugungi kunni qamragan MO va tayyor kirim yo‘q':'Hafta ichida muddati keladigan MO va tayyor kirim yo‘q'} action={<button type="button" className="secondary-glass-btn compact" onClick={()=>go(mps)}>MPS</button>}/>}
  </Card>
}

/* ---------------------------------------------- Is there enough material? -- */
const LEVEL_RANK={critical:0,low:1,ok:2} as const
function MaterialPanel({x}:PanelProps){
  const {c,s,go,open}=x,mat=c.materials
  const rows=[...mat.rows].sort((a,b)=>b.shortage-a.shortage||LEVEL_RANK[a.level]-LEVEL_RANK[b.level]||a.m.name.localeCompare(b.m.name))
  const tone=mat.critical.length?'danger':mat.shortages.length?'warning':'ok'
  return <Card className="dash-panel flush pc-material" title="Material holati" subtitle="MRP netting" actions={moreLink(go,'MRP','/production?view=mrp')}>
    {rows.length?<>
      <div className="pc-pad"><button type="button" className={`attention-row ${tone}`} onClick={()=>go(SHORTAGES_PATH)}>
        <i aria-hidden="true"/><span><b>{mat.shortages.length?`${mat.shortages.length} ta material yetishmovchilikda`:'Material yetishmovchiligi yo‘q'}</b>
          <small>{mat.shortages.length?`${names(mat.shortages.map(r=>r.m.name))} · ${mat.short.length?`${mat.short.length} tasi yo‘ldagi xarid bilan ham qoplanmaydi`:'MRP talabi yo‘ldagi xarid bilan qoplanadi'}`:mat.waiting.length?'MO rezerv kutmoqda':'Talab, safety stock va reorder darajasi qoplangan'}</small></span>
        {mat.shortages.length>0&&<strong>{mat.shortages.length}</strong>}<Icon name="chevron" size={14}/>
      </button></div>
      <div className="table-scroll"><table className="fit is-interactive dash-table pc-material-table"><thead><tr><th>Material</th><th className="align-right">Rezerv</th><th className="align-right">Available</th><th className="align-right">Yo‘lda</th><th className="align-right">Yetishmaydi</th></tr></thead><tbody>
        {rows.slice(0,MATERIAL_ROWS).map(r=>{
          const goTo=()=>go(`/materials?view=stock&id=${r.id}`)
          const note=r.shortage>0?'':r.level==='critical'?'min zaxiradan past':r.level==='low'?'reorder’dan past':''
          return <tr key={r.id} tabIndex={0} aria-label={`${r.m.name} — materialni ochish`} onClick={goTo} onKeyDown={rowKey(goTo)} className={r.level==='critical'?'row-danger':r.level==='low'?'row-warning':undefined}>
            <td className="c-name"><div className="cell-main"><b>{r.m.name}</b><small>{r.m.unit}{r.required?` · talab ${num(r.required)}`:''}{note&&<span className={r.level==='critical'?'negative':'pc-warn'}> · {note}</span>}</small></div></td>
            <td className="c-rz align-right" data-label="Rezerv">{r.reserved?num(r.reserved):<span className="muted">—</span>}</td>
            <td className="c-av align-right" data-label="Available"><b>{num(r.available)}</b></td>
            <td className="c-in align-right" data-label="Yo‘lda">{r.incoming?num(r.incoming):<span className="muted">—</span>}</td>
            <td className="c-sh align-right" data-label="Yetishmaydi">{r.shortage>0?<b className="negative">{num(r.shortage)}</b>:<span className="muted">—</span>}</td>
          </tr>})}
      </tbody></table></div>
      {rows.length>MATERIAL_ROWS&&<button type="button" className="pc-more" onClick={()=>go('/production?view=mrp')}>Yana {rows.length-MATERIAL_ROWS} ta material<Icon name="chevron" size={13}/></button>}
      {mat.waiting.length>0&&<div className="pc-pad pc-waiting">
        <button type="button" className="dash-subhead" onClick={()=>go('/materials?view=requirements&short=1')}><span>Material kutayotgan MO — nima yetishmaydi</span><Icon name="chevron" size={13}/></button>
        <div className="stack-list">{mat.waiting.map(({order:o,missing})=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>open(o.id)}>
          <span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small className={missing.length?'negative':undefined}>{missing.length?missing.map(l=>`${materialName(s,l.component.materialId)} — ${qty(l.shortage,l.component.unit)}`).join(', '):'Rezerv kutilmoqda'}</small></span>
          <Icon name="chevron" size={13} className="list-row-chevron"/>
        </button>)}</div>
      </div>}
    </>:<Empty compact icon="layers" title="Xomashyo kiritilmagan" text="Material holati xomashyo kartalari va MRP’dan hisoblanadi" action={<button type="button" className="secondary-glass-btn compact" onClick={()=>go('/materials')}>Xomashyo</button>}/>}
  </Card>
}

/* ------------------------------- How much came out, and how is quality? -- */
function QualityPanel({x}:PanelProps){
  const {c,go}=x,{output,quality:qc}=c
  const made=output.good+output.scrap+output.rework>0
  if(!made&&!qc.checks&&!qc.pending.length)return <Card className="dash-panel pc-quality" title="Sifat va natija" subtitle="bugun · dona" actions={moreLink(go,'Sifat','/quality')}>
    <Empty compact icon="shield" title="Natija va QC qaydi yo‘q" text={`Bugun tayyor kirim yo‘q, oxirgi ${P.quality} kunda tekshiruv o‘tkazilmagan`} action={<button type="button" className="secondary-glass-btn compact" onClick={()=>go('/quality?view=checks')}>Tekshiruvlar</button>}/>
  </Card>
  return <Card className="dash-panel pc-quality" title="Sifat va natija" subtitle="bugun · dona" actions={moreLink(go,'Sifat','/quality')}>
    <StatStrip onGo={go} items={[
      {label:'Yaroqli',value:num(output.good),sub:'tayyor kirim',path:TODAY_REPORT},
      {label:'Scrap',value:num(output.scrap),sub:output.scrap?'brak':made?'Scrap yo‘q':'natija yo‘q',tone:output.scrap?'danger':made?'success':undefined,path:'/quality?view=scrap&range=1'},
      {label:'Rework',value:num(output.rework),sub:output.rework?'rework MO':'Rework yo‘q',tone:output.rework?'warning':undefined,path:'/quality?view=rework&range=1'},
      {label:'Yield',value:output.yield===null?'—':`${output.yield}%`,sub:'yaroqli ÷ jami',path:'/quality?view=scrap&range=1'},
    ]}/>
    <button type="button" className="dash-subhead" onClick={()=>go(`/reports?view=quality&days=${P.quality}`)}><span>QC tekshiruvlari · {P.quality} kun · pass rate</span><b>{qc.passRate===null?'—':`${qc.passRate}%`}</b><Icon name="chevron" size={13}/></button>
    <StatStrip onGo={go} items={[
      {label:'Kutilmoqda',value:qc.pending.length,sub:'QC navbati',tone:qc.pending.length?'warning':undefined,path:'/quality?view=checks&status=Pending'},
      {label:'Passed',value:qc.passed.length,sub:`${qc.checks} tadan`,path:checksPath('Passed')},
      {label:'Failed',value:qc.failed.length,sub:qc.failed.length?'NCR ochilgan':qc.checks?'Failed QC yo‘q':'tekshiruv yo‘q',tone:qc.failed.length?'danger':qc.checks?'success':undefined,path:checksPath('Failed')},
      {label:'Rework',value:qc.rework.length,sub:'QC qarori',tone:qc.rework.length?'warning':undefined,path:checksPath('Rework')},
      {label:'Scrap',value:qc.scrap.length,sub:'QC qarori',tone:qc.scrap.length?'danger':undefined,path:checksPath('Scrap')},
    ]}/>
  </Card>
}

/* ----------------------------------------------- Are the machines running? -- */
function EquipmentPanel({x}:PanelProps){
  const {c,s,go,now}=x,eq=c.equipment
  return <Card className="dash-panel pc-equipment" title="Uskunalar holati" subtitle={`${eq.machines.length} uskuna`} actions={moreLink(go,'Maintenance','/equipment?view=maintenance')}>
    {eq.machines.length?<>
      <StatStrip onGo={go} items={[
        {label:'Ishlayapti',value:eq.running.length,sub:'operatsiyada',path:'/equipment?view=equipment&activity=running'},
        {label:'Bo‘sh',value:eq.idle.length,sub:'navbatsiz',path:'/equipment?view=equipment&activity=idle'},
        {label:'To‘xtagan',value:eq.down.length,sub:eq.down.length?'ochiq downtime':'Faol to‘xtash yo‘q',tone:eq.down.length?'danger':'success',path:'/equipment?view=equipment&activity=down'},
        {label:'Ta’mirda',value:eq.maintenance.length,sub:'maintenance',tone:eq.maintenance.length?'warning':undefined,path:'/equipment?view=maintenance&status=Jarayonda'},
        {label:'Servis yaqin',value:eq.serviceDue.length,sub:'3 kun ichida',tone:eq.serviceDue.length?'warning':undefined,path:'/equipment?view=preventive'},
        {label:'Downtime',value:hours(eq.downtime.minutes),sub:`${P.downtime} kun`,path:`/equipment?view=downtime&range=${P.downtime}`},
      ]}/>
      <div className="stack-list">{eq.machines.map(m=><button type="button" className="list-row is-clickable" key={m.equipment.id} onClick={()=>go(`/equipment?view=equipment&id=${m.equipment.id}`)}>
        <span className="list-row-copy"><b>{m.equipment.name}</b><small>{workCenterName(s,m.equipment.workCenterId)} · {m.job?`${m.job.order.code} · ${m.job.workOrder.name}`:m.stop?`${m.stop.reason} · ${formatMinutes(minutesBetween(m.stop.start,stamp(now)))}`:'operatsiya yo‘q'}{eq.serviceDue.some(e=>e.id===m.equipment.id)?` · servis ${shortDate(m.equipment.nextMaintenance)}`:''}</small></span>
        <span className="list-row-meta"><StatusBadge tone={ACTIVITY[m.activity].tone}>{ACTIVITY[m.activity].label}</StatusBadge></span><Icon name="chevron" size={13} className="list-row-chevron"/>
      </button>)}</div>
    </>:<Empty compact icon="wrench" title="Uskuna kiritilmagan" text="Uskuna qo‘shilgach holat, servis va downtime shu yerda ko‘rinadi" action={<button type="button" className="secondary-glass-btn compact" onClick={()=>go('/equipment?view=equipment')}>Uskunalar</button>}/>}
  </Card>
}

/* ----------------------- Is it costing more than planned, and who is working? -- */
function CostPanel({x}:PanelProps){
  const {c,s,go}=x,{cost,wip,labor}=c
  const currency=currencyMeta()
  return <Card className="dash-panel pc-cost" title="Tannarx va mehnat" subtitle={`yakunlangan MO · ${P.cost} kun${currency.prefix?'':` · ${currency.symbol}`}`} actions={moreLink(go,'Costing',COST_PATH)}>
    {cost.orders?<StatStrip onGo={go} items={[
      {label:'Reja (standart)',value:compactMoney(cost.planned,{symbol:false}),sub:`${cost.orders} MO`,path:COST_PATH},
      {label:'Amalda',value:compactMoney(cost.actual,{symbol:false}),sub:'haqiqiy tannarx',path:COST_PATH},
      {label:'Farq',value:signedMoney(cost.variance),sub:`${signed(cost.variancePct,v=>num(v,1))}%`,tone:cost.variance>0?'danger':'success',path:COST_PATH},
    ]}/>:<p className="soft-meta pc-gap">Oxirgi {P.cost} kunda yakunlangan MO yo‘q — tannarx farqi hisoblanmadi.</p>}
    {(cost.over.length>0||wip.orders>0)&&<div className="stack-list">
      {cost.over.length>0&&<button type="button" className="list-row is-clickable" onClick={()=>go(COST_PATH)}>
        <span className="list-row-copy"><b>{cost.over.length} ta MO rejadan {COST_VARIANCE_ALERT}%+ qimmat</b><small>{names(cost.over.map(o=>`${o.order.code} +${o.costing.variancePct}%`))}</small></span>
        <span className="list-row-meta"><StatusBadge tone="warning">Variance</StatusBadge></span><Icon name="chevron" size={13} className="list-row-chevron"/>
      </button>}
      {wip.orders>0&&<button type="button" className="list-row is-clickable" onClick={()=>go('/costs?view=costing&status=open')}>
        <span className="list-row-copy"><b>Ochiq MO (WIP) · {wip.orders} ta</b><small>amalda {compactMoney(wip.actual,{symbol:false})} · bajarilgan hajm standarti {compactMoney(wip.planned,{symbol:false})}</small></span>
        <span className="list-row-meta"><b className={wip.variance>0?'negative':'positive'}>{signedMoney(wip.variance)}</b></span><Icon name="chevron" size={13} className="list-row-chevron"/>
      </button>}
    </div>}
    <button type="button" className="dash-subhead pc-subhead" onClick={()=>go('/employees?view=time')}><span>Mehnat · hozir</span><Icon name="chevron" size={13}/></button>
    <StatStrip onGo={go} items={[
      {label:'Faol operator',value:labor.operators.length,sub:labor.operators.length?names(labor.operators.map(id=>employeeName(s,id).split(' ')[0])):'Ochiq ish vaqti yo‘q',path:'/employees?view=time'},
      {label:'Faol operatsiya',value:labor.operations.length,sub:labor.operations.length?names(labor.operations.map(o=>o.workOrder.name)):'Jarayonda operatsiya yo‘q',path:'/production?view=operations&status=Jarayonda'},
      {label:'Ish vaqti',value:hours(labor.minutes),sub:`${P.labor} kun · qayd etilgan`,path:`/employees?view=time&range=${P.labor}`},
    ]}/>
  </Card>
}

/* ------------------------------------------ What just happened on the floor? -- */
function ActivityPanel({x}:PanelProps){
  const {c,s,go,open}=x
  const rows=c.activity.slice(0,ACTIVITY_ROWS)
  // An event opens the record it is about: the production order, or the machine.
  const target=(a:ActivityItem)=>{
    const order=a.source&&s.productionOrders.find(o=>o.code===a.source)
    if(order)return ()=>open(order.id)
    const machine=a.source&&s.equipment.find(e=>e.name===a.source)
    return machine?()=>go(`/equipment?view=equipment&id=${machine.id}`):undefined
  }
  return <Card className="dash-panel pc-activity" title="So‘nggi faoliyat" subtitle="ishlab chiqarish · sifat · uskunalar" actions={moreLink(go,'Jurnal','/employees?view=activity')}>
    {rows.length?<ol className="timeline pc-feed">{rows.map(a=>{
      const run=target(a)
      const body=<><b>{a.action}</b><span>{a.user}{a.source?` · ${a.source}`:''}{a.detail?` · ${a.detail}`:''}</span></>
      return <li key={a.id} className={`tone-${a.severity==='danger'?'danger':a.severity==='warning'?'warning':a.severity==='success'?'success':'info'}`}><i aria-hidden="true"/>
        {run?<button type="button" className="pc-feed-link" aria-label={`${a.action} · ${a.source} — ochish`} onClick={run}>{body}</button>:<div>{body}</div>}
        <time>{eventTime(a.date,c.today)}</time>
      </li>})}</ol>
    :<Empty compact icon="history" title="Hali hodisa yo‘q" text="Buyurtma, operatsiya, QC va uskuna hodisalari shu yerda ko‘rinadi"/>}
  </Card>
}

const PANELS:Array<{area:string;title:string;Panel:(p:PanelProps)=>ReactNode}>=[
  {area:'pc-kpis',title:'Asosiy ko‘rsatkichlar',Panel:Kpis},
  {area:'pc-queue',title:'Buyurtmalar navbati',Panel:QueuePanel},
  {area:'pc-attention',title:'Diqqat',Panel:AttentionPanel},
  {area:'pc-load',title:'Ish markazlari',Panel:LoadPanel},
  {area:'pc-bottleneck',title:'Tor joy',Panel:BottleneckPanel},
  {area:'pc-plan',title:'Ishlab chiqarish rejasi',Panel:PlanPanel},
  {area:'pc-material',title:'Material holati',Panel:MaterialPanel},
  {area:'pc-quality',title:'Sifat va natija',Panel:QualityPanel},
  {area:'pc-equipment',title:'Uskunalar holati',Panel:EquipmentPanel},
  {area:'pc-cost',title:'Tannarx va mehnat',Panel:CostPanel},
  {area:'pc-activity',title:'So‘nggi faoliyat',Panel:ActivityPanel},
]

export function Overview({open}:{open:(id:string)=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate(),now=useNow(60000)
  const [create,setCreate]=useState(false),[attempt,setAttempt]=useState(0)
  const canCreate=app.can('production','create')
  // `attempt` re-runs the calculation after a failure ("Qayta hisoblash").
  const c=useMemo(()=>{try{return productionControl(s,now)}catch(error){console.error('Nazorat markazi hisoblanmadi',error);return null}},[s,now,attempt])
  const header=<PageHeader title="Ishlab chiqarish" subtitle={`Nazorat markazi · ${longDate(now)} · ${stamp(now).slice(11)}`}
    actions={canCreate&&<button type="button" className="primary-glass-btn" onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi buyurtma</button>}/>
  const x:Ctx|null=c&&{c,s,now,go:navigate,open,canCreate,onCreate:()=>setCreate(true)}

  return <div className="page-stack">
    {header}
    {x?<div className="pc-grid">{PANELS.map(({area,title,Panel})=><PanelBoundary key={area} area={area} title={title} resetKey={s}><Panel x={x}/></PanelBoundary>)}</div>
    :<Card><Empty icon="warning" title="Nazorat markazini hisoblab bo‘lmadi" text="Ishlab chiqarish ma’lumotlari saqlangan. Qayta hisoblang yoki buyurtmalar ro‘yxatini oching."
      action={<><button type="button" className="primary-glass-btn" onClick={()=>setAttempt(n=>n+1)}><Icon name="refresh" size={16}/>Qayta hisoblash</button> <button type="button" className="secondary-glass-btn" onClick={()=>navigate(ordersPath())}>Buyurtmalar</button></>}/></Card>}
    {create&&<OrderFormModal onClose={()=>setCreate(false)}/>}
  </div>
}
