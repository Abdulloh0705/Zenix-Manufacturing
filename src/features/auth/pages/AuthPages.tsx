import {useState} from 'react'
import type {FormEvent,ReactNode} from 'react'
import {Link,Navigate,useLocation,useNavigate,useSearchParams} from 'react-router-dom'
import {REGISTRATION_CLOSED,useApp} from '../../../app/providers/AppProvider/AppContext'
import {normalizeLogin,registrationProblem,validatePassword} from '../../../domain/auth'
import type {RegistrationField,SecurityPolicy} from '../../../domain/auth'
import {randomSalt} from '../../../shared/lib/crypto'
import {Checkbox,Confirm,Field,Icon,Input,Segmented} from '../../../shared/ui'
import {downloadText} from '../../../utils/exportData'
import {todayISO} from '../../../utils/dates'

/** Where to go after signing in: only paths inside this app (never an external URL). */
export function safeNext(raw:string|null){
  return raw&&raw.startsWith('/')&&!raw.startsWith('//')&&!/^\/(login|setup|register|forgot-password)/.test(raw)?raw:'/'
}

const focusField=(id:string)=>document.getElementById(id)?.focus()
const passwordHint=(p:SecurityPolicy)=>`Kamida ${p.minPasswordLength} belgi${p.requireLetterAndDigit?', harf va raqam':''}`

