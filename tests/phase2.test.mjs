// Phase 2 regression tests: job cards and timestamp time tracking, time-phased MRP with pegging, BOM explosion and
// cycles, multi-warehouse material allocation, calendar capacity and finite scheduling, QC automation, actual
// costing / WIP, OEE and the permissions of the new commands. Every scenario runs on a fixed clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as P from '../.test-dist/planning.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'
import {migrateState} from '../.test-dist/migrations.mjs'

// Wednesday 2026-10-21 08:00 local time — the start of a shift.
const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
const at=min=>new Date(T0.getTime()+min*60000)
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p2t${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const near=(a,b,eps=1e-3,label='')=>assert.ok(Math.abs(a-b)<=eps,`${label} ${a} ≉ ${b}`)
const orderOf=(s,id)=>s.productionOrders.find(o=>o.id===id)
const woOf=(s,id,op)=>orderOf(s,id).workOrders.find(w=>w.operationId===op)
const bal=(s,wh,item)=>s.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===item)||{onHand:0,reserved:0,quarantine:0,incoming:0}
const put=(s,wh,itemId,onHand,extra={})=>({...s,stockBalances:[...s.stockBalances.filter(b=>!(b.warehouseId===wh&&b.itemId===itemId)),
  {id:`st-${wh}-${itemId}`,warehouseId:wh,itemId,itemType:s.products.some(p=>p.id===itemId)?'finished':'raw',onHand,reserved:0,incoming:0,quarantine:0,unit:s.rawMaterials.find(m=>m.id===itemId)?.unit||'dona',...extra}]})
const base=()=>put(put(createInitialState(T0),'w1','rm1',1000),'w1','rm3',100)
const withPolicy=(s,patch)=>({...s,settings:{...s.settings,policies:{...s.settings.policies,...patch}}})

function created(s,productId='p1',quantity=10,extra={},c=ctx(s)){
  const out=A.createProductionOrder(s,c,{productId,quantity,...extra})
  return {s:ok(out,'create: '),id:out.result.id}
}
function running(s,productId='p1',quantity=10){
  let {s:st,id}=created(s,productId,quantity)
  st=ok(A.transitionProduction(st,ctx(st),id,'Tasdiqlangan'),'confirm: ')
  st=ok(A.transitionProduction(st,ctx(st),id,'Jarayonda'),'run: ')
  return {s:st,id}
}
const perP1=E.perUnit({qty:1.13,waste:3.2})

/* ------------------------------------------------------------- 1. work orders -- */

