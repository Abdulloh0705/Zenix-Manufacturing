import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react'
import type {CSSProperties,ReactNode,RefObject} from 'react'
import {createPortal} from 'react-dom'
import {Icon} from './Icon'

/* -------------------------------------------------------------------------------------------------
 * Overlay stack
 * Every open modal, drawer and popover registers here. Only the top-most layer reacts to Escape,
 * Tab (focus trap) and outside clicks, so nested overlays (a Select inside a Modal, a Confirm on top
 * of a Drawer, a Select inside a popover) never close their parents by accident.
 * -----------------------------------------------------------------------------------------------*/
type Layer={id:string;kind:'dialog'|'popover';close:()=>void;node:()=>HTMLElement|null;anchor?:()=>HTMLElement|null}
const layers:Layer[]=[]
const listeners=new Set<()=>void>()
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const emit=()=>listeners.forEach(fn=>fn())
const topLayer=()=>layers[layers.length-1]
const topDialog=()=>[...layers].reverse().find(l=>l.kind==='dialog')

function onKeyDown(e:KeyboardEvent){
  const top=topLayer()
  if(!top)return
  if(e.key==='Escape'){
    e.preventDefault()
    e.stopImmediatePropagation()
    top.close()
    return
  }
  if(e.key!=='Tab')return
  if(top.kind==='popover'){
    const panel=top.node(),active=document.activeElement as HTMLElement|null
    if(panel&&active&&panel.contains(active)){
      // Menu-style popover: Tab moves through its items; leaving either end closes it and returns to the trigger.
      const items=focusablesIn(panel)
      if(!items.length||(!e.shiftKey&&active===items[items.length-1])||(e.shiftKey&&active===items[0])){e.preventDefault();top.close();focusAnchor(top.anchor?.())}
      return
    }
    // Listbox-style popover (focus stays on the trigger): Tab leaves it like a native select.
    top.close()
  }
  const dialog=topDialog()?.node()
  if(!dialog)return
  const nodes=[...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el=>el.getClientRects().length>0)
  if(!nodes.length){e.preventDefault();dialog.focus();return}
  const first=nodes[0],last=nodes[nodes.length-1],active=document.activeElement as HTMLElement|null
  const inside=active&&dialog.contains(active)
  if(e.shiftKey&&(active===first||!inside)){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&(active===last||!inside)){e.preventDefault();first.focus()}
}

function focusablesIn(root:HTMLElement){
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el=>el.getClientRects().length>0)
}

function focusAnchor(anchor?:HTMLElement|null){
  if(!anchor)return
  // Prefer the disclosure button (e.g. the sidebar chevron) over other controls inside the anchor.
  const target=anchor.matches(FOCUSABLE)?anchor:anchor.querySelector<HTMLElement>('[aria-expanded]')??anchor.querySelector<HTMLElement>('button,a[href],input')
  target?.focus({preventScroll:true})
}

function onPointerDown(e:PointerEvent){
  const target=e.target as Node
  // Close every popover stacked above the deepest layer that contains the click.
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i]
    if(layer.node()?.contains(target)||layer.anchor?.()?.contains(target))return
    if(layer.kind==='dialog')return
    layer.close()
  }
}

let installed=false
function install(){
  if(installed)return
  installed=true
  document.addEventListener('keydown',onKeyDown,true)
  document.addEventListener('pointerdown',onPointerDown,true)
}

let lockCount=0
function lockScroll(){
  lockCount+=1
  if(lockCount===1)document.documentElement.classList.add('scroll-locked')
  return()=>{lockCount=Math.max(0,lockCount-1);if(lockCount===0)document.documentElement.classList.remove('scroll-locked')}
}

export function isTopLayer(id:string){return topLayer()?.id===id}
export function useOverlayCount(){
  const [count,setCount]=useState(layers.filter(l=>l.kind==='dialog').length)
  useEffect(()=>{const fn=()=>setCount(layers.filter(l=>l.kind==='dialog').length);listeners.add(fn);return()=>{listeners.delete(fn)}},[])
  return count
}

function useLayer(open:boolean,kind:Layer['kind'],onClose:()=>void,nodeRef:RefObject<HTMLElement|null>,anchorRef?:RefObject<HTMLElement|null>){
  const id=useId()
  const closeRef=useRef(onClose)
  closeRef.current=onClose
  useLayoutEffect(()=>{
    if(!open)return
    install()
    const layer:Layer={id,kind,close:()=>closeRef.current(),node:()=>nodeRef.current,anchor:anchorRef?()=>anchorRef.current:undefined}
    layers.push(layer)
    emit()
    return()=>{const i=layers.indexOf(layer);if(i>=0)layers.splice(i,1);emit()}
  },[open,id,kind,nodeRef,anchorRef])
  return id
}