/** Switches between the two public pages; the page to return to after signing in stays in the address. */
function AuthTabs({active}:{active:'login'|'register'}){
  const [sp]=useSearchParams(),next=sp.get('next'),query=next?`?next=${encodeURIComponent(next)}`:''
  return <nav className="auth-tabs" aria-label="Kirish yoki ro‘yxatdan o‘tish">
    <Link to={`/login${query}`} aria-current={active==='login'?'page':undefined}>Kirish</Link>
    <Link to={`/register${query}`} aria-current={active==='register'?'page':undefined}>Ro‘yxatdan o‘tish</Link>
  </nav>
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
function AuthShell({title,subtitle,children,footer,top}:{title:string;subtitle?:ReactNode;children:ReactNode;footer?:ReactNode;top?:ReactNode}){
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
        {top}
        <header className="auth-head"><h1 id="auth-title">{title}</h1>{subtitle&&<p>{subtitle}</p>}</header>
        {children}
        {footer}
      </div>
      <p className="auth-demo-note"><Icon name="lock" size={13}/><span>Lokal autentifikatsiya: akkaunt faqat shu brauzer va manzilda saqlanadi, boshqa qurilmada ishlamaydi. Ochiq foydalanish uchun server tomoni kerak.</span></p>
    </section>
  </main>
}

export function PasswordInput({id,value,onChange,autoComplete,autoFocus,invalid,describedBy}:{id:string;value:string;onChange:(v:string)=>void;autoComplete:string;autoFocus?:boolean;invalid?:boolean;describedBy?:string}){
  const [shown,setShown]=useState(false)
  return <div className="input-affix password-field">
    <input id={id} className="ui-input" type={shown?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} aria-invalid={invalid||undefined} aria-describedby={describedBy} spellCheck={false}/>
    <button type="button" className="password-toggle" onClick={()=>setShown(v=>!v)} aria-label={shown?'Parolni yashirish':'Parolni ko‘rsatish'} aria-pressed={shown}><Icon name={shown?'eye-off':'eye'} size={16}/></button>
  </div>
}

function PasswordField({id,label,error,hint,...input}:{id:string;label:string;value:string;onChange:(v:string)=>void;autoComplete:string;autoFocus?:boolean;error?:string;hint?:string}){
  const noteId=`${id}-note`
  return <div className={`field ${error?'has-error':''}`}>
    <label htmlFor={id}>{label}<span className="required-mark" aria-hidden="true">*</span></label>
    <PasswordInput id={id} {...input} invalid={Boolean(error)} describedBy={error||hint?noteId:undefined}/>
    {error?<small id={noteId} className="field-error" role="alert">{error}</small>:hint?<small id={noteId} className="field-hint">{hint}</small>:null}
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
  // Data of a newer app version is only exported here: replacing it from an older build would lose what it holds.
  const newer=r.reason==='newer'
  const subtitle=newer?`Ma’lumot ilovaning yangiroq versiyasida${r.version?` (v${r.version})`:''} saqlangan — bu versiya uni ocha olmaydi va ustidan yozmaydi.`
    :r.reason==='unreadable'?'Brauzerda saqlangan ma’lumot buzilgan yoki ZENIX formatida emas.':'Saqlangan ma’lumotni ochishda xatolik yuz berdi.'
  return <AuthShell title="Ma’lumotlarni tiklash" subtitle={subtitle}>
    <div className="form-stack">
      <div className="inline-note warning" role="status"><Icon name="info"/><span>{newer?'Hech narsa o‘zgartirilmadi. Nusxani yuklab oling, so‘ng ilovaning yangi versiyasini oching (sahifani yangilang). Bu oyna ma’lumotni faqat o‘qiydi.':'Hech narsa o‘chirilmadi va ustidan yozilmadi — ma’lumot brauzerda o‘zgarmagan holda turibdi. Davom etishdan oldin nusxasini yuklab oling.'}</span></div>
      <button type="button" className="secondary-glass-btn" onClick={download}><Icon name="download" size={16}/>{downloaded?'Nusxa yuklab olindi':'Nusxani yuklab olish'}</button>
      {newer
        ?<button type="button" className="primary-glass-btn auth-submit" onClick={()=>window.location.reload()}><Icon name="refresh" size={16}/>Sahifani yangilash</button>
        :<button type="button" className="primary-glass-btn auth-submit" onClick={()=>setAsk(true)}><Icon name="refresh" size={16}/>Toza holatda ochish</button>}
      {error&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{error}</span></div>}
    </div>
    <p className="soft-meta auth-help"><Icon name="key" size={13}/>Keyin Tizim → Backup import orqali eksport qilingan zaxirani tiklash mumkin.</p>
    <Confirm open={ask} onClose={()=>setAsk(false)} onConfirm={start} danger title="Toza holatda ochilsinmi?" text="Ilova bo‘sh ish nusxasi bilan ochiladi. O‘qilmagan ma’lumot nusxasi brauzerda alohida saqlanadi (joy bo‘lsa) va Tizim → Tiklash nusxalari bo‘limida qoladi." confirmText="Toza holatda ochish"/>
  </AuthShell>
}

export function LoginPage(){
  const app=useApp(),navigate=useNavigate(),[sp]=useSearchParams(),location=useLocation()
  const [login,setLogin]=useState(''),[password,setPassword]=useState(''),[remember,setRemember]=useState(false)
  const [errors,setErrors]=useState<{login?:string;password?:string;form?:string}>({}),[busy,setBusy]=useState(false)
  const next=safeNext(sp.get('next'))
  if(app.auth.signedIn)return <Navigate to={next} replace/>
  const notice=(location.state as {notice?:string}|null)?.notice||app.auth.notice
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    const missing={login:login.trim()?undefined:'Telefon, login yoki e-pochtani kiriting',password:password?undefined:'Parolni kiriting'}
    if(missing.login||missing.password){setErrors(missing);focusField(missing.login?'login-name':'login-password');return}
    setBusy(true);setErrors({})
    try{
      const r=await app.login(login,password,remember)
      if(r.ok)navigate(next,{replace:true})
      else{setErrors({form:r.message});setPassword('')}
    }finally{setBusy(false)}
  }
  const registration=app.auth.registration
  return <AuthShell title="Tizimga kirish" subtitle="Telefon raqami, login yoki e-pochta bilan kiring" top={registration.open?<AuthTabs active="login"/>:undefined}
    footer={registration.open
      ?<div className="auth-register-cta"><span>Kompaniyangiz hali ZENIX’da yo‘qmi?</span><Link className="secondary-glass-btn" to="/register"><Icon name="factory" size={16}/>Yangi biznes yaratish</Link></div>
      :<div className="inline-note" role="note"><Icon name="info"/><span>Yangi biznes ro‘yxati hozircha platforma tomonidan yopilgan. Kompaniyangiz xodimi bo‘lsangiz, akkauntni Biznes egasidan oling.</span></div>}>
    {app.auth.setupBlocked&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{app.auth.setupBlocked}</span></div>}
    {app.auth.needsSetup&&!app.auth.setupBlocked&&<div className="inline-note" role="status"><Icon name="info"/><span>Bu brauzerda hali kompaniya ro‘yxatdan o‘tmagan. Akkauntingiz boshqa brauzerda yoki manzilda bo‘lsa, o‘sha yerda kiring: ma’lumotlar brauzerlar o‘rtasida almashmaydi.</span></div>}
    {notice&&<div className="inline-note warning" role="status"><Icon name="info"/><span>{notice}</span></div>}
    <form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Telefon, login yoki e-pochta" required error={errors.login}><Input id="login-name" placeholder="+998 90 123 45 67" inputMode="text" value={login} onChange={e=>{setLogin(e.target.value);setErrors({})}} autoComplete="username" autoFocus spellCheck={false}/></Field>
      <PasswordField id="login-password" label="Parol" value={password} onChange={v=>{setPassword(v);setErrors({})}} autoComplete="current-password" error={errors.password}/>
      <div className="auth-row"><Checkbox checked={remember} onChange={setRemember} label="Meni eslab qol" description={`${app.auth.policy.rememberDays} kun davomida`}/><Link className="link-btn" to="/forgot-password">Parolni unutdingizmi?</Link></div>
      {errors.form&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{errors.form}</span></div>}
      <button type="submit" className="primary-glass-btn auth-submit" disabled={busy}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Tekshirilmoqda…</>:<><Icon name="arrow-right" size={16}/>Kirish</>}</button>
    </form>
  </AuthShell>
}

