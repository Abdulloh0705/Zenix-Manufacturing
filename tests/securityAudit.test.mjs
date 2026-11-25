// Security & business-logic audit (2026-11-14): direct domain calls with altered payloads, cross-branch ids, forged
// workflow fields and reused idempotency keys. Every case here was reproduced against the code before its fix
// (SEC-01 … SEC-10 in docs/BUG_REGISTRY.md). The gate is the one the app runs before each command (commandBlocker),
// and a refused domain command returns the very state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as P from '../.test-dist/platform.mjs'
import {readNumber} from '../.test-dist/validation.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,28,8,0)
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-sec${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given (no partial mutation)')
  return out
}
const FOREIGN=/boshqa filial/

/** Seed data (branch b1: w1–w3, wc1–wc3; branch b2: w4, wc4) plus a branch-b2 employee holding every business right. */
function branchB2(){
  const s=createSeedState(T0)
  const rights={view:true,create:true,edit:true,delete:true,approve:true,execute:true,export:true}
  const role={id:'role-sec-b2',name:'Chirchiq menejer',scope:'branch',description:'',permissions:Object.fromEntries(['purchases','sales','quality','equipment','costs','production','warehouse','products','materials'].map(m=>[m,rights]))}
  return {...s,roles:[...s.roles,role],employees:[...s.employees,{...s.employees[0],id:'em-b2',name:'Chirchiq menejer',roleId:role.id,workCenterId:'wc4',warehouseId:undefined,branchId:undefined,branchIds:undefined}]}
}
const b2=s=>s.employees.find(e=>e.id==='em-b2')
const gate=(s,name,args)=>X.commandBlocker(s,b2(s),name,args)
/** A role that edits but never approves equipment / quality records. */
function editor(s){
  const role={id:'role-sec-edit',name:'Tahrirchi',scope:'all',description:'',permissions:{equipment:{view:true,create:true,edit:true},quality:{view:true,create:true,edit:true}}}
  return {...s,roles:[...s.roles,role],employees:[...s.employees,{...s.employees[0],id:'em-edit',name:'Tahrirchi',roleId:role.id}]}
}
const supplierLink=s=>s.supplierMaterials.find(l=>s.suppliers.some(x=>x.id===l.supplierId))

/* ---------------------------------------------------------------- SEC-01 procurement -- */

test('SEC-01: a branch buyer cannot land a PO in the company default store (another branch) by omitting the warehouse',()=>{
  const s=branchB2(),link=supplierLink(s)
  const qty=Math.max(1,link.moq||1)*(link.unitFactor||1)
  const payload={supplierId:link.supplierId,lines:[{materialId:link.materialId,qty}],status:'Qoralama'}
  // The UI gate sees no warehouse; the domain resolves the default (w1, branch b1) and checks that store.
  refused(s,A.createPurchaseOrder(s,ctx(s,'em-b2'),payload),FOREIGN)
  refused(s,A.createPurchaseOrders(s,ctx(s,'em-b2'),[payload]),FOREIGN)
  // Its own branch store is still allowed, and an unrestricted buyer keeps the default.
  const own=ok(A.createPurchaseOrder(s,ctx(s,'em-b2'),{...payload,warehouseId:'w4'}))
  assert.equal(own.purchaseOrders[0].warehouseId,'w4')
  assert.equal(ok(A.createPurchaseOrder(s,ctx(s,'em1'),payload)).purchaseOrders[0].warehouseId,'w1')
})

test('SEC-04: supplier payments and balance corrections are bound to the branches of the supplier’s orders',()=>{
  let s=branchB2()
  const po=s.purchaseOrders.find(p=>p.warehouseId==='w1')
  s={...s,supplierInvoices:[{id:'inv-sec',purchaseOrderId:po.id,supplierId:po.supplierId,number:'INV-SEC',status:'Tasdiqlangan',lines:[],createdAt:'2026-10-27 08:00',history:[]}]}
  assert.match(gate(s,'recordSupplierPayment',[{supplierId:po.supplierId,amount:1,key:'k',invoiceId:'inv-sec',reason:'xxxxx'}])||'',FOREIGN,'paying another branch’s invoice')
  assert.match(gate(s,'recordSupplierPayment',[{supplierId:po.supplierId,amount:1,key:'k',reason:'xxxxx'}])||'',FOREIGN,'an unallocated payment reaches every order of the supplier')
  assert.match(gate(s,'adjustSupplierBalance',[{supplierId:po.supplierId,amount:1,key:'k',reason:'xxxxx'}])||'',FOREIGN)
})

