import type {ManufacturingState,ProductionOrder,QualityCheck,WorkOrder} from '../types'
import {DASHBOARD_PERIODS,dashboardSnapshot} from './dashboard'
import {createMrpPlan,deliveryRisk,equipmentActivity,itemName,laborNow,loggedMinutes,operationQueues,orderBlocker,orderCosting,orderMaterialLines,orderMaterialStatus,prioritizedOrders,reworkOrders,scrapEvents,stockOf,weeklyProductionPlan} from './manufacturingEngine'
import type {EquipmentActivity} from './manufacturingEngine'
import {daysBetween,periodStart} from '../utils/dates'

/**
 * Ishlab chiqarish → Umumiy — the production control centre. A read-only analysis layer like the
 * dashboard: figures shared with it come from `dashboardSnapshot`, the rest from the engine helpers the
 * destination pages use, so every number equals the rows or the total behind its link.
 */

/** Periods (days, including today) behind each figure; links pass the same value as a filter. */
export const CONTROL_PERIODS={...DASHBOARD_PERIODS,labor:7} as const

/** A closed order costs "over plan" above this variance — the red rows of Xarajatlar → Costing. */
export const COST_VARIANCE_ALERT=5

/** Activity-log modules that belong to the shop floor: orders and operations, inspections, machines. */
export const CONTROL_ACTIVITY_MODULES=['Ishlab chiqarish','Sifat','Uskunalar']

/** Quick filters of the order queue; each one maps to a Production Orders filter with the same rows. */
export const QUEUE_FILTERS=['all','risk','late','today','material','running','paused','critical'] as const
export type QueueFilter=typeof QUEUE_FILTERS[number]
type QueueRow={order:ProductionOrder;risk:boolean}
const QUEUE_TEST:Record<QueueFilter,(x:QueueRow,today:string)=>boolean>={
  all:()=>true,risk:x=>x.risk,late:(x,today)=>x.order.due<today,today:(x,today)=>x.order.due===today,
  material:x=>x.order.status==='Material kutilmoqda',running:x=>x.order.status==='Jarayonda',paused:x=>x.order.status==='Pauzada',
  critical:x=>x.order.priority==='Kritik',
}
export const inQueue=(filter:QueueFilter,row:QueueRow,today:string)=>QUEUE_TEST[filter](row,today)

export type ControlExceptionId='late'|'risk'|'shortage'|'qc'|'down'|'overload'|'blocked'|'service'|'cost'
export type ControlException={id:ControlExceptionId;tone:'danger'|'warning';count:number;items:string[]}

/** Where an order stands in its routing: the operation on the machine, the paused one, or the next to start. */
export type OrderOperation={workOrder:WorkOrder;state:'running'|'paused'|'next';done:number;total:number}
function orderOperation(order:ProductionOrder):OrderOperation|undefined{
  const of=(status:WorkOrder['status'])=>order.workOrders.find(w=>w.status===status)
  const running=of('Jarayonda'),paused=of('Pauzada'),next=order.workOrders.find(w=>w.status!=='Yakunlangan')
  const workOrder=running||paused||next
  if(!workOrder)return undefined
  return {workOrder,state:running?'running':paused?'paused':'next',done:order.workOrders.filter(w=>w.status==='Yakunlangan').length,total:order.workOrders.length}
}

/**
 * Today's plan per product — the day's share of every order whose start→due window covers today
 * (the rule of `outputByDay`) against today's finished-goods receipts.
 */
function todayProductionPlan(s:ManufacturingState,today:string){
  const byProduct=new Map<string,{planned:number;produced:number}>()
  const at=(id:string)=>byProduct.get(id)??byProduct.set(id,{planned:0,produced:0}).get(id)!
  for(const o of s.productionOrders)if(o.status!=='Bekor qilingan'&&o.start<=today&&o.due>=today)at(o.productId).planned+=o.quantity/Math.max(1,daysBetween(o.start,o.due)+1)
  for(const m of s.stockMovements)if(m.type==='Production +'&&m.date.slice(0,10)===today&&!m.note.includes('By-product'))at(m.itemId).produced+=m.qty
  return s.products.flatMap(product=>{
    const row=byProduct.get(product.id)
    if(!row)return []
    const planned=Math.round(row.planned),produced=Math.round(row.produced)
    return [{product,planned,produced,remaining:Math.max(0,planned-produced),completion:planned?Math.round(produced/planned*100):null}]
  })
}

