// Inventory completion (2026-11-12): two-step transfers (dispatch → in transit → partial / full receipt or return)
// and stocktaking sessions (count → compare → approve as adjustments). A refused command returns the state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as I from '../.test-dist/inventory.mjs'
import * as SN from '../.test-dist/serials.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'
import {clearTransactions} from '../.test-dist/reset.mjs'

const T0=new Date(2026,9,21,8,0)
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-ic${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const clean=()=>{const s=createInitialState(T0);return {...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:false,autoQualityChecks:false}}}}
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
function withStock(s,key,warehouseId,lots,kind='lot'){
  const product=s.products.find(p=>p.id===key)
  const itemType=product?'finished':'raw'
  const unit=(product||s.rawMaterials.find(m=>m.id===key)).unit
  const rows=lots.map((l,i)=>({id:`lot-${key}-${warehouseId}-${l.code}`,code:l.code,kind,itemId:key,itemType,qty:l.qty,originalQty:l.qty,warehouseId,status:l.status||'available',
    sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:`2026-10-0${i+1} 08:00`,consumedBy:[],...(l.expiry?{expiry:l.expiry}:{}),...(kind==='serial'?{serialFrom:l.code,serialTo:l.code}:{})}))
  const old=bal(s,key,warehouseId)
  return {...s,lots:[...s.lots,...rows],stockBalances:[...s.stockBalances.filter(b=>b!==old),
    {id:`st-${key}-${warehouseId}`,warehouseId,itemId:key,itemType,onHand:(old?.onHand||0)+rows.reduce((a,l)=>a+l.qty,0),reserved:old?.reserved||0,incoming:0,quarantine:0,unit}]}
}
const lotsAt=(s,key,wh)=>s.lots.filter(l=>I.keyOf(l)===key&&l.warehouseId===wh&&l.qty>0).map(l=>`${l.code}:${l.qty}`).sort()
const transfer=(s,id)=>(s.stockTransfers||[]).find(t=>t.id===id)

