// Procurement completion (2026-11-12): purchase requests with approval, PO approval/sent flow, supplier requisites,
// supplier invoices with 3-way matching (PO ↔ GRN ↔ invoice) and payments against invoices. A refused command
// returns the very state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as P from '../.test-dist/payables.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,21,8,0)
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-pc${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const clean=()=>createInitialState(T0)
const link=s=>s.supplierMaterials.find(l=>l.materialId==='rm2')
const onHand=s=>E.stockOf(s,'rm2').onHand
function confirmedPo(s,qty=100,price=1000){
  const out=A.createPurchaseOrder(s,ctx(s),{supplierId:link(s).supplierId,lines:[{materialId:'rm2',qty,price}],allowBelowMoq:true});s=ok(out,'po: ')
  return {s,id:out.result.id,supplierId:link(s).supplierId}
}
const inv=(s,id)=>s.supplierInvoices.find(x=>x.id===id)

test('purchase request: draft → submitted → approved by someone else → PO draft; no PO from an unapproved request',()=>{
  let s=clean()
  const before=onHand(s)
  refused(s,A.createPurchaseRequest(s,ctx(s),{lines:[],neededBy:'2026-10-30',warehouseId:'w1'}),/Kamida bitta/)
  refused(s,A.createPurchaseRequest(s,ctx(s),{lines:[{materialId:'rm2',qty:10}],neededBy:'2026-10-30',warehouseId:'w3'}),/Raw yoki Mixed/)
  refused(s,A.createPurchaseRequest(s,ctx(s),{lines:[{materialId:'rm2',qty:-1}],neededBy:'2026-10-30',warehouseId:'w1'}),/miqdor/)
  const pr=A.createPurchaseRequest(s,ctx(s),{lines:[{materialId:'rm2',qty:120}],neededBy:'2026-10-30',warehouseId:'w1',note:'Liniya 2'});s=ok(pr)
  const id=pr.result.id,req=()=>s.purchaseRequests.find(r=>r.id===id)
  assert.equal(req().status,'Qoralama')
  const supplierId=link(s).supplierId
  refused(s,A.purchaseOrderFromRequest(s,ctx(s),id,{supplierId}),/faqat tasdiqlangan/)
  s=ok(A.updatePurchaseRequest(s,ctx(s),id,{lines:[{materialId:'rm2',qty:150}],neededBy:'2026-10-30',warehouseId:'w1'}))
  s=ok(A.submitPurchaseRequest(s,ctx(s),id))
  refused(s,A.updatePurchaseRequest(s,ctx(s),id,{lines:[{materialId:'rm2',qty:1}],neededBy:'2026-10-30',warehouseId:'w1'}),/faqat qoralama/)
  refused(s,A.purchaseOrderFromRequest(s,ctx(s),id,{supplierId}),/faqat tasdiqlangan/)
  refused(s,A.decidePurchaseRequest(s,ctx(s),id,'approve'),/boshqa xodim/)
  refused(s,A.decidePurchaseRequest(s,ctx(s,'em2'),id,'reject','no'),/sababini/)
  s=ok(A.decidePurchaseRequest(s,ctx(s,'em2'),id,'approve','Byudjetda bor'))
  assert.equal(req().status,'Tasdiqlangan');assert.equal(req().decidedBy,'em2')
  const po=A.purchaseOrderFromRequest(s,ctx(s),id,{supplierId});s=ok(po)
  const order=s.purchaseOrders.find(p=>p.id===po.result.id)
  assert.deepEqual([order.status,order.items[0].qty,order.requestIds],['Qoralama',150,[id]])
  assert.equal(req().status,'Buyurtma qilingan');assert.deepEqual(req().purchaseOrderIds,[po.result.id])
  assert.deepEqual(req().history.map(h=>h.action),['Yaratildi','Tahrirlandi','Tasdiqlashga yuborildi','Tasdiqlandi','PO yaratildi'])
  refused(s,A.purchaseOrderFromRequest(s,ctx(s),id,{supplierId}),/faqat tasdiqlangan/)
  assert.equal(onHand(s),before,'a request or a PO never adds stock')
})

test('a rejected request is edited back to draft; cancel needs a reason',()=>{
  let s=clean()
  const pr=A.createPurchaseRequest(s,ctx(s),{lines:[{materialId:'rm4',qty:500}],neededBy:'2026-10-30',warehouseId:'w1',submit:true});s=ok(pr)
  const id=pr.result.id
  s=ok(A.decidePurchaseRequest(s,ctx(s,'em2'),id,'reject','Zaxira yetarli'))
  assert.equal(s.purchaseRequests[0].status,'Rad etilgan')
  s=ok(A.updatePurchaseRequest(s,ctx(s),id,{lines:[{materialId:'rm4',qty:200}],neededBy:'2026-10-30',warehouseId:'w1'}))
  assert.equal(s.purchaseRequests[0].status,'Qoralama')
  refused(s,A.cancelPurchaseRequest(s,ctx(s),id,'x'),/sababini/)
  s=ok(A.cancelPurchaseRequest(s,ctx(s),id,'Kerak emas'))
  refused(s,A.submitPurchaseRequest(s,ctx(s),id),/faqat qoralama/)
})

test('PO approval flow: pending approval, editing returns to draft, sent only after approval; PO adds no stock',()=>{
  let s=clean()
  const before=onHand(s)
  const out=A.createPurchaseOrder(s,ctx(s),{supplierId:link(s).supplierId,lines:[{materialId:'rm2',qty:100,price:1000}],status:'Qoralama',allowBelowMoq:true});s=ok(out)
  const id=out.result.id,po=()=>s.purchaseOrders.find(p=>p.id===id)
  refused(s,A.markPurchaseSent(s,ctx(s),id),/tasdiqlangan/)
  s=ok(A.requestPurchaseApproval(s,ctx(s),id))
  assert.ok(po().approvalRequestedAt)
  refused(s,A.requestPurchaseApproval(s,ctx(s),id),/tasdiq kutmoqda/)
  s=ok(A.updatePurchaseDraft(s,ctx(s),id,{lines:[{materialId:'rm2',qty:120,price:1000}],allowBelowMoq:true}))
  assert.equal(po().approvalRequestedAt,undefined,'an edited draft must be sent for approval again')
  s=ok(A.confirmPurchase(s,ctx(s),id))
  assert.equal(E.stockOf(s,'rm2').incoming,120);assert.equal(onHand(s),before,'confirmation books incoming only')
  s=ok(A.markPurchaseSent(s,ctx(s),id))
  assert.ok(po().sentAt)
  refused(s,A.markPurchaseSent(s,ctx(s),id),/yuborilgan/)
  refused(s,A.updatePurchaseDraft(s,ctx(s),id,{lines:[{materialId:'rm2',qty:1,price:1}],allowBelowMoq:true}),/faqat qoralama/)
})

test('supplier requisites are validated; STIR is unique',()=>{
  let s=clean()
  const base={name:'Yangi Metall',phone:'+998 90 123 45 67',leadTime:3,rating:5,status:'Faol'}
  const save=(supplier,id)=>A.saveSupplier(s,ctx(s),{id,supplier,links:[]})
  refused(s,save({...base,phone:'12'}),/Telefon/)
  refused(s,save({...base,email:'x@'}),/Email/)
  refused(s,save({...base,inn:'12345'}),/9 ta raqam/)
  refused(s,save({...base,bankAccount:'1234'}),/20 ta raqam/)
  refused(s,save({...base,bankAccount:'20208000900123456001'}),/MFO/)
  const out=save({...base,inn:'301 234 567',bankAccount:'2020 8000 9001 2345 6001',mfo:'00440',contactPerson:'A. Karimov',address:'Toshkent'});s=ok(out)
  const sup=s.suppliers.find(x=>x.id===out.result.id)
  assert.deepEqual([sup.inn,sup.bankAccount,sup.mfo,sup.contactPerson],['301234567','20208000900123456001','00440','A. Karimov'])
  refused(s,A.saveSupplier(s,ctx(s),{supplier:{...base,name:'Boshqa',inn:'301234567'},links:[]}),/boshqa supplierda/)
  refused(s,A.saveSupplier(s,ctx(s),{supplier:{...base,name:' yangi metall '},links:[]}),/nomli supplier bor/)
})

test('3-way match: an invoice above what was received is never approved; a matching one changes neither stock nor debt',()=>{
  let {s,id,supplierId}=confirmedPo(clean())
  refused(s,A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:'po-none',number:'F-1',date:'2026-10-21',lines:[]}),/PO topilmadi/)
  s=ok(A.receivePurchase(s,ctx(s),id,'rm2',60))
  const stock=onHand(s),debt=P.supplierBalance(s,supplierId)
  assert.equal(P.purchaseBalance(s,id),60000,'debt accrues at goods receipt')
  const over=A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'F-1',date:'2026-10-21',lines:[{materialId:'rm2',qty:70,price:1000}]});s=ok(over)
  const m=A.invoiceMatch(s,inv(s,over.result.id))
  assert.deepEqual([m.lines[0].received,m.lines[0].invoiceable,m.lines[0].qtyOver,m.matched],[60,60,10,false])
  refused(s,A.approveSupplierInvoice(s,ctx(s),over.result.id,'Har qanday sabab'),/Qabul qilinmagan miqdor uchun invoice tasdiqlanmaydi/)
  refused(s,A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'f-1',date:'2026-10-21',lines:[{materialId:'rm2',qty:1,price:1000}]}),/allaqachon kiritilgan/)
  refused(s,A.rejectSupplierInvoice(s,ctx(s),over.result.id,'no'),/sababini/)
  s=ok(A.rejectSupplierInvoice(s,ctx(s),over.result.id,'Ortiqcha miqdor'))
  const good=A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'F-2',date:'2026-10-21',dueDate:'2026-11-05',lines:[{materialId:'rm2',qty:60,price:1000}],key:'inv-k'});s=ok(good)
  refused(s,A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'F-3',date:'2026-10-21',lines:[{materialId:'rm2',qty:1,price:1}],key:'inv-k'}),/allaqachon kiritilgan/)
  assert.equal(A.invoiceMatch(s,inv(s,good.result.id)).matched,true)
  s=ok(A.approveSupplierInvoice(s,ctx(s),good.result.id))
  assert.equal(inv(s,good.result.id).status,'Tasdiqlangan')
  assert.equal(onHand(s),stock,'an invoice never adds stock');assert.equal(P.supplierBalance(s,supplierId),debt,'a matching invoice does not post debt twice')
  assert.equal(A.purchaseInvoiceStatus(s,s.purchaseOrders.find(p=>p.id===id)),'Invoice qilingan')
  // Billing the same received goods again is an over-invoice.
  const twice=A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'F-4',date:'2026-10-21',lines:[{materialId:'rm2',qty:1,price:1000}]});s=ok(twice)
  assert.equal(A.invoiceMatch(s,inv(s,twice.result.id)).lines[0].invoiceable,0)
  refused(s,A.approveSupplierInvoice(s,ctx(s),twice.result.id),/tasdiqlanmaydi/)
})