test('P2-01: an MO gets one job card per routing operation of its frozen BOM snapshot',()=>{
  let {s,id}=created(base(),'p1',10)
  const o=orderOf(s,id)
  assert.deepEqual(o.workOrders.map(w=>[w.operationId,w.workCenterId,w.plannedMin,w.dependsOn.join()]),[['bo1','wc1',25+0.25*10,''],['bo2','wc3',18+0.3*10,'bo1']])
  assert.ok(o.workOrders.every(w=>E.WORK_ORDER_PHASE[w.status]==='BLOCKED'),'not released yet')
  // Changing the master BOM afterwards does not touch the order's snapshot or its job cards.
  s={...s,boms:s.boms.map(b=>b.id==='bom1'?{...b,operations:b.operations.map(op=>({...op,runMin:9}))}:b)}
  assert.equal(orderOf(s,id).bomSnapshot.operations[0].runMin,0.25)
  s=ok(A.transitionProduction(s,ctx(s),id,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'))
  assert.deepEqual(orderOf(s,id).workOrders.map(w=>E.WORK_ORDER_PHASE[w.status]),['READY','BLOCKED'])
  const card=E.jobCard(s,orderOf(s,id),woOf(s,id,'bo1'),T0)
  assert.deepEqual([card.plannedSetupMin,card.plannedRunMin,card.plannedQty,card.goodQty,card.openQty],[25,2.5,10,0,10])
})

test('P2-02: an operation cannot start before its predecessors finish',()=>{
  let {s,id}=running(base())
  refused(s,A.startWorkOrder(s,ctx(s),id,woOf(s,id,'bo2').id),/Avval tugatilishi kerak: Ekstruziya/)
  s=ok(A.startWorkOrder(s,ctx(s),id,woOf(s,id,'bo1').id))
  refused(s,A.startWorkOrder(s,ctx(s),id,woOf(s,id,'bo2').id),/Avval tugatilishi kerak/)
  s=ok(A.finishWorkOrder(s,ctx(s),id,woOf(s,id,'bo1').id))
  assert.equal(woOf(s,id,'bo2').status,'Tayyor')
  s=ok(A.startWorkOrder(s,ctx(s),id,woOf(s,id,'bo2').id))
  assert.equal(woOf(s,id,'bo2').status,'Jarayonda')
})

test('P2-03: START / PAUSE / RESUME / COMPLETE book productive time from timestamps; pauses never count',()=>{
  let {s,id}=running(base())
  const wo=()=>woOf(s,id,'bo1')
  s=ok(A.startWorkOrder(s,ctx(s,'em1',T0),id,wo().id))
  s=ok(A.pauseWorkOrder(s,ctx(s,'em1',at(30)),id,wo().id))
  assert.equal(wo().actualMin,30)
  s=ok(A.startWorkOrder(s,ctx(s,'em1',at(50)),id,wo().id),'resume: ')
  s=ok(A.finishWorkOrder(s,ctx(s,'em1',at(80)),id,wo().id))
  assert.equal(wo().actualMin,60,'30 + 30 minutes of work; the 20 minute pause is not counted')
  const card=E.jobCard(s,orderOf(s,id),wo(),at(120))
  assert.deepEqual([card.actualMin,card.pausedMin,card.logs.map(l=>l.minutes).join()],[60,20,'30,30'])
  assert.deepEqual(wo().history.map(e=>e.action),['start','pause','resume','complete'])
  assert.ok(s.timeLogs.filter(t=>t.workOrderId===wo().id).every(t=>t.end&&t.hourlyRate===65000),'logs are closed and carry the wage at start')
})

test('P2-03b: setup time is measured separately and the run continues without a gap',()=>{
  let {s,id}=running(base())
  const wo=()=>woOf(s,id,'bo1')
  refused(s,A.markSetupDone(s,ctx(s),id,wo().id),/ishlamayapti/)
  s=ok(A.startWorkOrder(s,ctx(s,'em1',T0),id,wo().id))
  s=ok(A.markSetupDone(s,ctx(s,'em1',at(12)),id,wo().id))
  refused(s,A.markSetupDone(s,ctx(s,'em1',at(13)),id,wo().id),/allaqachon/)
  s=ok(A.finishWorkOrder(s,ctx(s,'em1',at(40)),id,wo().id))
  const card=E.jobCard(s,orderOf(s,id),wo(),at(40))
  assert.deepEqual([card.actualMin,card.setupMin,card.runMin,card.pausedMin],[40,12,28,0])
  assert.deepEqual(s.timeLogs.filter(t=>t.workOrderId===wo().id).map(t=>[t.kind,t.minutes]).sort(),[['run',28],['setup',12]])
})

test('P2-04: a running timer survives a save / reload through browser storage and the migration step',()=>{
  let {s,id}=running(base())
  s=ok(A.startWorkOrder(s,ctx(s,'em1',T0),id,woOf(s,id,'bo1').id))
  const reloaded=migrateState(JSON.parse(JSON.stringify(s))).state
  const wo=woOf(reloaded,id,'bo1')
  assert.equal(E.jobCard(reloaded,orderOf(reloaded,id),wo,at(45)).actualMin,45,'elapsed time comes from the stored start stamp')
  const paused=ok(A.pauseWorkOrder(reloaded,ctx(reloaded,'em1',at(45)),id,wo.id))
  assert.equal(woOf(paused,id,'bo1').actualMin,45)
})

test('P2-05: a job card completes once; repeated reports and completions post nothing twice',()=>{
  let {s,id}=running(base())
  const bo1=()=>woOf(s,id,'bo1'),bo2=()=>woOf(s,id,'bo2')
  s=ok(A.startWorkOrder(s,ctx(s),id,bo1().id))
  s=ok(A.reportOperationOutput(s,ctx(s),id,bo1().id,10,0,{key:'k1'}))
  refused(s,A.reportOperationOutput(s,ctx(s),id,bo1().id,10,0,{key:'k1'}),/allaqachon/)
  s=ok(A.finishWorkOrder(s,ctx(s),id,bo1().id))
  const frozen=JSON.stringify([bo1(),s.timeLogs])
  refused(s,A.finishWorkOrder(s,ctx(s),id,bo1().id),/avval boshlanishi kerak/)
  refused(s,A.startWorkOrder(s,ctx(s),id,bo1().id),/allaqachon yakunlangan/)
  assert.equal(JSON.stringify([bo1(),s.timeLogs]),frozen)
  // The final operation's report is the order's output: finished stock grows once per key.
  s=ok(A.startWorkOrder(s,ctx(s),id,bo2().id))
  s=ok(A.reportOperationOutput(s,ctx(s),id,bo2().id,8,2,{key:'k2',reason:'Qoplama nuqsoni'}))
  assert.deepEqual([orderOf(s,id).completed,orderOf(s,id).scrap,bal(s,'w3','p1').onHand,bal(s,'w3','p1').quarantine],[8,2,8,8])
  refused(s,A.reportOperationOutput(s,ctx(s),id,bo2().id,8,2,{key:'k2'}),/allaqachon/)
  // Nothing is left at the operation: more needs a reason, and never more than the order quantity.
  refused(s,A.reportOperationOutput(s,ctx(s),id,bo2().id,1,0),/ruxsat etilgan 0/)
  refused(s,A.reportOperationOutput(s,ctx(s),id,bo2().id,1,0,{override:'Qayta sanaldi'}),/buyurtma miqdori 10/)
})

test('P2-05b: boundary inputs of job-card commands are refused without side effects',()=>{
  let {s,id}=running(base())
  const bo1=woOf(s,id,'bo1')
  refused(s,A.reportOperationOutput(s,ctx(s),id,bo1.id,1,0),/boshlangandan keyin/)
  s=ok(A.startWorkOrder(s,ctx(s),id,bo1.id))
  for(const [g,sc] of [[0,0],[-1,0],[1.5,0],[0,-2],[Number.NaN,0]])refused(s,A.reportOperationOutput(s,ctx(s),id,bo1.id,g,sc),/butun son/)
  refused(s,A.reportOperationOutput(s,ctx(s),id,'wo-missing',1,0),/topilmadi/)
  refused(s,A.reportOperationOutput(s,ctx(s),'mo-missing',bo1.id,1,0),/topilmadi/)
  refused(s,A.assignWorkOrder(s,ctx(s),id,bo1.id,['em-missing']),/topilmadi/)
  // Intermediate scrap is booked on the order at once: material consumed, scrap counted.
  s=ok(A.reportOperationOutput(s,ctx(s),id,bo1.id,7,3,{reason:'O‘lcham mos emas'}))
  assert.deepEqual([orderOf(s,id).scrap,orderOf(s,id).completed,woOf(s,id,'bo1').goodQty,woOf(s,id,'bo1').scrapQty],[3,0,7,3])
  assert.equal(E.operationInput(orderOf(s,id),woOf(s,id,'bo2')),7,'the next operation receives only the good units')
})

test('P2-05c: cancelling or splitting an order keeps its job-card history',()=>{
  let {s,id}=running(base(),'p1',20)
  s=ok(A.startWorkOrder(s,ctx(s,'em1',T0),id,woOf(s,id,'bo1').id))
  const split=A.splitProduction(s,ctx(s,'em1',at(10)),id,5)
  s=ok(split)
  assert.ok(woOf(s,id,'bo1').history.some(e=>e.action==='split'),'parent records the split')
  assert.ok(orderOf(s,split.result.id).workOrders.every(w=>w.history[0].action==='split'&&w.actualMin===0),'child starts clean')
  s=ok(A.transitionProduction(s,ctx(s,'em1',at(30)),id,'Bekor qilingan'))
  const bo1=woOf(s,id,'bo1')
  assert.deepEqual([bo1.status,bo1.actualMin,bo1.history.at(-1).action],['Bekor qilingan',30,'cancel'])
  assert.ok(s.timeLogs.filter(t=>t.orderId===id).every(t=>t.end),'time logs are closed')
  refused(s,A.startWorkOrder(s,ctx(s),id,bo1.id),/bekor qilingan/)
})

/* ------------------------------------------------------- 6–7. BOM explosion -- */

test('P2-06: multi-level BOM explosion returns per-level lines and correct leaf totals',()=>{
  const s=createInitialState(T0)
  const x=P.explodeBom(s,'bom2',10)
  assert.equal(x.error,undefined)
  const total=id=>x.totals.find(t=>t.itemId===id)?.qty
  near(total('rm2'),10*2.4*1.045+10*2*0.72*1.038,1e-3,'rm2 direct + through the sub-assembly')
  assert.equal(total('rm4'),80)
  const sub=x.lines.find(l=>l.itemId==='p3')
  assert.deepEqual([sub.level,sub.qty,sub.exploded],[1,20,true])
  assert.ok(x.lines.some(l=>l.itemId==='rm2'&&l.level===2&&l.parentId==='p3'))
  assert.match(P.explodeBom(s,'bom2',-1).error,/Miqdor/)
  assert.match(P.explodeBom(s,'bom2',Number.NaN).error,/Miqdor/)
  assert.match(P.explodeBom(s,'bom-missing',1).error,/topilmadi/)
  assert.deepEqual(P.explodeBom(s,'bom2',0).totals.map(t=>t.qty),[0,0])
})

test('P2-07: circular BOM references are found, refused on save / release and reported by MRP',()=>{
  let s=createInitialState(T0)
  // A sub-BOM link that leads back to the product (the old product-level check could not see it).
  const loop={id:'bom-x',code:'BOM-X',productId:'p3',version:'x1',revision:1,status:'Draft',effectiveDate:TODAY,waste:0,components:[{id:'cx',materialId:'p1',qty:1,unit:'dona',waste:0}],operations:[],notes:''}
  s={...s,boms:[...s.boms,loop]}
  const draft={...structuredClone(s.boms.find(b=>b.id==='bom1')),id:'bom-y',version:'v9',status:'Draft',components:[...s.boms.find(b=>b.id==='bom1').components,{id:'cy',materialId:'p3',qty:1,unit:'dona',waste:0,subBomId:'bom-x'}]}
  refused(s,A.saveBom(s,ctx(s),draft),/Aylanma BOM/)
  ok(A.saveBom(s,ctx(s),{...draft,components:draft.components.map(c=>c.id==='cy'?{...c,subBomId:undefined}:c)}),'the same component without the loop: ')
  // Data that already contains a loop (imported / older data): explosion and MRP report it instead of recursing.
  const cyclic={...s,boms:s.boms.map(b=>b.id==='bom3'?{...b,components:[...b.components,{id:'loop',materialId:'p2',qty:1,unit:'dona',waste:0}]}:b)}
  assert.ok(P.findBomCycle(cyclic,cyclic.boms.find(b=>b.id==='bom2')))
  assert.match(P.explodeBom(cyclic,'bom2',1).error,/Aylanma BOM/)
  const mrp=P.runMrp(cyclic,{today:TODAY})
  assert.ok(mrp.issues.some(i=>/Aylanma BOM/.test(i)))
  const release={...cyclic,boms:[...cyclic.boms,{...structuredClone(cyclic.boms.find(b=>b.id==='bom3')),id:'bom-z',version:'v2',status:'Draft'}]}
  refused(release,A.activateBom(release,ctx(release),'bom-z'),/Aylanma BOM/)
})

/* -------------------------------------------------------------- 8–9. MRP -- */

test('P2-08: MRP nets reserved, incoming and safety stock without counting anything twice',()=>{
  let s=base()
  const a=running(s,'p1',100);s=a.s                          // reserved: its need is outside gross and outside available
  const b=created(s,'p1',200);s=b.s                           // draft: its need is gross demand
  s=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:500}],expectedDate:'2026-10-28'}))
  assert.equal(bal(s,'w1','rm1').incoming,500)
  const plan=P.runMrp(s,{today:TODAY,bucket:'week',horizonWeeks:4})
  const row=plan.rows.find(r=>r.itemId==='rm1')
  const available=1000-100*perP1
  near(row.available,available,1e-3,'available = on hand − reservation')
  near(row.buckets[0].gross,200*perP1,1e-6,'gross = the draft order only')
  assert.equal(row.buckets.reduce((x,k)=>x+k.scheduled,0),500,'the PO is a receipt once (balance "incoming" is not added again)')
  assert.equal(row.buckets[1].scheduled,500)
  const net=900-(available-200*perP1)
  near(row.buckets[0].net,net,1e-3,'net = safety − projected')
  const sug=plan.suggestions.filter(x=>x.itemId==='rm1')
  assert.equal(sug.length,1,'one suggestion for the one shortfall')
  assert.equal(sug[0].qty,Math.ceil(net))
  // Stock below safety does not serve demand: the receipt is pegged to the draft order, the rest restores safety stock.
  assert.deepEqual(sug[0].refs.map(r=>r.kind),['mo','safety'])
  assert.equal(sug[0].refs[0].code,orderOf(s,b.id).code)
  near(sug[0].refs[0].qty,200*perP1)
  assert.ok(!JSON.stringify(plan.suggestions).includes(orderOf(s,a.id).code),'the reserved order is never demand again')
  near(row.buckets[1].projected,available-200*perP1+Math.ceil(net)+500,1e-3)
  // Quarantined stock is not available until QC releases it.
  const held=P.runMrp({...s,stockBalances:s.stockBalances.map(x=>x.itemId==='rm1'?{...x,quarantine:100}:x)},{today:TODAY,bucket:'week',horizonWeeks:4})
  near(held.rows.find(r=>r.itemId==='rm1').available,available-100,1e-3)
})