/**
 * Public registration creates an independent company and owner. A missing legacy owner is never inferred.
 */
export function RegisterPage(){
  const app=useApp(),navigate=useNavigate(),s=app.state
  const people=s.employees.filter(e=>e.status!=='Arxiv')
  const owner=people.find(e=>e.department==='Management')||people[0]
  const [form,setForm]=useState({name:'',company:'',phone:'',username:'',email:'',password:'',confirm:''})
  const [errors,setErrors]=useState<Partial<Record<RegistrationField|'form',string>>>({}),[busy,setBusy]=useState(false),[issued,setIssued]=useState('')
  if(issued)return <IssuedKeyScreen value={issued} onDone={()=>navigate('/',{replace:true})}/>
  // Signing up signs in before the key arrives: while busy this page stays, or the only copy of the key would be lost.
  if(!busy&&app.auth.signedIn)return <Navigate to="/" replace/>
  if(!busy&&app.auth.setupBlocked&&app.auth.needsSetup)return <AuthShell title="Ro‘yxatdan o‘tish" subtitle="Eski kompaniya egasi tasdiqlanmadi." top={<AuthTabs active="register"/>}>
    <div className="inline-note danger" role="alert"><Icon name="warning"/><span>{app.auth.setupBlocked}</span></div>
    <Link className="primary-glass-btn auth-submit" to="/login"><Icon name="arrow-right" size={16}/>Kirish sahifasiga o‘tish</Link>
  </AuthShell>
  if(!busy&&!app.auth.registration.open)return <AuthShell title="Yangi biznes yaratish" subtitle="Ro‘yxat vaqtincha yopiq." top={<AuthTabs active="register"/>}>
    <div className="inline-note warning" role="alert"><Icon name="info"/><span>{REGISTRATION_CLOSED}</span></div>
    <Link className="primary-glass-btn auth-submit" to="/login"><Icon name="arrow-right" size={16}/>Kirish sahifasiga o‘tish</Link>
  </AuthShell>
  const set=(field:RegistrationField)=>(value:string)=>{setForm(f=>({...f,[field]:value}));setErrors({})}
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    const problem=registrationProblem(app.auth.policy,form)
    if(problem){setErrors({[problem.field]:problem.message});focusField(`register-${problem.field}`);return}
    if(!owner){setErrors({form:'Faol xodim topilmadi'});return}
    setBusy(true);setErrors({})
    try{
      const r=await app.setupSuperAdmin({employeeId:owner.id,name:form.name,company:form.company,phone:form.phone.trim(),username:form.username.trim(),email:form.email.trim()||undefined,password:form.password})
      if(r.ok&&r.recoveryKey)setIssued(r.recoveryKey)
      else setErrors({form:r.message})
    }finally{setBusy(false)}
  }
  return <AuthShell title="Yangi biznes yaratish" subtitle={`Yangi, alohida kompaniya oching: birinchi akkaunt Biznes egasi bo‘ladi. ${app.auth.registration.trialDays} kunlik demo sinov avtomatik boshlanadi; to‘lov olinmaydi.`} top={<AuthTabs active="register"/>}>
    <form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Ism-familiya" required error={errors.name} hint="Yangi kompaniyada Biznes egasi profili ochiladi"><Input id="register-name" value={form.name} onChange={e=>set('name')(e.target.value)} autoComplete="name"/></Field>
      <Field label="Kompaniya" required error={errors.company}><Input id="register-company" value={form.company} onChange={e=>set('company')(e.target.value)} autoComplete="organization"/></Field>
      <Field label="Telefon raqami" required error={errors.phone} hint="Kirish uchun ham ishlatiladi"><Input id="register-phone" type="tel" inputMode="tel" value={form.phone} placeholder="+998 90 123 45 67" onChange={e=>set('phone')(e.target.value)} autoComplete="tel"/></Field>
      <Field label="Login" required error={errors.username} hint="3–32 lotin harf, raqam, nuqta yoki chiziqcha"><Input id="register-username" value={form.username} placeholder="masalan, aziz.karimov" onChange={e=>set('username')(e.target.value)} autoComplete="username" spellCheck={false}/></Field>
      <Field label="E-pochta" error={errors.email} hint="Ixtiyoriy"><Input id="register-email" type="email" value={form.email} onChange={e=>set('email')(e.target.value)} autoComplete="email"/></Field>
      <PasswordField id="register-password" label="Parol" value={form.password} onChange={set('password')} autoComplete="new-password" error={errors.password} hint={passwordHint(app.auth.policy)}/>
      <PasswordField id="register-confirm" label="Parolni takrorlang" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" error={errors.confirm}/>
      <p className="soft-meta auth-help"><Icon name="users" size={13}/>Rol tanlanmaydi: bu akkaunt doim Biznes egasi. Xodimlarni keyin Admin panelda qo‘shib, rol va filial berasiz.</p>
      {errors.form&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{errors.form}</span></div>}
      <button type="submit" className="primary-glass-btn auth-submit" disabled={busy}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Yaratilmoqda…</>:<><Icon name="shield" size={16}/>Kompaniyani ro‘yxatdan o‘tkazish</>}</button>
    </form>
  </AuthShell>
}

