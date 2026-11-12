// Phase 2/5 (2026-10-28) audit regressions: branch-strict production output (#4), sales reservation sources (#5),
// command authorization and scoped reads (#6, #7), FEFO / expiry-safe lot reservations (#10), lot-tracked transfers
// (#11) and production line validation (#12). A refused action returns the very state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import {buildSearchIndex} from '../.test-dist/searchIndex.mjs'
import {isoDate} from '../.test-dist/dates.mjs'
import {createInitialState,createSeedState} from '../.test-dist/mockData.mjs'

// Wednesday 2026-10-28 08:00 local time; dates in lots are business dates (yyyy-mm-dd).
const T0=new Date(2026,9,28,8,0)
const at=days=>new Date(2026,9,28+days,8,0)
const day=days=>isoDate(at(days))
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-ss${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given (no partial mutation)')
  return out
}
const bal=(s,item,wh)=>s.stockBalances.find(b=>b.itemId===item&&b.warehouseId===wh)
const order=(s,id)=>s.productionOrders.find(o=>o.id===id)
const lotQty=(s,item,wh)=>Math.round(s.lots.filter(l=>l.itemId===item&&l.warehouseId===wh).reduce((a,l)=>a+l.qty,0)*1000)/1000
const clean=()=>createInitialState(T0)
const seed=()=>createSeedState(T0)
const archive=(s,wh)=>({...s,warehouses:s.warehouses.map(w=>w.id===wh?{...w,status:'Arxiv'}:w)})

/** Puts lot records and a matching balance of an item into a store (`untracked` adds stock without lot records). */
function withStock(s,itemId,warehouseId,lots,untracked=0){
  const itemType=s.products.some(p=>p.id===itemId)?'finished':'raw'
  const unit=(s.products.find(p=>p.id===itemId)||s.rawMaterials.find(m=>m.id===itemId)).unit
  const rows=lots.map((l,i)=>({id:`lot-${itemId}-${warehouseId}-${l.code}`,code:l.code,kind:'lot',itemId,itemType,qty:l.qty,originalQty:l.qty,warehouseId,status:l.status||'available',
    sourceType:l.sourceType||'purchase',sourceId:l.sourceId||'po-x',sourceCode:l.sourceCode||'PO-X',createdAt:`2026-10-0${i+1} 08:00`,expiry:l.expiry,consumedBy:[]}))
  const onHand=rows.reduce((a,l)=>a+l.qty,0)+untracked
  const quarantine=rows.filter(l=>['quarantine','hold','rework'].includes(l.status)).reduce((a,l)=>a+l.qty,0)
  return {...s,lots:[...s.lots,...rows],stockBalances:[...s.stockBalances.filter(b=>!(b.itemId===itemId&&b.warehouseId===warehouseId)),{id:`st-${itemId}-${warehouseId}`,warehouseId,itemId,itemType,onHand,reserved:0,incoming:0,quarantine,unit}]}
}
/** Adds an employee (and optionally a role) to the data. */
function withPerson(s,person,role){
  return {...s,roles:role?[...s.roles,role]:s.roles,employees:[...s.employees,{...s.employees[0],...person}]}
}
const SALES_B2={id:'role-sb2',name:'Chirchiq sotuvchi',scope:'branch',description:'',permissions:{sales:{view:true,create:true,edit:true},warehouse:{view:true,edit:true},production:{view:true}}}
const branchSeller=s=>withPerson(s,{id:'em10',name:'Chirchiq sotuvchi',roleId:'role-sb2',workCenterId:'wc4'},SALES_B2)
const keeperW1=s=>withPerson(s,{id:'em11',name:'Xomashyo omborchisi',roleId:'role6',workCenterId:'wc1',warehouseId:'w1'})
const companyOwner=s=>withPerson(s,{id:'em12',name:'Biznes egasi',roleId:'role_owner'})
const em=(s,id)=>s.employees.find(e=>e.id===id)

