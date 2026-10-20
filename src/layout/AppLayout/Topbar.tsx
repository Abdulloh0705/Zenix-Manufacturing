import {useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode,RefObject} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {APPEARANCE_PAIRS,pairFor} from '../../app/theme/themeRegistry'
import {Icon,Modal,Popover,Select} from '../../shared/ui'
import {useMediaQuery} from '../../shared/lib/useMediaQuery'
import type {CurrencyCode,ManufacturingState,ThemeMode} from '../../types'
import {CURRENCIES,cls,initials,num,relativeTime} from '../../utils/format'
import {ChangePasswordForm} from '../../features/auth/pages/AuthPages'

type Result={type:string;title:string;subtitle:string;path:string;icon:string}

function buildIndex(s:ManufacturingState,can:(m:string)=>boolean):Result[]{
  const name=(id:string)=>s.products.find(p=>p.id===id)?.name||s.rawMaterials.find(m=>m.id===id)?.name||id
  const rows:Result[]=[]
  if(can('production'))rows.push(...s.productionOrders.map(o=>({type:'Ishlab chiqarish buyurtmasi',title:o.code,subtitle:`${name(o.productId)} · ${o.status}`,path:`/production?view=orders&id=${o.id}`,icon:'factory'})))
  if(can('products'))rows.push(...s.products.map(p=>({type:'Mahsulot',title:p.name,subtitle:p.sku,path:`/products?view=all&id=${p.id}`,icon:'box'})),...s.boms.map(b=>({type:'BOM',title:`${b.code} ${b.version}`,subtitle:`${name(b.productId)} · ${b.status}`,path:`/products?view=bom&id=${b.id}`,icon:'layers'})),...s.engineeringChanges.map(e=>({type:'ECO',title:e.code,subtitle:e.title,path:`/products?view=plm&id=${e.id}`,icon:'refresh'})))
  if(can('materials'))rows.push(...s.rawMaterials.map(m=>({type:'Xomashyo',title:m.name,subtitle:m.sku,path:`/materials?view=all&id=${m.id}`,icon:'layers'})))
  if(can('warehouse')||can('reports'))rows.push(...s.lots.map(l=>({type:l.kind==='serial'?'Serial':'Lot',title:l.code,subtitle:`${name(l.itemId)} · ${l.sourceCode}`,path:`/reports?view=traceability&q=${encodeURIComponent(l.kind==='serial'?l.serialFrom||l.code:l.code)}`,icon:'barcode'})))
  if(can('purchases'))rows.push(...s.purchaseOrders.map(p=>({type:'Purchase Order',title:p.code,subtitle:`${s.suppliers.find(x=>x.id===p.supplierId)?.name} · ${p.status}`,path:`/purchases?view=orders&id=${p.id}`,icon:'cart'})),...s.suppliers.map(x=>({type:'Yetkazib beruvchi',title:x.name,subtitle:x.phone,path:`/purchases?view=suppliers&id=${x.id}`,icon:'truck'})))
  if(can('sales'))rows.push(...s.salesOrders.map(o=>({type:'Sales Order',title:o.code,subtitle:`${s.customers.find(c=>c.id===o.customerId)?.name} · ${o.status}`,path:`/sales?view=orders&id=${o.id}`,icon:'truck'})),...s.customers.map(c=>({type:'Mijoz',title:c.name,subtitle:c.phone,path:`/sales?view=customers&id=${c.id}`,icon:'users'})))
  if(can('quality'))rows.push(...s.qualityAlerts.map(a=>({type:'Quality alert',title:a.title,subtitle:a.status,path:`/quality?view=alerts&id=${a.id}`,icon:'shield'})))
  if(can('equipment'))rows.push(...s.equipment.map(e=>({type:'Uskuna',title:e.name,subtitle:`${e.model} · ${e.serial}`,path:`/equipment?view=equipment&id=${e.id}`,icon:'wrench'})),...s.maintenanceOrders.map(m=>({type:'Maintenance',title:m.code,subtitle:`${s.equipment.find(e=>e.id===m.equipmentId)?.name} · ${m.status}`,path:`/equipment?view=maintenance&id=${m.id}`,icon:'wrench'})))
  if(can('employees'))rows.push(...s.employees.map(e=>({type:'Xodim',title:e.name,subtitle:e.department,path:`/employees?view=all&id=${e.id}`,icon:'user'})))
  return rows
}

