import {useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,ResourceTable,SectionTitle,Select,StatusBadge,Tabs,Textarea,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {DowntimeReason,Equipment as EquipmentType,MaintenanceOrder,MaintenancePlan,WorkCenter} from '../../../types'
import {PLAN_UNITS,maintenanceCalendar,maintenanceDue,maintenanceWindow,planLabel,planOf,reliabilityOf} from '../../../domain/maintenance'
import type {DueState} from '../../../domain/maintenance'
import {calculateCapacityLoads,downtimeInPeriod,downtimeSummary,equipmentActivity,isOpenOrder,workCenterCalendar,workCenterOee} from '../../../domain/manufacturingEngine'
import {addDays,formatMinutes,minutesBetween,stamp,todayISO,weekdayShort} from '../../../utils/dates'
import {compactMoney,money} from '../../../utils/format'
import {employeeName,equipmentName,lineName,productName,useNow,workCenterName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'
import {BarList} from '../../common/charts'
import {WorkingDaysPicker,workingDaysLabel} from '../../common/WorkingDays'

export default function Equipment(){
  const [sp]=useSearchParams(),view=sp.get('view')||'equipment'
  if(view==='work-centers')return <WorkCenters/>
  if(view==='maintenance')return <Maintenance/>
  if(view==='preventive')return <Preventive/>
  if(view==='downtime')return <Downtime/>
  if(view==='requests')return <Requests/>
  if(view==='repair')return <Repairs/>
  return <Machines/>
}

const REASONS:DowntimeReason[]=['Unplanned stop','Setup / changeover','Maintenance','Material wait','Quality hold']
const ACTIVITY=[{value:'running',label:'Ishlayapti'},{value:'idle',label:'Bo‘sh'},{value:'down',label:'To‘xtagan'}]
const RANGES=[{value:'7',label:'7 kun'},{value:'30',label:'30 kun'},{value:'90',label:'90 kun'},{value:'all',label:'Butun davr'}]
const DUE_TONE:Record<DueState,'success'|'warning'|'danger'|'neutral'|'info'>={ok:'success',soon:'warning',due:'warning',overdue:'danger','no-plan':'neutral','no-data':'neutral'}
const DUE_LABEL:Record<DueState,string>={ok:'Rejada',soon:'Yaqin',due:'Bugun',overdue:'Kechikkan','no-plan':'Reja yo‘q','no-data':'Ma’lumot yo‘q'}
const hoursText=(h:number|null)=>h===null?'—':`${h} soat`

function DowntimeModal({equipmentId,onClose}:{equipmentId?:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const running=s.equipment.filter(e=>!s.downtimeEvents.some(d=>d.equipmentId===e.id&&!d.end))
  const form=useForm({equipmentId:equipmentId||running[0]?.id||'',reason:'Unplanned stop' as DowntimeReason,note:''},v=>({equipmentId:v.equipmentId?undefined:'Uskuna tanlang'}))
  return <Modal open onClose={onClose} title="Downtime boshlash" subtitle="Uskuna to‘xtaydi, operatsiyalar pauzaga o‘tadi" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" onClick={()=>form.submit(v=>{const r=app.startDowntime(v.equipmentId,v.reason,v.note);if(r.ok)onClose();return r.ok})}><Icon name="stop" size={16}/>To‘xtatish</button></>}>
    <div className="form-stack">
      <Field label="Uskuna" required error={form.error('equipmentId')}><Select value={form.values.equipmentId} onChange={v=>form.set('equipmentId',v)}>{running.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Sabab"><Select value={form.values.reason} onChange={v=>form.set('reason',v as DowntimeReason)}>{REASONS.map(r=><option key={r} value={r}>{r}</option>)}</Select></Field>
      <Field label="Izoh"><Textarea {...form.input('note')} placeholder="Nima bo‘ldi?"/></Field>
    </div>
  </Modal>
}

function Machines(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[activity,setActivity]=useSearchParamState('activity')
  const [id,setId]=useRecordParam()
  const [edit,setEdit]=useState<EquipmentType|null|'new'>(null)
  const now=equipmentActivity(s),nowOf=(e:EquipmentType)=>now.find(x=>x.equipment.id===e.id)
  const rows=s.equipment.filter(e=>(!status||e.status===status)&&(!activity||nowOf(e)?.activity===activity))
  const machine=s.equipment.find(e=>e.id===id)
  const since=addDays(todayISO(),-30),soon=addDays(todayISO(),3)
  const nextOrder=(e:EquipmentType)=>s.maintenanceOrders.filter(m=>m.equipmentId===e.id&&['Rejada','Jarayonda'].includes(m.status)).sort((a,b)=>a.scheduled.localeCompare(b.scheduled))[0]
  const downMinutes=(e:EquipmentType)=>s.downtimeEvents.filter(d=>d.equipmentId===e.id&&d.start.slice(0,10)>=since).reduce((a,d)=>a+d.minutes,0)
  return <div className="page-stack">
    <PageHeader title="Uskunalar" subtitle="Holat, servis, MTBF / MTTR, OEE" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('equipment','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Uskuna qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Nomi, model, serial..." onRow={e=>setId(e.id)} exportName="equipment"
      resetKey={`${status}|${activity}`}
      filters={<><FilterSelect label="Holat" value={status} onChange={setStatus} options={['Ishlamoqda','Servis yaqin','To‘xtagan']}/><FilterSelect label="Hozir" value={activity} onChange={setActivity} options={ACTIVITY}/></>} filtersActive={Boolean(status||activity)} onResetFilters={()=>{setStatus('');setActivity('')}}
      rowClassName={e=>e.status==='To‘xtagan'?'row-danger':e.status==='Servis yaqin'?'row-warning':undefined}
      columns={[
        {key:'name',label:'Uskuna',value:e=>e.name,render:e=><div className="cell-main"><b>{e.name}</b><small>{workCenterName(s,e.workCenterId)} · {e.model}</small></div>},
        {key:'status',label:'Holat',value:e=>e.status,render:e=><StatusBadge>{e.status}</StatusBadge>},
        {key:'now',label:'Hozir',value:e=>ACTIVITY.find(a=>a.value===nowOf(e)?.activity)?.label||'',render:e=>{const n=nowOf(e);return n?.job?<div className="cell-main"><b>Ishlayapti</b><small>{n.job.order.code} · {n.job.workOrder.name}</small></div>:n?.activity==='down'?<span className="negative">{n.stop?.reason||'To‘xtagan'}</span>:<span className="muted">Bo‘sh</span>}},
        {key:'type',label:'Maintenance',value:e=>nextOrder(e)?.type||planLabel(planOf(e)),render:e=>{const m=nextOrder(e);return m?<StatusBadge tone={m.type==='Emergency'?'danger':m.type==='Corrective'?'warning':'info'}>{m.type}</StatusBadge>:<span className="muted">PM · {planLabel(planOf(e))}</span>}},
        {key:'next',label:'Muddat',value:e=>nextOrder(e)?.scheduled||maintenanceDue(e,todayISO()).dueDate||'',render:e=>{const m=nextOrder(e);if(m)return <span className={m.scheduled.slice(0,10)<=soon?'negative':undefined}>{m.scheduled.slice(0,10)}</span>;const d=maintenanceDue(e,todayISO());return <span className="cell-main"><StatusBadge tone={DUE_TONE[d.state]}>{d.dueDate||DUE_LABEL[d.state]}</StatusBadge><small>{d.reason}</small></span>}},
        {key:'down',label:'Downtime (30k)',align:'right',value:e=>downMinutes(e),render:e=>{const m=downMinutes(e);return m?<span className={m>240?'negative':undefined}>{formatMinutes(m)}</span>:<span className="muted">—</span>}},
        {key:'mtbf',label:'MTBF',align:'right',value:e=>reliabilityOf(s,e.id).mtbfHours??-1,render:e=>{const r=reliabilityOf(s,e.id);return r.mtbfHours===null?<span className="muted" title={r.mtbfNote}>—</span>:`${r.mtbfHours} soat`}},
        {key:'mttr',label:'MTTR',align:'right',value:e=>reliabilityOf(s,e.id).mttrHours??-1,render:e=>{const r=reliabilityOf(s,e.id);return r.mttrHours===null?<span className="muted" title={r.mttrNote}>—</span>:`${r.mttrHours} soat`}},
        {key:'oee',label:'OEE (7k)',align:'right',value:e=>workCenterOee(s,e.workCenterId).oee,render:e=>{const o=workCenterOee(s,e.workCenterId);return o.plannedMinutes?<b>{o.oee}%</b>:<span className="muted">—</span>},priority:'low'},
      ]}/>
    {edit&&<EquipmentModal equipment={edit==='new'?undefined:edit} onClose={()=>setEdit(null)}/>}
    {machine&&<MachineDrawer key={machine.id} machine={machine} onClose={()=>setId(null)} onEdit={()=>setEdit(machine)}/>}
  </div>
}

/** Machine master data and its preventive plan (calendar interval or running hours). */
function EquipmentModal({equipment,onClose}:{equipment?:EquipmentType;onClose:()=>void}){
  const app=useApp(),s=app.state
  const plan=equipment?planOf(equipment):undefined
  const form=useForm({name:equipment?.name||'',model:equipment?.model||'',serial:equipment?.serial||'',workCenterId:equipment?.workCenterId||s.workCenters[0]?.id||'',
    unit:(plan?.unit||'day') as MaintenancePlan['unit'],interval:String(plan?.interval??30),duration:plan?.durationHours?String(plan.durationHours):'',nextMaintenance:equipment?.nextMaintenance||''},
    v=>({name:required(v.name,'Nomi'),serial:required(v.serial,'Serial')||(s.equipment.some(e=>e.id!==equipment?.id&&e.serial.toLowerCase()===v.serial.trim().toLowerCase())?'Serial band':undefined),
      interval:v.interval===''||(Number.isInteger(Number(v.interval))&&Number(v.interval)>0)?undefined:'Musbat butun son',duration:v.duration===''||(Number(v.duration)>0&&Number(v.duration)<=168)?undefined:'0–168 soat',
      nextMaintenance:v.nextMaintenance&&v.nextMaintenance<todayISO()&&v.nextMaintenance!==equipment?.nextMaintenance?'O‘tgan sana':undefined}))
  const save=()=>form.submit(v=>{
    const base={name:v.name.trim(),model:v.model.trim(),serial:v.serial.trim(),workCenterId:v.workCenterId}
    const r=equipment?app.updateEntity('equipment',equipment.id,base):app.createEntity('equipment',{...base,status:'Ishlamoqda',lastMaintenance:'',nextMaintenance:'',maintenanceIntervalDays:0,mtbf:0,mttr:0,downtime:0,maintenanceCost:0})
    if(!r.ok)return false
    const id=equipment?.id||r.id!
    // The plan is its own command: it validates the interval and recalculates the due date.
    const p=v.interval===''?null:{unit:v.unit,interval:Number(v.interval),durationHours:v.duration===''?undefined:Number(v.duration)}
    const changed=JSON.stringify(p)!==JSON.stringify(plan?{unit:plan.unit,interval:plan.interval,durationHours:plan.durationHours}:null)||(v.nextMaintenance||'')!==(equipment?.nextMaintenance||'')
    if(changed&&(p||plan)){const pr=app.saveMaintenancePlan(id,p,p&&p.unit!=='runtime'&&v.nextMaintenance&&v.nextMaintenance!==equipment?.nextMaintenance?v.nextMaintenance:undefined);if(!pr.ok)return false}
    onClose();return true
  })
  return <Modal open onClose={onClose} title={equipment?'Uskunani tahrirlash':'Yangi uskuna'} size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={save}>Saqlash</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Model"><Input {...form.input('model')}/></Field>
      <Field label="Serial" required error={form.error('serial')}><Input {...form.input('serial')}/></Field>
      <Field className="span-2" label="Work center"><Select value={form.values.workCenterId} onChange={v=>form.set('workCenterId',v)}>{s.workCenters.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      <div className="form-group-title">Preventive reja</div>
      <Field label="Interval turi"><Select value={form.values.unit} onChange={v=>form.set('unit',v as MaintenancePlan['unit'])}>{PLAN_UNITS.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}</Select></Field>
      <Field label="Interval" error={form.error('interval')} hint="Bo‘sh — preventive reja yo‘q"><Input type="number" min="1" step="1" {...form.input('interval')}/></Field>
      <Field label="Servis davomiyligi (soat)" error={form.error('duration')} hint="Sig‘im rejasida band qilinadi; bo‘sh — butun kun"><Input type="number" min="0" step="0.5" {...form.input('duration')}/></Field>
      {form.values.unit!=='runtime'?<Field label="Keyingi servis" error={form.error('nextMaintenance')} hint="Bo‘sh — oxirgi servisdan (yoki bugundan) hisoblanadi"><Input type="date" {...form.input('nextMaintenance')}/></Field>:<p className="soft-meta">Ish soati rejasi hisoblagich ko‘rsatkichi kiritilganda ishlaydi (uskuna kartasi → “Ish soati”).</p>}
    </div>
  </Modal>
}

/** Running-hours meter reading of a machine. */
function RuntimeModal({machine,onClose}:{machine:EquipmentType;onClose:()=>void}){
  const app=useApp()
  const form=useForm({hours:machine.runtimeHours!==undefined?String(machine.runtimeHours):''},v=>({hours:v.hours===''||!(Number(v.hours)>=0)?'Soatni kiriting':machine.runtimeHours!==undefined&&Number(v.hours)<machine.runtimeHours?`Oxirgi ko‘rsatkichdan (${machine.runtimeHours}) kam bo‘lmasin`:undefined}))
  return <Modal open onClose={onClose} size="sm" title="Ish soati hisoblagichi" subtitle={machine.runtimeReadAt?`Oxirgi: ${machine.runtimeHours} soat · ${machine.runtimeReadAt}`:'Hali ko‘rsatkich kiritilmagan'}
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.recordEquipmentRuntime(machine.id,Number(v.hours));if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <Field label="Hisoblagich (soat)" error={form.error('hours')}><Input type="number" min="0" step="0.1" {...form.input('hours')} autoFocus/></Field>
  </Modal>
}

/** Plans or reschedules a maintenance order; an overlap with another service of the machine needs a written reason. */
function MaintenanceOrderModal({order,equipmentId,onClose,onSaved}:{order?:MaintenanceOrder;equipmentId?:string;onClose:()=>void;onSaved?:(id:string)=>void}){
  const app=useApp(),s=app.state
  const [overlap,setOverlap]=useState('')
  const technicians=s.employees.filter(e=>e.status!=='Arxiv'&&(e.department==='Maintenance'||e.id===order?.technicianId||s.roles.find(r=>r.id===e.roleId)?.permissions?.equipment?.edit))
  const form=useForm({equipmentId:order?.equipmentId||equipmentId||s.equipment[0]?.id||'',type:order?.type||'Corrective',date:(order?.scheduled||addDays(todayISO(),1)).slice(0,10),time:order?.scheduled?.slice(11,16)||'09:00',hours:order?.plannedHours?String(order.plannedHours):'',technicianId:order?.technicianId||technicians.find(e=>e.department==='Maintenance')?.id||'',note:order?.note||'',override:''},
    v=>({date:v.date?undefined:'Sana',hours:v.hours===''||(Number(v.hours)>0&&Number(v.hours)<=168)?undefined:'0–168 soat',override:overlap&&!v.override.trim()?'Kesishuv sababini yozing':undefined}))
  const save=()=>form.submit(v=>{
    const scheduled=`${v.date} ${v.time||'09:00'}`,hours=v.hours===''?undefined:Number(v.hours)
    const r=order
      ?app.updateMaintenanceOrder(order.id,{scheduled,plannedHours:hours,technicianId:v.technicianId,note:v.note,override:v.override||undefined})
      :app.createMaintenanceOrder({equipmentId:v.equipmentId,type:v.type as MaintenanceOrder['type'],scheduled,plannedHours:hours,technicianId:v.technicianId||undefined,note:v.note,override:v.override||undefined})
    if(r.code==='needs-override')setOverlap(r.message)
    if(r.ok){onSaved?.(r.id!);onClose()}
    return r.ok
  })
  return <Modal open onClose={onClose} title={order?`${order.code} — rejani o‘zgartirish`:'Maintenance rejalash'} size="md" subtitle={order?'Faqat boshlanmagan buyurtma o‘zgaradi':'Rejalashtirilgan servis sig‘im va jadvalda band qilinadi'}
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={save}>{order?'Saqlash':'Rejalash'}</button></>}>
    <div className="form-grid">
      <Field label="Uskuna"><Select value={form.values.equipmentId} disabled={Boolean(order)} onChange={v=>form.set('equipmentId',v)}>{s.equipment.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Tur"><Select value={form.values.type} disabled={Boolean(order)} onChange={v=>form.set('type',v as MaintenanceOrder['type'])}>{['Preventive','Corrective','Emergency'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Sana" error={form.error('date')}><Input type="date" {...form.input('date')}/></Field>
      <Field label="Boshlanish"><Input type="time" {...form.input('time')}/></Field>
      <Field label="Davomiylik (soat)" error={form.error('hours')} hint="Bo‘sh — butun kun band"><Input type="number" min="0" step="0.5" {...form.input('hours')}/></Field>
      <Field label="Texnik"><Select value={form.values.technicianId} onChange={v=>form.set('technicianId',v)}><option value="">Avtomatik</option>{technicians.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field className="span-2" label="Ish / sabab"><Textarea {...form.input('note')}/></Field>
      {overlap&&<><div className="inline-note warning span-2"><Icon name="warning"/>{overlap}</div><Field className="span-2" label="Kesishuvni tasdiqlash sababi" required error={form.error('override')}><Input {...form.input('override')}/></Field></>}
    </div>
  </Modal>
}

function MachineDrawer({machine,onClose,onEdit}:{machine:EquipmentType;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,now=useNow(30000),navigate=useNavigate()
  const [tab,setTab]=useState('overview'),[stop,setStop]=useState(false),[request,setRequest]=useState(false),[runtime,setRuntime]=useState(false),[plan,setPlan]=useState(false)
  const rel=reliabilityOf(s,machine.id),due=maintenanceDue(machine,todayISO())
  const open=s.downtimeEvents.find(d=>d.equipmentId===machine.id&&!d.end)
  const events=s.downtimeEvents.filter(d=>d.equipmentId===machine.id)
  const maint=s.maintenanceOrders.filter(m=>m.equipmentId===machine.id)
  const oee=workCenterOee(s,machine.workCenterId)
  const orders=s.productionOrders.filter(o=>isOpenOrder(o)&&o.workOrders.some(w=>w.workCenterId===machine.workCenterId&&w.status!=='Yakunlangan'))
  const canEdit=app.can('equipment','edit')||app.can('production','edit')
  return <Drawer open onClose={onClose} title={machine.name} eyebrow="Uskuna" icon="wrench" size="lg" subtitle={`${machine.model} · ${machine.serial} · ${workCenterName(s,machine.workCenterId)}`} headerExtra={<StatusBadge>{machine.status}</StatusBadge>}
    actions={<>{app.can('equipment','create')||app.can('production','edit')?<button type="button" className="secondary-glass-btn" onClick={()=>setRequest(true)}><Icon name="wrench" size={15}/>Maintenance so‘rovi</button>:null}
      {app.can('equipment','edit')&&<button type="button" className="secondary-glass-btn" onClick={()=>setPlan(true)}><Icon name="calendar" size={15}/>Rejalash</button>}
      {app.can('equipment','edit')&&<button type="button" className="ghost-btn" onClick={()=>setRuntime(true)}><Icon name="clock" size={15}/>Ish soati</button>}<span className="spacer"/>
      {canEdit&&(open?<button type="button" className="primary-glass-btn" onClick={()=>app.endDowntime(open.id)}><Icon name="play" size={16}/>Downtime’ni yopish</button>:<button type="button" className="danger-glass-btn" onClick={()=>setStop(true)}><Icon name="stop" size={16}/>To‘xtatish</button>)}
      {app.can('equipment','edit')&&<button type="button" className="secondary-glass-btn" onClick={onEdit}><Icon name="edit" size={15}/>Tahrirlash</button>}</>}>
    {open&&<div className="inline-note danger"><Icon name="warning"/>To‘xtagan: {open.reason} · {open.start} ({formatMinutes(minutesBetween(open.start,stamp(now)))}){open.note?` · ${open.note}`:''}</div>}
    <Tabs items={[{value:'overview',label:'Umumiy'},{value:'downtime',label:'Downtime',count:events.length},{value:'maintenance',label:'Maintenance',count:maint.length},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {tab==='overview'&&<>
      <InfoGrid items={[{label:'OEE (7 kun)',value:oee.plannedMinutes?`${oee.oee}%`:'—'},{label:'Availability',value:oee.plannedMinutes?`${oee.availability}%`:'—'},{label:'Performance',value:oee.plannedMinutes?`${oee.performance}%`:'—'},{label:'Quality',value:oee.plannedMinutes?`${oee.quality}%`:'—'},
        {label:'MTBF',value:hoursText(rel.mtbfHours)},{label:'MTTR',value:hoursText(rel.mttrHours)},{label:'Qayd etilgan nosozlik',value:`${rel.failures} ta`},
        {label:'Preventive reja',value:planLabel(planOf(machine))},{label:'Oxirgi servis',value:machine.lastMaintenance||'—'},{label:'Keyingi servis',value:due.dueDate||DUE_LABEL[due.state],tone:due.state==='overdue'?'danger':due.state==='soon'||due.state==='due'?'warning':undefined},
        {label:'Ish soati',value:machine.runtimeHours!==undefined?`${machine.runtimeHours} soat${due.plan?.unit==='runtime'?` · ${due.reason}`:''}`:'—'},{label:'Maintenance xarajati',value:money(machine.maintenanceCost)}]}/>
      {(rel.mtbfNote||rel.mttrNote)&&<p className="soft-meta">MTBF / MTTR faqat qayd etilgan nosozliklardan hisoblanadi: {[rel.mtbfNote&&`MTBF — ${rel.mtbfNote}`,rel.mttrNote&&`MTTR — ${rel.mttrNote}`].filter(Boolean).join(' · ')}.</p>}
      <SectionTitle title="Navbatdagi MOlar"/>
      {orders.length?<div className="stack-list">{orders.map(o=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/production?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>due {o.due}</small></span><StatusBadge>{o.status}</StatusBadge></button>)}</div>:<Empty compact title="Ochiq operatsiya yo‘q"/>}
    </>}
    {tab==='downtime'&&(events.length?<div className="table-scroll"><table className="fit"><thead><tr><th>Boshlanish</th><th>Sabab</th><th className="align-right">Davomiylik</th><th>Izoh</th></tr></thead><tbody>{events.map(d=><tr key={d.id}><td>{d.start}</td><td><StatusBadge tone={d.end?'neutral':'danger'}>{d.reason}</StatusBadge></td><td className="align-right">{d.end?formatMinutes(d.minutes):'davom etmoqda'}</td><td className="wrap">{d.note||'—'}</td></tr>)}</tbody></table></div>:<Empty compact title="Downtime qayd etilmagan"/>)}
    {tab==='maintenance'&&(maint.length?<div className="stack-list">{maint.map(m=><button type="button" className="list-row is-clickable" key={m.id} onClick={()=>navigate(`/equipment?view=maintenance&id=${m.id}`)}><span className="list-row-copy"><b>{m.code} · {m.type}</b><small>{m.scheduled}{m.plannedHours?` · ${m.plannedHours} soat`:''} · {m.note}</small></span><span className="list-row-meta">{m.cost>0&&<span className="num">{money(m.cost)}</span>}<StatusBadge>{m.status}</StatusBadge></span></button>)}</div>:<Empty compact title="Maintenance yo‘q"/>)}
    {tab==='docs'&&<AttachmentsPanel entityType="equipment" entityId={machine.id} canEdit={app.can('equipment','edit')}/>}
    {tab==='history'&&<ActivityPanel sources={[machine.name]}/>}
    {stop&&<DowntimeModal equipmentId={machine.id} onClose={()=>setStop(false)}/>}
    {request&&<RequestModal equipmentId={machine.id} onClose={()=>setRequest(false)}/>}
    {runtime&&<RuntimeModal machine={machine} onClose={()=>setRuntime(false)}/>}
    {plan&&<MaintenanceOrderModal equipmentId={machine.id} onClose={()=>setPlan(false)}/>}
  </Drawer>
}

function WorkCenters(){
  const app=useApp(),s=app.state
  const loads=calculateCapacityLoads(s,7)
  const [edit,setEdit]=useState<WorkCenter|null>(null)
  const canEdit=app.can('equipment','edit')
  return <div className="page-stack">
    <PageHeader title="Work Centers" subtitle="7 kunlik yuklama (kalendar bo‘yicha), OEE, samaradorlik va stavka"/>
    <div className="card flush"><div className="table-scroll"><table className="wc-table"><thead><tr><th>Work center</th><th>Holat</th><th>7 kun yuklama</th><th className="align-right">Ochiq ish</th><th className="align-right">OEE (7k)</th><th className="align-right">Samaradorlik</th>{app.can('costs')&&<th className="align-right">Stavka / soat</th>}<th>Uskunalar</th>{canEdit&&<th className="action-col"><span className="sr-only">Amal</span></th>}</tr></thead><tbody>
      {s.workCenters.map(w=>{const l=loads.find(x=>x.workCenter.id===w.id)!,o=workCenterOee(s,w.id);return <tr key={w.id} className={l.down?'row-danger':l.overloaded?'row-warning':undefined}>
        <td><div className="cell-main"><b>{w.name}</b><small>{w.code} · {lineName(s,w.lineId)}</small><small>{(()=>{const c=workCenterCalendar(s,w);return `${workingDaysLabel(c.workingDays)} · ${c.shifts}×${c.shiftMinutes} min`})()}</small></div></td>
        <td><StatusBadge tone={l.down?'danger':l.overloaded?'warning':'success'}>{l.down?'To‘xtagan':l.overloaded?'Overload':'Normal'}</StatusBadge></td>
        <td><div className="wc-load"><div className="mini-days" aria-label={`${w.name}: kunlik yuklama`}>{l.days.map(d=><span key={d.date} className={d.utilization>100?'over':d.utilization>85?'high':d.load?'ok':''} title={d.working===false?`${d.date}: dam olish`:`${d.date}: ${d.utilization}%${d.blocked?` · band ${d.blocked} min`:''}`}><i style={{height:`${Math.min(100,d.utilization)}%`}}/></span>)}</div><b className={l.utilization>100?'negative':undefined}>{l.utilization}%</b></div></td>
        <td className="align-right">{formatMinutes(l.loadMinutes)}</td>
        <td className="align-right">{o.plannedMinutes?<b>{o.oee}%</b>:<span className="muted">—</span>}</td>
        <td className="align-right">{w.efficiency}%</td>
        {app.can('costs')&&<td className="align-right">{compactMoney(w.costPerHour)}</td>}
        <td className="wrap">{s.equipment.filter(e=>e.workCenterId===w.id).map(e=>e.name).join(', ')||'—'}</td>
        {canEdit&&<td className="action-col"><button type="button" className="icon-ghost" aria-label={`${w.name} — tahrirlash`} onClick={()=>setEdit(w)}><Icon name="edit" size={15}/></button></td>}
      </tr>})}
    </tbody></table></div><p className="table-note">Yuklama = qolgan setup + run vaqti ÷ (ish kunlari × smenalar × smena × samaradorlik − texnik xizmat / to‘xtash) · ustunlar = 7 kun</p></div>
    {edit&&<WorkCenterModal wc={edit} onClose={()=>setEdit(null)}/>}
  </div>
}

function WorkCenterModal({wc,onClose}:{wc:WorkCenter;onClose:()=>void}){
  const app=useApp()
  const policy=app.state.settings.policies
  const [days,setDays]=useState<number[]>(wc.calendar?.workingDays?.length?wc.calendar.workingDays:workCenterCalendar(app.state,{}).workingDays)
  const form=useForm({name:wc.name,efficiency:String(wc.efficiency),costPerHour:String(wc.costPerHour),energyCostPerHour:wc.energyCostPerHour===undefined?'':String(wc.energyCostPerHour),shifts:String(wc.calendar?.shifts??1),shiftMinutes:wc.calendar?.shiftMinutes?String(wc.calendar.shiftMinutes):''},v=>({name:required(v.name,'Nomi'),efficiency:Number(v.efficiency)>0&&Number(v.efficiency)<=120?undefined:'1–120%',costPerHour:Number(v.costPerHour)>=0?undefined:'Stavka noto‘g‘ri',
    energyCostPerHour:v.energyCostPerHour===''||Number(v.energyCostPerHour)>=0?undefined:'Manfiy bo‘lmasin',shifts:[1,2,3].includes(Number(v.shifts))?undefined:'1–3 smena',shiftMinutes:v.shiftMinutes===''||(Number(v.shiftMinutes)>=60&&Number(v.shiftMinutes)*Number(v.shifts||1)<=1440)?undefined:'60 min dan, sutkaga sig‘sin'}))
  const save=()=>form.submit(v=>{
    // Days equal to the company calendar are not stored, so a later company change still applies here.
    const own=[...days].sort().join()!==[...workCenterCalendar(app.state,{}).workingDays].sort().join()
    const r=app.updateEntity('workCenters',wc.id,{name:v.name.trim(),efficiency:Number(v.efficiency),costPerHour:Number(v.costPerHour),energyCostPerHour:v.energyCostPerHour===''?undefined:Number(v.energyCostPerHour),
      calendar:{workingDays:own?days:undefined,shifts:Number(v.shifts),shiftMinutes:v.shiftMinutes===''?undefined:Number(v.shiftMinutes)}})
    if(r.ok)onClose();return r.ok
  })
  return <Modal open onClose={onClose} title={`${wc.code} — tahrirlash`} size="md" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={save}>Saqlash</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Nomi" required error={form.error('name')}><Input {...form.input('name')}/></Field>
      <Field label="Samaradorlik %" hint="Sig‘im = smena × samaradorlik" error={form.error('efficiency')}><Input type="number" {...form.input('efficiency')}/></Field>
      <Field label="Soatlik stavka" hint="Machine cost uchun" error={form.error('costPerHour')}><MoneyInput min="0" {...form.money('costPerHour')}/></Field>
      <Field label="Energiya / ishlash soati" hint="Bo‘sh = kiritilmagan (tannarxda belgilanadi)" error={form.error('energyCostPerHour')}><Input type="number" min="0" {...form.input('energyCostPerHour')}/></Field>
      <Field label="Smenalar soni" error={form.error('shifts')}><Select value={form.values.shifts} onChange={v=>form.set('shifts',v)}>{['1','2','3'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Smena (min)" hint={`Bo‘sh = kompaniya: ${policy.shiftMinutes} min`} error={form.error('shiftMinutes')}><Input type="number" min="60" {...form.input('shiftMinutes')}/></Field>
      <div className="field span-2"><label>Ish kunlari</label><WorkingDaysPicker value={days} onChange={setDays}/></div>
    </div>
  </Modal>
}

function MaintenanceDrawer({order,onClose}:{order:MaintenanceOrder;onClose:()=>void}){
  const app=useApp(),s=app.state,now=useNow(30000)
  const [cost,setCost]=useState(String(order.cost||'')),[note,setNote]=useState(''),[cancel,setCancel]=useState(false),[reason,setReason]=useState(''),[edit,setEdit]=useState(false),[start,setStart]=useState(false)
  const canEdit=app.can('equipment','edit')
  const w=maintenanceWindow(s,order)
  const stop=s.downtimeEvents.find(d=>d.sourceId===order.id)
  const stopMinutes=order.downtimeMinutes??(stop?(stop.end?stop.minutes:minutesBetween(stop.start,stamp(now))):undefined)
  return <Drawer open onClose={onClose} title={order.code} eyebrow={`${order.type} maintenance`} icon="wrench" size="md" subtitle={`${equipmentName(s,order.equipmentId)} · ${order.scheduled}`} headerExtra={<><StatusBadge>{order.status}</StatusBadge>{order.override&&<span className="chip">Kesishuv tasdiqlangan</span>}</>}
    actions={canEdit?<>{order.status==='Rejada'&&<button type="button" className="ghost-btn" onClick={()=>setCancel(true)}>Bekor qilish</button>}{order.status==='Rejada'&&<button type="button" className="ghost-btn" onClick={()=>setEdit(true)}><Icon name="edit" size={15}/>O‘zgartirish</button>}<span className="spacer"/>{order.status==='Rejada'&&<button type="button" className="secondary-glass-btn" onClick={()=>setStart(true)}><Icon name="play" size={15}/>Boshlash</button>}{order.status==='Jarayonda'&&<button type="button" className="primary-glass-btn" disabled={cost===''||Number(cost)<0} onClick={()=>app.completeMaintenance(order.id,Number(cost),note)}><Icon name="check" size={16}/>Yakunlash</button>}</>:undefined}>
    <InfoGrid items={[{label:'Uskuna',value:equipmentName(s,order.equipmentId)},{label:'Texnik',value:employeeName(s,order.technicianId)},{label:'Reja boshlanishi',value:w.start},{label:'Reja tugashi',value:w.hours?`${w.end} · ${w.hours} soat`:'butun kun'},
      {label:'Amalda boshlangan',value:order.startedAt||'—'},{label:'Amalda tugagan',value:order.completed||'—'},{label:'To‘xtash',value:stopMinutes!==undefined?formatMinutes(stopMinutes):'—'},{label:'Xarajat',value:order.cost?money(order.cost):'—'}]}/>
    <div className="inline-note"><Icon name="info"/>{order.note}</div>
    {order.override&&<div className="inline-note warning"><Icon name="warning"/>Boshqa servis bilan kesishuv tasdiqlangan: {order.override.reason} · {employeeName(s,order.override.by)}</div>}
    {order.status==='Jarayonda'&&canEdit&&<div className="form-grid"><Field label="Yakuniy xarajat" hint="Ehtiyot qism + ish haqi"><MoneyInput min="0" value={cost} onValue={setCost}/></Field><Field label="Bajarilgan ish"><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Masalan: podshipnik almashtirildi"/></Field></div>}
    {order.status==='Rejada'&&<p className="soft-meta">Boshlash uskunani to‘xtatadi (downtime ochiladi) va ishlayotgan operatsiyalarni pauzaga o‘tkazadi; yakunlash faqat jarayon boshlanganidan keyin mavjud.</p>}
    {order.history?.length?<><SectionTitle title="Tarix"/><div className="stack-list">{order.history.map((h,i)=><div className="list-row" key={i}><span className="list-row-copy"><b>{h.action}</b><small>{h.at} · {employeeName(s,h.by)}{h.note?` · ${h.note}`:''}</small></span></div>)}</div></>:<ActivityPanel sources={[order.code]}/>}
    {edit&&<MaintenanceOrderModal order={order} onClose={()=>setEdit(false)}/>}
    <Confirm open={start} onClose={()=>setStart(false)} onConfirm={()=>app.startMaintenance(order.id)} title={`${order.code} boshlansinmi?`} text={`${equipmentName(s,order.equipmentId)} to‘xtatiladi; shu work centerdagi ishlayotgan operatsiyalar pauzaga o‘tadi.`} confirmText="Boshlash"/>
    {cancel&&<Modal open onClose={()=>setCancel(false)} size="sm" title="Maintenance bekor qilinsinmi?" footer={<><button type="button" className="secondary-glass-btn" onClick={()=>setCancel(false)}>Yopish</button><button type="button" className="danger-glass-btn" onClick={()=>{if(app.cancelMaintenance(order.id,reason).ok)setCancel(false)}}>Bekor qilish</button></>}><Field label="Sabab"><Input value={reason} onChange={e=>setReason(e.target.value)} autoFocus/></Field></Modal>}
  </Drawer>
}

function Maintenance(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[type,setType]=useSearchParamState('type')
  const [id,setId]=useRecordParam()
  const rows=s.maintenanceOrders.filter(m=>(!status||m.status===status)&&(!type||m.type===type))
  const order=s.maintenanceOrders.find(m=>m.id===id)
  const [create,setCreate]=useState(false)
  const overdue=s.equipment.filter(e=>maintenanceDue(e,todayISO()).state==='overdue').length
  return <div className="page-stack">
    <PageHeader title="Maintenance" subtitle="So‘rov → reja → boshlash → yakunlash" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('equipment','edit')} onClick={()=>setCreate(true)}><Icon name="plus"/>Maintenance rejalash</button>}/>
    <div className="kpi-grid">
      <KPI label="Rejada" value={s.maintenanceOrders.filter(m=>m.status==='Rejada').length} icon={<Icon name="calendar"/>} onClick={()=>setStatus('Rejada')}/>
      <KPI label="Jarayonda" value={s.maintenanceOrders.filter(m=>m.status==='Jarayonda').length} tone="orange" icon={<Icon name="wrench"/>} onClick={()=>setStatus('Jarayonda')}/>
      <KPI label="Servis kechikkan" value={overdue} sub="preventive reja bo‘yicha" tone="pink" icon={<Icon name="warning"/>} onClick={()=>navigate('/equipment?view=preventive')}/>
      <KPI label="Maintenance xarajati" value={compactMoney(s.equipment.reduce((a,b)=>a+b.maintenanceCost,0))} sub="jami" tone="purple" icon={<Icon name="wallet"/>} onClick={()=>navigate('/costs?view=expenses&type=Maintenance&range=all')}/>
    </div>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Kod, uskuna, izoh..." onRow={m=>setId(m.id)} exportName="maintenance-orders" resetKey={`${status}|${type}`}
      filtersActive={Boolean(status||type)} onResetFilters={()=>{setStatus('');setType('')}}
      filters={<><FilterSelect label="Status" value={status} onChange={setStatus} options={['Rejada','Jarayonda','Yakunlangan','Bekor']}/><FilterSelect label="Tur" value={type} onChange={setType} options={['Preventive','Corrective','Emergency']}/></>}
      columns={[
        {key:'code',label:'Buyurtma',value:m=>m.code,render:m=><div className="cell-main"><b>{m.code}</b><small>{m.note}</small></div>},
        {key:'equipment',label:'Uskuna',value:m=>equipmentName(s,m.equipmentId)},
        {key:'type',label:'Tur',value:m=>m.type,render:m=><StatusBadge tone={m.type==='Emergency'?'danger':m.type==='Corrective'?'warning':'info'}>{m.type}</StatusBadge>},
        {key:'status',label:'Status',value:m=>m.status,render:m=><StatusBadge>{m.status}</StatusBadge>},
        {key:'scheduled',label:'Reja',value:m=>m.scheduled,render:m=><span className="cell-main"><span className={m.status==='Rejada'&&m.scheduled.slice(0,10)<todayISO()?'negative':undefined}>{m.scheduled}</span>{m.plannedHours?<small>{m.plannedHours} soat</small>:null}</span>},
        {key:'tech',label:'Texnik',value:m=>employeeName(s,m.technicianId),priority:'low'},
        {key:'cost',label:'Xarajat',align:'right',value:m=>m.cost,render:m=>m.cost?money(m.cost):'—'},
      ]}/>
    {order&&<MaintenanceDrawer key={order.id} order={order} onClose={()=>setId(null)}/>}
    {create&&<MaintenanceOrderModal onClose={()=>setCreate(false)} onSaved={v=>setId(v)}/>}
  </div>
}

const DUE_ORDER:Record<DueState,number>={overdue:0,due:1,soon:2,ok:3,'no-data':4,'no-plan':5}

function Preventive(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState('schedule'),[edit,setEdit]=useState<EquipmentType|null>(null)
  const today=todayISO()
  const rows=s.equipment.map(e=>({e,due:maintenanceDue(e,today)})).sort((a,b)=>DUE_ORDER[a.due.state]-DUE_ORDER[b.due.state]||(a.due.dueDate||'9').localeCompare(b.due.dueDate||'9'))
  const planned=s.maintenanceOrders.filter(m=>m.type==='Preventive'&&['Rejada','Jarayonda'].includes(m.status))
  const calendar=maintenanceCalendar(s,today,28)
  const weeks=Array.from({length:4},(_,w)=>Array.from({length:7},(_,d)=>addDays(today,w*7+d)))
  return <div className="page-stack">
    <PageHeader title="Preventive Maintenance" subtitle="Kun / hafta / oy yoki ish soati bo‘yicha reja · 14 kun ichida muddati keladiganlar uchun PM"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('equipment','edit')} onClick={()=>app.planPreventiveMaintenance(14)}><Icon name="calendar"/>PM rejasini yaratish</button>}/>
    <Tabs items={[{value:'schedule',label:'Servis jadvali',count:rows.filter(r=>['overdue','due','soon'].includes(r.due.state)).length},{value:'calendar',label:'Kalendar (28 kun)',count:calendar.length},{value:'orders',label:'Rejadagi PM',count:planned.length}]} active={tab} onChange={setTab}/>
    {tab==='schedule'&&<Card className="flush"><div className="table-scroll"><table className="fit"><thead><tr><th>Uskuna</th><th>Reja</th><th>Oxirgi servis</th><th>Keyingi</th><th>Holat</th><th>PM</th>{app.can('equipment','edit')&&<th className="action-col"><span className="sr-only">Amal</span></th>}</tr></thead><tbody>
      {rows.map(({e,due})=>{const pm=planned.find(m=>m.equipmentId===e.id);return <tr key={e.id} className={due.state==='overdue'?'row-danger':due.state==='soon'||due.state==='due'?'row-warning':undefined}>
        <td><div className="cell-main"><b>{e.name}</b><small>{workCenterName(s,e.workCenterId)}</small></div></td>
        <td>{planLabel(due.plan)}</td>
        <td>{e.lastMaintenance||<span className="muted">—</span>}</td>
        <td>{due.dueDate||(due.plan?.unit==='runtime'&&due.leftHours!==undefined?`${due.leftHours} soat qoldi`:<span className="muted">—</span>)}</td>
        <td><span className="cell-main"><StatusBadge tone={DUE_TONE[due.state]}>{DUE_LABEL[due.state]}</StatusBadge><small>{due.reason}</small></span></td>
        <td>{pm?<button type="button" className="link-btn" onClick={()=>navigate(`/equipment?view=maintenance&id=${pm.id}`)}>{pm.code}</button>:<span className="muted">—</span>}</td>
        {app.can('equipment','edit')&&<td className="action-col"><button type="button" className="icon-ghost" aria-label={`${e.name} — reja`} onClick={()=>setEdit(e)}><Icon name="edit" size={15}/></button></td>}
      </tr>})}
    </tbody></table></div><p className="table-note">Ish soati rejasi hisoblagich ko‘rsatkichi bo‘lmasa “Ma’lumot yo‘q” — muddat taxmin qilinmaydi.</p></Card>}
    {tab==='calendar'&&<Card title="Servis kalendari" subtitle="Rejadagi buyurtmalar va muddati keladigan preventive servislar">
      <div className="table-scroll"><table className="fit maintenance-calendar"><thead><tr>{weeks[0].map(d=><th key={d}>{weekdayShort(d)}</th>)}</tr></thead><tbody>
        {weeks.map(week=><tr key={week[0]}>{week.map(d=>{const items=calendar.filter(c=>c.date===d);return <td key={d} className={d===today?'is-today':undefined}><div className="cell-main"><small>{d.slice(5)}</small>{items.map((c,i)=>c.kind==='order'
          ?<button type="button" key={i} className="chip" onClick={()=>navigate(`/equipment?view=maintenance&id=${c.orderId}`)} title={`${c.type} · ${c.status}`}>{c.code} · {equipmentName(s,c.equipmentId)}</button>
          :<span key={i} className={`chip ${c.state==='overdue'?'chip-danger':''}`} title="Preventive muddati — buyurtma hali yo‘q">PM · {equipmentName(s,c.equipmentId)}</span>)}</div></td>})}</tr>)}
      </tbody></table></div>
    </Card>}
    {tab==='orders'&&<Card>{planned.length?<div className="stack-list">{planned.map(m=><button type="button" className="list-row is-clickable" key={m.id} onClick={()=>navigate(`/equipment?view=maintenance&id=${m.id}`)}><span className="list-row-copy"><b>{m.code} · {equipmentName(s,m.equipmentId)}</b><small>{m.scheduled}{m.plannedHours?` · ${m.plannedHours} soat`:''} · {employeeName(s,m.technicianId)}</small></span><StatusBadge>{m.status}</StatusBadge></button>)}</div>:<Empty compact title="Rejadagi PM yo‘q"/>}</Card>}
    {edit&&<EquipmentModal equipment={edit} onClose={()=>setEdit(null)}/>}
  </div>
}

function Downtime(){
  const app=useApp(),s=app.state,now=useNow(30000),navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[reason,setReason]=useSearchParamState('reason'),[range,setRange]=useSearchParamState('range','30')
  const [start,setStart]=useState(false)
  const days=range==='all'?0:Number(range)||30,periodLabel=RANGES.find(r=>r.value===range)?.label||`${days} kun`
  const {reasons,minutes:total,events,open}=downtimeSummary(s,days)
  // MTBF / MTTR come from recorded failures; machines without enough of them are not averaged in as 0.
  const rel=s.equipment.map(e=>reliabilityOf(s,e.id))
  const withMtbf=rel.filter(r=>r.mtbfHours!==null).map(r=>r.mtbfHours!),withMttr=rel.filter(r=>r.mttrHours!==null).map(r=>r.mttrHours!)
  const rows=downtimeInPeriod(s,days).filter(d=>!reason||d.reason===reason).map(d=>({...d,live:d.end?d.minutes:minutesBetween(d.start,stamp(now))}))
  return <div className="page-stack">
    <PageHeader title="Downtime" subtitle="Sabab va davomiylik · OEE availability’ga ta’sir qiladi" actions={<button type="button" className="danger-glass-btn" disabled={!app.can('equipment','edit')&&!app.can('production','edit')} onClick={()=>setStart(true)}><Icon name="stop"/>Downtime boshlash</button>}/>
    <div className="kpi-grid">
      <KPI label="Ochiq to‘xtashlar" value={open.length} sub={open.map(d=>equipmentName(s,d.equipmentId)).join(', ')||undefined} tone="pink" icon={<Icon name="warning"/>} onClick={()=>navigate('/equipment?view=equipment&status=To‘xtagan')}/>
      <KPI label={`Downtime · ${periodLabel}`} value={formatMinutes(total)} sub={`${events} hodisa`} tone="orange" icon={<Icon name="clock"/>} onClick={()=>navigate(`/reports?view=oee&days=${days||90}`)}/>
      <KPI label="O‘rtacha MTBF" value={withMtbf.length?`${Math.round(withMtbf.reduce((a,b)=>a+b,0)/withMtbf.length*10)/10} soat`:'—'} sub={withMtbf.length?`${withMtbf.length} uskuna`:'Kamida 2 ta nosozlik kerak'} icon={<Icon name="activity"/>}/>
      <KPI label="O‘rtacha MTTR" value={withMttr.length?`${(withMttr.reduce((a,b)=>a+b,0)/withMttr.length).toFixed(1)} soat`:'—'} sub={withMttr.length?`${withMttr.length} uskuna`:'Yopilgan nosozlik yo‘q'} tone="purple" icon={<Icon name="wrench"/>}/>
    </div>
    {open.length>0&&<div className="stack-list">{open.map(d=><div className="inline-note danger" key={d.id}><Icon name="warning"/><span><b>{equipmentName(s,d.equipmentId)}</b> — {d.reason} · {formatMinutes(minutesBetween(d.start,stamp(now)))}{d.note?` · ${d.note}`:''}</span><button type="button" className="secondary-glass-btn compact" onClick={()=>app.endDowntime(d.id)}>Yopish</button></div>)}</div>}
    <div className="split-main">
      <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Uskuna, sabab, izoh..." exportName="downtime-events" resetKey={`${reason}|${range}`}
        filters={<><FilterSelect label="Davr" value={range} onChange={setRange} defaultValue="30" options={RANGES}/><FilterSelect label="Sabab" value={reason} onChange={setReason} options={REASONS}/></>} filtersActive={Boolean(reason)||range!=='30'} onResetFilters={()=>{setReason('');setRange('30')}}
        columns={[{key:'start',label:'Boshlanish',value:d=>d.start},{key:'equipment',label:'Uskuna',value:d=>equipmentName(s,d.equipmentId)},{key:'reason',label:'Sabab',value:d=>d.reason,render:d=><StatusBadge tone={d.end?'neutral':'danger'}>{d.reason}</StatusBadge>},{key:'minutes',label:'Davomiylik',align:'right',value:d=>d.live,render:d=>d.end?formatMinutes(d.minutes):<b className="negative">{formatMinutes(d.live)}</b>},{key:'note',label:'Izoh',value:d=>d.note||'',priority:'low'}]}/>
      <Card title={`Sabablar · ${periodLabel}`} subtitle="Pareto">{reasons.length?<BarList rows={reasons.map(r=>({label:r.reason,sub:`${r.share}%`,value:r.minutes,tone:'warning'}))} valueFormat={v=>formatMinutes(v)}/>:<Empty compact title="Downtime yo‘q"/>}</Card>
    </div>
    {start&&<DowntimeModal onClose={()=>setStart(false)}/>}
  </div>
}

function RequestModal({equipmentId,onClose}:{equipmentId?:string;onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({equipmentId:equipmentId||s.equipment[0]?.id||'',type:'Corrective',priority:'Normal',scheduled:addDays(todayISO(),1),reason:''},v=>({reason:required(v.reason,'Sabab')}))
  return <Modal open onClose={onClose} title="Maintenance so‘rovi" size="md" subtitle="Tasdiqlanganda buyurtma rejalashtiriladi"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.createEntity('maintenanceRequests',{code:`MR-${Date.now().toString().slice(-6)}`,equipmentId:v.equipmentId,type:v.type,priority:v.type==='Emergency'?'Kritik':v.priority,status:'Yangi',requestedBy:app.currentEmployee.id,scheduled:`${v.scheduled} 09:00`,reason:v.reason.trim(),downtimeHours:0});if(r.ok)onClose();return r.ok})}>Yuborish</button></>}>
    <div className="form-grid">
      <Field label="Uskuna"><Select value={form.values.equipmentId} onChange={v=>form.set('equipmentId',v)}>{s.equipment.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Tur"><Select value={form.values.type} onChange={v=>form.set('type',v)}>{['Preventive','Corrective','Emergency'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Priority"><Select value={form.values.priority} onChange={v=>form.set('priority',v)}>{['Normal','Yuqori','Kritik'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Rejalashtirilgan sana"><Input type="date" {...form.input('scheduled')}/></Field>
      <Field className="span-2" label="Muammo / sabab" required error={form.error('reason')}><Textarea {...form.input('reason')}/></Field>
    </div>
  </Modal>
}

function Requests(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status')
  const [create,setCreate]=useState(false)
  const rows=s.maintenanceRequests.filter(r=>!status||r.status===status)
  return <div className="page-stack">
    <PageHeader title="Maintenance so‘rovlari" subtitle="So‘rov → tasdiqlash → buyurtma" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('equipment','create')&&!app.can('production','edit')} onClick={()=>setCreate(true)}><Icon name="plus"/>So‘rov</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Kod, uskuna, sabab..." exportName="maintenance-requests"
      filters={<FilterSelect label="Status" value={status} onChange={setStatus} options={['Yangi','Tasdiqlangan','Jarayonda','Yakunlangan']}/>} filtersActive={Boolean(status)} onResetFilters={()=>setStatus('')}
      columns={[
        {key:'code',label:'So‘rov',value:r=>r.code,render:r=><div className="cell-main"><b>{r.code}</b><small className="wrap">{r.reason}</small></div>},
        {key:'equipment',label:'Uskuna',value:r=>equipmentName(s,r.equipmentId)},
        {key:'type',label:'Tur',value:r=>r.type},
        {key:'priority',label:'Priority',value:r=>r.priority,render:r=><StatusBadge>{r.priority}</StatusBadge>},
        {key:'status',label:'Status',value:r=>r.status,render:r=><StatusBadge>{r.status}</StatusBadge>},
        {key:'by',label:'So‘ragan',value:r=>employeeName(s,r.requestedBy),priority:'low'},
        {key:'action',label:'',sortable:false,searchable:false,render:r=>r.status==='Yangi'?<button type="button" className="soft-glass-btn compact" disabled={!app.can('equipment','approve')} title={app.can('equipment','approve')?undefined:'Tasdiqlash uchun equipment.approve ruxsati kerak'} onClick={()=>app.approveMaintenanceRequest(r.id)}>Tasdiqlash</button>:<span className="soft-meta">{s.maintenanceOrders.find(m=>m.requestId===r.id)?.code||''}</span>},
      ]}/>
    {create&&<RequestModal onClose={()=>setCreate(false)}/>}
  </div>
}

function Repairs(){
  const app=useApp(),s=app.state
  const [create,setCreate]=useState(false)
  const next:Record<string,string>={'Yangi':'Diagnostikaga','Diagnostika':'Ta’mirni boshlash','Ta’mirda':'Sinovga','Sinov':'Yakunlash'}
  return <div className="page-stack">
    <PageHeader title="Repair Orders" subtitle="Diagnostika → ta’mir → sinov" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('equipment','create')} onClick={()=>setCreate(true)}><Icon name="plus"/>Repair order</button>}/>
    {s.repairOrders.length?<div className="card flush"><div className="table-scroll"><table><thead><tr><th>Buyurtma</th><th>Uskuna</th><th>Nosozlik</th><th>Status</th><th>Texnik</th><th className="align-right">Ehtiyot qism</th><th className="align-right">Ish</th><th className="align-right">Keyingi qadam</th></tr></thead><tbody>
      {s.repairOrders.map(r=><tr key={r.id}>
        <td><div className="cell-main"><b>{r.code}</b><small>{r.createdAt}</small></div></td>
        <td>{equipmentName(s,r.equipmentId)}</td>
        <td className="wrap"><span className="clamp-2">{r.issue}</span></td>
        <td><StatusBadge>{r.status}</StatusBadge></td>
        <td>{employeeName(s,r.technicianId)}</td>
        <td className="align-right">{money(r.partsCost)}</td>
        <td className="align-right">{r.laborHours} soat</td>
        <td className="align-right">{next[r.status]?<button type="button" className="soft-glass-btn compact" disabled={!app.can('equipment','edit')} onClick={()=>app.advanceRepair(r.id)}>{next[r.status]}</button>:<StatusBadge tone="success">Yopilgan</StatusBadge>}</td>
      </tr>)}
    </tbody></table></div></div>:<Card><Empty title="Repair order yo‘q"/></Card>}
    {create&&<RepairModal onClose={()=>setCreate(false)}/>}
  </div>
}

function RepairModal({onClose}:{onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({equipmentId:s.equipment[0]?.id||'',issue:'',technicianId:s.employees.find(e=>e.department==='Maintenance')?.id||app.currentEmployee.id},v=>({issue:required(v.issue,'Muammo')}))
  return <Modal open onClose={onClose} title="Repair order" size="md" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.createEntity('repairOrders',{code:`REP-${Date.now().toString().slice(-6)}`,equipmentId:v.equipmentId,status:'Yangi',issue:v.issue.trim(),technicianId:v.technicianId,partsCost:0,laborHours:0,createdAt:stamp()});if(r.ok)onClose();return r.ok})}>Yaratish</button></>}>
    <div className="form-grid">
      <Field label="Uskuna"><Select value={form.values.equipmentId} onChange={v=>form.set('equipmentId',v)}>{s.equipment.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Texnik"><Select value={form.values.technicianId} onChange={v=>form.set('technicianId',v)}>{s.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field className="span-2" label="Nosozlik" required error={form.error('issue')}><Textarea {...form.input('issue')} autoFocus/></Field>
    </div>
  </Modal>
}