/** A draft p3 MO (rm2 only, routing on wc2 / branch b1) in clean data with the given rm2 lots in w1. */
function p3Order(lots,quantity=10){
  let s=withStock(clean(),'rm2','w1',lots)
  const created=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity});s=ok(created)
  return {s,id:created.result.id,need:E.plannedIssue(order(s,created.result.id),'rm2')}
}

/* ------------------------------------------------------------ #4 output warehouse -- */

test('#4: an MO never outputs into another branch’s store — explicit or by fallback',()=>{
  let s=clean()
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5,lineId:'l1',warehouseId:'w4'}),/boshqa filial/)
  for(const [wh,why] of [['w1',/Raw.*tayyor mahsulot ombori emas/],['w2',/WIP.*tayyor mahsulot ombori emas/],['w-nope',/topilmadi/]])
    refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5,lineId:'l1',warehouseId:wh}),why)
  // The old resolver fell back to the first Finished/Mixed store anywhere (w4, branch b2) when b1 had none.
  s=archive(s,'w3')
  assert.equal(A.finishedWarehouseFor(s,'l1'),'')
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5}),/Toshkent zavodi filialida faol tayyor mahsulot/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5,warehouseId:'w3'}),/arxivlangan/)
})

test('#4: same-branch output works — line l3 (b2) outputs into its own Mixed store',()=>{
  const s=clean()
  const b2=A.createProductionOrder(s,ctx(s),{productId:'p2',quantity:2,lineId:'l3'})
  assert.equal(order(ok(b2),b2.result.id).warehouseId,'w4')
  const b1=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2})
  assert.equal(order(ok(b1),b1.result.id).warehouseId,'w3')
})

test('#4: a missing valid output store refuses confirmation and output atomically, before any material moves',()=>{
  let s=seed()
  const running=s.productionOrders.find(o=>o.status==='Jarayonda')
  const draft=s.productionOrders.find(o=>o.status==='Qoralama')
  const gone=archive(s,'w3')
  refused(gone,A.reportOutput(gone,ctx(gone),running.id,1,0),/arxivlangan/)
  refused(gone,A.transitionProduction(gone,ctx(gone),draft.id,'Tasdiqlangan'),/arxivlangan/)
  // Older data written by the bug: an order of line l1 (b1) aimed at w4 (b2).
  const foreign={...s,productionOrders:s.productionOrders.map(o=>o.id===running.id?{...o,warehouseId:'w4'}:o)}
  refused(foreign,A.reportOutput(foreign,ctx(foreign),running.id,1,0),/boshqa filial/)
  // The valid order still reports output into its own store; historical completed orders are untouched.
  const before=bal(s,running.productId,'w3').onHand
  const done=s.productionOrders.filter(o=>o.status==='Yakunlangan').map(o=>JSON.stringify(o))
  s=ok(A.reportOutput(s,ctx(s),running.id,1,0))
  assert.equal(bal(s,running.productId,'w3').onHand,before+1)
  assert.equal(s.stockMovements[0].warehouseId,'w3')
  assert.deepEqual(s.productionOrders.filter(o=>o.status==='Yakunlangan').map(o=>JSON.stringify(o)),done)
})

/* ---------------------------------------------------------------- #12 line -- */

test('#12: an MO line must exist, be active and run the routing’s branch',()=>{
  let s=clean()
  for(const lineId of ['nope','x-'])refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:1,lineId}),/liniyasi topilmadi/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:1,lineId:'l3'}),/routing/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:1,workCenterId:'wc4'}),/boshqa filialda/)
  const archived={...s,productionLines:s.productionLines.map(l=>l.id==='l2'?{...l,status:'Arxiv'}:l)}
  refused(archived,A.createProductionOrder(archived,ctx(archived),{productId:'p1',quantity:1,lineId:'l2'}),/arxivlangan/)
  const c=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:1});s=ok(c)
  for(const lineId of ['nope',''])refused(s,A.updateProductionOrder(s,ctx(s),c.result.id,{lineId}),/liniyasi/)
  // The old edit moved a b1 routing to line l3 and its output to w4 (branch b2).
  refused(s,A.updateProductionOrder(s,ctx(s),c.result.id,{lineId:'l3'}),/routing/)
  s=ok(A.updateProductionOrder(s,ctx(s),c.result.id,{lineId:'l2'}))
  assert.equal(order(s,c.result.id).lineId,'l2')
  assert.equal(order(s,c.result.id).warehouseId,'w3')
})

