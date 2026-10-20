import {useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,ResourceTable,SectionTitle,Select,StatusBadge,Tabs,Textarea,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {DowntimeReason,Equipment as EquipmentType,MaintenanceOrder,WorkCenter} from '../../../types'
import {calculateCapacityLoads,downtimeInPeriod,downtimeSummary,equipmentActivity,isOpenOrder,workCenterOee} from '../../../domain/manufacturingEngine'
import {addDays,formatMinutes,minutesBetween,stamp,todayISO} from '../../../utils/dates'
import {compactMoney,money} from '../../../utils/format'
import {employeeName,equipmentName,lineName,productName,useNow,workCenterName} from '../../common/lookups'
import {ActivityPanel,AttachmentsPanel} from '../../common/RecordPanels'
import {BarList} from '../../common/charts'

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
        {key:'type',label:'Maintenance',value:e=>nextOrder(e)?.type||'Preventive',render:e=>{const m=nextOrder(e);return m?<StatusBadge tone={m.type==='Emergency'?'danger':m.type==='Corrective'?'warning':'info'}>{m.type}</StatusBadge>:<span className="muted">PM · {e.maintenanceIntervalDays} kun</span>}},
        {key:'next',label:'Muddat',value:e=>nextOrder(e)?.scheduled||e.nextMaintenance,render:e=>{const due=(nextOrder(e)?.scheduled||e.nextMaintenance).slice(0,10);return <span className={due<=soon?'negative':undefined}>{due}</span>}},
        {key:'down',label:'Downtime (30k)',align:'right',value:e=>downMinutes(e),render:e=>{const m=downMinutes(e);return m?<span className={m>240?'negative':undefined}>{formatMinutes(m)}</span>:<span className="muted">—</span>}},
        {key:'mtbf',label:'MTBF',align:'right',value:e=>e.mtbf,render:e=>e.mtbf?`${e.mtbf} soat`:<span className="muted">—</span>},
        {key:'mttr',label:'MTTR',align:'right',value:e=>e.mttr,render:e=>e.mttr?`${e.mttr} soat`:<span className="muted">—</span>},
        {key:'oee',label:'OEE (7k)',align:'right',value:e=>workCenterOee(s,e.workCenterId).oee,render:e=>{const o=workCenterOee(s,e.workCenterId);return o.plannedMinutes?<b>{o.oee}%</b>:<span className="muted">—</span>},priority:'low'},
      ]}/>
    {edit&&<EquipmentModal equipment={edit==='new'?undefined:edit} onClose={()=>setEdit(null)}/>}
    {machine&&<MachineDrawer key={machine.id} machine={machine} onClose={()=>setId(null)} onEdit={()=>setEdit(machine)}/>}
  </div>
}

