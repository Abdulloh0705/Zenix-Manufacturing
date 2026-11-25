// Manufacturing completion (2026-11-12): end-to-end rules of a production order, checked on the real engine —
// reservation release on cancel, no double issue / receipt / return / completion, BOM history kept, frozen cost,
// QC-held output not sellable, and stock ↔ order consumption in sync. A refused command returns the state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as I from '../.test-dist/inventory.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-mc${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const policies=(s,p)=>({...s,settings:{...s.settings,policies:{...s.settings.policies,...p}}})
const clean=(p={requireFinalQc:false,autoQualityChecks:false})=>policies(createInitialState(T0),p)
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
function withStock(s,key,warehouseId,qty,code='ST-1'){
  const m=s.rawMaterials.find(x=>x.id===key)
  return {...s,lots:[...s.lots,{id:`lot-${code}`,code,kind:'lot',itemId:key,itemType:'raw',qty,originalQty:qty,warehouseId,status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-10-01 08:00',consumedBy:[]}],
    stockBalances:[...s.stockBalances.filter(b=>!(I.keyOf(b)===key&&b.warehouseId===warehouseId)),{id:`st-${key}-${warehouseId}`,warehouseId,itemId:key,itemType:'raw',onHand:qty,reserved:0,incoming:0,quarantine:0,unit:m.unit}]}
}
const order=(s,id)=>s.productionOrders.find(o=>o.id===id)
function confirmed(s,qty=20){
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:qty,start:TODAY,due:'2026-10-30'});s=ok(mo,'create: ')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'),'confirm: ')
  return {s,id:mo.result.id}
}
const consumedQty=(o,mat)=>o.consumed.filter(c=>c.materialId===mat).reduce((a,c)=>a+c.qty,0)
const finishedOnHand=s=>s.stockBalances.filter(b=>I.keyOf(b)==='p3').reduce((a,b)=>a+b.onHand,0)

test('a confirmed order reserves its material; cancelling it releases the reservation and the lot pins',()=>{
  let {s,id}=confirmed(withStock(clean(),'rm2','w1',200))
  const o=order(s,id)
  assert.equal(o.materialReserved,true)
  const reserved=bal(s,'rm2','w1').reserved
  assert.ok(reserved>0)
  assert.ok((o.reservations||[]).some(r=>(r.lots||[]).length),'reservation pins its FEFO lot')
  s=ok(A.transitionProduction(s,ctx(s),id,'Bekor qilingan'))
  assert.equal(order(s,id).status,'Bekor qilingan')
  assert.equal(bal(s,'rm2','w1').reserved,0,'reservation released')
  assert.equal(bal(s,'rm2','w1').onHand,200,'nothing was consumed')
})

test('material is issued (backflushed) with output, in sync with stock; output is received once per key; never above plan',()=>{
  let {s,id}=confirmed(withStock(clean(),'rm2','w1',200))
  const wo=order(s,id).workOrders[0]
  s=ok(A.startWorkOrder(s,ctx(s),id,wo.id))
  const before=finishedOnHand(s)
  s=ok(A.reportOutput(s,ctx(s),id,10,0,'Shop Floor scrap','out-1'))
  const issued=consumedQty(order(s,id),'rm2')
  assert.ok(issued>0,'material issued for the reported output')
  assert.ok(Math.abs(200-bal(s,'rm2','w1').onHand-issued)<1e-6,'stock went down exactly by what the order consumed')
  const again=A.reportOutput(s,ctx(s),id,10,0,'Shop Floor scrap','out-1')
  assert.equal(order(again.state,id).completed,10,'the same output report is booked once')
  s=again.state
  assert.equal(finishedOnHand(s)-before,10,'finished goods received once')
  refused(s,A.reportOutput(s,ctx(s),id,11,0),/./)
  assert.ok(Math.abs(200-bal(s,'rm2','w1').onHand-consumedQty(order(s,id),'rm2'))<1e-6,'still in sync after output')
})

