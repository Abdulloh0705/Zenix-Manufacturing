import {useMemo,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Card,Checkbox,Confirm,Drawer,Empty,ExportPermission,Field,FilterSelect,Icon,InfoGrid,Input,KPI,Modal,PageHeader,ResourceTable,Select,StatusBadge,Tabs,Textarea,Toggle,required,useForm,useRecordParam,useSearchParamState} from '../../../shared/ui'
import type {Employee,Role} from '../../../types'
import type {Account,AuthEvent,SecurityPolicy} from '../../../domain/auth'
import {accountManageBlocker,activeSuperAdmins} from '../../../domain/auth'
import {assignRoleBlocker,employeeRemovalBlocker,isSuperAdminRole,roleManageBlocker,roleOf,superAdminEmployees} from '../../../domain/access'
import {SCHEMA_VERSION} from '../../../domain/migrations'
import {ACTIVITY_LIMIT} from '../../../domain/actions'
import {AUTH_EVENT_LIMIT} from '../../../domain/auth'
import {TIMEZONE_HINT,stamp,timeZoneOptions} from '../../../utils/dates'
import {fileSize,initials} from '../../../utils/format'
import {PermissionMatrix} from '../components/PermissionMatrix'

/** Each admin view needs its own permission; a direct URL to a view the role lacks shows why instead of the data. */
const VIEW_MODULE:Record<string,string>={users:'users',roles:'roles',organization:'settings',activity:'audit',security:'settings',system:'settings'}

export default function Admin(){
  const app=useApp()
  const [sp]=useSearchParams(),view=sp.get('view')||'dashboard'
  const module=VIEW_MODULE[view]
  if(module&&!app.can(module))return <div className="permission-state card"><span className="state-icon"><Icon name="lock" size={26}/></span><h1>Ruxsat mavjud emas</h1><p>“{app.currentRole.name}” roli bu bo‘limni ({module}) ko‘ra olmaydi.</p></div>
  if(view==='users')return <Users/>
  if(view==='roles')return <Roles/>
  if(view==='organization')return <Organization/>
  if(view==='activity')return <ActivityLog/>
  if(view==='security')return <Security/>
  if(view==='system')return <SystemInfo/>
  return <AdminDashboard/>
}

const isLocked=(a:Account)=>Boolean(a.lockedUntil&&a.lockedUntil>new Date().toISOString())
type UserRow={id:string;employee:Employee;role?:Role;account?:Account;state:'active'|'blocked'|'locked'|'none'|'archived'}
const STATE_LABEL:Record<UserRow['state'],string>={active:'Faol',blocked:'Bloklangan',locked:'Vaqtincha qulflangan',none:'Akkaunt yo‘q',archived:'Arxivlangan'}
const STATE_TONE:Record<UserRow['state'],'success'|'danger'|'warning'|'neutral'>={active:'success',blocked:'danger',locked:'warning',none:'neutral',archived:'neutral'}

function useUserRows():UserRow[]{
  const app=useApp(),s=app.state,accounts=app.auth.accounts
  return useMemo(()=>s.employees.map(employee=>{
    const account=accounts.find(a=>a.employeeId===employee.id)
    const state:UserRow['state']=employee.status==='Arxiv'?'archived':!account?'none':account.status==='blocked'?'blocked':isLocked(account)?'locked':'active'
    return {id:employee.id,employee,role:roleOf(s,employee.id),account,state}
  }),[s,accounts])
}

const when=(iso?:string)=>iso?stamp(new Date(iso)):'—'

/* -------------------------------------------------------------- dashboard -- */