/* ---------------------------------------------------------------- SEC-02 quality isolation -- */

test('SEC-02: a branch quality user cannot open, retarget or work the CAPA of an NCR on another branch’s document',()=>{
  let s=branchB2()
  const b1Po=s.purchaseOrders.find(p=>p.warehouseId==='w1'),b1Mo=s.productionOrders.find(o=>o.warehouseId==='w3')
  assert.match(gate(s,'createQualityAlert',[{title:'Ifloslangan',sourceId:b1Po.id,severity:'Past',reason:'x'}])||'',FOREIGN,'NCR on a PO of branch b1')
  assert.match(gate(s,'createQualityAlert',[{title:'Ifloslangan',sourceId:b1Mo.id,severity:'Past',reason:'x'}])||'',FOREIGN,'NCR on an MO of branch b1')
  assert.match(X.scopeBlocker(s,b2(s),'createEntity',['qualityAlerts',{title:'x',sourceId:b1Po.id}])||'',FOREIGN)
  // Own branch: a PO into w4 may carry an NCR.
  const link=supplierLink(s)
  const created=A.createPurchaseOrder(s,ctx(s,'em-b2'),{supplierId:link.supplierId,lines:[{materialId:link.materialId,qty:Math.max(1,link.moq||1)*(link.unitFactor||1)}],status:'Qoralama',warehouseId:'w4'})
  s=ok(created)
  assert.equal(gate(s,'createQualityAlert',[{title:'Ifloslangan',sourceId:created.result.id,severity:'Past',reason:'x'}]),null)
  const opened=A.createQualityAlert(s,ctx(s,'em-b2'),{title:'Ifloslangan',sourceId:created.result.id,severity:'Past',reason:'Qadoq yirtiq'})
  s=ok(opened)
  // An own NCR cannot be pointed at another branch's PO afterwards.
  assert.match(X.scopeBlocker(s,b2(s),'updateEntity',['qualityAlerts',opened.result.id,{sourceId:b1Po.id}])||'',FOREIGN)
  // CAPA on branch b1's NCR is out of reach.
  const foreign=s.qualityAlerts.find(a=>s.productionOrders.some(o=>o.id===a.sourceId&&o.warehouseId==='w3'))
  for(const [name,args] of [['addCapaAction',[foreign.id,{kind:'Tuzatuvchi',description:'Matritsa',ownerId:'em-b2',dueDate:'2026-11-30'}]],['completeCapaAction',[foreign.id,'c1','dalil yozildi']],['verifyCapaAction',[foreign.id,'c1',true,'samarali ekan']],['cancelCapaAction',[foreign.id,'c1','kerak emas']]])
    assert.match(gate(s,name,args)||'',FOREIGN,name)
})

test('SEC-02: an NCR names an existing document and a known severity; its owner is an active employee',()=>{
  const s=createSeedState(T0)
  refused(s,A.createQualityAlert(s,ctx(s),{title:'X',sourceId:'no-such-doc',severity:'Past',reason:'r'}),/manbasi/)
  refused(s,A.createQualityAlert(s,ctx(s),{title:'X',sourceId:'mo-10',severity:'Kritik!!',reason:'r'}),/darajasi/)
  refused(s,A.createQualityAlert(s,ctx(s),{title:'X',sourceId:'mo-10',severity:'Past',reason:'r',ownerId:'ghost'}),/Mas’ul/)
  ok(A.createQualityAlert(s,ctx(s),{title:'X',sourceId:'mo-10',severity:'Past',reason:'r'}))
})

/* ---------------------------------------------------------------- SEC-03 inspections -- */