test('a price variance is approved only as an exception with a reason and settles the debt once',()=>{
  let {s,id,supplierId}=confirmedPo(clean())
  s=ok(A.receivePurchase(s,ctx(s),id,'rm2',100))
  const v=A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'F-10',date:'2026-10-21',lines:[{materialId:'rm2',qty:40,price:1100}]});s=ok(v)
  const m=A.invoiceMatch(s,inv(s,v.result.id))
  assert.deepEqual([m.priced.length,m.variance],[1,4000])
  refused(s,A.approveSupplierInvoice(s,ctx(s),v.result.id),/istisno sababini/)
  const debt=P.supplierBalance(s,supplierId)
  s=ok(A.approveSupplierInvoice(s,ctx(s),v.result.id,'Kurs o‘zgarishi, kelishilgan'))
  assert.equal(P.supplierBalance(s,supplierId),debt+4000)
  assert.equal(s.payables.filter(e=>e.invoiceId===v.result.id&&e.kind==='adjustment').length,1)
  refused(s,A.approveSupplierInvoice(s,ctx(s),v.result.id,'yana'),/qayta tasdiqlanmaydi/)
  assert.equal(A.purchaseInvoiceStatus(s,s.purchaseOrders.find(p=>p.id===id)),'Qisman invoice','40 of 100 received are billed')
})

