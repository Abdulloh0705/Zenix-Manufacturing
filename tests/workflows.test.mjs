import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {stockOf,remainingQty,perUnit,isOpenOrder,orderReservations,plannedIssue,buildTraceability,findTraceOrder} from '../.test-dist/manufacturingEngine.mjs'

let counter=0
const fresh=()=>createSeedState(new Date())
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-t${++counter}`})
const reservedOf=(s,itemId)=>s.stockBalances.filter(b=>b.itemId===itemId).reduce((a,b)=>a+b.reserved,0)

function newConfirmedOrder(s,productId='p1',quantity=100){
  const created=A.createProductionOrder(s,ctx(s),{productId,quantity})
  assert.ok(created.result.ok,created.result.message)
  const confirmed=A.transitionProduction(created.state,ctx(created.state),created.result.id,'Tasdiqlangan')
  assert.ok(confirmed.result.ok,confirmed.result.message)
  return {state:confirmed.state,id:created.result.id}
}

test('action results are synchronous and describe what actually happened',()=>{
  const s=fresh()
  const first=A.unbuildProduct(s,ctx(s),'p1',1)
  const second=A.unbuildProduct(first.state,ctx(first.state),'p1',1)
  assert.equal(first.result.ok,true)
  assert.equal(second.result.ok,true,'a second successful action must not report failure')
})

test('confirming an order reserves exactly its remaining component requirement',()=>{
  const s=fresh()
  const before=reservedOf(s,'rm1')
  const {state,id}=newConfirmedOrder(s,'p1',100)
  const order=state.productionOrders.find(o=>o.id===id)
  const need=perUnit(order.bomSnapshot.components.find(c=>c.materialId==='rm1'))*100
  assert.ok(Math.abs(reservedOf(state,'rm1')-before-need)<1e-6)
})

test('an order without enough material waits instead of silently failing',()=>{
  const s=fresh()
  const created=A.createProductionOrder(s,ctx(s),{productId:'p2',quantity:5000})
  const confirmed=A.transitionProduction(created.state,ctx(created.state),created.result.id,'Tasdiqlangan')
  assert.equal(confirmed.result.ok,false)
  assert.equal(confirmed.state.productionOrders.find(o=>o.id===created.result.id).status,'Material kutilmoqda')
})

test('scrapped units are consumed but never received as good stock',()=>{
  let {state,id}=newConfirmedOrder(fresh(),'p1',100)
  const fgBefore=stockOf(state,'p1').onHand
  state=A.transitionProduction(state,ctx(state),id,'Jarayonda').state
  const out=A.reportOutput(state,ctx(state),id,90,10)
  assert.ok(out.result.ok,out.result.message)
  state=out.state
  const order=state.productionOrders.find(o=>o.id===id)
  assert.equal(order.completed,90)
  assert.equal(order.scrap,10)
  assert.equal(stockOf(state,'p1').onHand-fgBefore,90)
  assert.equal(remainingQty(order),0)
})

test('completion requires executed operations, real output and a passed final quality check',()=>{
  let {state,id}=newConfirmedOrder(fresh(),'p3',50)
  state=A.transitionProduction(state,ctx(state),id,'Jarayonda').state
  assert.equal(A.transitionProduction(state,ctx(state),id,'Sifat nazoratida').result.ok,false,'unfinished operations block final QC')
  for(const wo of [...state.productionOrders.find(o=>o.id===id).workOrders]){
    const started=A.startWorkOrder(state,ctx(state),id,wo.id);assert.ok(started.result.ok,started.result.message);state=started.state
    const finished=A.finishWorkOrder(state,ctx(state),id,wo.id);assert.ok(finished.result.ok,finished.result.message);state=finished.state
  }
  state=A.reportOutput(state,ctx(state),id,50,0).state
  const qc=A.transitionProduction(state,ctx(state),id,'Sifat nazoratida');assert.ok(qc.result.ok,qc.result.message);state=qc.state
  const blocked=A.transitionProduction(state,ctx(state),id,'Yakunlangan')
  assert.equal(blocked.result.ok,false)
  const check=state.qualityChecks.find(q=>q.sourceId===id&&q.type==='Final'&&q.status==='Pending')
  assert.ok(check,'a final check is generated automatically')
  const failed=A.resolveQuality(state,ctx(state,'em4'),check.id,'Failed','burr')
  assert.equal(A.transitionProduction(failed.state,ctx(failed.state),id,'Yakunlangan').result.ok,false,'failed QC must block completion')
  const passed=A.resolveQuality(state,ctx(state,'em4'),check.id,'Passed')
  const done=A.transitionProduction(passed.state,ctx(passed.state),id,'Yakunlangan')
  assert.ok(done.result.ok,done.result.message)
  const order=done.state.productionOrders.find(o=>o.id===id)
  assert.equal(order.completed,50)
  assert.ok(order.lot,'finished lot assigned')
  assert.equal(order.materialReserved,false)
})

test('cancel releases only the remaining reservation of that order',()=>{
  const s=fresh()
  const others=reservedOf(s,'rm1')
  const {state,id}=newConfirmedOrder(s,'p1',100)
  const cancelled=A.transitionProduction(state,ctx(state),id,'Bekor qilingan')
  assert.ok(cancelled.result.ok)
  assert.ok(Math.abs(reservedOf(cancelled.state,'rm1')-others)<1e-6,'other orders keep their reservation')
})

test('backorder requires reported output and completed operations, then keeps the original quantity honest',()=>{
  let {state,id}=newConfirmedOrder(fresh(),'p1',100)
  assert.equal(A.createBackorder(state,ctx(state),id).result.ok,false,'no output yet → no backorder')
  state=A.transitionProduction(state,ctx(state),id,'Jarayonda').state
  state=A.reportOutput(state,ctx(state),id,40,0).state
  assert.equal(A.createBackorder(state,ctx(state),id).result.ok,false,'unfinished routing cannot be auto-completed by backorder')
  for(const wo of [...state.productionOrders.find(o=>o.id===id).workOrders]){
    state=A.startWorkOrder(state,ctx(state),id,wo.id).state
    state=A.finishWorkOrder(state,ctx(state),id,wo.id).state
  }
  const back=A.createBackorder(state,ctx(state),id)
  assert.ok(back.result.ok,back.result.message)
  const original=back.state.productionOrders.find(o=>o.id===id)
  const child=back.state.productionOrders.find(o=>o.id===back.result.id)
  assert.equal(original.quantity,40)
  assert.equal(child.quantity,60)
})

test('work orders respect routing dependencies and log labour time',()=>{
  let {state,id}=newConfirmedOrder(fresh(),'p1',50)
  const [first,second]=state.productionOrders.find(o=>o.id===id).workOrders
  const early=A.startWorkOrder(state,ctx(state),id,second.id)
  assert.equal(early.result.ok,false,'dependent operation cannot start first')
  state=A.startWorkOrder(state,ctx(state),id,first.id,'em2').state
  assert.ok(state.timeLogs.some(t=>t.workOrderId===first.id&&!t.end))
  state=A.finishWorkOrder(state,ctx(state),id,first.id).state
  assert.ok(state.timeLogs.filter(t=>t.workOrderId===first.id).every(t=>t.end))
  assert.ok(A.startWorkOrder(state,ctx(state),id,second.id).result.ok)
})

test('MTS sales orders reserve finished goods and delivery consumes the reservation',()=>{
  const s=fresh()
  const created=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p1',qty:50,mode:'Make-to-stock'})
  assert.ok(created.result.ok)
  const so=created.state.salesOrders.find(o=>o.id===created.result.id)
  assert.equal(so.status,'Tayyor')
  assert.equal(so.items[0].reserved,50)
  const before=stockOf(created.state,'p1')
  const delivered=A.deliverSalesOrder(created.state,ctx(created.state),so.id)
  assert.ok(delivered.result.ok,delivered.result.message)
  const after=stockOf(delivered.state,'p1')
  assert.equal(before.onHand-after.onHand,50)
  assert.equal(before.reserved-after.reserved,50)
  assert.ok(delivered.state.stockMovements.some(m=>m.type==='Sale -'&&m.source===so.code&&m.lot),'delivery records the lot shipped')
})

test('cancelling a sales order releases its reservation',()=>{
  const s=fresh()
  const created=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p1',qty:30,mode:'Make-to-stock'})
  const before=reservedOf(created.state,'p1')
  const cancelled=A.cancelSalesOrder(created.state,ctx(created.state),created.result.id)
  assert.ok(cancelled.result.ok)
  assert.equal(before-reservedOf(cancelled.state,'p1'),30)
})

test('purchase receipt creates a lot, raises stock and auto-reserves waiting orders',()=>{
  const s=fresh()
  const waiting=s.productionOrders.find(o=>o.status==='Material kutilmoqda')
  assert.ok(waiting,'seed has an order waiting for material')
  let state=s
  for(const po of s.purchaseOrders.filter(p=>['Tasdiqlangan','Yo‘lda'].includes(p.status)))for(const item of po.items){
    const material=state.rawMaterials.find(m=>m.id===item.materialId)
    const r=A.receivePurchase(state,ctx(state),po.id,item.materialId,item.qty-item.received,undefined,material?.expiryTracking?'2099-12-31':undefined)
    assert.ok(r.result.ok,r.result.message)
    state=r.state
    const qc=state.qualityChecks.find(q=>q.sourceId===po.id&&q.itemId===item.materialId&&q.status==='Pending')
    if(qc){const passed=A.resolveQuality(state,ctx(state,'em4'),qc.id,'Passed');assert.ok(passed.result.ok,passed.result.message);state=passed.state}
  }
  assert.ok(state.lots.filter(l=>l.sourceType==='purchase').length>s.lots.filter(l=>l.sourceType==='purchase').length)
  assert.equal(state.productionOrders.find(o=>o.id===waiting.id).status,'Tasdiqlangan')
})

test('deleting a referenced record is refused with a reason',()=>{
  const s=fresh()
  const r=A.deleteEntity(s,ctx(s),'products','p1')
  assert.equal(r.result.ok,false)
  assert.match(r.result.message,/Arxiv/)
})

test('ECO applies a new BOM revision without touching existing order snapshots',()=>{
  const s=fresh()
  const eco=s.engineeringChanges.find(e=>e.status==='Review')
  const snapshotBefore=JSON.stringify(s.productionOrders.find(o=>o.productId===eco.productId&&o.status!=='Yakunlangan').bomSnapshot)
  assert.equal(A.applyEngineeringChange(s,ctx(s),eco.id).result.ok,false,'must be approved first')
  // N-12: the author does not approve their own change; it applies from its effective date.
  assert.equal(A.setEcoStatus(s,ctx(s,eco.ownerId),eco.id,'Approved').result.ok,false,'no self-approval')
  const approver=s.employees.find(e=>e.id!==eco.ownerId).id
  const approved=A.setEcoStatus(s,ctx(s,approver),eco.id,'Approved')
  assert.ok(approved.result.ok,approved.result.message)
  const early={...ctx(approved.state),now:new Date(new Date(`${eco.effectiveDate}T09:00`).getTime()-86400000)}
  assert.equal(A.applyEngineeringChange(approved.state,early,eco.id).result.ok,false,'not before its effective date')
  const onDate={...ctx(approved.state),now:new Date(`${eco.effectiveDate}T09:00`)}
  const applied=A.applyEngineeringChange(approved.state,onDate,eco.id)
  assert.ok(applied.result.ok,applied.result.message)
  const product=applied.state.products.find(p=>p.id===eco.productId)
  assert.equal(product.defaultBomId,eco.newBomId)
  assert.equal(applied.state.boms.find(b=>b.id===eco.bomId).status,'Arxiv')
  assert.equal(JSON.stringify(applied.state.productionOrders.find(o=>o.productId===eco.productId&&o.status!=='Yakunlangan').bomSnapshot),snapshotBefore)
})

test('downtime stops the machine, blocks its work center and feeds OEE availability',()=>{
  const s=fresh()
  const started=A.startDowntime(s,ctx(s),'eq3','Unplanned stop','test')
  assert.ok(started.result.ok)
  assert.equal(started.state.equipment.find(e=>e.id==='eq3').status,'To‘xtagan')
  const ev=started.state.downtimeEvents.find(d=>d.equipmentId==='eq3'&&!d.end)
  const ended=A.endDowntime(started.state,ctx(started.state),ev.id)
  assert.equal(ended.state.equipment.find(e=>e.id==='eq3').status,'Ishlamoqda')
})

test('customer return is received into quarantine with a movement; good-stock disposition makes it available',()=>{
  const s=fresh()
  const ret=s.returns.find(r=>r.status==='Inspection')
  assert.ok(ret.warehouseId,'the return was received into a warehouse when it was registered')
  assert.ok(s.stockMovements.some(m=>m.type==='Return +'&&m.source===ret.code&&m.warehouseId===ret.warehouseId))
  const before=stockOf(s,ret.productId,ret.warehouseId)
  const done=A.dispositionReturn(s,ctx(s,'em4'),ret.id,'Omborga qaytarildi')
  assert.ok(done.result.ok)
  const after=stockOf(done.state,ret.productId,ret.warehouseId)
  assert.equal(after.onHand,before.onHand,'on hand already counted at receipt')
  assert.equal(before.quarantine-after.quarantine,ret.qty,'quarantine released')
})

test('material scan validates the BOM and posts a real material issue',()=>{
  const s=fresh()
  const mo=s.productionOrders.find(o=>o.status==='Jarayonda')
  const wrong=s.rawMaterials.find(m=>!mo.bomSnapshot.components.some(c=>c.materialId===m.id))
  const bad=A.recordMaterialScan(s,ctx(s),mo.id,wrong.sku)
  assert.equal(bad.result.ok,false)
  const right=s.rawMaterials.find(m=>mo.bomSnapshot.components.some(c=>c.materialId===m.id))
  const before=stockOf(s,right.id).onHand
  const good=A.recordMaterialScan(s,ctx(s),mo.id,right.sku)
  assert.ok(good.result.ok)
  assert.ok(stockOf(good.state,right.id).onHand<before,'scan must issue material, not only validate it')
  assert.ok(good.state.stockMovements.some(m=>m.type==='Material Issue -'&&m.source===mo.code))
  assert.ok(good.state.activity[0].action.includes('scan'))
})

test('PO and SO header edits cannot touch lines, and cancelled records are locked',()=>{
  const s=fresh()
  const po=s.purchaseOrders.find(p=>p.status==='Tasdiqlangan')
  const r=A.updatePurchaseMeta(s,ctx(s),po.id,{invoiceStatus:'Tekshirildi'})
  assert.ok(r.result.ok)
  const updated=r.state.purchaseOrders.find(p=>p.id===po.id)
  assert.equal(updated.invoiceStatus,'Tekshirildi')
  assert.deepEqual(updated.items,po.items)
  assert.equal(A.updatePurchaseMeta(s,ctx(s),po.id,{paymentStatus:'To‘langan'}).result.ok,false,'payment status follows payable entries')
  const cancelled=A.cancelPurchase(s,ctx(s),po.id)
  assert.equal(A.updatePurchaseMeta(cancelled.state,ctx(cancelled.state),po.id,{paymentStatus:'Qisman'}).result.ok,false)
})

test('draft BOM linked to an open ECO cannot be deleted; an unlinked draft can',()=>{
  const s=fresh()
  const eco=s.engineeringChanges.find(e=>e.status==='Review')
  assert.equal(A.deleteBomDraft(s,ctx(s),eco.newBomId).result.ok,false)
  const draft=A.createBomDraft(s,ctx(s),'p3')
  assert.ok(draft.result.ok)
  assert.ok(A.deleteBomDraft(draft.state,ctx(draft.state),draft.result.id).result.ok)
})

test('standard cost roll-up is idempotent on consistent data',()=>{
  const s=fresh()
  const r=A.rollUpCosts(s,ctx(s))
  assert.ok(r.result.ok)
  assert.equal(r.state,s,'seed is already rolled up, so nothing changes')
})

test('role permission edits guard against locking yourself out',()=>{
  const s=fresh()
  const own=s.employees.find(e=>e.id===s.currentEmployeeId).roleId
  assert.equal(A.updateRolePermission(s,ctx(s),own,'settings','view',false).result.ok,false)
  const other=A.updateRolePermission(s,ctx(s),'role5','quality','edit',true)
  assert.ok(other.result.ok)
  assert.equal(other.state.roles.find(r=>r.id==='role5').permissions.quality.view,true,'granting edit implies view')
})

test('incoming QC keeps stock quarantined until pass and failed material can be returned to supplier',()=>{
  let s=fresh()
  const created=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:5,price:22500}],status:'Tasdiqlangan'})
  assert.ok(created.result.ok,created.result.message);s=created.state
  const before=stockOf(s,'rm1')
  const received=A.receivePurchase(s,ctx(s),created.result.id,'rm1',5,'TEST-QC-LOT')
  assert.ok(received.result.ok,received.result.message);s=received.state
  const held=stockOf(s,'rm1')
  assert.equal(Math.round((held.available-before.available)*1000)/1000,0,'quarantine must not increase available')
  assert.ok(held.quarantine>=before.quarantine+5)
  const check=s.qualityChecks.find(q=>q.sourceId===created.result.id&&q.status==='Pending')
  assert.ok(check?.receiptId,'auto QC is tied to the exact receipt')
  const failed=A.resolveQuality(s,ctx(s,'em4'),check.id,'Failed','incoming defect');assert.ok(failed.result.ok);s=failed.state
  const returned=A.returnPurchaseToSupplier(s,ctx(s),check.id);assert.ok(returned.result.ok,returned.result.message);s=returned.state
  assert.ok(s.stockMovements.some(m=>m.type==='Supplier Return -'&&m.source===s.purchaseOrders.find(p=>p.id===created.result.id).code))
})

test('sales reservation can split across warehouses and delivery supports partial quantities',()=>{
  let s=fresh()
  const moved=A.transferStock(s,ctx(s),'p1','w3','w4',1000);assert.ok(moved.result.ok,moved.result.message);s=moved.state
  const created=A.createSalesOrder(s,ctx(s),{customerId:'cu1',lines:[{productId:'p1',qty:1500}],mode:'Make-to-stock'})
  assert.ok(created.result.ok,created.result.message);s=created.state
  let so=s.salesOrders.find(o=>o.id===created.result.id)
  assert.ok(so.items[0].reservations.length>=2,'reservation is split when one warehouse is insufficient')
  const partial=A.deliverSalesOrder(s,ctx(s),so.id,{p1:600});assert.ok(partial.result.ok,partial.result.message);s=partial.state
  so=s.salesOrders.find(o=>o.id===created.result.id);assert.equal(so.items[0].delivered,600);assert.notEqual(so.status,'Yetkazildi')
  assert.equal(A.deliverSalesOrder(s,ctx(s),so.id,{p1:1000}).result.ok,false,'delivery above the open quantity is rejected, not silently capped')
  const rest=A.deliverSalesOrder(s,ctx(s),so.id,{p1:900});assert.ok(rest.result.ok,rest.result.message)
  assert.equal(rest.state.salesOrders.find(o=>o.id===created.result.id).status,'Yetkazildi')
})

test('maintenance cannot be completed before it is started',()=>{
  const s=fresh()
  const planned=s.maintenanceOrders.find(m=>m.status==='Rejada')
  assert.ok(planned,'seed has a planned maintenance order')
  assert.equal(A.completeMaintenance(s,ctx(s),planned.id,1000).result.ok,false)
  const started=A.startMaintenance(s,ctx(s),planned.id);assert.ok(started.result.ok,started.result.message)
  const done=A.completeMaintenance(started.state,ctx(started.state),planned.id,1000);assert.ok(done.result.ok,done.result.message)
})

/* --- BUG-01: per-order material reservations -------------------------------------------------- */

const rawOf=(s,o)=>o.bomSnapshot.components.filter(c=>s.rawMaterials.some(m=>m.id===c.materialId))
const skuOf=(s,materialId)=>s.rawMaterials.find(m=>m.id===materialId).sku
const orderOf=(s,id)=>s.productionOrders.find(o=>o.id===id)
const balanceOf=(s,warehouseId,itemId)=>s.stockBalances.find(b=>b.warehouseId===warehouseId&&b.itemId===itemId)
const holdOf=(s,id,materialId)=>orderReservations(s,orderOf(s,id)).filter(r=>r.materialId===materialId).reduce((a,r)=>a+r.qty,0)
const holdWarehouse=(s,id,materialId)=>orderReservations(s,orderOf(s,id)).find(r=>r.materialId===materialId).warehouseId
const issuedOf=(s,id,materialId)=>orderOf(s,id).consumed.filter(c=>c.materialId===materialId).reduce((a,c)=>a+c.qty,0)
function startedOrder(s,productId,quantity){
  const r=newConfirmedOrder(s,productId,quantity)
  const started=A.transitionProduction(r.state,ctx(r.state),r.id,'Jarayonda')
  assert.ok(started.result.ok,started.result.message)
  return {state:started.state,id:r.id}
}
/** Fixture: the order's own reservation of `materialId` is gone and all remaining stock belongs to others or QC. */
function exhaust(s,id,materialId){
  const wh=holdWarehouse(s,id,materialId),mine=holdOf(s,id,materialId)
  return {...s,
    productionOrders:s.productionOrders.map(o=>o.id===id?{...o,reservations:o.reservations.map(r=>r.materialId===materialId?{...r,qty:0}:r)}:o),
    stockBalances:s.stockBalances.map(b=>b.warehouseId===wh&&b.itemId===materialId?{...b,reserved:b.reserved-mine,onHand:b.reserved-mine+(b.quarantine||0)}:b)}
}
/** Every raw material reservation on a balance is backed by open orders' records. */
function assertReservationsBacked(s){
  for(const b of s.stockBalances.filter(b=>s.rawMaterials.some(m=>m.id===b.itemId))){
    const held=s.productionOrders.filter(isOpenOrder).flatMap(o=>orderReservations(s,o)).filter(r=>r.warehouseId===b.warehouseId&&r.materialId===b.itemId).reduce((a,r)=>a+r.qty,0)
    assert.ok(Math.abs(held-b.reserved)<0.01,`${b.itemId}@${b.warehouseId}: balance reserved ${b.reserved}, order records ${held}`)
  }
}

test('BUG-01: confirming stores the reservation on the order, per material and warehouse',()=>{
  const {state,id}=newConfirmedOrder(fresh(),'p1',10)
  const o=orderOf(state,id)
  assert.ok(Array.isArray(o.reservations)&&o.reservations.length>0)
  for(const c of o.bomSnapshot.components)assert.ok(Math.abs(holdOf(state,id,c.materialId)-plannedIssue(o,c.materialId))<1e-6)
  assertReservationsBacked(state)
})

test('BUG-01: scanning one order until it is refused never touches another order’s reservation',()=>{
  let {state:s,id:a}=startedOrder(fresh(),'p1',10)
  const b=newConfirmedOrder(s,'p1',10);s=b.state
  const comp=rawOf(s,orderOf(s,a))[0]
  const heldB=holdOf(s,b.id,comp.materialId)
  let accepted=0,last
  for(let i=0;i<100;i++){const r=A.recordMaterialScan(s,ctx(s),a,skuOf(s,comp.materialId));last=r;if(!r.result.ok)break;s=r.state;accepted++}
  assert.equal(last.result.ok,false)
  assert.match(last.result.message,/BOM rejasi/)
  // One scan per unit, plus at most one more for the 3-decimal rounding remainder of the plan.
  assert.ok(accepted<=11,`at most one scan per unit (${accepted})`)
  assert.ok(Math.abs(issuedOf(s,a,comp.materialId)-plannedIssue(orderOf(s,a),comp.materialId))<1e-6,'issued exactly the BOM plan')
  assert.equal(holdOf(s,b.id,comp.materialId),heldB,'the other order keeps its full reservation')
  assertReservationsBacked(s)
})

test('BUG-01: a scan beyond the BOM plan is refused and changes nothing',()=>{
  let {state:s,id}=startedOrder(fresh(),'p1',2)
  const comp=rawOf(s,orderOf(s,id))[0]
  for(let i=0;i<5;i++){const r=A.recordMaterialScan(s,ctx(s),id,skuOf(s,comp.materialId));if(!r.result.ok)break;s=r.state}
  const over=A.recordMaterialScan(s,ctx(s),id,skuOf(s,comp.materialId))
  assert.equal(over.result.ok,false)
  assert.equal(over.state,s,'refused scan returns the untouched state')
})

test('BUG-01: without own reservation or free stock a scan is refused and changes nothing',()=>{
  let {state:s,id}=startedOrder(fresh(),'p1',10)
  const comp=rawOf(s,orderOf(s,id))[0]
  s=exhaust(s,id,comp.materialId)
  const r=A.recordMaterialScan(s,ctx(s),id,skuOf(s,comp.materialId))
  assert.equal(r.result.ok,false)
  assert.match(r.result.message,/yetarli emas/)
  assert.equal(r.state,s)
})

test('BUG-01: backflush takes the order’s own reservation and leaves the others intact',()=>{
  let {state:s,id:a}=startedOrder(fresh(),'p1',10)
  const b=newConfirmedOrder(s,'p1',10);s=b.state
  const before=rawOf(s,orderOf(s,a)).map(c=>{const wh=holdWarehouse(s,a,c.materialId);return {c,wh,heldA:holdOf(s,a,c.materialId),heldB:holdOf(s,b.id,c.materialId),reserved:balanceOf(s,wh,c.materialId).reserved}})
  const out=A.reportOutput(s,ctx(s),a,10,0)
  assert.ok(out.result.ok,out.result.message)
  for(const x of before){
    assert.ok(holdOf(out.state,a,x.c.materialId)<1e-6,'own reservation used up')
    assert.equal(holdOf(out.state,b.id,x.c.materialId),x.heldB,'other order untouched')
    assert.ok(Math.abs(x.reserved-balanceOf(out.state,x.wh,x.c.materialId).reserved-x.heldA)<1e-6,'balance released exactly the order’s own share')
  }
  assertReservationsBacked(out.state)
})

test('BUG-01: backflush that is short on any component is refused as a whole',()=>{
  let {state:s,id}=startedOrder(fresh(),'p1',10)
  const comps=rawOf(s,orderOf(s,id))
  assert.ok(comps.length>=2,'fixture needs an order with two raw components')
  s=exhaust(s,id,comps[comps.length-1].materialId)
  const snapshot=JSON.stringify(s)
  const out=A.reportOutput(s,ctx(s),id,10,0)
  assert.equal(out.result.ok,false)
  assert.equal(out.state,s)
  assert.equal(JSON.stringify(s),snapshot,'no balance, lot, movement or order changed')
  assert.equal(A.recordScrap(s,ctx(s),id,10,'test').result.ok,false,'scrap backflush follows the same rule')
})

test('BUG-01: a reserved order keeps issuing from the warehouse it reserved in',()=>{
  let {state:s,id}=startedOrder(fresh(),'p1',10)
  const comp=rawOf(s,orderOf(s,id))[0]
  const wh=holdWarehouse(s,id,comp.materialId)
  // A new active raw store of the same branch now comes first in the list.
  s={...s,warehouses:[{...s.warehouses.find(w=>w.id===wh),id:'wh-new-raw',name:'Yangi xomashyo ombori'},...s.warehouses]}
  const r=A.recordMaterialScan(s,ctx(s),id,skuOf(s,comp.materialId))
  assert.ok(r.result.ok,r.result.message)
  assert.equal(r.state.stockMovements[0].warehouseId,wh)
})

test('BUG-01: orders saved before per-order reservations derive them and stay isolated',()=>{
  let {state:s,id:a}=startedOrder(fresh(),'p1',10)
  const b=newConfirmedOrder(s,'p1',10);s=b.state
  // localStorage data from before this change: the reserved order has no reservation records.
  s={...s,productionOrders:s.productionOrders.map(o=>{if(o.id!==a)return o;const {reservations,...rest}=o;return rest})}
  const comp=rawOf(s,orderOf(s,a))[0]
  assert.ok(Math.abs(holdOf(s,a,comp.materialId)-plannedIssue(orderOf(s,a),comp.materialId))<1e-6,'derived = plan − issued')
  const heldB=holdOf(s,b.id,comp.materialId)
  // Phase 3: a derived (pre-pin) reservation of a lot-tracked material is never issued from an arbitrary lot —
  // it is reconciled to real lots first, keeping its quantity and warehouse.
  const blocked=A.recordMaterialScan(s,ctx(s),a,skuOf(s,comp.materialId))
  assert.equal(blocked.result.ok,false);assert.match(blocked.result.message,/LOT bilan bog‘lash/);assert.equal(blocked.state,s)
  const pinned=A.allocateLegacyLots(s,ctx(s),'mo',a);assert.ok(pinned.result.ok,pinned.result.message);s=pinned.state
  assert.ok(Math.abs(holdOf(s,a,comp.materialId)-plannedIssue(orderOf(s,a),comp.materialId))<1e-6,'reconciliation keeps the quantity')
  const r=A.recordMaterialScan(s,ctx(s),a,skuOf(s,comp.materialId))
  assert.ok(r.result.ok,r.result.message)
  assert.ok(Array.isArray(orderOf(r.state,a).reservations),'records are written on first issue')
  assert.equal(holdOf(r.state,b.id,comp.materialId),heldB)
  assertReservationsBacked(r.state)
})

test('BUG-01: seed history keeps every raw reservation backed by an order record',()=>{
  assertReservationsBacked(fresh())
})

/* --- BUG-02: releasing exactly what an order holds ------------------------------------------- */

function scanUnits(s,id,materialId,units){
  for(let i=0;i<units;i++){const r=A.recordMaterialScan(s,ctx(s),id,skuOf(s,materialId));assert.ok(r.result.ok,r.result.message);s=r.state}
  return s
}
function finishOperations(s,id){
  for(const wo of orderOf(s,id).workOrders.filter(w=>w.status!=='Yakunlangan')){
    const started=A.startWorkOrder(s,ctx(s),id,wo.id);assert.ok(started.result.ok,started.result.message)
    const finished=A.finishWorkOrder(started.state,ctx(started.state),id,wo.id);assert.ok(finished.result.ok,finished.result.message);s=finished.state
  }
  return s
}
/** Operations, the rest of the output, final QC pass and completion. */
function completeOrder(s,id){
  s=finishOperations(s,id)
  if(remainingQty(orderOf(s,id))>0){const out=A.reportOutput(s,ctx(s),id,remainingQty(orderOf(s,id)),0);assert.ok(out.result.ok,out.result.message);s=out.state}
  const qc=A.transitionProduction(s,ctx(s),id,'Sifat nazoratida');assert.ok(qc.result.ok,qc.result.message);s=qc.state
  // Every open inspection of the order (in-process ones too, N-13) is decided before completion.
  for(const check of s.qualityChecks.filter(q=>q.sourceId===id&&q.status==='Pending')){const passed=A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed');assert.ok(passed.result.ok,passed.result.message);s=passed.state}
  const done=A.transitionProduction(s,ctx(s),id,'Yakunlangan');assert.ok(done.result.ok,done.result.message)
  return done.state
}
/** Two orders on the same material: A runs and issues ahead of output, B only holds its reservation. */
function twoOrders(){
  let {state:s,id:a}=startedOrder(fresh(),'p1',10)
  const b=newConfirmedOrder(s,'p1',10);s=b.state
  return {s,a,b:b.id,m:rawOf(s,orderOf(s,a))[0].materialId}
}
/** The order's reservation leaves the balances exactly once, and the other order keeps every unit of its record. */
function assertReleasedExactly(before,after,a,b,m){
  assert.ok(Math.abs(reservedOf(before,m)-reservedOf(after,m)-holdOf(before,a,m))<1e-6,`released ${reservedOf(before,m)-reservedOf(after,m)}, held ${holdOf(before,a,m)}`)
  assert.equal(holdOf(after,b,m),holdOf(before,b,m),'the other order keeps its reservation')
  assertReservationsBacked(after)
}

test('BUG-02: cancel after material was scanned ahead releases only what the order still holds',()=>{
  let {s,a,b,m}=twoOrders()
  s=scanUnits(s,a,m,5)
  const r=A.transitionProduction(s,ctx(s),a,'Bekor qilingan')
  assert.ok(r.result.ok,r.result.message)
  assertReleasedExactly(s,r.state,a,b,m)
  assert.equal(issuedOf(r.state,a,m),issuedOf(s,a,m),'issued material is not returned to stock')
})

test('BUG-02: short close after output and scans ahead releases only the order’s own rest',()=>{
  let {s,a,b,m}=twoOrders()
  s=A.reportOutput(s,ctx(s),a,4,0).state
  s=scanUnits(s,a,m,3)
  const r=A.shortCloseProduction(s,ctx(s),a,'test')
  assert.ok(r.result.ok,r.result.message)
  assertReleasedExactly(s,r.state,a,b,m)
  assert.equal(orderOf(r.state,a).materialReserved,false)
})

test('BUG-02: backorder after output and scans ahead releases only the order’s own rest',()=>{
  let {s,a,b,m}=twoOrders()
  s=finishOperations(s,a)
  s=A.reportOutput(s,ctx(s),a,4,0).state
  s=scanUnits(s,a,m,3)
  const r=A.createBackorder(s,ctx(s),a)
  assert.ok(r.result.ok,r.result.message)
  assertReleasedExactly(s,r.state,a,b,m)
  assert.equal(orderOf(r.state,r.result.id).materialReserved,false,'the backorder starts unreserved')
})

test('BUG-02: split after scans ahead reserves net needs and leaves nothing stuck after completion',()=>{
  let {s,a,b,m}=twoOrders()
  s=scanUnits(s,a,m,3)
  const r=A.splitProduction(s,ctx(s),a,4)
  assert.ok(r.result.ok,r.result.message)
  const left=orderOf(r.state,a),child=orderOf(r.state,r.result.id)
  assert.ok(Math.abs(holdOf(r.state,a,m)-(plannedIssue(left,m)-issuedOf(r.state,a,m)))<1e-6,'left holds plan − issued')
  assert.ok(Math.abs(holdOf(r.state,child.id,m)-plannedIssue(child,m))<1e-6,'child holds its full plan')
  assert.ok(Math.abs(reservedOf(s,m)-reservedOf(r.state,m))<1e-6,'split moves the reservation, it does not grow it')
  assert.equal(holdOf(r.state,b,m),holdOf(s,b,m))
  assertReservationsBacked(r.state)
  const done=completeOrder(r.state,a)
  assert.equal(orderOf(done,a).status,'Yakunlangan')
  assertReservationsBacked(done)
})

test('BUG-02: merge releases the sources and reserves the merged order once',()=>{
  let s=fresh()
  const x=newConfirmedOrder(s,'p1',5);s=x.state
  const y=newConfirmedOrder(s,'p1',5);s=y.state
  const m=rawOf(s,orderOf(s,x.id))[0].materialId
  const r=A.mergeProduction(s,ctx(s),[x.id,y.id])
  assert.ok(r.result.ok,r.result.message)
  assert.ok(Math.abs(holdOf(r.state,r.result.id,m)-plannedIssue(orderOf(r.state,r.result.id),m))<1e-6)
  assert.ok(Math.abs(reservedOf(s,m)-reservedOf(r.state,m))<1e-6)
  assertReservationsBacked(r.state)
})

test('BUG-02: completion returns a remaining reservation to free stock',()=>{
  let {state:s,id}=startedOrder(fresh(),'p1',10)
  const m=rawOf(s,orderOf(s,id))[0].materialId,wh=holdWarehouse(s,id,m)
  // A consistent leftover the order still holds (rounding remainder or data saved by an older version).
  s={...s,productionOrders:s.productionOrders.map(o=>o.id===id?{...o,reservations:o.reservations.map(r=>r.materialId===m?{...r,qty:r.qty+0.5}:r)}:o),
    stockBalances:s.stockBalances.map(b=>b.warehouseId===wh&&b.itemId===m?{...b,reserved:b.reserved+0.5}:b)}
  assertReservationsBacked(s)
  // The 0.5 holds no lot (older data): Phase 3 reconciles it to a real lot before anything is issued.
  const pinned=A.allocateLegacyLots(s,ctx(s),'mo',id);assert.ok(pinned.result.ok,pinned.result.message);s=pinned.state
  const done=completeOrder(s,id)
  assert.ok(Math.abs(reservedOf(s,m)-reservedOf(done,m)-holdOf(s,id,m))<1e-6,'everything the order held, including the leftover, is released')
  assertReservationsBacked(done)
})

test('BUG-02: an order saved before per-order records releases its derived reservation on cancel',()=>{
  let {s,a,b,m}=twoOrders()
  s=scanUnits(s,a,m,4)
  s={...s,productionOrders:s.productionOrders.map(o=>{if(o.id!==a)return o;const {reservations,...rest}=o;return rest})}
  assertReservationsBacked(s)
  const r=A.transitionProduction(s,ctx(s),a,'Bekor qilingan')
  assert.ok(r.result.ok,r.result.message)
  assertReleasedExactly(s,r.state,a,b,m)
})

/* --- BUG-03: stock is refused, never silently clamped ----------------------------------------- */

/** Every balance is non-negative and, while the movement log is complete, equals the sum of its movements. */
function assertStockIntegrity(s){
  assert.ok(s.stockMovements.length<600,'the ledger check needs the full movement log (BUG-07 caps it at 600)')
  for(const b of s.stockBalances){
    for(const f of ['onHand','reserved','incoming','quarantine'])assert.ok((b[f]||0)>=0,`${b.itemId}@${b.warehouseId} ${f} = ${b[f]}`)
    const moved=s.stockMovements.filter(m=>m.warehouseId===b.warehouseId&&m.itemId===b.itemId).reduce((a,m)=>a+m.qty,0)
    assert.ok(Math.abs(moved-b.onHand)<1e-3,`${b.itemId}@${b.warehouseId}: onHand ${b.onHand}, movements ${moved}`)
  }
}
const w1=(s,itemId)=>s.stockBalances.find(b=>b.warehouseId==='w1'&&b.itemId===itemId)
/** Cancels the open orders holding `materialId`, so a stock count is not limited by their reservations. */
function freeOf(s,materialId){
  for(const o of s.productionOrders.filter(o=>isOpenOrder(o)&&orderReservations(s,o).some(r=>r.materialId===materialId))){
    // An order with output waiting in Final QC cannot be cancelled (B3-07); short close releases its reservation instead.
    const r=o.completed>0?A.shortCloseProduction(s,ctx(s),o.id,'test'):A.transitionProduction(s,ctx(s),o.id,'Bekor qilingan');assert.ok(r.result.ok,r.result.message);s=r.state
  }
  return s
}
/** Passes the seed's pending incoming checks so the only quarantine left is the one a test creates. */
function passPendingIncoming(s){
  for(const q of s.qualityChecks.filter(q=>q.sourceType==='purchase'&&q.status==='Pending')){const r=A.resolveQuality(s,ctx(s,'em4'),q.id,'Passed');assert.ok(r.result.ok,r.result.message);s=r.state}
  return s
}
/** A confirmed PO of rm1 into w1, received into incoming QC quarantine. */
function quarantinedReceipt(s,qty=5){
  const created=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty,price:22500}],status:'Tasdiqlangan'})
  assert.ok(created.result.ok,created.result.message);s=created.state
  const received=A.receivePurchase(s,ctx(s),created.result.id,'rm1',qty,'TEST-B03-LOT')
  assert.ok(received.result.ok,received.result.message);s=received.state
  const check=s.qualityChecks.find(q=>q.sourceId===created.result.id&&q.status==='Pending')
  assert.ok(check,'incoming QC is generated')
  return {s,check}
}

test('BUG-03: incoming QC scrap of stock that is no longer on hand is refused, not clamped to zero',()=>{
  let {s,check}=quarantinedReceipt(freeOf(fresh(),'rm1'))
  // Since BUG-10 a count cannot take stock below its quarantine, so the shelf-empty state comes from older data.
  assert.equal(A.adjustStock(s,ctx(s),'rm1','w1',-w1(s,'rm1').onHand,'cycle count: shelf empty').result.ok,false)
  s={...s,stockBalances:s.stockBalances.map(b=>b.warehouseId==='w1'&&b.itemId==='rm1'?{...b,onHand:0}:b)}
  const r=A.resolveQuality(s,ctx(s,'em4'),check.id,'Scrap','defect')
  assert.equal(r.result.ok,false)
  assert.match(r.result.message,/scrap qilib bo‘lmaydi/)
  assert.equal(r.state,s,'nothing changes: no balance, movement or QC status')
})

test('BUG-03: a second decision on an already released receipt cannot clamp quarantine',()=>{
  let {s,check}=quarantinedReceipt(passPendingIncoming(fresh()))
  const passed=A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed');assert.ok(passed.result.ok,passed.result.message);s=passed.state
  // Since BUG-05b a decided check is refused outright, before any stock is looked at.
  const again=A.resolveQuality(s,ctx(s,'em4'),check.id,'Scrap','second decision')
  assert.equal(again.result.ok,false)
  assert.match(again.result.message,/allaqachon hal qilingan/)
  assert.equal(again.state,s)
})

test('BUG-03: supplier return of more than is on hand is refused, not clamped to zero',()=>{
  let {s,check}=quarantinedReceipt(passPendingIncoming(freeOf(fresh(),'rm1')))
  // Older data: only 2 left on the shelf although 5 are still booked in quarantine (a count can no longer do this, BUG-10).
  s={...s,stockBalances:s.stockBalances.map(b=>b.warehouseId==='w1'&&b.itemId==='rm1'?{...b,onHand:2}:b)}
  const failed=A.resolveQuality(s,ctx(s,'em4'),check.id,'Failed','defect');assert.ok(failed.result.ok,failed.result.message);s=failed.state
  const r=A.returnPurchaseToSupplier(s,ctx(s),check.id)
  assert.equal(r.result.ok,false)
  assert.match(r.result.message,/qaytarib bo‘lmaydi/)
  assert.equal(r.state,s)
})

test('BUG-03: delivering a reservation the warehouse no longer holds is refused as a whole',()=>{
  const created=A.createSalesOrder(fresh(),ctx(fresh()),{customerId:'cu1',productId:'p1',qty:50,mode:'Make-to-stock'})
  assert.ok(created.result.ok,created.result.message)
  const so=created.state.salesOrders.find(o=>o.id===created.result.id)
  const wh=so.items[0].reservations[0].warehouseId
  // Data saved by an older version: the reserving warehouse holds less than the reservation.
  const s={...created.state,stockBalances:created.state.stockBalances.map(b=>b.warehouseId===wh&&b.itemId==='p1'?{...b,onHand:10,reserved:Math.min(b.reserved,10),quarantine:0}:b)}
  const r=A.deliverSalesOrder(s,ctx(s),so.id)
  assert.equal(r.result.ok,false)
  assert.match(r.result.message,/rezerv omborida/)
  assert.equal(r.state,s)
})

test('BUG-03: releasing commitments that older data no longer carries still works and never goes negative',()=>{
  let s=fresh()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:5,price:22500}],status:'Tasdiqlangan'})
  assert.ok(po.result.ok,po.result.message);s=po.state
  s={...s,stockBalances:s.stockBalances.map(b=>b.warehouseId==='w1'&&b.itemId==='rm1'?{...b,incoming:2}:b)}
  const cancelled=A.cancelPurchase(s,ctx(s),po.result.id)
  assert.ok(cancelled.result.ok,cancelled.result.message)
  assert.equal(w1(cancelled.state,'rm1').incoming,0)
  const so=A.createSalesOrder(fresh(),ctx(fresh()),{customerId:'cu1',productId:'p1',qty:30,mode:'Make-to-stock'})
  const wh=so.state.salesOrders.find(o=>o.id===so.result.id).items[0].reservations[0].warehouseId
  const t={...so.state,stockBalances:so.state.stockBalances.map(b=>b.warehouseId===wh&&b.itemId==='p1'?{...b,reserved:10}:b)}
  const soCancelled=A.cancelSalesOrder(t,ctx(t),so.result.id)
  assert.ok(soCancelled.result.ok,soCancelled.result.message)
  assert.equal(soCancelled.state.stockBalances.find(b=>b.warehouseId===wh&&b.itemId==='p1').reserved,0)
})

test('BUG-03: balances stay non-negative and equal to their movements through a full material flow',()=>{
  let s=fresh()
  assertStockIntegrity(s)
  let r=quarantinedReceipt(s);s=r.s;assertStockIntegrity(s)
  const passed=A.resolveQuality(s,ctx(s,'em4'),r.check.id,'Passed');assert.ok(passed.result.ok,passed.result.message);s=passed.state;assertStockIntegrity(s)
  const mo=startedOrder(s,'p1',10);s=mo.state
  const comp=rawOf(s,orderOf(s,mo.id))[0]
  s=scanUnits(s,mo.id,comp.materialId,2);assertStockIntegrity(s)
  const out=A.reportOutput(s,ctx(s),mo.id,10,0);assert.ok(out.result.ok,out.result.message);s=out.state;assertStockIntegrity(s)
  const moved=A.transferStock(s,ctx(s),'p1','w3','w4',100);assert.ok(moved.result.ok,moved.result.message);s=moved.state;assertStockIntegrity(s)
  const counted=A.adjustStock(s,ctx(s),'rm1','w1',3,'cycle count');assert.ok(counted.result.ok,counted.result.message);s=counted.state;assertStockIntegrity(s)
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p1',qty:20,mode:'Make-to-stock'});assert.ok(so.result.ok,so.result.message);s=so.state
  const delivered=A.deliverSalesOrder(s,ctx(s),so.result.id);assert.ok(delivered.result.ok,delivered.result.message);s=delivered.state;assertStockIntegrity(s)
})

test('BUG-03: the engine refuses with a StockError the app can show',()=>{
  const e=new A.StockError('x')
  assert.ok(e instanceof Error)
  assert.equal(e.name,'StockError')
})

/* --- BUG-05: Final QC releases only the inspected order's own quarantine ----------------------- */

const withPolicy=(s,requireFinalQc)=>({...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc,autoQualityChecks:true}}})
/** Final QC quarantine of the order's product in the order's warehouse. */
const fgQuarantine=(s,id)=>{const o=orderOf(s,id);return balanceOf(s,o.warehouseId,o.productId)?.quarantine||0}
const pendingFinal=(s,id)=>s.qualityChecks.find(q=>q.sourceId===id&&q.type==='Final'&&q.status==='Pending')
/** Runs operations, reports `good` output and sends the order to Final QC. */
function toFinalQc(s,id,good=remainingQty(orderOf(s,id))){
  s=finishOperations(s,id)
  const out=A.reportOutput(s,ctx(s),id,good,0);assert.ok(out.result.ok,out.result.message);s=out.state
  const qc=A.transitionProduction(s,ctx(s),id,'Sifat nazoratida');assert.ok(qc.result.ok,qc.result.message)
  return qc.state
}
function finalPass(s,id,checkId=pendingFinal(s,id)?.id){
  assert.ok(checkId,'a pending Final check exists')
  const r=A.resolveQuality(s,ctx(s,'em4'),checkId,'Passed');assert.ok(r.result.ok,r.result.message)
  return r.state
}
/** A further Final check on the order, as Sifat → "Tekshiruv yaratish" allows. */
function extraFinalPass(s,id){
  const c=A.createQualityCheck(s,ctx(s,'em4'),{type:'Final',sourceType:'production',sourceId:id,itemId:orderOf(s,id).productId})
  assert.ok(c.result.ok,c.result.message)
  return finalPass(c.state,id,c.result.id)
}
/** Two p1 orders of 10 in the same warehouse, both produced under Final QC and waiting for inspection. */
function twoInFinalQc(s=fresh()){
  const a=startedOrder(s,'p1',10);s=a.state
  const b=startedOrder(s,'p1',10);s=b.state
  assert.equal(orderOf(s,a.id).warehouseId,orderOf(s,b.id).warehouseId,'fixture needs one shared finished-goods balance')
  s=toFinalQc(s,a.id);s=toFinalQc(s,b.id)
  return {s,a:a.id,b:b.id}
}
/** Data saved before per-order QC holds: no order carries `qcHeld`. */
const stripQcHolds=s=>({...s,productionOrders:s.productionOrders.map(o=>{const {qcHeld,...rest}=o;return rest})})
/** Every unit of finished-goods quarantine belongs to exactly one order's stored Final QC hold. */
function assertQcHoldsBacked(s){
  for(const b of s.stockBalances.filter(b=>s.products.some(p=>p.id===b.itemId))){
    // Customer returns waiting for inspection hold their received units in quarantine too (P1-26).
    const returns=s.returns.filter(r=>r.status==='Inspection'&&r.warehouseId===b.warehouseId&&r.productId===b.itemId).reduce((a,r)=>a+r.qty,0)
    const held=s.productionOrders.filter(o=>o.warehouseId===b.warehouseId&&o.productId===b.itemId).reduce((a,o)=>a+(o.qcHeld||0),0)+returns
    assert.equal(held,b.quarantine||0,`${b.itemId}@${b.warehouseId}: quarantine ${b.quarantine||0}, order and return holds ${held}`)
  }
}

test('BUG-05: a plain Final pass releases exactly the order’s own output',()=>{
  let {s,a,b}=twoInFinalQc()
  assert.equal(orderOf(s,a).qcHeld,10)
  assert.equal(orderOf(s,b).qcHeld,10)
  assertQcHoldsBacked(s)
  const before=fgQuarantine(s,a)
  s=finalPass(s,a)
  assert.equal(before-fgQuarantine(s,a),10)
  assert.equal(orderOf(s,a).qcHeld,0)
  assert.equal(orderOf(s,b).qcHeld,10,'the other order keeps its hold')
  assertQcHoldsBacked(s)
})

test('BUG-05: a second Final check on an already passed order releases nothing of another order',()=>{
  let {s,a,b}=twoInFinalQc()
  s=finalPass(s,a)
  for(const q of s.qualityChecks.filter(q=>q.sourceId===a&&q.status==='Pending')){const p=A.resolveQuality(s,ctx(s,'em4'),q.id,'Passed');assert.ok(p.result.ok,p.result.message);s=p.state}
  const done=A.transitionProduction(s,ctx(s),a,'Yakunlangan');assert.ok(done.result.ok,done.result.message);s=done.state
  const before=fgQuarantine(s,a)
  // Since N-01 a Final check on a closed order is refused outright; nothing of B can be released through A.
  const extra=A.createQualityCheck(s,ctx(s,'em4'),{type:'Final',sourceType:'production',sourceId:a,itemId:orderOf(s,a).productId})
  assert.equal(extra.result.ok,false)
  assert.equal(fgQuarantine(s,a),before,'B’s uninspected units stay in quarantine')
  assert.equal(orderOf(s,b).qcHeld,10)
  assertQcHoldsBacked(s)
  s=finalPass(s,b)
  assert.equal(before-fgQuarantine(s,b),10,'B’s own pass still releases its 10')
})

test('BUG-05: a rework pass releases only the reworked units of its source order',()=>{
  let {s,a,b}=twoInFinalQc()
  const start=fgQuarantine(s,a)
  const failed=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,a).id,'Failed','size off');assert.ok(failed.result.ok);s=failed.state
  const rw=A.createReworkOrder(s,ctx(s),a,4,'size off');assert.ok(rw.result.ok,rw.result.message);s=rw.state
  const r=rw.result.id
  for(const status of ['Tasdiqlangan','Jarayonda']){const t=A.transitionProduction(s,ctx(s),r,status);assert.ok(t.result.ok,t.result.message);s=t.state}
  s=toFinalQc(s,r)
  assert.equal(orderOf(s,r).qcHeld,4,'the rework takes over the units it reworked')
  assert.equal(orderOf(s,a).qcHeld,6)
  assertQcHoldsBacked(s)
  s=finalPass(s,r)
  assert.equal(start-fgQuarantine(s,a),4,'rework pass releases its 4 units')
  s=extraFinalPass(s,r)
  assert.equal(start-fgQuarantine(s,a),4,'a second rework pass releases nothing more')
  s=extraFinalPass(s,a)
  assert.equal(start-fgQuarantine(s,a),10,'re-inspecting A releases A’s remaining 6, not B’s units')
  assert.equal(orderOf(s,b).qcHeld,10)
  assertQcHoldsBacked(s)
})

test('P3-P0-01: scrapped rework units leave finished stock and their source lot',()=>{
  let {s,a}=twoInFinalQc()
  s=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,a).id,'Failed','defect').state
  const rw=A.createReworkOrder(s,ctx(s),a,4,'defect');assert.ok(rw.result.ok,rw.result.message);s=rw.state
  const id=rw.result.id
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),id,status).state
  const before=balanceOf(s,orderOf(s,id).warehouseId,'p1')
  const sourceLot=s.lots.find(l=>l.sourceId===a&&l.status==='quarantine'&&l.qty>=4)
  assert.ok(sourceLot)
  const out=A.reportOutput(s,ctx(s),id,2,2,'rework scrap');assert.ok(out.result.ok,out.result.message);s=out.state
  const after=balanceOf(s,orderOf(s,id).warehouseId,'p1')
  assert.equal(after.onHand,before.onHand-2)
  assert.equal(after.quarantine,before.quarantine-2)
  assert.equal(s.lots.filter(l=>l.id===sourceLot.id).reduce((n,l)=>n+l.qty,0),sourceLot.qty-4)
  const reworked=s.lots.find(l=>l.reworkOrderId===id&&l.qty===2)
  assert.equal(reworked.sourceLotCode,sourceLot.code)
  assert.notEqual(reworked.code,sourceLot.code)
  assert.equal(findTraceOrder(s,reworked.code).id,id)
  assert.ok(buildTraceability(s,id).outputLots.some(l=>l.id===reworked.id))
  assert.ok(buildTraceability(s,id).upstreamLots.some(l=>l.id===sourceLot.id))
  assertQcHoldsBacked(s)
})

test('P3-P0-02: Final Scrap of reworked output removes only its own LOT portion',()=>{
  let {s,a,b}=twoInFinalQc()
  s=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,a).id,'Failed','defect').state
  const rw=A.createReworkOrder(s,ctx(s),a,4,'defect');assert.ok(rw.result.ok,rw.result.message);s=rw.state
  const id=rw.result.id
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),id,status).state
  s=toFinalQc(s,id)
  const before=balanceOf(s,orderOf(s,id).warehouseId,'p1')
  const result=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,id).id,'Scrap','rework failed');assert.ok(result.result.ok,result.result.message);s=result.state
  const after=balanceOf(s,orderOf(s,id).warehouseId,'p1')
  assert.equal(after.onHand,before.onHand-4)
  assert.equal(after.quarantine,before.quarantine-4)
  assert.equal(s.lots.filter(l=>l.reworkOrderId===id).reduce((n,l)=>n+l.qty,0),0)
  assert.equal(orderOf(s,a).qcHeld,6)
  assert.equal(orderOf(s,b).qcHeld,10)
  assertQcHoldsBacked(s)
  s=extraFinalPass(s,a)
  assert.equal(orderOf(s,b).qcHeld,10)
  assertQcHoldsBacked(s)
})

test('P3-P0-03: an all-scrap order closes without an impossible Final check',()=>{
  let {state:s,id}=startedOrder(fresh(),'p1',4)
  s=finishOperations(s,id)
  const out=A.reportOutput(s,ctx(s),id,0,4,'all defective');assert.ok(out.result.ok,out.result.message);s=out.state
  const qc=A.transitionProduction(s,ctx(s),id,'Sifat nazoratida');assert.ok(qc.result.ok,qc.result.message);s=qc.state
  assert.equal(pendingFinal(s,id),undefined)
  for(const check of s.qualityChecks.filter(q=>q.sourceId===id&&q.status==='Pending')){
    const passed=A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed');assert.ok(passed.result.ok,passed.result.message);s=passed.state
  }
  const closed=A.transitionProduction(s,ctx(s),id,'Yakunlangan');assert.ok(closed.result.ok,closed.result.message)
  assert.equal(orderOf(closed.state,id).status,'Yakunlangan')
})

test('P3-P0-04: customer-return rework scrap leaves quarantine and the returned LOT',()=>{
  let {s}=twoInFinalQc()
  const ret=s.returns.find(r=>r.status==='Inspection')
  const decided=A.dispositionReturn(s,ctx(s,'em4'),ret.id,'Rework');assert.ok(decided.result.ok,decided.result.message);s=decided.state
  const id=s.returns.find(r=>r.id===ret.id).reworkOrderId
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),id,status).state
  s=finishOperations(s,id)
  const before=balanceOf(s,orderOf(s,id).warehouseId,ret.productId)
  const out=A.reportOutput(s,ctx(s),id,ret.qty-2,2,'returned units defective');assert.ok(out.result.ok,out.result.message);s=out.state
  const after=balanceOf(s,orderOf(s,id).warehouseId,ret.productId)
  assert.equal(after.onHand,before.onHand-2)
  assert.equal(after.quarantine,before.quarantine-2)
  assert.equal(s.lots.filter(l=>l.sourceType==='return'&&l.sourceId===ret.id).reduce((n,l)=>n+l.qty,0),ret.qty-2)
  assert.equal(orderOf(s,id).qcHeld,ret.qty-2)
  assertQcHoldsBacked(s)
})

test('P3-P0-05: serial rework scrap removes one serial and keeps the good serial trace',()=>{
  let {state:s,id:a}=startedOrder(fresh(),'p2',2)
  s=toFinalQc(s,a)
  const failed=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,a).id,'Failed','serial defect');assert.ok(failed.result.ok);s=failed.state
  const rw=A.createReworkOrder(s,ctx(s),a,2,'serial defect');assert.ok(rw.result.ok,rw.result.message);s=rw.state
  const id=rw.result.id
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),id,status).state
  const before=balanceOf(s,orderOf(s,id).warehouseId,'p2')
  const out=A.reportOutput(s,ctx(s),id,1,1,'serial scrap');assert.ok(out.result.ok,out.result.message);s=out.state
  const after=balanceOf(s,orderOf(s,id).warehouseId,'p2')
  assert.equal(after.onHand,before.onHand-1)
  assert.equal(s.lots.filter(l=>l.reworkOrderId===id&&l.kind==='serial'&&l.qty===1).length,1)
  assert.equal(s.lots.filter(l=>l.sourceId===a&&l.kind==='serial'&&l.qty===0).length,1)
  assert.ok(s.stockMovements.some(m=>m.source===orderOf(s,id).code&&m.type==='QC Scrap -'&&m.lot?.startsWith('SN-')))
  assertQcHoldsBacked(s)
})

test('P3-P0-06: rework cannot take a released source LOT pinned by a sales order',()=>{
  let {s,a}=twoInFinalQc()
  s=finalPass(s,a)
  const source=orderOf(s,a),lot=s.lots.find(l=>l.sourceId===a&&l.qty>=10)
  assert.ok(lot)
  s={...s,stockBalances:s.stockBalances.map(b=>b.warehouseId===source.warehouseId&&b.itemId==='p1'?{...b,reserved:b.reserved+10}:b),
    salesOrders:[{id:'so-pinned',code:'SO-PINNED',customerId:'cu1',status:'Tasdiqlangan',mode:'Make-to-stock',items:[{productId:'p1',qty:10,price:1,delivered:0,reserved:10,warehouseId:source.warehouseId,reservations:[{warehouseId:source.warehouseId,qty:10,lots:[{lot:lot.code,qty:10}]}]}],total:10,paymentStatus:'',deliveryDate:'2026-11-10',createdAt:'2026-11-01'},...s.salesOrders]}
  const rw=A.createReworkOrder(s,ctx(s),a,4,'new defect');assert.ok(rw.result.ok,rw.result.message);s=rw.state
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),rw.result.id,status).state
  const out=A.reportOutput(s,ctx(s),rw.result.id,4,0)
  assert.equal(out.result.ok,false)
  assert.match(out.result.message,/LOT/)
  assert.equal(out.state,s,'a refused rework must not mutate stock or sales reservations')
})

test('P3-P0-07: ambiguous legacy rework LOT ownership fails closed at Final release',()=>{
  let {s,a}=twoInFinalQc()
  s=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,a).id,'Failed','defect').state
  const rw=A.createReworkOrder(s,ctx(s),a,4,'defect');assert.ok(rw.result.ok);s=rw.state
  const id=rw.result.id
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),id,status).state
  s=toFinalQc(s,id)
  s={...s,lots:s.lots.map(l=>{if(l.reworkOrderId!==id)return l;const {reworkOrderId,...old}=l;return old})}
  const out=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,id).id,'Passed')
  assert.equal(out.result.ok,false)
  assert.match(out.result.message,/LOT\/serial egaligi/)
  assert.equal(out.state,s)
})

test('BUG-05: a customer-return rework releases the returned units, not its source order’s hold',()=>{
  let {s}=twoInFinalQc()
  const ret=s.returns.find(r=>r.status==='Inspection')
  assert.ok(ret,'seed has a return waiting for inspection')
  const disposed=A.dispositionReturn(s,ctx(s,'em4'),ret.id,'Rework');assert.ok(disposed.result.ok,disposed.result.message);s=disposed.state
  const r=s.returns.find(x=>x.id===ret.id).reworkOrderId
  assert.equal(orderOf(s,r).qcHeld,ret.qty,'the returned units wait in quarantine for the rework order')
  assertQcHoldsBacked(s)
  for(const status of ['Tasdiqlangan','Jarayonda']){const t=A.transitionProduction(s,ctx(s),r,status);assert.ok(t.result.ok,t.result.message);s=t.state}
  s=toFinalQc(s,r)
  const others=s.productionOrders.filter(o=>o.id!==r).map(o=>[o.id,o.qcHeld])
  const before=fgQuarantine(s,r)
  s=finalPass(s,r)
  assert.equal(before-fgQuarantine(s,r),ret.qty)
  assert.deepEqual(s.productionOrders.filter(o=>o.id!==r).map(o=>[o.id,o.qcHeld]),others,'no other order’s hold moved')
  assertQcHoldsBacked(s)
})

test('BUG-05: output made while Final QC was off is not released out of another order’s quarantine',()=>{
  let s=withPolicy(fresh(),false)
  const a=startedOrder(s,'p1',10);s=toFinalQc(a.state,a.id)
  assert.equal(orderOf(s,a.id).qcHeld,0,'nothing was quarantined for A')
  s=withPolicy(s,true)
  const b=startedOrder(s,'p1',10);s=toFinalQc(b.state,b.id)
  const before=fgQuarantine(s,a.id)
  s=finalPass(s,a.id)
  assert.equal(fgQuarantine(s,a.id),before,'B’s 10 stay quarantined')
  assert.equal(orderOf(s,b.id).qcHeld,10)
  assertQcHoldsBacked(s)
})

test('BUG-05: backorder and split children start with an empty QC hold, the parent keeps its own',()=>{
  // Backorder: the parent reported 4 into quarantine, the child must not inherit them.
  let {state:s,id:a}=startedOrder(fresh(),'p1',10)
  s=finishOperations(s,a)
  const out=A.reportOutput(s,ctx(s),a,4,0);assert.ok(out.result.ok,out.result.message);s=out.state
  const back=A.createBackorder(s,ctx(s),a);assert.ok(back.result.ok,back.result.message);s=back.state
  const bo=back.result.id
  assert.equal(orderOf(s,a).qcHeld,4)
  assert.equal(orderOf(s,bo).qcHeld,0)
  assertQcHoldsBacked(s)
  let before=fgQuarantine(s,a)
  // Since N-01 a Final check on an order without output is refused, so it cannot release anything.
  assert.equal(A.createQualityCheck(s,ctx(s,'em4'),{type:'Final',sourceType:'production',sourceId:bo,itemId:orderOf(s,bo).productId}).result.ok,false)
  assert.equal(fgQuarantine(s,a),before,'an early Final pass on the backorder releases nothing')
  s=finalPass(s,a)
  assert.equal(before-fgQuarantine(s,a),4,'the parent releases its own 4')
  // Split: the parent reported 3 into quarantine, the child must not inherit them.
  const sp=startedOrder(fresh(),'p1',10);let t=sp.state
  const o3=A.reportOutput(t,ctx(t),sp.id,3,0);assert.ok(o3.result.ok,o3.result.message);t=o3.state
  const split=A.splitProduction(t,ctx(t),sp.id,4);assert.ok(split.result.ok,split.result.message);t=split.state
  assert.equal(orderOf(t,sp.id).qcHeld,3)
  assert.equal(orderOf(t,split.result.id).qcHeld,0)
  assertQcHoldsBacked(t)
  before=fgQuarantine(t,sp.id)
  assert.equal(A.createQualityCheck(t,ctx(t,'em4'),{type:'Final',sourceType:'production',sourceId:split.result.id,itemId:orderOf(t,sp.id).productId}).result.ok,false,'no Final check on a child without output')
  assert.equal(fgQuarantine(t,sp.id),before,'a Final pass on the split child releases nothing')
  t=extraFinalPass(t,sp.id)
  assert.equal(before-fgQuarantine(t,sp.id),3,'the parent releases its own 3')
})

test('BUG-05: orders saved before per-order QC holds derive them and stay isolated',()=>{
  let {s,a,b}=twoInFinalQc()
  s=stripQcHolds(s)
  const start=fgQuarantine(s,a)
  s=finalPass(s,a)
  assert.equal(start-fgQuarantine(s,a),10,'derived hold = the order’s quarantined output')
  s=extraFinalPass(s,a)
  assert.equal(start-fgQuarantine(s,a),10,'a second pass on the legacy order releases nothing more')
  s=finalPass(s,b)
  assert.equal(start-fgQuarantine(s,b),20)
  // Legacy output made while the policy was off derives an empty hold.
  let t=withPolicy(fresh(),false)
  const x=startedOrder(t,'p1',10);t=toFinalQc(x.state,x.id)
  t=withPolicy(t,true)
  const y=startedOrder(t,'p1',10);t=stripQcHolds(toFinalQc(y.state,y.id))
  const held=fgQuarantine(t,y.id)
  t=finalPass(t,x.id)
  assert.equal(fgQuarantine(t,y.id),held,'legacy policy-off output releases nothing')
})

test('BUG-05: a legacy rework in progress releases only its own units, the source the rest',()=>{
  let {s,a,b}=twoInFinalQc()
  const start=fgQuarantine(s,a)
  s=A.resolveQuality(s,ctx(s,'em4'),pendingFinal(s,a).id,'Failed','size off').state
  const rw=A.createReworkOrder(s,ctx(s),a,4,'size off');assert.ok(rw.result.ok,rw.result.message);s=rw.state
  const r=rw.result.id
  for(const status of ['Tasdiqlangan','Jarayonda'])s=A.transitionProduction(s,ctx(s),r,status).state
  s=stripQcHolds(toFinalQc(s,r))
  s=finalPass(s,r)
  assert.equal(start-fgQuarantine(s,a),4)
  s=extraFinalPass(s,a)
  assert.equal(start-fgQuarantine(s,a),10,'the source releases its other 6 only')
  s=finalPass(s,b)
  assert.equal(start-fgQuarantine(s,b),20)
})

test('BUG-05: seed history holds every unit of finished-goods quarantine on exactly one order',()=>{
  const s=fresh()
  assertQcHoldsBacked(s)
  // The same seed saved before this change releases the same amounts per order.
  const legacy=stripQcHolds(s)
  for(const o of s.productionOrders.filter(o=>pendingFinal(s,o.id))){
    const now=fgQuarantine(s,o.id)-fgQuarantine(finalPass(s,o.id),o.id)
    const old=fgQuarantine(legacy,o.id)-fgQuarantine(finalPass(legacy,o.id),o.id)
    assert.equal(old,now,`${o.code}: legacy release ${old}, stored release ${now}`)
    assert.equal(now,orderOf(s,o.id).qcHeld)
  }
})