test('SEC-03: a production inspection is of its MO’s product; unknown sources and subcontract scope are checked',()=>{
  const s=branchB2()
  const mo=s.productionOrders.find(o=>o.status==='Jarayonda'),other=s.products.find(p=>p.id!==mo.productId)
  refused(s,A.createQualityCheck(s,ctx(s),{sourceType:'production',sourceId:mo.id,itemId:other.id,type:'Jarayon'}),/mos emas/)
  refused(s,A.createQualityCheck(s,ctx(s),{sourceType:'production',sourceId:'mo-missing',itemId:mo.productId,type:'Jarayon'}),/topilmadi/)
  refused(s,A.createQualityCheck(s,ctx(s),{sourceType:'warehouse',sourceId:mo.id,itemId:mo.productId}),/turi/)
  refused(s,A.createQualityCheck(s,ctx(s),{sourceType:'production',sourceId:mo.id,itemId:mo.productId,type:'Audit'}),/turi/)
  ok(A.createQualityCheck(s,ctx(s),{sourceType:'production',sourceId:mo.id,itemId:mo.productId,type:'Jarayon'}))
  // A subcontract without its own store belongs to the default line's finished store (branch b1).
  const sc=s.subcontractOrders[0]
  assert.match(gate(s,'createQualityCheck',[{sourceType:'subcontract',sourceId:sc.id,itemId:sc.productId}])||'',FOREIGN)
  refused(s,A.createQualityCheck(s,ctx(s),{sourceType:'subcontract',sourceId:sc.id,itemId:other.id===sc.productId?mo.productId:other.id}),/mos emas/)
})

/* ---------------------------------------------------------------- SEC-04 receivables -- */

test('SEC-04: a branch seller cannot take payments or correct balances on another branch’s sales orders',()=>{
  const s=branchB2()
  const so=s.salesOrders.find(o=>X.salesOrderSites(s,o).includes('w3')&&o.customerId)
  assert.match(gate(s,'recordCustomerPayment',[{customerId:so.customerId,amount:1,key:'k',salesOrderId:so.id}])||'',FOREIGN)
  const owing=s.salesOrders.find(o=>X.salesOrderSites(s,o).includes('w3')&&(s.receivables||[]).some(e=>e.salesOrderId===o.id&&e.kind==='invoice'))
  if(owing)assert.match(gate(s,'recordCustomerPayment',[{customerId:owing.customerId,amount:1,key:'k'}])||'',FOREIGN,'an unallocated payment is applied to branch b1 invoices first')
  assert.match(gate(s,'adjustCustomerBalance',[{customerId:so.customerId,amount:1,key:'k',reason:'xxxxx'}])||'',FOREIGN)
  // Company-wide roles are unaffected.
  assert.equal(X.commandBlocker(s,s.employees.find(e=>e.id==='em1'),'adjustCustomerBalance',[{customerId:so.customerId,amount:1,key:'k',reason:'xxxxx'}]),null)
})

/* ---------------------------------------------------------------- SEC-05 mass assignment -- */

test('SEC-05: a generic NCR edit cannot plant verified CAPA actions, close on them, change source or use unknown states',()=>{
  let s=editor(createSeedState(T0))
  const a=s.qualityAlerts.find(x=>x.status!=='Yopilgan')
  // One real, still-open CAPA action blocks closing.
  s={...s,qualityAlerts:s.qualityAlerts.map(x=>x.id===a.id?{...x,capa:[{id:'capa-real',kind:'Tuzatuvchi',description:'Matritsani almashtirish',ownerId:'em1',dueDate:'2026-11-30',status:'Ochiq',history:[]}]}:x)}
  const forged=[{id:'capa-real',kind:'Tuzatuvchi',description:'Matritsani almashtirish',ownerId:'em1',dueDate:'2026-11-30',status:'Tasdiqlandi',verifiedBy:'em-edit',history:[]}]
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'qualityAlerts',a.id,{capa:forged,status:'Yopilgan',rootCause:'Matritsa yeyilgan'}),/CAPA/)
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'qualityAlerts',a.id,{capa:forged}),/CAPA/)
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'qualityAlerts',a.id,{sourceId:'po-6'}),/manbasi/)
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'qualityAlerts',a.id,{status:'Arxiv'}),/holati/)
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'qualityAlerts',a.id,{severity:'Juda'}),/darajasi/)
  refused(s,A.createEntity(s,ctx(s,'em-edit'),'qualityAlerts',{title:'x',sourceId:'mo-10',severity:'Past',status:'Yopilgan',reason:'r',ownerId:'em1',createdAt:''}),/Ochiq/)
  // The form's own edit still works.
  ok(A.updateEntity(s,ctx(s,'em-edit'),'qualityAlerts',a.id,{rootCause:'Matritsa yeyilgan',status:'Jarayonda'}))
})