test('#12: a started MO keeps its line; a draft moves only where its routing and output store are valid',()=>{
  const s=seed()
  const running=s.productionOrders.find(o=>o.status==='Jarayonda')
  refused(s,A.updateProductionOrder(s,ctx(s),running.id,{lineId:running.lineId==='l1'?'l2':'l1'}),/Rezerv|Qoralama/)
  const draft=s.productionOrders.find(o=>o.status==='Qoralama')
  const touched={...s,timeLogs:[{id:'tl-x',orderId:draft.id,workOrderId:draft.workOrders[0]?.id,employeeId:'em2',start:'2026-10-28 07:00',minutes:5},...s.timeLogs]}
  refused(touched,A.updateProductionOrder(touched,ctx(touched),draft.id,{lineId:draft.lineId==='l1'?'l2':'l1'}),/ish boshlangan/)
  // p2 runs on wc2 (b1) and wc4 (b2): moving its draft to l3 also moves the output to b2's store …
  let c=clean()
  const p2=A.createProductionOrder(c,ctx(c),{productId:'p2',quantity:1});c=ok(p2)
  const moved=ok(A.updateProductionOrder(c,ctx(c),p2.result.id,{lineId:'l3'}))
  assert.equal(order(moved,p2.result.id).warehouseId,'w4')
  // … and is refused when b2 has no active output store.
  const noStore=archive(c,'w4')
  refused(noStore,A.updateProductionOrder(noStore,ctx(noStore),p2.result.id,{lineId:'l3'}),/Chirchiq sexi filialida faol tayyor mahsulot/)
})

/* -------------------------------------------------------- #10 FEFO and expiry -- */

test('#10: MO confirmation pins FEFO lots: earliest expiry first, expired lots never',()=>{
  const {s,id,need}=p3Order([{code:'X',qty:3,expiry:day(10)},{code:'Y',qty:3,expiry:day(5)},{code:'Z',qty:5},{code:'D',qty:10,expiry:day(-1)}])
  const next=ok(A.transitionProduction(s,ctx(s),id,'Tasdiqlangan'))
  const rows=order(next,id).reservations
  assert.equal(rows.length,1)
  assert.deepEqual(rows[0].lots,[{lot:'Y',qty:3},{lot:'X',qty:3},{lot:'Z',qty:Math.round((need-6)*1000)/1000}])
  assert.equal(bal(next,'rm2','w1').reserved,need)
})

test('#10: expired stock is not reservable (the old confirmation reserved it); a lot expiring today still is',()=>{
  const expired=p3Order([{code:'D',qty:10,expiry:day(-1)},{code:'Z',qty:2}])
  const out=A.transitionProduction(expired.s,ctx(expired.s),expired.id,'Tasdiqlangan')
  assert.equal(out.result.ok,false)
  assert.equal(order(out.state,expired.id).status,'Material kutilmoqda')
  assert.equal(bal(out.state,'rm2','w1').reserved,0)
  assert.equal(A.isExpired({expiry:day(0)},day(0)),false,'expiry day itself is usable')
  assert.equal(A.isExpired({expiry:day(-1)},day(0)),true)
  const edge=p3Order([{code:'T',qty:10,expiry:day(0)}])
  const next=ok(A.transitionProduction(edge.s,ctx(edge.s),edge.id,'Tasdiqlangan'))
  assert.deepEqual(order(next,edge.id).reservations[0].lots.map(p=>p.lot),['T'])
})

