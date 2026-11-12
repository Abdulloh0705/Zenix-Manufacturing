import {useMemo,useState} from 'react'
import {Link,useNavigate} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Empty,Icon,KPI,PageHeader,Progress,Segmented,StatusBadge,Timeline,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {ProductionStatus,SystemRoleKey} from '../../../types'
import {DASHBOARD_PERIODS as P,dashboardSnapshot} from '../../../domain/dashboard'
import {deliveryRisk} from '../../../domain/manufacturingEngine'
import type {MaterialStockState} from '../../../domain/manufacturingEngine'
import {dayOfMonth,displayStamp,isAmbiguousStamp,longDate,shortDate} from '../../../utils/dates'
import {cls,compactDuration as hours,compactMoney,num,qty} from '../../../utils/format'
import {equipmentName,itemUnitOf,materialName,productName,workCenterCode} from '../../common/lookups'
import {BarList,ColumnChart,StackedBar} from '../../common/charts'
import {StatStrip} from '../../common/StatStrip'
import {OrderDrawer,OrderFormModal} from '../../production/components/OrderParts'

type Attention={id:string;tone:'danger'|'warning';title:string;detail:string;count:number;path:string}

type WorkspaceLink={module:string;label:string;path:string}

const ROLE_WORKSPACE:Partial<Record<SystemRoleKey,WorkspaceLink[]>>={
  production_manager:[
    {module:'production',label:'Rejalashtirish',path:'/production?view=planning'},
    {module:'production',label:'Ishlab chiqarish buyurtmalari',path:'/production?view=orders'},
    {module:'materials',label:'Material talabi',path:'/materials?view=requirements'},
  ],
  operator:[
    {module:'production',label:'Sex ishlari',path:'/production?view=shop-floor'},
    {module:'production',label:'Operatsiyalar',path:'/production?view=operations'},
  ],
  quality:[
    {module:'quality',label:'Sifat tekshiruvlari',path:'/quality?view=checks'},
    {module:'quality',label:'NCR va tuzatishlar',path:'/quality?view=alerts'},
  ],
  maintenance:[
    {module:'equipment',label:'Texnik xizmat',path:'/equipment?view=maintenance'},
    {module:'equipment',label:'Uskunalar to‘xtashi',path:'/equipment?view=downtime'},
  ],
  warehouse:[
    {module:'warehouse',label:'Ombor qoldiqlari',path:'/warehouse?view=stock'},
    {module:'warehouse',label:'Transferlar',path:'/warehouse?view=transfers'},
    {module:'purchases',label:'Qabul qilish',path:'/purchases?view=receiving'},
  ],
  supply_sales:[
    {module:'purchases',label:'Xarid buyurtmalari',path:'/purchases?view=orders'},
    {module:'sales',label:'Sotuv buyurtmalari',path:'/sales?view=orders'},
  ],
}
const STATUS_SLOT:Record<ProductionStatus,'muted'|'mfg'|number>={'Qoralama':'muted','Material kutilmoqda':2,'Tasdiqlangan':1,'Jarayonda':'mfg','Pauzada':4,'Sifat nazoratida':5,'Yakunlangan':3,'Bekor qilingan':'muted'}
const STOCK_SLOT:Record<MaterialStockState,string>={Shortage:'danger',Kritik:'2',Reorder:'warning',Normal:'success'}
const STOCK_TONE:Record<MaterialStockState,'danger'|'warning'|'success'>={Shortage:'danger',Kritik:'danger',Reorder:'warning',Normal:'success'}

const names=(list:string[])=>{const u=[...new Set(list)];return u.slice(0,3).join(', ')+(u.length>3?` +${u.length-3}`:'')}
const ordersPath=(query='')=>`/production?view=orders${query?`&${query}`:''}`
const statusPath=(status:string)=>ordersPath(`status=${encodeURIComponent(status)}`)
const signedMoney=(v:number)=>`${v>0?'+':''}${compactMoney(v)}`
// In today's company zone; a time written around a zone change is shown as written and marked (≈).
const eventTime=(raw:string,today:string)=>{const stamp=displayStamp(raw).slice(0,16),mark=isAmbiguousStamp(raw)?' ≈':'';return (stamp.slice(0,10)===today?stamp.slice(11,16):`${shortDate(stamp)} ${stamp.slice(11,16)}`)+mark}

