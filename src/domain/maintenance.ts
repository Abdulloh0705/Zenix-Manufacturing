// Maintenance planning and reliability, read from recorded data only: when a preventive service is due (by
// calendar interval or by running hours), which services sit on which day, and MTBF / MTTR from failures that
// were actually recorded. Nothing here is estimated where data is missing — the missing part is reported instead.
import type {Equipment,MaintenanceOrder,MaintenancePlan,ManufacturingState} from '../types'
import {addDays,addMinutes,addMonths,dayOfWeek,daysBetween,minutesBetween} from '../utils/dates'
import {isWorkingDay,workCenterCalendar} from './manufacturingEngine'

type S=ManufacturingState

export const PLAN_UNITS:{value:MaintenancePlan['unit'];label:string}[]=[{value:'day',label:'kun'},{value:'week',label:'hafta'},{value:'month',label:'oy'},{value:'runtime',label:'ish soati'}]
/** How many days before the due date a service counts as "soon" (and how much of a runtime interval is left). */
export const DUE_SOON_DAYS=3,DUE_SOON_SHARE=.1

/** The machine's preventive plan; machines saved before plans existed keep their day interval. */
export function planOf(e:Pick<Equipment,'maintenancePlan'|'maintenanceIntervalDays'>):MaintenancePlan|undefined{
  if(e.maintenancePlan&&e.maintenancePlan.interval>0)return e.maintenancePlan
  return e.maintenanceIntervalDays>0?{unit:'day',interval:e.maintenanceIntervalDays}:undefined
}

export function planLabel(plan?:MaintenancePlan){
  if(!plan)return 'Reja yo‘q'
  return `har ${plan.interval} ${PLAN_UNITS.find(u=>u.value===plan.unit)?.label||plan.unit}${plan.durationHours?` · ${plan.durationHours} soat`:''}`
}

/** Adds whole months, clamped to the last day of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export {addMonths}

/** Next calendar due date of a plan after a service on `from`; runtime plans have no calendar date. */
export function nextDueDate(plan:MaintenancePlan|undefined,from:string):string|undefined{
  if(!plan||!(plan.interval>0)||!from)return undefined
  if(plan.unit==='day')return addDays(from,plan.interval)
  if(plan.unit==='week')return addDays(from,plan.interval*7)
  if(plan.unit==='month')return addMonths(from,plan.interval)
  return undefined
}

export type DueState='ok'|'soon'|'due'|'overdue'|'no-plan'|'no-data'
export type MaintenanceDue={plan?:MaintenancePlan;state:DueState;dueDate?:string;days?:number;
  /** Runtime plans: hours run since the last service and hours left until the next one. */
  usedHours?:number;leftHours?:number;reason:string}

/**
 * When the machine's next preventive service is due. Calendar plans: the stored next date, else last service +
 * interval. Runtime plans: hours since the last service against the interval — without meter readings it is unknown.
 */
export function maintenanceDue(e:Equipment,today:string):MaintenanceDue{
  const plan=planOf(e)
  if(!plan)return {state:'no-plan',reason:'Preventive reja kiritilmagan'}
  if(plan.unit==='runtime'){
    if(e.runtimeHours===undefined||e.runtimeHours===null)return {plan,state:'no-data',reason:'Ish soati (runtime) hisoblagichi kiritilmagan'}
    const used=Math.round((e.runtimeHours-(e.runtimeAtService??0))*10)/10,left=Math.round((plan.interval-used)*10)/10
    const state:DueState=left<0?'overdue':left===0?'due':left<=plan.interval*DUE_SOON_SHARE?'soon':'ok'
    return {plan,state,usedHours:used,leftHours:left,reason:left<=0?`${used} soat ishladi (interval ${plan.interval})`:`${left} soat qoldi`}
  }
  const dueDate=e.nextMaintenance||nextDueDate(plan,e.lastMaintenance)
  if(!dueDate)return {plan,state:'no-data',reason:'Oxirgi servis sanasi ham, keyingi sana ham yo‘q'}
  const days=daysBetween(today,dueDate)
  const state:DueState=days<0?'overdue':days===0?'due':days<=DUE_SOON_DAYS?'soon':'ok'
  return {plan,state,dueDate,days,reason:days<0?`${-days} kun kechikdi`:days===0?'Bugun':`${days} kun qoldi`}
}