test('#10: quarantined and rejected (hold) lots are not reservable',()=>{
  const blocked=p3Order([{code:'Q',qty:10,status:'quarantine'},{code:'H',qty:10,status:'hold'},{code:'Z',qty:2}])
  const out=A.transitionProduction(blocked.s,ctx(blocked.s),blocked.id,'Tasdiqlangan')
  assert.equal(out.result.ok,false)
  assert.equal(bal(out.state,'rm2','w1').reserved,0)
  const mixed=p3Order([{code:'Q',qty:10,status:'quarantine'},{code:'Z',qty:10}])
  const next=ok(A.transitionProduction(mixed.s,ctx(mixed.s),mixed.id,'Tasdiqlangan'))
  assert.deepEqual(order(next,mixed.id).reservations[0].lots.map(p=>p.lot),['Z'])
})

test('#10: issue consumes exactly the pinned lots; a pinned lot that expired since is refused, then re-reserved explicitly',()=>{
  const {s:base,id,need}=p3Order([{code:'Y',qty:5,expiry:day(5)},{code:'X',qty:5,expiry:day(10)},{code:'Z',qty:10}])
  let s=ok(A.transitionProduction(base,ctx(base),id,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'))
  // Y's expiry is corrected to yesterday after confirmation.
  const stale={...s,lots:s.lots.map(l=>l.code==='Y'?{...l,expiry:day(-1)}:l)}
  refused(stale,A.reportOutput(stale,ctx(stale),id,10,0),/rezerv qilingan LOT Y/)
  assert.deepEqual(A.brokenReservations(stale,order(stale,id),day(0)).map(r=>r.lots),[['Y']])
  // A lot put on hold is refused the same way.
  const held={...s,lots:s.lots.map(l=>l.code==='X'?{...l,status:'hold'}:l)}
  refused(held,A.reportOutput(held,ctx(held),id,10,0),/LOT X/)
  // Validated reallocation: release and reserve again from usable lots, then issue takes only those.
  s=ok(A.refreshMaterialReservation(stale,ctx(stale),id))
  assert.deepEqual(order(s,id).reservations[0].lots.map(p=>p.lot),['X','Z'])
  assert.equal(bal(s,'rm2','w1').reserved,need)
  s=ok(A.reportOutput(s,ctx(s),id,10,0))
  const used=[...new Set(order(s,id).consumed.map(c=>c.lot))]
  assert.deepEqual(used,['X','Z'])
  assert.equal(bal(s,'rm2','w1').reserved,0)
  assert.equal(lotQty(s,'rm2','w1'),bal(s,'rm2','w1').onHand,'lots and balance still reconcile')
  // Reallocation without enough usable stock changes nothing.
  const short=p3Order([{code:'Y',qty:10,expiry:day(5)}])
  let t=ok(A.transitionProduction(short.s,ctx(short.s),short.id,'Tasdiqlangan'))
  t={...t,lots:t.lots.map(l=>l.code==='Y'?{...l,expiry:day(-1)}:l)}
  refused(t,A.refreshMaterialReservation(t,ctx(t),short.id),/yaroqli material yetarli emas/)
})

test('#10: one order never consumes another’s pinned lots; duplicate confirm and cancel release exactly',()=>{
  // Y (7) is less than one order's need (~7.47): the first order pins all of Y and a little of Z.
  let {s,id:first,need}=p3Order([{code:'Y',qty:7,expiry:day(5)},{code:'Z',qty:20}])
  const second=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:10});s=ok(second)
  s=ok(A.transitionProduction(s,ctx(s),first,'Tasdiqlangan'))
  refused(s,A.transitionProduction(s,ctx(s),first,'Tasdiqlangan'),/qoralama/)
  s=ok(A.transitionProduction(s,ctx(s),second.result.id,'Tasdiqlangan'))
  assert.deepEqual(order(s,first).reservations[0].lots.map(p=>p.lot),['Y','Z'])
  assert.deepEqual(order(s,second.result.id).reservations[0].lots.map(p=>p.lot),['Z'])
  // The second order runs first: FEFO would take Y, but Y belongs to the first order.
  s=ok(A.transitionProduction(s,ctx(s),second.result.id,'Jarayonda'))
  s=ok(A.reportOutput(s,ctx(s),second.result.id,10,0))
  assert.deepEqual([...new Set(order(s,second.result.id).consumed.map(c=>c.lot))],['Z'],'second order left Y alone')
  assert.equal(s.lots.find(l=>l.code==='Y').qty,7,'first order’s pinned lot is intact')
  const reserved=bal(s,'rm2','w1').reserved
  s=ok(A.transitionProduction(s,ctx(s),first,'Bekor qilingan'))
  assert.equal(bal(s,'rm2','w1').reserved,Math.round((reserved-need)*1000)/1000)
  assert.equal(order(s,first).reservations,undefined)
  refused(s,A.transitionProduction(s,ctx(s),first,'Bekor qilingan'),/yopilgan/)
})