test('payments against an invoice: partial, full, overpayment and unapproved invoices refused; debt from the ledger only',()=>{
  let {s,id,supplierId}=confirmedPo(clean())
  s=ok(A.receivePurchase(s,ctx(s),id,'rm2',50))
  const a=A.registerSupplierInvoice(s,ctx(s),{purchaseOrderId:id,number:'F-20',date:'2026-10-21',lines:[{materialId:'rm2',qty:30,price:1000}]});s=ok(a)
  const pay=(amount,key,invoiceId=a.result.id)=>A.recordSupplierPayment(s,ctx(s),{supplierId,purchaseOrderId:id,invoiceId,amount,key,reason:'Bank'})
  refused(s,pay(10000,'p0'),/faqat tasdiqlangan/)
  s=ok(A.approveSupplierInvoice(s,ctx(s),a.result.id))
  s=ok(pay(12000,'p1'))
  assert.equal(A.invoiceOpen(s,inv(s,a.result.id)),18000)
  refused(s,pay(18001,'p2'),/qoldig‘idan oshadi \(18000/)
  const again=pay(12000,'p1');assert.equal(again.state,s,'the same payment is posted once')
  refused(s,pay(11000,'p1'),/kaliti boshqa to‘lovda ishlatilgan/)
  s=ok(pay(18000,'p3'))
  assert.equal(A.invoiceOpen(s,inv(s,a.result.id)),0)
  assert.equal(P.purchaseBalance(s,id),20000,'50 received × 1000 − 30 000 paid')
  assert.equal(P.supplierBalance(s,supplierId),s.suppliers.find(x=>x.id===supplierId).debt,'supplier debt is the ledger balance')
  refused(s,A.recordSupplierPayment(s,ctx(s),{supplierId,purchaseOrderId:id,amount:20001,key:'p4',reason:'Bank'}),/ochiq qarzdan oshadi/)
})
