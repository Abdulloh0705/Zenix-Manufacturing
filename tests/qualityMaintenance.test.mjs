// Quality & Maintenance completion (2026-11-12): CAPA actions with evidence and independent verification (an NCR
// closes only when they are verified), overdue CAPA, maintenance request rejection, and spare parts issued from /
// returned to stock with their cost counted once. A refused command returns the very state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as I from '../.test-dist/inventory.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-qm${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const clean=()=>createInitialState(T0)
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
function withStock(s,key,warehouseId,qty,code){
  const m=s.rawMaterials.find(x=>x.id===key)
  return {...s,lots:[...s.lots,{id:`lot-${code}`,code,kind:'lot',itemId:key,itemType:'raw',qty,originalQty:qty,warehouseId,status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-10-01 08:00',consumedBy:[]}],
    stockBalances:[...s.stockBalances.filter(b=>!(I.keyOf(b)===key&&b.warehouseId===warehouseId)),{id:`st-${key}-${warehouseId}`,warehouseId,key,itemId:key,itemType:'raw',onHand:qty,reserved:0,incoming:0,quarantine:0,unit:m.unit}]}
}
function ncr(s){
  // An NCR names a real document (SEC-02): a draft MO stands in for the inspected order.
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:5});s=ok(mo)
  const out=A.createQualityAlert(s,ctx(s),{title:'Teshik diametri katta',sourceId:mo.result.id,severity:'Yuqori',reason:'Final QC: 3 ta birlikda 7.1 mm',ownerId:'em1'});s=ok(out)
  return {s,id:out.result.id||s.qualityAlerts[0].id}
}
const alert=(s,id)=>s.qualityAlerts.find(a=>a.id===id)
const close=(s,id,user='em1')=>A.updateEntity(s,ctx(s,user),'qualityAlerts',id,{status:'Yopilgan',rootCause:'Matritsa yeyilgan'})

