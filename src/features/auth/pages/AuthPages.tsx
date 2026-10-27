import {useState} from 'react'
import type {FormEvent,ReactNode} from 'react'
import {Navigate,useNavigate,useSearchParams} from 'react-router-dom'
import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Checkbox,Confirm,Field,Icon,Input,Select} from '../../../shared/ui'
import {downloadText} from '../../../utils/exportData'
import {todayISO} from '../../../utils/dates'

/** Where to go after signing in: only paths inside this app (never an external URL). */
export function safeNext(raw:string|null){
  return raw&&raw.startsWith('/')&&!raw.startsWith('//')&&!raw.startsWith('/login')&&!raw.startsWith('/setup')?raw:'/'
}

const MODULES:Array<{icon:string;title:string;text:string}>=[
  {icon:'factory',title:'Ishlab chiqarish',text:'MO, work order va Shop Floor'},
  {icon:'warehouse',title:'Ombor',text:'Lot, FEFO, rezerv va karantin'},
  {icon:'shield',title:'Sifat nazorati',text:'Kirish, jarayon va final QC'},
  {icon:'wrench',title:'Uskunalar',text:'Downtime, servis va OEE'},
]

const THEMES:Array<{value:'light'|'dark'|'system';label:string;icon:string}>=[{value:'light',label:'Light',icon:'sun'},{value:'dark',label:'Dark',icon:'moon'},{value:'system',label:'System',icon:'monitor'}]

function ThemeSwitch(){
  const app=useApp(),current=app.state.settings.theme
  return <div className="auth-theme" role="radiogroup" aria-label="Theme">{THEMES.map(t=><button key={t.value} type="button" role="radio" aria-checked={current===t.value} aria-label={t.label} title={t.label} className={current===t.value?'active':''} onClick={()=>app.setTheme(t.value)}><Icon name={t.icon} size={15}/></button>)}</div>
}

/** Split screen: product panel on the left, the form on the right; below 900px only a compact brand row stays. */
function AuthShell({title,subtitle,children,footer}:{title:string;subtitle?:ReactNode;children:ReactNode;footer?:ReactNode}){
  return <main className="auth-page">
    <aside className="auth-aside" aria-label="ZENIX Manufacturing">
      <div className="auth-brand"><span className="brand-mark" aria-hidden="true"><b>ZX</b></span><div className="brand-copy"><b>ZENIX</b><span>Manufacturing</span></div></div>
      <div className="auth-pitch">
        <h2>Ishlab chiqarish — rejadan yetkazib berishgacha</h2>
        <p>Buyurtmalar, materiallar, sifat va uskunalar bitta tizimda.</p>
      </div>
      <ul className="auth-modules">{MODULES.map(m=><li key={m.title}><span className="auth-module-icon" aria-hidden="true"><Icon name={m.icon} size={17}/></span><span><b>{m.title}</b><small>{m.text}</small></span></li>)}</ul>
    </aside>
    <section className="auth-main" aria-labelledby="auth-title">
      <div className="auth-toolbar"><div className="auth-brand auth-brand-compact"><span className="brand-mark" aria-hidden="true"><b>ZX</b></span><div className="brand-copy"><b>ZENIX</b><span>Manufacturing</span></div></div><ThemeSwitch/></div>
      <div className="auth-card">
        <header className="auth-head"><h1 id="auth-title">{title}</h1>{subtitle&&<p>{subtitle}</p>}</header>
        {children}
        {footer}
      </div>
      <p className="auth-demo-note"><Icon name="lock" size={13}/><span>Lokal autentifikatsiya: akkauntlar shu brauzerda saqlanadi. Ochiq foydalanish uchun server tomoni kerak.</span></p>
    </section>
  </main>
}

export function PasswordInput({id,value,onChange,autoComplete,autoFocus,invalid}:{id:string;value:string;onChange:(v:string)=>void;autoComplete:string;autoFocus?:boolean;invalid?:boolean}){
  const [shown,setShown]=useState(false)
  return <div className="input-affix password-field">
    <input id={id} className="ui-input" type={shown?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} aria-invalid={invalid||undefined} spellCheck={false}/>
    <button type="button" className="password-toggle" onClick={()=>setShown(v=>!v)} aria-label={shown?'Parolni yashirish':'Parolni ko‘rsatish'} aria-pressed={shown}><Icon name={shown?'eye-off':'eye'} size={16}/></button>
  </div>
}

