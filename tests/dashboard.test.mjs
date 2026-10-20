import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {DASHBOARD_PERIODS as P,dashboardSnapshot} from '../.test-dist/dashboard.mjs'
import {calculateCapacityLoads,downtimeInPeriod,isDefect,materialShortages,orderCosting,productionOee} from '../.test-dist/manufacturingEngine.mjs'
import {periodStart} from '../.test-dist/dates.mjs'

let counter=0
const fresh=()=>createSeedState(new Date())
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-d${++counter}`})
const close=(a,b)=>Math.abs(a-b)<1e-6

test('periodStart counts N calendar days including today',()=>{
  assert.equal(periodStart(1,'2026-09-29'),'2026-09-29')
  assert.equal(periodStart(7,'2026-09-29'),'2026-09-23')
  assert.equal(periodStart(30,'2026-09-29'),'2026-08-31')
})

test('dashboard figures equal the rows or totals of the page each one opens',()=>{
  const s=fresh(),d=dashboardSnapshot(s)
  // Order status legend → Production Orders ?status=
  for(const p of d.pipeline)assert.equal(p.count,s.productionOrders.filter(o=>o.status===p.status).length,p.status)
  assert.equal(d.pipeline.reduce((a,p)=>a+p.count,0),d.open.length,'pipeline covers every open order')
  // Material shortage KPI → Materials ?view=shortages; state chips partition every raw material
  assert.equal(d.materials.shortages.length,materialShortages(s).length)
  assert.equal(d.materials.states.reduce((a,x)=>a+x.count,0),s.rawMaterials.length)
  // Downtime KPI → Equipment ?view=downtime&range=7
  assert.equal(d.downtime.minutes,downtimeInPeriod(s,P.downtime).reduce((a,e)=>a+e.minutes,0))
  assert.ok(d.downtime.minutes>0,'seed has downtime inside the window')
  // Cost KPI → Costs ?view=costing&status=closed&range=30 (totals line)
  const since=periodStart(P.cost)
  const closed=s.productionOrders.filter(o=>o.status==='Yakunlangan'&&(o.completedAt||'').slice(0,10)>=since).map(o=>orderCosting(s,o))
  assert.equal(d.cost.orders,closed.length)
  assert.ok(close(d.cost.actual,closed.reduce((a,c)=>a+c.actual.total,0)))
  assert.ok(close(d.cost.planned,closed.reduce((a,c)=>a+c.earned,0)))
  assert.ok(close(d.cost.variance,d.cost.actual-d.cost.planned))
  // Capacity → Planning ?mode=Capacity total row (same 7-day horizon)
  const loads=calculateCapacityLoads(s,7)
  const load=loads.reduce((a,l)=>a+l.days.reduce((x,y)=>x+y.load,0),0),cap=loads.reduce((a,l)=>a+l.days.reduce((x,y)=>x+y.capacity,0),0)
  assert.equal(d.capacity.utilization,Math.round(load/cap*100))
  assert.equal(d.capacity.overloaded.length,loads.filter(l=>l.overloaded).length)
  // Quality defects → Quality ?view=defects&range=7; OEE → Reports ?view=oee&days=7
  assert.equal(d.quality.defects.length,s.qualityChecks.filter(q=>isDefect(q)&&q.date.slice(0,10)>=periodStart(P.quality)).length)
  assert.deepEqual(d.oee,productionOee(s,P.oee))
})

test('dashboard has no numbers of its own — it follows domain actions',()=>{
  const s=fresh(),before=dashboardSnapshot(s)
  const stopped=A.startDowntime(s,ctx(s),'eq1','Unplanned stop','dashboard test')
  assert.ok(stopped.result.ok,stopped.result.message)
  const after=dashboardSnapshot(stopped.state)
  assert.equal(after.downtime.open.length,before.downtime.open.length+1,'open stop appears as an attention signal')
  const created=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:40})
  assert.ok(created.result.ok,created.result.message)
  const draft=dashboardSnapshot(created.state).pipeline.find(p=>p.status==='Qoralama')
  assert.equal(draft.count,before.pipeline.find(p=>p.status==='Qoralama').count+1,'a new draft MO is counted once')
})