test('an operation is finished once; a waiting operation cannot be finished; double start refused',()=>{
  let {s,id}=confirmed(withStock(clean(),'rm2','w1',200))
  const wo=order(s,id).workOrders[0]
  refused(s,A.finishWorkOrder(s,ctx(s),id,wo.id),/./)
  s=ok(A.startWorkOrder(s,ctx(s),id,wo.id))
  refused(s,A.startWorkOrder(s,ctx(s),id,wo.id),/allaqachon ishlamoqda/)
  s=ok(A.pauseWorkOrder(s,ctx(s),id,wo.id))
  s=ok(A.startWorkOrder(s,ctx(s),id,wo.id),'resume: ')
  s=ok(A.finishWorkOrder(s,ctx(s),id,wo.id))
  refused(s,A.finishWorkOrder(s,ctx(s),id,wo.id),/./)
  const events=(order(s,id).workOrders[0].history||[]).map(e=>e.action)
  assert.ok(events.includes('pause')&&events.includes('resume'),'operation history keeps start, pause and resume')
})

test('extra issue is capped and audited; a material return is booked once',()=>{
  let {s,id}=confirmed(withStock(clean(),'rm2','w1',200))
  s=ok(A.startWorkOrder(s,ctx(s),id,order(s,id).workOrders[0].id))
  // A return is allowed only while nothing has worked on the issued units since: pause the operation first.
  s=ok(A.pauseWorkOrder(s,ctx(s),id,order(s,id).workOrders[0].id))
  refused(s,A.issueExtraMaterial(s,ctx(s),id,'rm2',1,''),/sababini/)
  refused(s,A.issueExtraMaterial(s,ctx(s),id,'rm2',10000,'Juda ko‘p'),/oshmasin/)
  s=ok(A.issueExtraMaterial(s,ctx(s),id,'rm2',2,'Kesishda nuqson'))
  const issue=order(s,id).consumed.filter(c=>c.materialId==='rm2').at(-1)
  const onHand=bal(s,'rm2','w1').onHand
  s=ok(A.returnUnusedMaterial(s,ctx(s),id,issue.id,1,'Ortib qoldi','ret-1'))
  const again=A.returnUnusedMaterial(s,ctx(s),id,issue.id,1,'Ortib qoldi','ret-1')
  assert.equal(bal(again.state,'rm2','w1').onHand,onHand+1,'the same return is booked once')
})

test('a new BOM version does not rewrite an existing order; completed order cost stays frozen',()=>{
  let {s,id}=confirmed(withStock(clean(),'rm2','w1',200))
  const snapshot=JSON.stringify(order(s,id).bomSnapshot)
  const draft=A.createBomDraft(s,ctx(s),'p3','bom3');s=ok(draft)
  const bom=s.boms.find(b=>b.id===draft.result.id)
  s=ok(A.saveBom(s,ctx(s),{...bom,components:bom.components.map(c=>({...c,qty:1.5}))}))
  s=ok(A.activateBom(s,ctx(s),draft.result.id))
  assert.equal(s.boms.find(b=>b.id==='bom3').status,'Arxiv','the old version is retired, kept')
  assert.equal(JSON.stringify(order(s,id).bomSnapshot),snapshot,'the order keeps the BOM it was planned with')
  s=ok(A.startWorkOrder(s,ctx(s),id,order(s,id).workOrders[0].id))
  s=ok(A.reportOutput(s,ctx(s),id,20))
  s=ok(A.finishWorkOrder(s,ctx(s),id,order(s,id).workOrders[0].id))
  if(order(s,id).status!=='Sifat nazoratida'&&order(s,id).status!=='Yakunlangan')s=ok(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'),'to QC: ')
  if(order(s,id).status!=='Yakunlangan')s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'),'complete: ')
  const frozen=E.orderCosting(s,order(s,id)).actual.total
  assert.ok(frozen>0)
  const repriced={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm2'?{...m,standardCost:m.standardCost*10}:m)}
  assert.equal(E.orderCosting(repriced,order(repriced,id)).actual.total,frozen,'price changes do not rewrite a completed order')
  assert.equal(E.orderCosting(s,order(s,id)).wip,0,'a closed order holds no WIP')
})

test('output waiting for Final QC is quarantined and not sellable until released',()=>{
  let {s,id}=confirmed(withStock(clean({requireFinalQc:true,autoQualityChecks:false}),'rm2','w1',200))
  s=ok(A.startWorkOrder(s,ctx(s),id,order(s,id).workOrders[0].id))
  const free=A.salesAvailable(s,s.employees.find(e=>e.id==='em1'),'p3',TODAY)
  s=ok(A.reportOutput(s,ctx(s),id,10))
  assert.equal(A.salesAvailable(s,s.employees.find(e=>e.id==='em1'),'p3',TODAY),free,'quarantined output is not available to sell')
  assert.ok(s.lots.some(l=>l.itemId==='p3'&&l.sourceId===id&&l.status==='quarantine'))
})