function auditedTransferFixture(){
  const base=clean(),source=base.stockBalances.find(b=>b.itemId==='rm2'&&b.warehouseId==='w1')
  const keeper=(id,roleId,warehouseId,branchId)=>({id,name:id,roleId,department:'Warehouse',workCenterId:'',warehouseId,branchId,shift:'A',status:'Faol',attendance:100,efficiency:100,hourlyCost:0})
  return {...base,
    roles:[...base.roles,{id:'transfer-branch',name:'Branch warehouse editor',scope:'branch',permissions:{warehouse:{view:true,edit:true}},rank:1}],
    employees:[...base.employees,keeper('transfer-b1','transfer-branch',undefined,'b1'),keeper('transfer-w1','role6','w1','b1'),keeper('transfer-w2','role6','w2','b1'),keeper('transfer-b2','transfer-branch',undefined,'b2')],
    lots:[...base.lots.filter(l=>!(l.itemId==='rm2'&&l.warehouseId==='w1')),{id:'transfer-lot',code:'TR-LOT-1',kind:'lot',itemId:'rm2',itemType:'raw',qty:10,originalQty:10,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po-transfer',sourceCode:'PO-TRANSFER',unitCost:123,createdAt:'2026-10-01 08:00',consumedBy:[]}],
    stockBalances:[...base.stockBalances.filter(b=>b!==source),{id:'transfer-balance',warehouseId:'w1',itemId:'rm2',itemType:'raw',onHand:10,reserved:0,incoming:0,quarantine:0,unit:'kg'}],
  }
}

test('P4 final: dispatch reason, actors, route branches, LOT cost, receipt and return form a complete audit',()=>{
  let s=auditedTransferFixture()
  const out=A.dispatchTransfer(s,ctx(s,'transfer-b1'),{itemId:'rm2',from:'w1',to:'w2',qty:10,reason:'Ish markazi uchun zaxira',key:'audit-dispatch'});s=ok(out)
  const id=out.result.id,t=transfer(s,id)
  assert.deepEqual([t.createdBy,t.from,t.to,t.fromBranchId,t.toBranchId,t.reason,t.mode,t.status],['transfer-b1','w1','w2','b1','b1','Ish markazi uchun zaxira','two-step','Yo‘lda'])
  assert.equal(bal(s,'rm2','w1').onHand,0)
  assert.equal(bal(s,'rm2','w2').incoming,10)
  assert.equal(t.lines[0].record.unitCost,123)
  assert.ok(s.stockMovements.some(m=>m.source===t.ref&&m.note.includes(t.reason)))
  assert.ok(s.activity.some(a=>a.source===t.ref&&a.detail?.includes(t.reason)))
  const repeated=A.dispatchTransfer(s,ctx(s,'transfer-b1'),{itemId:'rm2',from:'w1',to:'w2',qty:10,reason:t.reason,key:'audit-dispatch'})
  refused(s,repeated,/allaqachon/)
  s=ok(A.receiveTransfer(s,ctx(s,'transfer-w2'),id,{qty:4,key:'audit-receipt'}))
  assert.deepEqual([bal(s,'rm2','w2').onHand,bal(s,'rm2','w2').incoming],[4,6])
  assert.equal(s.lots.find(l=>l.code==='TR-LOT-1'&&l.warehouseId==='w2').unitCost,123)
  assert.equal(transfer(s,id).receipts[0].by,'transfer-w2')
  const again=A.receiveTransfer(s,ctx(s,'transfer-w2'),id,{qty:4,key:'audit-receipt'})
  assert.equal(again.result.ok,true);assert.equal(again.state,s,'duplicate receipt changes nothing')
  s=ok(A.returnTransfer(s,ctx(s,'transfer-b1'),id,'Yetkazish bekor qilindi'))
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w2').onHand,bal(s,'rm2','w2').incoming],[6,4,0])
  assert.deepEqual([transfer(s,id).status,transfer(s,id).receipts[1].by,transfer(s,id).receipts[1].note],['Yopildi','transfer-b1','Yetkazish bekor qilindi'])
  assert.equal(s.lots.filter(l=>l.code==='TR-LOT-1'&&l.warehouseId==='w1').reduce((n,l)=>n+l.qty,0),6)
})

test('P4 final: transfer validation and both-end permissions refuse without touching stock or history',()=>{
  const s=auditedTransferFixture()
  const request=(actor,from,to,qty,reason='Ishlab chiqarish uchun ko‘chirish')=>A.dispatchTransfer(s,ctx(s,actor),{itemId:'rm2',from,to,qty,reason,key:`denied-${actor}-${from}-${to}`})
  refused(s,request('transfer-b1','w1','w2',11),/Available qoldiq/)
  refused(s,request('transfer-b1','w1','w1',1),/bir xil/)
  refused(s,request('transfer-b1','w1','w2',1,''),/sabab/)
  refused(s,request('transfer-w2','w1','w2',1),/omboriga tegishli/)
  refused(s,request('transfer-w1','w1','w2',1),/omboriga tegishli/)
  refused(s,request('transfer-b1','w1','w4',1),/boshqa filialga/)
  refused(s,request('transfer-b2','w1','w4',1),/boshqa filialga/)
  refused(s,request('em4','w1','w2',1),/ruxsat yo‘q/)
  refused(s,A.transferStock(s,ctx(s),'rm2','w1','w2',1,undefined,{reason:'',key:'missing-reason'}),/sabab/)
  const foreign=A.transferStock(s,ctx(s,'transfer-b1'),'rm2','w1','w4',1,undefined,{reason:'Boshqa filialga jo‘natish',key:'cross-branch'})
  refused(s,foreign,/boshqa filialga/)
  const owner=A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:1,reason:'Filiallar orasida ruxsatli jo‘natish',key:'owner-cross-branch'})
  assert.equal(owner.result.ok,true,'the existing all-scope Admin rule permits a cross-branch dispatch')
  assert.deepEqual([owner.state.stockTransfers[0].fromBranchId,owner.state.stockTransfers[0].toBranchId],['b1','b2'])
})

