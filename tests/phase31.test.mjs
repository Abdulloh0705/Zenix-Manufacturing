import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {commandBlocker} from '../.test-dist/access.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'
import {branchPurchaseNeeds} from '../.test-dist/planning.mjs'
import {profitabilityByProduct} from '../.test-dist/profitability.mjs'
import {supplierBalance,purchaseBalance} from '../.test-dist/payables.mjs'

const now=new Date('2026-11-07T09:00:00Z')
let n=0
const ctx=(s,user='em1')=>({now,user:s.employees.find(e=>e.id===user),id:p=>`${p}-p31-${++n}`})
const fresh=()=>createInitialState(now)
const ok=x=>{assert.equal(x.result.ok,true,x.result.message);return x.state}
const refused=(s,x)=>{assert.equal(x.result.ok,false);assert.equal(x.state,s)}

function legacyRework(oneLot=false){
  let s=fresh()
  const created=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10})
  s=ok(created)
  const base=s.productionOrders.find(o=>o.id===created.result.id)
  const source={...base,status:'Sifat nazoratida',completed:10,qcHeld:6,qualityStatus:'Pending',workOrders:[]}
  const child={...source,id:'rw-legacy',code:'RW-LEGACY',reworkOf:source.id,quantity:4,completed:4,qcHeld:4}
  const lot=(id,code,qty)=>({id,code,kind:'lot',itemId:'p1',itemType:'finished',qty,warehouseId:source.warehouseId,status:'quarantine',sourceType:'production',sourceId:source.id,sourceCode:source.code,createdAt:'2026-11-06T09:00:00Z',consumedBy:[]})
  const lots=oneLot?[lot('lot-whole','SOURCE',10)]:[lot('lot-source','SOURCE',6),lot('lot-legacy','RW-OLD',4)]
  const qc=id=>({id:`qc-${id}`,type:'Final',sourceType:'production',sourceId:id,itemId:'p1',status:'Pending',inspectorId:'em4',date:'2026-11-07T09:00:00Z'})
  return {...s,productionOrders:[source,child],lots,stockBalances:[{id:'st-fg',warehouseId:source.warehouseId,itemId:'p1',itemType:'finished',onHand:10,reserved:0,incoming:0,quarantine:10,unit:'dona'}],qualityChecks:[qc(source.id),qc(child.id)]}
}

test('P3-P0-07: ambiguous legacy custody needs an explicit valid LOT and keeps stock/history unchanged',()=>{
  let s=legacyRework(),source=s.productionOrders[0]
  refused(s,A.resolveQuality(s,ctx(s,'em4'),`qc-${source.id}`,'Passed'))
  refused(s,A.resolveQuality(s,ctx(s,'em4'),'qc-rw-legacy','Passed'))
  for(const bad of [[{lotId:'lot-source',qty:7}],[{lotId:'lot-legacy',qty:5}],[{lotId:'unknown',qty:4}]])refused(s,A.reconcileReworkOwnership(s,ctx(s,'em4'),'rw-legacy',bad,'Inspected'))
  const before=JSON.stringify(s.stockBalances),moves=s.stockMovements.length
  s=ok(A.reconcileReworkOwnership(s,ctx(s,'em4'),'rw-legacy',[{lotId:'lot-legacy',qty:4}],'Physical LOT checked'))
  assert.equal(JSON.stringify(s.stockBalances),before)
  assert.equal(s.stockMovements.length,moves)
  assert.equal(s.lots.find(l=>l.id==='lot-source').qty,6)
  assert.equal(s.lots.find(l=>l.id==='lot-legacy').qty,0)
  assert.equal(s.productionOrders[1].reworkReconciliations[0].by,'em4')
  assert.equal(A.reconcileReworkOwnership(s,ctx(s,'em4'),'rw-legacy',[{lotId:'lot-legacy',qty:4}],'repeat').state,s)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),'qc-rw-legacy','Passed'))
  assert.equal(s.stockBalances[0].quarantine,6)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),`qc-${source.id}`,'Passed'))
  assert.equal(s.stockBalances[0].quarantine,0)
  assert.equal(s.lots.filter(l=>l.qty>0&&l.status==='available').reduce((a,l)=>a+l.qty,0),10)
})