export default function Dashboard(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [create,setCreate]=useState(false),[orderId,setOrderId]=useRecordParam()
  const [trendParam,setTrend]=useSearchParamState('trend','7')
  const trendDays=trendParam==='30'?30:7
  const d=useMemo(()=>dashboardSnapshot(s,trendDays),[s,trendDays])
  const {output,delivery,materials:mat,capacity:cap,oee,quality,downtime,cost}=d
  const canCreate=app.can('production','create')
  const link=(label:string,path:string)=><button type="button" className="ghost-btn" onClick={()=>navigate(path)}>{label}<Icon name="chevron" size={13}/></button>

  const running=d.open.filter(o=>o.status==='Jarayonda').length,paused=d.open.filter(o=>o.status==='Pauzada').length
  const hasOee=oee.availability+oee.performance+oee.quality>0
  const weakest=[{label:'Availability',value:oee.availability},{label:'Performance',value:oee.performance},{label:'Quality',value:oee.quality}].sort((a,b)=>a.value-b.value)[0]
  const trendPct=output.trendPlanned?Math.round(output.trendProduced/output.trendPlanned*100):null

  const attention=([
    {id:'risk',tone:'danger',title:'Muddat riskidagi buyurtmalar',detail:[delivery.overdue.length?`${delivery.overdue.length} kechikkan`:'',names(delivery.risky.map(o=>o.code))].filter(Boolean).join(' · '),count:delivery.risky.length,path:ordersPath('risk=1')},
    {id:'shortage',tone:mat.critical.length?'danger':'warning',title:'Material yetishmovchiligi',detail:names(mat.shortages.map(r=>r.m.name)),count:mat.shortages.length,path:'/materials?view=shortages'},
    {id:'defects',tone:'danger',title:`QC nuqsonlari · ${P.quality} kun`,detail:names(quality.defects.map(q=>materialName(s,q.itemId))),count:quality.defects.length,path:`/quality?view=defects&range=${P.quality}`},
    {id:'down',tone:'danger',title:'Uskuna to‘xtagan (ochiq downtime)',detail:names(downtime.open.map(e=>equipmentName(s,e.equipmentId))),count:downtime.open.length,path:'/equipment?view=downtime'},
    {id:'waiting',tone:'warning',title:'Material kutayotgan buyurtmalar',detail:names(mat.waiting.map(o=>o.code)),count:mat.waiting.length,path:statusPath('Material kutilmoqda')},
    {id:'capacity',tone:'warning',title:'Sig‘imdan oshgan work center',detail:names(cap.overloaded.map(l=>`${l.workCenter.name} ${l.utilization}%`)),count:cap.overloaded.length,path:'/production?view=planning&mode=Capacity&load=over'},
    {id:'qc-pending',tone:'warning',title:'QC kutilmoqda',detail:names(quality.pending.map(q=>materialName(s,q.itemId))),count:quality.pending.length,path:'/quality?view=checks&status=Pending'},
    {id:'service',tone:'warning',title:'Servis muddati 3 kun ichida',detail:names(d.serviceDue.map(e=>e.name)),count:d.serviceDue.length,path:'/equipment?view=preventive'},
  ] as Attention[]).filter(a=>a.count>0).sort((a,b)=>a.tone===b.tone?0:a.tone==='danger'?-1:1)

  const recent=[...d.open].sort((a,b)=>a.due.localeCompare(b.due)).slice(0,6)
  const stockRows=[...mat.stock].sort((a,b)=>Object.keys(STOCK_TONE).indexOf(a.state)-Object.keys(STOCK_TONE).indexOf(b.state)||a.p.available/Math.max(1,a.m.reorderPoint)-b.p.available/Math.max(1,b.m.reorderPoint)).slice(0,5)
  // Newest operational events first (the log is not stored in date order).
  const operational=s.activity.filter(a=>['Ishlab chiqarish','Sifat','Uskunalar','Ombor','Xaridlar'].includes(a.module))
  const activity=[...(operational.length>=3?operational:s.activity)].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6)
  const branch=s.branches.find(b=>b.id===s.settings.defaultBranchId)

  const workspace=app.currentRole.key ? ROLE_WORKSPACE[app.currentRole.key] : undefined
  const workspaceLinks=workspace?.filter(item=>app.can(item.module))

  return <div className="page-stack">
    <PageHeader title="Boshqaruv paneli" subtitle={`${longDate()} · ${branch?.name||'Barcha filiallar'} · ${d.open.length} ochiq buyurtma`}
      actions={<>
        {app.can('ai')&&s.settings.ai.enabled&&<button type="button" className="secondary-glass-btn" onClick={()=>app.setAiOpen(true)}><Icon name="spark"/>AI tahlil</button>}
        {canCreate&&<button type="button" className="primary-glass-btn" onClick={()=>setCreate(true)}><Icon name="plus"/>Yangi buyurtma</button>}
      </>}/>

    {!!workspaceLinks?.length&&<Card title="Ish joyim" subtitle={app.currentRole.name}>
      <nav className="role-workspace-links" aria-label="Rolga mos ish joyi">
        {workspaceLinks.map(item=><Link key={item.path} className="secondary-glass-btn" to={item.path}>{item.label}</Link>)}
      </nav>
    </Card>}

    <div className="dash-grid">
      {/* 1–8: what happened, is it on time, material, efficiency, quality, stops, cost */}
      <div className="kpi-grid cols-8 dash-kpis">
        <KPI label="Bugun ishlab chiqarildi" value={num(output.today)} sub={`reja ${num(output.plannedToday)} · 7 kun ${num(output.week)}`} tone="mfg" icon={<Icon name="factory"/>} onClick={()=>navigate('/reports?view=production&days=7')}/>
        <KPI label="Faol buyurtmalar" value={d.open.length} sub={`${running} jarayonda · ${paused} pauzada`} tone="mfg" icon={<Icon name="play"/>} onClick={()=>navigate(ordersPath())}/>
        <KPI label={`O‘z vaqtida · ${P.onTime} kun`} value={delivery.rate===null?'—':`${delivery.rate}%`} sub={delivery.completed?`${delivery.onTime} / ${delivery.completed} MO vaqtida`:'Yakunlangan MO yo‘q'} tone={delivery.rate===null?'neutral':delivery.rate<90?'orange':'mint'} icon={<Icon name="clock"/>} onClick={()=>navigate(`/reports?view=production&days=${P.onTime}`)}/>
        <KPI label="Material yetishmovchiligi" value={mat.shortages.length} sub={mat.shortages.length?`${mat.critical.length} kritik · ${mat.waiting.length} MO kutmoqda`:'Talab qoplangan'} tone={mat.critical.length?'pink':mat.shortages.length?'orange':'mint'} icon={<Icon name="layers"/>} onClick={()=>navigate('/materials?view=shortages')}/>
        <KPI label={`OEE · ${P.oee} kun`} value={hasOee?`${oee.oee}%`:'—'} sub={hasOee?`eng past: ${weakest.label} ${weakest.value}%`:'Qayd etilgan ish vaqti yo‘q'} tone="mfg" icon={<Icon name="gauge"/>} onClick={()=>navigate(`/reports?view=oee&days=${P.oee}`)}/>
        <KPI label={`Sifat darajasi · ${P.quality} kun`} value={quality.passRate===null?'—':`${quality.passRate}%`} sub={`${quality.checks} tekshiruv · ${quality.defects.length} nuqson`} tone={quality.defects.length?'orange':'mint'} icon={<Icon name="shield"/>} onClick={()=>navigate(`/reports?view=quality&days=${P.quality}`)}/>
        <KPI label={`Downtime · ${P.downtime} kun`} value={hours(downtime.minutes)} sub={downtime.top?`${downtime.top.reason} — ${hours(downtime.top.minutes)}`:'To‘xtash qayd etilmagan'} tone={downtime.open.length?'pink':'orange'} icon={<Icon name="stop"/>} onClick={()=>navigate(`/equipment?view=downtime&range=${P.downtime}`)}/>
        {/* Cost variance is financial data: only roles that may view costs see it (A-M1 / N-18). */}
        {app.can('costs')&&<KPI label={`Tannarx farqi · ${P.cost} kun`} value={cost.orders?signedMoney(cost.variance):'—'} sub={cost.orders?`fakt ${compactMoney(cost.actual,{symbol:false})} · reja ${compactMoney(cost.planned,{symbol:false})}`:'Yakunlangan MO yo‘q'} tone={!cost.orders?'neutral':cost.variance>0?'pink':'mint'} icon={<Icon name="wallet"/>} onClick={()=>navigate(`/costs?view=costing&status=closed&range=${P.cost}`)}/>}
      </div>

      <Card className="dash-panel dash-trend" title="Ishlab chiqarish" subtitle={`fakt ${num(output.trendProduced)} / reja ${num(output.trendPlanned)}${trendPct===null?'':` · ${trendPct}%`}`}
        actions={<><Segmented ariaLabel="Trend davri" items={[{value:'7',label:'7 kun'},{value:'30',label:'30 kun'}]} value={String(trendDays)} onChange={setTrend}/>{link('Hisobot',`/reports?view=production&days=${trendDays}`)}</>}>
        <ColumnChart title={`Oxirgi ${trendDays} kun: fakt va reja`} height={188} unit="dona" valueLabel="Fakt" referenceLabel="Reja" tickEvery={trendDays===30?5:1}
          data={output.trend.map(x=>({label:trendDays===7?x.label:String(dayOfMonth(x.date)),value:x.produced,reference:x.planned,detail:shortDate(x.date)}))}/>
      </Card>

      <Card className="dash-panel dash-status" title="Buyurtmalar holati" subtitle={`${d.open.length} ochiq`} actions={link('Buyurtmalar',ordersPath())}>
        <StackedBar title="Ochiq buyurtmalar status bo‘yicha" segments={d.pipeline.map(p=>({label:p.status,value:p.count,slot:STATUS_SLOT[p.status],onClick:()=>navigate(statusPath(p.status))}))}/>
        <div className="dash-closed"><span>Yopilgan</span>
          <button type="button" onClick={()=>navigate(statusPath('Yakunlangan'))}><i className="series-3"/>Yakunlangan <b>{d.closed.done}</b></button>
          <button type="button" onClick={()=>navigate(statusPath('Bekor qilingan'))}><i className="series-muted"/>Bekor <b>{d.closed.cancelled}</b></button>
        </div>
      </Card>

      <Card className="dash-panel dash-attention" title="Diqqat talab qiladi" subtitle={attention.length?`${attention.length} ta signal`:undefined}>
        {attention.length?<div className="attention-list">{attention.map(a=><button type="button" key={a.id} className={`attention-row ${a.tone}`} onClick={()=>navigate(a.path)}>
          <i aria-hidden="true"/><span><b>{a.title}</b><small>{a.detail}</small></span><strong>{a.count}</strong><Icon name="chevron" size={14}/>
        </button>)}</div>:<Empty compact icon="check" title="Hammasi joyida" text="Kechikish, yetishmovchilik, nuqson yoki to‘xtash yo‘q"/>}
      </Card>

      <Card className="dash-panel dash-capacity" title="Ish markazlari yuklamasi" subtitle={`${P.capacity} kun`} actions={link('Capacity','/production?view=planning&mode=Capacity')}>
        <StatStrip onGo={navigate} items={[
          {label:'Yuklama',value:`${cap.utilization}%`,sub:`${num(cap.loadMinutes/60)} / ${num(cap.capacityMinutes/60)} soat`,tone:cap.utilization>100?'danger':cap.utilization>85?'warning':undefined,path:'/production?view=planning&mode=Capacity'},
          {label:'Bo‘sh sig‘im',value:hours(cap.freeMinutes),sub:`${P.capacity} kun ichida`,path:'/production?view=planning&mode=Capacity'},
          {label:'Overload',value:`${cap.overloaded.length} / ${cap.loads.length}`,sub:'work center',tone:cap.overloaded.length?'danger':'success',path:'/production?view=planning&mode=Capacity&load=over'},
        ]}/>
        <BarList max={150} threshold={100} rows={cap.loads.map(l=>{
          const horizon=l.days.reduce((a,x)=>a+x.load,0)
          return {label:<>{l.workCenter.name}{cap.bottleneck?.workCenter.id===l.workCenter.id&&<StatusBadge tone="warning">Bottleneck</StatusBadge>}</>,
            sub:l.down?'Uskuna to‘xtagan':`${l.orders.length} MO · ${hours(horizon)} / ${hours(l.capacityMinutes)}`,
            value:Math.min(150,l.utilization),display:`${l.utilization}%`,tone:l.down||l.overloaded?'danger':l.utilization>85?'warning':'success',
            ariaLabel:`${l.workCenter.name}: ${l.utilization}% — operatsiyalar navbatini ochish`,onClick:()=>navigate(`/production?view=operations&wc=${l.workCenter.id}`)}
        })}/>
      </Card>

      <Card className="dash-panel flush dash-orders" title="Ochiq buyurtmalar" subtitle="muddat bo‘yicha" actions={link('Barchasi',ordersPath())}>
        {recent.length?<div className="table-scroll"><table className="fit is-interactive dash-table dash-orders-table"><thead><tr><th>MO</th><th>Mahsulot</th><th>Miqdor · progress</th><th>Status</th><th>Muddat</th></tr></thead><tbody>
          {recent.map(o=>{const late=deliveryRisk(s,o);return <tr key={o.id} tabIndex={0} aria-label={`${o.code} — buyurtmani ochish`} onClick={()=>setOrderId(o.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOrderId(o.id)}}} className={late?'row-danger':undefined}>
            <td className="c-mo"><b>{o.code}</b></td>
            <td className="c-prod"><div className="cell-main" title={productName(s,o.productId)}><b>{productName(s,o.productId)}</b><small>{workCenterCode(s,o.workCenterId)}</small></div></td>
            <td className="c-prog"><div className="progress-cell"><Progress value={o.progress} label={`${o.code} progress`}/><small>{o.progress}%</small></div><small className="cell-sub">{num(o.completed)} / {num(o.quantity)} {itemUnitOf(s,o.productId)}</small></td>
            <td className="c-status"><StatusBadge>{o.status}</StatusBadge></td>
            <td className={cls('c-due',late&&'negative')}>{shortDate(o.due)}</td>
          </tr>})}
        </tbody></table></div>:<Empty compact title="Ochiq buyurtma yo‘q" action={canCreate?<button type="button" className="secondary-glass-btn compact" onClick={()=>setCreate(true)}><Icon name="plus" size={14}/>Buyurtma yaratish</button>:undefined}/>}
      </Card>

      <Card className="dash-panel dash-quality" title="Samaradorlik va sifat" subtitle={`${P.oee} kun`}>
        <button type="button" className="dash-subhead" onClick={()=>navigate(`/reports?view=oee&days=${P.oee}`)}><span>OEE</span><b>{hasOee?`${oee.oee}%`:'—'}</b><Icon name="chevron" size={13}/></button>
        <BarList unit="%" max={100} rows={[
          {label:'Availability',value:oee.availability,display:hasOee?undefined:'—',tone:oee.availability<85?'warning':'success'},
          {label:'Performance',value:oee.performance,display:hasOee?undefined:'—',tone:oee.performance<85?'warning':'success'},
          {label:'Quality',value:oee.quality,display:hasOee?undefined:'—',tone:oee.quality<95?'warning':'success'},
        ]}/>
        <hr className="dash-divider"/>
        <button type="button" className="dash-subhead" onClick={()=>navigate(`/reports?view=quality&days=${P.quality}`)}><span>Sifat · pass rate</span><b>{quality.passRate===null?'—':`${quality.passRate}%`}</b><Icon name="chevron" size={13}/></button>
        <StatStrip onGo={navigate} items={[
          {label:'Nuqson',value:quality.defects.length,sub:`${P.quality} kun`,tone:quality.defects.length?'danger':'success',path:`/quality?view=defects&range=${P.quality}`},
          {label:'Rework',value:quality.rework.length,sub:'navbatda',tone:quality.rework.length?'warning':undefined,path:'/quality?view=rework'},
          {label:'Kutilmoqda',value:quality.pending.length,sub:'QC navbati',tone:quality.pending.length?'warning':undefined,path:'/quality?view=checks&status=Pending'},
        ]}/>
      </Card>

      <Card className="dash-panel flush dash-material" title="Xomashyo zaxirasi" subtitle={`${mat.stock.length} material`} actions={link('Qoldiqlar','/materials?view=stock')}>
        <div className="dash-health">
          <div className="stacked-bar" aria-hidden="true">{mat.states.filter(x=>x.count>0).map(x=><span key={x.state} className={`series-${STOCK_SLOT[x.state]}`} style={{flexGrow:x.count}}/>)}{!mat.stock.length&&<span className="empty-seg"/>}</div>
          <div className="dash-chips">{mat.states.map(x=><button type="button" key={x.state} className="dash-chip" aria-label={`${x.state}: ${x.count} material — qoldiqlarni ochish`} onClick={()=>navigate(`/materials?view=stock&level=${x.state}`)}><i className={`series-${STOCK_SLOT[x.state]}`}/>{x.state}<b>{x.count}</b></button>)}</div>
        </div>
        {stockRows.length?<div className="table-scroll"><table className="fit is-interactive dash-table dash-stock-table"><thead><tr><th>Material</th><th className="align-right">On hand</th><th className="align-right">Rezerv</th><th className="align-right">Available</th><th>Holat</th></tr></thead><tbody>
          {stockRows.map(r=><tr key={r.id} tabIndex={0} aria-label={`${r.m.name} — materialni ochish`} onClick={()=>navigate(`/materials?view=stock&id=${r.id}`)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();navigate(`/materials?view=stock&id=${r.id}`)}}} className={r.state==='Shortage'||r.state==='Kritik'?'row-danger':r.state==='Reorder'?'row-warning':undefined}>
            <td className="c-name"><div className="cell-main"><b>{r.m.name}</b><small className={r.p.projected<0?'negative':undefined}>{r.p.projected<0?`yetishmaydi ${qty(-r.p.projected,r.m.unit)}`:r.p.incoming?`yo‘lda ${qty(r.p.incoming,r.m.unit)}`:r.m.unit}</small></div></td>
            <td className="c-oh align-right" data-label="On hand">{num(r.p.onHand)}</td>
            <td className="c-rz align-right" data-label="Rezerv">{r.p.reserved?num(r.p.reserved):'—'}</td>
            <td className="c-av align-right" data-label="Available"><b>{num(r.p.available)}</b></td>
            <td className="c-state"><StatusBadge tone={STOCK_TONE[r.state]}>{r.state}</StatusBadge></td>
          </tr>)}
        </tbody></table></div>:<Empty compact title="Xomashyo yo‘q"/>}
      </Card>

      <Card className="dash-panel dash-activity" title="So‘nggi faoliyat" actions={link('Faoliyat jurnalini ochish','/employees?view=activity')}>
        <Timeline items={activity.map(a=>({title:a.action,meta:<>{a.user}{a.detail?` · ${a.detail}`:''}</>,time:eventTime(a.date,d.today),tone:a.severity==='danger'?'danger':a.severity==='warning'?'warning':a.severity==='success'?'success':'info'}))}/>
      </Card>
    </div>
    {create&&<OrderFormModal onClose={()=>setCreate(false)}/>}
    <OrderDrawer orderId={orderId} onClose={()=>setOrderId(null)}/>
  </div>
}