function AdminDashboard(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const rows=useUserRows()
  const day=new Date(Date.now()-86400000).toISOString()
  const failed=app.auth.events.filter(e=>e.type==='login_failed'&&e.at>=day).length
  const supers=activeSuperAdmins({version:1,accounts:app.auth.accounts,policy:app.auth.policy,events:[],attempts:{}},s)
  const size=useMemo(()=>new Blob([JSON.stringify(s)]).size,[s])
  return <div className="page-stack">
    <PageHeader title="Admin Panel" subtitle="Foydalanuvchilar, rollar, xavfsizlik va tizim holati"/>
    <div className="inline-note warning"><Icon name="info"/><span><b>Demo autentifikatsiya.</b> Akkauntlar, parol xeshlari va sessiya shu brauzerda saqlanadi. Bu kirishni tartibga soladi, lekin brauzer xotirasini o‘zgartira oladigan odamdan himoya qilmaydi — haqiqiy xavfsizlik uchun backend kerak.</span></div>
    <div className="kpi-grid">
      <KPI label="Foydalanuvchilar" value={app.auth.accounts.length} sub={`${rows.filter(r=>r.state==='active').length} faol · ${rows.filter(r=>r.state==='blocked').length} bloklangan · ${rows.filter(r=>r.state==='none').length} akkauntsiz`} tone="mfg" icon={<Icon name="users"/>} onClick={app.can('users')?()=>navigate('/admin?view=users'):undefined}/>
      <KPI label="Rollar" value={s.roles.length} sub={`${s.roles.filter(r=>r.system).length} tizim · ${s.roles.filter(r=>!r.system).length} maxsus`} tone="purple" icon={<Icon name="lock"/>} onClick={app.can('roles')?()=>navigate('/admin?view=roles'):undefined}/>
      <KPI label="Faol session" value={app.auth.signedIn?1:0} sub={`shu brauzer · ${app.auth.account?.username||'—'}`} tone="mint" icon={<Icon name="user"/>}/>
      <KPI label="Xato kirishlar · 24 soat" value={failed} sub={`${rows.filter(r=>r.state==='locked').length} ta akkaunt qulflangan`} tone={failed?'orange':'neutral'} icon={<Icon name="warning"/>} onClick={app.can('audit')?()=>navigate('/admin?view=activity&source=auth'):undefined}/>
    </div>
    <div className="two-col">
      <Card title="Xavfsizlik holati">
        <div className="stack-list">
          <div className="list-row"><span className="list-row-copy"><b>Faol Super Admin</b><small>{supers.map(a=>a.username).join(', ')||'—'}</small></span><StatusBadge tone={supers.length>1?'success':'warning'}>{supers.length}</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Parol siyosati</b><small>kamida {app.auth.policy.minPasswordLength} belgi · {app.auth.policy.maxFailedAttempts} xato → {app.auth.policy.lockMinutes} min qulf</small></span><StatusBadge tone="info">Faol</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Session</b><small>{app.auth.policy.idleMinutes} min harakatsizlik · {app.auth.policy.sessionHours} soat · eslab qolish {app.auth.policy.rememberDays} kun</small></span><StatusBadge tone="info">Faol</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Vaqtinchalik parol bilan</b><small>keyingi kirishda almashtirishi kerak</small></span><StatusBadge tone={app.auth.accounts.some(a=>a.mustChangePassword)?'warning':'success'}>{app.auth.accounts.filter(a=>a.mustChangePassword).length}</StatusBadge></div>
        </div>
        {supers.length<2&&<p className="soft-meta">Tavsiya: zaxira uchun ikkinchi Super Admin tayinlang — yagona Super Admin parolini unutsa, tizimni boshqarib bo‘lmaydi.</p>}
      </Card>
      <Card title="Tizim holati">
        <div className="stack-list">
          <div className="list-row"><span className="list-row-copy"><b>Ma’lumotlar sxemasi</b><small>Versiyalangan migratsiya</small></span><StatusBadge tone="success">v{s.schemaVersion??SCHEMA_VERSION}</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Brauzer xotirasi</b><small>{fileSize(size)} / ~5 MB</small></span><StatusBadge tone={size>4e6?'danger':size>2.5e6?'warning':'success'}>{Math.round(size/5e6*100)}%</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Backend / server autentifikatsiya</b><small>Ulanmagan — barcha tekshiruvlar brauzerda</small></span><StatusBadge tone="neutral">Yo‘q</StatusBadge></div>
        </div>
        {app.can('settings')&&<div className="row-actions"><button type="button" className="secondary-glass-btn compact" onClick={()=>navigate('/admin?view=system')}>Batafsil <Icon name="chevron" size={13}/></button></div>}
      </Card>
    </div>
    {app.can('audit')&&<Card title="So‘nggi xavfsizlik hodisalari" actions={<button type="button" className="ghost-btn" onClick={()=>navigate('/admin?view=activity&source=auth')}>Barchasi <Icon name="chevron" size={13}/></button>}>
      {app.auth.events.length?<div className="stack-list">{app.auth.events.slice(0,6).map(e=><div className="list-row" key={e.id}><span className="list-row-copy"><b>{EVENT_LABEL[e.type]}{e.login?` · ${e.login}`:''}</b><small>{when(e.at)}{e.actorName?` · ${e.actorName}`:''}{e.detail?` · ${e.detail}`:''}</small></span><StatusBadge tone={EVENT_TONE[e.type]}>{e.type}</StatusBadge></div>)}</div>:<Empty compact title="Hodisa yo‘q"/>}
    </Card>}
  </div>
}

/* ------------------------------------------------------------------ users -- */

function Users(){
  const app=useApp(),s=app.state
  const rows=useUserRows()
  const [q,setQ]=useSearchParamState('q'),[role,setRole]=useSearchParamState('role'),[status,setStatus]=useSearchParamState('status')
  const [id,setId]=useRecordParam()
  const [create,setCreate]=useState(false)
  const filtered=rows.filter(r=>(!role||r.role?.id===role)&&(!status||r.state===status))
  const selected=rows.find(r=>r.id===id)
  return <div className="page-stack">
    <PageHeader title="Foydalanuvchilar" subtitle="Xodim + akkaunt: kirish, rol, bloklash" actions={app.can('users','create')&&<button type="button" className="primary-glass-btn" onClick={()=>setCreate(true)}><Icon name="plus"/>Foydalanuvchi qo‘shish</button>}/>
    <ResourceTable rows={filtered} query={q} onQuery={setQ} placeholder="Ism, login, rol, bo‘lim..." onRow={r=>setId(r.id)} resetKey={`${role}|${status}`}
      filtersActive={Boolean(role||status)} onResetFilters={()=>{setRole('');setStatus('')}}
      filters={<><FilterSelect label="Rol" value={role} onChange={setRole} options={s.roles.map(r=>({value:r.id,label:r.name}))}/><FilterSelect label="Holat" value={status} onChange={setStatus} options={(Object.keys(STATE_LABEL) as UserRow['state'][]).map(k=>({value:k,label:STATE_LABEL[k]}))}/></>}
      emptyText="Bu filtrlar bo‘yicha foydalanuvchi yo‘q."
      columns={[
        {key:'name',label:'Xodim',value:r=>r.employee.name,render:r=><div className="person-cell"><span className="avatar sm">{initials(r.employee.name)}</span><div className="cell-main"><b>{r.employee.name}</b><small>{r.employee.department}</small></div></div>},
        {key:'login',label:'Login',value:r=>r.account?.username||'',render:r=>r.account?<div className="cell-main"><b>{r.account.username}</b>{r.account.email&&<small>{r.account.email}</small>}</div>:<span className="muted">—</span>},
        {key:'role',label:'Rol',value:r=>r.role?.name||'',render:r=><span className="role-cell">{isSuperAdminRole(r.role)&&<Icon name="shield" size={13}/>}{r.role?.name||'—'}</span>},
        {key:'state',label:'Holat',value:r=>STATE_LABEL[r.state],render:r=><StatusBadge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</StatusBadge>},
        {key:'last',label:'Oxirgi kirish',value:r=>r.account?.lastLoginAt||'',render:r=>when(r.account?.lastLoginAt),priority:'low'},
      ]}/>
    {create&&<CreateUserModal onClose={()=>setCreate(false)} onCreated={eid=>{setCreate(false);setId(eid)}}/>}
    {selected&&<UserDrawer key={selected.id} row={selected} onClose={()=>setId(null)}/>}
  </div>
}

/** A readable temporary password that meets the policy; shown once to the administrator who hands it over. */
function tempPassword(){
  const letters='abcdefghjkmnpqrstuvwxyz',digits='23456789',all=letters+letters.toUpperCase()+digits
  const pick=(set:string)=>set[globalThis.crypto.getRandomValues(new Uint32Array(1))[0]%set.length]
  return [pick(letters),pick(letters.toUpperCase()),pick(digits),...Array.from({length:9},()=>pick(all))].sort(()=>globalThis.crypto.getRandomValues(new Uint8Array(1))[0]-128).join('')
}

