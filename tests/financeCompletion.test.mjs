// Costs & Finance completion (2026-11-14): supplier payments through an invoice stay within the PO's open balance
// (FN-001), automatically posted expenses are the one cost record of their document (FN-002), and the end-to-end
// ledgers (Sales → Invoice → Payment → Return credit, Procurement → GRN → Invoice → Payment) post every movement once,
// with the cached debts equal to the ledger. A refused command returns the very state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as P from '../.test-dist/payables.mjs'
import * as R from '../.test-dist/receivables.mjs'
import * as I from '../.test-dist/inventory.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-fn${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const clean=()=>createInitialState(T0)
const link=s=>s.supplierMaterials.find(l=>l.materialId==='rm2')
function receivedPo(s,qty=50,price=1000){
  const out=A.createPurchaseOrder(s,ctx(s),{supplierId:link(s).supplierId,lines:[{materialId:'rm2',qty,price}],allowBelowMoq:true});s=ok(out,'po: ')
  const id=out.result.id
  s=ok(A.receivePurchase(s,ctx(s),id,'rm2',qty),'receive: ')
  return {s,id,supplierId:link(s).supplierId}
}
function approvedInvoice(s,poId,number,qty,price=1000){
  const out=A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:poId,number,date:TODAY,lines:[{materialId:'rm2',qty,price}]});s=ok(out,'invoice: ')
  return {s:ok(A.approveSupplierInvoice(s,ctx(s),out.result.id),'approve: '),invoiceId:out.result.id}
}
const uniqueKeys=rows=>assert.equal(new Set(rows.map(e=>e.key)).size,rows.length,'every ledger key is posted once')
function withStock(s,key,warehouseId,qty,code){
  const product=s.products.find(p=>p.id===key)
  return {...s,lots:[...s.lots,{id:`lot-${code}`,code,kind:'lot',itemId:key,itemType:'finished',qty,originalQty:qty,warehouseId,status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-10-01 08:00',consumedBy:[]}],
    stockBalances:[...s.stockBalances.filter(b=>!(I.keyOf(b)===key&&b.warehouseId===warehouseId)),{id:`st-${key}-${warehouseId}`,warehouseId,key,itemId:key,itemType:'finished',onHand:qty,reserved:0,incoming:0,quarantine:0,unit:product.unit}]}
}

/* ---------------------------------------------------------- FN-001 --- */

test('FN-001: a PO paid directly is not paid again through its invoice when the PO is not named',()=>{
  let {s,id,supplierId}=receivedPo(clean())
  // A second open PO of the same supplier keeps the supplier-level balance positive, so only the PO cap can stop it.
  const other=receivedPo(s,30,1000);s=other.s
  s=ok(A.recordSupplierPayment(s,ctx(s),{supplierId,purchaseOrderId:id,amount:50000,key:'direct',reason:'Bank'}))
  assert.equal(P.purchaseBalance(s,id),0)
  const inv=approvedInvoice(s,id,'F-FN1',50);s=inv.s
  assert.ok(P.supplierBalance(s,supplierId)>=30000,'the supplier still owes on the other PO')
  refused(s,A.recordSupplierPayment(s,ctx(s),{supplierId,invoiceId:inv.invoiceId,amount:50000,key:'via-invoice',reason:'Bank'}),/ochiq qarzdan oshadi \(0/)
  assert.equal(P.purchaseBalance(s,id),0,'the PO stays settled, never overpaid')
})

test('FN-001: a payment through the invoice alone is posted on its PO and capped by what is open there',()=>{
  let {s,id,supplierId}=receivedPo(clean())
  s=ok(A.recordSupplierPayment(s,ctx(s),{supplierId,purchaseOrderId:id,amount:20000,key:'part',reason:'Avans'}))
  const inv=approvedInvoice(s,id,'F-FN2',50);s=inv.s
  refused(s,A.recordSupplierPayment(s,ctx(s),{supplierId,invoiceId:inv.invoiceId,amount:30001,key:'over',reason:'Bank'}),/ochiq qarzdan oshadi \(30000/)
  const pay={supplierId,invoiceId:inv.invoiceId,amount:30000,key:'rest',reason:'Bank'}
  s=ok(A.recordSupplierPayment(s,ctx(s),pay))
  const row=s.payables.find(e=>e.key==='payment:rest')
  assert.deepEqual([row.purchaseOrderId,row.invoiceId,row.amount],[id,inv.invoiceId,-30000])
  assert.equal(A.recordSupplierPayment(s,ctx(s),pay).state,s,'the same payment is posted once')
  assert.equal(P.purchaseBalance(s,id),0)
  assert.equal(s.purchaseOrders.find(p=>p.id===id).paymentStatus,'To‘langan')
  assert.equal(s.suppliers.find(x=>x.id===supplierId).debt,P.supplierBalance(s,supplierId),'cached debt = ledger')
  uniqueKeys(s.payables)
})

test('FN-001: an invoice of another supplier is refused without touching the ledger',()=>{
  let {s,id}=receivedPo(clean())
  const inv=approvedInvoice(s,id,'F-FN3',10);s=inv.s
  const stranger=s.suppliers.find(x=>x.id!==link(s).supplierId)
  s=ok(A.adjustSupplierBalance(s,ctx(s),{supplierId:stranger.id,amount:5000,key:'open-other',reason:'Eski qarz'}))
  refused(s,A.recordSupplierPayment(s,ctx(s),{supplierId:stranger.id,invoiceId:inv.invoiceId,amount:100,key:'x',reason:'Bank'}),/tegishli emas/)
})

/* ---------------------------------------------------------- FN-002 --- */

const request=(s,id='mr-fn')=>({...s,maintenanceRequests:[{id,code:'MR-FN',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:TODAY,reason:'Moy oqmoqda',downtimeHours:1},...s.maintenanceRequests]})

test('FN-002: a maintenance expense is read-only — not edited, deleted or copied; manual expenses stay editable',()=>{
  let s=request(clean())
  const approved=A.approveMaintenanceRequest(s,ctx(s),'mr-fn');s=ok(approved)
  const id=approved.result.id,code=s.maintenanceOrders.find(m=>m.id===id).code
  s=ok(A.startMaintenance(s,ctx(s),id))
  s=ok(A.completeMaintenance(s,ctx(s),id,250000,'Muhr almashtirildi'))
  const auto=s.expenses.find(e=>e.note.startsWith(code))
  const equipmentCost=s.equipment.find(e=>e.id==='eq1').maintenanceCost
  assert.equal(A.expenseOrigin(s,auto),code)
  refused(s,A.updateEntity(s,ctx(s),'expenses',auto.id,{amount:1}),/avtomatik yozilgan/)
  refused(s,A.deleteEntity(s,ctx(s),'expenses',auto.id),/avtomatik yozilgan/)
  refused(s,A.duplicateEntity(s,ctx(s),'expenses',auto.id),/nusxa olinmaydi/)
  assert.equal(s.equipment.find(e=>e.id==='eq1').maintenanceCost,equipmentCost)
  // A hand-typed maintenance expense (no document code) remains an ordinary editable record.
  const manual=A.createEntity(s,ctx(s),'expenses',{date:TODAY,type:'Maintenance',sourceId:'eq1',branchId:'b1',amount:5000,note:'Moy sotib olindi'});s=ok(manual)
  assert.equal(A.expenseOrigin(s,s.expenses.find(e=>e.id===manual.result.id)),null)
  s=ok(A.updateEntity(s,ctx(s),'expenses',manual.result.id,{amount:6000}))
  s=ok(A.deleteEntity(s,ctx(s),'expenses',manual.result.id))
  assert.equal(s.expenses.filter(e=>e.note.startsWith(code)).length,1,'the document cost is counted once')
})

/* ------------------------------------------- Ledger integration --- */

test('Sales → invoice → payment → return credit: each posted once; order, customer and ledger agree',()=>{
  let s=withStock(clean(),'p1','w3',50,'FG-FN')
  const debt0=R.customerBalance(s,'cu1')
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',deliveryDate:'2026-10-25',lines:[{productId:'p1',qty:10,price:1000}]});s=ok(so)
  const id=so.result.id
  s=ok(A.deliverSalesOrder(s,ctx(s),id))
  assert.deepEqual(R.orderReceivable(s,id),{invoiced:10000,paid:0,credited:0,outstanding:10000,status:'To‘lanmagan'})
  const pay={customerId:'cu1',salesOrderId:id,amount:4000,key:'so-pay'}
  s=ok(A.recordCustomerPayment(s,ctx(s),pay))
  assert.equal(A.recordCustomerPayment(s,ctx(s),pay).state,s,'a resent payment is not posted twice')
  refused(s,A.recordCustomerPayment(s,ctx(s),{...pay,key:'so-over',amount:6001}),/qoldig‘idan oshmasin/)
  s=ok(A.createReturn(s,ctx(s),{salesOrderId:id,productId:'p1',qty:2,reason:'Shikastlangan'}))
  const r=R.orderReceivable(s,id)
  assert.deepEqual([r.paid,r.credited,r.outstanding,r.status],[4000,2000,4000,'Qisman'])
  s=ok(A.recordCustomerPayment(s,ctx(s),{customerId:'cu1',salesOrderId:id,amount:4000,key:'so-pay-2'}))
  assert.equal(R.orderReceivable(s,id).status,'To‘langan')
  assert.equal(s.salesOrders.find(o=>o.id===id).paymentStatus,'To‘langan')
  assert.equal(R.customerBalance(s,'cu1'),debt0,'the order is fully settled: the balance is back where it started')
  assert.equal(s.customers.find(c=>c.id==='cu1').debt,R.customerBalance(s,'cu1'),'cached debt = ledger')
  uniqueKeys(s.receivables)
})

test('Procurement → GRN → invoice → payment: debt follows the ledger, nothing posted twice',()=>{
  let {s,id,supplierId}=receivedPo(clean(),40,500)
  const debt=P.supplierBalance(s,supplierId)
  assert.equal(P.purchaseBalance(s,id),20000,'GRN raises the payable at the PO price once')
  const inv=approvedInvoice(s,id,'F-FN5',40,500);s=inv.s
  assert.equal(P.supplierBalance(s,supplierId),debt,'a matching invoice does not add debt')
  s=ok(A.recordSupplierPayment(s,ctx(s),{supplierId,purchaseOrderId:id,invoiceId:inv.invoiceId,amount:20000,key:'full',reason:'Bank'}))
  assert.equal(P.purchaseBalance(s,id),0)
  assert.equal(A.invoiceOpen(s,s.supplierInvoices.find(x=>x.id===inv.invoiceId)),0)
  refused(s,A.recordSupplierPayment(s,ctx(s),{supplierId,purchaseOrderId:id,amount:1,key:'extra',reason:'Bank'}),/ochiq qarzdan oshadi/)
  assert.equal(s.suppliers.find(x=>x.id===supplierId).debt,P.supplierBalance(s,supplierId))
  uniqueKeys(s.payables)
})