function EquipmentModal({equipment,onClose}:{equipment?:EquipmentType;onClose:()=>void}){
  const app=useApp(),s=app.state
  const form=useForm({name:equipment?.name||'',model:equipment?.model||'',serial:equipment?.serial||'',workCenterId:equipment?.workCenterId||s.workCenters[0]?.id||'',maintenanceIntervalDays:String(equipment?.maintenanceIntervalDays??30),nextMaintenance:equipment?.nextMaintenance||addDays(todayISO(),30)},v=>({name:required(v.name,'Nomi'),serial:required(v.serial,'Serial')||(s.equipment.some(e=>e.id!==equipment?.id&&e.serial.toLowerCase()===v.serial.trim().toLowerCase())?'Serial band':undefined),maintenanceIntervalDays:Number(v.maintenanceIntervalDays)>0?undefined:'Interval > 0'}))
  return <Modal open onClose={onClose} title={equipment?'Uskunani tahrirlash':'Yangi uskuna'} size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const payload={...v,name:v.name.trim(),serial:v.serial.trim(),maintenanceIntervalDays:Number(v.maintenanceIntervalDays)};const r=equipment?app.updateEntity('equipment',equipment.id,payload):app.createEntity('equipment',{...payload,status:'Ishlamoqda',lastMaintenance:todayISO(),mtbf:0,mttr:0,downtime:0,maintenanceCost:0});if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <div className="form-grid">
      <Field className="span-2" label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Model"><Input {...form.input('model')}/></Field>
      <Field label="Serial" required error={form.error('serial')}><Input {...form.input('serial')}/></Field>
      <Field label="Work center"><Select value={form.values.workCenterId} onChange={v=>form.set('workCenterId',v)}>{s.workCenters.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      <Field label="PM interval (kun)" error={form.error('maintenanceIntervalDays')}><Input type="number" min="1" {...form.input('maintenanceIntervalDays')}/></Field>
      <Field label="Keyingi servis"><Input type="date" {...form.input('nextMaintenance')}/></Field>
    </div>
  </Modal>
}

function MachineDrawer({machine,onClose,onEdit}:{machine:EquipmentType;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,now=useNow(30000),navigate=useNavigate()
  const [tab,setTab]=useState('overview'),[stop,setStop]=useState(false),[request,setRequest]=useState(false)
  const open=s.downtimeEvents.find(d=>d.equipmentId===machine.id&&!d.end)
  const events=s.downtimeEvents.filter(d=>d.equipmentId===machine.id)
  const maint=s.maintenanceOrders.filter(m=>m.equipmentId===machine.id)
  const oee=workCenterOee(s,machine.workCenterId)
  const orders=s.productionOrders.filter(o=>isOpenOrder(o)&&o.workOrders.some(w=>w.workCenterId===machine.workCenterId&&w.status!=='Yakunlangan'))
  const canEdit=app.can('equipment','edit')||app.can('production','edit')
  return <Drawer open onClose={onClose} title={machine.name} eyebrow="Uskuna" icon="wrench" size="lg" subtitle={`${machine.model} · ${machine.serial} · ${workCenterName(s,machine.workCenterId)}`} headerExtra={<StatusBadge>{machine.status}</StatusBadge>}
    actions={<>{app.can('equipment','create')||app.can('production','edit')?<button type="button" className="secondary-glass-btn" onClick={()=>setRequest(true)}><Icon name="wrench" size={15}/>Maintenance so‘rovi</button>:null}<span className="spacer"/>
      {canEdit&&(open?<button type="button" className="primary-glass-btn" onClick={()=>app.endDowntime(open.id)}><Icon name="play" size={16}/>Downtime’ni yopish</button>:<button type="button" className="danger-glass-btn" onClick={()=>setStop(true)}><Icon name="stop" size={16}/>To‘xtatish</button>)}
      {app.can('equipment','edit')&&<button type="button" className="secondary-glass-btn" onClick={onEdit}><Icon name="edit" size={15}/>Tahrirlash</button>}</>}>
    {open&&<div className="inline-note danger"><Icon name="warning"/>To‘xtagan: {open.reason} · {open.start} ({formatMinutes(minutesBetween(open.start,stamp(now)))}){open.note?` · ${open.note}`:''}</div>}
    <Tabs items={[{value:'overview',label:'Umumiy'},{value:'downtime',label:'Downtime',count:events.length},{value:'maintenance',label:'Maintenance',count:maint.length},{value:'docs',label:'Hujjatlar'},{value:'history',label:'Tarix'}]} active={tab} onChange={setTab}/>
    {tab==='overview'&&<>
      <InfoGrid items={[{label:'OEE (7 kun)',value:oee.plannedMinutes?`${oee.oee}%`:'—'},{label:'Availability',value:oee.plannedMinutes?`${oee.availability}%`:'—'},{label:'Performance',value:oee.plannedMinutes?`${oee.performance}%`:'—'},{label:'Quality',value:oee.plannedMinutes?`${oee.quality}%`:'—'},{label:'MTBF',value:machine.mtbf?`${machine.mtbf} soat`:'—'},{label:'MTTR',value:machine.mttr?`${machine.mttr} soat`:'—'},{label:'Oxirgi servis',value:machine.lastMaintenance||'—'},{label:'Keyingi servis',value:machine.nextMaintenance,tone:machine.nextMaintenance<=addDays(todayISO(),3)?'warning':undefined},{label:'Maintenance xarajati',value:money(machine.maintenanceCost)}]}/>
      <SectionTitle title="Navbatdagi MOlar"/>
      {orders.length?<div className="stack-list">{orders.map(o=><button type="button" className="list-row is-clickable" key={o.id} onClick={()=>navigate(`/production?view=orders&id=${o.id}`)}><span className="list-row-copy"><b>{o.code} · {productName(s,o.productId)}</b><small>due {o.due}</small></span><StatusBadge>{o.status}</StatusBadge></button>)}</div>:<Empty compact title="Ochiq operatsiya yo‘q"/>}
    </>}
    {tab==='downtime'&&(events.length?<div className="table-scroll"><table className="fit"><thead><tr><th>Boshlanish</th><th>Sabab</th><th className="align-right">Davomiylik</th><th>Izoh</th></tr></thead><tbody>{events.map(d=><tr key={d.id}><td>{d.start}</td><td><StatusBadge tone={d.end?'neutral':'danger'}>{d.reason}</StatusBadge></td><td className="align-right">{d.end?formatMinutes(d.minutes):'davom etmoqda'}</td><td className="wrap">{d.note||'—'}</td></tr>)}</tbody></table></div>:<Empty compact title="Downtime qayd etilmagan"/>)}
    {tab==='maintenance'&&(maint.length?<div className="stack-list">{maint.map(m=><div className="list-row" key={m.id}><span className="list-row-copy"><b>{m.code} · {m.type}</b><small>{m.scheduled} · {m.note}</small></span><span className="list-row-meta">{m.cost>0&&<span className="num">{money(m.cost)}</span>}<StatusBadge>{m.status}</StatusBadge></span></div>)}</div>:<Empty compact title="Maintenance yo‘q"/>)}
    {tab==='docs'&&<AttachmentsPanel entityType="equipment" entityId={machine.id} canEdit={app.can('equipment','edit')}/>}
    {tab==='history'&&<ActivityPanel sources={[machine.name]}/>}
    {stop&&<DowntimeModal equipmentId={machine.id} onClose={()=>setStop(false)}/>}
    {request&&<RequestModal equipmentId={machine.id} onClose={()=>setRequest(false)}/>}
  </Drawer>
}

function WorkCenters(){
  const app=useApp(),s=app.state
  const loads=calculateCapacityLoads(s,7)
  const [edit,setEdit]=useState<WorkCenter|null>(null)
  const canEdit=app.can('equipment','edit')
  return <div className="page-stack">
    <PageHeader title="Work Centers" subtitle="7 kunlik yuklama, OEE, samaradorlik va stavka"/>
    <div className="card flush"><div className="table-scroll"><table className="wc-table"><thead><tr><th>Work center</th><th>Holat</th><th>7 kun yuklama</th><th className="align-right">Ochiq ish</th><th className="align-right">OEE (7k)</th><th className="align-right">Samaradorlik</th>{app.can('costs')&&<th className="align-right">Stavka / soat</th>}<th>Uskunalar</th>{canEdit&&<th className="action-col"><span className="sr-only">Amal</span></th>}</tr></thead><tbody>
      {s.workCenters.map(w=>{const l=loads.find(x=>x.workCenter.id===w.id)!,o=workCenterOee(s,w.id);return <tr key={w.id} className={l.down?'row-danger':l.overloaded?'row-warning':undefined}>
        <td><div className="cell-main"><b>{w.name}</b><small>{w.code} · {lineName(s,w.lineId)}</small></div></td>
        <td><StatusBadge tone={l.down?'danger':l.overloaded?'warning':'success'}>{l.down?'To‘xtagan':l.overloaded?'Overload':'Normal'}</StatusBadge></td>
        <td><div className="wc-load"><div className="mini-days" aria-label={`${w.name}: kunlik yuklama`}>{l.days.map(d=><span key={d.date} className={d.utilization>100?'over':d.utilization>85?'high':d.load?'ok':''} title={`${d.date}: ${d.utilization}%`}><i style={{height:`${Math.min(100,d.utilization)}%`}}/></span>)}</div><b className={l.utilization>100?'negative':undefined}>{l.utilization}%</b></div></td>
        <td className="align-right">{formatMinutes(l.loadMinutes)}</td>
        <td className="align-right">{o.plannedMinutes?<b>{o.oee}%</b>:<span className="muted">—</span>}</td>
        <td className="align-right">{w.efficiency}%</td>
        {app.can('costs')&&<td className="align-right">{compactMoney(w.costPerHour)}</td>}
        <td className="wrap">{s.equipment.filter(e=>e.workCenterId===w.id).map(e=>e.name).join(', ')||'—'}</td>
        {canEdit&&<td className="action-col"><button type="button" className="icon-ghost" aria-label={`${w.name} — tahrirlash`} onClick={()=>setEdit(w)}><Icon name="edit" size={15}/></button></td>}
      </tr>})}
    </tbody></table></div><p className="table-note">Yuklama = qolgan setup + run vaqti ÷ (smena × samaradorlik) · ustunlar = 7 kun</p></div>
    {edit&&<WorkCenterModal wc={edit} onClose={()=>setEdit(null)}/>}
  </div>
}

function WorkCenterModal({wc,onClose}:{wc:WorkCenter;onClose:()=>void}){
  const app=useApp()
  const form=useForm({name:wc.name,efficiency:String(wc.efficiency),costPerHour:String(wc.costPerHour)},v=>({name:required(v.name,'Nomi'),efficiency:Number(v.efficiency)>0&&Number(v.efficiency)<=120?undefined:'1–120%',costPerHour:Number(v.costPerHour)>=0?undefined:'Stavka noto‘g‘ri'}))
  return <Modal open onClose={onClose} title={`${wc.code} — tahrirlash`} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const r=app.updateEntity('workCenters',wc.id,{name:v.name.trim(),efficiency:Number(v.efficiency),costPerHour:Number(v.costPerHour)});if(r.ok)onClose();return r.ok})}>Saqlash</button></>}>
    <div className="form-stack"><Field label="Nomi" required error={form.error('name')}><Input {...form.input('name')}/></Field><Field label="Samaradorlik %" hint="Sig‘im = smena × samaradorlik" error={form.error('efficiency')}><Input type="number" {...form.input('efficiency')}/></Field><Field label="Soatlik stavka" hint="Machine cost uchun" error={form.error('costPerHour')}><MoneyInput min="0" {...form.money('costPerHour')}/></Field></div>
  </Modal>
}