function CreateUserModal({onClose,onCreated}:{onClose:()=>void;onCreated:(employeeId:string)=>void}){
  const app=useApp(),s=app.state,me=app.currentEmployee
  const free=s.employees.filter(e=>e.status!=='Arxiv'&&!app.auth.accounts.some(a=>a.employeeId===e.id)&&!accountManageBlocker(s,me,e.id))
  const roles=s.roles.filter(r=>!assignRoleBlocker(s,me,undefined,r.id))
  const [mode,setMode]=useState<'existing'|'new'>(free.length?'existing':'new')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const form=useForm({employeeId:free[0]?.id||'',name:'',department:'Production',roleId:roles.find(r=>r.key==='operator')?.id||roles[0]?.id||'',username:'',email:'',password:tempPassword(),mustChange:true},v=>({
    employeeId:mode==='existing'&&!v.employeeId?'Xodimni tanlang':undefined,
    name:mode==='new'?(required(v.name,'F.I.Sh')||(v.name.trim().split(/\s+/).length<2?'Ism va familiyani kiriting':undefined)):undefined,
    roleId:mode==='new'&&!v.roleId?'Rolni tanlang':undefined,
    username:required(v.username,'Login'),password:required(v.password,'Parol'),
  }))
  const submit=()=>form.submit(v=>{
    if(busy)return false
    void (async()=>{
      setBusy(true);setError('')
      try{
        let employeeId=v.employeeId
        if(mode==='new'){
          const created=app.createEntity('employees',{name:v.name.trim(),department:v.department,roleId:v.roleId,workCenterId:s.workCenters[0]?.id||'',shift:'A',status:'Faol',hourlyCost:0,attendance:100,efficiency:0})
          if(!created.ok||!created.id){setError(created.message);return}
          employeeId=created.id
        }
        const r=await app.createUser({employeeId,username:v.username.trim(),email:v.email.trim()||undefined,password:v.password,mustChangePassword:v.mustChange})
        if(r.ok)onCreated(employeeId);else setError(r.message)
      }finally{setBusy(false)}
    })()
    return true
  })
  return <Modal open onClose={onClose} title="Foydalanuvchi qo‘shish" size="md"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={busy} onClick={submit}>{busy?'Saqlanmoqda…':<><Icon name="check" size={16}/>Yaratish</>}</button></>}>
    <div className="form-stack">
      <Tabs items={[{value:'existing',label:'Mavjud xodim',count:free.length},{value:'new',label:'Yangi xodim'}]} active={mode} onChange={v=>setMode(v as 'existing'|'new')} ariaLabel="Xodim manbai"/>
      {mode==='existing'?(free.length?<Field label="Xodim" required error={form.error('employeeId')} hint="Akkaunti yo‘q va siz boshqara oladigan xodimlar"><Select value={form.values.employeeId} onChange={v=>form.set('employeeId',v)}>{free.map(e=><option key={e.id} value={e.id}>{e.name} · {roleOf(s,e.id)?.name||'rolsiz'}</option>)}</Select></Field>:<div className="inline-note"><Icon name="info"/><span>Akkauntsiz xodim yo‘q — “Yangi xodim”ni tanlang.</span></div>)
        :<div className="form-grid">
          <Field label="F.I.Sh" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
          <Field label="Bo‘lim"><Select value={form.values.department} onChange={v=>form.set('department',v)}>{['Production','Quality','Maintenance','Warehouse','Procurement','Sales','Management'].map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
          <Field className="span-2" label="Rol" required error={form.error('roleId')} hint="Faqat o‘zingizdan past darajadagi rollar"><Select value={form.values.roleId} onChange={v=>form.set('roleId',v)}>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        </div>}
      <div className="form-grid">
        <Field label="Login" required error={form.error('username')} hint="Telefon (+998…) yoki 3–32 lotin belgi"><Input {...form.input('username')} autoComplete="off" spellCheck={false}/></Field>
        <Field label="E-pochta"><Input type="email" {...form.input('email')} autoComplete="off"/></Field>
        <Field className="span-2" label="Vaqtinchalik parol" required error={form.error('password')} hint={`Kamida ${app.auth.policy.minPasswordLength} belgi. Foydalanuvchiga xavfsiz yo‘l bilan bering.`}><div className="input-affix"><input className="ui-input mono" {...form.input('password')} autoComplete="new-password" spellCheck={false}/><button type="button" className="password-toggle" onClick={()=>form.set('password',tempPassword())} aria-label="Yangi parol yaratish"><Icon name="refresh" size={15}/></button></div></Field>
      </div>
      <Checkbox checked={form.values.mustChange} onChange={v=>form.set('mustChange',v)} label="Birinchi kirishda parolni almashtirsin" description="Tavsiya etiladi"/>
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
    </div>
  </Modal>
}