/** A password forgotten without an administrator: the recovery key, or a ticket signed with the owner's private key. */
export function ForgotPasswordPage(){
  const app=useApp(),navigate=useNavigate()
  const [mode,setMode]=useState('key'),[login,setLogin]=useState(''),[key,setKey]=useState(''),[ticket,setTicket]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('')
  const [errors,setErrors]=useState<{login?:string;key?:string;ticket?:string;password?:string;confirm?:string;form?:string}>({}),[busy,setBusy]=useState(false),[issued,setIssued]=useState('')
  // A new one per visit: a ticket made for an earlier visit, or for someone else's, is worthless here.
  const [code]=useState(()=>randomSalt(8))
  const command=`node scripts/auth-recovery.mjs ticket --login "${normalizeLogin(login)||'LOGIN'}" --code ${code}`
  if(issued)return <IssuedKeyScreen value={issued} onDone={()=>navigate('/login',{replace:true,state:{notice:'Parol yangilandi — yangi parol bilan kiring.'}})}/>
  if(app.auth.signedIn)return <Navigate to="/" replace/>
  if(app.auth.needsSetup)return <Navigate to="/register" replace/>
  const change=(setter:(v:string)=>void)=>(v:string)=>{setter(v);setErrors({})}
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    const weak=validatePassword(app.auth.policy,password)
    const missing=!login.trim()?{login:'Telefon, login yoki e-pochtani kiriting'}:mode==='key'&&!key.trim()?{key:'Tiklash kalitini kiriting'}:mode==='owner'&&!ticket.trim()?{ticket:'Chiptani kiriting'}:weak?{password:weak}:password!==confirm?{confirm:'Parollar mos emas'}:null
    if(missing){setErrors(missing);focusField(`forgot-${Object.keys(missing)[0]}`);return}
    setBusy(true);setErrors({})
    try{
      const r=mode==='key'?await app.recoverWithKey(login,key,password):await app.recoverWithTicket(login,ticket,code,password)
      if(r.ok&&r.recoveryKey)setIssued(r.recoveryKey)
      else setErrors({form:r.message})
    }finally{setBusy(false)}
  }
  return <AuthShell title="Parolni tiklash" subtitle="Parol xesh ko‘rinishida saqlanadi: uni ochib bo‘lmaydi, faqat yangisini o‘rnatish mumkin." footer={<Link className="ghost-btn auth-logout" to="/login"><Icon name="arrow-left" size={15}/>Kirish sahifasiga qaytish</Link>}>
    <div className="inline-note" role="status"><Icon name="info"/><span>Xodim bo‘lsangiz, administratorga murojaat qiling: u Admin Panel → Foydalanuvchilar’da vaqtinchalik parol beradi.</span></div>
    <Segmented ariaLabel="Tiklash usuli" value={mode} onChange={v=>{setMode(v);setErrors({})}} items={[{value:'key',label:'Tiklash kaliti'},{value:'owner',label:'Kalitim yo‘q'}]}/>
    {mode==='owner'&&!app.auth.ownerRecovery?<div className="inline-note warning" role="status"><Icon name="lock"/><span>Bu versiyada egasi tiklashi sozlanmagan, shuning uchun bu yerda parolni almashtirib bo‘lmaydi. Sozlash: docs/AUTH.md → Parolni tiklash.</span></div>
    :<form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Telefon, login yoki e-pochta" required error={errors.login}><Input id="forgot-login" value={login} onChange={e=>change(setLogin)(e.target.value)} autoComplete="username" spellCheck={false} autoFocus/></Field>
      {mode==='owner'&&<>
        <p className="auth-text">Faqat kompaniya egasi uchun: chiptani brauzerdan tashqarida saqlanadigan maxfiy kalit imzolaydi. Loyiha papkasida shu buyruqni bajaring:</p>
        <div className="auth-code"><code>{command}</code><CopyButton text={command} label="Buyruqni nusxalash"/></div>
        <Field label="Imzolangan chipta" required error={errors.ticket} hint="Shu sahifa ochiq turganda, 15 daqiqa ichida"><Input id="forgot-ticket" value={ticket} onChange={e=>change(setTicket)(e.target.value)} autoComplete="off" spellCheck={false}/></Field>
      </>}
      {mode==='key'&&<Field label="Tiklash kaliti" required error={errors.key} hint="Ro‘yxatdan o‘tganda berilgan: XXXXX-XXXXX-XXXXX-XXXXX"><Input id="forgot-key" value={key} onChange={e=>change(setKey)(e.target.value)} autoComplete="off" spellCheck={false}/></Field>}
      <PasswordField id="forgot-password" label="Yangi parol" value={password} onChange={change(setPassword)} autoComplete="new-password" error={errors.password} hint={passwordHint(app.auth.policy)}/>
      <PasswordField id="forgot-confirm" label="Yangi parolni takrorlang" value={confirm} onChange={change(setConfirm)} autoComplete="new-password" error={errors.confirm}/>
      {errors.form&&<div className="inline-note danger" role="alert"><Icon name="warning"/><span>{errors.form}</span></div>}
      <button type="submit" className="primary-glass-btn auth-submit" disabled={busy}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Saqlanmoqda…</>:<><Icon name="key" size={16}/>Parolni tiklash</>}</button>
    </form>}
  </AuthShell>
}