test('P2-09: suggestions keep their demand, become documents through the domain commands and are never duplicated',()=>{
  let s=put(base(),'w1','rm1',0)
  s={...s,salesOrders:[{id:'so-t',code:'SO-T',customerId:'cu1',status:'Tasdiqlangan',mode:'Make-to-stock',items:[{productId:'p1',qty:50,price:1,delivered:0,reserved:0}],total:50,paymentStatus:'',deliveryDate:'2026-10-31',createdAt:TODAY}]}
  let plan=P.runMrp(s,{today:TODAY})
  const make=plan.suggestions.find(x=>x.type==='make'&&x.itemId==='p1')
  assert.deepEqual([make.qty,make.needDate,make.releaseDate,make.refs.map(r=>r.code).join()],[50,'2026-10-31','2026-10-29','SO-T'])
  const component=plan.suggestions.find(x=>x.itemId==='rm1'&&x.refs.some(r=>r.kind==='planned'))
  assert.ok(component.origins.some(r=>r.kind==='sales'&&r.id==='so-t'),'material demand is traced to the sales order')
  refused(s,A.confirmMrpSuggestion(s,ctx(s),'make:p1:1999-01-01'),/topilmadi/)
  const mo=A.confirmMrpSuggestion(s,ctx(s),make.key);s=ok(mo)
  const order=orderOf(s,mo.result.id)
  assert.deepEqual([order.status,order.quantity,order.start,order.due],['Qoralama',50,'2026-10-29','2026-10-31'])
  assert.match(order.source,/MRP make:p1:2026-10-31.*SO-T/)
  assert.equal(bal(s,'w1','rm1').reserved,0,'planning moves no stock')
  plan=P.runMrp(s,{today:TODAY})
  assert.ok(!plan.suggestions.some(x=>x.type==='make'&&x.itemId==='p1'),'the new MO covers the demand — no second MO')
  const buy=plan.suggestions.find(x=>x.itemId==='rm1'&&x.refs.some(r=>r.kind==='mo'))
  const po=A.confirmMrpSuggestion(s,ctx(s),buy.key);s=ok(po)
  const draft=s.purchaseOrders.find(p=>p.id===po.result.id)
  assert.deepEqual([draft.status,draft.items[0].qty,draft.productionOrderIds.join()],['Qoralama',buy.qty,order.id])
  assert.equal(bal(s,'w1','rm1').incoming,0,'a draft PO is not supply yet')
  assert.equal(P.runMrp(s,{today:TODAY}).suggestions.find(x=>x.key===buy.key)?.existing,draft.code)
  refused(s,A.confirmMrpSuggestion(s,ctx(s),buy.key),/allaqachon yaratilgan/)
})