test('P4 final: immediate transfer has immutable reason and actor history, and a duplicate key cannot move stock',()=>{
  let s=auditedTransferFixture()
  const opts={reason:'Ish markaziga zaxira yuborish',key:'immediate-one'}
  const out=A.transferStock(s,ctx(s,'transfer-b1'),'rm2','w1','w2',3,[{lot:'TR-LOT-1',qty:3}],opts);s=ok(out)
  const t=s.stockTransfers[0]
  assert.deepEqual([t.mode,t.status,t.createdBy,t.receipts[0].by,t.reason,t.fromBranchId,t.toBranchId],['immediate','Qabul qilindi','transfer-b1','transfer-b1',opts.reason,'b1','b1'])
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w2').onHand],[7,3])
  assert.equal(s.lots.find(l=>l.code==='TR-LOT-1'&&l.warehouseId==='w2').unitCost,123)
  refused(s,A.transferStock(s,ctx(s,'transfer-b1'),'rm2','w1','w2',3,[{lot:'TR-LOT-1',qty:3}],opts),/allaqachon/)
  assert.equal(s.stockMovements.filter(m=>m.source===t.ref).length,2)
})

test('dispatch takes stock out of the source; in transit it is incoming in the target, never available anywhere',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'ST-A',qty:60},{code:'ST-B',qty:40}])
  const out=A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:70,key:'k1',reason:'Zaxirani omborlar o‘rtasida ko‘chirish'});s=ok(out)
  const t=transfer(s,out.result.id)
  assert.equal(t.status,'Yo‘lda');assert.equal(A.transferOpen(t),70)
  assert.deepEqual(t.lines.map(l=>[l.lot,l.qty]),[['ST-A',60],['ST-B',10]],'FEFO lots, with their provenance kept')
  assert.equal(t.lines[0].record.sourceCode,'PO-X')
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w4').onHand,bal(s,'rm2','w4').incoming],[30,0,70])
  assert.equal(E.stockOf(s,'rm2').available,30,'in-transit stock is not available')
  assert.equal(E.stockOf(s,'rm2').incoming,70,'MRP sees it as incoming supply')
  assert.deepEqual(lotsAt(s,'rm2','w4'),[],'no lot record exists in the target before receipt')
  assert.equal(s.stockMovements.filter(m=>m.source===t.ref&&m.type==='Transfer +').length,0)
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:5,key:'k1'}),/allaqachon jo‘natilgan/)
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:31}),/Available qoldiq yetarli emas \(30/)
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w3',qty:5}),/saqlamaydi/)
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w1',qty:5}),/bir xil/)
})

test('a transfer refuses one LOT code with conflicting receipt provenance instead of rewriting its origin',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'ST-A',qty:1},{code:'ST-B',qty:1}])
  s={...s,lots:s.lots.map(l=>l.id==='lot-rm2-w1-ST-B'?{...l,code:'ST-A',sourceId:'PO-B',sourceCode:'PO-B'}:l)}
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:2}),/kelib chiqishi har xil/)
  refused(s,A.transferStock(s,ctx(s),'rm2','w1','w4',2),/kelib chiqishi har xil/)
  assert.equal(bal(s,'rm2','w1').onHand,2)
})

test('partial then full receipt: lots land with their origin; over-receipt and a repeated receipt are refused',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'ST-A',qty:60},{code:'ST-B',qty:40}])
  const out=A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:70,reason:'Zaxirani omborlar o‘rtasida ko‘chirish'});s=ok(out)
  const id=out.result.id
  refused(s,A.receiveTransfer(s,ctx(s),id,{qty:71}),/yo‘lda 70/)
  refused(s,A.receiveTransfer(s,ctx(s),id,{qty:10,lots:[{lot:'ST-B',qty:11}]}),/ST-B/)
  s=ok(A.receiveTransfer(s,ctx(s),id,{qty:25,key:'r1'}))
  let t=transfer(s,id)
  assert.equal(t.status,'Qisman qabul qilindi');assert.equal(A.transferOpen(t),45)
  assert.deepEqual([bal(s,'rm2','w4').onHand,bal(s,'rm2','w4').incoming],[25,45])
  assert.deepEqual(lotsAt(s,'rm2','w4'),['ST-A:25'])
  assert.equal(s.lots.find(l=>l.warehouseId==='w4'&&l.code==='ST-A').sourceCode,'PO-X','origin kept')
  const again=A.receiveTransfer(s,ctx(s),id,{qty:25,key:'r1'})
  assert.equal(again.result.ok,true);assert.equal(again.state,s,'the same receipt is booked once (no double receipt)')
  refused(s,A.receiveTransfer(s,ctx(s),id,{qty:26,key:'r1'}),/Qabul kaliti boshqa miqdor/)
  s=ok(A.receiveTransfer(s,ctx(s),id,{qty:45,lots:[{lot:'ST-A',qty:35},{lot:'ST-B',qty:10}],toLocation:'MIX-01'}))
  t=transfer(s,id)
  assert.equal(t.status,'Qabul qilindi');assert.equal(A.transferOpen(t),0)
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w4').onHand,bal(s,'rm2','w4').incoming],[30,70,0])
  assert.equal(bal(s,'rm2','w4').bins['MIX-01'],45)
  const moves=s.stockMovements.filter(m=>m.source===t.ref)
  assert.equal(moves.filter(m=>m.type==='Transfer -').reduce((a,m)=>a+m.qty,0),-70)
  assert.equal(moves.filter(m=>m.type==='Transfer +').reduce((a,m)=>a+m.qty,0),70,'transfer-out equals transfer-in')
  refused(s,A.receiveTransfer(s,ctx(s),id,{qty:1}),/yopilgan/)
  assert.equal(E.stockOf(s,'rm2').onHand,100,'company total unchanged: no double deduction or receipt')
})