/**
 * Shown instead of the app while stored data cannot be opened. Nothing has been written over it: the user
 * downloads a copy first, then chooses to start clean (the copy is also kept in the browser when it fits).
 */
export function RecoveryScreen(){
  const app=useApp(),r=app.recovery
  const [downloaded,setDownloaded]=useState(false),[ask,setAsk]=useState(false),[error,setError]=useState('')
  if(!r)return null
  const download=()=>{downloadText(`zenix-saqlangan-malumot-${todayISO()}.json`,r.raw,'application/json');setDownloaded(true)}
  const start=()=>{const out=app.startClean(downloaded);if(!out.ok)setError(out.message)}
  return <AuthShell title="Ma’lumotlarni tiklash" subtitle={r.reason==='unreadable'?'Brauzerda saqlangan ma’lumot buzilgan yoki ZENIX formatida emas.':'Saqlangan ma’lumotni ochishda xatolik yuz berdi.'}>
    <div className="form-stack">
      <div className="inline-note warning" role="status"><Icon name="info"/><span>Hech narsa o‘chirilmadi va ustidan yozilmadi — ma’lumot brauzerda o‘zgarmagan holda turibdi. Davom etishdan oldin nusxasini yuklab oling.</span></div>
      <button type="button" className="secondary-glass-btn" onClick={download}><Icon name="download" size={16}/>{downloaded?'Nusxa yuklab olindi':'Nusxani yuklab olish'}</button>
      <button type="button" className="primary-glass-btn auth-submit" onClick={()=>setAsk(true)}><Icon name="refresh" size={16}/>Toza holatda ochish</button>
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
    </div>
    <p className="soft-meta auth-help"><Icon name="key" size={13}/>Keyin Tizim → Backup import orqali eksport qilingan zaxirani tiklash mumkin.</p>
    <Confirm open={ask} onClose={()=>setAsk(false)} onConfirm={start} danger title="Toza holatda ochilsinmi?" text="Ilova bo‘sh ish nusxasi bilan ochiladi. O‘qilmagan ma’lumot nusxasi brauzerda alohida saqlanadi (joy bo‘lsa) va Tizim → Tiklash nusxalari bo‘limida qoladi." confirmText="Toza holatda ochish"/>
  </AuthShell>
}

export function LoginPage(){
  const app=useApp(),navigate=useNavigate(),[sp]=useSearchParams()
  const [login,setLogin]=useState(''),[password,setPassword]=useState(''),[remember,setRemember]=useState(false)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const next=safeNext(sp.get('next'))
  if(app.auth.needsSetup)return <Navigate to="/setup" replace/>
  if(app.auth.signedIn)return <Navigate to={next} replace/>
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    if(!login.trim()||!password){setError('Login va parolni kiriting');return}
    setBusy(true);setError('')
    try{
      const r=await app.login(login,password,remember)
      if(r.ok)navigate(next,{replace:true})
      else{setError(r.message);setPassword('')}
    }finally{setBusy(false)}
  }
  return <AuthShell title="Tizimga kirish" subtitle="Telefon raqami, login yoki e-pochta bilan kiring">
    {app.auth.notice&&<div className="inline-note warning" role="status"><Icon name="info"/><span>{app.auth.notice}</span></div>}
    <form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Telefon yoki login" required><Input id="login-name" placeholder="+998 90 123 45 67" inputMode="text" value={login} onChange={e=>{setLogin(e.target.value);setError('')}} autoComplete="username" autoFocus spellCheck={false} aria-invalid={Boolean(error)||undefined}/></Field>
      <div className={`field ${error?'has-error':''}`}><label htmlFor="login-password">Parol <span className="req" aria-hidden="true">*</span></label><PasswordInput id="login-password" value={password} onChange={v=>{setPassword(v);setError('')}} autoComplete="current-password" invalid={Boolean(error)}/></div>
      <Checkbox checked={remember} onChange={setRemember} label="Meni eslab qol" description={`${app.auth.policy.rememberDays} kun davomida`}/>
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
      <button type="submit" className="primary-glass-btn auth-submit" disabled={busy}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Tekshirilmoqda…</>:<><Icon name="arrow-right" size={16}/>Kirish</>}</button>
    </form>
    <p className="soft-meta auth-help"><Icon name="key" size={13}/>Parolni unutdingizmi? Administrator vaqtinchalik parol beradi.</p>
  </AuthShell>
}

