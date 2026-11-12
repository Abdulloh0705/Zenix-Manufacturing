import {useEffect,useMemo,useRef,useState} from 'react'
import type {CSSProperties,ReactNode,RefObject} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {APPEARANCE_PAIRS,pairFor} from '../../app/theme/themeRegistry'
import {Icon,Modal,Popover,Segmented,Select} from '../../shared/ui'
import {DENSITIES,DENSITY_LABEL} from '../../app/theme/preferences'
import type {Density,FontSize} from '../../app/theme/preferences'
import {useMediaQuery} from '../../shared/lib/useMediaQuery'
import type {CurrencyCode,ThemeMode} from '../../types'
import {CURRENCIES,cls,initials,num,relativeTime} from '../../utils/format'
import {isOwnerRole} from '../../domain/access'
import {ChangePasswordForm,RecoveryKeyForm} from '../../features/auth/pages/AuthPages'
import {buildSearchIndex,searchRecords} from './searchIndex'
import type {SearchResult} from './searchIndex'
import {fallbackPath,isReadBy,unreadCount,visibleNotifications} from './notificationsView'

type Result=SearchResult

function GlobalSearch({variant,onDone,autoFocus}:{variant:'inline'|'palette';onDone?:()=>void;autoFocus?:boolean}){
  const app=useApp(),navigate=useNavigate()
  const [query,setQuery]=useState(''),[active,setActive]=useState(0),[open,setOpen]=useState(false)
  const anchor=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null)
  const appState=app.state,appCan=app.can
  const index=useMemo(()=>buildSearchIndex(appState,m=>appCan(m)),[appState,appCan])
  const results=useMemo(()=>searchRecords(index,query),[index,query])
  useEffect(()=>setActive(0),[query])
  useEffect(()=>{if(variant!=='inline')return;const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&window.innerWidth>760){e.preventDefault();e.stopImmediatePropagation();input.current?.focus();setOpen(true)}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[variant])
  const choose=(r?:Result)=>{if(!r)return;navigate(r.path);setOpen(false);setQuery('');input.current?.blur();onDone?.()}
  const list=<SearchResults query={query} results={results} active={active} onActive={setActive} onChoose={choose}/>
  const box=<div className="search-box" ref={anchor}>
    <Icon name="search" size={16}/>
    <input ref={input} type="search" value={query} autoFocus={autoFocus} role="combobox" aria-expanded={variant==='palette'||open} aria-controls="global-search-results" aria-autocomplete="list" aria-activedescendant={results[active]?`gs-${active}`:undefined}
      onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true)}}
      onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(results.length-1,i+1))}else if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1))}else if(e.key==='Enter'){e.preventDefault();choose(results[active])}}}
      placeholder="MO, mahsulot, material, lot, serial, PO..." aria-label="Global qidiruv"/>
    {variant==='inline'&&<kbd>Ctrl K</kbd>}
  </div>
  if(variant==='palette')return <div className="command-palette">{box}{list}</div>
  return <div className="search-wrap">{box}<Popover open={open} onClose={()=>setOpen(false)} anchorRef={anchor} placement="bottom-start" matchWidth minWidth={380} className="search-popover" role="presentation" autoFocus={false}>{list}</Popover></div>
}