function MaintenanceDrawer({order,onClose}:{order:MaintenanceOrder;onClose:()=>void}){
  const app=useApp(),s=app.state
  const [cost,setCost]=useState(String(order.cost||'')),[cancel,setCancel]=useState(false)
  const canEdit=app.can('equipment','edit')
  return <Drawer open onClose={onClose} title={order.code} eyebrow={`${order.type} maintenance`} icon="wrench" size="md" subtitle={`${equipmentName(s,order.equipmentId)} · ${order.scheduled}`} headerExtra={<StatusBadge>{order.status}</StatusBadge>}
    actions={canEdit?<>{order.status==='Rejada'&&<button type="button" className="ghost-btn" onClick={()=>setCancel(true)}>Bekor qilish</button>}<span className="spacer"/>{order.status==='Rejada'&&<button type="button" className="secondary-glass-btn" onClick={()=>app.startMaintenance(order.id)}><Icon name="play" size={15}/>Boshlash</button>}{order.status==='Jarayonda'&&<button type="button" className="primary-glass-btn" disabled={cost===''||Number(cost)<0} onClick={()=>app.completeMaintenance(order.id,Number(cost))}><Icon name="check" size={16}/>Yakunlash</button>}</>:undefined}>
    <InfoGrid items={[{label:'Uskuna',value:equipmentName(s,order.equipmentId)},{label:'Texnik',value:employeeName(s,order.technicianId)},{label:'Reja',value:order.scheduled},{label:'Boshlangan',value:order.startedAt},{label:'Yakunlangan',value:order.completed},{label:'Xarajat',value:order.cost?money(order.cost):'—'}]}/>
    <div className="inline-note"><Icon name="info"/>{order.note}</div>
    {order.status==='Jarayonda'&&canEdit&&<Field label="Yakuniy xarajat" hint="Ehtiyot qism + ish haqi"><MoneyInput min="0" value={cost} onValue={setCost}/></Field>}
    {order.status==='Rejada'&&<p className="soft-meta">Avval maintenance’ni boshlang. Boshlash downtime ochadi; yakunlash faqat jarayon boshlanganidan keyin mavjud bo‘ladi.</p>}
    <ActivityPanel sources={[order.code]}/>
    <Confirm open={cancel} onClose={()=>setCancel(false)} onConfirm={()=>app.cancelMaintenance(order.id)} danger title="Maintenance bekor qilinsinmi?" confirmText="Bekor qilish"/>
  </Drawer>
}

