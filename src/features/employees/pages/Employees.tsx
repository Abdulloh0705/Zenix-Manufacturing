import {useRef,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Confirm,Drawer,Empty,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,MoneyInput,PageHeader,Progress,ResourceTable,Select,StatusBadge,Tabs,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {Employee,ManufacturingState} from '../../../types'
import {referenceBlocker} from '../../../domain/actions'
import {PERMISSION_MODULES,assignRoleBlocker,employeeBranchIds,employeeRemovalBlocker,hasPermission,isSuperAdminRole,roleOf} from '../../../domain/access'
import {PermissionMatrix} from '../../admin/components/PermissionMatrix'
import {laborNow} from '../../../domain/manufacturingEngine'
import {EMPLOYEE_DEPARTMENTS,employeePayload,employeeWorkCenterOptions,reconcileWorkCenter,usesWorkCenter,validateEmployeeDraft,type EmployeeDraft} from '../../../domain/employeeForm'
import {addDays,formatMinutes,minutesBetween,periodStart,stamp,todayISO} from '../../../utils/dates'
import {compactMoney,initials,money,num} from '../../../utils/format'
import {orderCode,productName,useNow,workCenterCode,workCenterName} from '../../common/lookups'
import {ActivityPanel} from '../../common/RecordPanels'
import {CreateAccountForEmployee} from '../../admin/pages/Admin'
import {BarList} from '../../common/charts'

export default function Employees(){
  const [sp]=useSearchParams(),view=sp.get('view')||'all'
  if(view==='roles')return <Roles/>
  if(view==='time')return <Time/>
  if(view==='performance')return <Performance/>
  if(view==='activity')return <Activity/>
  return <All/>
}

/** Labour productivity from work-order time logs: standard minutes earned ÷ minutes logged. */
export function employeeStats(s:ManufacturingState,employeeId:string,days=7,now=new Date()){
  const since=addDays(todayISO(),-days)
  const logs=s.timeLogs.filter(t=>t.employeeId===employeeId&&t.start.slice(0,10)>=since)
  let logged=0,earned=0
  for(const t of logs){
    const minutes=t.end?t.minutes:minutesBetween(t.start,stamp(now))
    logged+=minutes
    const wo=s.productionOrders.find(o=>o.id===t.orderId)?.workOrders.find(w=>w.id===t.workOrderId)
    if(wo&&wo.actualMin>0&&wo.status==='Yakunlangan')earned+=wo.plannedMin*Math.min(1,minutes/wo.actualMin)
  }
  const cost=logged/60*(s.employees.find(e=>e.id===employeeId)?.hourlyCost||0)
  return {logs,logged,earned,efficiency:logged&&earned?Math.round(earned/logged*100):null,cost,orders:new Set(logs.map(l=>l.orderId)).size}
}

function All(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[dept,setDept]=useSearchParamState('dept'),[role,setRole]=useSearchParamState('role')
  const [id,setId]=useRecordParam()
  const [edit,setEdit]=useState<Employee|null|'new'>(null)
  const [activateId,setActivateId]=useState<string|null>(null)
  const rows=s.employees.filter(e=>(!dept||e.department===dept)&&(!role||e.roleId===role))
  const activate=s.employees.find(e=>e.id===activateId)
  const employee=s.employees.find(e=>e.id===id)
  return <div className="page-stack">
    <PageHeader title="Xodimlar" subtitle="Rol, bo‘lim, smena va ish vaqti" actions={<button type="button" className="primary-glass-btn" disabled={!app.can('employees','create')} onClick={()=>setEdit('new')}><Icon name="plus"/>Xodim qo‘shish</button>}/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Ism, bo‘lim, rol..." onRow={e=>setId(e.id)} exportName="employees" resetKey={`${dept}|${role}`}
      filtersActive={Boolean(dept||role)} onResetFilters={()=>{setDept('');setRole('')}}
      filters={<><FilterSelect label="Bo‘lim" value={dept} onChange={setDept} options={[...new Set(s.employees.map(e=>e.department))]}/><FilterSelect label="Rol" value={role} onChange={setRole} options={s.roles.filter(r=>!isSuperAdminRole(r)).map(r=>({value:r.id,label:r.name}))}/></>}
      columns={[
        {key:'name',label:'Xodim',value:e=>e.name,render:e=><div className="person-cell"><span className="avatar sm">{initials(e.name)}</span><div className="cell-main"><b>{e.name}</b><small>{e.department}</small></div></div>},
        {key:'role',label:'Rol',value:e=>s.roles.find(r=>r.id===e.roleId)?.name||''},
        {key:'branch',label:'Filial',value:e=>s.branches.find(b=>b.id===e.branchId)?.name||'',priority:'low'},
        {key:'login',label:'Login',value:e=>app.auth.accounts.find(a=>a.employeeId===e.id)?.username||'',render:e=>app.auth.accounts.find(a=>a.employeeId===e.id)?.username||'—'},
        {key:'account',label:'Akkaunt',value:e=>{const a=app.auth.accounts.find(a=>a.employeeId===e.id);return a?e.status==='Arxiv'?'Arxiv':a.status==='blocked'?'Bloklangan':a.mustChangePassword?'Parol almashtiriladi':'Faol':'Akkaunt yo‘q'},render:e=>{const a=app.auth.accounts.find(a=>a.employeeId===e.id);return <StatusBadge tone={!a||a.status==='blocked'||e.status==='Arxiv'?'warning':'success'}>{a?e.status==='Arxiv'?'Arxiv':a.status==='blocked'?'Bloklangan':a.mustChangePassword?'Parol almashtiriladi':'Faol':'Akkaunt yo‘q'}</StatusBadge>}},
        {key:'wc',label:'Work center',value:e=>workCenterCode(s,e.workCenterId),priority:'low'},
        {key:'shift',label:'Smena',value:e=>e.shift,priority:'low'},
        {key:'status',label:'Status',value:e=>e.status,render:e=><StatusBadge>{e.status}</StatusBadge>},
        {key:'hours',label:'7 kun (soat)',align:'right',value:e=>employeeStats(s,e.id).logged,render:e=>num(employeeStats(s,e.id).logged/60,1)},
        {key:'eff',label:'Samaradorlik',align:'right',value:e=>employeeStats(s,e.id).efficiency??-1,render:e=>{const v=employeeStats(s,e.id).efficiency;return v===null?<span className="muted">—</span>:`${v}%`}},
        // Wages are cost data: shown only to roles that may view costs (A-M1).
        ...(app.can('costs')?[{key:'rate',label:'Stavka',align:'right' as const,value:(e:Employee)=>e.hourlyCost,render:(e:Employee)=>compactMoney(e.hourlyCost),priority:'low' as const}]:[]),
      ]}/>
    {edit&&<EmployeeModal employee={edit==='new'?undefined:edit} onClose={()=>setEdit(null)} onCreated={id=>{setEdit(null);setActivateId(id)}}/>}
    {activate&&<CreateAccountForEmployee employee={activate} afterCreate onClose={()=>setActivateId(null)}/>}
    {employee&&<EmployeeDrawer key={employee.id} employee={employee} onClose={()=>setId(null)} onEdit={()=>setEdit(employee)}/>}
  </div>
}

function EmployeeModal({employee,onClose,onCreated}:{employee?:Employee;onClose:()=>void;onCreated:(id:string)=>void}){
  const app=useApp(),s=app.state
  // Only roles this user may hand out are offered; the employee's current role stays visible (A-C2).
  const assignable=s.roles.filter(r=>!isSuperAdminRole(r)&&!assignRoleBlocker(s,app.currentEmployee,employee,r.id))
  const actorScope=roleOf(s,app.currentEmployee.id)?.scope
  const permittedBranches=s.branches.filter(b=>b.status!=='Arxiv'&&(actorScope==='all'||employeeBranchIds(s,app.currentEmployee).includes(b.id)))
  const self=employee?.id===app.currentEmployee.id
  const roleLocked=self||!app.can('users','edit')||Boolean(employee&&assignable.length<=1)
  const initialBranch=employee?.branchId||s.workCenters.find(w=>w.id===employee?.workCenterId)?.branchId||s.warehouses.find(w=>w.id===employee?.warehouseId)?.branchId||permittedBranches.find(b=>b.id===s.settings.defaultBranchId)?.id||permittedBranches[0]?.id||''
  // A new employee starts without a work center: one is assigned only when the user picks it.
  const form=useForm<EmployeeDraft>({name:employee?.name||'',department:employee?.department||'Production',roleId:employee?.roleId||assignable.find(r=>r.key==='operator')?.id||assignable[0]?.id||'',branchId:initialBranch,branchIds:employee?.branchIds?.length?employee.branchIds:[initialBranch].filter(Boolean),workCenterId:employee?.workCenterId||'',warehouseId:employee?.warehouseId||'',shift:employee?.shift||'A',status:employee?.status||'Faol',hourlyCost:String(employee?.hourlyCost??40000),attendance:String(employee?.attendance??100)},v=>validateEmployeeDraft(s,v,employee))
  const [busy,setBusy]=useState<null|'add'|'login'>(null),[saveError,setSaveError]=useState(''),[wcNotice,setWcNotice]=useState('')
  const busyRef=useRef(false)
  const withLogin=!employee&&app.can('users','create')
  const scope=s.roles.find(r=>r.id===form.values.roleId)?.scope
  const wcApplies=usesWorkCenter(s,form.values)
  const wcOptions=employeeWorkCenterOptions(s,form.values,employee)
  const wcMissing=form.values.workCenterId&&!wcOptions.some(w=>w.id===form.values.workCenterId)?form.values.workCenterId:''
  /** Department, role or branch edits keep the chosen work center only while it is still offered — never pick another. */
  const change=(patch:Partial<EmployeeDraft>)=>{
    for(const [k,v] of Object.entries(patch))form.set(k as keyof EmployeeDraft,v as never)
    const r=reconcileWorkCenter(s,{...form.values,...patch},employee)
    if(r.cleared){form.set('workCenterId','');setWcNotice(`“${r.cleared}” olib tashlandi — tanlangan filial yoki bo‘limga mos emas`)}
  }
  /** "add" saves the profile only; "login" saves it and continues to the existing account step. One save at a time. */
  const save=(mode:'add'|'login')=>{
    if(busyRef.current)return
    form.submit(v=>{
      busyRef.current=true;setBusy(mode);setSaveError('')
      const payload=employeePayload(v)
      const r=employee?app.updateEntity('employees',employee.id,payload):app.createEntity('employees',{...payload,efficiency:0})
      // A refused save keeps the modal and everything typed; the reason is shown here as well as in the toast.
      if(!r.ok){busyRef.current=false;setBusy(null);setSaveError(r.message);return false}
      if(mode==='login'&&!employee&&r.id)onCreated(r.id);else onClose()
      return true
    })
  }
  const wcHint=wcNotice||(!wcApplies?'Bu bo‘lim uchun ish markazi talab qilinmaydi':!wcOptions.length?'Tanlangan filialda faol ish markazi yo‘q':scope==='workcenter'?'Bu rol uchun majburiy':'Ixtiyoriy — tanlanmasa xodim ish markaziga biriktirilmaydi')
  const primaryMode=withLogin?'login':'add'
  return <Modal open onClose={onClose} title={employee?'Xodimni tahrirlash':'Yangi xodim'} size="lg"
    footer={<>
      <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={onClose}>Bekor qilish</button>
      {withLogin&&<button type="button" className="secondary-glass-btn" disabled={Boolean(busy)} aria-busy={busy==='add'||undefined} onClick={()=>save('add')}>{busy==='add'?'Saqlanmoqda…':<><Icon name="plus" size={16}/>Qo‘shish</>}</button>}
      <button type="button" className="primary-glass-btn" disabled={Boolean(busy)} aria-busy={busy===primaryMode||undefined} onClick={()=>save(primaryMode)}>{busy===primaryMode?'Saqlanmoqda…':<><Icon name={withLogin?'key':'check'} size={16}/>{employee?'Saqlash':withLogin?'Saqlash va login yaratish':'Qo‘shish'}</>}</button>
    </>}>
    <div className="form-grid">
      <Field label="F.I.Sh" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Bo‘lim"><Select value={form.values.department} onChange={v=>change({department:v})}>{[...new Set([...EMPLOYEE_DEPARTMENTS,form.values.department])].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Rol (RBAC)" error={form.error('roleId')} hint={self?'O‘z rolingizni o‘zgartira olmaysiz':!app.can('users','edit')?'Rol berish uchun users.edit kerak':undefined}><Select value={form.values.roleId} disabled={roleLocked} onChange={v=>change({roleId:v})}>{assignable.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label="Asosiy filial" required error={form.error('branchId')}><Select value={form.values.branchId} onChange={v=>{form.set('warehouseId','');change({branchId:v,branchIds:[v,...form.values.branchIds.filter(id=>id!==form.values.branchId&&id!==v)].filter(Boolean)})}}><option value="">— Tanlang —</option>{permittedBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      {scope==='branch'&&permittedBranches.length>1&&<Field label="Qo‘shimcha filiallar" hint="Faqat aniq biriktirilgan filiallar ko‘rinadi"><div className="badge-row">{permittedBranches.filter(b=>b.id!==form.values.branchId).map(b=><label key={b.id}><input type="checkbox" checked={form.values.branchIds.includes(b.id)} onChange={e=>change({branchIds:e.target.checked?[...form.values.branchIds,b.id]:form.values.branchIds.filter(id=>id!==b.id)})}/>{b.name}</label>)}</div></Field>}
      <Field label="Work center" required={scope==='workcenter'} error={form.error('workCenterId')} hint={wcHint}><Select value={form.values.workCenterId} placeholder="Tanlanmagan" disabled={!wcApplies&&!form.values.workCenterId} onChange={v=>{form.set('workCenterId',v);form.touch('workCenterId');setWcNotice('')}}><option value="">Tanlanmagan</option>{wcOptions.map(w=><option key={w.id} value={w.id}>{w.name} · {w.code}</option>)}{wcMissing&&<option value={wcMissing}>{s.workCenters.find(w=>w.id===wcMissing)?.name||wcMissing} — mavjud emas</option>}</Select></Field>
      <Field label="Ish ombori" error={form.error('warehouseId')} hint="“Ombor” doirasidagi rol faqat shu omborda ishlaydi"><Select value={form.values.warehouseId} onChange={v=>form.set('warehouseId',v)}><option value="">— Tanlanmagan —</option>{s.warehouses.filter(w=>(w.status==='Faol'||w.id===form.values.warehouseId)&&form.values.branchIds.includes(w.branchId)).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      <Field label="Smena"><Select value={form.values.shift} onChange={v=>form.set('shift',v)}>{['A','B','C','Kunduzgi'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Status"><Select value={form.values.status} onChange={v=>form.set('status',v)}>{['Faol','Smenada','Ta’tilda','Arxiv'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
      {app.can('costs')&&<Field label="Soatbay stavka" error={form.error('hourlyCost')} hint="Labor cost uchun"><MoneyInput min="0" {...form.money('hourlyCost')}/></Field>}
      <Field label="Davomat % (HR)" error={form.error('attendance')}><Input type="number" min="0" max="100" {...form.input('attendance')}/></Field>
    </div>
    {withLogin&&<div className="inline-note"><Icon name="info"/><span>“Qo‘shish” faqat xodim profilini saqlaydi — login va parol yaratilmaydi. “Saqlash va login yaratish” profilni saqlab, kirish ma’lumotlarini so‘raydi.</span></div>}
    {saveError&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{saveError}</span></div>}
  </Modal>
}

function EmployeeDrawer({employee,onClose,onEdit}:{employee:Employee;onClose:()=>void;onEdit:()=>void}){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const [tab,setTab]=useState('overview'),[remove,setRemove]=useState(false)
  const stats=employeeStats(s,employee.id,30)
  const role=s.roles.find(r=>r.id===employee.roleId)
  const blocker=employeeRemovalBlocker(s,app.currentEmployee,employee.id)||referenceBlocker(s,'employees',employee.id)
  return <Drawer open onClose={onClose} title={employee.name} eyebrow="Xodim" icon="user" size="lg" subtitle={`${employee.department} · ${role?.name} · smena ${employee.shift}`} headerExtra={<StatusBadge>{employee.status}</StatusBadge>}
    actions={<>{app.can('users','delete')&&!isSuperAdminRole(role)&&<button type="button" className="ghost-btn" onClick={()=>setRemove(true)}><Icon name="trash" size={15}/>O‘chirish</button>}<span className="spacer"/>{app.can('employees','edit')&&!isSuperAdminRole(role)&&<button type="button" className="primary-glass-btn" onClick={onEdit}><Icon name="edit" size={16}/>Tahrirlash</button>}</>}>
    <Tabs items={[{value:'overview',label:'Umumiy'},{value:'time',label:'Ish vaqti',count:stats.logs.length},{value:'access',label:'Ruxsatlar'},{value:'history',label:'Faoliyat'}]} active={tab} onChange={setTab}/>
    {tab==='overview'&&<InfoGrid items={[{label:'30 kun ish vaqti',value:formatMinutes(stats.logged)},{label:'Samaradorlik',value:stats.efficiency===null?'—':`${stats.efficiency}%`},...(app.can('costs')?[{label:'Labor cost (30 kun)',value:money(stats.cost)}]:[]),{label:'Buyurtmalar',value:stats.orders},{label:'Work center',value:workCenterName(s,employee.workCenterId)},...(app.can('costs')?[{label:'Stavka',value:`${money(employee.hourlyCost)}/soat`}]:[]),{label:'Davomat (HR)',value:`${employee.attendance}%`}]}/>}
    {tab==='time'&&(stats.logs.length?<div className="stack-list">{stats.logs.map(t=>{const o=s.productionOrders.find(x=>x.id===t.orderId),w=o?.workOrders.find(x=>x.id===t.workOrderId);return <button type="button" className="list-row is-clickable" key={t.id} onClick={()=>navigate(`/production?view=orders&id=${t.orderId}`)}><span className="list-row-copy"><b>{o?.code} · {w?.name}</b><small>{t.start} → {t.end?t.end.slice(11):'davom etmoqda'} · {workCenterName(s,t.workCenterId)}</small></span><b className="num">{t.end?formatMinutes(t.minutes):'—'}</b></button>})}</div>:<Empty compact title="Ish vaqti qayd etilmagan"/>)}
    {tab==='access'&&<div className="badge-row">{PERMISSION_MODULES.map(m=>{const edit=hasPermission(role,m.key,'edit')||hasPermission(role,m.key,'execute'),viewOnly=hasPermission(role,m.key,'view');return <StatusBadge key={m.key} tone={edit?'success':viewOnly?'info':'neutral'}>{m.label}: {edit?'tahrir':viewOnly?'ko‘rish':'yo‘q'}</StatusBadge>})}</div>}
    {tab==='history'&&<ActivityPanel sources={[employee.name]}/>}
    <Confirm open={remove} onClose={()=>setRemove(false)} onConfirm={()=>{if(app.deleteEntity('employees',employee.id).ok)onClose()}} danger title="Xodim o‘chirilsinmi?" text={blocker?`O‘chirib bo‘lmaydi: ${blocker}. Status’ni “Arxiv” qiling.`:'Xodim yozuvi o‘chiriladi; ish vaqti tarixi hisobotlarda qoladi.'} confirmText="O‘chirish"/>
  </Drawer>
}

function Roles(){
  const app=useApp(),s=app.state
  const tenantRoles=s.roles.filter(r=>!isSuperAdminRole(r))
  const [roleId,setRoleId]=useSearchParamState('role',tenantRoles[0]?.id||'')
  const role=tenantRoles.find(r=>r.id===roleId)||tenantRoles[0]
  const canEdit=app.can('roles','edit')
  if(!role)return <Empty title="Rol yo‘q"/>
  return <div className="page-stack">
    <PageHeader title="Rollar va ruxsatlar" subtitle="O‘zgarish darhol sidebar, URL va amallarga qo‘llanadi"/>
    <div className="master-detail">
      <Card className="master-pane"><div className="master-list" role="listbox" aria-label="Rollar">{tenantRoles.map(r=><button type="button" role="option" aria-selected={r.id===role.id} key={r.id} className={r.id===role.id?'active':''} onClick={()=>setRoleId(r.id)}><span><b>{r.name}</b><small>{s.employees.filter(e=>e.roleId===r.id).length} xodim · {r.scope}</small></span></button>)}</div></Card>
      <Card className="detail-pane" title={role.name} subtitle={`Scope: ${role.scope} · ${s.employees.filter(e=>e.roleId===role.id).map(e=>e.name).join(', ')||'xodim yo‘q'}`}>
        {!canEdit&&<div className="inline-note warning"><Icon name="lock"/>Ruxsatlarni o‘zgartirish uchun roles.edit huquqi kerak.</div>}
        <PermissionMatrix role={role}/>
        <p className="soft-meta">“Ko‘rish” o‘chsa boshqa amallar ham o‘chadi · o‘z rolingizni va o‘zingizdan yuqori rollarni o‘zgartira olmaysiz</p>
      </Card>
    </div>
  </div>
}

function Time(){
  const s=useApp().state,now=useNow(30000),navigate=useNavigate()
  const [q,setQ]=useSearchParamState('q'),[employee,setEmployee]=useSearchParamState('employee'),[range,setRange]=useSearchParamState('range','7')
  const since=periodStart(Number(range)||7)
  const active=laborNow(s).operators.filter(id=>!employee||id===employee)
  const rows=s.timeLogs.filter(t=>(!employee||t.employeeId===employee)&&t.start.slice(0,10)>=since).map(t=>({...t,live:t.end?t.minutes:minutesBetween(t.start,stamp(now))}))
  const byEmployee=s.employees.map(e=>({e,minutes:rows.filter(r=>r.employeeId===e.id).reduce((a,r)=>a+r.live,0)})).filter(x=>x.minutes>0).sort((a,b)=>b.minutes-a.minutes)
  const total=rows.reduce((a,r)=>a+r.live,0)
  return <div className="page-stack">
    <PageHeader title="Ish vaqti" subtitle="Operatsiya start / pauza / tugatishdan avtomatik"/>
    <div className="kpi-grid cols-3">
      <KPI label="Jami qayd etilgan" value={formatMinutes(total)} sub={`${rows.length} yozuv`} icon={<Icon name="clock"/>}/>
      <KPI label="Hozir ishlayotgan" value={active.length} sub={active.map(id=>s.employees.find(e=>e.id===id)?.name.split(' ')[0]).join(', ')||'—'} tone="mint" icon={<Icon name="play"/>}/>
      <KPI label="Labor cost" value={compactMoney(rows.reduce((a,r)=>a+r.live/60*(s.employees.find(e=>e.id===r.employeeId)?.hourlyCost||0),0))} tone="purple" icon={<Icon name="wallet"/>}/>
    </div>
    <div className="split-main">
      <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Xodim, MO, operatsiya..." onRow={r=>navigate(`/production?view=orders&id=${r.orderId}`)} exportName="time-logs" resetKey={`${employee}|${range}`} pageSize={25}
        filtersActive={Boolean(employee)||range!=='7'} onResetFilters={()=>{setEmployee('');setRange('7')}}
        filters={<><FilterSelect label="Davr" value={range} onChange={setRange} defaultValue="7" options={[{value:'1',label:'Bugun'},{value:'7',label:'7 kun'},{value:'30',label:'30 kun'}]}/><FilterSelect label="Xodim" value={employee} onChange={setEmployee} options={s.employees.map(e=>({value:e.id,label:e.name}))}/></>}
        columns={[
          {key:'employee',label:'Xodim',value:r=>s.employees.find(e=>e.id===r.employeeId)?.name||''},
          {key:'order',label:'MO · operatsiya',value:r=>orderCode(s,r.orderId),render:r=>{const o=s.productionOrders.find(x=>x.id===r.orderId);return <div className="cell-main"><b>{o?.code}</b><small>{o?.workOrders.find(w=>w.id===r.workOrderId)?.name} · {productName(s,o?.productId)}</small></div>}},
          {key:'wc',label:'Work center',value:r=>workCenterCode(s,r.workCenterId),priority:'low'},
          {key:'start',label:'Boshlanish',value:r=>r.start},
          {key:'end',label:'Tugash',value:r=>r.end||'',render:r=>r.end?r.end.slice(11):<StatusBadge tone="info">Ishlamoqda</StatusBadge>},
          {key:'minutes',label:'Davomiylik',align:'right',value:r=>r.live,render:r=>formatMinutes(r.live)},
        ]}/>
      <Card title="Xodimlar bo‘yicha">{byEmployee.length?<BarList rows={byEmployee.map(x=>({label:x.e.name,sub:x.e.department,value:x.minutes}))} valueFormat={v=>formatMinutes(v)}/>:<Empty compact title="Ma’lumot yo‘q"/>}</Card>
    </div>
  </div>
}

function Performance(){
  const s=useApp().state
  const rows=s.employees.filter(e=>e.department==='Production'||s.timeLogs.some(t=>t.employeeId===e.id)).map(e=>({e,st:employeeStats(s,e.id,30)})).sort((a,b)=>(b.st.efficiency??-1)-(a.st.efficiency??-1))
  return <div className="page-stack">
    <PageHeader title="Ish samaradorligi" subtitle="30 kun · standart vaqt ÷ qayd etilgan vaqt"/>
    <div className="card flush"><div className="table-scroll"><table className="fit perf-table"><thead><tr><th>#</th><th>Xodim</th><th>Samaradorlik</th><th className="align-right">Ish vaqti</th><th className="align-right">MOlar</th><th className="align-right">Labor cost</th></tr></thead><tbody>
      {rows.map(({e,st},i)=><tr key={e.id}>
        <td className="muted">{i+1}</td>
        <td><div className="person-cell"><span className="avatar sm">{initials(e.name)}</span><div className="cell-main"><b>{e.name}</b><small>{e.department} · {workCenterCode(s,e.workCenterId)}</small></div></div></td>
        <td><div className="progress-cell perf-cell"><Progress value={(st.efficiency??0)/1.3} toneName={st.efficiency===null?'accent':st.efficiency>=95?'success':st.efficiency>=80?'warning':'danger'} label="Samaradorlik"/><b>{st.efficiency===null?'—':`${st.efficiency}%`}</b></div></td>
        <td className="align-right">{formatMinutes(st.logged)}</td>
        <td className="align-right">{st.orders}</td>
        <td className="align-right">{compactMoney(st.cost)}</td>
      </tr>)}
    </tbody></table></div><p className="table-note">Samaradorlik = standart vaqt ÷ qayd etilgan vaqt · shkala 130% gacha</p></div>
  </div>
}

function Activity(){
  const s=useApp().state
  const [q,setQ]=useSearchParamState('q'),[module,setModule]=useSearchParamState('module'),[user,setUser]=useSearchParamState('user'),[severity,setSeverity]=useSearchParamState('severity')
  const rows=s.activity.filter(a=>(!module||a.module===module)&&(!user||a.user===user)&&(!severity||a.severity===severity))
  return <div className="page-stack">
    <PageHeader title="Faoliyat / Audit" subtitle="Kim, qachon, qayerda, nima qildi"/>
    <ResourceTable rows={rows} query={q} onQuery={setQ} placeholder="Amal, manba, izoh..." exportName="audit-log" resetKey={`${module}|${user}|${severity}`} pageSize={25}
      filtersActive={Boolean(module||user||severity)} onResetFilters={()=>{setModule('');setUser('');setSeverity('')}}
      filters={<><FilterSelect label="Modul" value={module} onChange={setModule} options={[...new Set(s.activity.map(a=>a.module))].sort()}/><FilterSelect label="Foydalanuvchi" value={user} onChange={setUser} options={[...new Set(s.activity.map(a=>a.user))].sort()}/><FilterSelect label="Daraja" value={severity} onChange={setSeverity} options={['info','success','warning','danger']}/></>}
      columns={[
        {key:'date',label:'Sana',value:a=>a.date},
        {key:'user',label:'Foydalanuvchi',value:a=>a.user},
        {key:'action',label:'Amal',value:a=>a.action,render:a=><div className="cell-main"><b>{a.action}</b>{a.detail&&<small>{a.detail}</small>}</div>},
        {key:'module',label:'Modul',value:a=>a.module},
        {key:'source',label:'Yozuv',value:a=>a.source||''},
        {key:'severity',label:'Daraja',value:a=>a.severity,render:a=><StatusBadge tone={a.severity==='danger'?'danger':a.severity==='warning'?'warning':a.severity==='success'?'success':'info'}>{a.severity}</StatusBadge>,priority:'low'},
      ]}/>
  </div>
}