test('P3-P0-07: one provable LOT is repaired automatically; wrong warehouse and operator are blocked',()=>{
  let s=legacyRework(true)
  const operator=s.employees.find(e=>s.roles.find(r=>r.id===e.roleId)?.key==='operator')
  assert.ok(commandBlocker(s,operator,'reconcileReworkOwnership',['rw-legacy',[{lotId:'lot-whole',qty:4}],'why']))
  const wrong={...s,lots:s.lots.map(l=>({...l,warehouseId:'w4'}))}
  refused(wrong,A.reconcileReworkOwnership(wrong,ctx(wrong,'em4'),'rw-legacy',[{lotId:'lot-whole',qty:4}],'why'))
  s=ok(A.resolveQuality(s,ctx(s,'em4'),'qc-rw-legacy','Passed'))
  assert.equal(s.productionOrders[1].reworkReconciliations.length,1)
  assert.equal(s.stockBalances[0].quarantine,6)
})

test('P3-P0-07: wrong product/variant and insufficient source custody never mutate state',()=>{
  const s=legacyRework()
  const wrongProduct={...s,lots:s.lots.map(l=>l.id==='lot-legacy'?{...l,itemId:'p2'}:l)}
  refused(wrongProduct,A.reconcileReworkOwnership(wrongProduct,ctx(wrongProduct,'em4'),'rw-legacy',[{lotId:'lot-legacy',qty:4}],'why'))
  const wrongVariant={...s,lots:s.lots.map(l=>l.id==='lot-legacy'?{...l,variantId:'v2'}:l)}
  refused(wrongVariant,A.reconcileReworkOwnership(wrongVariant,ctx(wrongVariant,'em4'),'rw-legacy',[{lotId:'lot-legacy',qty:4}],'why'))
  const depleted={...s,lots:s.lots.map(l=>l.id==='lot-legacy'?{...l,qty:3}:l)}
  refused(depleted,A.reconcileReworkOwnership(depleted,ctx(depleted,'em4'),'rw-legacy',[{lotId:'lot-legacy',qty:4}],'why'))
})

test('P3-P1-05: full/partial manual issue returns restore original LOT, stock and WIP once',()=>{
  let s=fresh()
  s=ok(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10}))
  const o=s.productionOrders[0]
  const issue={id:'issue-1',materialId:'rm1',itemType:'raw',qty:4,lot:'RAW-1',date:'2026-11-07T08:00:00Z',unitCost:25,warehouseId:'w1',location:'RAW-A1',issueKind:'manual',outputAtIssue:0,workMinutesAtIssue:0}
  s={...s,productionOrders:[{...o,status:'Pauzada',consumed:[issue],workOrders:[]}],lots:[{id:'raw-lot',code:'RAW-1',kind:'lot',itemId:'rm1',itemType:'raw',qty:0,warehouseId:'w1',location:'RAW-A1',status:'available',sourceType:'purchase',sourceId:'po-old',sourceCode:'PO-OLD',createdAt:'2026-11-01',consumedBy:[o.code]}],stockBalances:[{id:'st-raw',warehouseId:'w1',itemId:'rm1',itemType:'raw',onHand:0,reserved:0,incoming:0,quarantine:0,unit:'kg',bins:{'RAW-A1':0}}]}
  refused(s,A.returnUnusedMaterial(s,ctx(s),o.id,issue.id,5,'unused','too-much'))
  s=ok(A.returnUnusedMaterial(s,ctx(s),o.id,issue.id,1.5,'unused','ret-1'))
  assert.equal(s.stockBalances[0].onHand,1.5)
  assert.equal(s.lots[0].qty,1.5)
  assert.equal(s.productionOrders[0].materialReturns.length,1)
  assert.equal(A.returnUnusedMaterial(s,ctx(s),o.id,issue.id,1.5,'unused','ret-1').state,s)
  s=ok(A.returnUnusedMaterial(s,ctx(s),o.id,issue.id,2.5,'unused','ret-2'))
  assert.equal(s.stockBalances[0].onHand,4)
  refused(s,A.returnUnusedMaterial(s,ctx(s),o.id,issue.id,0.1,'unused','ret-3'))
  const changed={...s,productionOrders:s.productionOrders.map(x=>({...x,completed:1}))}
  refused(changed,A.returnUnusedMaterial(changed,ctx(changed),o.id,issue.id,0.1,'unused','ret-4'))
})