function Maintenance(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[status,setStatus]=useSearchParamState('status'),[type,setType]=useSearchParamState('type')
  const [id,setId]=useRecordParam()
  const rows=s.maintenanceOrders.filter(m=>(!status||m.status===status)&&(!type||m.type===type))
  const order=s.maintenanceOrders.find(m=>m.id===id)
  return <div className="page-stack">
    <PageHeader title="Maintenance" subtitle="Reja → boshlash → yakunlash"/>
    <div className="kpi-grid">
      <KPI label="Rejada" value={s.maintenanceOrders.filter(m=>m.status==='Rejada').length} icon={<Icon name="calendar"/>} onClick={()=>setStatus('Rejada')}/>
      <KPI label="Jarayonda" value={s.maintenanceOrders.filter(m=>m.status==='Jarayonda').length} tone="orange" icon={<Icon name="wrench"/>} onClick={()=>setStatus('Jarayonda')}/>
      <KPI label="Servis yaqin" value={s.equipment.filter(e=>e.status==='Servis yaqin').length} tone="pink" icon={<Icon name="warning"/>} onClick={()=>navigate('/equipment?view=equipment&status=Servis yaqin')}/>
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
        {key:'scheduled',label:'Reja',value:m=>m.scheduled},
        {key:'tech',label:'Texnik',value:m=>employeeName(s,m.technicianId),priority:'low'},
        {key:'cost',label:'Xarajat',align:'right',value:m=>m.cost,render:m=>m.cost?money(m.cost):'—'},
      ]}/>
    {order&&<MaintenanceDrawer key={order.id} order={order} onClose={()=>setId(null)}/>}
  </div>
}

