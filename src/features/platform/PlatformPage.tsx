// ZENIX Platform workspace — the SaaS operator's product area, separate from every tenant workspace.
// Demo-only security: the signed ticket gate and browser storage do not replace server-side authentication,
// authorization and audit (docs/BACKEND_CONTRACT.md). Platform access never grants tenant ERP permissions.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {Link,NavLink,useLocation} from 'react-router-dom'
import * as SaaS from '../../domain/saas'
import * as Auth from '../../domain/auth'
import * as Platform from '../../domain/platform'
import {storage} from '../../shared/lib/storage'
import {verifyRecoveryTicket} from '../../shared/lib/crypto'
import {Card,Empty,Icon} from '../../shared/ui'
import {PlatformContext} from './platformShared'
import type {OwnerInfo,PlatformCtx} from './platformShared'
import {BillingSection,CompaniesSection,OverviewSection,SubscriptionsSection} from './sections/CustomerSections'
import {FeaturesSection,HealthSection,SecuritySection,SettingsSection,SupportSection} from './sections/OperationsSections'

const SAAS_KEY='zenix-saas-v1',AUTH_KEY='zenix-auth-v1',SESSION_KEY='zenix-platform-session-v1'
const PUBLIC_KEY=(import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env?.VITE_PLATFORM_PUBLIC_KEY||''
type PlatformSession={actor:string;ticket:string}
export const platformTicketLive=(ticket:string,now=Date.now())=>{const match=/^ZXR1\.(\d{10,16})\.[A-Za-z0-9_-]+$/.exec(ticket.trim());return Boolean(match&&Number(match[1])>now)}
export const ticketExpiry=(ticket:string)=>Number(/^ZXR1\.(\d{10,16})\./.exec(ticket.trim())?.[1]||0)
export const verifyPlatformAccess=async(actor:string,ticket:string,now=Date.now(),publicKey=PUBLIC_KEY)=>Platform.validActor(actor)&&await verifyRecoveryTicket(publicKey,ticket,expiresAt=>`zenix-platform-v1|${actor}|${expiresAt}`,now)

type SectionDef={path:string;label:string;icon:string;group:string;render:()=>ReactNode}
export const PLATFORM_SECTIONS:SectionDef[]=[
  {path:'',label:'Platforma ko‘rinishi',icon:'dashboard',group:'Umumiy',render:()=><OverviewSection/>},
  {path:'companies',label:'Kompaniyalar',icon:'factory',group:'Mijozlar',render:()=><CompaniesSection/>},
  {path:'subscriptions',label:'Rejalar va obunalar',icon:'layers',group:'Mijozlar',render:()=><SubscriptionsSection/>},
  {path:'billing',label:'Billing',icon:'wallet',group:'Mijozlar',render:()=><BillingSection/>},
  {path:'support',label:'Support markazi',icon:'bell',group:'Operatsiyalar',render:()=><SupportSection/>},
  {path:'features',label:'Funksiyalar boshqaruvi',icon:'target',group:'Operatsiyalar',render:()=><FeaturesSection/>},
  {path:'security',label:'Xavfsizlik va audit',icon:'shield',group:'Boshqaruv',render:()=><SecuritySection/>},
  {path:'settings',label:'Platforma sozlamalari',icon:'settings',group:'Boshqaruv',render:()=><SettingsSection/>},
  {path:'health',label:'Tizim holati',icon:'database',group:'Boshqaruv',render:()=><HealthSection/>},
]

function readSaaS():{store:SaaS.SaaSStore;state:PlatformCtx['saasState']}{
  if(!storage.getRaw(SAAS_KEY))return {store:SaaS.emptySaaSStore(),state:'missing'}
  const store=SaaS.normalizeSaaSStore(storage.get(SAAS_KEY,null))
  return store?{store,state:'ok'}:{store:SaaS.emptySaaSStore(),state:'damaged'}
}
const readPlatform=()=>Platform.normalizePlatformStore(storage.get(Platform.PLATFORM_KEY,null))
function readOwners(){
  const auth=Auth.normalizeAuthStore(storage.get(AUTH_KEY,null))
  // Only display fields leave the auth store: no hashes, salts, recovery data or attempts.
  return new Map<string,OwnerInfo>(auth.accounts.map(a=>[a.id,{username:a.username,email:a.email,status:a.status}]))
}
/** Best-effort session audit; a damaged platform store is never overwritten. */
function logSession(actor:string,action:'session.start'|'session.end'|'session.expired'){
  const current=readPlatform()
  if(current)storage.set(Platform.PLATFORM_KEY,Platform.sessionAudit(current,actor,action,new Date()))
}

export default function PlatformPage({publicKey=PUBLIC_KEY}:{publicKey?:string}){
  const location=useLocation()
  const [actor,setActor]=useState(''),[ticket,setTicket]=useState(''),[session,setSession]=useState<PlatformSession|null>(null)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(()=>Boolean(storageSession()))
  const [saas,setSaas]=useState(readSaaS),[platform,setPlatform]=useState(readPlatform),[owners,setOwners]=useState(readOwners)
  const [now,setNow]=useState(()=>new Date()),[navOpen,setNavOpen]=useState(false)
  const busyRef=useRef(false),sessionRef=useRef<PlatformSession|null>(null)
  sessionRef.current=session
  const refresh=useCallback(()=>{setSaas(readSaaS());setPlatform(readPlatform());setOwners(readOwners())},[])

  useEffect(()=>{
    const saved=storageSession()
    if(saved)void verifyPlatformAccess(saved.actor,saved.ticket,Date.now(),publicKey).then(ok=>{if(ok)setSession(saved);else sessionStorage.removeItem(SESSION_KEY);setChecking(false)})
    const onStorage=(e:StorageEvent)=>{if(e.key===SAAS_KEY||e.key===Platform.PLATFORM_KEY||e.key===AUTH_KEY)refresh()}
    window.addEventListener('storage',onStorage)
    return()=>window.removeEventListener('storage',onStorage)
  },[publicKey,refresh])
  useEffect(()=>{
    if(!session)return
    const tick=()=>{
      if(!platformTicketLive(session.ticket)){logSession(session.actor,'session.expired');sessionStorage.removeItem(SESSION_KEY);setSession(null);setNotice('');setError('Administrator chiptasi muddati tugadi. Platforma ma’lumotlari yashirildi.');return}
      setNow(new Date())
    }
    tick()
    const timer=window.setInterval(tick,1000)
    return()=>window.clearInterval(timer)
  },[session])
  useEffect(()=>{
    if(!navOpen)return
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setNavOpen(false)}
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[navOpen])

  const signIn=async()=>{
    if(!publicKey){setError('Platform ochiq kaliti sozlanmagan');return}
    const id=actor.trim()
    if(!await verifyPlatformAccess(id,ticket,Date.now(),publicKey)){setError('Administrator chiptasi noto‘g‘ri yoki muddati o‘tgan');return}
    const next={actor:id,ticket:ticket.trim()}
    sessionStorage.setItem(SESSION_KEY,JSON.stringify(next));logSession(id,'session.start');refresh()
    setSession(next);setTicket('');setError('');setNotice('')
  }
  const signOut=useCallback((reason?:string)=>{
    const current=sessionRef.current
    if(current)logSession(current.actor,reason?'session.expired':'session.end')
    sessionStorage.removeItem(SESSION_KEY);setSession(null);setNotice('');setError(reason||'')
  },[])
  /** Every write: re-verify the ticket signature, re-read both stores, validate, detect concurrent edits, write both or neither. */
  const run=useCallback<PlatformCtx['run']>(async op=>{
    if(busyRef.current)return false
    busyRef.current=true;setBusy(true)
    try{
      const current=sessionRef.current
      if(!current||!platformTicketLive(current.ticket)||!await verifyPlatformAccess(current.actor,current.ticket,Date.now(),publicKey)){signOut('Administrator chiptasi muddati tugadi yoki imzo tasdiqlanmadi');return false}
      const saasRaw=storage.getRaw(SAAS_KEY),platformRaw=storage.getRaw(Platform.PLATFORM_KEY)
      const stored=readSaaS(),storedPlatform=readPlatform()
      if(stored.state==='damaged'||!storedPlatform){setError('Platforma yoki kompaniya metama’lumoti shikastlangan — o‘zgartirish to‘xtatildi');return false}
      const out=op({saas:stored.store,platform:storedPlatform})
      if(!out.ok){setError(out.error);setNotice('');return false}
      const saasChanged=out.next.saas!==stored.store
      if(saasChanged&&!SaaS.normalizeSaaSStore(out.next.saas)||!Platform.normalizePlatformStore(out.next.platform)){setError('Amal natijasi tekshiruvdan o‘tmadi — hech narsa saqlanmadi');return false}
      if(storage.getRaw(SAAS_KEY)!==saasRaw||storage.getRaw(Platform.PLATFORM_KEY)!==platformRaw){setError('Boshqa oynada ma’lumot yangilandi. Qayta urinib ko‘ring.');refresh();return false}
      if(saasChanged&&!storage.set(SAAS_KEY,out.next.saas)){setError('Brauzer xotirasiga saqlanmadi');return false}
      if(!storage.set(Platform.PLATFORM_KEY,out.next.platform)){
        if(saasChanged){if(saasRaw===null)storage.remove(SAAS_KEY);else storage.setRaw(SAAS_KEY,saasRaw)}
        setError('Audit yozuvi saqlanmadi — amal bekor qilindi');return false
      }
      setSaas(saasChanged?{store:out.next.saas,state:'ok'}:stored);setPlatform(out.next.platform);setError('');setNotice(out.message)
      return true
    }finally{busyRef.current=false;setBusy(false)}
  },[publicKey,refresh,signOut])

  const sectionPath=location.pathname.startsWith('/platform')?location.pathname.replace(/^\/platform\/?/,'').replace(/\/$/,''):''
  const section=PLATFORM_SECTIONS.find(s=>s.path===sectionPath)
  const ctx=useMemo<PlatformCtx|null>(()=>session&&platform?{actor:session.actor,now,busy,saas:saas.store,saasState:saas.state,platform,owners,expiresAt:ticketExpiry(session.ticket),run}:null,[session,now,busy,saas,platform,owners,run])

  if(!session||!platformTicketLive(session.ticket))return <main className="platform-page pf-gate"><div className="platform-shell">
    <div className="auth-brand"><span className="brand-mark"><b>ZX</b></span><div className="brand-copy"><b>ZENIX</b><span>Platform Administration</span></div></div>
    <Card title="Platform administrator kirishi">
      {checking?<p role="status">Sessiya tekshirilmoqda…</p>:<>
        <p>Kompaniya akkauntlari (Biznes egasi, menejer, xodim) bu ish maydoniga kirmaydi. Qisqa muddatli imzolangan chiptani administrator mahalliy provisioning skriptidan oladi.</p>
        {!publicKey?<p className="inline-note warning">VITE_PLATFORM_PUBLIC_KEY sozlanmagan. Demo platforma kirishi hozir o‘chiq.</p>:<form className="form-stack" onSubmit={e=>{e.preventDefault();void signIn()}}>
          <label>Operator ID<input className="ui-input" value={actor} onChange={e=>setActor(e.target.value)} autoComplete="off" spellCheck={false}/></label>
          <label>Imzolangan chipta<input className="ui-input" value={ticket} onChange={e=>setTicket(e.target.value)} autoComplete="off" spellCheck={false}/></label>
          <button type="submit" className="primary-glass-btn">Platformaga kirish</button>
        </form>}
      </>}
      {error&&<p role="alert" className="inline-note danger">{error}</p>}
      <p className="pf-muted">Demo xavfsizlik: chipta brauzerda tekshiriladi. Haqiqiy platforma identifikatori server tomonida berilishi kerak.</p>
      <Link to="/login">Kompaniya kirishiga qaytish</Link>
    </Card>
  </div></main>

  const remaining=Math.max(0,Math.floor(((ctx?.expiresAt||0)-now.getTime())/1000))
  const groups=[...new Set(PLATFORM_SECTIONS.map(s=>s.group))]
  return <main className="platform-page pf">
    <a className="pf-skip" href="#pf-content">Asosiy mazmunga o‘tish</a>
    <aside className={`pf-side ${navOpen?'is-open':''}`} id="pf-nav">
      <div className="pf-brand"><span className="brand-mark"><b>ZX</b></span><div><b>{platform?.settings.brandName||'ZENIX'} Platform</b><span>SaaS boshqaruvi</span></div><button type="button" className="icon-ghost pf-nav-close" aria-label="Menyuni yopish" onClick={()=>setNavOpen(false)}><Icon name="x"/></button></div>
      <nav aria-label="Platforma bo‘limlari">{groups.map(g=><div className="pf-nav-group" key={g}><span className="pf-nav-label">{g}</span>{PLATFORM_SECTIONS.filter(s=>s.group===g).map(s=><NavLink key={s.path} end to={s.path?`/platform/${s.path}`:'/platform'} onClick={()=>setNavOpen(false)} className={`pf-nav-item ${section?.path===s.path?'active':''}`} aria-current={section?.path===s.path?'page':undefined}><Icon name={s.icon} size={17}/><span>{s.label}</span></NavLink>)}</div>)}</nav>
      <p className="pf-side-foot">Platforma operatori kompaniyalarning ishlab chiqarish, ombor, mijoz va moliya yozuvlarini ko‘rmaydi va o‘zgartirmaydi.</p>
    </aside>
    {navOpen&&<button type="button" className="pf-scrim" tabIndex={-1} aria-label="Menyuni yopish" onClick={()=>setNavOpen(false)}/>}
    <div className="pf-main">
      <header className="pf-top">
        <button type="button" className="icon-ghost pf-menu" aria-label="Platforma menyusi" aria-expanded={navOpen} aria-controls="pf-nav" onClick={()=>setNavOpen(v=>!v)}><Icon name="rows"/></button>
        <div className="pf-title"><p className="eyebrow">ZENIX Platform</p><h1>{section?.label||'Bo‘lim topilmadi'}</h1></div>
        <div className="pf-session">
          <span className="pf-chip" title="Platforma operatori"><Icon name="user" size={15}/>{session.actor}</span>
          <span className={`pf-chip ${remaining<300?'warn':''}`} title="Imzolangan chipta qolgan vaqti"><Icon name="clock" size={15}/>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span>
          <Link className="secondary-glass-btn" to="/login">Kompaniya kirishi</Link>
          <button type="button" className="ghost-btn" onClick={()=>signOut()}>Chiqish</button>
        </div>
      </header>
      <p className="pf-demo-note">Demo rejim: ma’lumotlar faqat shu brauzerda. Server statistikasi, to‘lovlar, MRR va API trafik ko‘rsatilmaydi, chunki ular mavjud emas.</p>
      {remaining<300&&<p className="inline-note warning" role="status">Chipta {Math.ceil(remaining/60)} daqiqada tugaydi. Davom etish uchun yangi chipta oling.</p>}
      {error&&<p role="alert" className="inline-note danger">{error}</p>}
      {notice&&<p role="status" className="inline-note success">{notice}</p>}
      <section id="pf-content" className="pf-content" tabIndex={-1} aria-label={section?.label||'Platforma'}>
        {!platform||!ctx?<Card title="Platforma yozuvi shikastlangan"><p>Saqlangan platforma sozlamalari yoki audit tarixi o‘qilmadi. Asl yozuv o‘zgartirilmadi; o‘zgartirishlar to‘xtatilgan.</p></Card>
          :!section?<Empty icon="search" title="Bo‘lim topilmadi" text="Bu manzil platforma bo‘limiga mos kelmaydi." action={<Link className="secondary-glass-btn" to="/platform">Platforma ko‘rinishi</Link>}/>
          :<PlatformContext.Provider value={ctx}>{saas.state==='damaged'&&<p className="inline-note danger" role="alert">Kompaniya metama’lumoti shikastlangan. Kompaniyalar ko‘rsatilmaydi va o‘zgartirilmaydi; asl yozuv saqlanadi.</p>}{section.render()}</PlatformContext.Provider>}
      </section>
    </div>
  </main>
}

function storageSession():PlatformSession|null{
  try{const v=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');return v&&typeof v.actor==='string'&&typeof v.ticket==='string'?v:null}catch{return null}
}
