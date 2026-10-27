import test from 'node:test'
import assert from 'node:assert/strict'
import {
  availableQuantity,
  calculateOEE,
  calculateCapacityLoads,
  createMpsRows,
  mpsCapacityByWeek,
  projectedStock,
  stockOf,
  createMrpRows,
  createMrpPlan,
  buildTraceability,
  explodeBomRequirements,
  findTraceOrder,
  productionOee,
  orderCosting,
} from '../.test-dist/manufacturingEngine.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
const seedState=createSeedState()

test('available quantity never drops below zero',()=>{
  assert.equal(availableQuantity({onHand:20,reserved:7}),13)
  assert.equal(availableQuantity({onHand:3,reserved:9}),0)
})

test('OEE combines availability, performance and quality',()=>{
  const oee=calculateOEE({plannedMinutes:480,downtimeMinutes:48,idealCycleMinutes:1,totalCount:400,goodCount:380})
  assert.equal(oee.availability,90)
  assert.equal(oee.quality,95)
  assert.equal(oee.performance,93)
  assert.equal(oee.oee,79)
})

test('MPS rows cover manufactured products and never suggest negative quantities',()=>{
  const rows=createMpsRows(seedState)
  const made=seedState.products.filter(p=>p.procurement!=='buy'&&p.status!=='Arxiv')
  assert.equal(rows.length,made.length)
  assert.ok(rows.every(r=>r.required>=0&&r.suggested>=0&&r.weeks.length===4))
  assert.ok(rows.every(r=>Number.isInteger(r.suggested)),'default prototype planning rounds suggestions to whole units, not a hardcoded lot of 50')
})

test('MPS demand per week is max(forecast, make-to-stock sales) + make-to-order sales',()=>{
  const rows=createMpsRows(seedState)
  for(const r of rows)for(const w of r.weeks){
    assert.ok(w.mto>=0&&w.mto<=w.sales)
    assert.equal(w.demand,Math.max(w.forecast,w.sales-w.mto)+w.mto)
    if(!w.mto)assert.equal(w.demand,Math.max(w.forecast,w.sales),'without make-to-order lines the rule is unchanged')
  }
})

test('MRP rows calculate raw-material shortages and recommendations',()=>{
  const rows=createMrpRows(seedState)
  assert.ok(rows.every(r=>r.materials.every(m=>m.required>=0&&m.shortage>=0)))
  assert.ok(rows.some(r=>r.materials.length>0))
})

test('multi-level MRP explodes sub-assembly demand into its own planned order',()=>{
  const state=structuredClone(seedState)
  // wipe sub-assembly stock so the parent plan must create dependent demand for p3
  state.stockBalances=state.stockBalances.map(b=>b.itemId==='p3'?{...b,onHand:0,reserved:0}:b)
  state.productionOrders=state.productionOrders.filter(o=>o.productId!=='p3')
  const plan=createMrpPlan(state)
  const parent=plan.planned.find(p=>p.productId==='p2')
  const child=plan.planned.find(p=>p.productId==='p3')
  assert.ok(parent&&parent.qty>0,'p2 is planned')
  assert.ok(child&&child.level>parent.level,'p3 is planned at a deeper BOM level')
})

test('capacity loads are derived from open work orders over a finite horizon',()=>{
  const rows=calculateCapacityLoads(seedState)
  assert.equal(rows.length,seedState.workCenters.length)
  assert.ok(rows.every(r=>r.loadMinutes>=0&&r.capacityMinutes>0&&r.utilization>=0&&r.days.length===5))
  assert.ok(rows.some(r=>r.loadMinutes>0))
})

test('OEE is computed from logged work-order time and downtime events',()=>{
  const oee=productionOee(seedState)
  assert.ok(oee.oee>0&&oee.oee<=100)
  assert.ok(oee.availability<100,'seeded downtime reduces availability')
})

test('traceability links production to consumed lots, supplier POs and downstream sales',()=>{
  const done=seedState.productionOrders.filter(o=>o.status==='Yakunlangan'&&o.productId==='p1')
  const order=done[done.length-1]
  const trace=buildTraceability(seedState,order.id)
  assert.equal(trace.order?.id,order.id)
  assert.ok(trace.upstreamLots.length>0,'consumed raw lots are known')
  assert.ok(trace.outputLots.length>0,'finished lot is recorded')
  assert.ok(trace.qualityChecks.some(q=>q.type==='Final'&&q.status==='Passed'))
  assert.equal(findTraceOrder(seedState,order.lot)?.id,order.id,'lot code resolves to its order')
})

