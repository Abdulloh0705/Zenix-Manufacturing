import {useEffect,useRef,useState} from 'react'
import type {KeyboardEvent,PointerEvent} from 'react'
import {useNavigate} from 'react-router-dom'
import {useApp} from '../../app/providers/AppProvider/AppContext'
import {Drawer,Icon,useOverlayCount} from '../../shared/ui'
import {storage} from '../../shared/lib/storage'
import {answerQuestion,buildInsights,SUGGESTED_QUESTIONS} from '../../domain/insights'
import {cls} from '../../utils/format'

import {DOCK_POSITION_KEY as POSITION_KEY,DEFAULT_RATIO,ratioFromTop,readRatio,topFromRatio} from './aiDock'

/** Visible height (mobile browser bars excluded) and the bottom safe-area inset (home indicator). */
const viewportHeight=()=>Math.round(window.visualViewport?.height??window.innerHeight)
let probe:HTMLElement|null=null
const safeBottom=()=>{
  // env() is only resolved inside a real property, so a hidden probe reports the inset in px.
  if(!probe){probe=document.createElement('div');probe.setAttribute('aria-hidden','true');probe.style.cssText='position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';document.body.appendChild(probe)}
  return parseFloat(getComputedStyle(probe).paddingBottom)||0
}

/**
 * Edge-docked AI launcher: a slim tab that overlays the right edge (the content keeps only a few
 * pixels of clearance, never a column). Only the Y position is movable — drag, or ↑/↓ keys — and
 * it is stored as a ratio of the usable height so it survives resizes. It hides while any dialog,
 * the AI panel itself or the mobile navigation is open, so it never covers an active surface.
 */
export function AiAssistant(){
  const app=useApp()
  const dialogs=useOverlayCount()
  const enabled=app.can('ai')&&app.state.settings.ai.enabled
  const [ratio,setRatioState]=useState(()=>readRatio(storage.get<unknown>(POSITION_KEY,DEFAULT_RATIO)))
  const ratioRef=useRef(ratio)
  const setRatio=(next:number)=>{ratioRef.current=next;setRatioState(next)}
  const [viewport,setViewport]=useState(()=>({h:viewportHeight(),safe:safeBottom()}))
  const drag=useRef<{startY:number;startTop:number;moved:boolean}|null>(null)
  useEffect(()=>{
    // Re-derives the position from the stored ratio on resize / rotation / mobile browser bars.
    const fn=()=>setViewport({h:viewportHeight(),safe:safeBottom()})
    window.addEventListener('resize',fn);window.visualViewport?.addEventListener('resize',fn)
    return()=>{window.removeEventListener('resize',fn);window.visualViewport?.removeEventListener('resize',fn)}
  },[])
  useEffect(()=>{document.documentElement.classList.toggle('has-ai-dock',enabled);return()=>document.documentElement.classList.remove('has-ai-dock')},[enabled])
  const top=topFromRatio(ratio,viewport.h,viewport.safe)
  const setTop=(next:number)=>setRatio(ratioFromTop(next,viewport.h,viewport.safe))
  const persist=(r=ratioRef.current)=>storage.set(POSITION_KEY,Math.round(r*1000)/1000)

  const down=(e:PointerEvent<HTMLButtonElement>)=>{if(e.button!==0)return;drag.current={startY:e.clientY,startTop:top,moved:false};try{e.currentTarget.setPointerCapture(e.pointerId)}catch{/* capture is an enhancement; dragging still works without it */}}
  const move=(e:PointerEvent<HTMLButtonElement>)=>{const d=drag.current;if(!d)return;const delta=e.clientY-d.startY;if(Math.abs(delta)>4)d.moved=true;if(d.moved)setTop(d.startTop+delta)}
  const up=()=>{const d=drag.current;drag.current=null;if(!d)return;if(d.moved)persist();else app.setAiOpen(true)}
  const key=(e:KeyboardEvent<HTMLButtonElement>)=>{
    if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return
    e.preventDefault()
    const step=(e.shiftKey?120:32)*(e.key==='ArrowUp'?-1:1)
    const next=ratioFromTop(top+step,viewport.h,viewport.safe)
    setRatio(next);persist(next)
  }

  const hidden=!enabled||dialogs>0||app.sidebarMobile||app.aiOpen
  return <>
    {enabled&&<button type="button" className={cls('ai-dock',hidden&&'is-hidden')} style={{top}} tabIndex={hidden?-1:0} aria-hidden={hidden||undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current=null}}
      onKeyDown={key} onClick={e=>{if(e.detail===0)app.setAiOpen(true)}}
      aria-label="ZENIX AI panelini ochish. Joyini ↑ va ↓ tugmalari bilan o‘zgartiring." title="ZENIX AI">
      <Icon name="spark"/>
    </button>}
    {enabled&&<AiPanel/>}
  </>
}

/** Right-side panel: overlays the page (does not resize it); input stays pinned, history scrolls. */
function AiPanel(){
  const app=useApp(),navigate=useNavigate()
  const [text,setText]=useState('')
  const [messages,setMessages]=useState<Array<{who:'user'|'ai';text:string}>>([{who:'ai',text:'Material, muddat, OEE, maintenance, ECO, tannarx yoki scrap haqida so‘rang — javob joriy ma’lumotlardan.'}])
  const endRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{endRef.current?.scrollIntoView({block:'end'})},[messages])
  const ask=(q:string)=>{const t=q.trim();if(!t)return;setMessages(m=>[...m,{who:'user',text:t},{who:'ai',text:answerQuestion(app.state,t,m=>app.can(m))}]);setText('')}
  const insights=app.aiOpen?buildInsights(app.state,m=>app.can(m)).slice(0,3):[]
  const go=(path:string)=>{navigate(path);app.setAiOpen(false)}
  const asked=messages.length>1
  return <Drawer open={app.aiOpen} onClose={()=>app.setAiOpen(false)} title="ZENIX AI" subtitle="Manufacturing copilot" size="sm" className="ai-panel" icon="spark"
    headerExtra={<button type="button" className="ghost-btn compact" onClick={()=>go('/ai')}><Icon name="arrow-right" size={14}/>To‘liq oyna</button>}
    actions={<form className="ai-input" onSubmit={e=>{e.preventDefault();ask(text)}}><input value={text} onChange={e=>setText(e.target.value)} placeholder="Savol yozing..." aria-label="AI’ga savol" data-autofocus/><button type="submit" className="primary-glass-btn compact" disabled={!text.trim()} aria-label="Yuborish"><Icon name="arrow" size={15}/></button></form>}>
    {insights.length>0&&<span className="ai-section-label">Hozirgi signallar</span>}
    {insights.length>0&&<div className="ai-insight-strip" aria-label="Signallar">{insights.map(i=><button type="button" key={i.id} className={`insight-card ${i.tone}`} onClick={()=>go(i.path)}><i aria-hidden="true"/><span><b>{i.title}</b><small>{i.text}</small></span><Icon name="chevron" size={13}/></button>)}</div>}
    <div className="ai-messages" aria-live="polite">{messages.map((m,i)=><div className={`msg ${m.who}`} key={i}>{m.text}</div>)}<div ref={endRef}/></div>
    {!asked&&<div className="ai-suggestions" role="group" aria-label="Tayyor savollar">{SUGGESTED_QUESTIONS.map(q=><button type="button" key={q} onClick={()=>ask(q)}>{q}</button>)}</div>}
  </Drawer>
}