function UserDrawer({row,onClose}:{row:UserRow;onClose:()=>void}){
  const app=useApp(),s=app.state,me=app.currentEmployee
  const [tab,setTab]=useState('overview'),[confirm,setConfirm]=useState<null|'block'|'unblock'|'delete'|'archive'>(null),[reset,setReset]=useState(false),[account,setAccount]=useState(false)
  const {employee,role}=row
  const self=employee.id===me.id
  const manageBlock=row.account?accountManageBlocker(s,me,employee.id):null
  const removeBlock=employeeRemovalBlocker(s,me,employee.id)
  const assignable=s.roles.filter(r=>r.id===employee.roleId||!assignRoleBlocker(s,me,employee,r.id))
  const roleBlock=self?'O‘z rolingizni o‘zgartira olmaysiz':!app.can('users','edit')?'Rol berish uchun users.edit kerak':assignable.length<=1?(assignRoleBlocker(s,me,employee,s.roles.find(r=>r.id!==employee.roleId)?.id||'')||'Boshqa rol berib bo‘lmaydi'):null
  const events=app.auth.events.filter(e=>e.accountId&&e.accountId===row.account?.id)
  return <Drawer open onClose={onClose} title={employee.name} eyebrow="Foydalanuvchi" icon="user" size="lg" subtitle={`${employee.department} · ${role?.name||'rolsiz'}${row.account?` · ${row.account.username}`:''}`} headerExtra={<StatusBadge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</StatusBadge>}
    actions={<>
      {row.account&&app.can('users','delete')&&<button type="button" className="ghost-btn" disabled={Boolean(manageBlock)} title={manageBlock||undefined} onClick={()=>setConfirm('delete')}><Icon name="trash" size={15}/>Akkauntni o‘chirish</button>}
      <span className="spacer"/>
      {row.account&&app.can('users','edit')&&<button type="button" className="secondary-glass-btn" disabled={Boolean(manageBlock)} title={manageBlock||undefined} onClick={()=>setReset(true)}><Icon name="key" size={15}/>Parolni tiklash</button>}
      {row.account&&app.can('users','edit')&&(row.account.status==='blocked'||row.state==='locked'
        ?<button type="button" className="primary-glass-btn" disabled={Boolean(manageBlock)} title={manageBlock||undefined} onClick={()=>setConfirm('unblock')}><Icon name="check" size={15}/>Faollashtirish</button>
        :<button type="button" className="danger-glass-btn" disabled={Boolean(manageBlock)} title={manageBlock||undefined} onClick={()=>setConfirm('block')}><Icon name="lock" size={15}/>Bloklash</button>)}
      {!row.account&&app.can('users','create')&&row.state!=='archived'&&<button type="button" className="primary-glass-btn" disabled={Boolean(accountManageBlocker(s,me,employee.id))} title={accountManageBlocker(s,me,employee.id)||undefined} onClick={()=>setAccount(true)}><Icon name="plus" size={15}/>Akkaunt ochish</button>}
    </>}>
    <Tabs items={[{value:'overview',label:'Umumiy'},{value:'access',label:'Rol va ruxsat'},{value:'history',label:'Kirish tarixi',count:events.length}]} active={tab} onChange={setTab}/>
    {tab==='overview'&&<>
      {(manageBlock||removeBlock)&&!self&&<div className="inline-note"><Icon name="lock"/><span>{manageBlock||removeBlock}</span></div>}
      {self&&<div className="inline-note"><Icon name="info"/><span>Bu sizning akkauntingiz: o‘zingizni bloklay, o‘chira yoki rolingizni o‘zgartira olmaysiz. Parolni profil menyusidan o‘zgartiring.</span></div>}
      <InfoGrid items={[{label:'Login',value:row.account?.username||'—'},{label:'E-pochta',value:row.account?.email||'—'},{label:'Oxirgi kirish',value:when(row.account?.lastLoginAt)},{label:'Parol o‘zgargan',value:when(row.account?.passwordChangedAt)},{label:'Akkaunt ochilgan',value:when(row.account?.createdAt)},{label:'Xato urinishlar',value:row.account?String(row.account.failedCount):'—'},row.account?.lockedUntil&&isLocked(row.account)?{label:'Qulf tugaydi',value:when(row.account.lockedUntil),tone:'warning'}:null,row.account?.mustChangePassword?{label:'Parol',value:'Vaqtinchalik — almashtirilishi kerak',tone:'warning'}:null]}/>
      {row.account&&<AccountForm account={row.account} disabled={Boolean(manageBlock)&&!self}/>}
    </>}
    {tab==='access'&&<div className="form-stack">
      <Field label="Rol" hint={roleBlock||'Faqat o‘zingizdan past darajadagi rollar'}><Select value={employee.roleId} disabled={Boolean(roleBlock)} onChange={v=>{if(v!==employee.roleId)app.updateEntity('employees',employee.id,{roleId:v})}}>{assignable.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      {role&&<p className="soft-meta">{role.description||'Maxsus rol'}</p>}
      {role&&<PermissionSummary role={role}/>}
      {app.can('users','edit')&&employee.status!=='Arxiv'&&<div className="row-actions"><button type="button" className="ghost-btn" disabled={Boolean(removeBlock)} title={removeBlock||undefined} onClick={()=>setConfirm('archive')}><Icon name="history" size={15}/>Xodimni arxivlash</button></div>}
    </div>}
    {tab==='history'&&(events.length?<div className="stack-list">{events.map(e=><div className="list-row" key={e.id}><span className="list-row-copy"><b>{EVENT_LABEL[e.type]}</b><small>{when(e.at)}{e.actorName&&e.actorName!==employee.name?` · ${e.actorName}`:''}{e.detail?` · ${e.detail}`:''}</small></span><StatusBadge tone={EVENT_TONE[e.type]}>{e.type}</StatusBadge></div>)}</div>:<Empty compact title="Kirish tarixi yo‘q"/>)}
    <Confirm open={confirm==='block'} onClose={()=>setConfirm(null)} danger title={`${row.account?.username} bloklansinmi?`} text="Foydalanuvchi tizimga kira olmaydi; ochiq sessiyasi keyingi tekshiruvda yopiladi." confirmText="Bloklash" onConfirm={()=>row.account&&app.setUserStatus(row.account.id,'blocked')}/>
    <Confirm open={confirm==='unblock'} onClose={()=>setConfirm(null)} title={`${row.account?.username} faollashtirilsinmi?`} text="Bloklash va xato urinishlar qulfi olib tashlanadi." confirmText="Faollashtirish" onConfirm={()=>row.account&&app.setUserStatus(row.account.id,'active')}/>
    <Confirm open={confirm==='delete'} onClose={()=>setConfirm(null)} danger title="Akkaunt o‘chirilsinmi?" text="Kirish huquqi butunlay olib tashlanadi. Xodim yozuvi va uning ish tarixi saqlanadi." confirmText="O‘chirish" onConfirm={()=>row.account&&app.deleteUser(row.account.id)}/>
    <Confirm open={confirm==='archive'} onClose={()=>setConfirm(null)} danger title={`${employee.name} arxivlansinmi?`} text="Arxivlangan xodim tizimga kira olmaydi. Tarix saqlanadi." confirmText="Arxivlash" onConfirm={()=>app.updateEntity('employees',employee.id,{status:'Arxiv'})}/>
    {reset&&row.account&&<ResetPasswordModal account={row.account} onClose={()=>setReset(false)}/>}
    {account&&<CreateAccountForEmployee employee={employee} onClose={()=>setAccount(false)}/>}
  </Drawer>
}

function AccountForm({account,disabled}:{account:Account;disabled:boolean}){
  const app=useApp()
  const form=useForm({username:account.username,email:account.email||''},v=>({username:required(v.username,'Login')}))
  return <div className="form-section"><h4>Akkaunt</h4>
    <div className="form-grid">
      <Field label="Login" required error={form.error('username')}><Input disabled={disabled} {...form.input('username')} spellCheck={false}/></Field>
      <Field label="E-pochta"><Input type="email" disabled={disabled} {...form.input('email')}/></Field>
    </div>
    {!disabled&&<div className="form-actions"><button type="button" className="primary-glass-btn" disabled={!form.dirty} onClick={()=>form.submit(v=>{const r=app.updateUser(account.id,{username:v.username,email:v.email});if(r.ok)form.reset(v);return r.ok})}><Icon name="check" size={15}/>Saqlash</button></div>}
  </div>
}

function ResetPasswordModal({account,onClose}:{account:Account;onClose:()=>void}){
  const app=useApp()
  const [password,setPassword]=useState(tempPassword()),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const submit=async()=>{setBusy(true);setError('');try{const r=await app.resetUserPassword(account.id,password);if(r.ok)onClose();else setError(r.message)}finally{setBusy(false)}}
  return <Modal open onClose={onClose} title="Parolni tiklash" subtitle={account.username} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="danger-glass-btn" disabled={busy} onClick={()=>void submit()}><Icon name="key" size={15}/>O‘rnatish</button></>}>
    <div className="form-stack">
      <p className="soft-meta">Vaqtinchalik parol o‘rnatiladi; foydalanuvchi keyingi kirishda o‘z parolini o‘rnatadi. Qulf va xato urinishlar ham tozalanadi.</p>
      <Field label="Vaqtinchalik parol"><div className="input-affix"><input className="ui-input mono" value={password} onChange={e=>setPassword(e.target.value)} spellCheck={false} autoComplete="new-password"/><button type="button" className="password-toggle" onClick={()=>setPassword(tempPassword())} aria-label="Yangi parol yaratish"><Icon name="refresh" size={15}/></button></div></Field>
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
    </div>
  </Modal>
}