/* -------------------------------------------------- 10. multi-warehouse issue -- */

test('P2-10: raw materials are reserved and issued across the branch stores, never from another branch',()=>{
  let s=createInitialState(T0)
  s={...s,warehouses:[...s.warehouses,{id:'w5',name:'Xomashyo 2',code:'WH-RAW2',branchId:'b1',type:'Raw',status:'Faol',locations:[]}]}
  s=put(put(put(put(s,'w1','rm1',60),'w5','rm1',100),'w4','rm1',500),'w1','rm3',10)
  const need=100*perP1
  const short=put(s,'w5','rm1',30)
  let c=created(short,'p1',100)
  const waiting=A.transitionProduction(c.s,ctx(c.s),c.id,'Tasdiqlangan')
  assert.equal(waiting.result.ok,false)
  assert.ok([bal(waiting.state,'w1','rm1'),bal(waiting.state,'w5','rm1'),bal(waiting.state,'w4','rm1')].every(b=>b.reserved===0),'all or nothing; other branch untouched')
  c=created(s,'p1',100)
  let st=ok(A.transitionProduction(c.s,ctx(c.s),c.id,'Tasdiqlangan'))
  const rows=orderOf(st,c.id).reservations.filter(r=>r.materialId==='rm1')
  assert.deepEqual(rows.map(r=>r.warehouseId),['w1','w5'])
  near(rows.reduce((x,r)=>x+r.qty,0),need)
  assert.deepEqual([bal(st,'w1','rm1').reserved,bal(st,'w4','rm1').reserved],[60,0])
  const cancelled=ok(A.transitionProduction(st,ctx(st),c.id,'Bekor qilingan'))
  assert.ok(['w1','w5'].every(w=>bal(cancelled,w,'rm1').reserved===0),'cancel releases every store')
  st=ok(A.transitionProduction(st,ctx(st),c.id,'Jarayonda'))
  st=ok(A.reportOutput(st,ctx(st),c.id,100,0,'',`out-${c.id}`))
  near(bal(st,'w1','rm1').onHand,0);near(bal(st,'w5','rm1').onHand,100-(need-60))
  assert.equal(bal(st,'w4','rm1').onHand,500)
  assert.ok(['w1','w5'].every(w=>bal(st,w,'rm1').reserved<1e-6))
  assert.deepEqual([...new Set(st.stockMovements.filter(m=>m.type==='Material Issue -'&&m.itemId==='rm1').map(m=>m.warehouseId))].sort(),['w1','w5'])
  assert.ok(orderOf(st,c.id).consumed.every(x=>x.unitCost!==undefined),'each issue is valued when it happens')
  // A role bound to one warehouse reserves only there.
  const clerk={id:'em-wh',name:'Ombor xodimi',roleId:'role6',department:'Warehouse',workCenterId:'wc1',shift:'A',status:'Faol',attendance:100,efficiency:100,hourlyCost:30000,warehouseId:'w1'}
  const scoped={...s,employees:[...s.employees,clerk]}
  const d=created(scoped,'p1',100)
  assert.equal(A.transitionProduction(d.s,ctx(d.s,'em-wh'),d.id,'Tasdiqlangan').result.ok,false,'w1 alone cannot cover it')
})