test('P3-P1-05: cancelled MO may return proven unused issue; QC hold and later work block it',()=>{
  let s=fresh()
  s=ok(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2}))
  const mo=s.productionOrders[0],issue={id:'manual-2',materialId:'rm1',itemType:'raw',qty:2,lot:'RAW-2',date:'2026-11-07',unitCost:10,warehouseId:'w1',issueKind:'manual',outputAtIssue:0,workMinutesAtIssue:0}
  s={...s,productionOrders:[{...mo,status:'Bekor qilingan',workOrders:[],consumed:[issue]}],lots:[{id:'lot-raw-2',code:'RAW-2',kind:'lot',itemId:'rm1',itemType:'raw',qty:0,warehouseId:'w1',status:'hold',sourceType:'purchase',sourceId:'old',sourceCode:'old',createdAt:'2026-11-01',consumedBy:[]}],stockBalances:[{id:'st-raw-2',warehouseId:'w1',itemId:'rm1',itemType:'raw',onHand:0,reserved:0,incoming:0,quarantine:0,unit:'kg'}]}
  refused(s,A.returnUnusedMaterial(s,ctx(s),mo.id,issue.id,1,'unused','hold'))
  s={...s,lots:s.lots.map(l=>({...l,status:'available'}))}
  s=ok(A.returnUnusedMaterial(s,ctx(s),mo.id,issue.id,2,'cancelled unused','cancel-ret'))
  assert.equal(s.stockMovements[0].type,'Material Return +')
  assert.equal(s.productionOrders[0].consumed[0].qty,2,'gross issue history remains')
  assert.equal(s.productionOrders[0].materialReturns[0].unitCost,10)
})

test('P3-P1-06: receipt recognition, partial payment, idempotence and cancellation',()=>{
  let s=fresh()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:10,price:100}],status:'Tasdiqlangan'})
  s=ok(po)
  assert.equal(supplierBalance(s,'su1'),0,'unreceived PO is not a debt')
  const received=A.receivePurchase(s,ctx(s),po.result.id,'rm1',4,'P31-RAW',undefined,{key:'receipt-one'})
  s=ok(received)
  assert.equal(supplierBalance(s,'su1'),400)
  assert.equal(purchaseBalance(s,po.result.id),400)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm1',4,'P31-RAW-2',undefined,{key:'receipt-one'}))
  s=ok(A.recordSupplierPayment(s,ctx(s),{supplierId:'su1',purchaseOrderId:po.result.id,amount:150,key:'payment-one',reason:'Transfer slip'}))
  assert.equal(purchaseBalance(s,po.result.id),250)
  assert.equal(A.recordSupplierPayment(s,ctx(s),{supplierId:'su1',purchaseOrderId:po.result.id,amount:150,key:'payment-one',reason:'Transfer slip'}).state,s)
  refused(s,A.recordSupplierPayment(s,ctx(s),{supplierId:'su1',purchaseOrderId:po.result.id,amount:251,key:'too-big',reason:'Transfer slip'}))
  s=ok(A.recordSupplierPayment(s,ctx(s),{supplierId:'su1',purchaseOrderId:po.result.id,amount:250,key:'payment-two',reason:'Transfer slip'}))
  assert.equal(supplierBalance(s,'su1'),0)
  const draft=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:2,price:100}],status:'Tasdiqlangan'})
  s=ok(draft)
  s=ok(A.cancelPurchase(s,ctx(s),draft.result.id))
  assert.equal(supplierBalance(s,'su1'),0)
})

