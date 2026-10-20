import type {ManufacturingState,ProductionStatus} from '../types'
import {MATERIAL_STOCK_STATES,awaitsRework,calculateCapacityLoads,capacityConstraints,createMrpPlan,deliveryRisk,downtimeSummary,isDefect,isOpenOrder,materialShortages,materialStockRows,orderCosting,outputByDay,productionOee} from './manufacturingEngine'
import {addDays,periodStart,todayISO} from '../utils/dates'

/**
 * Manufacturing dashboard — a read-only analysis layer. Every figure is derived here from the source
 * modules (production orders, MRP, inventory, quality, maintenance, work centers, costing) with the
 * same rules as the page it links to, so a dashboard number equals the rows or total behind the click.
 */

/** Periods (days, including today) behind each dashboard figure; links pass the same value as a filter. */
export const DASHBOARD_PERIODS={oee:7,quality:7,downtime:7,capacity:7,onTime:30,cost:30} as const

/** Open production pipeline in workflow order. */
export const PIPELINE_STATUSES:ProductionStatus[]=['Qoralama','Material kutilmoqda','Tasdiqlangan','Jarayonda','Pauzada','Sifat nazoratida']

const inPeriod=(value:string|undefined,since:string)=>Boolean(value)&&value!.slice(0,10)>=since

export function dashboardSnapshot(s:ManufacturingState,trendDays=7){
  const P=DASHBOARD_PERIODS,today=todayISO()
  const orders=s.productionOrders
  const open=orders.filter(isOpenOrder)
  const countOf=(status:ProductionStatus)=>orders.filter(o=>o.status===status).length

  // How much did we produce? (finished-goods receipts vs. the plan spread over each order's window)
  const trend=outputByDay(s,trendDays)
  const week=trendDays===7?trend:outputByDay(s,7)
  const output={
    today:week[week.length-1]?.produced??0,plannedToday:week[week.length-1]?.planned??0,week:week.reduce((a,d)=>a+d.produced,0),
    trend,trendProduced:trend.reduce((a,d)=>a+d.produced,0),trendPlanned:trend.reduce((a,d)=>a+d.planned,0),
  }

  // Are production orders on time?
  const onTimeSince=periodStart(P.onTime)
  const completed=orders.filter(o=>o.status==='Yakunlangan'&&inPeriod(o.completedAt,onTimeSince))
  const onTime=completed.filter(o=>(o.completedAt||'').slice(0,10)<=o.due).length
  const delivery={completed:completed.length,onTime,rate:completed.length?Math.round(onTime/completed.length*100):null,
    risky:open.filter(o=>deliveryRisk(s,o)),overdue:open.filter(o=>o.due<today)}
  const pipeline=PIPELINE_STATUSES.map(status=>({status,count:countOf(status)}))

  // Are we missing materials? Is stock healthy?
  const shortages=materialShortages(s,createMrpPlan(s))
  const stock=materialStockRows(s)
  const materials={shortages,critical:shortages.filter(r=>r.critical),waiting:open.filter(o=>o.status==='Material kutilmoqda'),
    stock,states:MATERIAL_STOCK_STATES.map(state=>({state,count:stock.filter(r=>r.state===state).length}))}

  // Are work centers overloaded? (same 7-day finite-capacity horizon as Planning → Capacity)
  const loads=calculateCapacityLoads(s,P.capacity)
  const dayTotals=(pick:(d:{load:number;capacity:number})=>number)=>loads.reduce((a,l)=>a+l.days.reduce((x,d)=>x+pick(d),0),0)
  const loadMin=dayTotals(d=>d.load),capacityMin=dayTotals(d=>d.capacity)
  const constraints=capacityConstraints(loads)
  const capacity={loads,loadMinutes:loadMin,capacityMinutes:capacityMin,freeMinutes:dayTotals(d=>Math.max(0,d.capacity-d.load)),
    utilization:capacityMin?Math.round(loadMin/capacityMin*100):0,overloaded:loads.filter(l=>l.overloaded),
    // Centers that limit the plan (stopped, over capacity on a day, or in the >85% band of Planning → Capacity); the worst is the bottleneck.
    constraints,bottleneck:constraints[0]}

  // How efficient is production? Are there quality problems? Are machines stopping?
  const oee=productionOee(s,P.oee)
  const qualitySince=periodStart(P.quality)
  const checks=s.qualityChecks.filter(q=>q.status!=='Pending'&&inPeriod(q.date,qualitySince))
  const passed=checks.filter(q=>q.status==='Passed').length
  const quality={checks:checks.length,passed,passRate:checks.length?Math.round(passed/checks.length*100):null,resolved:checks,
    defects:s.qualityChecks.filter(q=>isDefect(q)&&inPeriod(q.date,qualitySince)),
    pending:s.qualityChecks.filter(q=>q.status==='Pending'),rework:s.qualityChecks.filter(awaitsRework)}
  const downtime=downtimeSummary(s,P.downtime)

  // Is production costing more than planned? Completed orders: actual vs standard (Costing → Tannarx).
  const costSince=periodStart(P.cost)
  const costed=orders.filter(o=>o.status==='Yakunlangan'&&inPeriod(o.completedAt,costSince)).map(o=>orderCosting(s,o))
  const planned=costed.reduce((a,c)=>a+c.earned,0),actual=costed.reduce((a,c)=>a+c.actual.total,0)
  const cost={orders:costed.length,planned,actual,variance:actual-planned,variancePct:planned?Math.round((actual-planned)/planned*1000)/10:0}

  // Maintenance due within three days (Uskunalar → Preventive badges).
  const serviceDue=s.equipment.filter(e=>e.nextMaintenance<=addDays(today,3))

  return {today,open,output,delivery,pipeline,closed:{done:countOf('Yakunlangan'),cancelled:countOf('Bekor qilingan')},
    materials,capacity,oee,quality,downtime,cost,serviceDue}
}

export type DashboardSnapshot=ReturnType<typeof dashboardSnapshot>