function CopyButton({text,label}:{text:string;label:string}){
  const [copied,setCopied]=useState(false)
  const copy=async()=>{try{await navigator.clipboard.writeText(text);setCopied(true)}catch{setCopied(false)}}
  return <button type="button" className="secondary-glass-btn" onClick={copy}><Icon name={copied?'check':'file'} size={15}/>{copied?'Nusxalandi':label}</button>
}

/** The key is shown here once: only its hash is stored. The user confirms saving it before moving on. */
function KeyBlock({value,onDone,doneLabel}:{value:string;onDone:()=>void;doneLabel:string}){
  const [saved,setSaved]=useState(false)
  return <div className="form-stack">
    <div className="auth-code auth-key"><code>{value}</code></div>
    <div className="auth-actions"><CopyButton text={value} label="Nusxalash"/><button type="button" className="secondary-glass-btn" onClick={()=>downloadText(`zenix-tiklash-kaliti-${todayISO()}.txt`,`ZENIX tiklash kaliti: ${value}\n`,'text/plain')}><Icon name="download" size={15}/>Yuklab olish</button></div>
    <Checkbox checked={saved} onChange={setSaved} label="Kalitni xavfsiz joyga saqladim"/>
    <button type="button" className="primary-glass-btn auth-submit" disabled={!saved} onClick={onDone}><Icon name="arrow-right" size={16}/>{doneLabel}</button>
  </div>
}