/* -------------------------------------------------------------- #5 sales stock -- */

test('#5: sales never reserves from Raw, WIP, archived stores or expired stock',()=>{
  let s=withStock(clean(),'p3','w1',[{code:'R',qty:50}])
  s=withStock(s,'p3','w2',[{code:'W',qty:50}])
  s=withStock(s,'p3','w3',[{code:'OLD',qty:50,expiry:day(-1)}])
  s=archive(withStock(s,'p3','w4',[{code:'ARC',qty:50}]),'w4')
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:10}]})
  const next=ok(so)
  assert.equal(next.salesOrders[0].items[0].reserved,0)
  for(const wh of ['w1','w2','w3','w4'])assert.equal(bal(next,'p3',wh).reserved,0,wh)
  refused(next,A.deliverSalesOrder(next,ctx(next),so.result.id),/available stock yetarli emas/)
})

test('#5: sales splits over several eligible stores, never over-reserves, ships the reserved lots and cancels exactly',()=>{
  let s=withStock(clean(),'p3','w3',[{code:'A',qty:6,expiry:day(20)}])
  s=withStock(s,'p3','w4',[{code:'B',qty:10}])
  const first=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:12}]});s=ok(first)
  const line=s.salesOrders[0].items[0]
  assert.deepEqual(line.reservations,[{warehouseId:'w4',qty:10,lots:[{lot:'B',qty:10}]},{warehouseId:'w3',qty:2,lots:[{lot:'A',qty:2}]}])
  // A second order gets only what is left and does not touch the first order's lots.
  const second=A.createSalesOrder(s,ctx(s),{customerId:'cu2',mode:'Make-to-stock',lines:[{productId:'p3',qty:10}]});s=ok(second)
  assert.equal(s.salesOrders[0].items[0].reserved,4)
  assert.equal(bal(s,'p3','w3').reserved+bal(s,'p3','w4').reserved,16)
  refused(s,A.deliverSalesOrder(s,ctx(s),second.result.id,{p3:5}),/available stock yetarli emas/)
  s=ok(A.deliverSalesOrder(s,ctx(s),second.result.id,{p3:4}))
  assert.equal(s.lots.find(l=>l.code==='A').qty,2,'the first order’s 2 pinned units of A are still there')
  s=ok(A.deliverSalesOrder(s,ctx(s),first.result.id))
  const sales=s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===s.salesOrders.find(o=>o.id===first.result.id).code).map(m=>[m.warehouseId,m.lot,m.qty])
  assert.deepEqual(sales.sort(),[['w3','A',-2],['w4','B',-10]])
  for(const wh of ['w3','w4']){assert.equal(bal(s,'p3',wh).reserved,0);assert.equal(lotQty(s,'p3',wh),bal(s,'p3',wh).onHand)}
  refused(s,A.deliverSalesOrder(s,ctx(s),first.result.id),/yopilgan/)
  // Cancelling releases exactly the reservation; a second cancel is refused and changes nothing.
  let c=withStock(clean(),'p3','w3',[{code:'A',qty:6}])
  const so=A.createSalesOrder(c,ctx(c),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:4}]});c=ok(so)
  c=ok(A.cancelSalesOrder(c,ctx(c),so.result.id))
  assert.equal(bal(c,'p3','w3').reserved,0)
  assert.equal(c.lots.find(l=>l.code==='A').qty,6)
  refused(c,A.cancelSalesOrder(c,ctx(c),so.result.id),/Yopilgan/)
})