test('P3-P1-06: supplier return credits once and replacement receipt restores only returned obligation',()=>{
  let s=fresh()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:5,price:100}],status:'Tasdiqlangan'})
  s=ok(po)
  const received=A.receivePurchase(s,ctx(s),po.result.id,'rm1',5,'P31-RETURN',undefined,{key:'supplier-receipt'})
  s=ok(received)
  const check=s.qualityChecks.find(q=>q.receiptId===received.result.id)
  assert.ok(check)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.id,'Failed','bad material'))
  s=ok(A.returnPurchaseToSupplier(s,ctx(s),check.id,2,'credit or replace'))
  assert.equal(supplierBalance(s,'su1'),300)
  assert.equal(s.payables.filter(e=>e.kind==='credit').length,1)
  const replacement=A.requestSupplierReplacement(s,ctx(s),{qualityCheckId:check.id,qty:2,key:'replace-one'})
  s=ok(replacement)
  const rep=A.receiveSupplierReplacement(s,ctx(s),replacement.result.id,2,{lot:'P31-REPLACEMENT',key:'replace-receipt'})
  s=ok(rep)
  assert.equal(supplierBalance(s,'su1'),500)
  assert.equal(s.payables.filter(e=>e.kind==='receipt').length,2)
  refused(s,A.receiveSupplierReplacement(s,ctx(s),replacement.result.id,2,{lot:'P31-REPLACEMENT-2',key:'replace-receipt'}))
  assert.equal(supplierBalance(s,'su1'),500)
})

test('P3-P1-06: adjustments and migrated opening balances preserve supplier history',()=>{
  let s=fresh()
  s={...s,suppliers:s.suppliers.map(x=>x.id==='su1'?{...x,debt:125}:x),payables:[{id:'old-ap',key:'opening:su1',supplierId:'su1',kind:'opening',amount:125,date:'2026-11-01',by:'system',currency:'UZS'}]}
  s=ok(A.adjustSupplierBalance(s,ctx(s),{supplierId:'su1',amount:-25,key:'credit-1',reason:'Documented credit'}))
  assert.equal(supplierBalance(s,'su1'),100)
  assert.equal(s.payables.find(e=>e.id==='old-ap').amount,125)
  refused(s,A.adjustSupplierBalance(s,ctx(s),{supplierId:'su1',amount:-101,key:'too-much',reason:'Bad credit'}))
  s=ok(A.recordSupplierPayment(s,ctx(s),{supplierId:'su1',amount:100,key:'opening-pay',reason:'Settlement'}))
  assert.equal(supplierBalance(s,'su1'),0)
})

test('P3-MRP: other-branch stock cannot cover local material demand',()=>{
  let s=fresh()
  s=ok(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10,warehouseId:'w3',lineId:'l1',due:'2026-11-10'}))
  s={...s,stockBalances:[{id:'other-stock',warehouseId:'w4',itemId:'rm1',itemType:'raw',onHand:1000,reserved:0,incoming:0,quarantine:0,unit:'kg'}]}
  const needs=branchPurchaseNeeds(s)
  assert.ok(needs.find(x=>x.branchId==='b1'&&x.materialId==='rm1').shortage>0)
  assert.equal(needs.find(x=>x.branchId==='b1'&&x.materialId==='rm1').available,0)
  assert.ok(needs.find(x=>x.branchId==='b2'&&x.materialId==='rm1').available>0)
})