/** Planned window of a maintenance order: start, end and hours; without a duration it takes its whole day. */
export function maintenanceWindow(s:S,m:MaintenanceOrder){
  const start=m.scheduled.length>10?m.scheduled:`${m.scheduled} 09:00`
  const hours=m.plannedHours&&m.plannedHours>0?m.plannedHours:s.maintenanceRequests.find(r=>r.id===m.requestId)?.downtimeHours||0
  const end=hours>0?addMinutes(start,hours*60):`${start.slice(0,10)} 23:59`
  return {start,end,hours:hours>0?hours:undefined}
}

const OPEN_MAINTENANCE:MaintenanceOrder['status'][]=['Rejada','Jarayonda']
/** Other open services of the same machine whose planned windows overlap this one. */
export function maintenanceClashes(s:S,equipmentId:string,start:string,end:string,except?:string){
  return s.maintenanceOrders.filter(m=>m.id!==except&&m.equipmentId===equipmentId&&OPEN_MAINTENANCE.includes(m.status)).filter(m=>{
    const w=maintenanceWindow(s,m)
    return w.start<end&&start<w.end
  })
}

export type CalendarEntry={date:string;equipmentId:string;kind:'order'|'due';orderId?:string;code?:string;type?:MaintenanceOrder['type'];status?:string;state?:DueState;hours?:number}

/**
 * Service calendar for `days` days from `from`: planned / running orders on their dates, plus preventive services
 * that fall due in the window and have no open preventive order yet (overdue ones show on the first day).
 */
export function maintenanceCalendar(s:S,from:string,days:number):CalendarEntry[]{
  const to=addDays(from,days-1)
  const out:CalendarEntry[]=[]
  for(const m of s.maintenanceOrders.filter(x=>OPEN_MAINTENANCE.includes(x.status))){
    const date=m.scheduled.slice(0,10)
    const shown=date<from&&m.status==='Rejada'?from:date
    if(shown>=from&&shown<=to)out.push({date:shown,equipmentId:m.equipmentId,kind:'order',orderId:m.id,code:m.code,type:m.type,status:m.status,hours:maintenanceWindow(s,m).hours})
  }
  for(const e of s.equipment){
    if(s.maintenanceOrders.some(m=>m.equipmentId===e.id&&m.type==='Preventive'&&OPEN_MAINTENANCE.includes(m.status)))continue
    const due=maintenanceDue(e,from)
    if(due.dueDate&&due.dueDate<=to)out.push({date:due.dueDate<from?from:due.dueDate,equipmentId:e.id,kind:'due',state:due.state})
    else if(!due.dueDate&&(due.state==='due'||due.state==='overdue'||due.state==='soon'))out.push({date:from,equipmentId:e.id,kind:'due',state:due.state})
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||a.equipmentId.localeCompare(b.equipmentId))
}

/**
 * A failure is a recorded breakdown: an "Unplanned stop", or a stop raised by corrective / emergency work or a repair
 * order. Planned services, set-ups and waits are not failures.
 */
export function failuresOf(s:S,equipmentId:string){
  const corrective=new Set([...s.maintenanceOrders.filter(m=>m.type!=='Preventive').map(m=>m.id),...s.repairOrders.map(r=>r.id)])
  return s.downtimeEvents.filter(d=>d.equipmentId===equipmentId&&(d.reason==='Unplanned stop'||(Boolean(d.sourceId)&&corrective.has(d.sourceId!))))
    .sort((a,b)=>a.start.localeCompare(b.start))
}

export type Reliability={failures:number;closed:number;mtbfHours:number|null;mttrHours:number|null;mtbfNote?:string;mttrNote?:string}

