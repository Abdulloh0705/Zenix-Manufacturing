import type {CSSProperties,ReactNode} from 'react'
import {cls} from '../../utils/format'

export type Stat={label:string;value:ReactNode;sub?:string;tone?:'danger'|'warning'|'success';path:string}

/** Connected figures inside a panel — the KPI-strip hairline pattern at panel scale. Every cell is a link. */
export function StatStrip({items,onGo}:{items:Stat[];onGo:(path:string)=>void}){
  return <div className={`dash-stats cols-${items.length}`} style={{'--cols':items.length} as CSSProperties}>{items.map(x=>
    <button type="button" key={x.label} className={cls('dash-stat',x.tone&&`tone-${x.tone}`)} onClick={()=>onGo(x.path)}>
      <span>{x.label}</span><b>{x.value}</b>{x.sub&&<small>{x.sub}</small>}
    </button>)}</div>
}