/* ------------------------------------------------- 11–12. capacity / schedule -- */

test('P2-11: calendar capacity detects overload; weekends, maintenance, stops and dead machines remove capacity',()=>{
  let {s,id}=created(base(),'p3',5000,{due:'2026-10-22'})
  const wc2=s.workCenters.find(w=>w.id==='wc2')
  const loads=E.calculateCapacityLoads(s,7,undefined,T0)
  const l=loads.find(x=>x.workCenter.id==='wc2')
  assert.equal(l.days[0].capacity,Math.round(480*0.81))
  assert.equal(l.days[0].load,Math.round((8+0.3*5000)/2),'spread over the two working days of the window')
  assert.ok(l.overloaded&&l.days[0].utilization>100)
  assert.deepEqual([l.days[3].date,l.days[3].working,l.days[3].capacity],['2026-10-24',false,0])
  assert.ok(P.scheduleOperations(s,{now:T0}).orders.get(id).late,'finite schedule finishes after the due date')
  // Planned maintenance: the request's downtime hours, or the whole shift when unknown.
  s={...s,maintenanceOrders:[{id:'mt1',code:'MT-1',equipmentId:'eq2',type:'Preventive',status:'Rejada',scheduled:'2026-10-22',technicianId:'em5',cost:0,note:''}]}
  assert.deepEqual([E.workCenterDay(s,wc2,'2026-10-22',T0).blocked,E.workCenterDay(s,wc2,'2026-10-22',T0).capacity],[480,0])
  s={...s,maintenanceRequests:[{id:'mr1',code:'MR-1',equipmentId:'eq2',type:'Preventive',priority:'Normal',status:'Tasdiqlangan',requestedBy:'em5',scheduled:'2026-10-22',reason:'',downtimeHours:2}],maintenanceOrders:s.maintenanceOrders.map(m=>({...m,requestId:'mr1'}))}
  assert.equal(E.workCenterDay(s,wc2,'2026-10-22',T0).blocked,120)
  s={...s,downtimeEvents:[{id:'d1',equipmentId:'eq2',workCenterId:'wc2',reason:'Unplanned stop',start:'2026-10-23 09:00',end:'2026-10-23 10:30',minutes:90,note:''}]}
  assert.equal(E.workCenterDay(s,wc2,'2026-10-23',T0).blocked,90)
  s={...s,equipment:s.equipment.map(e=>e.id==='eq2'?{...e,status:'To‘xtagan'}:e)}
  assert.equal(E.workCenterDay(s,wc2,TODAY,T0).capacity,0)
  // Two shifts double the day; a company six-day week makes Saturday a working day.
  const two={...s,workCenters:s.workCenters.map(w=>w.id==='wc2'?{...w,calendar:{shifts:2}}:w)}
  assert.equal(E.workCenterDay(two,two.workCenters.find(w=>w.id==='wc2'),'2026-10-26',T0).capacity,Math.round(960*0.81))
  assert.equal(E.workCenterDay(withPolicy(s,{workingDays:[1,2,3,4,5,6]}),wc2,'2026-10-24',T0).working,true)
})

test('P2-12: the finite schedule keeps operation order, never overlaps a work center and follows shifts and downtime',()=>{
  const s=base()
  const first=created(s,'p1',1000),second=created(first.s,'p1',1000)
  const run=st=>P.scheduleOperations(st,{now:T0})
  const op=(r,id,opId)=>r.operations.find(x=>x.orderId===id&&x.workOrderId===woOf(second.s,id,opId).id)
  let r=run(second.s)
  const a1=op(r,first.id,'bo1'),a2=op(r,first.id,'bo2'),b1=op(r,second.id,'bo1')
  assert.equal(a1.start,'2026-10-21 08:00')
  assert.ok(a2.start>=a1.end,'painting starts after extrusion ends')
  assert.ok(b1.start>=a1.end,'one press, one job at a time')
  assert.equal(a2.end.slice(0,10),'2026-10-22','318 min at 84% does not fit what is left of the first shift')
  // A full-day stop of the paint line on the 22nd pushes the finish to the 23rd; a second shift pulls it into the 21st.
  const down={...second.s,downtimeEvents:[{id:'d',equipmentId:'eq3',workCenterId:'wc3',reason:'Maintenance',start:'2026-10-22 08:00',end:'2026-10-22 16:00',minutes:480,note:''}]}
  assert.equal(op(run(down),first.id,'bo2').end.slice(0,10),'2026-10-23')
  const shifts={...second.s,workCenters:second.s.workCenters.map(w=>w.id==='wc3'?{...w,calendar:{shifts:2}}:w)}
  assert.equal(op(run(shifts),first.id,'bo2').end.slice(0,10),TODAY)
})