export function SetupPage(){
  const app=useApp(),navigate=useNavigate(),s=app.state
  const people=s.employees.filter(e=>e.status!=='Arxiv')
  const [employeeId,setEmployeeId]=useState(people.find(e=>e.department==='Management')?.id||people[0]?.id||'')
  const [username,setUsername]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  if(!app.auth.needsSetup)return <Navigate to="/login" replace/>
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    if(password!==confirm){setError('Parollar mos emas');return}
    setBusy(true);setError('')
    try{
      const r=await app.setupSuperAdmin({employeeId,username:username.trim(),email:email.trim()||undefined,password})
      if(r.ok)navigate('/',{replace:true})
      else setError(r.message)
    }finally{setBusy(false)}
  }
  return <AuthShell title="Birinchi sozlash" subtitle="Super Admin akkauntini yarating. Tizimda standart parol yo‘q.">
    <form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Xodim" required hint="Super Admin roliga o‘tkaziladi; ma’lumotlar o‘zgarmaydi"><Select value={employeeId} onChange={setEmployeeId} ariaLabel="Xodim">{people.map(e=><option key={e.id} value={e.id}>{e.name} · {e.department}</option>)}</Select></Field>
      <Field label="Telefon yoki login" required hint="Telefon (+998…) yoki 3–32 lotin belgi"><Input value={username} placeholder="+998 90 123 45 67" onChange={e=>setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoFocus/></Field>
      <Field label="E-pochta" hint="Ixtiyoriy"><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></Field>
      <div className="field"><label htmlFor="setup-password">Parol <span className="req" aria-hidden="true">*</span></label><PasswordInput id="setup-password" value={password} onChange={setPassword} autoComplete="new-password"/><small className="field-hint">Kamida {app.auth.policy.minPasswordLength} belgi{app.auth.policy.requireLetterAndDigit?', harf va raqam':''}</small></div>
      <div className="field"><label htmlFor="setup-confirm">Parolni takrorlang <span className="req" aria-hidden="true">*</span></label><PasswordInput id="setup-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password"/></div>
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
      <button type="submit" className="primary-glass-btn auth-submit" disabled={busy||!employeeId}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Yaratilmoqda…</>:<><Icon name="shield" size={16}/>Super Admin yaratish</>}</button>
    </form>
  </AuthShell>
}

/** Shown instead of the app until a user with a temporary password sets their own. */
export function ForcePasswordChange(){
  const app=useApp()
  return <AuthShell title="Yangi parol o‘rnating" subtitle={`${app.currentEmployee.name}, administrator vaqtinchalik parol bergan — davom etish uchun o‘z parolingizni o‘rnating.`} footer={<button type="button" className="ghost-btn auth-logout" onClick={()=>app.logout()}><Icon name="logout" size={15}/>Chiqish</button>}>
    <ChangePasswordForm/>
  </AuthShell>
}

export function ChangePasswordForm({onDone}:{onDone?:()=>void}){
  const app=useApp()
  const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    if(next!==confirm){setError('Yangi parollar mos emas');return}
    setBusy(true);setError('')
    try{const r=await app.changePassword(current,next);if(r.ok){setCurrent('');setNext('');setConfirm('');onDone?.()}else setError(r.message)}finally{setBusy(false)}
  }
  return <form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
    <div className="field"><label htmlFor="pw-current">Joriy parol</label><PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus/></div>
    <div className="field"><label htmlFor="pw-next">Yangi parol</label><PasswordInput id="pw-next" value={next} onChange={setNext} autoComplete="new-password"/><small className="field-hint">Kamida {app.auth.policy.minPasswordLength} belgi{app.auth.policy.requireLetterAndDigit?', harf va raqam':''}</small></div>
    <div className="field"><label htmlFor="pw-confirm">Yangi parolni takrorlang</label><PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password"/></div>
    {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
    <button type="submit" className="primary-glass-btn auth-submit" disabled={busy}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Saqlanmoqda…</>:<><Icon name="check" size={16}/>Parolni saqlash</>}</button>
  </form>
}