test('the rest of a transfer goes back to the source with its lots; reason required; target incoming released',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'ST-A',qty:50}])
  const out=A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:50,fromLocation:'',reason:'Zaxirani omborlar o‘rtasida ko‘chirish'});s=ok(out)
  const id=out.result.id
  s=ok(A.receiveTransfer(s,ctx(s),id,{qty:20}))
  refused(s,A.returnTransfer(s,ctx(s),id,'yo'),/sabab/)
  s=ok(A.returnTransfer(s,ctx(s),id,'Shikastlangan, qayta jo‘natiladi'))
  const t=transfer(s,id)
  assert.equal(t.status,'Yopildi');assert.equal(t.lines[0].returned,30)
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w4').onHand,bal(s,'rm2','w4').incoming],[30,20,0])
  assert.deepEqual(lotsAt(s,'rm2','w1'),['ST-A:30'])
  assert.deepEqual(t.receipts.map(r=>[r.kind,r.qty]),[['receipt',20],['return',30]],'history of the transfer')
  refused(s,A.returnTransfer(s,ctx(s),id,'yana bir marta'),/yopilgan/)
})

test('a serial unit in transit is neither in stock nor sold; it arrives as the same unit',()=>{
  let s=withStock(clean(),'p2','w3',[{code:'SN-T1',qty:1},{code:'SN-T2',qty:1}],'serial')
  const out=A.dispatchTransfer(s,ctx(s),{itemId:'p2',from:'w3',to:'w4',qty:1,lots:[{lot:'SN-T2',qty:1}],reason:'Seriyali mahsulotni boshqa omborga ko‘chirish'});s=ok(out)
  let st=SN.serialStatus(s,'SN-T2')
  assert.equal(st.status,'in-transit');assert.equal(st.record,undefined)
  assert.match(SN.serialConflict(s,'p2','SN-T2'),/chiqib ketgan|omborda/,'the number cannot be registered again while in transit')
  s=ok(A.receiveTransfer(s,ctx(s),out.result.id,{qty:1}))
  st=SN.serialStatus(s,'SN-T2')
  assert.deepEqual([st.status,st.warehouseId,st.record.qty,st.record.kind],['available','w4',1,'serial'])
  assert.equal(SN.serialIssues(s).problems.length,0)
})

test('expired, QC-held and reserved stock cannot be dispatched',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'OLD',qty:10,expiry:'2026-01-01'},{code:'HOLD',qty:10,status:'hold'},{code:'OK',qty:5}])
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:3,lots:[{lot:'OLD',qty:3}]}),/LOT OLD/)
  refused(s,A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:3,lots:[{lot:'HOLD',qty:3}]}),/LOT HOLD/)
  s=ok(A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:5,reason:'Yaroqli LOT zaxirasini ko‘chirish'}))
  assert.deepEqual(s.stockTransfers[0].lines.map(l=>l.lot),['OK'],'only usable lots move')
})