test('P2-12b: rescheduling validates dates and resources and needs an explicit override for unavailable days',()=>{
  let {s,id}=created(base(),'p1',10)
  const c=ctx(s)
  refused(s,A.rescheduleProductionOrder(s,c,id,'2026-10-20'),/o‘tgan sana/)
  refused(s,A.rescheduleProductionOrder(s,c,id,'2026-02-30'),/Sana noto‘g‘ri/)
  refused(s,A.rescheduleProductionOrder(s,c,id,'21.10.2026'),/Sana noto‘g‘ri/)
  refused(s,A.rescheduleProductionOrder(s,c,'mo-missing','2026-10-22'),/topilmadi/)
  const weekend=refused(s,A.rescheduleProductionOrder(s,c,id,'2026-10-24'),/ishlamaydi/)
  assert.equal(weekend.result.code,'needs-override')
  const forced=ok(A.rescheduleProductionOrder(s,c,id,'2026-10-24',{override:true,reason:'Shanba smenasi'}))
  assert.deepEqual([orderOf(forced,id).start,orderOf(forced,id).due,orderOf(forced,id).scheduleOverride.reason],['2026-10-24','2026-10-26','Shanba smenasi'])
  const moved=ok(A.rescheduleProductionOrder(s,c,id,'2026-10-22'))
  assert.deepEqual([orderOf(moved,id).start,orderOf(moved,id).due,orderOf(moved,id).scheduleOverride],['2026-10-22','2026-10-24',undefined])
  const live=running(base())
  refused(live.s,A.rescheduleProductionOrder(live.s,ctx(live.s),live.id,'2026-10-22'),/allaqachon boshlangan/)
})

/* ------------------------------------------------------------- 13–15. quality -- */

test('P2-13: incoming, in-process and final control points trigger once with full references',()=>{
  let s=base()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:100}]});s=ok(po)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm1',100,undefined,undefined,{key:'r1'}))
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm1',100,undefined,undefined,{key:'r1'}),/allaqachon/)
  const incoming=s.qualityChecks.filter(q=>q.type==='Kirish')
  assert.equal(incoming.length,1)
  assert.deepEqual([incoming[0].sourceId,incoming[0].controlPointId,incoming[0].status,Boolean(incoming[0].receiptId),Boolean(incoming[0].lot)],[po.result.id,'qcp1','Pending',true,true])
  let {s:st,id}=running(base())
  for(const op of ['bo1','bo2']){st=ok(A.startWorkOrder(st,ctx(st),id,woOf(st,id,op).id));st=ok(A.finishWorkOrder(st,ctx(st),id,woOf(st,id,op).id))}
  const paint=st.qualityChecks.filter(q=>q.workOrderId===woOf(st,id,'bo2').id)
  assert.equal(paint.length,1)
  assert.deepEqual([paint[0].type,paint[0].controlPointId,paint[0].sourceId,paint[0].operatorId,paint[0].itemId],['Jarayon','qcp4',id,'em1','p1'])
  st=ok(A.reportOutput(st,ctx(st),id,6,0,'','o1'))
  st=ok(A.transitionProduction(st,ctx(st),id,'Sifat nazoratida'))
  st=ok(A.transitionProduction(st,ctx(st),id,'Jarayonda'),'back for the rest: ')
  st=ok(A.reportOutput(st,ctx(st),id,4,0,'','o2'))
  st=ok(A.transitionProduction(st,ctx(st),id,'Sifat nazoratida'))
  const finals=st.qualityChecks.filter(q=>q.sourceId===id&&q.type==='Final')
  assert.equal(finals.length,1,'the second hand-over reuses the open Final check')
  assert.equal(finals[0].lot,orderOf(st,id).lot)
})

test('P2-14: mandatory QC blocks the next operation, completion and the release of held stock',()=>{
  let s=base()
  s={...s,qualityControlPoints:s.qualityControlPoints.map(c=>c.id==='qcp2'?{...c,frequency:'Every time',blocking:true}:c)}
  let {s:st,id}=running(s)
  const bo1=()=>woOf(st,id,'bo1'),bo2=()=>woOf(st,id,'bo2')
  st=ok(A.startWorkOrder(st,ctx(st),id,bo1().id))
  st=ok(A.finishWorkOrder(st,ctx(st),id,bo1().id))
  const check=st.qualityChecks.find(q=>q.workOrderId===bo1().id)
  refused(st,A.startWorkOrder(st,ctx(st),id,bo2().id),/Majburiy sifat tekshiruvi o‘tmagan: Ekstruziya \(Pending\)/)
  st=ok(A.resolveQuality(st,ctx(st,'em4'),check.id,'Failed','Burr'))
  refused(st,A.startWorkOrder(st,ctx(st),id,bo2().id),/Failed/)
  st=ok(A.createQualityCheck(st,ctx(st,'em4'),{sourceType:'production',sourceId:id,itemId:'p1',type:'Jarayon',controlPointId:'qcp2',workOrderId:bo1().id}),'re-inspection: ')
  const again=st.qualityChecks.find(q=>q.workOrderId===bo1().id&&q.status==='Pending')
  st=ok(A.resolveQuality(st,ctx(st,'em4'),again.id,'Passed'))
  st=ok(A.startWorkOrder(st,ctx(st),id,bo2().id),'a passed re-inspection lifts the block: ')
  st=ok(A.finishWorkOrder(st,ctx(st),id,bo2().id))
  st=ok(A.reportOutput(st,ctx(st),id,10,0,'','o'))
  assert.equal(bal(st,'w3','p1').quarantine,10)
  refused(st,A.transferStock(st,ctx(st),'p1','w3','w2',1),/Available/)
  st=ok(A.transitionProduction(st,ctx(st),id,'Sifat nazoratida'))
  refused(st,A.transitionProduction(st,ctx(st),id,'Yakunlangan'),/Passed emas|Pending/)
})