function CreateAccountForEmployee({employee,onClose}:{employee:Employee;onClose:()=>void}){
  const app=useApp()
  const [username,setUsername]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(tempPassword()),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const submit=async()=>{setBusy(true);setError('');try{const r=await app.createUser({employeeId:employee.id,username:username.trim(),email:email.trim()||undefined,password,mustChangePassword:true});if(r.ok)onClose();else setError(r.message)}finally{setBusy(false)}}
  return <Modal open onClose={onClose} title="Akkaunt ochish" subtitle={employee.name} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" disabled={busy||!username.trim()} onClick={()=>void submit()}><Icon name="check" size={15}/>Yaratish</button></>}>
    <div className="form-stack">
      <Field label="Login" required><Input value={username} onChange={e=>setUsername(e.target.value)} autoFocus spellCheck={false} autoComplete="off"/></Field>
      <Field label="E-pochta"><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="off"/></Field>
      <Field label="Vaqtinchalik parol"><div className="input-affix"><input className="ui-input mono" value={password} onChange={e=>setPassword(e.target.value)} spellCheck={false} autoComplete="new-password"/><button type="button" className="password-toggle" onClick={()=>setPassword(tempPassword())} aria-label="Yangi parol yaratish"><Icon name="refresh" size={15}/></button></div></Field>
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
    </div>
  </Modal>
}

function PermissionSummary({role}:{role:Role}){
  if(isSuperAdminRole(role))return <div className="inline-note"><Icon name="shield"/><span>Super Admin — barcha modullar va amallar.</span></div>
  const modules=Object.entries(role.permissions||{}).filter(([,p])=>p.view)
  return modules.length?<div className="badge-row">{modules.map(([m,p])=><StatusBadge key={m} tone={p.edit||p.execute||p.create?'success':'info'}>{m}{p.edit?'':p.execute?' (bajarish)':' (ko‘rish)'}</StatusBadge>)}</div>:<Empty compact title="Ruxsat berilmagan" text="Faqat boshqaruv paneli ochiladi"/>
}

/* ------------------------------------------------------------------ roles -- */