/**
 * MTTR = average duration of closed failures (needs ≥ 1). MTBF = average running time between the end of one failure
 * and the start of the next (needs ≥ 2 failures). With fewer records the value is null and the note says why.
 */
export function reliabilityOf(s:S,equipmentId:string):Reliability{
  const failures=failuresOf(s,equipmentId)
  const closed=failures.filter(d=>d.end)
  const mttr=closed.length?Math.round(closed.reduce((a,d)=>a+d.minutes,0)/closed.length/60*10)/10:null
  const gaps:number[]=[]
  for(let i=1;i<failures.length;i++){
    const prev=failures[i-1]
    if(!prev.end)continue
    gaps.push(Math.max(0,minutesBetween(prev.end,failures[i].start)))
  }
  const mtbf=gaps.length?Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length/60*10)/10:null
  return {failures:failures.length,closed:closed.length,mtbfHours:mtbf,mttrHours:mttr,
    mtbfNote:mtbf===null?(failures.length<2?`Kamida 2 ta qayd etilgan nosozlik kerak (hozir ${failures.length})`:'Yopilmagan nosozlik bor'):undefined,
    mttrNote:mttr===null?'Yopilgan nosozlik qayd etilmagan':undefined}
}

/* ------------------------------------------------- Runtime forecast (audit #26) -- */

/** Usage history a forecast needs: at least two meter readings this many calendar days apart, the last one this recent. */
export const FORECAST_MIN_SPAN_DAYS=7,FORECAST_MAX_AGE_DAYS=30,FORECAST_WINDOW_DAYS=90,FORECAST_HORIZON_DAYS=365
export const INSUFFICIENT='Ma’lumot yetarli emas'

/** Meter readings of a machine, oldest first; data saved before the log keeps its one latest reading. */
export function runtimeReadings(e:Pick<Equipment,'runtimeLog'|'runtimeHours'|'runtimeReadAt'>){
  const log=e.runtimeLog?.length?e.runtimeLog:e.runtimeHours!==undefined&&e.runtimeReadAt?[{at:e.runtimeReadAt,hours:e.runtimeHours}]:[]
  return [...log].filter(r=>Number.isFinite(r.hours)&&typeof r.at==='string').sort((a,b)=>a.at.localeCompare(b.at))
}

export type RuntimeForecast={
  /** estimated: a projected date from recorded usage; due: the interval is already used up; the rest give no date. */
  state:'estimated'|'due'|'insufficient'|'inactive'|'not-runtime';
  dueDate?:string;hoursPerDay?:number;leftHours?:number;basisDays?:number;readings:number;reason:string;
  /** A preventive order already planned — the confirmed date, shown apart from the estimate and never replaced by it. */
  scheduled?:{code:string;date:string}}

/**
 * Next runtime-based service date estimated from the machine's own recorded usage: hours run between meter readings
 * over the last FORECAST_WINDOW_DAYS, divided by the working days of its work center's calendar in that span, give
 * hours per working day; the hours left on the interval are then laid over the coming working days. Nothing is
 * assumed: fewer than two readings, a span under a week, no hours run, an old last reading or a stopped machine give
 * no date ("Ma’lumot yetarli emas"). The forecast is a read — it never writes the machine's schedule.
 */
