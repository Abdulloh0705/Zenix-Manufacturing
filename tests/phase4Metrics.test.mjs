// Phase 4 controlled metrics (2026-11-20): labour, machine, energy and overhead cost, downtime duration and OEE
// availability / performance / quality of one work center, from a run with fixed clock times and known rates.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

// Today 00:10 local, so every event falls inside the 7-day OEE window whenever the suite runs.
const T0=(()=>{const d=new Date();d.setHours(0,10,0,0);return d})()
const at=min=>new Date(T0.getTime()+min*60000)
let counter=0
const ctx=(s,userId,min)=>({now:at(min),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p4x${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}

/** Seed with known rates: operator em3 30 000/h, wc2 machine 60 000/h + energy 12 000/h, 6 min/pc, 10 % overhead. */
function fixture(){
  const s=createInitialState(T0)
  const lot={id:'lot-x',code:'LOT-X',kind:'lot',itemId:'rm2',itemType:'raw',qty:50,originalQty:50,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-10-01 08:00',consumedBy:[],unitCost:20000}
  return {...s,
    settings:{...s.settings,policies:{...s.settings.policies,overheadRate:10,shiftMinutes:480}},
    employees:s.employees.map(e=>e.id==='em3'?{...e,hourlyCost:30000}:e),
    workCenters:s.workCenters.map(w=>w.id==='wc2'?{...w,costPerHour:60000,energyCostPerHour:12000}:w),
    boms:s.boms.map(b=>b.productId==='p3'&&b.status==='Faol'?{...b,components:b.components.map(c=>({...c,qty:0.5,waste:0})),operations:b.operations.map(o=>({...o,setupMin:0,runMin:6,barcodeStep:false}))}:b),
    lots:[...s.lots,lot],
    stockBalances:[...s.stockBalances,{id:'st-x',warehouseId:'w1',key:'rm2',itemId:'rm2',itemType:'raw',onHand:50,reserved:0,incoming:0,quarantine:0,unit:'kg'}],
  }
}

/**
 * 10 pcs on wc2: start 00:10, a 30-min stop at +60 (pauses the job), resume at +90, job card 8 good + 1 scrap and
 * one more unit scrapped with the shop-floor SCRAP button at +150, finish at +150.
 */
function run({scrapButton=true}={}){
  let s=fixture()
  const created=A.createProductionOrder(s,ctx(s,'em1',0),{productId:'p3',quantity:10});s=ok(created,'create ')
  const id=created.result.id
  s=ok(A.transitionProduction(s,ctx(s,'em1',0),id,'Tasdiqlangan'),'release ')
  const wo=()=>s.productionOrders.find(o=>o.id===id).workOrders[0]
  s=ok(A.startWorkOrder(s,ctx(s,'em3',0),id,wo().id),'start ')
  s=ok(A.startDowntime(s,ctx(s,'em3',60),'eq2','Unplanned stop','test stop'),'stop ')
  const stop=s.downtimeEvents[0].id
  s=ok(A.endDowntime(s,ctx(s,'em3',90),stop),'end stop ')
  s=ok(A.startWorkOrder(s,ctx(s,'em3',90),id,wo().id),'resume ')
  s=ok(A.reportOperationOutput(s,ctx(s,'em3',150),id,wo().id,8,1),'job card ')
  if(scrapButton)s=ok(A.recordScrap(s,ctx(s,'em3',150),id,1,'SCRAP button'),'scrap ')
  s=ok(A.finishWorkOrder(s,ctx(s,'em3',150),id,wo().id),'finish ')
  return {s,id,stop}
}

test('controlled run: downtime is 30 min, run time 120 min, labour/machine/energy follow the rates',()=>{
  const {s,id,stop}=run()
  const o=s.productionOrders.find(x=>x.id===id)
  assert.deepEqual([o.completed,o.scrap],[8,2])
  assert.equal(s.downtimeEvents.find(d=>d.id===stop).minutes,30,'downtime duration = end − start')
  assert.equal(o.workOrders[0].actualMin,120,'60 + 60 min; the stop is not run time')
  assert.equal(s.timeLogs.filter(t=>t.orderId===id).reduce((n,t)=>n+t.minutes,0),120,'labour is booked for running time only')
  const c=E.actualOrderCost(s,o)
  const material=10*0.5*20000
  assert.equal(c.material,material,'every produced and scrapped unit consumed 0.5 kg at the lot cost')
  assert.equal(c.labor,120/60*30000)
  assert.equal(c.machine,120/60*60000)
  assert.equal(c.energy,120/60*12000)
  assert.equal(c.overhead,(material+60000+120000+24000)*0.1)
  assert.deepEqual(E.costInputGaps(s,o),[],'no estimated inputs')
})

test('controlled run: OEE availability, performance and quality of the work center',()=>{
  const {s}=run()
  const r=E.workCenterOee(s,'wc2',7,at(200))
  assert.deepEqual([r.runMinutes,r.downtimeMinutes,r.plannedMinutes],[120,30,480],'one shift planned on the day it ran')
  assert.equal(r.availability,25,'120 run / 480 planned')
  // P4-Q-01: the SCRAP-button unit is output of this (final) operation, so it counts in total and lowers quality.
  assert.deepEqual([r.totalCount,r.goodCount],[10,8])
  assert.equal(r.performance,50,'6 min ideal × 10 pcs / 120 run')
  assert.equal(r.quality,80,'8 good / 10 made')
  assert.equal(r.oee,10,'25 % × 50 % × 80 %')
})

test('OEE never counts job-card scrap twice: without the SCRAP button the job card is the whole output',()=>{
  const {s}=run({scrapButton:false})
  const r=E.workCenterOee(s,'wc2',7,at(200))
  assert.deepEqual([r.totalCount,r.goodCount,r.quality],[9,8,89])
  assert.equal(r.performance,45,'6 min × 9 pcs / 120 run')
})

test('maintenance requests are numbered MR-yymmdd-NN by the domain; an explicit code is kept',()=>{
  let s=fixture()
  const ymd=`${String(T0.getFullYear()).slice(2)}${String(T0.getMonth()+1).padStart(2,'0')}${String(T0.getDate()).padStart(2,'0')}`
  const request=extra=>({equipmentId:'eq2',type:'Corrective',priority:'Normal',status:'Yangi',requestedBy:'em3',scheduled:'2026-12-01 09:00',reason:'Lens check',downtimeHours:0,...extra})
  const first=A.createEntity(s,ctx(s,'em3',0),'maintenanceRequests',request({}),'Maintenance request');s=ok(first)
  const second=A.createEntity(s,ctx(s,'em3',1),'maintenanceRequests',request({code:'  '}),'Maintenance request');s=ok(second)
  const kept=A.createEntity(s,ctx(s,'em3',2),'maintenanceRequests',request({code:'MR-LEGACY-7'}),'Maintenance request');s=ok(kept)
  const code=id=>s.maintenanceRequests.find(r=>r.id===id).code
  const already=fixture().maintenanceRequests.filter(r=>r.code.startsWith(`MR-${ymd}-`)).length
  assert.equal(code(first.result.id),`MR-${ymd}-${String(already+1).padStart(2,'0')}`)
  assert.equal(code(second.result.id),`MR-${ymd}-${String(already+2).padStart(2,'0')}`)
  assert.equal(code(kept.result.id),'MR-LEGACY-7')
})
