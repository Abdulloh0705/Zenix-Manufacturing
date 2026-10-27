import {DEFAULT_WORKING_DAYS} from '../../domain/manufacturingEngine'

/** Monday first, as the week is read on the shop floor; values are JS weekdays (0 = Sunday). */
const DAYS:Array<[number,string]>=[[1,'Du'],[2,'Se'],[3,'Ch'],[4,'Pa'],[5,'Ju'],[6,'Sh'],[0,'Ya']]

export const workingDaysLabel=(days:number[]|undefined)=>(days?.length?days:DEFAULT_WORKING_DAYS).slice().sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>DAYS.find(x=>x[0]===d)?.[1]).join(' ')

/** Toggle buttons for a working-day calendar; at least one day stays selected. */
export function WorkingDaysPicker({value,onChange,disabled}:{value:number[];onChange:(days:number[])=>void;disabled?:boolean}){
  const toggle=(day:number)=>{const next=value.includes(day)?value.filter(d=>d!==day):[...value,day];if(next.length)onChange(next.sort())}
  return <div className="badge-row" role="group" aria-label="Ish kunlari">{DAYS.map(([day,label])=>{const on=value.includes(day);return <button type="button" key={day} disabled={disabled} aria-pressed={on} className={on?'primary-glass-btn compact':'secondary-glass-btn compact'} onClick={()=>toggle(day)}>{label}</button>})}</div>
}