test('CAPA: action needs owner, deadline and evidence; verified by someone else; NCR closes only when verified',()=>{
  let {s,id}=ncr(clean())
  refused(s,A.addCapaAction(s,ctx(s),id,{kind:'Tuzatuvchi',description:'abc',ownerId:'em1',dueDate:'2026-10-25'}),/tavsif/)
  refused(s,A.addCapaAction(s,ctx(s),id,{kind:'Tuzatuvchi',description:'Matritsani almashtirish',ownerId:'nobody',dueDate:'2026-10-25'}),/Mas’ul/)
  refused(s,A.addCapaAction(s,ctx(s),id,{kind:'Tuzatuvchi',description:'Matritsani almashtirish',ownerId:'em1',dueDate:'2026-10-01'}),/o‘tgan/)
  const c=A.addCapaAction(s,ctx(s),id,{kind:'Tuzatuvchi',description:'Matritsani almashtirish',ownerId:'em1',dueDate:'2026-10-25'});s=ok(c)
  const p=A.addCapaAction(s,ctx(s),id,{kind:'Oldini oluvchi',description:'Matritsa yeyilishini haftalik o‘lchash',ownerId:'em4',dueDate:'2026-10-30'});s=ok(p)
  assert.equal(alert(s,id).status,'Jarayonda','an NCR with actions is in progress')
  refused(s,close(s,id),/CAPA amallari tasdiqlanishi kerak \(2 ta/)
  refused(s,A.completeCapaAction(s,ctx(s),id,c.result.id,''),/dalil/)
  refused(s,A.verifyCapaAction(s,ctx(s,'em4'),id,c.result.id,true,'Tekshirildi'),/Faqat bajarilgan/)
  s=ok(A.completeCapaAction(s,ctx(s),id,c.result.id,'Matritsa M-14 o‘rnatildi, akt №55'))
  refused(s,A.completeCapaAction(s,ctx(s),id,c.result.id,'Yana bir marta'),/qayta bajarilmaydi/)
  refused(s,A.verifyCapaAction(s,ctx(s),id,c.result.id,true,'O‘zim tekshirdim'),/boshqa xodim/)
  // Not effective: back to open with the finding.
  s=ok(A.verifyCapaAction(s,ctx(s,'em4'),id,c.result.id,false,'10 ta namunadan 2 tasida hali katta'))
  assert.equal(alert(s,id).capa.find(x=>x.id===c.result.id).status,'Ochiq')
  s=ok(A.completeCapaAction(s,ctx(s),id,c.result.id,'Matritsa qayta sozlandi, o‘lchov 6.5 mm'))
  s=ok(A.verifyCapaAction(s,ctx(s,'em4'),id,c.result.id,true,'30 namuna normada'))
  refused(s,close(s,id),/1 ta: bajarilmagan/)
  s=ok(A.cancelCapaAction(s,ctx(s),id,p.result.id,'Matritsa turi almashtirildi, kerak emas'))
  s=ok(close(s,id))
  assert.equal(alert(s,id).status,'Yopilgan')
  assert.deepEqual(alert(s,id).capa.find(x=>x.id===c.result.id).history.map(h=>h.action),['Yaratildi','Bajarildi','Samarasiz — qayta ochildi','Bajarildi','Samarali deb tasdiqlandi'])
  refused(s,A.addCapaAction(s,ctx(s),id,{kind:'Tuzatuvchi',description:'Yana bir amal',ownerId:'em1',dueDate:'2026-10-25'}),/Yopilgan/)
})

test('overdue CAPA actions are listed until verified; an NCR without CAPA still closes with a root cause',()=>{
  let {s,id}=ncr(clean())
  const c=A.addCapaAction(s,ctx(s),id,{kind:'Tuzatuvchi',description:'Operatorni qayta o‘qitish',ownerId:'em1',dueDate:'2026-10-22'});s=ok(c)
  assert.equal(A.capaOverdue(s,'2026-10-22').length,0,'due today is not overdue')
  assert.equal(A.capaOverdue(s,'2026-10-23').length,1)
  s=ok(A.completeCapaAction(s,ctx(s),id,c.result.id,'O‘qitish o‘tkazildi, imzo varag‘i'))
  assert.equal(A.capaOverdue(s,'2026-10-23').length,1,'done but not verified still counts')
  s=ok(A.verifyCapaAction(s,ctx(s,'em4'),id,c.result.id,true,'Ish joyida kuzatildi'))
  assert.equal(A.capaOverdue(s,'2026-10-23').length,0)
  const plain=ncr(clean())
  ok(close(plain.s,plain.id),'legacy NCR without CAPA: ')
})

const request=(s,id='mr-1')=>({...s,maintenanceRequests:[{id,code:'MR-1',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:TODAY,reason:'Gidravlika moyi oqmoqda',downtimeHours:2},...s.maintenanceRequests]})

test('a maintenance request is rejected only with a reason and only while new',()=>{
  let s=request(clean())
  refused(s,A.rejectMaintenanceRequest(s,ctx(s),'mr-1','yo'),/sababini/)
  s=ok(A.rejectMaintenanceRequest(s,ctx(s),'mr-1','Takroriy so‘rov, MA-03 da bor'))
  const r=s.maintenanceRequests.find(x=>x.id==='mr-1')
  assert.deepEqual([r.status,r.decisionNote],['Rad etilgan','Takroriy so‘rov, MA-03 da bor'])
  refused(s,A.approveMaintenanceRequest(s,ctx(s),'mr-1'),/Faqat yangi/)
  refused(s,A.rejectMaintenanceRequest(s,ctx(s),'mr-1','Yana bir marta'),/Faqat yangi/)
})

test('spare parts: issued from free stock once, returned once, cancel blocked while issued, cost counted once at completion',()=>{
  let s=withStock(request(clean()),'rm4','w1',100,'HW-1')
  const approved=A.approveMaintenanceRequest(s,ctx(s),'mr-1');s=ok(approved)
  const id=approved.result.id,mo=()=>s.maintenanceOrders.find(m=>m.id===id)
  const unitCost=s.rawMaterials.find(m=>m.id==='rm4').standardCost
  refused(s,A.issueMaintenancePart(s,ctx(s),id,{materialId:'rm4',warehouseId:'w1',qty:101,key:'k0'}),/bo‘sh qoldiq 100/)
  refused(s,A.issueMaintenancePart(s,ctx(s),id,{materialId:'rm4',warehouseId:'w1',qty:-1,key:'k0'}),/miqdor/)
  s=ok(A.issueMaintenancePart(s,ctx(s),id,{materialId:'rm4',warehouseId:'w1',qty:12,key:'k1'}))
  const again=A.issueMaintenancePart(s,ctx(s),id,{materialId:'rm4',warehouseId:'w1',qty:12,key:'k1'})
  assert.equal(again.state,s,'the same issue is booked once')
  assert.equal(bal(s,'rm4','w1').onHand,88)
  assert.deepEqual(s.stockMovements.filter(m=>m.source===mo().code).map(m=>[m.type,m.qty,m.lot]),[['Maintenance Issue -',-12,'HW-1']])
  refused(s,A.cancelMaintenance(s,ctx(s),id,'Kerak emas'),/qaytarilsin/)
  const part=mo().parts[0]
  refused(s,A.returnMaintenancePart(s,ctx(s),id,part.id,13,'r1'),/oshmasin/)
  s=ok(A.returnMaintenancePart(s,ctx(s),id,part.id,2,'r1'))
  assert.equal(A.returnMaintenancePart(s,ctx(s),id,part.id,2,'r1').state,s,'the same return is booked once')
  assert.equal(bal(s,'rm4','w1').onHand,90)
  assert.equal(A.maintenancePartsCost(mo()),10*unitCost)
  s=ok(A.startMaintenance(s,ctx(s),id))
  const costBefore=s.equipment.find(e=>e.id==='eq1').maintenanceCost
  s=ok(A.completeMaintenance(s,ctx(s),id,150000,'Muhr almashtirildi'))
  const expense=s.expenses.find(e=>e.note.includes(mo().code))
  assert.equal(expense.amount,150000+10*unitCost,'labour + parts in one expense')
  assert.equal(s.equipment.find(e=>e.id==='eq1').maintenanceCost-costBefore,150000+10*unitCost)
  refused(s,A.completeMaintenance(s,ctx(s),id,1,'yana'),/avval boshlanishi/)
  refused(s,A.returnMaintenancePart(s,ctx(s),id,part.id,1,'r2'),/yopilgan/)
  assert.equal(s.expenses.filter(e=>e.note.includes(mo().code)).length,1,'no second expense')
})

test('QC-held and lot-less stock is not issued as a spare part',()=>{
  let s=withStock(request(clean()),'rm4','w1',10,'HW-Q')
  s={...s,lots:s.lots.map(l=>l.code==='HW-Q'?{...l,status:'quarantine'}:l),stockBalances:s.stockBalances.map(b=>b.itemId==='rm4'&&b.warehouseId==='w1'?{...b,quarantine:10}:b)}
  const approved=A.approveMaintenanceRequest(s,ctx(s),'mr-1');s=ok(approved)
  refused(s,A.issueMaintenancePart(s,ctx(s),approved.result.id,{materialId:'rm4',warehouseId:'w1',qty:1,key:'q1'}),/bo‘sh qoldiq 0/)
})
