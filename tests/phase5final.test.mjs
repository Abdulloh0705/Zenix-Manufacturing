// Phase 5/5 (2026-10-29) final integrity regressions: serial-number traceability (#25), supplier replacement and real
// notifications (#27), the Phase 4 gaps — legacy return credits, timezone history, per-machine capacity — and one
// integrated Sales → MRP → Purchase → Production → Delivery → Payment → Return workflow. A refused command returns the
// very state it was given (no partial mutation).
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as P from '../.test-dist/planning.mjs'
import * as X from '../.test-dist/access.mjs'
import * as I from '../.test-dist/inventory.mjs'
import * as R from '../.test-dist/receivables.mjs'
import * as D from '../.test-dist/dates.mjs'
import * as SN from '../.test-dist/serials.mjs'
import * as N from '../.test-dist/notifications.mjs'
import * as SM from '../.test-dist/supplierMaterials.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const RUNTIME_ZONE=D.timeZone()
afterEach(()=>{D.setTimeZone(RUNTIME_ZONE);D.setZoneHistory(undefined)})

const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p5f${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given (no partial mutation)')
  return out
}
const policies=(s,p)=>({...s,settings:{...s.settings,policies:{...s.settings.policies,...p}}})
const clean=(p={requireFinalQc:false,autoQualityChecks:false})=>policies(createInitialState(T0),p)
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-6,`${msg||''} ${a} ≠ ${b}`)

function withStock(s,key,warehouseId,lots){
  const product=s.products.find(p=>p.id===key)
  const itemType=product?'finished':'raw'
  const unit=(product||s.rawMaterials.find(m=>m.id===key)).unit
  const rows=lots.map((l,i)=>({id:`lot-${key}-${warehouseId}-${l.code}`,code:l.code,kind:'lot',itemId:key,itemType,qty:l.qty,originalQty:l.qty,warehouseId,status:'available',
    sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:`2026-10-0${i+1} 08:00`,consumedBy:[]}))
  const old=bal(s,key,warehouseId)
  return {...s,lots:[...s.lots,...rows],stockBalances:[...s.stockBalances.filter(b=>b!==old),
    {id:`st-${key}-${warehouseId}`,warehouseId,itemId:key,itemType,onHand:(old?.onHand||0)+rows.reduce((a,l)=>a+l.qty,0),reserved:old?.reserved||0,incoming:0,quarantine:0,unit}]}
}
/** Components of p2 (rm2 kg, rm4 dona, p3 dona) in their stores, as lots. */
const p2Parts=s=>withStock(withStock(withStock(s,'rm2','w1',[{code:'ST-1',qty:200}]),'rm4','w1',[{code:'HW-1',qty:500}]),'p3','w3',[{code:'P3-1',qty:200}])

/** Runs a p2 order of `qty` through confirm → start → output: `qty` serial units in w3. */
function makeSerials(s,qty){
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p2',quantity:qty,start:TODAY,due:'2026-10-30'});s=ok(mo,'mo: ')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'),'confirm: ')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Jarayonda'),'start: ')
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,qty),'output: ')
  return {s,mo:s.productionOrders.find(o=>o.id===mo.result.id)}
}
const units=(s,wh)=>SN.serialUnitsInStock(s,'p2').filter(l=>!wh||l.warehouseId===wh).map(l=>l.code).sort()
function sell(s,qty,customerId='cu1',price=200000){
  const so=A.createSalesOrder(s,ctx(s),{customerId,mode:'Make-to-stock',deliveryDate:'2026-10-25',lines:[{productId:'p2',qty,price}]});s=ok(so,'so: ')
  return {s,id:so.result.id,code:s.salesOrders.find(o=>o.id===so.result.id).code}
}

/* ================================================== Serial numbers #25 == */

test('Serial 1: production output registers one record per unit, continuing numbers, one ledger row each',()=>{
  let {s,mo}=makeSerials(p2Parts(clean()),3)
  assert.deepEqual(units(s),['SN-VK210-000001','SN-VK210-000002','SN-VK210-000003'])
  assert.ok(s.lots.filter(l=>l.kind==='serial').every(l=>l.qty===1&&l.serialFrom===l.code&&l.serialTo===l.code&&l.batch===mo.serialRange&&l.sourceId===mo.id))
  assert.equal(s.stockMovements.filter(m=>m.type==='Production +'&&m.itemId==='p2').length,3,'one row per serial')
  assert.equal(bal(s,'p2','w3').onHand,3)
  const st=SN.serialStatus(s,'SN-VK210-000002')
  assert.deepEqual([st.status,st.warehouseId,st.origin.sourceCode],['available','w3',mo.code])
  ;({s}=makeSerials(s,2))
  assert.deepEqual(units(s).slice(-2),['SN-VK210-000004','SN-VK210-000005'],'numbers never repeat')
  assert.deepEqual(SN.serialIssues(s).problems,[])
  // The trace search finds the producing order from any unit's number.
  assert.equal(E.findTraceOrder(s,'SN-VK210-000002').id,mo.id)
})