test('#5/#10: a reserved finished lot that expired is not shipped; bad quantities change nothing',()=>{
  let s=withStock(clean(),'p3','w3',[{code:'A',qty:6,expiry:day(3)}])
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:4}]});s=ok(so)
  const later=ctx(s,'em1',at(5))
  refused(s,A.deliverSalesOrder(s,later,so.result.id),/LOT A/)
  for(const qty of [-1,Infinity,NaN,1.5,5])refused(s,A.deliverSalesOrder(s,ctx(s),so.result.id,{p3:qty}))
  const c=clean()
  for(const qty of [0,-2,Infinity,NaN])refused(c,A.createSalesOrder(c,ctx(c),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty}]}))
  refused(c,A.createSalesOrder(c,ctx(c),{customerId:'cu-nope',mode:'Make-to-stock',lines:[{productId:'p3',qty:1}]}),/Mijoz/)
})

/* ---------------------------------------------------------------- #11 transfer -- */

test('#11: a lot-tracked transfer needs usable lot records; warehouse quantity alone is not enough',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'L1',qty:5}],15)
  // The old transfer moved 10: 5 from L1 and 5 "untracked".
  refused(s,A.transferStock(s,ctx(s),'rm2','w1','w2',10),/LOT bilan kuzatiladi.*mos emas/)
  s=withStock(s,'rm1','w4',[{code:'OTHER',qty:5}])
  for(const [lots,why] of [
    [[{lot:'OTHER',qty:5}],/OTHER/],
    [[{lot:'NOPE',qty:5}],/NOPE/],
    [[{lot:'L1',qty:3}],/yig‘indisi/],
    [[{lot:'L1',qty:3},{lot:'L1',qty:2}],/ikki marta/],
    [[{lot:'L1',qty:Infinity}],/LOT L1 miqdori/],
    [[{lot:'',qty:5}],/LOT tanlanmagan/],
  ])refused(s,A.transferStock(s,ctx(s),'rm2','w1','w2',5,lots),why)
  const expired=withStock(clean(),'rm2','w1',[{code:'E',qty:5,expiry:day(-1)}])
  refused(expired,A.transferStock(expired,ctx(expired),'rm2','w1','w2',5),/Available/)
  refused(expired,A.transferStock(expired,ctx(expired),'rm2','w1','w2',5,[{lot:'E',qty:5}]))
  for(const qty of [0,-1,Infinity,NaN])refused(s,A.transferStock(s,ctx(s),'rm2','w1','w2',qty))
})

test('#11: a valid lot transfer keeps origin, expiry and quantities; repeated moves reconcile without duplicates',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'P',qty:10,expiry:day(30),sourceType:'purchase',sourceId:'po-1',sourceCode:'PO-1'},{code:'Q',qty:4,expiry:day(40)}])
  s=ok(A.transferStock(s,ctx(s),'rm2','w1','w2',6))
  const copy=s.lots.filter(l=>l.code==='P'&&l.warehouseId==='w2')
  assert.equal(copy.length,1)
  assert.deepEqual([copy[0].qty,copy[0].sourceType,copy[0].sourceId,copy[0].sourceCode,copy[0].expiry],[6,'purchase','po-1','PO-1',day(30)])
  s=ok(A.transferStock(s,ctx(s),'rm2','w1','w2',2,[{lot:'Q',qty:2}]))
  s=ok(A.transferStock(s,ctx(s),'rm2','w1','w2',4))
  assert.equal(s.lots.filter(l=>l.code==='P'&&l.warehouseId==='w2').length,1,'same origin merges into one record')
  assert.equal(s.lots.find(l=>l.code==='P'&&l.warehouseId==='w2').qty,10)
  for(const wh of ['w1','w2'])assert.equal(lotQty(s,'rm2',wh),bal(s,'rm2',wh).onHand,`${wh}: lots = balance`)
  const moves=s.stockMovements.filter(m=>m.type.startsWith('Transfer'))
  assert.equal(moves.reduce((a,m)=>a+m.qty,0),0,'every − has its +')
  assert.ok(moves.every(m=>m.lot),'every move names its lot')
  // An untracked material still moves by balance.
  let u=withStock(clean(),'rm4','w1',[],20)
  u={...u,rawMaterials:u.rawMaterials.map(m=>m.id==='rm4'?{...m,lotTracking:false}:m)}
  u=ok(A.transferStock(u,ctx(u),'rm4','w1','w2',5))
  assert.equal(bal(u,'rm4','w2').onHand,5)
})

