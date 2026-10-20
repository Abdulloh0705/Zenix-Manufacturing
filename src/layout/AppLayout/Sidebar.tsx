import {useEffect,useRef,useState} from 'react'
import type {RefObject} from 'react'
import {NavLink,useLocation,useNavigate} from 'react-router-dom'
import {moduleNav,byPath,NAV_GROUPS} from '../../routes/navigation'
import type {ModuleNav} from '../../routes/navigation'
import {Icon,Popover,useModalLayer} from '../../shared/ui'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {useMediaQuery} from '../../shared/lib/useMediaQuery'
import {cls} from '../../utils/format'

export function Sidebar({collapsed,onToggleCollapsed}:{collapsed:boolean;onToggleCollapsed:()=>void}){
  const app=useApp(),location=useLocation(),navigate=useNavigate()
  const isMobile=useMediaQuery('(max-width: 1024px)')
  const mobileOpen=isMobile&&app.sidebarMobile
  const closeMobile=()=>app.setSidebarMobile(false)
  const {ref}=useModalLayer(mobileOpen,closeMobile)
  const visible=moduleNav.filter(n=>(n.anyOf||[n.module]).some(m=>app.can(m)))
  const currentPath=location.pathname
  const currentView=new URLSearchParams(location.search).get('view')||byPath[currentPath]?.defaultView||''
  const [expanded,setExpanded]=useState<string|null>(currentPath)
  const [flyout,setFlyout]=useState<string|null>(null)
  const flyAnchor=useRef<HTMLElement|null>(null)
  const [flyoutFocus,setFlyoutFocus]=useState(false)
  const openTimer=useRef<number>(0),closeTimer=useRef<number>(0)
  const isCollapsed=collapsed&&!isMobile

  useEffect(()=>{setExpanded(currentPath);setFlyout(null)},[currentPath])
  useEffect(()=>()=>{window.clearTimeout(openTimer.current);window.clearTimeout(closeTimer.current)},[])

  const scheduleOpen=(path:string,anchor:HTMLElement)=>{
    if(isMobile)return
    window.clearTimeout(closeTimer.current);window.clearTimeout(openTimer.current)
    openTimer.current=window.setTimeout(()=>{flyAnchor.current=anchor;setFlyoutFocus(false);setFlyout(path)},flyout?40:140)
  }
  const scheduleClose=()=>{window.clearTimeout(openTimer.current);closeTimer.current=window.setTimeout(()=>setFlyout(null),220)}
  const keepOpen=()=>window.clearTimeout(closeTimer.current)
  const go=(to:string)=>{navigate(to);setFlyout(null);if(isMobile)closeMobile()}
  const flyItem=flyout?byPath[flyout]:undefined

  return <>
    {mobileOpen&&<div className="nav-backdrop" onClick={closeMobile} aria-hidden="true"/>}
    <aside ref={ref as RefObject<HTMLElement>} tabIndex={-1} id="app-sidebar" inert={isMobile&&!mobileOpen?true:undefined} className={cls('sidebar',isCollapsed&&'is-collapsed',mobileOpen&&'mobile-open')} aria-label="Asosiy navigatsiya">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><b>ZX</b></span>
        {!isCollapsed&&<div className="brand-copy"><b>ZENIX</b><span>Manufacturing</span></div>}
        {isMobile&&<button type="button" className="icon-ghost brand-close" onClick={closeMobile} aria-label="Menyuni yopish"><Icon name="x"/></button>}
      </div>
      <nav className="nav-scroll">
        {NAV_GROUPS.map(group=>{const items=visible.filter(i=>i.group===group.id);if(!items.length)return null;return <div className="nav-group" key={group.id} role="group" aria-label={group.label}>
        {isCollapsed?<span className="nav-group-rule" aria-hidden="true"/>:<span className="nav-group-label" aria-hidden="true">{group.label}</span>}
        <ul className="nav-list">{items.map((item:ModuleNav)=>{
          const active=item.path==='/'?currentPath==='/':currentPath===item.path
          const hasSub=Boolean(item.items?.length)
          const open=isMobile&&expanded===item.path
          return <li key={item.path} className={cls('nav-row',active&&'is-active')}
            onMouseEnter={e=>hasSub||isCollapsed?scheduleOpen(item.path,e.currentTarget):undefined} onMouseLeave={scheduleClose}>
            <div className="nav-line">
              <NavLink to={item.path} end={item.path==='/'} className={({isActive})=>cls('nav-item',isActive&&'active')} title={isCollapsed?item.label:undefined} aria-label={isCollapsed?item.label:undefined} onClick={()=>{setFlyout(null);if(isMobile)closeMobile()}}>
                <span className="nav-icon"><Icon name={item.icon} size={17}/></span>{!isCollapsed&&<span className="nav-label">{item.label}</span>}
              </NavLink>
              {hasSub&&!isCollapsed&&<button type="button" className={cls('nav-expand',(open||flyout===item.path)&&'open')} aria-label={`${item.label}: bo‘limlar`} aria-expanded={isMobile?open:flyout===item.path} aria-controls={isMobile?`sub-${item.module}`:undefined}
                onClick={e=>{if(isMobile){setExpanded(v=>v===item.path?null:item.path);return}const row=e.currentTarget.closest('li') as HTMLElement;flyAnchor.current=row;setFlyoutFocus(true);setFlyout(v=>v===item.path?null:item.path)}}>
                <Icon name="chevron" size={14}/>
              </button>}
            </div>
            {open&&hasSub&&<ul className="nav-sub" id={`sub-${item.module}`}>{item.items!.filter(sub=>!sub.anyOf||sub.anyOf.some(m=>app.can(m))).map(sub=>{
              const subActive=active&&currentView===sub.key
              return <li key={sub.key}><button type="button" className={cls(subActive&&'active')} aria-current={subActive?'page':undefined} onClick={()=>go(`${item.path}?view=${sub.key}`)}>{sub.label}</button></li>
            })}</ul>}
          </li>
        })}</ul></div>})}
      </nav>
      <div className="sidebar-bottom">
        {app.can('ai')&&app.state.settings.ai.enabled&&<button type="button" className={cls('nav-item ai-link',app.aiOpen&&'active')} onClick={()=>{app.setAiOpen(true);if(isMobile)closeMobile()}} title={isCollapsed?'ZENIX AI':undefined} aria-label={isCollapsed?'ZENIX AI':undefined}><span className="nav-icon"><Icon name="spark" size={17}/></span>{!isCollapsed&&<span className="nav-label">ZENIX AI</span>}</button>}
        {!isMobile&&<button type="button" className="nav-item collapse-btn" onClick={onToggleCollapsed} aria-label={collapsed?'Sidebarni yoyish':'Sidebarni yig‘ish'} aria-expanded={!collapsed} aria-controls="app-sidebar" title={collapsed?'Yoyish':undefined}><span className="nav-icon"><Icon name="chevron" size={16} style={{transform:collapsed?'none':'rotate(180deg)'}}/></span>{!isCollapsed&&<span className="nav-label">Yig‘ish</span>}</button>}
      </div>
    </aside>
    {!isMobile&&<Popover key={flyout||'none'} open={!!flyItem} onClose={()=>setFlyout(null)} anchorRef={flyAnchor} placement="right-start" offset={10} minWidth={isCollapsed&&!flyItem?.items?220:264} className="module-flyout" ariaLabel={flyItem?.label} role="menu" autoFocus={flyoutFocus}>
      {flyItem&&<div onMouseEnter={keepOpen} onMouseLeave={scheduleClose}>
        <div className="module-flyout-head"><b>{flyItem.label}</b></div>
        {flyItem.items?<div className="module-flyout-list">{flyItem.items.filter(sub=>!sub.anyOf||sub.anyOf.some(m=>app.can(m))).map(sub=>{
          const subActive=currentPath===flyItem.path&&currentView===sub.key
          return <button type="button" role="menuitem" key={sub.key} className={cls(subActive&&'active')} aria-current={subActive?'page':undefined} onClick={()=>go(`${flyItem.path}?view=${sub.key}`)}><span>{sub.label}</span>{subActive&&<Icon name="check" size={14}/>}</button>
        })}</div>:<button type="button" role="menuitem" className="module-flyout-single" onClick={()=>go(flyItem.path)}>Ochish <Icon name="arrow-right" size={14}/></button>}
      </div>}
    </Popover>}
  </>
}