test('Serial 2: a duplicate or miscounted serial is refused at receipt and nothing changes',()=>{
  let s=clean()
  s={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm4'?{...m,serialTracking:true}:m)}
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su3',lines:[{materialId:'rm4',qty:10}],status:'Tasdiqlangan'});s=ok(po)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',3,undefined,undefined,{serials:'A1 A2'}),/3 ta serial kiriting \(2 ta/)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',2,undefined,undefined,{serials:'A1 A1'}),/ikki marta/)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',1.5,undefined,undefined,{serials:'A1'}),/butun|dona|kasr|son/i)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm4',2,undefined,undefined,{serials:['A1','A2']}))
  const receipt=s.purchaseOrders[0].receipts[0]
  assert.deepEqual(receipt.serials,['A1','A2'])
  assert.deepEqual(s.lots.filter(l=>l.itemId==='rm4').map(l=>[l.code,l.qty,l.batch===receipt.lot]).sort(),[['A1',1,true],['A2',1,true]])
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',1,undefined,undefined,{serials:'A2'}),/allaqachon omborda/)
  assert.equal(bal(s,'rm4','w1').onHand,2)
})

test('Serial 3: a sold serial cannot be sold again; QC-blocked units are not sellable',()=>{
  let {s}=makeSerials(p2Parts(clean({requireFinalQc:true,autoQualityChecks:false})),2)
  // Final QC holds the units: neither a delivery nor a transfer can take them.
  const blocked=sell(s,1);s=blocked.s
  refused(s,A.deliverSalesOrder(s,ctx(s),blocked.id),/yetarli|qoldiq|karantin/i)
  assert.ok(SN.serialUnitsInStock(s,'p2').every(l=>l.status==='quarantine'))
  const mo=s.productionOrders.find(o=>o.productId==='p2')
  const check=A.createQualityCheck(s,ctx(s),{type:'Final',sourceType:'production',sourceId:mo.id,itemId:'p2'});s=ok(check)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.result.id,'Passed'))
  assert.ok(SN.serialUnitsInStock(s,'p2').every(l=>l.status==='available'))
  s=ok(A.deliverSalesOrder(s,ctx(s),blocked.id))
  const sold=SN.serialStatus(s,'SN-VK210-000001')
  assert.deepEqual([sold.status,sold.record],['sold',undefined])
  assert.equal(sold.history.at(-1).source,blocked.code)
  const second=sell(s,2);s=second.s
  refused(s,A.deliverSalesOrder(s,ctx(s),second.id),/yetarli|qoldiq/i)
  assert.deepEqual(units(s),['SN-VK210-000002'],'only the unsold unit is left')
})

test('Serial 4: returns name the units; a unit not shipped or already returned is refused; returned units re-enter stock',()=>{
  let {s}=makeSerials(p2Parts(clean()),3)
  const so=sell(s,2);s=so.s
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id))
  const shipped=s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===so.code).map(m=>m.lot).sort()
  assert.deepEqual(shipped,['SN-VK210-000001','SN-VK210-000002'])
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:so.id,productId:'p2',qty:1,reason:'Nuqson'}),/serial raqamlarini kiriting/)
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:so.id,productId:'p2',qty:1,reason:'Nuqson',serials:'SN-VK210-000003'}),/yetkazilmagan/)
  const r=A.createReturn(s,ctx(s),{salesOrderId:so.id,productId:'p2',qty:1,reason:'Nuqson',serials:'SN-VK210-000002'});s=ok(r)
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:so.id,productId:'p2',qty:1,reason:'Yana',serials:'SN-VK210-000002'}),/allaqachon qaytarilgan/)
  let st=SN.serialStatus(s,'SN-VK210-000002')
  assert.deepEqual([st.status,st.warehouseId,st.record.sourceType],['quarantine','w3','return'])
  s=ok(A.dispositionReturn(s,ctx(s,'em4'),r.result.id,'Omborga qaytarildi'))
  st=SN.serialStatus(s,'SN-VK210-000002')
  assert.equal(st.status,'available')
  assert.equal(st.origin.sourceType,'production','the first record still tells where the unit was made')
  assert.deepEqual(st.history.map(m=>m.type),['Production +','Sale -','Return +'])
  assert.deepEqual(SN.serialIssues(s).problems,[])
})

test('Serial 5: a transfer moves the unit atomically and keeps its genealogy',()=>{
  let {s,mo}=makeSerials(p2Parts(clean()),2)
  refused(s,A.transferStock(s,ctx(s),'p2','w3','w4',1,[{lot:'SN-VK210-000009',qty:1}]),/SN-VK210-000009/)
  s=ok(A.transferStock(s,ctx(s),'p2','w3','w4',1,[{lot:'SN-VK210-000002',qty:1}]))
  const st=SN.serialStatus(s,'SN-VK210-000002')
  assert.deepEqual([st.status,st.warehouseId,st.records.length],['available','w4',2])
  assert.equal(st.record.sourceCode,mo.code,'the copy keeps the production origin')
  assert.equal(st.origin.qty,0,'the old record holds nothing')
  assert.deepEqual(SN.serialIssues(s).problems,[],'one place per unit')
  assert.deepEqual([bal(s,'p2','w3').onHand,bal(s,'p2','w4').onHand],[1,1])
})