function Roles(){
  const app=useApp(),s=app.state,me=app.currentEmployee
  const [roleId,setRoleId]=useSearchParamState('role',s.roles[0]?.id||'')
  const role=s.roles.find(r=>r.id===roleId)||s.roles[0]
  const [modal,setModal]=useState<null|'create'|'edit'>(null),[remove,setRemove]=useState(false)
  const members=s.employees.filter(e=>e.roleId===role?.id)
  const manageBlock=role?roleManageBlocker(s,me,role.id):null
  const deleteBlock=!role?null:role.system||role.key?'Tizim rolini o‘chirib bo‘lmaydi':members.length?`${members.length} ta xodimga biriktirilgan`:manageBlock
  if(!role)return <Empty title="Rol yo‘q"/>
  return <div className="page-stack">
    <PageHeader title="Rollar va ruxsatlar" subtitle="8 ta tizim roli va maxsus rollar · modul × amal matritsasi" actions={app.can('roles','create')&&<button type="button" className="primary-glass-btn" onClick={()=>setModal('create')}><Icon name="plus"/>Rol yaratish</button>}/>
    <div className="master-detail">
      <Card className="master-pane"><div className="master-list" role="listbox" aria-label="Rollar">{s.roles.map(r=><button type="button" role="option" aria-selected={r.id===role.id} key={r.id} className={r.id===role.id?'active':''} onClick={()=>setRoleId(r.id)}><span><b>{r.name}</b><small>{s.employees.filter(e=>e.roleId===r.id).length} xodim · {r.system?'tizim':'maxsus'}</small></span>{isSuperAdminRole(r)&&<Icon name="shield" size={14}/>}</button>)}</div></Card>
      <Card className="detail-pane" title={role.name} subtitle={role.description||(role.system?'Tizim roli':'Maxsus rol')}
        actions={<>
          {app.can('roles','create')&&<button type="button" className="ghost-btn" onClick={()=>{const r=app.duplicateRole(role.id);if(r.ok&&r.id)setRoleId(r.id)}}><Icon name="copy" size={14}/>Nusxa</button>}
          {app.can('roles','edit')&&<button type="button" className="ghost-btn" disabled={Boolean(manageBlock)} title={manageBlock||undefined} onClick={()=>setModal('edit')}><Icon name="edit" size={14}/>Tahrirlash</button>}
          {app.can('roles','delete')&&<button type="button" className="ghost-btn" disabled={Boolean(deleteBlock)} title={deleteBlock||undefined} onClick={()=>setRemove(true)}><Icon name="trash" size={14}/>O‘chirish</button>}
        </>}>
        {isSuperAdminRole(role)&&<div className="inline-note"><Icon name="shield"/><span>Super Admin barcha huquqlarga ega va tahrirlanmaydi. Faol Super Admin: {superAdminEmployees(s).map(e=>e.name).join(', ')||'—'}.</span></div>}
        {!isSuperAdminRole(role)&&manageBlock&&<div className="inline-note warning"><Icon name="lock"/><span>{manageBlock}</span></div>}
        <PermissionMatrix role={role}/>
        <p className="soft-meta">“Ko‘rish” o‘chsa modulning boshqa amallari ham o‘chadi · faqat o‘zingizda bor huquqni bera olasiz · “Bajarish” — sexdagi ish (operatsiya, natija, scrap, to‘xtash)</p>
        <div className="form-section"><h4>Bu roldagi xodimlar ({members.length})</h4>{members.length?<div className="badge-row">{members.map(e=><StatusBadge key={e.id} tone="info">{e.name}</StatusBadge>)}</div>:<p className="soft-meta">Hech kim yo‘q</p>}</div>
      </Card>
    </div>
    {modal&&<RoleModal role={modal==='edit'?role:undefined} onClose={()=>setModal(null)} onSaved={id=>{setModal(null);setRoleId(id)}}/>}
    <Confirm open={remove} onClose={()=>setRemove(false)} danger title={`${role.name} o‘chirilsinmi?`} text="Rol va uning ruxsatlari o‘chiriladi." confirmText="O‘chirish" onConfirm={()=>{const r=app.deleteRole(role.id);if(r.ok)setRoleId(s.roles[0]?.id||'')}}/>
  </div>
}

function RoleModal({role,onClose,onSaved}:{role?:Role;onClose:()=>void;onSaved:(id:string)=>void}){
  const app=useApp()
  const form=useForm({name:role?.name||'',description:role?.description||'',scope:role?.scope||'all'},v=>({name:required(v.name,'Rol nomi')}))
  return <Modal open onClose={onClose} title={role?'Rolni tahrirlash':'Yangi rol'} size="sm" footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Bekor qilish</button><button type="button" className="primary-glass-btn" onClick={()=>form.submit(v=>{const input={name:v.name,description:v.description,scope:v.scope as Role['scope']};const r=role?app.updateRole(role.id,input):app.createRole(input);if(r.ok)onSaved(r.id||role?.id||'');return r.ok})}><Icon name="check" size={15}/>Saqlash</button></>}>
    <div className="form-stack">
      <Field label="Nomi" required error={form.error('name')}><Input {...form.input('name')} autoFocus/></Field>
      <Field label="Tavsif"><Textarea {...form.input('description')}/></Field>
      <Field label="Qamrov (scope)" hint="Ma’lumot uchun: yozuv darajasidagi cheklov backend’siz to‘liq ta’minlanmaydi"><Select value={form.values.scope} onChange={v=>form.set('scope',v as Role['scope'])}><option value="all">Butun korxona</option><option value="branch">Filial</option><option value="warehouse">Ombor</option><option value="workcenter">Work center</option></Select></Field>
      {!role&&<p className="soft-meta">Yangi rol ruxsatsiz yaratiladi — keyin matritsada belgilang.</p>}
    </div>
  </Modal>
}

/* ----------------------------------------------------------- organization -- */

function Organization(){
  const app=useApp(),s=app.state,navigate=useNavigate(),c=s.settings.company,canEdit=app.can('settings','edit')
  const form=useForm({name:c.name,taxId:c.taxId,timezone:c.timezone},v=>({name:required(v.name,'Kompaniya nomi')}))
  return <div className="page-stack">
    <PageHeader title="Tashkilot" subtitle="Kompaniya rekvizitlari va tuzilma"/>
    <div className="two-col">
      <Card title="Kompaniya">
        {!canEdit&&<div className="inline-note warning"><Icon name="lock"/>Faqat ko‘rish: settings.edit kerak.</div>}
        <div className="form-grid">
          <Field label="Kompaniya nomi" required error={form.error('name')}><Input disabled={!canEdit} {...form.input('name')}/></Field>
          <Field label="STIR / Tax ID"><Input disabled={!canEdit} {...form.input('taxId')}/></Field>
          <Field label="Vaqt zonasi" hint={TIMEZONE_HINT}><Select value={form.values.timezone} disabled={!canEdit} onChange={v=>form.set('timezone',v)}>{timeZoneOptions(form.values.timezone).map(x=><option key={x} value={x}>{x}</option>)}</Select></Field>
          <Field label="Asosiy valyuta"><Input readOnly value="UZS · so‘m"/></Field>
        </div>
        {canEdit&&<div className="form-actions"><button type="button" className="primary-glass-btn" disabled={!form.dirty} onClick={()=>form.submit(v=>{app.saveSettings({company:{...c,...v,name:v.name.trim()}});form.reset(v)})}><Icon name="check" size={15}/>Saqlash</button></div>}
      </Card>
      <Card title="Tuzilma">
        <InfoGrid columns={2} items={[{label:'Filiallar',value:s.branches.length},{label:'Omborlar',value:s.warehouses.length},{label:'Liniyalar',value:s.productionLines.length},{label:'Work center',value:s.workCenters.length},{label:'Xodimlar',value:s.employees.filter(e=>e.status!=='Arxiv').length},{label:'Bo‘limlar',value:new Set(s.employees.map(e=>e.department)).size}]}/>
        <div className="row-actions">
          {app.can('settings')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>navigate('/settings?view=locations')}>Filial va liniyalar <Icon name="chevron" size={13}/></button>}
          {app.can('employees')&&<button type="button" className="secondary-glass-btn compact" onClick={()=>navigate('/employees')}>Xodimlar <Icon name="chevron" size={13}/></button>}
        </div>
      </Card>
    </div>
  </div>
}