function Preventive(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const upcoming=[...s.equipment].sort((a,b)=>a.nextMaintenance.localeCompare(b.nextMaintenance))
  const planned=s.maintenanceOrders.filter(m=>m.type==='Preventive'&&['Rejada','Jarayonda'].includes(m.status))
  return <div className="page-stack">
    <PageHeader title="Preventive Maintenance" subtitle="Interval bo‘yicha · 14 kun ichidagilar uchun PM"
      actions={<button type="button" className="primary-glass-btn" disabled={!app.can('equipment','create')} onClick={()=>app.planPreventiveMaintenance(14)}><Icon name="calendar"/>PM rejasini yaratish</button>}/>
    <div className="two-col">
      <Card title="Servis jadvali" subtitle="keyingi servis bo‘yicha">
        <div className="stack-list">{upcoming.map(e=>{const days=Math.round((new Date(e.nextMaintenance).getTime()-new Date(todayISO()).getTime())/864e5);const pm=planned.find(m=>m.equipmentId===e.id);return <div className="list-row" key={e.id}><span className="list-row-copy"><b>{e.name}</b><small>har {e.maintenanceIntervalDays} kunda · oxirgi {e.lastMaintenance}</small></span><span className="list-row-meta"><StatusBadge tone={days<0?'danger':days<=3?'warning':'success'}>{days<0?`${-days} kun kechikdi`:days===0?'Bugun':`${days} kun`}</StatusBadge>{pm?<span className="chip">{pm.code}</span>:null}</span></div>})}</div>
      </Card>
      <Card title="Rejadagi PM buyurtmalar">{planned.length?<div className="stack-list">{planned.map(m=><button type="button" className="list-row is-clickable" key={m.id} onClick={()=>navigate(`/equipment?view=maintenance&id=${m.id}`)}><span className="list-row-copy"><b>{m.code} · {equipmentName(s,m.equipmentId)}</b><small>{m.scheduled}</small></span><StatusBadge>{m.status}</StatusBadge></button>)}</div>:<Empty compact title="Rejadagi PM yo‘q"/>}</Card>
    </div>
  </div>
}