test('Serial 6: serial material — inspector names rejected units; supplier return, consumption and re-registration',()=>{
  let s=p2Parts(clean())
  s={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm4'?{...m,serialTracking:true}:m),qualityControlPoints:s.qualityControlPoints.map(q=>q.id==='qcp1'?{...q,productId:'rm4',blocking:true}:q)}
  s={...s,lots:s.lots.filter(l=>l.itemId!=='rm4'),stockBalances:s.stockBalances.filter(b=>b.itemId!=='rm4')}
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su3',lines:[{materialId:'rm4',qty:12}],status:'Tasdiqlangan'});s=ok(po)
  const serials=Array.from({length:10},(_,i)=>`HW${i+1}`)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm4',10,undefined,undefined,{serials}))
  const q=s.qualityChecks.find(x=>x.sourceId===po.result.id)
  refused(s,A.inspectReceipt(s,ctx(s,'em4'),q.id,8,'Tirnalgan'),/serial raqamlarini tanlang/)
  refused(s,A.inspectReceipt(s,ctx(s,'em4'),q.id,8,'Tirnalgan','',['HW1','ZZ']),/ZZ/)
  s=ok(A.inspectReceipt(s,ctx(s,'em4'),q.id,8,'Tirnalgan','',['HW9','HW10']))
  assert.deepEqual(['HW9','HW10'].map(x=>SN.serialStatus(s,x).status),['hold','hold'])
  assert.equal(SN.serialStatus(s,'HW1').status,'available')
  s=ok(A.returnPurchaseToSupplier(s,ctx(s),q.id))
  assert.deepEqual(['HW9','HW10'].map(x=>SN.serialStatus(s,x).status),['supplier-returned','supplier-returned'])
  // p2 needs 8 units of rm4: exactly the 8 accepted serials are consumed, one ledger row each.
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p2',quantity:1,start:TODAY,due:'2026-10-30'});s=ok(mo)
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Jarayonda'))
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,1))
  assert.deepEqual(serials.slice(0,8).map(x=>SN.serialStatus(s,x).status),Array(8).fill('consumed'))
  assert.ok(s.productionOrders.find(o=>o.id===mo.result.id).consumed.filter(c=>c.materialId==='rm4').every(c=>c.qty===1&&serials.includes(c.lot)))
  // A consumed unit can never be received again; a unit back from the supplier can (repaired / replaced).
  const po2=A.createPurchaseOrder(s,ctx(s),{supplierId:'su3',lines:[{materialId:'rm4',qty:5}],status:'Tasdiqlangan'});s=ok(po2)
  refused(s,A.receivePurchase(s,ctx(s),po2.result.id,'rm4',1,undefined,undefined,{serials:'HW1'}),/chiqib ketgan \(consumed\)/)
  s=ok(A.receivePurchase(s,ctx(s),po2.result.id,'rm4',1,undefined,undefined,{serials:'HW9'}))
})

test('Serial 7: a legacy range record stays readable and is never split into invented units',()=>{
  let s=clean()
  const legacy={id:'lot-legacy',code:'SN-VK210-000001…000005',kind:'serial',itemId:'p2',itemType:'finished',qty:3,originalQty:5,warehouseId:'w3',status:'available',sourceType:'production',sourceId:'mo-old',sourceCode:'MO-OLD',createdAt:'2026-01-01 08:00',serialFrom:'SN-VK210-000001',serialTo:'SN-VK210-000005',consumedBy:[]}
  s={...s,lots:[legacy],stockBalances:[{id:'b-p2',warehouseId:'w3',itemId:'p2',itemType:'finished',onHand:3,reserved:0,incoming:0,quarantine:0,unit:'dona'}]}
  assert.equal(SN.serialStatus(s,'SN-VK210-000002'),undefined,'which units are left is unknown — nothing invented')
  assert.equal(SN.serialIssues(s).legacyRanges.length,1)
  assert.match(SN.serialConflict(s,'p2','SN-VK210-000004'),/eski serial oralig/)
  // Quantity-based work on the legacy record still runs.
  const so=sell(s,2);s=so.s
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id))
  assert.equal(s.lots.find(l=>l.id==='lot-legacy').qty,1)
  // New output continues after the legacy range instead of repeating its numbers.
  ;({s}=makeSerials(p2Parts(s),1))
  assert.deepEqual(units(s),['SN-VK210-000006'])
})

/* ============================================ Supplier replacement #27 == */

/** rm2 received 100 into incoming QC, 70 accepted / 30 rejected, the 30 shipped back. */
function returned(){
  let s=clean({requireFinalQc:false,autoQualityChecks:true})
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:100}],status:'Tasdiqlangan',expectedDate:'2026-10-30'});s=ok(po)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',100))
  const q=s.qualityChecks.find(x=>x.sourceId===po.result.id)
  s=ok(A.inspectReceipt(s,ctx(s,'em4'),q.id,70,'Zanglagan'))
  s=ok(A.returnPurchaseToSupplier(s,ctx(s),q.id))
  return {s,poId:po.result.id,qcId:q.id}
}
const avail=(s,key,wh)=>{const b=bal(s,key,wh);return b.onHand-b.reserved-(b.quarantine||0)}