/* ----------------------------------------------------------- activity log -- */

const EVENT_LABEL:Record<AuthEvent['type'],string>={setup:'Tizim sozlandi',login:'Kirish',login_failed:'Muvaffaqiyatsiz kirish',lockout:'Akkaunt qulflandi',logout:'Chiqish',session_expired:'Session muddati tugadi',session_idle:'Harakatsizlik — session yopildi',password_changed:'Parol o‘zgartirildi',password_reset:'Parol tiklandi (admin)',account_created:'Akkaunt yaratildi',account_updated:'Akkaunt tahrirlandi',account_blocked:'Akkaunt bloklandi',account_unblocked:'Akkaunt faollashtirildi',account_deleted:'Akkaunt o‘chirildi',policy_changed:'Xavfsizlik siyosati o‘zgardi',recovery_key_created:'Tiklash kaliti yaratildi',password_recovered:'Parol tiklandi (egasi)'}
const EVENT_TONE:Record<AuthEvent['type'],'success'|'warning'|'danger'|'info'|'neutral'>={setup:'info',login:'success',login_failed:'warning',lockout:'danger',logout:'neutral',session_expired:'neutral',session_idle:'neutral',password_changed:'info',password_reset:'warning',account_created:'info',account_updated:'info',account_blocked:'danger',account_unblocked:'success',account_deleted:'danger',policy_changed:'warning',recovery_key_created:'warning',password_recovered:'danger'}
const ADMIN_MODULES=['Rollar','Foydalanuvchilar','Xodimlar','Sozlamalar','Tizim','Xodim']
type LogRow={id:string;date:string;user:string;action:string;area:string;target:string;detail:string;tone:'success'|'warning'|'danger'|'info'|'neutral';source:'auth'|'admin'|'business'}