test('SEC-05: maintenance requests, repairs and maintenance orders change state only through their own actions',()=>{
  const s=editor(createSeedState(T0))
  const editRole=s.roles.find(r=>r.id==='role-sec-edit')
  assert.equal(X.allowedBy(editRole,X.actionRules('approveMaintenanceRequest',['x'])),false,'the editor has no approve right')
  const req=s.maintenanceRequests.find(r=>r.status==='Yangi')
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'maintenanceRequests',req.id,{status:'Tasdiqlangan'}),/tasdiqlash/)
  refused(s,A.createEntity(s,ctx(s,'em-edit'),'maintenanceRequests',{code:'MR-SEC',equipmentId:'eq1',type:'Corrective',priority:'Normal',status:'Tasdiqlangan',requestedBy:'em-edit',scheduled:'',reason:'x',downtimeHours:0}),/Yangi/)
  ok(A.createEntity(s,ctx(s,'em-edit'),'maintenanceRequests',{code:'MR-SEC',equipmentId:'eq1',type:'Corrective',priority:'Normal',status:'Yangi',requestedBy:'em-edit',scheduled:'',reason:'x',downtimeHours:0}))
  const rep=s.repairOrders.find(r=>r.status!=='Yakunlangan')
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'repairOrders',rep.id,{status:'Yakunlangan'}),/Keyingi bosqich/)
  refused(s,A.createEntity(s,ctx(s,'em-edit'),'repairOrders',{code:'REP-SEC',equipmentId:'eq1',status:'Yakunlangan',issue:'x',technicianId:'em5',partsCost:0,laborHours:0,createdAt:''}),/Yangi/)
  const mo=s.maintenanceOrders.find(m=>m.status==='Rejada'||m.status==='Jarayonda')
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'maintenanceOrders',mo.id,{status:'Yakunlangan'}),/status/)
  refused(s,A.updateEntity(s,ctx(s,'em-edit'),'maintenanceOrders',mo.id,{cost:1}),/cost/)
  ok(A.updateEntity(s,ctx(s,'em-edit'),'maintenanceOrders',mo.id,{note:'Qo‘shimcha izoh'}))
})

/* ---------------------------------------------------------------- SEC-06/07 equipment and planning -- */

test('SEC-06: repairs and preventive planning stay inside the planner’s branch',()=>{
  let s=branchB2()
  const rep=s.repairOrders.find(r=>r.status!=='Yakunlangan')
  assert.match(gate(s,'advanceRepair',[rep.id])||'',FOREIGN)
  // Without a machine list the plan reaches every branch's machines; with its own (none here) it is allowed.
  assert.match(gate(s,'planPreventiveMaintenance',[14])||'',FOREIGN)
  assert.equal(gate(s,'planPreventiveMaintenance',[14,[]]),null)
  s={...s,equipment:[...s.equipment,{...s.equipment[0],id:'eq-b2',name:'Chirchiq press',serial:'SN-B2',workCenterId:'wc4'}]}
  assert.equal(gate(s,'planPreventiveMaintenance',[14,['eq-b2']]),null)
  assert.match(gate(s,'planPreventiveMaintenance',[14,['eq-b2','eq1']])||'',FOREIGN)
  // The named machines are the only ones planned.
  const all=A.planPreventiveMaintenance(s,ctx(s),60),only=A.planPreventiveMaintenance(s,ctx(s),60,['eq-b2'])
  const added=out=>out.state.maintenanceOrders.filter(m=>!s.maintenanceOrders.includes(m)).map(m=>m.equipmentId)
  assert.ok(added(all).some(id=>id!=='eq-b2'),'the unrestricted plan covers other machines')
  assert.ok(added(only).every(id=>id==='eq-b2'),'a named list plans only those machines')
})