test('Replacement 1: duplicate return does not deduct twice; partial requests track what is still owed',()=>{
  let {s,poId,qcId}=returned()
  assert.deepEqual([bal(s,'rm2','w1').onHand,avail(s,'rm2','w1')],[70,70])
  refused(s,A.returnPurchaseToSupplier(s,ctx(s),qcId),/allaqachon qaytarilgan/)
  const po=s.purchaseOrders.find(p=>p.id===poId),status=po.status
  const r1=A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:20,key:'k1'});s=ok(r1)
  const again=A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:20,key:'k1'})
  assert.equal(again.state,s,'the same submit opens nothing new');assert.equal(again.result.id,r1.result.id)
  refused(s,A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:11,key:'k2'}),/10 kg/)
  s=ok(A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:10,key:'k2'}))
  refused(s,A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:1,key:'k3'}),/miqdor yo‘q/)
  const rep=s.supplierReplacements.find(r=>r.id===r1.result.id)
  assert.deepEqual([rep.qty,rep.status,rep.purchaseOrderId,rep.supplierId],[20,'Kutilmoqda',poId,'su1'])
  assert.ok(rep.lots.length>0,'the returned lot is referenced')
  assert.equal(s.purchaseOrders.find(p=>p.id===poId).status,status,'the PO is not reopened')
  assert.equal(bal(s,'rm2','w1').onHand,70,'a request moves no stock')
})

test('Replacement 2: receipts are linked, quarantined, idempotent, capped; QC decides what becomes available',()=>{
  let {s,poId,qcId}=returned()
  const r=A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:20,key:'k1'});s=ok(r)
  const id=r.result.id
  const line=()=>s.purchaseOrders.find(p=>p.id===poId).items[0]
  const before=line().received
  const got=A.receiveSupplierReplacement(s,ctx(s),id,15,{key:'rk1'});s=ok(got)
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w1').quarantine,avail(s,'rm2','w1')],[85,15,70],'nothing available before QC')
  assert.equal(line().received,before,'replacement never counts toward the PO line')
  const receipt=s.purchaseOrders.find(p=>p.id===poId).receipts.find(x=>x.id===got.result.id)
  assert.equal(receipt.replacementId,id)
  assert.equal(s.lots.find(l=>l.code===receipt.lot).sourceId,poId)
  refused(s,A.receiveSupplierReplacement(s,ctx(s),id,5,{key:'rk1'}),/allaqachon qayd/)
  refused(s,A.receiveSupplierReplacement(s,ctx(s),id,6,{key:'rk2'}),/qolgan 5/)
  let view=SM.replacementView(s,s.supplierReplacements[0])
  assert.deepEqual([view.received,view.accepted,view.pending,view.outstanding,s.supplierReplacements[0].status],[15,0,15,5,'Qisman'])
  const check=s.qualityChecks.find(q=>q.receiptId===got.result.id)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed'))
  assert.equal(avail(s,'rm2','w1'),85)
  const last=A.receiveSupplierReplacement(s,ctx(s),id,5,{key:'rk2'});s=ok(last)
  assert.equal(s.supplierReplacements[0].status,'Yopildi')
  const check2=s.qualityChecks.find(q=>q.receiptId===last.result.id)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check2.id,'Failed','Yana zang'))
  assert.equal(avail(s,'rm2','w1'),85,'a rejected replacement stays blocked')
  view=SM.replacementView(s,s.supplierReplacements[0])
  assert.deepEqual([view.received,view.accepted,view.rejected,view.outstanding],[20,15,5,0])
  refused(s,A.receiveSupplierReplacement(s,ctx(s),id,1,{key:'rk3'}),/yopilgan/)
  // KPI: on time and lead time measure the original delivery only; fulfilment counts accepted replacement units.
  const kpi=SM.supplierPerformance(s,'su1','2026-10-21')
  assert.equal(kpi.receipts,3)
})

test('Replacement 3: rights and closing what the supplier will not send',()=>{
  let {s,qcId}=returned()
  const r=A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:30,key:'k1'});s=ok(r)
  assert.equal(X.commandBlocker(s,s.employees.find(e=>e.id==='em3'),'requestSupplierReplacement',[{qualityCheckId:qcId,key:'x'}]),'Rolingizda bu amal uchun ruxsat yo‘q')
  refused(s,A.closeSupplierReplacement(s,ctx(s),r.result.id,''),/sabab/)
  s=ok(A.closeSupplierReplacement(s,ctx(s),r.result.id,'Supplier pul qaytaradi'))
  assert.equal(s.supplierReplacements[0].status,'Bekor')
  // What was closed unreceived can be asked for again (the returned units are still not replaced).
  s=ok(A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:30,key:'k2'}))
})

/* ============================================== Notifications #27 == */

test('Notify 1: a real event creates one notification; repeats and re-scans create none',()=>{
  let {s,qcId}=returned()
  const before=s.notifications.length
  const r=A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:5,key:'k1'});s=ok(r)
  assert.equal(s.notifications.length,before+1)
  const n=s.notifications[0]
  assert.deepEqual([n.type,n.key,n.path,n.branchId],['purchase',`replacement:${r.result.id}:open`,`/purchases?view=replacements&id=${r.result.id}`,'b1'])
  s=ok(A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:5,key:'k1'}))
  assert.equal(s.notifications.length,before+1)
  // A refused command returns its input: no notification can come from it.
  refused(s,A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:qcId,qty:999,key:'k9'}))
})