test('P3-COGS: different LOT costs, partial return and missing provenance remain distinct',()=>{
  let s=fresh()
  const made=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:4})
  s=ok(made)
  const base=s.productionOrders[0]
  const snapshot=total=>({planned:{material:0,labor:0,machine:0,overhead:0,total},actual:{material:total,labor:0,machine:0,overhead:0,total},at:'2026-11-05'})
  const a={...base,id:'mo-a',code:'MO-A',completed:2,status:'Yakunlangan',costSnapshot:snapshot(20),workOrders:[]}
  const b={...base,id:'mo-b',code:'MO-B',completed:2,status:'Yakunlangan',costSnapshot:snapshot(60),workOrders:[]}
  const lot=(id,code,mo)=>({id,code,kind:'lot',itemId:'p1',itemType:'finished',qty:0,warehouseId:'w3',sourceType:'production',sourceId:mo.id,sourceCode:mo.code,createdAt:'2026-11-05',consumedBy:[]})
  const so={id:'so-cost',code:'SO-COST',customerId:'cu1',status:'Yetkazildi',mode:'Make-to-stock',items:[{productId:'p1',qty:4,price:100,delivered:4,reserved:0}],total:400,paymentStatus:'',deliveryDate:'2026-11-07',createdAt:'2026-11-05'}
  const move=(id,code,qty)=>({id,type:'Sale -',itemId:'p1',itemType:'finished',warehouseId:'w3',qty:-qty,source:so.code,date:'2026-11-06T10:00:00Z',user:'seller',note:'delivery',lot:code})
  s={...s,productionOrders:[a,b],lots:[lot('la','LOT-A',a),lot('lb','LOT-B',b)],salesOrders:[so],stockMovements:[move('ma','LOT-A',2),move('mb','LOT-B',2)]}
  let row=profitabilityByProduct(s,'2026-11-01')[0]
  assert.equal(row.cogs,80);assert.equal(row.margin,320);assert.equal(row.costBasis,'actual')
  s={...s,returns:[{id:'ret-cost',code:'RET-COST',salesOrderId:so.id,customerId:'cu1',productId:'p1',qty:1,reason:'defect',status:'Inspection',createdAt:'2026-11-07',allocations:[{lot:'LOT-B',qty:1}]}]}
  row=profitabilityByProduct(s,'2026-11-01')[0]
  assert.equal(row.cogs,50);assert.equal(row.margin,250)
  assert.equal(profitabilityByProduct(s,'2026-11-07')[0].cogs,-30)
  const missing={...s,stockMovements:[...s.stockMovements,move('mc',undefined,1)]}
  assert.equal(profitabilityByProduct(missing,'2026-11-01')[0].costBasis,'unavailable')
})

test('P3-COGS: rework adds only frozen rework cost to its delivered LOT',()=>{
  let s=fresh()
  s=ok(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2}))
  const base=s.productionOrders[0]
  const snap=total=>({planned:{material:0,labor:0,machine:0,overhead:0,total},actual:{material:total,labor:0,machine:0,overhead:0,total},at:'2026-11-05'})
  const source={...base,id:'source-cost',code:'SOURCE-COST',completed:2,status:'Yakunlangan',costSnapshot:snap(20),workOrders:[]}
  const rw={...base,id:'rw-cost',code:'RW-COST',reworkOf:source.id,completed:1,status:'Yakunlangan',costSnapshot:snap(5),workOrders:[]}
  const original={id:'orig-lot',code:'ORIG',kind:'lot',itemId:'p1',itemType:'finished',qty:0,warehouseId:'w3',sourceType:'production',sourceId:source.id,sourceCode:source.code,createdAt:'2026-11-05',consumedBy:[]}
  const reworked={...original,id:'rw-lot',code:'RW-LOT',sourceLotCode:'ORIG',reworkOrderId:rw.id}
  const so={id:'so-rw',code:'SO-RW',customerId:'cu1',status:'Yetkazildi',mode:'Make-to-stock',items:[{productId:'p1',qty:1,price:100,delivered:1,reserved:0}],total:100,paymentStatus:'',deliveryDate:'2026-11-07',createdAt:'2026-11-07'}
  const movement={id:'ship-rw',type:'Sale -',itemId:'p1',itemType:'finished',warehouseId:'w3',qty:-1,source:so.code,date:'2026-11-07',user:'seller',note:'',lot:'RW-LOT'}
  s={...s,productionOrders:[source,rw],lots:[original,reworked],salesOrders:[so],stockMovements:[movement]}
  assert.equal(profitabilityByProduct(s,'2026-11-07')[0].cogs,15)
})