function IssuedKeyScreen({value,onDone}:{value:string;onDone:()=>void}){
  return <AuthShell title="Tiklash kalitini saqlang" subtitle="Parol unutilsa, shu kalit bilan yangisini o‘rnatasiz. U faqat hozir ko‘rsatiladi va bir marta ishlaydi.">
    <KeyBlock value={value} onDone={onDone} doneLabel="Davom etish"/>
  </AuthShell>
}

/** Profile menu of a Super Admin: makes the key that accounts from before registration do not have yet. */
export function RecoveryKeyForm({onDone}:{onDone:()=>void}){
  const app=useApp()
  const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[issued,setIssued]=useState('')
  if(issued)return <KeyBlock value={issued} onDone={onDone} doneLabel="Yopish"/>
  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    if(busy)return
    setBusy(true);setError('')
    try{const r=await app.createRecoveryKey(password);if(r.ok&&r.recoveryKey)setIssued(r.recoveryKey);else setError(r.message)}finally{setBusy(false)}
  }
  return <form className="form-stack" onSubmit={submit} noValidate aria-busy={busy}>
    <p className="auth-text">{app.auth.account?.recovery?'Kalit mavjud. Yangisi eskisini bekor qiladi.':'Kalit hali yaratilmagan. U parol unutilganda kirishni tiklaydi.'}</p>
    <PasswordField id="key-current" label="Joriy parol" value={password} onChange={v=>{setPassword(v);setError('')}} autoComplete="current-password" autoFocus error={error}/>
    <button type="submit" className="primary-glass-btn auth-submit" disabled={busy}>{busy?<><span className="btn-spinner" aria-hidden="true"/>Yaratilmoqda…</>:<><Icon name="shield" size={16}/>Kalit yaratish</>}</button>
  </form>
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