test('Notify 2: delayed production, late PO, due maintenance and MRP come from state, once each, with deep links',()=>{
  let s=clean()
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10,start:'2026-10-10',due:'2026-10-15'});s=ok(mo)
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:10}],status:'Tasdiqlangan',expectedDate:'2026-10-18'});s=ok(po)
  s={...s,equipment:s.equipment.map(e=>e.id==='eq1'?{...e,nextMaintenance:'2026-10-19',maintenancePlan:{unit:'day',interval:30}}:e)}
  const c=ctx(s)
  const once=N.scanNotifications(s,c),twice=N.scanNotifications(once,c)
  assert.equal(twice.notifications.length,once.notifications.length,'a re-run posts nothing new')
  const by=t=>once.notifications.filter(n=>n.type===t)
  assert.deepEqual(by('delay').map(n=>[n.key,n.path]),[[`delay:${mo.result.id}:2026-10-15`,`/production?view=orders&id=${mo.result.id}`]])
  assert.deepEqual(by('purchase').filter(n=>n.key?.startsWith('po-late')).map(n=>n.path),[`/purchases?view=orders&id=${po.result.id}`])
  assert.ok(by('maintenance').some(n=>n.path==='/equipment?view=equipment&id=eq1'))
  assert.ok(by('mrp').every(n=>n.path==='/production?view=mrp'))
  // Preferences: a category switched off creates nothing.
  const off={...s,settings:{...s.settings,notifications:{...s.settings.notifications,delay:false,purchase:false}}}
  const quiet=N.scanNotifications(off,c)
  assert.equal(quiet.notifications.filter(n=>/^(delay|po-late):/.test(n.key||'')).length,0)
  // A new due date is a new event.
  const moved={...once,productionOrders:once.productionOrders.map(o=>o.id===mo.result.id?{...o,due:'2026-10-17'}:o)}
  assert.equal(N.scanNotifications(moved,c).notifications.filter(n=>n.type==='delay').length,2)
})

test('Notify 3: branch scope — a branch role does not see another site’s events; read marks are per user',()=>{
  let s=clean()
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10,start:'2026-10-10',due:'2026-10-15'});s=ok(mo)
  s=N.scanNotifications(s,ctx(s))
  const delay=s.notifications.find(n=>n.type==='delay')
  assert.equal(delay.branchId,'b1')
  const b2={...s,employees:s.employees.map(e=>e.id==='em2'?{...e,workCenterId:'wc4'}:e)}
  const seen=X.scopedView(b2,b2.employees.find(e=>e.id==='em2'))
  assert.equal(seen.notifications.some(n=>n.id===delay.id),false,'b2 production manager does not see b1 delay')
  assert.ok(X.scopedView(s,s.employees.find(e=>e.id==='em2')).notifications.some(n=>n.id===delay.id),'b1 manager does')
})

/* ===================================== Legacy return credit (Phase 4 gap) == */

/** cu2 owes 1 000 000 from before the ledger; SO delivered 5 × 200 000 then (no invoice entry). */
function legacyOrder(){
  let s=clean()
  s={...s,customers:s.customers.map(c=>c.id==='cu2'?{...c,debt:1000000}:c)}
  s={...s,receivables:R.openingEntries(s.customers,'2026-01-01 08:00')}
  s=withStock(s,'p3','w3',[{code:'P3-OLD',qty:20}])
  const so={id:'so-old',code:'SO-OLD',customerId:'cu2',status:'Yetkazildi',mode:'Make-to-stock',items:[{productId:'p3',qty:5,price:200000,delivered:5,reserved:0}],total:1000000,paymentStatus:'To‘lanmagan',deliveryDate:'2026-01-10',createdAt:'2026-01-05 09:00',deliveredAt:'2026-01-10 10:00'}
  const move={id:'mv-old',date:'2026-01-10 10:00',type:'Sale -',itemId:'p3',itemType:'finished',warehouseId:'w3',qty:-5,source:'SO-OLD',note:'Sales delivery',user:'Tizim',lot:'P3-OLD'}
  return {...s,salesOrders:[so],stockMovements:[move,...s.stockMovements]}
}

test('Finance legacy 1: an old order return opens a reconciliation instead of a guessed credit; one decision, one credit',()=>{
  let s=legacyOrder()
  assert.deepEqual(R.orderInvoicing(s,'so-old'),{delivered:1000000,invoiced:0,legacy:1000000,kind:'legacy'})
  const r=A.createReturn(s,ctx(s),{salesOrderId:'so-old',productId:'p3',qty:2,reason:'Nuqson'});s=ok(r)
  assert.equal(R.customerBalance(s,'cu2'),1000000,'no automatic credit for an invoice the ledger never saw')
  const rec=s.receivableReconciliations[0]
  assert.deepEqual([rec.status,rec.amount,rec.returnId],['open',400000,r.result.id])
  refused(s,A.resolveReturnCredit(s,ctx(s),{returnId:r.result.id,decision:'credit',reason:'x'}),/sabab/)
  assert.equal(X.commandBlocker(s,s.employees.find(e=>e.id==='em2'),'resolveReturnCredit',[{returnId:r.result.id}]),'Rolingizda bu amal uchun ruxsat yo‘q')
  s=ok(A.resolveReturnCredit(s,ctx(s),{returnId:r.result.id,decision:'credit',reason:'Mijoz bilan solishtirildi'}))
  assert.equal(R.customerBalance(s,'cu2'),600000)
  const again=A.resolveReturnCredit(s,ctx(s),{returnId:r.result.id,decision:'credit',reason:'Yana bir marta'})
  assert.equal(again.state,s,'a decided reconciliation changes nothing');assert.equal(R.customerBalance(again.state,'cu2'),600000)
  assert.ok(s.receivables.some(e=>e.kind==='opening'&&e.amount===1000000),'the opening balance is never rewritten')
  // The rest of the order's legacy value: a second return can be credited, never beyond what was delivered.
  const r2=A.createReturn(s,ctx(s),{salesOrderId:'so-old',productId:'p3',qty:3,reason:'Nuqson'});s=ok(r2)
  assert.equal(s.receivableReconciliations.find(x=>x.returnId===r2.result.id).amount,600000)
})