test('#11: a transfer leaves reserved lots alone',()=>{
  const {s:base,id}=p3Order([{code:'Y',qty:7,expiry:day(5)},{code:'Z',qty:4}])
  const s=ok(A.transitionProduction(base,ctx(base),id,'Tasdiqlangan'))
  // 11 on hand, ~7.47 reserved (all of Y, a little of Z): only Z's free part may move.
  refused(s,A.transferStock(s,ctx(s),'rm2','w1','w2',1,[{lot:'Y',qty:1}]),/LOT Y/)
  const moved=ok(A.transferStock(s,ctx(s),'rm2','w1','w2',2))
  assert.deepEqual(moved.lots.filter(l=>l.warehouseId==='w2').map(l=>l.code),['Z'])
})

/* --------------------------------------------------------- #6 / #7 RBAC + scope -- */

test('#6: the command gate — view never implies change, unlisted commands and anonymous calls are refused',()=>{
  const s=keeperW1(seed())
  const so=s.salesOrders.find(o=>o.items.some(i=>i.reservations?.length))
  assert.match(X.commandBlocker(s,em(s,'em4'),'reserveSalesOrder',[so.id]),/ruxsat yo‘q/,'quality views sales, may not change it')
  assert.match(X.commandBlocker(s,em(s,'em11'),'createProductionOrder',[{productId:'p1',quantity:1}]),/ruxsat yo‘q/,'keeper views production only')
  assert.match(X.commandBlocker(s,em(s,'em1'),'dropAllTables',[]),/ruxsat yo‘q/)
  assert.match(X.commandBlocker(s,undefined,'reserveSalesOrder',[so.id]),/tizimga kiring/)
  assert.equal(X.commandBlocker(s,em(s,'em1'),'reserveSalesOrder',[so.id]),null)
})

test('#6: a branch-bound seller cannot touch another branch’s sales order and reserves only in its own branch',()=>{
  let s=branchSeller(seed())
  const seller=em(s,'em10')
  const b1=s.salesOrders.find(o=>o.items.some(i=>i.reservations?.some(r=>r.warehouseId==='w3')))
  // The old scope had no targets for these, so a b2 seller could change a b1 order.
  for(const name of ['reserveSalesOrder','updateSalesMeta','cancelSalesOrder','deliverSalesOrder'])
    assert.match(X.commandBlocker(s,seller,name,[b1.id,{}])||'',/boshqa filial/,name)
  // Creation: stock comes only from b2's eligible store (w4 has no p3), never from w3.
  const created=A.createSalesOrder(s,ctx(s,'em10'),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:5}]});s=ok(created)
  const line=s.salesOrders.find(o=>o.id===created.result.id).items[0]
  assert.equal(line.reserved,0)
  s=withStock(s,'p3','w4',[{code:'B2',qty:9}])
  s=ok(A.reserveSalesOrder(s,ctx(s,'em10'),created.result.id))
  assert.deepEqual(s.salesOrders.find(o=>o.id===created.result.id).items[0].reservations,[{warehouseId:'w4',qty:5,lots:[{lot:'B2',qty:5}]}])
  // MTO from a b2 seller runs on b2's line and outputs into b2's store.
  const mto=A.createSalesOrder(s,ctx(s,'em10'),{customerId:'cu1',mode:'Make-to-order',lines:[{productId:'p2',qty:1}]});s=ok(mto)
  const mo=s.productionOrders.find(o=>o.salesOrderId===mto.result.id)
  assert.deepEqual([mo.lineId,mo.warehouseId],['l3','w4'])
  refused(s,A.createSalesOrder(s,ctx(s,'em10'),{customerId:'cu1',mode:'Make-to-order',lines:[{productId:'p1',qty:1}]}),/routing/)
})