export function runtimeForecast(s:S,e:Equipment,today:string):RuntimeForecast{
  const plan=planOf(e)
  const open=s.maintenanceOrders.filter(m=>m.equipmentId===e.id&&m.type==='Preventive'&&OPEN_MAINTENANCE.includes(m.status)).sort((a,b)=>a.scheduled.localeCompare(b.scheduled))[0]
  const scheduled=open?{code:open.code,date:open.scheduled.slice(0,10)}:undefined
  const readings=runtimeReadings(e)
  const base={readings:readings.length,scheduled}
  if(!plan||plan.unit!=='runtime')return {...base,state:'not-runtime',reason:'Reja ish soati bo‘yicha emas'}
  const due=maintenanceDue(e,today)
  if(due.state==='no-data')return {...base,state:'insufficient',reason:`${INSUFFICIENT}: ${due.reason}`}
  if((due.leftHours??0)<=0)return {...base,state:'due',dueDate:today,leftHours:due.leftHours,reason:due.reason}
  if(e.status==='To‘xtagan')return {...base,state:'inactive',leftHours:due.leftHours,reason:'Uskuna to‘xtagan — ishlash sur’ati yo‘q, prognoz qilinmaydi'}
  const last=readings[readings.length-1]
  if(!last||readings.length<2)return {...base,state:'insufficient',leftHours:due.leftHours,reason:`${INSUFFICIENT}: kamida 2 ta hisoblagich o‘lchovi kerak (hozir ${readings.length})`}
  const lastDay=last.at.slice(0,10)
  if(daysBetween(lastDay,today)>FORECAST_MAX_AGE_DAYS)return {...base,state:'insufficient',leftHours:due.leftHours,reason:`${INSUFFICIENT}: oxirgi o‘lchov ${lastDay} — ${FORECAST_MAX_AGE_DAYS} kundan eski`}
  const window=readings.filter(r=>daysBetween(r.at.slice(0,10),lastDay)<=FORECAST_WINDOW_DAYS)
  const first=window[0]
  const span=daysBetween(first.at.slice(0,10),lastDay)
  if(window.length<2||span<FORECAST_MIN_SPAN_DAYS)return {...base,state:'insufficient',leftHours:due.leftHours,reason:`${INSUFFICIENT}: o‘lchovlar oralig‘i ${span} kun (kamida ${FORECAST_MIN_SPAN_DAYS} kun kerak)`}
  const wc=s.workCenters.find(w=>w.id===e.workCenterId)
  const working=(date:string)=>wc?isWorkingDay(s,wc,date):workCenterCalendar(s,{}).workingDays.includes(dayOfWeek(date))
  let workDays=0
  for(let d=addDays(first.at.slice(0,10),1);d<=lastDay;d=addDays(d,1))if(working(d))workDays+=1
  const ran=last.hours-first.hours
  if(workDays<=0||ran<=0)return {...base,state:'insufficient',leftHours:due.leftHours,basisDays:workDays,reason:`${INSUFFICIENT}: ${span} kunda ish soati o‘smadi — foydalanish qayd etilmagan`}
  const rate=ran/workDays
  // Hours left as of the last reading, consumed working day by working day from the day after it.
  let left=due.leftHours??0,day=lastDay,guard=0
  while(left>1e-9&&guard++<FORECAST_HORIZON_DAYS+FORECAST_MAX_AGE_DAYS){day=addDays(day,1);if(working(day))left-=rate}
  const hoursPerDay=Math.round(rate*10)/10
  if(left>1e-9)return {...base,state:'insufficient',hoursPerDay,leftHours:due.leftHours,basisDays:workDays,reason:`${INSUFFICIENT}: hozirgi sur’atda (${hoursPerDay} soat/kun) 1 yildan ko‘p`}
  return {...base,state:'estimated',dueDate:day<today?today:day,hoursPerDay,leftHours:due.leftHours,basisDays:workDays,
    reason:`Taxminiy: ${hoursPerDay} soat/ish kuni (${workDays} ish kuni, ${window.length} o‘lchov) · ${due.leftHours} soat qoldi`}
}

/**
 * Capacity warnings from forecasts: machines whose estimated runtime service falls within the horizon and that have
 * no preventive order yet — the service is not in the capacity plan until someone schedules it.
 */
export function forecastWarnings(s:S,today:string,horizonDays=14){
  const until=addDays(today,horizonDays)
  return s.equipment.map(e=>({equipment:e,forecast:runtimeForecast(s,e,today)}))
    .filter(x=>!x.forecast.scheduled&&(x.forecast.state==='due'||(x.forecast.state==='estimated'&&x.forecast.dueDate!<=until)))
}