test('stocktaking: open, count, compare, approve as adjustments; moved stock and a second open session are refused',()=>{
  let s=withStock(withStock(clean(),'rm2','w1',[{code:'ST-A',qty:50}]),'rm4','w1',[{code:'HW-1',qty:100}])
  const open=A.createStockCount(s,ctx(s),{warehouseId:'w1',note:'Oylik'});s=ok(open)
  const id=open.result.id,count=()=>s.stockCounts.find(c=>c.id===id)
  assert.equal(count().status,'Ochiq');assert.ok(count().lines.length>=2)
  refused(s,A.createStockCount(s,ctx(s),{warehouseId:'w1'}),/ochiq/)
  refused(s,A.approveStockCount(s,ctx(s),id,'Oylik sanoq'),/sanalmagan/)
  const line=k=>count().lines.find(l=>l.itemKey===k)
  s=ok(A.recordStockCount(s,ctx(s),id,line('rm2').balanceId,47))
  s=ok(A.recordStockCount(s,ctx(s),id,line('rm4').balanceId,100))
  refused(s,A.recordStockCount(s,ctx(s),id,line('rm4').balanceId,-1),/Sanalgan/)
  assert.equal(A.countDelta(line('rm2')),-3);assert.equal(A.countDelta(line('rm4')),0)
  // Stock moves after the count: approval stops until that line is counted again.
  const moved=ok(A.adjustStock(s,ctx(s),'rm2','w1',5,'Topildi'))
  refused(moved,A.approveStockCount(moved,ctx(moved),id,'Oylik sanoq'),/qayta sanang/)
  refused(s,A.approveStockCount(s,ctx(s),id,'ok'),/izoh/)
  s=ok(A.approveStockCount(s,ctx(s),id,'Oylik sanoq'))
  assert.equal(count().status,'Tasdiqlangan');assert.equal(count().adjustments.length,1)
  assert.equal(bal(s,'rm2','w1').onHand,47);assert.deepEqual(lotsAt(s,'rm2','w1'),['ST-A:47'],'lot records follow the adjustment')
  assert.equal(bal(s,'rm4','w1').onHand,100,'a line without difference is not adjusted')
  const adj=s.stockMovements.filter(m=>m.source===count().adjustments[0])
  assert.deepEqual(adj.map(m=>[m.type,m.qty]),[['Adjustment -',-3]]);assert.match(adj[0].note,/INV-.*inventarizatsiya · Oylik sanoq/)
  refused(s,A.approveStockCount(s,ctx(s),id,'Ikkinchi marta'),/allaqachon/)
  refused(s,A.recordStockCount(s,ctx(s),id,line('rm2').balanceId,40),/yopilgan/)
})

test('stocktaking approval is all or nothing and keeps reserved stock; a cancelled session changes nothing',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'ST-A',qty:50}])
  s={...s,stockBalances:s.stockBalances.map(b=>I.keyOf(b)==='rm2'&&b.warehouseId==='w1'?{...b,reserved:40}:b)}
  const open=A.createStockCount(s,ctx(s),{warehouseId:'w1'});s=ok(open)
  const id=open.result.id,b=s.stockCounts[0].lines.find(l=>l.itemKey==='rm2').balanceId
  s=ok(A.recordStockCount(s,ctx(s),id,b,30))
  refused(s,A.approveStockCount(s,ctx(s),id,'Oylik sanoq'),/rezerv.*tasdiqlanmadi/)
  s=ok(A.cancelStockCount(s,ctx(s),id,'Qayta sanaymiz'))
  assert.equal(s.stockCounts[0].status,'Bekor qilingan');assert.equal(bal(s,'rm2','w1').onHand,50)
  s=ok(A.createStockCount(s,ctx(s),{warehouseId:'w1'}),'a new session can open after cancel')
})

test('transfers and counts are transactions: a reset clears them',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'ST-A',qty:10}])
  s=ok(A.dispatchTransfer(s,ctx(s),{itemId:'rm2',from:'w1',to:'w4',qty:5,reason:'Zaxirani omborlar o‘rtasida ko‘chirish'}))
  s=ok(A.createStockCount(s,ctx(s),{warehouseId:'w1'}))
  const cleared=clearTransactions(s)
  assert.deepEqual([cleared.stockTransfers,cleared.stockCounts],[[],[]])
})