export function productionControl(s:ManufacturingState,now=new Date()){
  const P=CONTROL_PERIODS
  const d=dashboardSnapshot(s)
  const {today}=d
  const machineName=(id:string)=>s.equipment.find(e=>e.id===id)?.name||id

  // Which orders first? Open orders by urgency, with material status, the operation they are at and what holds them.
  const queue=prioritizedOrders(s,today).map(x=>({...x,risk:deliveryRisk(s,x.order,today),material:orderMaterialStatus(s,x.order),blocker:orderBlocker(s,x.order),operation:orderOperation(x.order)}))
  const queueCounts=Object.fromEntries(QUEUE_FILTERS.map(f=>[f,queue.filter(x=>inQueue(f,x,today)).length])) as Record<QueueFilter,number>
  const blocked=queue.filter(x=>x.blocker)

  // Are orders finished on time? (the dashboard's figure: completed in the period, on or before the due date)
  const delivery={rate:d.delivery.rate,completed:d.delivery.completed,onTime:d.delivery.onTime}

  // Is there enough material? MRP netting per raw material, the materials to act on, and what each waiting order is missing.
  const plan=createMrpPlan(s)
  const rows=plan.purchases.flatMap(p=>{
    const m=s.rawMaterials.find(x=>x.id===p.materialId)
    if(!m)return []
    // Same levels as Xomashyo → Yetishmovchiliklar: critical = MRP shortage or below min stock, low = below the reorder point.
    const level:'critical'|'low'|'ok'=p.shortage>0||p.available<m.minStock?'critical':p.available<m.reorderPoint?'low':'ok'
    return [{...p,id:p.materialId,m,reserved:stockOf(s,p.materialId).reserved,level}]
  })
  const materials={rows,short:rows.filter(r=>r.shortage>0),shortages:d.materials.shortages,critical:d.materials.critical,
    waiting:d.materials.waiting.map(order=>({order,missing:orderMaterialLines(s,order).filter(l=>l.shortage>0)}))}

  // Is production on plan? This week (MPS first week + finished receipts since Monday) and today.
  const weekPlan=weeklyProductionPlan(s,plan.mps)
  const dayPlanned=d.output.plannedToday,dayProduced=d.output.today
  const dayPlan={products:todayProductionPlan(s,today),planned:dayPlanned,produced:dayProduced,remaining:Math.max(0,dayPlanned-dayProduced),
    completion:dayPlanned?Math.round(dayProduced/dayPlanned*100):null}

  // How loaded is each work center today, and which one is the problem over the horizon?
  const queues=operationQueues(s)
  const queueOf=(workCenterId:string)=>queues.find(x=>x.workCenter.id===workCenterId)?.queue??[]
  const loads=d.capacity.loads.map(l=>{
    const q=queueOf(l.workCenter.id),t=l.days[0]
    return {...l,queue:q,current:q.find(x=>x.workOrder.status==='Jarayonda'),
      today:{...t,free:Math.max(0,t.capacity-t.load),over:Math.max(0,t.load-t.capacity)}}
  })
  const constraints=d.capacity.constraints.map(l=>{
    const q=queueOf(l.workCenter.id)
    return {...l,queue:q,delayed:q.filter(x=>deliveryRisk(s,x.order,today)).length,overDays:l.days.filter(x=>x.utilization>100).length}
  })
  const todayLoad=loads.reduce((a,l)=>a+l.today.load,0),todayCapacity=loads.reduce((a,l)=>a+l.today.capacity,0)
  const capacity={loads,constraints,bottleneck:constraints[0],overloaded:d.capacity.overloaded,
    freeMinutes:d.capacity.freeMinutes,busiest:[...d.capacity.loads].sort((a,b)=>b.utilization-a.utilization)[0],
    // Totals of the first day column of Rejalashtirish → Capacity ("Jami" row).
    today:{load:todayLoad,capacity:todayCapacity,free:loads.reduce((a,l)=>a+l.today.free,0),utilization:todayCapacity?Math.round(todayLoad/todayCapacity*100):0},
    operations:queues.reduce((a,q)=>a+q.queue.length,0)}

  // How much came out today — good, scrap, sent to rework — and how do inspections go?
  const scrap=scrapEvents(s,1).reduce((a,e)=>a+e.qty,0)
  const rework=reworkOrders(s,1).reduce((a,o)=>a+o.quantity,0)
  const good=d.output.today
  const output={good,planned:d.output.plannedToday,scrap,rework,yield:good+scrap?Math.round(good/(good+scrap)*100):null}
  const resolved=(status:QualityCheck['status'])=>d.quality.resolved.filter(q=>q.status===status)
  const quality={pending:d.quality.pending,passed:resolved('Passed'),failed:resolved('Failed'),rework:resolved('Rework'),scrap:resolved('Scrap'),
    checks:d.quality.checks,passRate:d.quality.passRate}

  // Are the machines running? (maintenance = orders in progress on Uskunalar → Maintenance)
  const machines=equipmentActivity(s)
  const inState=(activity:EquipmentActivity)=>machines.filter(m=>m.activity===activity)
  const equipment={machines,running:inState('running'),idle:inState('idle'),down:inState('down'),serviceDue:d.serviceDue,downtime:d.downtime,
    maintenance:s.maintenanceOrders.filter(m=>m.status==='Jarayonda')}

  // Who is working, and is production costing more than planned?
  const live=laborNow(s)
  const labor={operators:live.operators,operations:live.operations,minutes:loggedMinutes(s,P.labor,now)}
  const wipCosted=d.open.map(o=>orderCosting(s,o))
  const wipPlanned=wipCosted.reduce((a,c)=>a+c.earned,0),wipActual=wipCosted.reduce((a,c)=>a+c.actual.total,0)
  const wip={orders:wipCosted.length,planned:wipPlanned,actual:wipActual,variance:wipActual-wipPlanned}
  const costSince=periodStart(P.cost)
  const over=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&(o.completedAt||'').slice(0,10)>=costSince)
    .map(order=>({order,costing:orderCosting(s,order)})).filter(x=>x.costing.variancePct>COST_VARIANCE_ALERT)
    .sort((a,b)=>b.costing.variancePct-a.costing.variancePct)
  const cost={...d.cost,over}

  // What needs action now? Only real exceptions; each one opens the list it counts. Critical ones first.
  const {overdue,risky}=d.delivery
  const exceptions=([
    {id:'late',tone:'danger',count:overdue.length,items:overdue.map(o=>o.code)},
    // Orders that will miss their date without being late yet; the count is the whole risk list (Orders ?risk=1).
    {id:'risk',tone:'warning',count:risky.length>overdue.length?risky.length:0,items:risky.map(o=>o.code)},
    {id:'shortage',tone:materials.critical.length?'danger':'warning',count:materials.shortages.length,items:materials.shortages.map(r=>r.m.name)},
    {id:'qc',tone:'danger',count:quality.failed.length,items:quality.failed.map(q=>itemName(s,q.itemId))},
    {id:'down',tone:'danger',count:d.downtime.open.length,items:d.downtime.open.map(e=>machineName(e.equipmentId))},
    {id:'overload',tone:'warning',count:capacity.overloaded.length,items:capacity.overloaded.map(l=>`${l.workCenter.name} ${l.utilization}%`)},
    {id:'blocked',tone:'warning',count:blocked.length,items:blocked.map(x=>x.order.code)},
    {id:'service',tone:'warning',count:d.serviceDue.length,items:d.serviceDue.map(e=>e.name)},
    {id:'cost',tone:'warning',count:over.length,items:over.map(x=>`${x.order.code} +${x.costing.variancePct}%`)},
  ] as ControlException[]).filter(e=>e.count>0).sort((a,b)=>Number(b.tone==='danger')-Number(a.tone==='danger'))

  // What just happened on the floor? Newest first (the log is not stored in date order).
  const activity=s.activity.filter(a=>CONTROL_ACTIVITY_MODULES.includes(a.module)).sort((x,y)=>y.date.localeCompare(x.date))

  return {today,open:d.open,risky,overdue,queue,queueCounts,blocked,delivery,
    materials,plan:weekPlan,dayPlan,capacity,output,quality,equipment,labor,cost,wip,exceptions,activity}
}

export type ProductionControl=ReturnType<typeof productionControl>