test('Finance legacy 2: an ambiguous old debt can be closed without credit; new-order returns keep the automatic credit note',()=>{
  let s=legacyOrder()
  const r=A.createReturn(s,ctx(s),{salesOrderId:'so-old',productId:'p3',qty:1,reason:'Nuqson'});s=ok(r)
  s=ok(A.resolveReturnCredit(s,ctx(s),{returnId:r.result.id,decision:'no-credit',reason:'Naqd qaytarilgan, hujjat bor'}))
  assert.equal(R.customerBalance(s,'cu2'),1000000,'the old debt is preserved')
  assert.equal(s.receivableReconciliations[0].status,'no-credit')
  // A ledger-invoiced order: the credit note is automatic and no reconciliation opens.
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:4,price:1000}]});s=ok(so)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(R.orderInvoicing(s,so.result.id).kind,'ledger')
  const r2=A.createReturn(s,ctx(s),{salesOrderId:so.result.id,productId:'p3',qty:1,reason:'Nuqson'});s=ok(r2)
  assert.equal(R.customerBalance(s,'cu1'),3000)
  assert.equal(s.receivableReconciliations.some(x=>x.returnId===r2.result.id),false)
  refused(s,A.resolveReturnCredit(s,ctx(s),{returnId:r2.result.id,decision:'credit',reason:'Ikki marta urinish'}),/qiymat yo‘q/)
})

/* =============================================== Timezone (Phase 4 gap) == */

test('Time 1: instants, wall-clock stamps and calendar days are told apart',()=>{
  assert.deepEqual(['2026-10-21','2026-10-21 08:00','2026-10-21T03:00:00.000Z','2026-10-21T08:00+05:00','2026-02-30x',5].map(D.timestampKind),['date','local','instant','instant','invalid','invalid'])
  D.setTimeZone('Asia/Tashkent')
  assert.equal(D.parseDate('2026-10-21T03:00:00.000Z').toISOString(),'2026-10-21T03:00:00.000Z','an instant is read as is')
  assert.equal(D.parseDate('2026-10-21 08:00').toISOString(),'2026-10-21T03:00:00.000Z','wall clock in the company zone')
  // New business events: one model — company wall clock, resolvable through the zone history.
  assert.equal(D.stamp(new Date('2026-10-21T03:00:00Z')),'2026-10-21 08:00')
})

test('Time 2: a company zone change keeps every earlier timestamp at its real instant; no calendar day moves',()=>{
  D.setTimeZone('Asia/Tashkent')
  const company={name:'X',currency:'UZS',timezone:'Asia/Tashkent',taxId:''}
  const changedAt=new Date('2026-10-21T06:00:00Z')
  const next=D.recordZoneChange(company,{timezone:'UTC'},changedAt)
  assert.deepEqual(next.zoneHistory,[{zone:'Asia/Tashkent',since:''},{zone:'UTC',since:'2026-10-21T06:00:00.000Z'}])
  assert.deepEqual(D.recordZoneChange(next,{timezone:'UTC'},changedAt).zoneHistory,next.zoneHistory,'the same zone adds no entry')
  D.setTimeZone('UTC');D.setZoneHistory(next.zoneHistory)
  // Written in Tashkent at 05:00Z (10:00 local) — not silently re-read as 10:00 UTC.
  assert.equal(D.parseDate('2026-10-20 10:00').toISOString(),'2026-10-20T05:00:00.000Z')
  // Written after the change in UTC.
  assert.equal(D.parseDate('2026-10-22 10:00').toISOString(),'2026-10-22T10:00:00.000Z')
  assert.equal(D.minutesBetween('2026-10-20 10:00','2026-10-22 10:00'),2*1440+300,'real elapsed minutes across the change')
  // Calendar days are pure calendar math.
  assert.deepEqual([D.addDays('2026-10-21',1),D.daysBetween('2026-10-20','2026-10-22'),D.addDays('2026-03-08',1)],['2026-10-22',2,'2026-03-09'])
  // Without a history (no change recorded) behaviour is unchanged.
  D.setZoneHistory(undefined)
  assert.equal(D.parseDate('2026-10-20 10:00').toISOString(),'2026-10-20T10:00:00.000Z')
})

test('Time 3: DST zone — a change into America/New_York reads both sides correctly',()=>{
  const company={name:'X',currency:'UZS',timezone:'UTC',taxId:''}
  const h=D.recordZoneChange(company,{timezone:'America/New_York'},new Date('2026-03-01T00:00:00Z')).zoneHistory
  D.setTimeZone('America/New_York');D.setZoneHistory(h)
  assert.equal(D.parseDate('2026-02-20 12:00').toISOString(),'2026-02-20T12:00:00.000Z','before the change: UTC wall clock')
  assert.equal(D.parseDate('2026-03-07 12:00').toISOString(),'2026-03-07T17:00:00.000Z','EST')
  assert.equal(D.parseDate('2026-03-09 12:00').toISOString(),'2026-03-09T16:00:00.000Z','EDT')
  assert.equal(D.minutesBetween('2026-03-08 01:00','2026-03-08 04:00'),120,'spring forward is one hour shorter')
})