test('P2-15: an in-process scrap decision scraps the units on the order with stock and cost consequences',()=>{
  let s=base()
  s={...s,qualityControlPoints:s.qualityControlPoints.map(c=>c.id==='qcp2'?{...c,frequency:'Every time'}:c)}
  let {s:st,id}=running(s)
  const bo1=()=>woOf(st,id,'bo1')
  st=ok(A.startWorkOrder(st,ctx(st),id,bo1().id))
  st=ok(A.reportOperationOutput(st,ctx(st),id,bo1().id,10,0))
  st=ok(A.finishWorkOrder(st,ctx(st),id,bo1().id))
  const check=st.qualityChecks.find(q=>q.workOrderId===bo1().id)
  const before={onHand:bal(st,'w1','rm1').onHand,alerts:st.qualityAlerts.length}
  refused(st,A.resolveQuality(st,ctx(st,'em4'),check.id,'Scrap','Burr','',0),/musbat/)
  st=ok(A.resolveQuality(st,ctx(st,'em4'),check.id,'Scrap','Burr','',3))
  const o=orderOf(st,id)
  assert.deepEqual([o.scrap,bo1().goodQty,bo1().scrapQty],[3,7,3])
  near(before.onHand-bal(st,'w1','rm1').onHand,3*perP1,2e-3,'material of the scrapped units is consumed')
  assert.equal(st.qualityAlerts.length,before.alerts+1,'one NCR for one event')
  const c=E.orderCosting(st,o)
  assert.ok(c.waste>0&&c.waste<=c.actual.total)
  // Rework is costed on its own order and shown on the source, never added to the source's total.
  let r=running(base(),'p1',10);let rs=ok(A.reportOutput(r.s,ctx(r.s),r.id,10,0,'','o'))
  const rw=A.createReworkOrder(rs,ctx(rs),r.id,2,'Qoplama');rs=ok(rw)
  rs=ok(A.transitionProduction(rs,ctx(rs),rw.result.id,'Tasdiqlangan'))
  const rwo=orderOf(rs,rw.result.id).workOrders[0]
  rs=ok(A.startWorkOrder(rs,ctx(rs,'em1',T0),rw.result.id,rwo.id))
  rs=ok(A.pauseWorkOrder(rs,ctx(rs,'em1',at(30)),rw.result.id,rwo.id))
  const src=E.orderCosting(rs,orderOf(rs,r.id))
  near(src.rework,E.actualOrderCost(rs,orderOf(rs,rw.result.id)).total,1e-6)
  assert.ok(src.rework>0)
  near(src.actual.total,E.actualOrderCost(rs,orderOf(rs,r.id)).total,1e-6)
})

/* --------------------------------------------------------- 16–17. costing -- */

test('P2-16: actual cost comes from valued consumption, logged labor and machine / energy time — and stays put',()=>{
  let s=withPolicy(base(),{autoQualityChecks:false})
  s={...s,workCenters:s.workCenters.map(w=>w.id==='wc1'?{...w,energyCostPerHour:20000}:w)}
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:100,price:30000}]});s=ok(po)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm1',100))
  let {s:st,id}=running(s)
  const bo1=woOf(st,id,'bo1')
  st=ok(A.startWorkOrder(st,ctx(st,'em2',T0),id,bo1.id))
  st=ok(A.finishWorkOrder(st,ctx(st,'em2',at(60)),id,bo1.id))
  st=ok(A.reportOutput(st,ctx(st,'em2',at(60)),id,10,0,'','o'))
  const cost=E.actualOrderCost(st,orderOf(st,id))
  // Issued quantities are kept to the gram (3 decimals), so the value may differ by that rounding only.
  near(cost.material,10*perP1*30000+10*0.08*1.02*68000,0.001*30000+0.001*68000,'lot at its PO price, untracked stock at standard cost')
  assert.deepEqual([Math.round(cost.labor),Math.round(cost.machine),Math.round(cost.energy)],[42000,185000,20000])
  near(cost.overhead,(cost.material+cost.labor+cost.machine+cost.energy)*0.12,1e-6)
  near(cost.total,cost.material+cost.labor+cost.machine+cost.energy+cost.overhead,1e-6)
  assert.deepEqual(E.costInputGaps(st,orderOf(st,id)),[])
  // New prices and rates do not rewrite what this order already used.
  const repriced={...st,rawMaterials:st.rawMaterials.map(m=>({...m,standardCost:1})),workCenters:st.workCenters.map(w=>({...w,costPerHour:1,energyCostPerHour:1})),employees:st.employees.map(e=>({...e,hourlyCost:1}))}
  assert.deepEqual(E.actualOrderCost(repriced,orderOf(repriced,id)),cost)
  // Without frozen values the figure is reported as partly estimated instead of silently using today's prices.
  const legacy={...st,productionOrders:st.productionOrders.map(o=>o.id===id?{...o,consumed:o.consumed.map(({unitCost,...c})=>c)}:o)}
  assert.match(E.costInputGaps(legacy,orderOf(legacy,id)).join(),/Material/)
})

test('P2-17: partial output, retries and backorders never count consumption or cost twice',()=>{
  let {s,id}=running(base())
  const rm1=st=>orderOf(st,id).consumed.filter(c=>c.materialId==='rm1').reduce((a,c)=>a+c.qty,0)
  s=ok(A.reportOutput(s,ctx(s),id,4,0,'','a'))
  near(rm1(s),4*perP1)
  const c4=E.orderCosting(s,orderOf(s,id))
  // Output relieves WIP at the planned unit cost, never below zero: so far only material is spent.
  near(c4.relieved,Math.min(c4.actual.total,c4.planned.total/10*4),1e-6);near(c4.wip,c4.actual.total-c4.relieved,1e-6)
  assert.ok(c4.wip>=0)
  refused(s,A.reportOutput(s,ctx(s),id,4,0,'','a'),/allaqachon/)
  // Backorder: the original keeps its four units of cost; the new order consumes only for what it makes.
  for(const op of ['bo1','bo2']){s=ok(A.startWorkOrder(s,ctx(s),id,woOf(s,id,op).id));s=ok(A.finishWorkOrder(s,ctx(s),id,woOf(s,id,op).id))}
  const bo=A.createBackorder(s,ctx(s),id);s=ok(bo)
  assert.deepEqual([orderOf(s,id).quantity,orderOf(s,bo.result.id).quantity,orderOf(s,bo.result.id).consumed.length],[4,6,0])
  const originalMaterial=E.actualOrderCost(s,orderOf(s,id)).material
  s=ok(A.transitionProduction(s,ctx(s),bo.result.id,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),bo.result.id,'Jarayonda'))
  s=ok(A.reportOutput(s,ctx(s),bo.result.id,6,0,'','b'))
  near(E.actualOrderCost(s,orderOf(s,id)).material,originalMaterial,1e-6)
  const total=[id,bo.result.id].flatMap(x=>orderOf(s,x).consumed).filter(c=>c.materialId==='rm1').reduce((a,c)=>a+c.qty,0)
  near(total,10*perP1,2e-3,'4 + 6 units consume exactly one 10-unit BOM')
  near(bal(s,'w1','rm1').onHand,1000-total,1e-6)
})

