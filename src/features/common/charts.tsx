import {useId,useState} from 'react'
import type {ReactNode} from 'react'
import {num} from '../../utils/format'

/** Rounds an axis maximum up to a clean tick step (1/2/2.5/5 × 10ⁿ). */
function niceMax(value:number,ticks=4){
  if(value<=0)return ticks
  const raw=value/ticks,pow=10**Math.floor(Math.log10(raw))
  const step=[1,2,2.5,5,10].map(m=>m*pow).find(m=>m>=raw)||10*pow
  return step*ticks
}

type ColumnDatum={label:string;value:number;reference?:number;detail?:string}

/**
 * Single-series column chart with an optional reference tick (e.g. plan).
 * Columns ≤ 24px, 4px rounded data-end, hairline grid; every column is a hover/focus target.
 */
export function ColumnChart({data,valueLabel,referenceLabel,unit='',height=220,title,tickEvery=1}:{data:ColumnDatum[];valueLabel:string;referenceLabel?:string;unit?:string;height?:number;title:string;tickEvery?:number}){
  const uid=useId()
  const [hover,setHover]=useState<number|null>(null)
  // All-zero data keeps niceMax's whole-number 0–4 axis instead of a 0–1 axis rounded to "0 0 1 1 1".
  const max=niceMax(Math.max(0,...data.map(d=>Math.max(d.value,d.reference??0))))
  const ticks=[0,.25,.5,.75,1].map(t=>t*max)
  const hovered=hover!==null?data[hover]:null
  return <figure className="viz" aria-labelledby={`${uid}-t`}>
    <figcaption id={`${uid}-t`} className="sr-only">{title}</figcaption>
    {referenceLabel&&<div className="viz-legend" aria-hidden="true"><span><i className="key-bar"/>{valueLabel}</span><span><i className="key-tick"/>{referenceLabel}</span></div>}
    <div className="viz-plot" style={{height}}>
      <div className="viz-grid" aria-hidden="true">{ticks.slice().reverse().map(t=><div key={t}><span>{num(t)}</span></div>)}</div>
      <div className="viz-columns" role="list">
        {data.map((d,i)=>{
          const h=d.value/max*100,ref=d.reference!==undefined?d.reference/max*100:undefined
          // Focusable so keyboard users can reach each value (the focus shows the same detail as hover).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          return <div key={d.label+i} role="listitem" tabIndex={0} className={`viz-col ${hover===i?'is-hover':''}`}
            aria-label={`${d.label}: ${valueLabel} ${num(d.value)} ${unit}${d.reference!==undefined?`, ${referenceLabel} ${num(d.reference)} ${unit}`:''}`}
            onPointerEnter={()=>setHover(i)} onPointerLeave={()=>setHover(h=>h===i?null:h)} onFocus={()=>setHover(i)} onBlur={()=>setHover(h=>h===i?null:h)}>
            <div className="viz-col-track">
              <span className="viz-bar" style={{height:`${Math.max(d.value>0?1.5:0,h)}%`}}/>
              {ref!==undefined&&<span className="viz-ref" style={{bottom:`${ref}%`}}/>}
            </div>
            <small aria-hidden={tickEvery>1||undefined}>{(data.length-1-i)%tickEvery===0?d.label:''}</small>
          </div>})}
      </div>
      {hovered&&<div className="viz-tooltip" role="status" style={{left:`${(hover!+.5)/data.length*100}%`}}>
        <b>{num(hovered.value)} {unit}</b><span><i className="key-line"/>{valueLabel}</span>
        {hovered.reference!==undefined&&<span><i className="key-line ref"/>{referenceLabel}: {num(hovered.reference)} {unit}</span>}
        <em>{hovered.detail||hovered.label}</em>
      </div>}
    </div>
    <table className="sr-only"><caption>{title}</caption><thead><tr><th>Davr</th><th>{valueLabel}</th>{referenceLabel&&<th>{referenceLabel}</th>}</tr></thead><tbody>{data.map((d,i)=><tr key={i}><td>{d.label}</td><td>{num(d.value)}</td>{referenceLabel&&<td>{num(d.reference??0)}</td>}</tr>)}</tbody></table>
  </figure>
}