/* ================================== Machine capacity (Phase 4 gap) == */

function twoOrders(extra=s=>s){
  let s=clean()
  s={...s,workCenters:s.workCenters.map(w=>({...w,efficiency:100}))}
  s=extra(s)
  const a=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:100,start:TODAY,due:'2026-10-30'});s=ok(a)
  const b=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:100,start:TODAY,due:'2026-10-30'});s=ok(b)
  return {s,a:a.result.id,b:b.result.id}
}
const run=(s,now=T0)=>P.scheduleOperations(s,{now})
const ext=(plan)=>plan.operations.filter(o=>o.workCenterId==='wc1')
const twin=s=>({...s,equipment:[...s.equipment,{...s.equipment.find(e=>e.id==='eq1'),id:'eq1b',name:'Press 2'}]})
function noOverlapPerMachine(plan){
  const byMachine=new Map()
  for(const o of plan.operations)if(o.machineId){const l=byMachine.get(o.machineId)||[];l.push([D.parseDate(o.start).getTime(),D.parseDate(o.end).getTime()]);byMachine.set(o.machineId,l)}
  for(const [m,list] of byMachine)for(const [a,b] of list)assert.equal(list.filter(([x,y])=>x<b&&a<y).length,1,`${m} double-booked`)
}

test('Capacity 1: one machine never runs two operations; two machines run two in parallel',()=>{
  let {s}=twoOrders()
  let plan=run(s)
  noOverlapPerMachine(plan)
  assert.deepEqual(ext(plan).map(o=>o.machineId),['eq1','eq1'])
  ;({s}=twoOrders(twin))
  plan=run(s)
  noOverlapPerMachine(plan)
  assert.deepEqual(ext(plan).map(o=>[o.start,o.machineId]).sort(),[['2026-10-21 08:00','eq1'],['2026-10-21 08:00','eq1b']])
})

test('Capacity 2: maintenance blocks only its own machine; the other machine keeps working',()=>{
  const pm=s=>({...twin(s),maintenanceOrders:[{id:'pm',code:'PM-1',equipmentId:'eq1',type:'Preventive',status:'Rejada',scheduled:'2026-10-21 08:00',plannedHours:4,technicianId:'em5',cost:0,note:''}]})
  const {s,a,b}=twoOrders(pm)
  const plan=run(s)
  noOverlapPerMachine(plan)
  const ops=ext(plan)
  const first=ops.find(o=>o.orderId===a),second=ops.find(o=>o.orderId===b)
  assert.deepEqual([first.machineId,first.start],['eq1b','2026-10-21 08:00'])
  assert.ok(ops.filter(o=>o.machineId==='eq1').every(o=>o.start>='2026-10-21 12:00'),'eq1 is not used during its service')
  assert.ok(second.machineId==='eq1'?second.start>='2026-10-21 12:00':second.start>=first.end)
  // Capacity of the day: eq1 loses 4 h, eq1b keeps its shift.
  assert.equal(E.workCenterDay(s,s.workCenters.find(w=>w.id==='wc1'),TODAY,T0).clock,480+240)
})

test('Capacity 3: started operations get no invented machine; completed work is not rescheduled; a bad move is refused',()=>{
  let {s,a}=twoOrders(x=>twin(withStock(withStock(x,'rm1','w1',[{code:'AL-1',qty:500}]),'rm3','w1',[{code:'PC-1',qty:50}])))
  s=ok(A.transitionProduction(s,ctx(s),a,'Tasdiqlangan'),'confirm: ')
  const plan=run(s)
  assert.ok(ext(plan).every(o=>o.machineId),'not started yet: planned machines shown')
  const wo=s.productionOrders.find(o=>o.id===a).workOrders[0]
  const started={...s,productionOrders:s.productionOrders.map(o=>o.id!==a?o:{...o,status:'Jarayonda',workOrders:o.workOrders.map(w=>w.id===wo.id?{...w,status:'Jarayonda',startedAt:'2026-10-21 08:00',lastStartAt:'2026-10-21 08:00'}:w)})}
  const p2=run(started)
  assert.equal(p2.operations.find(o=>o.workOrderId===wo.id).machineId,undefined,'which machine runs it is not recorded — none invented')
  noOverlapPerMachine(p2)
  const done={...s,productionOrders:s.productionOrders.map(o=>o.id!==a?o:{...o,workOrders:o.workOrders.map(w=>({...w,status:'Yakunlangan',completedAt:'2026-10-20 12:00'}))})}
  assert.equal(run(done).operations.some(o=>o.orderId===a),false,'completed operations are never moved')
  const allDown={...s,maintenanceOrders:['eq1','eq1b'].map((e,i)=>({id:`pm${i}`,code:`PM-${i}`,equipmentId:e,type:'Corrective',status:'Rejada',scheduled:'2026-10-22 08:00',technicianId:'em5',cost:0,note:''}))}
  const moved=A.rescheduleProductionOrder(allDown,ctx(allDown),a,'2026-10-22')
  assert.equal(moved.result.code,'needs-override');assert.equal(moved.state,allDown)
})

/* ========================================== Full workflow (master E2E) == */