function useDialog(open:boolean,onClose:()=>void){
  const ref=useRef<HTMLElement>(null)
  const id=useLayer(open,'dialog',onClose,ref)
  // Read the opener during render: children with autoFocus take focus during commit, before effects run.
  const opener=useMemo(()=>open&&typeof document!=='undefined'?document.activeElement as HTMLElement|null:null,[open])
  useEffect(()=>{
    if(!open)return
    const previous=opener
    const unlock=lockScroll()
    const frame=requestAnimationFrame(()=>{
      const root=ref.current
      if(!root||root.contains(document.activeElement))return
      const preferred=root.querySelector<HTMLElement>('[autofocus],[data-autofocus]')
        ??root.querySelector<HTMLElement>('.modal-body input:not([readonly]),.modal-body textarea,.drawer-body input:not([readonly]),.drawer-body textarea')
        ??root.querySelector<HTMLElement>('.modal-body '+FOCUSABLE.split(',').join(',.modal-body '))
      ;(preferred??root).focus()
    })
    return()=>{cancelAnimationFrame(frame);unlock();if(previous&&document.contains(previous))requestAnimationFrame(()=>previous.focus({preventScroll:true}))}
  },[open,opener])
  return {ref,id}
}

/** Custom full-screen layers (e.g. the mobile navigation drawer) share Escape, focus trap and scroll lock. */
export const useModalLayer=useDialog

type Placement='bottom-start'|'bottom-end'|'top-start'|'top-end'|'right-start'|'left-start'
export function Popover({open,onClose,anchorRef,children,className='',placement='bottom-start',offset=8,minWidth=180,matchWidth=false,ariaLabel,role='dialog',id,autoFocus=true}:{open:boolean;onClose:()=>void;anchorRef:RefObject<HTMLElement|null>;children:ReactNode;className?:string;placement?:Placement;offset?:number;minWidth?:number;matchWidth?:boolean;ariaLabel?:string;role?:string;id?:string;autoFocus?:boolean}){
  const panelRef=useRef<HTMLDivElement>(null)
  useLayer(open,'popover',onClose,panelRef,anchorRef)
  useEffect(()=>{
    if(!open||!autoFocus)return
    const frame=requestAnimationFrame(()=>{const panel=panelRef.current;if(panel&&!panel.contains(document.activeElement)){const items=focusablesIn(panel);(panel.querySelector<HTMLElement>('[aria-checked="true"],[aria-current="page"],.active')??items[0])?.focus({preventScroll:true})}})
    const anchor=anchorRef.current
    return()=>{cancelAnimationFrame(frame);requestAnimationFrame(()=>{if(!document.activeElement||document.activeElement===document.body)focusAnchor(anchor)})}
  },[open,autoFocus,anchorRef])
  const [style,setStyle]=useState<CSSProperties>({position:'fixed',left:0,top:0,visibility:'hidden'})
  useLayoutEffect(()=>{
    if(!open){setStyle(s=>s.visibility==='hidden'?s:{position:'fixed',left:0,top:0,visibility:'hidden'});return}
    const update=()=>{
      const anchor=anchorRef.current,panel=panelRef.current
      if(!anchor||!panel)return
      const a=anchor.getBoundingClientRect(),margin=8,vw=window.innerWidth,vh=window.innerHeight
      const width=Math.min(vw-margin*2,Math.max(minWidth,matchWidth?a.width:0))
      panel.style.minWidth=`${width}px`
      const p=panel.getBoundingClientRect()
      const panelW=Math.min(Math.max(width,p.width),vw-margin*2),panelH=p.height
      let left=a.left,top=a.bottom+offset
      if(placement.endsWith('end'))left=a.right-panelW
      if(placement.startsWith('top'))top=a.top-panelH-offset
      if(placement==='right-start'){left=a.right+offset;top=a.top}
      if(placement==='left-start'){left=a.left-panelW-offset;top=a.top}
      if(placement==='right-start'&&left+panelW>vw-margin)left=Math.max(margin,a.left-panelW-offset)
      if(!placement.startsWith('right')&&!placement.startsWith('left')){
        const below=vh-a.bottom-offset-margin,above=a.top-offset-margin
        if(top+panelH>vh-margin&&above>below)top=Math.max(margin,a.top-panelH-offset)
      }
      left=Math.max(margin,Math.min(left,vw-panelW-margin))
      top=Math.max(margin,Math.min(top,vh-margin-Math.min(panelH,vh-margin*2)))
      const maxHeight=placement.startsWith('top')&&top<a.top?a.top-offset-margin:vh-top-margin
      setStyle({position:'fixed',left,top,minWidth:width,maxWidth:vw-margin*2,maxHeight:Math.max(160,maxHeight),visibility:'visible'})
    }
    update()
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null
    if(panelRef.current)observer?.observe(panelRef.current)
    window.addEventListener('resize',update)
    window.addEventListener('scroll',update,true)
    return()=>{observer?.disconnect();window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)}
  },[open,anchorRef,placement,offset,minWidth,matchWidth])
  if(!open)return null
  return createPortal(<div ref={panelRef} id={id} className={`ui-popover-layer ${className}`} style={style} role={role} aria-label={ariaLabel}>{children}</div>,document.body)
}