test('serial numbers resolve to the producing order',()=>{
  const serialLot=seedState.lots.find(l=>l.kind==='serial')
  assert.ok(serialLot)
  const middle=serialLot.serialFrom.replace(/\d+$/,d=>String(Number(d)+1).padStart(d.length,'0'))
  assert.equal(findTraceOrder(seedState,middle)?.id,serialLot.sourceId)
})

test('costing compares planned vs actual for completed orders',()=>{
  const order=seedState.productionOrders.find(o=>o.status==='Yakunlangan')
  const c=orderCosting(seedState,order)
  assert.ok(c.actual.material>0&&c.actual.labor>0&&c.actual.machine>0)
  assert.ok(Math.abs(c.variancePct)<25)
})

test('report serializer escapes CSV cells safely',async()=>{
  const {toCsv}=await import('../.test-dist/exportData.mjs')
  assert.equal(toCsv([{name:'A, B',note:'He said "ok"'}]),'name,note\r\n"A, B","He said ""ok"""')
})

test('multi-level BOM explosion rolls sub-assemblies into raw-material demand',()=>{
  const state=structuredClone(seedState)
  state.boms.push({
    id:'bom-sub',code:'BOM-SUB',productId:'p4',version:'v1',revision:1,status:'Faol',effectiveDate:'2026-09-01',waste:0,
    components:[{id:'sub-c1',materialId:'rm1',qty:2,unit:'kg',waste:10}],operations:[],notes:''
  })
  const parent={...state.boms[0],id:'bom-parent-test',productId:'p1',components:[{id:'parent-c1',materialId:'p4',qty:3,unit:'dona',waste:0,subBomId:'bom-sub'}]}
  state.boms=[parent,...state.boms.filter(b=>b.productId!=='p1')]
  state.products=state.products.map(p=>p.id==='p1'?{...p,defaultBomId:parent.id}:p)
  const exploded=explodeBomRequirements(state,parent.id,5)
  assert.equal(exploded.length,1)
  assert.equal(exploded[0].materialId,'rm1')
  assert.ok(Math.abs(exploded[0].required-33)<1e-9)
})

test('MPS rough-cut capacity sums routing minutes of planned quantities per week',()=>{
  const state=seedState
  const rows=createMpsRows(state)
  const weeks=mpsCapacityByWeek(state,rows)
  assert.equal(weeks.length,rows[0].weeks.length)
  for(const w of weeks){assert.ok(w.load>=0);assert.ok(w.capacity>0);assert.equal(w.utilization,Math.round(w.load/w.capacity*100))}
  const empty=mpsCapacityByWeek(state,rows.map(r=>({...r,weeks:r.weeks.map(w=>({...w,scheduled:0,suggested:0}))})))
  assert.ok(empty.every(w=>w.load===0))
})

test('projected stock nets unreserved open demand against available and incoming',()=>{
  const state=seedState
  for(const item of [...state.rawMaterials,...state.products]){
    const p=projectedStock(state,item.id),st=stockOf(state,item.id)
    assert.ok(p.demand>=0)
    assert.equal(p.projected,st.available+st.incoming-p.demand)
  }
  const waiting=state.productionOrders.find(o=>o.status==='Material kutilmoqda'&&!o.materialReserved)
  if(waiting){const m=waiting.bomSnapshot.components[0].materialId;assert.ok(projectedStock(state,m).demand>0)}
})

test('costing reports the cost absorbed by scrap without adding it twice',()=>{
  for(const o of seedState.productionOrders){
    const c=orderCosting(seedState,o)
    assert.ok(c.waste>=0&&c.waste<=c.actual.total+1e-6)
    if(!o.scrap)assert.equal(c.waste,0)
    assert.ok(Math.abs(c.actual.total-(c.actual.material+c.actual.labor+c.actual.machine+c.actual.overhead))<1e-6)
  }
})