function ActivityLog(){
  const app=useApp(),s=app.state
  const [q,setQ]=useSearchParamState('q'),[source,setSource]=useSearchParamState('source'),[user,setUser]=useSearchParamState('user')
  // Older entries live in the activity archive (BUG-07); the log shows both.
  const archived=useMemo(()=>app.activityArchive(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [s.activity.length])
  const rows=useMemo<LogRow[]>(()=>[
    ...app.auth.events.map(e=>({id:e.id,date:when(e.at),user:e.actorName||e.login||'—',action:EVENT_LABEL[e.type],area:'Kirish / akkaunt',target:e.login||'',detail:e.detail||'',tone:EVENT_TONE[e.type],source:'auth' as const})),
    ...[...s.activity,...archived].map(a=>({id:a.id,date:a.date,user:a.user,action:a.action,area:a.module,target:a.source||'',detail:a.detail||'',tone:(a.severity==='danger'?'danger':a.severity==='warning'?'warning':a.severity==='success'?'success':'info') as LogRow['tone'],source:(ADMIN_MODULES.includes(a.module)?'admin':'business') as LogRow['source']})),
  ].sort((a,b)=>b.date.localeCompare(a.date)),[app.auth.events,s.activity,archived])
  const filtered=rows.filter(r=>(!source||r.source===source)&&(!user||r.user===user))
  return <div className="page-stack">
    <PageHeader title="Faoliyat jurnali" subtitle="Kim, qachon, qayerda, nima qildi — kirish, admin va biznes amallari"/>
    <div className="inline-note"><Icon name="info"/><span>Jurnal shu brauzerda saqlanadi: oxirgi {AUTH_EVENT_LIMIT} ta kirish hodisasi; amallar — {ACTIVITY_LIMIT} tasi ish ma’lumotida, eskilari arxivda ({archived.length}). Brauzer xotirasini o‘zgartira oladigan odam uni ham o‘zgartira oladi — o‘zgarmas audit uchun backend kerak.</span></div>
    <ExportPermission.Provider value={app.can('audit','export')}>
      <ResourceTable rows={filtered} query={q} onQuery={setQ} placeholder="Amal, foydalanuvchi, obyekt..." exportName="audit-log" resetKey={`${source}|${user}`} pageSize={25}
        filtersActive={Boolean(source||user)} onResetFilters={()=>{setSource('');setUser('')}}
        filters={<><FilterSelect label="Manba" value={source} onChange={setSource} options={[{value:'auth',label:'Kirish / akkaunt'},{value:'admin',label:'Admin amallari'},{value:'business',label:'Biznes amallari'}]}/><FilterSelect label="Foydalanuvchi" value={user} onChange={setUser} options={[...new Set(rows.map(r=>r.user))].sort()}/></>}
        columns={[
          {key:'date',label:'Sana',value:r=>r.date},
          {key:'user',label:'Foydalanuvchi',value:r=>r.user},
          {key:'action',label:'Amal',value:r=>r.action,render:r=><div className="cell-main"><b>{r.action}</b>{r.detail&&<small>{r.detail}</small>}</div>},
          {key:'area',label:'Bo‘lim',value:r=>r.area,priority:'low'},
          {key:'target',label:'Obyekt',value:r=>r.target},
          {key:'tone',label:'Daraja',value:r=>r.tone,render:r=><StatusBadge tone={r.tone}>{r.source==='auth'?'kirish':r.source==='admin'?'admin':'biznes'}</StatusBadge>,priority:'low'},
        ]}/>
    </ExportPermission.Provider>
  </div>
}

/* --------------------------------------------------------------- security -- */

function Security(){
  const app=useApp(),p=app.auth.policy,canEdit=app.can('settings','edit')
  const form=useForm({minPasswordLength:String(p.minPasswordLength),maxFailedAttempts:String(p.maxFailedAttempts),lockMinutes:String(p.lockMinutes),idleMinutes:String(p.idleMinutes),sessionHours:String(p.sessionHours),rememberDays:String(p.rememberDays)})
  const [letterDigit,setLetterDigit]=useState(p.requireLetterAndDigit)
  const num=(k:keyof typeof form.values)=>({type:'number',min:'1',disabled:!canEdit,...form.input(k)})
  const save=()=>form.submit(v=>{const patch:Partial<SecurityPolicy>={requireLetterAndDigit:letterDigit,...Object.fromEntries(Object.entries(v).map(([k,x])=>[k,Math.round(Number(x))]))};return app.updateSecurityPolicy(patch).ok})
  const session=app.auth.session
  return <div className="page-stack">
    <PageHeader title="Xavfsizlik" subtitle="Parol, bloklash va session siyosati"/>
    {!canEdit&&<div className="inline-note warning"><Icon name="lock"/>Faqat ko‘rish: settings.edit kerak.</div>}
    <div className="two-col">
      <Card title="Parol va bloklash">
        <div className="form-grid">
          <Field label="Parol uzunligi (min)" hint="8–64"><Input {...num('minPasswordLength')}/></Field>
          <Field label="Xato urinishlar chegarasi" hint="3–20"><Input {...num('maxFailedAttempts')}/></Field>
          <Field label="Vaqtinchalik qulf (daqiqa)" hint="1–1440"><Input {...num('lockMinutes')}/></Field>
        </div>
        <Toggle checked={letterDigit} disabled={!canEdit} onChange={setLetterDigit} label="Harf va raqam majburiy" description="Parolda kamida bitta harf va bitta raqam"/>
      </Card>
      <Card title="Session">
        <div className="form-grid">
          <Field label="Harakatsizlik (daqiqa)" hint="5–480 · “eslab qolish”siz sessionlar uchun"><Input {...num('idleMinutes')}/></Field>
          <Field label="Session muddati (soat)" hint="1–72"><Input {...num('sessionHours')}/></Field>
          <Field label="“Meni eslab qol” (kun)" hint="1–90"><Input {...num('rememberDays')}/></Field>
        </div>
        {session&&<InfoGrid columns={2} items={[{label:'Joriy session boshlangan',value:when(session.startedAt)},{label:'Tugash vaqti',value:when(session.expiresAt)},{label:'Eslab qolish',value:session.remember?'Ha':'Yo‘q'},{label:'Oxirgi faollik',value:when(session.lastActivity)}]}/>}
      </Card>
    </div>
    {canEdit&&<div className="form-actions"><button type="button" className="primary-glass-btn" disabled={!form.dirty&&letterDigit===p.requireLetterAndDigit} onClick={save}><Icon name="check" size={15}/>Siyosatni saqlash</button></div>}
    <Card title="Cheklovlar (frontend demo)">
      <ul className="plain-list">
        <li>Parollar PBKDF2-SHA-256 (210 000 iteratsiya, alohida tuz) bilan xeshlanadi, lekin xesh brauzerda saqlanadi — uni o‘g‘irlagan odam offline taxmin qilishi mumkin.</li>
        <li>Sessiya va ruxsatlar brauzerda tekshiriladi: DevTools orqali saqlangan ma’lumotni o‘zgartirib chetlab o‘tish mumkin.</li>
        <li>“Barcha qurilmalardan chiqish”, e-pochta orqali parol tiklash va ikki bosqichli kirish backend’siz mumkin emas.</li>
        <li>Rol qamrovi (filial, ombor, work center) faqat ma’lumot uchun — yozuv darajasidagi cheklov serverda bo‘lishi kerak.</li>
      </ul>
    </Card>
  </div>
}

/* ----------------------------------------------------------------- system -- */

function SystemInfo(){
  const app=useApp(),s=app.state,navigate=useNavigate()
  const size=useMemo(()=>new Blob([JSON.stringify(s)]).size,[s])
  const authSize=useMemo(()=>new Blob([JSON.stringify({accounts:app.auth.accounts,events:app.auth.events})]).size,[app.auth.accounts,app.auth.events])
  return <div className="page-stack">
    <PageHeader title="Tizim" subtitle="Autentifikatsiya, saqlash va backend holati"/>
    <div className="two-col">
      <Card title="Holat">
        <div className="stack-list">
          <div className="list-row"><span className="list-row-copy"><b>Autentifikatsiya</b><small>Frontend demo — akkauntlar shu brauzerda (alohida kalitda, backup’dan tashqari)</small></span><StatusBadge tone="warning">Demo</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Backend API</b><small>Integratsiya nuqtasi: domain/actions.ts, domain/access.ts, domain/auth.ts → REST</small></span><StatusBadge tone="neutral">Ulanmagan</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Ma’lumotlar sxemasi</b><small>Migratsiya avtomatik, oldin zaxira olinadi</small></span><StatusBadge tone="success">v{s.schemaVersion??SCHEMA_VERSION}</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Biznes ma’lumotlari</b><small>{fileSize(size)}</small></span><StatusBadge tone={size>4e6?'danger':size>2.5e6?'warning':'success'}>{Math.round(size/5e6*100)}%</StatusBadge></div>
          <div className="list-row"><span className="list-row-copy"><b>Akkauntlar va jurnal</b><small>{app.auth.accounts.length} akkaunt · {app.auth.events.length} hodisa</small></span><StatusBadge tone="info">{fileSize(authSize)}</StatusBadge></div>
        </div>
        {app.can('settings')&&<div className="row-actions"><button type="button" className="secondary-glass-btn compact" onClick={()=>navigate('/settings?view=system')}><Icon name="database" size={14}/>Backup va tozalash</button></div>}
      </Card>
      <Card title="Haqiqiy ishga tushirish uchun">
        <ol className="plain-list">
          <li>Backend: login, parol xeshi va sessiya serverda (httpOnly cookie yoki qisqa muddatli token).</li>
          <li>Har bir domain action serverda ham <code>access.ts</code> qoidalari bilan tekshiriladi.</li>
          <li>Audit jurnali o‘zgarmas saqlanadi (append-only jadval).</li>
          <li>Rol qamrovi (filial/ombor/WC) bo‘yicha yozuvlarni server filtrlaydi.</li>
          <li>Parolni e-pochta orqali tiklash, MFA, barcha sessiyalardan chiqish.</li>
        </ol>
      </Card>
    </div>
  </div>
}