function GlobalSearch({variant,onDone,autoFocus}:{variant:'inline'|'palette';onDone?:()=>void;autoFocus?:boolean}){
  const app=useApp(),navigate=useNavigate()
  const [query,setQuery]=useState(''),[active,setActive]=useState(0),[open,setOpen]=useState(false)
  const anchor=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null)
  const index=useMemo(()=>buildIndex(app.state,m=>app.can(m)),[app.state,app.can])
  const results=useMemo(()=>{const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return [];return index.filter(r=>{const t=`${r.title} ${r.subtitle} ${r.type}`.toLowerCase();return terms.every(x=>t.includes(x))}).slice(0,20)},[index,query])
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
function BackgroundOptions({onPick}:{onPick?:()=>void}){
  const app=useApp()
  return <div className="swatch-grid" role="radiogroup" aria-label="Fon">{APPEARANCE_PAIRS.map(p=>{
    const item=pairFor(p.id,app.resolvedTheme),active=app.state.settings.appearance===p.id
    return <button type="button" role="radio" aria-checked={active} key={p.id} className={cls('swatch',active&&'active')} onClick={()=>{app.setAppearance(p.id);onPick?.()}}>
      <span className={`swatch-preview bg-${item.id}`}><i style={{background:item.accent}}/></span><span>{item.name}</span>{active&&<Icon name="check" size={13}/>}
    </button>})}</div>
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

/** Module a notification belongs to, from its link (a notification without a link is general). */
const notificationModule=(n:{path?:string;type:string})=>n.path?n.path.split('?')[0].replace(/^\//,'')||'dashboard':n.type.includes('low')?'materials':n.type.includes('quality')?'quality':n.type.includes('maintenance')?'equipment':n.type.includes('sales')?'sales':n.type.includes('purchase')?'purchases':'production'

function Notifications(){
  const app=useApp(),navigate=useNavigate(),anchor=useRef<HTMLButtonElement>(null)
  // Only notifications of modules this user may open, read state per user (A-L1 / A-M5).
  const me=app.currentEmployee.id
  const visible=app.state.notifications.filter(n=>app.can(notificationModule(n)))
  const isRead=(n:typeof visible[number])=>n.readBy?n.readBy.includes(me):n.read
  const unread=visible.filter(n=>!isRead(n)).length
  const fallback=(type:string)=>type.includes('low')?'/materials?view=shortages':type.includes('quality')?'/quality?view=alerts':type.includes('maintenance')?'/equipment?view=maintenance':type.includes('sales')?'/sales?view=orders':type.includes('purchase')?'/purchases?view=orders':'/production?view=orders'
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
  const [open,setOpen]=useState(false),[password,setPassword]=useState(false)
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
        <button type="button" className="option-row danger" onClick={()=>{setOpen(false);app.logout()}}><Icon name="logout" size={16}/><span><b>Chiqish</b></span></button>
      </div>
    </Popover>
    <Modal open={password} onClose={()=>setPassword(false)} title="Parolni o‘zgartirish" size="sm"><ChangePasswordForm onDone={()=>setPassword(false)}/></Modal>
  </>
}

export function Topbar(){
  const app=useApp()
  const contextRef=useRef<HTMLButtonElement>(null)
  const [contextOpen,setContextOpen]=useState(false),[paletteOpen,setPaletteOpen]=useState(false)
  const compactSearch=useMediaQuery('(max-width: 760px)')
  const s=app.state
  const branch=s.branches.find(x=>x.id===s.settings.defaultBranchId),warehouse=s.warehouses.find(x=>x.id===s.settings.defaultWarehouseId),line=s.productionLines.find(x=>x.id===s.settings.defaultLineId)
  useEffect(()=>{if(app.searchOpen){setPaletteOpen(true);app.setSearchOpen(false)}},[app.searchOpen])
  return <header className="topbar">
    <button type="button" className="icon-ghost mobile-menu" onClick={()=>app.setSidebarMobile(true)} aria-label="Menyuni ochish" aria-controls="app-sidebar" aria-expanded={app.sidebarMobile}><Icon name="menu"/></button>
    {compactSearch?<button type="button" className="utility-btn icon-only" onClick={()=>setPaletteOpen(true)} aria-label="Qidirish"><Icon name="search" size={16}/></button>:<GlobalSearch variant="inline"/>}
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
