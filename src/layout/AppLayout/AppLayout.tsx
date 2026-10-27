import {useEffect,useRef,useState} from 'react'
import {Link,Outlet,useLocation,useNavigate} from 'react-router-dom'
import {byPath} from '../../routes/navigation'
import {ExportPermission,Icon} from '../../shared/ui'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {storage} from '../../shared/lib/storage'
import {cls} from '../../utils/format'
import {Sidebar} from './Sidebar'
import {Topbar} from './Topbar'
import {AiAssistant} from './AiAssistant'

const COLLAPSE_KEY='zenix-ui-sidebar-collapsed'

function ModuleSubnav(){
  const location=useLocation(),app=useApp()
  const module=byPath[location.pathname]
  const items=module?.items?.filter(i=>!i.anyOf||i.anyOf.some(m=>app.can(m)))
  const current=new URLSearchParams(location.search).get('view')||module?.defaultView||''
  const ref=useRef<HTMLElement>(null)
  useEffect(()=>{ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'})},[current,location.pathname])
  if(!module||!items?.length)return null
  return <nav ref={ref} className="module-subnav" aria-label={`${module.label} bo‘limlari`}>
    {items.map(i=><Link key={i.key} to={`${module.path}?view=${i.key}`} className={cls('subnav-link',current===i.key&&'active')} aria-current={current===i.key?'page':undefined}>{i.label}</Link>)}
  </nav>
}

/** An unknown or forbidden ?view= opens the module's first allowed view with a notice, instead of a silent default (B3-12). */
function useViewGuard(){
  const location=useLocation(),navigate=useNavigate(),app=useApp()
  const handled=useRef('')
  useEffect(()=>{
    const module=byPath[location.pathname]
    const sp=new URLSearchParams(location.search),view=sp.get('view')
    if(!module?.items?.length||!view)return
    // Effects may run twice for one address (StrictMode); one notice per address is enough.
    const address=location.pathname+location.search
    if(handled.current===address)return
    handled.current=address
    const open=(i:{anyOf?:string[]})=>!i.anyOf||i.anyOf.some(m=>app.can(m))
    const item=module.items.find(i=>i.key===view)
    if(item&&open(item))return
    sp.delete('view')
    const fallback=module.items.find(open)
    if(fallback&&fallback.key!==module.defaultView)sp.set('view',fallback.key)
    navigate({pathname:location.pathname,search:sp.toString()?`?${sp}`:''},{replace:true})
    app.toast(item?`“${item.label}” bo‘limi uchun ruxsatingiz yo‘q`:`“${view}” bo‘limi topilmadi — ${module.label} ochildi`,'warning')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.pathname,location.search])
}

/** Rendered by App for every route, so messages raised on the login and set-up pages are seen too. */
export function Toasts(){
  const app=useApp()
  return <div className="toast-stack" role="region" aria-label="Xabarlar" aria-live="polite">
    {app.toasts.map(t=><div className={`toast toast-${t.tone}`} key={t.id} role={t.tone==='danger'?'alert':'status'}>
      <Icon name={t.tone==='danger'?'warning':t.tone==='warning'?'warning':t.tone==='info'?'info':'check'} size={16}/>
      <span>{t.message}</span>
      <button type="button" className="icon-ghost" onClick={()=>app.dismissToast(t.id)} aria-label="Xabarni yopish"><Icon name="x" size={14}/></button>
    </div>)}
  </div>
}

export default function AppLayout(){
  const app=useApp(),location=useLocation()
  const [collapsed,setCollapsed]=useState(()=>storage.get(COLLAPSE_KEY,false))
  const toggle=()=>setCollapsed(v=>{storage.set(COLLAPSE_KEY,!v);return !v})
  useViewGuard()
  useEffect(()=>{app.setNotifOpen(false);app.setSidebarMobile(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.pathname,location.search])
  useEffect(()=>{window.scrollTo({top:0})},[location.pathname])
  return <div className={cls('app-shell',collapsed&&'is-collapsed')}>
    <a className="skip-link" href="#main">Asosiy kontentga o‘tish</a>
    <Sidebar collapsed={collapsed} onToggleCollapsed={toggle}/>
    <div className="main-area">
      <Topbar/>
      <ModuleSubnav/>
      {app.storageError&&<div className="storage-alert" role="alert"><Icon name="warning" size={16}/><span>Brauzer o‘zgarishlarni saqlamayapti (xotira to‘la yoki bloklangan). Ular faqat shu oynada turibdi — Tizim → Backup eksport qiling.</span></div>}
      <ExportPermission.Provider value={app.can(byPath[location.pathname]?.module||'dashboard','export')}><main id="main" className="content" tabIndex={-1}><Outlet/></main></ExportPermission.Provider>
    </div>
    <AiAssistant/>
  </div>
}