test('SEC-07: a branch planner cannot set another branch’s forecast',()=>{
  const s=branchB2()
  assert.match(gate(s,'setForecast',['p1','2026-11-01',5,{branchId:'b1'}])||'',FOREIGN)
  assert.equal(gate(s,'setForecast',['p1','2026-11-01',5,{branchId:'b2'}]),null)
})

/* ---------------------------------------------------------------- SEC-08 idempotency -- */

test('SEC-08: a reused customer payment key replays only the same payment; anything else is refused, not “saved”',()=>{
  let s=createSeedState(T0)
  const invoice=s.receivables.find(e=>e.kind==='invoice'),cust=invoice.customerId
  const other=s.customers.find(c=>c.id!==cust)
  s=ok(A.recordCustomerPayment(s,ctx(s),{customerId:cust,amount:1,key:'SEC-K1'}))
  const replay=A.recordCustomerPayment(s,ctx(s),{customerId:cust,amount:1,key:'SEC-K1'})
  assert.equal(replay.result.ok,true);assert.equal(replay.state,s,'an identical resend writes nothing')
  refused(s,A.recordCustomerPayment(s,ctx(s),{customerId:cust,amount:2,key:'SEC-K1'}),/kaliti/)
  refused(s,A.recordCustomerPayment(s,ctx(s),{customerId:other.id,amount:1,key:'SEC-K1'}),/kaliti/)
  refused(s,A.recordCustomerPayment(s,ctx(s),{customerId:cust,amount:1,key:'SEC-K1',salesOrderId:invoice.salesOrderId}),/kaliti/)
})

/* ---------------------------------------------------------------- SEC-09/10 payload values -- */

test('SEC-09: typed order statuses accept only their known values; invoiced POs keep the derived status',()=>{
  let s=createSeedState(T0)
  const po=s.purchaseOrders[0],so=s.salesOrders.find(o=>!s.receivables.some(e=>e.salesOrderId===o.id))
  refused(s,A.updatePurchaseMeta(s,ctx(s),po.id,{invoiceStatus:'<img src=x>'}),/noto‘g‘ri/)
  ok(A.updatePurchaseMeta(s,ctx(s),po.id,{invoiceStatus:'Tekshirildi'}))
  if(so){
    refused(s,A.updateSalesMeta(s,ctx(s),so.id,{paymentStatus:'Hammasi to‘langan'}),/noto‘g‘ri/)
    ok(A.updateSalesMeta(s,ctx(s),so.id,{paymentStatus:'Qisman'}))
  }
  s={...s,supplierInvoices:[{id:'inv-sec2',purchaseOrderId:po.id,supplierId:po.supplierId,number:'INV-2',status:'Tekshirilmoqda',lines:[],createdAt:'2026-10-27 08:00',history:[]}]}
  refused(s,A.updatePurchaseMeta(s,ctx(s),po.id,{invoiceStatus:'Yo‘q'}),/invoice/i)
})

test('SEC-10: numeric text is decimal only — hex, binary and octal notations are not read as amounts',()=>{
  for(const v of ['0x10','0b11','0o7','Infinity','1_000','1,5'])assert.equal(readNumber(v),null,v)
  for(const [v,n] of [['16',16],[' 2.5 ',2.5],['-3',-3],['.5',.5],['1e3',1000],['5.',5]])assert.equal(readNumber(v),n,v)
  const s=createSeedState(T0),cust=s.receivables.find(e=>e.kind==='invoice').customerId
  refused(s,A.recordCustomerPayment(s,ctx(s),{customerId:cust,amount:'0x10',key:'hex'}),/son kiriting/)
})

/* ---------------------------------------------------------------- support ticket secrets -- */

test('support tickets refuse and hide bare JWTs and cloud / VCS access keys, not only “Bearer …” text',()=>{
  const jwt='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
  for(const secret of [jwt,'AKIAIOSFODNN7EXAMPLE','ghp_1234567890abcdefghijABCDEFGHIJ'])
  {
    assert.match(P.ticketTextProblem(`Kirishda xato: ${secret}`)||'',/maxfiy/,secret)
    assert.equal(P.safeText(`log: ${secret}`),P.REDACTED_TEXT,secret)
  }
  assert.equal(P.ticketTextProblem('Hisobot eksporti 3 daqiqa davom etdi'),null,'ordinary text is accepted')
})