export function Modal({open,onClose,title,eyebrow,subtitle,children,footer,size='md',closeOnBackdrop=true}:{open:boolean;onClose:()=>void;title:string;eyebrow?:string;subtitle?:ReactNode;children:ReactNode;footer?:ReactNode;size?:'sm'|'md'|'lg'|'xl';closeOnBackdrop?:boolean}){
  const {ref,id}=useDialog(open,onClose)
  const titleId=`${id}-title`
  if(!open)return null
  return createPortal(<div className="modal-wrap" onPointerDown={e=>{if(closeOnBackdrop&&e.target===e.currentTarget&&isTopLayer(id))onClose()}}>
    <section ref={ref as RefObject<HTMLElement>} tabIndex={-1} className={`entity-modal size-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="modal-head"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="icon-ghost modal-close" onClick={onClose} aria-label="Yopish"><Icon name="x"/></button></header>
      <div className="modal-body">{children}</div>
      {footer&&<footer className="modal-actions">{footer}</footer>}
    </section>
  </div>,document.body)
}

export function Drawer({open,onClose,title,eyebrow,subtitle,children,actions,size='md',headerExtra,className='',icon}:{open:boolean;onClose:()=>void;title:string;eyebrow?:string;subtitle?:ReactNode;children:ReactNode;actions?:ReactNode;size?:'sm'|'md'|'lg'|'xl';headerExtra?:ReactNode;className?:string;icon?:string}){
  const {ref,id}=useDialog(open,onClose)
  const titleId=`${id}-title`
  if(!open)return null
  return createPortal(<div className="drawer-overlay" onPointerDown={e=>{if(e.target===e.currentTarget&&isTopLayer(id))onClose()}}>
    <aside ref={ref as RefObject<HTMLElement>} tabIndex={-1} className={`drawer drawer-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="drawer-head">{icon&&<span className="drawer-icon" aria-hidden="true"><Icon name={icon} size={18}/></span>}<div className="drawer-title">{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="icon-ghost modal-close" onClick={onClose} aria-label="Yopish"><Icon name="x"/></button>{headerExtra&&<div className="drawer-head-extra">{headerExtra}</div>}</header>
      <div className="drawer-body">{children}</div>
      {actions&&<footer className="drawer-actions">{actions}</footer>}
    </aside>
  </div>,document.body)
}

export function Confirm({open,onClose,onConfirm,title='Tasdiqlaysizmi?',text='Bu amalni davom ettirmoqchimisiz?',confirmText='Tasdiqlash',danger=false,children}:{open:boolean;onClose:()=>void;onConfirm:()=>void;title?:string;text?:ReactNode;confirmText?:string;danger?:boolean;children?:ReactNode}){
  return <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><button type="button" className="secondary-glass-btn" data-autofocus={danger?true:undefined} onClick={onClose}>Bekor qilish</button><button type="button" data-autofocus={danger?undefined:true} className={danger?'danger-glass-btn':'primary-glass-btn'} onClick={()=>{onConfirm();onClose()}}><Icon name={danger?'trash':'check'} size={16}/>{confirmText}</button></>}><div className={`confirm-copy ${danger?'danger':''}`}><Icon name={danger?'warning':'info'} size={18}/><div><p>{text}</p>{children}</div></div></Modal>
}