function SearchResults({query,results,active,onActive,onChoose}:{query:string;results:Result[];active:number;onActive:(i:number)=>void;onChoose:(r:Result)=>void}){
  if(!query.trim())return <div className="search-hint"><b>Qidirish</b><span>MO, mahsulot, BOM, material, lot/serial, PO/SO, supplier, uskuna, xodim</span><small>↑ ↓ tanlash · Enter ochish · Esc yopish</small></div>
  if(!results.length)return <div className="search-hint"><b>Natija topilmadi</b><span>“{query}” bo‘yicha yozuv yo‘q</span></div>
  let last=''
  return <div className="search-results" role="listbox" id="global-search-results" aria-label="Qidiruv natijalari">{results.map((r,i)=>{
    const heading=r.type!==last;last=r.type
    return <div key={`${r.path}-${i}`} role="presentation">{heading&&<span className="search-group-label" role="presentation">{r.type}</span>}
      {/* Options are chosen through the combobox input (aria-activedescendant); only pointer users click them. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
      <div role="option" id={`gs-${i}`} aria-selected={active===i} className={cls('search-result',active===i&&'active')} onPointerMove={()=>active!==i&&onActive(i)} onPointerDown={e=>e.preventDefault()} onClick={()=>onChoose(r)}>
        <span className="result-icon"><Icon name={r.icon} size={15}/></span><span className="result-copy"><b>{r.title}</b><small>{r.subtitle}</small></span><Icon name="chevron" size={13}/>
      </div></div>
  })}</div>
}

function ContextMenu(){
  const app=useApp(),s=app.state
  const warehouses=s.warehouses.filter(w=>w.branchId===s.settings.defaultBranchId),lines=s.productionLines.filter(l=>l.branchId===s.settings.defaultBranchId)
  return <div className="context-menu">
    <span className="eyebrow">Ish konteksti · defaultlar</span>
    <label className="context-field"><span>Filial</span><Select ariaLabel="Filial" value={s.settings.defaultBranchId} onChange={branchId=>{const w=s.warehouses.find(x=>x.branchId===branchId),l=s.productionLines.find(x=>x.branchId===branchId);app.saveSettings({defaultBranchId:branchId,defaultWarehouseId:w?.id||'',defaultLineId:l?.id||''})}}>{s.branches.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
    <label className="context-field"><span>Ombor</span><Select ariaLabel="Ombor" value={s.settings.defaultWarehouseId} onChange={defaultWarehouseId=>app.saveSettings({defaultWarehouseId})}>{warehouses.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
    <label className="context-field"><span>Liniya</span><Select ariaLabel="Liniya" value={s.settings.defaultLineId} onChange={defaultLineId=>app.saveSettings({defaultLineId})}>{lines.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
  </div>
}

const THEMES:Array<{value:ThemeMode;label:string;icon:string}>=[{value:'light',label:'Light',icon:'sun'},{value:'dark',label:'Dark',icon:'moon'},{value:'system',label:'System',icon:'monitor'}]
const CURRENCY_ORDER:CurrencyCode[]=['UZS','USD','RUB']

function ThemeOptions({onPick}:{onPick?:()=>void}){
  const app=useApp()
  return <div className="option-list" role="radiogroup" aria-label="Theme">{THEMES.map(t=><button type="button" role="radio" aria-checked={app.state.settings.theme===t.value} key={t.value} className={cls('option-row',app.state.settings.theme===t.value&&'active')} onClick={()=>{app.setTheme(t.value);onPick?.()}}>
    <Icon name={t.icon} size={16}/><span><b>{t.label}</b>{t.value==='system'&&<small>Hozir: {app.resolvedTheme==='dark'?'Dark':'Light'}</small>}</span>{app.state.settings.theme===t.value&&<Icon name="check" size={15}/>}
  </button>)}</div>
}
/** Background family picker — shared by the topbar menu and Settings → Ko‘rinish. */
export function BackgroundOptions({onPick,className=''}:{onPick?:()=>void;className?:string}){
  const app=useApp()
  return <div className={cls('swatch-grid',className)} role="radiogroup" aria-label="Fon">{APPEARANCE_PAIRS.map(p=>{
    const item=pairFor(p.id,app.resolvedTheme),active=app.state.settings.appearance===p.id
    return <button type="button" role="radio" aria-checked={active} key={p.id} className={cls('swatch',active&&'active')} onClick={()=>{app.setAppearance(p.id);onPick?.()}}>
      <span className={`swatch-preview bg-${item.id}`} style={{'--sw':item.accent} as CSSProperties}><i style={{background:item.accent}}/></span><span>{item.name}</span>{active&&<Icon name="check" size={13}/>}
    </button>})}</div>
}
/** UI density, table density and font size — real app-wide preferences (tokens on <html>). */
export function DensityOptions(){
  const app=useApp(),s=app.state.settings
  const items=DENSITIES.map(d=>({value:d,label:DENSITY_LABEL[d]}))
  return <div className="density-options">
    <div><span className="option-label">Interfeys zichligi</span><Segmented ariaLabel="Interfeys zichligi" items={items} value={s.uiDensity} onChange={v=>app.setPreferences({uiDensity:v as Density})}/></div>
    <div><span className="option-label">Jadval zichligi</span><Segmented ariaLabel="Jadval zichligi" items={items} value={s.tableDensity} onChange={v=>app.setPreferences({tableDensity:v as Density})}/></div>
    <div><span className="option-label">Shrift o‘lchami</span><Segmented ariaLabel="Shrift o‘lchami" items={[{value:'small',label:'Kichik'},{value:'standard',label:'Standart'},{value:'large',label:'Katta'}]} value={s.fontSize} onChange={v=>app.setPreferences({fontSize:v as FontSize})}/></div>
  </div>
}
/** Display currency only — stored amounts stay in so‘m; every money value re-renders converted. */
export function CurrencyOptions({onPick}:{onPick?:()=>void}){
  const app=useApp(),current=app.state.settings.currency||'UZS'
  return <div className="option-list" role="radiogroup" aria-label="Valyuta">{CURRENCY_ORDER.map(code=>{const c=CURRENCIES[code];return <button type="button" role="radio" aria-checked={current===code} key={code} className={cls('option-row',current===code&&'active')} onClick={()=>{app.setCurrency(code);onPick?.()}}>
    <span className="currency-code">{c.symbol}</span><span><b>{code}</b><small>{code==='UZS'?`${c.label} · asosiy`:`${c.label} · 1 ${c.symbol} = ${num(c.rate)} so‘m`}</small></span>{current===code&&<Icon name="check" size={15}/>}
  </button>})}</div>
}

function useFullscreen(){
  const supported=typeof document!=='undefined'&&Boolean(document.documentElement.requestFullscreen)
  const [on,setOn]=useState(()=>Boolean(document.fullscreenElement))
  useEffect(()=>{const fn=()=>setOn(Boolean(document.fullscreenElement));document.addEventListener('fullscreenchange',fn);return()=>document.removeEventListener('fullscreenchange',fn)},[])
  const toggle=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>undefined)}
  return {supported,on,toggle}
}

function UtilityButton({label,icon,children,open,onToggle,anchorRef,swatch,showLabel,width=280,value}:{label:string;icon:string;children:ReactNode;open:boolean;onToggle:(v:boolean)=>void;anchorRef:RefObject<HTMLButtonElement|null>;swatch?:string;showLabel:boolean;width?:number;value?:string}){
  return <>
    <button ref={anchorRef} type="button" className={cls('utility-btn',open&&'open')} onClick={()=>onToggle(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={value?`${label}: ${value}`:label} title={showLabel?undefined:label}>
      {value?<span className="utility-value">{value}</span>:swatch?<i className="utility-swatch" style={{background:swatch}}/>:<Icon name={icon} size={16}/>}{showLabel&&!value&&<span>{label}</span>}
    </button>
    <Popover open={open} onClose={()=>onToggle(false)} anchorRef={anchorRef} placement="bottom-end" minWidth={width} className="utility-popover" ariaLabel={label}><span className="eyebrow">{label}</span>{children}</Popover>
  </>
}

function DisplayControls(){
  const app=useApp()
  const [menu,setMenu]=useState<string|null>(null)
  const themeRef=useRef<HTMLButtonElement>(null),bgRef=useRef<HTMLButtonElement>(null),currencyRef=useRef<HTMLButtonElement>(null),allRef=useRef<HTMLButtonElement>(null)
  const fs=useFullscreen()
  const collapsed=useMediaQuery('(max-width: 760px)')
  const labels=useMediaQuery('(min-width: 1280px)')
  const toggle=(key:string)=>(v:boolean)=>setMenu(v?key:null)
  const accent=pairFor(app.state.settings.appearance,app.resolvedTheme).accent
  const themeIcon=app.state.settings.theme==='system'?'monitor':app.resolvedTheme==='dark'?'moon':'sun'
  if(collapsed)return <div className="utility-group">
    <UtilityButton label="Ko‘rinish" icon="palette" open={menu==='all'} onToggle={toggle('all')} anchorRef={allRef} showLabel={false} width={300}>
      <div className="utility-section"><h4>Theme</h4><ThemeOptions/></div>
      <div className="utility-section"><h4>Fon</h4><BackgroundOptions/></div>
      <div className="utility-section"><h4>Valyuta</h4><CurrencyOptions/></div>
      <div className="utility-section"><h4>Zichlik va shrift</h4><DensityOptions/></div>
      {fs.supported&&<button type="button" className="option-row" onClick={fs.toggle}><Icon name={fs.on?'minimize':'maximize'} size={16}/><span><b>{fs.on?'Fullscreen’dan chiqish':'Fullscreen'}</b></span></button>}
    </UtilityButton>
  </div>
  return <div className="utility-group" role="group" aria-label="Ko‘rinish sozlamalari">
    <UtilityButton label="Theme" icon={themeIcon} open={menu==='theme'} onToggle={toggle('theme')} anchorRef={themeRef} showLabel={labels} width={250}><ThemeOptions onPick={()=>setMenu(null)}/></UtilityButton>
    <UtilityButton label="Fon" icon="palette" swatch={accent} open={menu==='bg'} onToggle={toggle('bg')} anchorRef={bgRef} showLabel={labels} width={320}><BackgroundOptions/></UtilityButton>
    <UtilityButton label="Valyuta" icon="wallet" value={app.state.settings.currency||'UZS'} open={menu==='currency'} onToggle={toggle('currency')} anchorRef={currencyRef} showLabel={labels} width={260}><CurrencyOptions onPick={()=>setMenu(null)}/></UtilityButton>
    {fs.supported&&<button type="button" className={cls('utility-btn',fs.on&&'open')} onClick={fs.toggle} aria-pressed={fs.on} aria-label={fs.on?'Fullscreen’dan chiqish':'Fullscreen'} title={fs.on?'Fullscreen’dan chiqish':'Fullscreen'}><Icon name={fs.on?'minimize':'maximize'} size={16}/></button>}
  </div>
}

function Notifications(){
  const app=useApp(),navigate=useNavigate(),anchor=useRef<HTMLButtonElement>(null)
  // Only modules this user may open and categories kept on in Settings; read state per user (A-L1 / A-M5).
  const me=app.currentEmployee.id
  const visible=visibleNotifications(app.state.notifications,m=>app.can(m),app.state.settings.notifications)
  const isRead=(n:typeof visible[number])=>isReadBy(n,me)
  const unread=unreadCount(visible,me)
  const fallback=fallbackPath
  return <>
    <button ref={anchor} type="button" className={cls('utility-btn icon-only',app.notifOpen&&'open')} onClick={()=>app.setNotifOpen(!app.notifOpen)} aria-label={`Bildirishnomalar${unread?`, ${unread} ta o‘qilmagan`:''}`} aria-expanded={app.notifOpen} aria-haspopup="dialog">
      <Icon name="bell" size={16}/>{unread>0&&<span className="count-badge">{unread>9?'9+':unread}</span>}
    </button>
    <Popover open={app.notifOpen} onClose={()=>app.setNotifOpen(false)} anchorRef={anchor} placement="bottom-end" minWidth={300} className="notification-menu" ariaLabel="Bildirishnomalar">
      <div className="notification-head"><div><b>Bildirishnomalar</b>{unread>0&&<small>{unread} yangi</small>}</div><button type="button" className="ghost-btn compact" disabled={!unread} onClick={app.markAllRead}><Icon name="check" size={14}/>Barchasi o‘qildi</button></div>
      {visible.length?<div className="notification-list">{visible.slice(0,25).map(n=><button type="button" key={n.id} className={cls('notification-item',!isRead(n)&&'unread')} onClick={()=>{app.markNotificationRead(n.id);navigate(n.path||fallback(n.type));app.setNotifOpen(false)}}>
        <i className={`notice ${n.severity}`} aria-hidden="true"/><span><span className="notification-row"><b>{n.title}</b><em>{relativeTime(n.date)}</em></span><small>{n.text}</small></span>{!isRead(n)&&<span className="sr-only">o‘qilmagan</span>}
      </button>)}</div>:<div className="notification-empty"><Icon name="bell" size={18}/><b>Bildirishnoma yo‘q</b><span>Yangi hodisalar shu yerda ko‘rinadi</span></div>}
      {app.can('employees')&&<button type="button" className="notification-footer" onClick={()=>{navigate('/employees?view=activity');app.setNotifOpen(false)}}>Faoliyat jurnali <Icon name="arrow-right" size={14}/></button>}
    </Popover>
  </>
}

function Profile(){
  const app=useApp(),navigate=useNavigate(),anchor=useRef<HTMLButtonElement>(null)
  const [open,setOpen]=useState(false),[password,setPassword]=useState(false),[recoveryKey,setRecoveryKey]=useState(false)
  const go=(to:string)=>{navigate(to);setOpen(false)}
  const e=app.currentEmployee
  const adminPanel=['users','roles','audit','settings'].some(m=>app.can(m))
  return <>
    <button ref={anchor} type="button" className={cls('profile',open&&'open')} onClick={()=>setOpen(v=>!v)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Profil: ${e.name}`}>
      <span className="avatar" aria-hidden="true">{initials(e.name)}</span><span className="profile-copy"><b>{e.name.split(' ')[0]}</b><small>{app.currentRole.name}</small></span><Icon name="chevron-down" size={13}/>
    </button>
    <Popover open={open} onClose={()=>setOpen(false)} anchorRef={anchor} placement="bottom-end" minWidth={290} className="profile-popover" ariaLabel="Profil">
      <div className="profile-card"><span className="avatar lg">{initials(e.name)}</span><div><b>{e.name}</b><small>{app.currentRole.name} · {app.auth.account?.username}</small></div></div>
      <div className="menu-section links">
        {adminPanel&&<button type="button" className="option-row" onClick={()=>go('/admin')}><Icon name="shield" size={16}/><span><b>Admin Panel</b></span></button>}
        {app.can('roles')&&<button type="button" className="option-row" onClick={()=>go('/admin?view=roles')}><Icon name="lock" size={16}/><span><b>Rollar va ruxsatlar</b></span></button>}
        {app.can('settings')&&<button type="button" className="option-row" onClick={()=>go('/settings?view=appearance')}><Icon name="palette" size={16}/><span><b>Ko‘rinish sozlamalari</b></span></button>}
        {app.can('settings')&&<button type="button" className="option-row" onClick={()=>go('/settings?view=system')}><Icon name="database" size={16}/><span><b>Tizim va backup</b></span></button>}
      </div>
      <div className="menu-section links">
        <button type="button" className="option-row" onClick={()=>{setPassword(true);setOpen(false)}}><Icon name="key" size={16}/><span><b>Parolni o‘zgartirish</b></span></button>
        {isOwnerRole(app.currentRole)&&<button type="button" className="option-row" onClick={()=>{setRecoveryKey(true);setOpen(false)}}><Icon name="shield" size={16}/><span><b>Tiklash kaliti</b></span></button>}
        <button type="button" className="option-row danger" onClick={()=>{setOpen(false);app.logout()}}><Icon name="logout" size={16}/><span><b>Chiqish</b></span></button>
      </div>
    </Popover>
    <Modal open={password} onClose={()=>setPassword(false)} title="Parolni o‘zgartirish" size="sm"><ChangePasswordForm onDone={()=>setPassword(false)}/></Modal>
    <Modal open={recoveryKey} onClose={()=>setRecoveryKey(false)} title="Tiklash kaliti" size="sm"><RecoveryKeyForm onDone={()=>setRecoveryKey(false)}/></Modal>
  </>
}

export function Topbar(){
  const app=useApp()
  const navigate=useNavigate()
  const contextRef=useRef<HTMLButtonElement>(null)
  const [contextOpen,setContextOpen]=useState(false),[paletteOpen,setPaletteOpen]=useState(false)
  const compactSearch=useMediaQuery('(max-width: 760px)')
  const s=app.state
  const branch=s.branches.find(x=>x.id===s.settings.defaultBranchId),warehouse=s.warehouses.find(x=>x.id===s.settings.defaultWarehouseId),line=s.productionLines.find(x=>x.id===s.settings.defaultLineId)
  const {searchOpen,setSearchOpen}=app
  const [targetTenant,setTargetTenant]=useState('')
  const chooseTenant=()=>{
    if(!targetTenant||targetTenant===app.saas.tenant?.id)return
    const company=app.saas.availableTenants.find(t=>t.id===targetTenant)
    if(!company||!window.confirm(`${company.name} kompaniyasiga o‘tasizmi? Ochiq shakllardagi saqlanmagan ma’lumotlar yopiladi.`))return
    const result=app.switchTenant(targetTenant)
    if(result.ok){setTargetTenant('');navigate('/')}
    else app.toast(result.message,'danger')
  }
  useEffect(()=>{if(searchOpen){setPaletteOpen(true);setSearchOpen(false)}},[searchOpen,setSearchOpen])
  return <header className="topbar">
    <button type="button" className="icon-ghost mobile-menu" onClick={()=>app.setSidebarMobile(true)} aria-label="Menyuni ochish" aria-controls="app-sidebar" aria-expanded={app.sidebarMobile}><Icon name="menu"/></button>
    {compactSearch?<button type="button" className="utility-btn icon-only" onClick={()=>setPaletteOpen(true)} aria-label="Qidirish"><Icon name="search" size={16}/></button>:<GlobalSearch variant="inline"/>}
    {app.saas.availableTenants.length>1?<div className="tenant-switch"><Select ariaLabel="Kompaniya tanlash" value={targetTenant||app.saas.tenant?.id||''} onChange={setTargetTenant}>{app.saas.availableTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select><button type="button" className="utility-btn" disabled={!targetTenant||targetTenant===app.saas.tenant?.id} onClick={chooseTenant}>O‘tish</button></div>:<span className="context-copy" aria-label="Faol kompaniya">{app.saas.tenant?.name}</span>}
    <button ref={contextRef} type="button" className={cls('context-chip',contextOpen&&'open')} onClick={()=>setContextOpen(v=>!v)} aria-haspopup="dialog" aria-expanded={contextOpen} aria-label={`Ish konteksti: ${branch?.name}, ${warehouse?.name}, ${line?.name}`}>
      <Icon name="factory" size={16}/><span className="context-copy"><small>Ish konteksti</small><b>{branch?.name}<em> · {warehouse?.name} · {line?.code}</em></b></span><Icon name="chevron-down" size={13}/>
    </button>
    <Popover open={contextOpen} onClose={()=>setContextOpen(false)} anchorRef={contextRef} placement="bottom-end" minWidth={290} className="context-popover" ariaLabel="Ish konteksti"><ContextMenu/></Popover>
    <div className="topbar-tools">
      <DisplayControls/>
      <Notifications/>
      <Profile/>
    </div>
    <Modal open={paletteOpen} onClose={()=>setPaletteOpen(false)} title="Qidirish" size="lg"><GlobalSearch variant="palette" autoFocus onDone={()=>setPaletteOpen(false)}/></Modal>
  </header>
}