type Segment={label:string;value:number;slot:number|'mfg'|'muted'|'danger'|'warning'|'success';onClick?:()=>void}
/** Part-to-whole bar with a legend; segments separated by a 2px surface gap. Legend rows with `onClick` become links. */
export function StackedBar({segments,total,title,unit='',format}:{segments:Segment[];total?:number;title:string;unit?:string;format?:(v:number)=>string}){
  const fmt=(v:number)=>format?format(v):`${num(v)}${unit?` ${unit}`:''}`
  const sum=total??segments.reduce((a,s)=>a+s.value,0)
  const [hover,setHover]=useState<number|null>(null)
  return <figure className="viz stacked">
    <figcaption className="sr-only">{title}</figcaption>
    {/* Each segment is focusable so keyboard users can reach its value (focus shows the same detail as hover). */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="stacked-bar" role="list">{segments.filter(s=>s.value>0).map((s,i)=><span key={s.label} role="listitem" tabIndex={0} aria-label={`${s.label}: ${fmt(s.value)}`} className={`series-${s.slot} ${hover===i?'is-hover':''}`} style={{flexGrow:s.value}} onPointerEnter={()=>setHover(i)} onPointerLeave={()=>setHover(null)} onFocus={()=>setHover(i)} onBlur={()=>setHover(null)}/>)}
      {!sum&&<span className="empty-seg"/>}
    </div>
    <ul className="viz-legend-list">{segments.map(s=>{
      const body=<><i className={`series-${s.slot}`}/><span>{s.label}</span><b>{fmt(s.value)}</b><em>{sum?Math.round(s.value/sum*100):0}%</em></>
      return <li key={s.label}>{s.onClick?<button type="button" className="viz-legend-btn" aria-label={`${s.label}: ${fmt(s.value)} — ochish`} onClick={s.onClick}>{body}</button>:body}</li>
    })}</ul>
  </figure>
}

/** Horizontal bars for ranked comparisons (utilization, loss reasons). */
export function BarList({rows,unit='',max,valueFormat=v=>num(v),threshold}:{rows:Array<{label:ReactNode;sub?:ReactNode;value:number;display?:string;tone?:'danger'|'warning'|'success';onClick?:()=>void;ariaLabel?:string}>;unit?:string;max?:number;valueFormat?:(v:number)=>string;threshold?:number}){
  const top=max??Math.max(1,...rows.map(r=>r.value))
  return <ul className="bar-list">{rows.map((r,i)=>{
    const body=<>
      <div className="bar-list-head"><span><b>{r.label}</b>{r.sub&&<small>{r.sub}</small>}</span><strong>{r.display??`${valueFormat(r.value)}${unit?` ${unit}`:''}`}</strong></div>
      <div className="bar-list-track">
        <span className={r.tone?`tone-${r.tone}`:''} style={{width:`${Math.min(100,Math.max(0,r.value/top*100))}%`}}/>
        {threshold!==undefined&&<i style={{left:`${Math.min(100,threshold/top*100)}%`}} aria-hidden="true"/>}
      </div>
    </>
    return <li key={i}>{r.onClick?<button type="button" className="bar-list-btn" aria-label={r.ariaLabel} onClick={r.onClick}>{body}</button>:body}</li>
  })}</ul>
}

/** Radial gauge for a single 0–100 figure (OEE). */
export function Gauge({value,label,sub}:{value:number;label:string;sub?:string}){
  const v=Math.max(0,Math.min(100,value)),r=42,c=Math.PI*r
  return <div className="gauge" role="img" aria-label={`${label}: ${Math.round(v)}%`}>
    <svg viewBox="0 0 100 58" aria-hidden="true"><path d="M8 50a42 42 0 0 1 84 0" className="gauge-track"/><path d="M8 50a42 42 0 0 1 84 0" className="gauge-fill" style={{strokeDasharray:`${c}`,strokeDashoffset:`${c*(1-v/100)}`}}/></svg>
    <strong>{Math.round(v)}%</strong><span>{label}</span>{sub&&<small>{sub}</small>}
  </div>
}