test('#6: a warehouse-bound keeper moves, adjusts, ships and reads only its own store',()=>{
  const s=keeperW1(seed())
  const keeper=em(s,'em11')
  assert.match(X.commandBlocker(s,keeper,'transferStock',['p1','w3','w4',1])||'',/omboriga tegishli/)
  assert.match(X.commandBlocker(s,keeper,'adjustStock',['p1','w3',1,'x'])||'',/omboriga tegishli/)
  const shipped=s.salesOrders.find(o=>o.items.some(i=>i.reservations?.some(r=>r.warehouseId==='w3')))
  assert.match(X.commandBlocker(s,keeper,'deliverSalesOrder',[shipped.id])||'',/omboriga tegishli/)
  assert.equal(X.commandBlocker(s,keeper,'adjustStock',['rm1','w1',1,'x']),null)
  assert.deepEqual([...X.stockScope(s,keeper)],['w1'])
  const view=X.scopedView(s,keeper)
  assert.ok(view.stockBalances.every(b=>b.warehouseId==='w1')&&view.lots.every(l=>l.warehouseId==='w1'))
  // Even a direct domain call cannot ship from w3: the keeper's eligible sales stores are empty (w1 is Raw).
  assert.deepEqual(A.salesSources(s,keeper),[])
})

test('#7: scoped lists, global search and deep links hide another branch’s records alike; Business Owner sees all',()=>{
  let s=companyOwner(branchSeller(seed()))
  s=withStock(s,'p3','w4',[{code:'B2',qty:9}])
  const own=A.createSalesOrder(s,ctx(s,'em10'),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:2}]});s=ok(own)
  const foreign=s.salesOrders.filter(o=>X.salesOrderSites(s,o).some(w=>w!=='w4'))
  assert.ok(foreign.length,'seed has b1 sales orders')
  const view=X.scopedView(s,em(s,'em10'))
  const visible=new Set(view.salesOrders.map(o=>o.id))
  assert.ok(visible.has(own.result.id))
  for(const o of foreign)assert.ok(!visible.has(o.id),`${o.code} hidden`)
  const index=buildSearchIndex(view,()=>true)
  for(const o of foreign)assert.ok(!index.some(r=>r.title===o.code||r.path.includes(o.id)),`${o.code} not searchable`)
  for(const o of view.productionOrders)assert.ok(o.workOrders.some(w=>w.workCenterId==='wc4')||o.warehouseId==='w4')
  assert.ok(!index.some(r=>r.type==='Ishlab chiqarish buyurtmasi'&&!view.productionOrders.some(o=>r.path.endsWith(o.id))))
  const hiddenIds=new Set([...foreign.map(o=>o.id),...s.productionOrders.filter(o=>!view.productionOrders.includes(o)).map(o=>o.id)])
  assert.ok(view.notifications.every(n=>![...hiddenIds].some(id=>n.path?.endsWith(`id=${id}`))),'no message links into a hidden record')
  const hiddenCodes=new Set([...foreign,...s.productionOrders.filter(o=>!view.productionOrders.includes(o))].map(o=>o.code))
  assert.ok(view.activity.every(a=>!hiddenCodes.has(a.source)),'no log line about a hidden document')
  assert.ok(view.qualityAlerts.every(a=>!hiddenIds.has(a.sourceId)))
  assert.ok(s.activity.some(a=>hiddenCodes.has(a.source)),'the full data does have such lines')
  // Super Admin keeps everything and passes every gate.
  const boss=em(s,'em12')
  assert.equal(X.scopedView(s,boss),s)
  for(const o of foreign)assert.equal(X.commandBlocker(s,boss,'reserveSalesOrder',[o.id]),null)
  assert.equal(X.commandBlocker(s,boss,'transferStock',['p1','w3','w4',1]),null)
  assert.equal(X.stockScope(s,boss),null)
})