function Downtime(){
  const app=useApp(),s=app.state,now=useNow(30000),navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[reason,setReason]=useSearchParamState('reason'),[range,setRange]=useSearchParamState('range','30')
  const [start,setStart]=useState(false)
  const days=range==='all'?0:Number(range)||30,periodLabel=RANGES.find(r=>r.value===range)?.label||`${days} kun`
  const {reasons,minutes:total,events,open}=downtimeSummary(s,days)
  // MTBF / MTTR exist only once a machine has failure history; machines without it are not averaged in as 0.
  const withMtbf=s.equipment.filter(e=>e.mtbf>0),withMttr=s.equipment.filter(e=>e.mttr>0)
  const rows=downtimeInPeriod(s,days).filter(d=>!reason||d.reason===reason).map(d=>({...d,live:d.end?d.minutes:minutesBetween(d.start,stamp(now))}))
  return <div className="page-stack">
    <PageHeader title="Downtime" subtitle="Sabab va davomiylik · OEE availability’ga ta’sir qiladi" actions={<button type="button" className="danger-glass-btn" disabled={!app.can('equipment','edit')&&!app.can('production','edit')} onClick={()=>setStart(true)}><Icon name="stop"/>Downtime boshlash</button>}/>
    <div className="kpi-grid">
      <KPI label="Ochiq to‘xtashlar" value={open.length} sub={open.map(d=>equipmentName(s,d.equipmentId)).join(', ')||undefined} tone="pink" icon={<Icon name="warning"/>} onClick={()=>navigate('/equipment?view=equipment&status=To‘xtagan')}/>
      <KPI label={`Downtime · ${periodLabel}`} value={formatMinutes(total)} sub={`${events} hodisa`} tone="orange" icon={<Icon name="clock"/>} onClick={()=>navigate(`/reports?view=oee&days=${days||90}`)}/>
      <KPI label="O‘rtacha MTBF" value={withMtbf.length?`${Math.round(withMtbf.reduce((a,b)=>a+b.mtbf,0)/withMtbf.length)} soat`:'—'} icon={<Icon name="activity"/>}/>
      <KPI label="O‘rtacha MTTR" value={withMttr.length?`${(withMttr.reduce((a,b)=>a+b.mttr,0)/withMttr.length).toFixed(1)} soat`:'—'} tone="purple" icon={<Icon name="wrench"/>}/>
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
