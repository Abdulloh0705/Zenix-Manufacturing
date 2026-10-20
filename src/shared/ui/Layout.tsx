import {useRef} from 'react'
import {Icon} from './Icon'
import type {KeyboardEvent,ReactNode} from 'react'

/**
 * Page title + one short line. `breadcrumb` is accepted for compatibility but not rendered:
 * location is already shown by the sidebar and the module sub-navigation.
 */
export function PageHeader({title,subtitle,actions,meta}:{title:string;subtitle?:ReactNode;actions?:ReactNode;breadcrumb?:string;meta?:ReactNode}){
  return <div className="page-head">
    <div className="page-head-copy"><h1>{title}</h1>{subtitle&&<p title={typeof subtitle==='string'?subtitle:undefined}>{subtitle}</p>}{meta&&<div className="page-meta">{meta}</div>}</div>
    {actions&&<div className="page-actions">{actions}</div>}
  </div>
}

export function Card({children,className='',onClick,title,subtitle,actions}:{children?:ReactNode;className?:string;onClick?:()=>void;title?:string;subtitle?:ReactNode;actions?:ReactNode}){
  const key=(e:KeyboardEvent<HTMLElement>)=>{if(!onClick||e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick()}}
  return <section className={`card ${onClick?'is-clickable':''} ${className}`} onClick={onClick} onKeyDown={onClick?key:undefined} role={onClick?'button':undefined} tabIndex={onClick?0:undefined}>
    {title&&<SectionTitle title={title} subtitle={subtitle} actions={actions}/>}
    {children}
  </section>
}

export function KPI({label,value,delta,icon,tone='blue',onClick,sub,deltaTone}:{label:string;value:ReactNode;delta?:string;icon?:ReactNode;tone?:string;onClick?:()=>void;sub?:string;deltaTone?:'up'|'down'|'neutral'}){
  const body=<><span className="kpi-icon" aria-hidden="true">{icon}</span><span className="kpi-copy"><span className="kpi-label">{label}</span><strong>{value}</strong>{sub&&<em title={sub}>{sub}</em>}{delta&&<small className={deltaTone||(delta.trim().startsWith('-')?'down':'up')}>{delta}</small>}</span></>
  if(onClick)return <button type="button" className={`card kpi tone-${tone} is-clickable`} onClick={onClick}>{body}<Icon name="arrow-right" size={13} className="kpi-go"/></button>
  return <div className={`card kpi tone-${tone}`}>{body}</div>
}

type TabItem=string|{value:string;label:ReactNode;count?:number}
export function Tabs({items,active,onChange,ariaLabel='Bo‘limlar'}:{items:TabItem[];active:string;onChange:(v:string)=>void;ariaLabel?:string}){
  const refs=useRef<(HTMLButtonElement|null)[]>([])
  const values=items.map(x=>typeof x==='string'?x:x.value)
  const onKey=(e:KeyboardEvent,index:number)=>{
    let next=-1
    if(e.key==='ArrowRight')next=(index+1)%values.length
    if(e.key==='ArrowLeft')next=(index-1+values.length)%values.length
    if(e.key==='Home')next=0
    if(e.key==='End')next=values.length-1
    if(next<0)return
    e.preventDefault();onChange(values[next]);refs.current[next]?.focus()
  }
  return <div className="tabs" role="tablist" aria-label={ariaLabel}>{items.map((x,i)=>{
    const value=values[i],label=typeof x==='string'?x:x.label,count=typeof x==='string'?undefined:x.count
    return <button ref={el=>{refs.current[i]=el}} type="button" role="tab" aria-selected={active===value} tabIndex={active===value?0:-1} className={active===value?'active':''} key={value} onClick={()=>onChange(value)} onKeyDown={e=>onKey(e,i)}>{label}{count!==undefined&&<span className="tab-count">{count}</span>}</button>
  })}</div>
}

export function SectionTitle({title,subtitle,actions}:{title:string;subtitle?:ReactNode;actions?:ReactNode}){
  return <div className="section-title"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="section-actions">{actions}</div>}</div>
}

export function Segmented({items,value,onChange,ariaLabel}:{items:Array<string|{value:string;label:ReactNode;count?:number}>;value:string;onChange:(v:string)=>void;ariaLabel?:string}){
  return <div className="segmented" role="group" aria-label={ariaLabel}>{items.map(x=>{
    const v=typeof x==='string'?x:x.value,l=typeof x==='string'?x:x.label,count=typeof x==='string'?undefined:x.count
    return <button type="button" key={v} aria-pressed={value===v} className={value===v?'active':''} onClick={()=>onChange(v)}>{l}{count!==undefined&&<span className="seg-count">{count}</span>}</button>
  })}</div>
}

export function Info({label,value,tone}:{label:string;value?:ReactNode;tone?:'danger'|'warning'|'success'}){
  return <div className={`info-cell ${tone?`tone-${tone}`:''}`}><span>{label}</span><b>{value===undefined||value===null||value===''?'—':value}</b></div>
}

export function InfoGrid({items,columns}:{items:Array<{label:string;value?:ReactNode;tone?:'danger'|'warning'|'success'}|false|null|undefined>;columns?:2|3|4}){
  return <div className={`detail-grid ${columns?`cols-${columns}`:''}`}>{items.filter(Boolean).map(x=>{const item=x as {label:string;value?:ReactNode;tone?:'danger'|'warning'|'success'};return <Info key={item.label} {...item}/>})}</div>
}