/* ------------------------------------------------------------------- 18. OEE -- */

test('P2-18: OEE = availability × performance × quality, with safe zero denominators and operation-level counts',()=>{
  assert.deepEqual(E.calculateOEE({plannedMinutes:480,downtimeMinutes:60,idealCycleMinutes:0.5,totalCount:600,goodCount:570}),{availability:88,performance:71,quality:95,oee:59})
  assert.deepEqual(E.calculateOEE({plannedMinutes:0,downtimeMinutes:0,idealCycleMinutes:0,totalCount:0,goodCount:0}),{availability:0,performance:0,quality:0,oee:0})
  assert.deepEqual(E.calculateOEE({plannedMinutes:100,downtimeMinutes:200,idealCycleMinutes:1,totalCount:10,goodCount:20}),{availability:0,performance:0,quality:100,oee:0},'impossible inputs are clamped, never NaN or > 100%')
  const s0=createInitialState(T0),wc=s0.workCenters[0],now=new Date()
  const op={id:'op',name:'Op',workCenterId:wc.id,setupMin:0,runMin:1,employeeCount:1,instructions:'',qualityCheck:false}
  const wo={id:'wo',operationId:'op',name:'Op',workCenterId:wc.id,sequence:1,status:'Yakunlangan',plannedMin:100,actualMin:120,dependsOn:[],goodQty:80,scrapQty:20}
  const order={id:'mo-oee',code:'MO-OEE',productId:'p1',quantity:100,completed:0,scrap:0,bomId:'b',bomVersion:'1',bomSnapshot:{components:[],operations:[op]},warehouseId:'',lineId:'',workCenterId:wc.id,responsibleId:'',status:'Jarayonda',start:'',due:'',progress:0,priority:'Normal',workOrders:[wo],consumed:[],startedAt:now.toISOString(),createdAt:now.toISOString()}
  const s={...s0,productionOrders:[order],downtimeEvents:[],timeLogs:[]}
  const o=E.workCenterOee(s,wc.id,7,now)
  assert.deepEqual([o.totalCount,o.goodCount,o.quality,o.performance],[100,80,80,83],'the job card counts, not the order (nothing finished yet)')
  assert.equal(o.oee,Math.round(o.availability/100*(100/120)*0.8*100))
})

/* ------------------------------------------------------------- 20. permissions -- */

test('P2-20: new commands carry permission rules and operator scope',()=>{
  const s=base()
  const role=id=>s.roles.find(r=>r.id===id)
  const can=(name,roleId,args=[])=>X.allowedBy(role(roleId),X.actionRules(name,args))
  for(const name of ['reportOperationOutput','markSetupDone','assignWorkOrder','rescheduleProductionOrder','confirmMrpSuggestion'])assert.ok(X.actionRules(name,['make:p1:x']),`${name} has a rule`)
  assert.deepEqual([can('reportOperationOutput','role5'),can('markSetupDone','role5'),can('assignWorkOrder','role5'),can('rescheduleProductionOrder','role5')],[true,true,false,false],'operators run, planners plan')
  assert.deepEqual([can('reportOperationOutput','role3'),can('assignWorkOrder','role2'),can('rescheduleProductionOrder','role2')],[false,true,true])
  assert.deepEqual([can('confirmMrpSuggestion','role7',['buy:rm1:x']),can('confirmMrpSuggestion','role7',['make:p1:x']),can('confirmMrpSuggestion','role2',['make:p1:x'])],[X.hasPermission(role('role7'),'purchases','create'),X.hasPermission(role('role7'),'production','create'),true])
  let {s:st,id}=running(s)
  const bo1=woOf(st,id,'bo1')
  // Scope: an operator of the laser (wc2) cannot report on the press (wc1); the press operator's centre is fine.
  const em3=st.employees.find(e=>e.id==='em3')
  assert.match(X.scopeBlocker(st,em3,'reportOperationOutput',[id,bo1.id,1,0]),/faqat Laser Cutting/)
  assert.equal(X.scopeBlocker(st,st.employees.find(e=>e.id==='em2'),'reportOperationOutput',[id,bo1.id,1,0]),null)
  refused(st,A.assignWorkOrder(st,ctx(st),id,bo1.id,['em3']),/faqat Laser Cutting/)
  refused(st,A.assignWorkOrder(st,ctx(st),id,bo1.id,['em7']),/doirasida emas|boshqa filial/)
  refused(st,A.assignWorkOrder(st,ctx(st),id,bo1.id,['em4']),/bajara olmaydi/)
  refused(st,A.startWorkOrder(st,ctx(st),id,bo1.id,'em3'),/faqat Laser Cutting/)
  st=ok(A.assignWorkOrder(st,ctx(st),id,bo1.id,['em2']))
  assert.deepEqual(woOf(st,id,'bo1').operatorIds,['em2'])
  st=ok(A.startWorkOrder(st,ctx(st),id,bo1.id,'em2'))
  assert.equal(st.timeLogs.find(t=>t.workOrderId===bo1.id&&!t.end).employeeId,'em2')
})