test('Workflow: Sales → MRP → Purchase → QC → Production → Delivery → Payment → Return reconcile in stock and money',()=>{
  let s=clean({requireFinalQc:false,autoQualityChecks:true})
  // 1. Sales order of 40 × p3 (MTS) at 50 000: nothing in stock.
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',deliveryDate:'2026-10-28',lines:[{productId:'p3',qty:40,price:50000}]});s=ok(so,'so: ')
  // 2. Branch MRP: make p3, buy rm2 at the selling site.
  const plan=P.runMrp(s,{today:TODAY})
  const make=plan.suggestions.find(x=>x.type==='make'&&x.itemId==='p3'),buy=plan.suggestions.find(x=>x.type==='buy'&&x.itemId==='rm2')
  assert.ok(make&&buy,'make p3 and buy rm2 are suggested')
  assert.equal(make.branchId,'b1')
  // 3. Purchase order for the suggested quantity, received into QC, accepted.
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:Math.ceil(buy.qty)}],status:'Tasdiqlangan',expectedDate:'2026-10-24'});s=ok(po,'po: ')
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',Math.ceil(buy.qty),undefined,undefined,{location:'RAW-A1'}),'receive: ')
  assert.equal(avail(s,'rm2','w1'),0,'in QC: not available yet')
  const q=s.qualityChecks.find(x=>x.sourceId===po.result.id)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),q.id,'Passed'))
  near(avail(s,'rm2','w1'),Math.ceil(buy.qty))
  // 4. MO for p3: reserved from the accepted lot, run, output 40.
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:40,start:TODAY,due:'2026-10-27',salesOrderId:so.result.id});s=ok(mo,'mo: ')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'),'confirm: ')
  assert.ok(s.productionOrders.find(o=>o.id===mo.result.id).reservations.every(r=>r.lots?.length),'reservation pins the lot')
  const sched=run(s)
  assert.ok(sched.operations.some(o=>o.orderId===mo.result.id&&o.machineId==='eq2'),'finite schedule on the laser machine')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Jarayonda'),'start: ')
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,40),'output: ')
  const used=40*E.perUnit({qty:.72,waste:3.8})
  assert.ok(Math.abs(bal(s,'rm2','w1').onHand-(Math.ceil(buy.qty)-used))<1e-3,'consumption = BOM (3-decimal stock)')
  assert.equal(bal(s,'p3','w3').onHand,40)
  // 5. Deliver → invoice; 6. pay half; 7. return 4 → credit note.
  s=ok(A.reserveSalesOrder(s,ctx(s),so.result.id),'reserve: ')
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id),'deliver: ')
  assert.equal(bal(s,'p3','w3').onHand,0)
  assert.equal(R.customerBalance(s,'cu1'),2000000)
  s=ok(A.recordCustomerPayment(s,ctx(s),{customerId:'cu1',amount:1000000,key:'pay-1',salesOrderId:so.result.id,method:'Naqd'}),'pay: ')
  s=ok(A.recordCustomerPayment(s,ctx(s),{customerId:'cu1',amount:1000000,key:'pay-1',salesOrderId:so.result.id,method:'Naqd'}),'pay again: ')
  assert.equal(R.customerBalance(s,'cu1'),1000000,'the same payment key posts once')
  const r=A.createReturn(s,ctx(s),{salesOrderId:so.result.id,productId:'p3',qty:4,reason:'Nuqson'});s=ok(r,'return: ')
  assert.equal(R.customerBalance(s,'cu1'),800000)
  s=ok(A.dispositionReturn(s,ctx(s,'em4'),r.result.id,'Omborga qaytarildi'))
  // Reconciliation: balances = ledger; lots = balances; no negatives; one invoice; costing and traceability resolve.
  for(const b of s.stockBalances){
    assert.ok(b.onHand>=-1e-9&&b.reserved>=-1e-9&&(b.quarantine||0)>=-1e-9,`${b.itemId}@${b.warehouseId} negative`)
    near(b.onHand,s.stockMovements.filter(m=>m.warehouseId===b.warehouseId&&I.keyOf(m)===I.keyOf(b)).reduce((a,m)=>a+m.qty,0),`${b.itemId}@${b.warehouseId} ledger`)
    const lots=s.lots.filter(l=>l.warehouseId===b.warehouseId&&I.keyOf(l)===I.keyOf(b)).reduce((a,l)=>a+l.qty,0)
    near(lots,b.onHand,`${b.itemId}@${b.warehouseId} lots`)
  }
  assert.equal(s.receivables.filter(e=>e.kind==='invoice'&&e.salesOrderId===so.result.id).length,1)
  assert.equal(R.customerBalance(s,'cu1'),s.customers.find(c=>c.id==='cu1').debt)
  const trace=E.buildTraceability(s,mo.result.id)
  assert.ok(trace.purchases.some(p=>p.id===po.result.id),'output traces back to the PO')
  assert.ok(trace.downstreamSales.some(x=>x.id===so.result.id),'and forward to the sale')
  const cost=E.orderCostBreakdown?E.orderCostBreakdown(s,s.productionOrders.find(o=>o.id===mo.result.id)):null
  if(cost)assert.ok(cost.actual.material>0)
  // Notifications from the end state come once.
  const n1=N.scanNotifications(s,ctx(s)),n2=N.scanNotifications(n1,ctx(n1))
  assert.equal(n2.notifications.length,n1.notifications.length)
})
