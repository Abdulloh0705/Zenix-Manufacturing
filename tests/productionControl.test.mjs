import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {dashboardSnapshot} from '../.test-dist/dashboard.mjs'
import {CONTROL_ACTIVITY_MODULES,CONTROL_PERIODS as P,COST_VARIANCE_ALERT,QUEUE_FILTERS,productionControl} from '../.test-dist/productionControl.mjs'
import {ORDER_URGENCY,calculateCapacityLoads,capacityConstraints,createMpsRows,createMrpPlan,deliveryRisk,equipmentActivity,isOpenOrder,materialShortages,operationQueues,orderBlocker,orderCosting,orderMaterialLines,scrapEvents} from '../.test-dist/manufacturingEngine.mjs'
import {addDays,periodStart,todayISO} from '../.test-dist/dates.mjs'

let counter=0
const fresh=()=>createSeedState(new Date())
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-c${++counter}`})
const close=(a,b)=>Math.abs(a-b)<1e-6
const run=out=>{assert.ok(out.result.ok,out.result.message);return out.state}

test('order queue lists every open order, most urgent first, and its quick filters equal the Orders page filters',()=>{
  const s=fresh(),c=productionControl(s),today=todayISO()
  const open=s.productionOrders.filter(isOpenOrder)
  assert.equal(c.queue.length,open.length)
  const ranks=c.queue.map(x=>ORDER_URGENCY.indexOf(x.urgency))
  assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b),'urgency never decreases down the queue')
  // Production Orders: status=open + due=today / due=overdue / status=<status>
  assert.deepEqual(Object.keys(c.queueCounts),[...QUEUE_FILTERS])
  assert.equal(c.queueCounts.all,open.length)
  assert.equal(c.queueCounts.today,open.filter(o=>o.due===today).length)
  assert.equal(c.queueCounts.late,open.filter(o=>o.due<today).length)
  for(const [key,status] of [['material','Material kutilmoqda'],['running','Jarayonda'],['paused','Pauzada']])assert.equal(c.queueCounts[key],s.productionOrders.filter(o=>o.status===status).length,status)
  // "Riskda" → Orders ?risk=1, "Kritik" → Orders ?priority=Kritik
  assert.equal(c.risky.length,open.filter(o=>deliveryRisk(s,o)).length)
  assert.equal(c.queue.filter(x=>x.risk).length,c.risky.length)
  assert.equal(c.queueCounts.risk,c.risky.length)
  assert.equal(c.queueCounts.critical,open.filter(o=>o.priority==='Kritik').length)
  // The operation shown under the status is the order's own routing position.
  for(const x of c.queue){
    const pending=x.order.workOrders.filter(w=>w.status!=='Yakunlangan')
    assert.equal(Boolean(x.operation),pending.length>0,x.order.code)
    if(!x.operation)continue
    assert.equal(x.operation.done+pending.length,x.operation.total)
    const running=x.order.workOrders.find(w=>w.status==='Jarayonda')
    if(running)assert.deepEqual([x.operation.state,x.operation.workOrder.id],['running',running.id])
  }
  // Blocked orders → Orders ?blocked=1
  assert.equal(c.blocked.length,open.filter(o=>orderBlocker(s,o)).length)
  assert.ok(c.blocked.length>0,'seed has an order on quality hold')
})

test('material status is the MRP netting and the waiting orders of the Orders page',()=>{
  const s=fresh(),c=productionControl(s),plan=createMrpPlan(s)
  // Shortage figure → MRP ?short=1 (Buy table rows with "Yetishmaydi")
  assert.equal(c.materials.short.length,plan.purchases.filter(p=>p.shortage>0).length)
  for(const r of c.materials.rows){
    const p=plan.purchases.find(x=>x.materialId===r.id),st=s.stockBalances.filter(b=>b.itemId===r.id)
    assert.ok(close(r.available,p.available)&&close(r.incoming,p.incoming)&&close(r.shortage,p.shortage),r.m.name)
    assert.ok(close(r.reserved,st.reduce((a,b)=>a+b.reserved,0)),`${r.m.name} reserved`)
  }
  // KPI + "Diqqat" → Xomashyo → Yetishmovchiliklar (MRP shortage or below the reorder point) — the dashboard's figure
  const act=materialShortages(s,plan)
  assert.deepEqual(c.materials.shortages.map(r=>r.id),act.map(r=>r.id))
  assert.deepEqual(c.materials.shortages.map(r=>r.id),dashboardSnapshot(s).materials.shortages.map(r=>r.id))
  assert.deepEqual(c.materials.critical.map(r=>r.id),act.filter(r=>r.critical).map(r=>r.id))
  assert.ok(c.materials.short.every(r=>c.materials.shortages.some(x=>x.id===r.id)),'every MRP shortage is a material to act on')
  // Row colour follows the same levels: critical / below reorder / ok
  for(const r of c.materials.rows)assert.equal(r.level,act.find(x=>x.id===r.id)?.critical?'critical':act.some(x=>x.id===r.id)?'low':'ok',r.m.name)
  assert.deepEqual(c.materials.waiting.map(w=>w.order.id),s.productionOrders.filter(o=>o.status==='Material kutilmoqda').map(o=>o.id))
  for(const w of c.materials.waiting)assert.deepEqual(w.missing.map(l=>l.component.materialId),orderMaterialLines(s,w.order).filter(l=>l.shortage>0).map(l=>l.component.materialId))
})

test('production plan is the first MPS week plus finished receipts since Monday',()=>{
  const s=fresh(),c=productionControl(s),mps=createMpsRows(s)
  assert.equal(c.plan.products.length,mps.length)
  assert.equal(c.plan.remaining,mps.reduce((a,r)=>a+r.weeks[0].scheduled,0),'Qoldi = MPS "Rejada (MO)" of the first week')
  assert.equal(c.plan.suggested,mps.reduce((a,r)=>a+r.weeks[0].suggested,0))
  const made=new Set(mps.map(r=>r.product.id))
  const received=s.stockMovements.filter(m=>m.type==='Production +'&&made.has(m.itemId)&&m.date.slice(0,10)>=c.plan.week).reduce((a,m)=>a+m.qty,0)
  assert.equal(c.plan.produced,Math.round(received))
  assert.equal(c.plan.planned,c.plan.produced+c.plan.remaining)
  assert.ok(c.plan.completion===null||(c.plan.completion>=0&&c.plan.completion<=100))
  for(const p of c.plan.products)assert.equal(p.planned,p.produced+p.remaining,p.product.name)
})

test('today plan is the daily share of the orders in progress against today receipts, and on-time is the dashboard figure',()=>{
  const s=fresh(),c=productionControl(s),d=dashboardSnapshot(s),today=todayISO()
  // Totals are the KPI figures (dashboard trend: today's column and its plan tick)
  assert.equal(c.dayPlan.planned,d.output.plannedToday)
  assert.equal(c.dayPlan.produced,d.output.today)
  assert.equal(c.dayPlan.remaining,Math.max(0,c.dayPlan.planned-c.dayPlan.produced))
  assert.ok(Math.abs(c.dayPlan.products.reduce((a,p)=>a+p.planned,0)-c.dayPlan.planned)<=c.dayPlan.products.length,'per-product plan adds up (rounding only)')
  assert.ok(Math.abs(c.dayPlan.products.reduce((a,p)=>a+p.produced,0)-c.dayPlan.produced)<=c.dayPlan.products.length)
  for(const p of c.dayPlan.products){
    const received=s.stockMovements.filter(m=>m.type==='Production +'&&m.itemId===p.product.id&&m.date.slice(0,10)===today&&!m.note.includes('By-product')).reduce((a,m)=>a+m.qty,0)
    assert.equal(p.produced,Math.round(received),p.product.name)
  }
  const mo=s.productionOrders.find(o=>o.status==='Jarayonda')
  const after=productionControl(run(A.reportOutput(s,ctx(s),mo.id,10,0,'')))
  assert.equal(after.dayPlan.produced,c.dayPlan.produced+10)
  // On-time → Reports ?view=production&days=30 ("Vaqtida yakunlash")
  const done=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&(o.completedAt||'').slice(0,10)>=periodStart(P.onTime))
  assert.equal(c.delivery.completed,done.length)
  assert.equal(c.delivery.onTime,done.filter(o=>o.completedAt.slice(0,10)<=o.due).length)
  assert.equal(c.delivery.rate,d.delivery.rate)
})

test('work centers today: load, free capacity, queue and current operation equal Capacity and Operatsiyalar',()=>{
  const s=fresh(),c=productionControl(s)
  const loads=calculateCapacityLoads(s,P.capacity),queues=operationQueues(s)
  assert.equal(c.capacity.loads.length,s.workCenters.length)
  for(const l of c.capacity.loads){
    const base=loads.find(x=>x.workCenter.id===l.workCenter.id),q=queues.find(x=>x.workCenter.id===l.workCenter.id).queue
    assert.deepEqual([l.today.load,l.today.capacity,l.today.utilization],[base.days[0].load,base.days[0].capacity,base.days[0].utilization],l.workCenter.name)
    assert.equal(l.today.free,Math.max(0,l.today.capacity-l.today.load))
    assert.equal(l.today.over,Math.max(0,l.today.load-l.today.capacity))
    assert.equal(l.queue.length,q.length,'queue = Operatsiyalar ?wc=')
    assert.equal(l.current?.workOrder.id,q.find(x=>x.workOrder.status==='Jarayonda')?.workOrder.id)
  }
  // Strip: first day column of Capacity ("Jami"), and the open operations of Operatsiyalar
  const load=loads.reduce((a,l)=>a+l.days[0].load,0),capacity=loads.reduce((a,l)=>a+l.days[0].capacity,0)
  assert.deepEqual([c.capacity.today.load,c.capacity.today.capacity],[load,capacity])
  assert.equal(c.capacity.today.utilization,capacity?Math.round(load/capacity*100):0)
  assert.equal(c.capacity.operations,queues.reduce((a,q)=>a+q.queue.length,0))
  assert.ok(c.capacity.loads.some(l=>l.current),'seed has an operation in progress on a work center')
})

test('bottleneck comes from the capacity calculation — none is invented, an overload is found',()=>{
  const s=fresh(),c=productionControl(s)
  const constraints=capacityConstraints(calculateCapacityLoads(s,P.capacity))
  assert.equal(c.capacity.constraints.length,constraints.length)
  assert.equal(c.capacity.bottleneck?.workCenter.id,constraints[0]?.workCenter.id)
  assert.ok(constraints.every(l=>l.down||l.overloaded||l.utilization>85))
  // A large order due tomorrow overloads its work centers.
  const big=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:9000})
  const heavy=productionControl(run(big))
  assert.ok(heavy.capacity.bottleneck,'an overloaded work center is named')
  const b=heavy.capacity.bottleneck
  assert.ok(b.overloaded&&b.shortage>0&&b.overDays>0)
  assert.equal(b.shortage,b.days.reduce((a,x)=>a+Math.max(0,x.load-x.capacity),0))
  assert.ok(heavy.exceptions.some(e=>e.id==='overload'&&e.count===heavy.capacity.overloaded.length))
  // Queue and late operations → Operatsiyalar ?wc=
  const queue=operationQueues(big.state).find(q=>q.workCenter.id===b.workCenter.id).queue
  assert.equal(b.queue.length,queue.length)
  assert.equal(b.delayed,queue.filter(x=>deliveryRisk(big.state,x.order)).length)
})

test('quality, output and scrap follow the inspections and postings of the day',()=>{
  const s=fresh(),c=productionControl(s),d=dashboardSnapshot(s),since=periodStart(P.quality)
  // QC cells → Quality → Tekshiruvlar ?status=&range=7 (Pending: all open inspections)
  const inPeriod=status=>s.qualityChecks.filter(q=>q.status===status&&q.date.slice(0,10)>=since).length
  assert.equal(c.quality.pending.length,s.qualityChecks.filter(q=>q.status==='Pending').length)
  for(const [key,status] of [['passed','Passed'],['failed','Failed'],['rework','Rework'],['scrap','Scrap']])assert.equal(c.quality[key].length,inPeriod(status),status)
  assert.equal(c.quality.passed.length+c.quality.failed.length+c.quality.rework.length+c.quality.scrap.length,c.quality.checks)
  assert.equal(c.quality.passRate,d.quality.passRate)
  // Output: good = today's finished receipts (KPI), scrap = today's scrap postings
  assert.equal(c.output.good,d.output.today)
  assert.equal(scrapEvents(s).reduce((a,e)=>a+e.qty,0),s.productionOrders.reduce((a,o)=>a+o.scrap,0),'every scrapped unit has a dated posting')
  const mo=s.productionOrders.find(o=>o.status==='Jarayonda')
  const after=productionControl(run(A.reportOutput(s,ctx(s),mo.id,10,3,'Operator xatosi')))
  assert.equal(after.output.good,c.output.good+10)
  assert.equal(after.output.scrap,c.output.scrap+3)
  assert.equal(after.output.yield,Math.round(after.output.good/(after.output.good+after.output.scrap)*100))
  // Rework: units of rework orders created today → Quality → Rework ?range=1
  const reworked=productionControl(run(A.createReworkOrder(s,ctx(s),mo.id,7,'Qoplama nuqsoni')))
  assert.equal(reworked.output.rework,c.output.rework+7)
})

test('equipment status partitions the machines and follows downtime',()=>{
  const s=fresh(),c=productionControl(s)
  const {running,idle,down,machines}=c.equipment
  assert.equal(running.length+idle.length+down.length,s.equipment.length)
  assert.equal(machines.length,s.equipment.length)
  assert.ok(running.every(m=>m.job&&m.job.workOrder.status==='Jarayonda'&&m.job.workOrder.workCenterId===m.equipment.workCenterId))
  assert.ok(running.length>0,'seed has an operation in progress')
  assert.equal(c.equipment.downtime.minutes,dashboardSnapshot(s).downtime.minutes)
  // "Ta’mirda" → Uskunalar → Maintenance ?status=Jarayonda
  assert.equal(c.equipment.maintenance.length,s.maintenanceOrders.filter(m=>m.status==='Jarayonda').length)
  const busy=running[0].equipment
  const stopped=productionControl(run(A.startDowntime(s,ctx(s),busy.id,'Unplanned stop','control test')))
  assert.equal(stopped.equipment.down.length,down.length+1)
  assert.equal(stopped.equipment.running.length,running.length-1,'the stopped machine no longer runs')
  assert.ok(stopped.exceptions.some(e=>e.id==='down'&&e.count===stopped.equipment.downtime.open.length))
  assert.ok(stopped.blocked.some(x=>x.blocker==='machine'),'its order is blocked by the stopped machine')
  assert.equal(equipmentActivity(s).filter(m=>m.activity==='down').length,s.equipment.filter(e=>e.status==='To‘xtagan').length)
})

test('labor and cost come from time logs and the costing engine',()=>{
  const s=fresh(),now=new Date(),c=productionControl(s,now),d=dashboardSnapshot(s)
  const openLogs=s.timeLogs.filter(t=>!t.end)
  assert.deepEqual([...c.labor.operators].sort(),[...new Set(openLogs.map(t=>t.employeeId))].sort())
  assert.equal(c.labor.operations.length,s.productionOrders.reduce((a,o)=>a+o.workOrders.filter(w=>w.status==='Jarayonda').length,0))
  assert.ok(c.labor.minutes>0)
  // Completed orders → Costs ?view=costing&status=closed&range=30; open orders → ?status=open
  for(const key of ['orders','planned','actual','variance','variancePct'])assert.equal(c.cost[key],d.cost[key],key)
  // Over plan = the red rows of Costs ?view=costing&status=closed&range=30 (variance above the alert level)
  const closed=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&(o.completedAt||'').slice(0,10)>=periodStart(P.cost))
  assert.equal(closed.length,c.cost.orders)
  assert.deepEqual(c.cost.over.map(x=>x.order.id).sort(),closed.filter(o=>orderCosting(s,o).variancePct>COST_VARIANCE_ALERT).map(o=>o.id).sort())
  assert.equal(COST_VARIANCE_ALERT,5,'Costs.tsx marks rows above 5% — keep both in step')
  const open=s.productionOrders.filter(isOpenOrder).map(o=>orderCosting(s,o))
  assert.equal(c.wip.orders,open.length)
  assert.ok(close(c.wip.actual,open.reduce((a,x)=>a+x.actual.total,0)))
  assert.ok(close(c.wip.planned,open.reduce((a,x)=>a+x.earned,0)))
  assert.ok(close(c.wip.variance,c.wip.actual-c.wip.planned))
})

test('exceptions list only real problems and each count equals its source',()=>{
  const s=fresh(),c=productionControl(s)
  assert.ok(c.exceptions.every(e=>e.count>0&&e.items.length===e.count))
  const by=id=>c.exceptions.find(e=>e.id===id)?.count??0
  assert.equal(by('late'),c.overdue.length)
  assert.equal(by('shortage'),c.materials.shortages.length)
  assert.equal(by('risk'),c.risky.length>c.overdue.length?c.risky.length:0,'risk row only when something is at risk without being late')
  assert.equal(by('cost'),c.cost.over.length)
  const tones=c.exceptions.map(e=>e.tone==='danger'?0:1)
  assert.deepEqual(tones,[...tones].sort((a,b)=>a-b),'critical exceptions come first')
  assert.equal(by('qc'),c.quality.failed.length)
  assert.equal(by('down'),c.equipment.downtime.open.length)
  assert.equal(by('overload'),c.capacity.overloaded.length)
  assert.equal(by('blocked'),c.blocked.length)
  assert.equal(by('service'),c.equipment.serviceDue.length)
})

test('a late order and an at-risk order are separate exceptions with their own lists',()=>{
  const s=fresh(),today=todayISO()
  // Push one open, material-ready order past its due date.
  const victim=s.productionOrders.find(o=>isOpenOrder(o)&&o.status!=='Material kutilmoqda')
  const late={...s,productionOrders:s.productionOrders.map(o=>o.id===victim.id?{...o,start:addDays(today,-5),due:addDays(today,-2)}:o)}
  const c=productionControl(late)
  const by=id=>c.exceptions.find(e=>e.id===id)
  assert.equal(by('late').count,c.overdue.length)
  assert.ok(by('late').items.includes(victim.code))
  assert.equal(c.queueCounts.late,c.overdue.length)
  // The seed's material-waiting order is at risk without being late → the risk row counts the whole ?risk=1 list.
  assert.ok(c.risky.length>c.overdue.length)
  assert.equal(by('risk').count,c.risky.length)
  assert.equal(by('risk').items.length,c.risky.length)
})

test('activity feed shows only shop-floor modules, newest first',()=>{
  const s=fresh(),c=productionControl(s)
  assert.ok(c.activity.length>0)
  assert.ok(c.activity.every(a=>CONTROL_ACTIVITY_MODULES.includes(a.module)))
  assert.equal(c.activity.length,s.activity.filter(a=>CONTROL_ACTIVITY_MODULES.includes(a.module)).length)
  const dates=c.activity.map(a=>a.date)
  assert.deepEqual(dates,[...dates].sort().reverse())
  const stopped=productionControl(run(A.startDowntime(s,ctx(s),s.equipment[0].id,'Unplanned stop','feed test')))
  assert.equal(stopped.activity[0].action,'Downtime boshlandi')
})
