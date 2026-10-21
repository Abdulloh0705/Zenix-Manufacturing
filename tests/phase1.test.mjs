// Phase 1 regression tests: stock integrity of the production, sales and return lifecycles, role scope on reads and
// writes, BOM snapshots, split / merge / backorder / unbuild provenance and the boundary inputs of each action.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import {findTraceOrder,buildTraceability,perUnit,remainingQty,stockOf} from '../.test-dist/manufacturingEngine.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'

let counter=0
const fresh=()=>createSeedState(new Date())
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p1t${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,'expected the action to be refused')
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const orderOf=(s,id)=>s.productionOrders.find(o=>o.id===id)
const bal=(s,itemId,wh)=>s.stockBalances.find(b=>b.itemId===itemId&&b.warehouseId===wh)||{onHand:0,reserved:0,quarantine:0}
const ledger=s=>JSON.stringify([s.stockBalances,s.stockMovements,s.lots])

function created(s,productId='p1',quantity=10,extra={}){
  const out=A.createProductionOrder(s,ctx(s),{productId,quantity,...extra})
  return {state:ok(out,'create: '),id:out.result.id}
}
function confirmed(s,productId='p1',quantity=10){
  const c=created(s,productId,quantity)
  return {state:ok(A.transitionProduction(c.state,ctx(c.state),c.id,'Tasdiqlangan'),'confirm: '),id:c.id}
}
function finishOperations(s,id){
  for(const wo of orderOf(s,id).workOrders.filter(w=>w.status!=='Yakunlangan')){
    s=ok(A.startWorkOrder(s,ctx(s),id,wo.id))
    s=ok(A.finishWorkOrder(s,ctx(s),id,wo.id))
  }
  return s
}
function inFinalQc(s,productId='p1',quantity=10){
  let {state,id}=confirmed(s,productId,quantity)
  state=ok(A.transitionProduction(state,ctx(state),id,'Jarayonda'))
  state=finishOperations(state,id)
  state=ok(A.reportOutput(state,ctx(state),id,quantity,0,'',`k-${id}`))
  state=ok(A.transitionProduction(state,ctx(state),id,'Sifat nazoratida'))
  return {state,id}
}
const pendingFinal=(s,id)=>s.qualityChecks.find(q=>q.sourceId===id&&q.type==='Final'&&q.status==='Pending')
/** Passes every open inspection of the order (in-process ones too), as completion requires. */
function passAll(s,id){
  for(const q of s.qualityChecks.filter(q=>q.sourceType==='production'&&q.sourceId===id&&q.status==='Pending'))s=ok(A.resolveQuality(s,ctx(s,'em4'),q.id,'Passed'))
  return s
}

/* ------------------------------------------------------------ 1–2 MO reservation -- */

test('P1-12/13: confirming an MO reserves exactly its BOM need; cancelling releases exactly that',()=>{
  const s0=fresh()
  const c=created(s0,'p1',10)
  const bom=orderOf(c.state,c.id).bomSnapshot
  const before=Object.fromEntries(bom.components.map(k=>[k.materialId,bal(c.state,k.materialId,'w1').reserved]))
  const s1=ok(A.transitionProduction(c.state,ctx(c.state),c.id,'Tasdiqlangan'))
  const mo=orderOf(s1,c.id)
  assert.equal(mo.materialReserved,true)
  for(const k of bom.components){
    const need=Math.round(perUnit(k)*10*1000)/1000
    assert.equal(Math.round((bal(s1,k.materialId,'w1').reserved-before[k.materialId])*1000)/1000,need,`${k.materialId} reserved by the BOM need`)
    assert.equal(mo.reservations.find(r=>r.materialId===k.materialId).qty,need)
  }
  assert.equal(s1.stockMovements.length,c.state.stockMovements.length,'a reservation is not a stock movement')
  const s2=ok(A.transitionProduction(s1,ctx(s1),c.id,'Bekor qilingan'))
  for(const k of bom.components)assert.equal(bal(s2,k.materialId,'w1').reserved,before[k.materialId],`${k.materialId} reservation released`)
  assert.equal(orderOf(s2,c.id).materialReserved,false)
  refused(s2,A.transitionProduction(s2,ctx(s2),c.id,'Bekor qilingan'),/yopilgan/)
})

test('P1-12: confirming twice reserves once',()=>{
  const {state,id}=confirmed(fresh())
  const before=ledger(state)
  refused(state,A.transitionProduction(state,ctx(state),id,'Tasdiqlangan'),/qoralama/)
  assert.equal(ledger(state),before)
})

/* ------------------------------------------------------------ 3 shortage -- */

test('P1-15: an order short of material waits; it cannot start or report output and stock is untouched',()=>{
  const s0=fresh()
  const c=created(s0,'p1',100000)
  const out=A.transitionProduction(c.state,ctx(c.state),c.id,'Tasdiqlangan')
  assert.equal(out.result.ok,false)
  assert.match(out.result.message,/Material yetarli emas/)
  assert.equal(orderOf(out.state,c.id).status,'Material kutilmoqda')
  assert.equal(JSON.stringify(out.state.stockBalances),JSON.stringify(c.state.stockBalances),'no partial reservation')
  refused(out.state,A.transitionProduction(out.state,ctx(out.state),c.id,'Jarayonda'))
  refused(out.state,A.reportOutput(out.state,ctx(out.state),c.id,1,0),/jarayondagi/)
})

test('P1-15/35: output whose material vanished from the warehouse is refused without any stock change',()=>{
  let {state,id}=confirmed(fresh())
  state=ok(A.transitionProduction(state,ctx(state),id,'Jarayonda'))
  // Data corrupted outside the app: the reserved raw material is no longer on hand.
  const broken={...state,stockBalances:state.stockBalances.map(b=>b.itemId==='rm3'&&b.warehouseId==='w1'?{...b,onHand:0,reserved:0}:b)}
  const before=ledger(broken)
  const out=A.reportOutput(broken,ctx(broken),id,5,0)
  refused(broken,out,/yetarli emas/)
  assert.equal(ledger(out.state),before,'no material consumed and no finished stock received')
})

/* ------------------------------------------------------------ 4–5 completion and QC -- */

test('P1-14/16/17: completion consumes the exact BOM quantities and receives finished stock exactly once',()=>{
  let {state,id}=confirmed(fresh())
  const bom=orderOf(state,id).bomSnapshot
  const raw0=Object.fromEntries(bom.components.map(k=>[k.materialId,bal(state,k.materialId,'w1').onHand]))
  const fg0=bal(state,'p1','w3')
  state=ok(A.transitionProduction(state,ctx(state),id,'Jarayonda'))
  state=finishOperations(state,id)
  state=ok(A.reportOutput(state,ctx(state),id,8,2,'test','key-1'))
  const again=A.reportOutput(state,ctx(state),id,8,2,'test','key-1')
  refused(state,again,/allaqachon/)
  for(const k of bom.components){
    const used=Math.round((raw0[k.materialId]-bal(state,k.materialId,'w1').onHand)*1000)/1000
    assert.equal(used,Math.round(perUnit(k)*10*1000)/1000,`${k.materialId}: good + scrap units consumed`)
    const moved=state.stockMovements.filter(m=>m.source===orderOf(state,id).code&&m.itemId===k.materialId).reduce((a,m)=>a+m.qty,0)
    assert.equal(Math.round(-moved*1000)/1000,used,'ledger equals the balance change')
  }
  const mo=orderOf(state,id)
  assert.deepEqual([mo.quantity,mo.completed,mo.scrap,remainingQty(mo)],[10,8,2,0])
  assert.equal(bal(state,'p1','w3').onHand-fg0.onHand,8,'only good units are received')
  assert.equal(bal(state,'p1','w3').quarantine-fg0.quarantine,8,'and held for Final QC')
  state=ok(A.transitionProduction(state,ctx(state),id,'Sifat nazoratida'))
  state=passAll(state,id)
  const moves=state.stockMovements.length
  state=ok(A.transitionProduction(state,ctx(state),id,'Yakunlangan'))
  assert.equal(bal(state,'p1','w3').onHand-fg0.onHand,8)
  assert.equal(bal(state,'p1','w3').quarantine,fg0.quarantine,'released by the Final pass')
  refused(state,A.transitionProduction(state,ctx(state),id,'Yakunlangan'),/yopilgan/)
  refused(state,A.reportOutput(state,ctx(state),id,1,0))
  assert.equal(state.stockMovements.length,moves,'completion itself writes no second receipt')
})

test('P1-18: a failed Final QC keeps the finished goods in quarantine and blocks completion',()=>{
  let {state,id}=inFinalQc(fresh())
  const before=stockOf(state,'p1','w3')
  state=ok(A.resolveQuality(state,ctx(state,'em4'),pendingFinal(state,id).id,'Failed','chizilgan'))
  refused(state,A.transitionProduction(state,ctx(state),id,'Yakunlangan'),/Final QC o‘tmadi/)
  const after=stockOf(state,'p1','w3')
  assert.equal(after.available,before.available,'nothing released to available stock')
  assert.equal(after.quarantine,before.quarantine)
  // The same check cannot be re-decided into a pass.
  const q=state.qualityChecks.find(x=>x.sourceId===id&&x.type==='Final')
  refused(state,A.resolveQuality(state,ctx(state,'em4'),q.id,'Passed'),/allaqachon/)
})

/* ------------------------------------------------------------ 6–7 sales -- */

test('P1-20/21/22/24: a make-to-stock order reserves free stock, delivery takes it from that warehouse once',()=>{
  let s=fresh()
  const free0=stockOf(s,'p3').available
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:30}]});s=ok(so)
  const row=s.salesOrders.find(x=>x.id===so.result.id)
  assert.equal(row.status,'Tayyor')
  assert.equal(row.items[0].reserved,30)
  assert.equal(free0-stockOf(s,'p3').available,30,'reserved stock is no longer free')
  const wh=row.items[0].reservations[0].warehouseId
  const before=bal(s,'p3',wh)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(before.onHand-bal(s,'p3',wh).onHand,30)
  assert.equal(before.reserved-bal(s,'p3',wh).reserved,30,'the reservation is consumed, not left behind')
  refused(s,A.deliverSalesOrder(s,ctx(s),so.result.id),/yopilgan/)
  refused(s,A.cancelSalesOrder(s,ctx(s),so.result.id),/Yopilgan/)
})

test('P1-21: cancelling a reserved sales order releases exactly its reservation',()=>{
  let s=fresh()
  const reserved0=stockOf(s,'p3').reserved
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:12}]});s=ok(so)
  assert.equal(stockOf(s,'p3').reserved-reserved0,12)
  s=ok(A.cancelSalesOrder(s,ctx(s),so.result.id))
  assert.equal(stockOf(s,'p3').reserved,reserved0)
})

test('P1-9/23: allocation spans warehouses (fractional balances too) and never oversells',()=>{
  let s=fresh()
  s=ok(A.adjustStock(s,ctx(s),'p4','w4',50,'test kirim'))
  const w3=bal(s,'p4','w3'),free3=w3.onHand-w3.reserved-(w3.quarantine||0)
  assert.ok(free3%1!==0,'the seed keeps a fractional p4 balance')
  const qty=Math.floor(free3)+20
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p4',qty}]});s=ok(so)
  const item=s.salesOrders.find(x=>x.id===so.result.id).items[0]
  assert.deepEqual(item.reservations.map(r=>r.warehouseId).sort(),['w3','w4'])
  assert.equal(Math.round(item.reserved*1000)/1000,qty)
  const before3=bal(s,'p4','w3').onHand,before4=bal(s,'p4','w4').onHand
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(Math.round((before3-bal(s,'p4','w3').onHand+before4-bal(s,'p4','w4').onHand)*1000)/1000,qty,'delivered from both warehouses')
  assert.ok(bal(s,'p4','w3').onHand>=0&&bal(s,'p4','w4').onHand>=0)
  // More than all free stock: the order is only partly reserved and cannot be delivered in full.
  const total=stockOf(s,'p4').available
  const big=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p4',qty:Math.ceil(total)+100}]});s=ok(big)
  const row=s.salesOrders.find(x=>x.id===big.result.id)
  assert.equal(row.status,'Tasdiqlangan')
  assert.ok(row.items[0].reserved<=total+1e-6)
  refused(s,A.deliverSalesOrder(s,ctx(s),big.result.id),/yetarli emas/)
  refused(s,A.deliverSalesOrder(s,ctx(s),big.result.id,{p4:-5}),/kamida bitta/)
})

/* ------------------------------------------------------------ 8 returns -- */

function deliveredLot(){
  let s=fresh()
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:10}]});s=ok(so)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  const sale=s.stockMovements.find(m=>m.type==='Sale -'&&m.source===s.salesOrders.find(x=>x.id===so.result.id).code)
  return {s,soId:so.result.id,wh:sale.warehouseId}
}

test('P1-26/27: a return is received into quarantine of the shipping warehouse; each decision moves exactly those units',()=>{
  const base=deliveredLot()
  for(const decision of ['Omborga qaytarildi','Rework','Scrap']){
    let s=base.s
    const before=bal(s,'p3',base.wh)
    const r=A.createReturn(s,ctx(s,'em4'),{salesOrderId:base.soId,productId:'p3',qty:4,reason:'test'});s=ok(r)
    const ret=s.returns.find(x=>x.id===r.result.id)
    assert.equal(ret.warehouseId,base.wh)
    assert.equal(bal(s,'p3',base.wh).onHand-before.onHand,4)
    assert.equal(bal(s,'p3',base.wh).quarantine-before.quarantine,4)
    assert.ok(s.stockMovements.some(m=>m.type==='Return +'&&m.source===ret.code&&m.qty===4))
    const lotRows=s.lots.filter(l=>l.sourceType==='return'&&l.sourceId===ret.id)
    assert.equal(lotRows.reduce((a,l)=>a+l.qty,0),ret.allocations.filter(a=>a.lot).reduce((a,x)=>a+x.qty,0),'returned lots are recorded as their own records')
    const moves=s.stockMovements.length
    s=ok(A.dispositionReturn(s,ctx(s,'em4'),ret.id,decision))
    const after=bal(s,'p3',base.wh)
    if(decision==='Omborga qaytarildi'){
      assert.equal(after.onHand-before.onHand,4);assert.equal(after.quarantine,before.quarantine,'released to good stock')
      assert.ok(s.lots.filter(l=>l.sourceId===ret.id).every(l=>l.status==='available'))
    }
    if(decision==='Rework'){
      const mo=orderOf(s,s.returns.find(x=>x.id===ret.id).reworkOrderId)
      assert.equal(mo.warehouseId,base.wh,'the rework order sits where the units are')
      assert.equal(mo.qcHeld,4);assert.equal(after.quarantine-before.quarantine,4,'held until the rework passes')
    }
    if(decision==='Scrap'){
      assert.equal(after.onHand,before.onHand);assert.equal(after.quarantine,before.quarantine)
      assert.equal(s.stockMovements.length-moves,ret.allocations.length,'one scrap movement per received allocation')
      assert.ok(s.stockMovements.slice(0,ret.allocations.length).every(m=>m.type==='QC Scrap -'&&m.source===ret.code))
    }
    refused(s,A.dispositionReturn(s,ctx(s,'em4'),ret.id,'Scrap'),/allaqachon/)
  }
})

test('P1-26: return quantity, stale ids and invalid decisions are refused',()=>{
  const {s,soId}=deliveredLot()
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:soId,productId:'p3',qty:0,reason:'x'}),/oralig/)
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:soId,productId:'p3',qty:11,reason:'x'}),/oralig/)
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:soId,productId:'p3',qty:2,reason:'  '}),/sabab/)
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:'so-nope',productId:'p3',qty:1,reason:'x'}),/tanlanmagan/)
  refused(s,A.dispositionReturn(s,ctx(s),'ret-nope','Scrap'),/topilmadi/)
  let t=ok(A.createReturn(s,ctx(s),{salesOrderId:soId,productId:'p3',qty:6,reason:'x'}))
  refused(t,A.createReturn(t,ctx(t),{salesOrderId:soId,productId:'p3',qty:5,reason:'x'}),/1–4/)
  const id=t.returns[0].id
  refused(t,A.dispositionReturn(t,ctx(t),id,'Boshqa'),/noto‘g‘ri/)
})

test('P1-29: a return of a multi-lot delivery is split over the lots that were really shipped',()=>{
  let s=fresh()
  // Two lots of p3 in w3 and nothing else free, so a delivery has to take both.
  const free=bal(s,'p3','w3')
  s={...s,lots:s.lots.filter(l=>!(l.itemId==='p3'&&l.warehouseId==='w3'))}
  s={...s,lots:[
    {id:'lot-a',code:'LOT-P3-A',kind:'lot',itemId:'p3',itemType:'finished',qty:5,warehouseId:'w3',status:'available',sourceType:'adjustment',sourceId:'opening',sourceCode:'opening',createdAt:'2026-01-01 08:00',expiry:'2026-02-01',consumedBy:[]},
    {id:'lot-b',code:'LOT-P3-B',kind:'lot',itemId:'p3',itemType:'finished',qty:free.onHand-5,warehouseId:'w3',status:'available',sourceType:'adjustment',sourceId:'opening',sourceCode:'opening',createdAt:'2026-01-02 08:00',consumedBy:[]},
    ...s.lots]}
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:8}]});s=ok(so)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  const r=A.createReturn(s,ctx(s),{salesOrderId:so.result.id,productId:'p3',qty:8,reason:'x'});s=ok(r)
  const ret=s.returns.find(x=>x.id===r.result.id)
  assert.deepEqual(ret.allocations.map(a=>[a.lot,a.qty]),[['LOT-P3-A',5],['LOT-P3-B',3]])
})

/* ------------------------------------------------------------ 9 RBAC and scope -- */

test('P1-1/3: role rules refuse mutations the role does not hold',()=>{
  const s=fresh()
  const operator=s.roles.find(r=>r.key==='operator'),quality=s.roles.find(r=>r.key==='quality')
  for(const name of ['cancelSalesOrder','adjustStock','transferStock','createProductionOrder','deliverSalesOrder','confirmPurchase'])
    assert.equal(X.allowedBy(operator,X.actionRules(name,[])),false,`operator: ${name}`)
  assert.equal(X.allowedBy(operator,X.actionRules('transitionProduction',['mo','Bekor qilingan'])),false,'cancelling is planning work')
  assert.equal(X.allowedBy(operator,X.actionRules('transitionProduction',['mo','Jarayonda'])),true,'running is shop-floor work')
  assert.equal(X.allowedBy(quality,X.actionRules('dispositionReturn',[])),true)
  assert.equal(X.allowedBy(undefined,X.actionRules('reportOutput',[])),false,'no role, no access')
})

test('P1-2: scope blocks writes outside the employee’s work center, branch and warehouse',()=>{
  let s=fresh()
  const em=id=>s.employees.find(e=>e.id===id)
  const running=s.productionOrders.find(o=>o.status==='Jarayonda')
  // em7: operator at wc4 (branch b2).
  assert.match(X.scopeBlocker(s,em('em7'),'reportOutput',[running.id,1,0])||'',/ish markaziga tegishli/)
  // em2: branch-scoped production manager in b1.
  assert.match(X.scopeBlocker(s,em('em2'),'createProductionOrder',[{productId:'p1',quantity:1,lineId:'l3'}])||'',/boshqa filial/)
  assert.equal(X.scopeBlocker(s,em('em2'),'createProductionOrder',[{productId:'p1',quantity:1,lineId:'l1'}]),null)
  assert.match(X.scopeBlocker(s,em('em2'),'updateEntity',['warehouses','w4',{name:'x'}])||'',/boshqa filial/)
  assert.match(X.scopeBlocker(s,em('em2'),'createEntity',['workCenters',{name:'x',branchId:'b2'}])||'',/boshqa filial/)
  assert.equal(X.scopeBlocker(s,em('em2'),'updateEntity',['warehouses','w3',{name:'x'}]),null)
  // A warehouse-scoped storekeeper tied to w1 moves stock only there.
  s={...s,employees:[...s.employees,{id:'em-wh',name:'Ombor Test',roleId:'role6',department:'Warehouse',workCenterId:'',warehouseId:'w1',shift:'A',status:'Faol',attendance:100,efficiency:0,hourlyCost:1}]}
  const keeper=s.employees.find(e=>e.id==='em-wh')
  assert.match(X.scopeBlocker(s,keeper,'adjustStock',['p1','w3',1,'x'])||'',/omboriga tegishli/)
  assert.equal(X.scopeBlocker(s,keeper,'adjustStock',['rm1','w1',1,'x']),null)
  assert.match(X.scopeBlocker(s,keeper,'transferStock',['rm1','w1','w2',1])||'',/omboriga tegishli/)
  // Without any home the scoped role can do nothing location-bound.
  const homeless={...em('em2'),workCenterId:''}
  assert.match(X.scopeBlocker(s,homeless,'adjustStock',['rm1','w1',1,'x'])||'',/biriktirilmagan/)
})

test('P1-2: scoped roles read only their own location; unscoped roles read everything',()=>{
  let s=fresh()
  s=ok(A.adjustStock(s,ctx(s),'p4','w4',5,'b2 stock'))
  const em=id=>s.employees.find(e=>e.id===id)
  assert.equal(X.scopedView(s,em('em1')),s,'admin (scope all) gets the same data')
  const b1=X.scopedView(s,em('em2'))
  assert.ok(b1.stockBalances.length&&b1.stockBalances.every(b=>['w1','w2','w3'].includes(b.warehouseId)))
  assert.ok(b1.stockMovements.every(m=>m.warehouseId!=='w4'))
  assert.equal(b1.warehouses.length,s.warehouses.length,'master data stays complete for names')
  const op=X.scopedView(s,em('em7'))
  assert.ok(op.stockBalances.every(b=>b.warehouseId==='w4'))
  assert.ok(op.productionOrders.every(o=>o.workOrders.some(w=>w.workCenterId==='wc4')||o.workCenterId==='wc4'))
  assert.ok(op.productionOrders.length<s.productionOrders.length)
})

/* ------------------------------------------------------------ 10 invalid transitions -- */

test('P1-17: invalid transitions and stale ids change nothing',()=>{
  const s=fresh()
  const done=s.productionOrders.find(o=>o.status==='Yakunlangan')
  for(const status of ['Tasdiqlangan','Jarayonda','Bekor qilingan','Yakunlangan'])refused(s,A.transitionProduction(s,ctx(s),done.id,status),/yopilgan/)
  const draft=s.productionOrders.find(o=>o.status==='Qoralama')
  refused(s,A.transitionProduction(s,ctx(s),draft.id,'Yakunlangan'),/sifat nazoratiga/)
  refused(s,A.transitionProduction(s,ctx(s),draft.id,'Sifat nazoratida'))
  refused(s,A.transitionProduction(s,ctx(s),'mo-nope','Tasdiqlangan'),/topilmadi/)
  refused(s,A.reportOutput(s,ctx(s),'mo-nope',1,0),/topilmadi/)
  refused(s,A.splitProduction(s,ctx(s),'mo-nope',1))
  refused(s,A.deliverSalesOrder(s,ctx(s),'so-nope'),/topilmadi/)
  refused(s,A.transferStock(s,ctx(s),'rm1','w1','w-nope',1),/mavjud emas/)
  refused(s,A.transferStock(s,ctx(s),'rm1','w1','w2',-3),/Miqdor/)
  refused(s,A.adjustStock(s,ctx(s),'rm1','w1',0,'x'),/0/)
})

test('P1-6/7: quantities are validated — zero, negative, fractional units and over-reservation',()=>{
  const s=fresh()
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:0}),/0 dan katta/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:-4}),/0 dan katta/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:0.4}),/0 dan katta/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p-nope',quantity:4}),/tanlanmagan/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:4,warehouseId:'w-nope'}),/ombori/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:4,warehouseId:'w1'}),/ombori/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:4,lineId:'l-nope'}),/liniya/)
  // A count may not drive stock below what is promised.
  const b=bal(s,'rm1','w1')
  refused(s,A.adjustStock(s,ctx(s),'rm1','w1',-(b.onHand-b.reserved-(b.quarantine||0))-1,'x'),/rezerv/)
  // Fractional material quantities are kept exactly (three decimals).
  const t=ok(A.adjustStock(s,ctx(s),'rm1','w1',0.125,'x'))
  assert.equal(Math.round((bal(t,'rm1','w1').onHand-b.onHand)*1000)/1000,0.125)
  for(const row of fresh().stockBalances)assert.ok(row.onHand>=0&&row.reserved>=0&&(row.quarantine||0)>=0,'seed balances are never negative')
})

/* ------------------------------------------------------------ 11 BOM snapshot -- */

test('P1-19: an existing order keeps its BOM snapshot after the master BOM changes',()=>{
  let s=fresh()
  const c=created(s,'p1',10);s=c.state
  const snapshot=JSON.stringify(orderOf(s,c.id).bomSnapshot)
  const master=s.boms.find(b=>b.id===orderOf(s,c.id).bomId)
  s=ok(A.saveBom(s,ctx(s),{...master,components:master.components.map(k=>({...k,qty:k.qty*3}))}))
  assert.equal(JSON.stringify(orderOf(s,c.id).bomSnapshot),snapshot)
  const before=bal(s,'rm1','w1').reserved
  s=ok(A.transitionProduction(s,ctx(s),c.id,'Tasdiqlangan'))
  const k=orderOf(s,c.id).bomSnapshot.components.find(x=>x.materialId==='rm1')
  assert.equal(Math.round((bal(s,'rm1','w1').reserved-before)*1000)/1000,Math.round(perUnit(k)*10*1000)/1000,'reserved by the snapshot, not the new master')
  // A new order uses the new master; the two cannot be merged into one recipe.
  const d=created(s,'p1',5);s=d.state
  const old=created({...s,boms:s.boms.map(b=>b.id===master.id?master:b)},'p1',5)
  refused(old.state,A.mergeProduction(old.state,ctx(old.state),[d.id,old.id]),/snapshot/)
})

test('P1-11: a BOM with a stale or archived component cannot start production',()=>{
  let s=fresh()
  const c=created(s,'p1',5);s=c.state
  const archived={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm3'?{...m,status:'Arxiv'}:m)}
  refused(archived,A.transitionProduction(archived,ctx(archived),c.id,'Tasdiqlangan'),/arxivlangan/)
  refused(archived,A.createProductionOrder(archived,ctx(archived),{productId:'p1',quantity:5}),/arxivlangan/)
  const stale={...s,productionOrders:s.productionOrders.map(o=>o.id===c.id?{...o,bomSnapshot:{...o.bomSnapshot,components:[...o.bomSnapshot.components,{id:'x',materialId:'rm-gone',qty:1,unit:'kg',waste:0}]}}:o)}
  refused(stale,A.transitionProduction(stale,ctx(stale),c.id,'Tasdiqlangan'),/topilmadi/)
})

/* ------------------------------------------------------------ 12 split / merge / backorder / unbuild -- */

test('P1-33/34: split keeps the total quantity and reservation, the child starts clean',()=>{
  let {state:s,id}=confirmed(fresh(),'p1',10)
  const reserved=bal(s,'rm1','w1').reserved
  const out=A.splitProduction(s,ctx(s),id,4);s=ok(out)
  const parent=orderOf(s,id),child=orderOf(s,out.result.id)
  assert.deepEqual([parent.quantity,child.quantity],[6,4])
  assert.equal(child.parentOrderId,id)
  assert.equal(parent.materialReserved&&child.materialReserved,true)
  assert.ok(Math.abs(bal(s,'rm1','w1').reserved-reserved)<1e-6,'the same stock stays reserved, only shared out')
  // Extra issues approved for the parent are not inherited by the child.
  const withExtra={...s,productionOrders:s.productionOrders.map(o=>o.id===id?{...o,extraIssues:[{materialId:'rm1',qty:1,reason:'x',by:'em1',at:'2026-10-21'}]}:o)}
  const again=A.splitProduction(withExtra,ctx(withExtra),id,2)
  assert.equal(orderOf(ok(again),again.result.id).extraIssues,undefined)
  refused(s,A.splitProduction(s,ctx(s),id,0))
  refused(s,A.splitProduction(s,ctx(s),id,6))
})

test('P1-33/34: merge moves the reservation to one order and keeps the originals as history',()=>{
  let s=fresh()
  const a=confirmed(s,'p1',3);s=a.state
  const b=confirmed(s,'p1',4);s=b.state
  const reserved=bal(s,'rm1','w1').reserved
  const out=A.mergeProduction(s,ctx(s),[a.id,b.id]);s=ok(out)
  const merged=orderOf(s,out.result.id)
  assert.equal(merged.quantity,7)
  assert.equal(merged.status,'Tasdiqlangan')
  assert.ok(Math.abs(bal(s,'rm1','w1').reserved-reserved)<1e-6,'no reservation leaks or doubles')
  for(const id of [a.id,b.id]){const o=orderOf(s,id);assert.equal(o.status,'Bekor qilingan');assert.equal(o.materialReserved,false);assert.match(o.source,new RegExp(merged.code))}
  refused(s,A.mergeProduction(s,ctx(s),[a.id,a.id]),/Kamida 2/)
})

test('P1-25/33: a backorder takes the remaining quantity, stays linked to its sales order and starts clean',()=>{
  let s=fresh()
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-order',lines:[{productId:'p1',qty:10}]});s=ok(so)
  const moId=s.salesOrders.find(x=>x.id===so.result.id).productionOrderIds[0]
  s=ok(A.transitionProduction(s,ctx(s),moId,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),moId,'Jarayonda'))
  s=finishOperations(s,moId)
  s=ok(A.reportOutput(s,ctx(s),moId,4,0,'','bo-1'))
  const out=A.createBackorder(s,ctx(s),moId);s=ok(out)
  const original=orderOf(s,moId),back=orderOf(s,out.result.id)
  assert.deepEqual([original.quantity,original.completed,back.quantity,back.completed],[4,4,6,0])
  assert.equal(back.backorderOf,moId)
  assert.equal(back.salesOrderId,so.result.id)
  assert.equal(back.outputKeys,undefined)
  assert.ok(s.salesOrders.find(x=>x.id===so.result.id).productionOrderIds.includes(back.id),'the sales order waits for the backorder too')
  assert.equal(original.materialReserved,false,'the original released what it no longer needs')
})

test('P1-30: unbuild of a transferred lot uses the BOM snapshot of the order that made it',()=>{
  let {state:s,id}=inFinalQc(fresh(),'p1',10)
  s=passAll(s,id)
  s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'))
  const mo=orderOf(s,id)
  // Other p1 lots are on hold, so FEFO moves exactly this order's lot.
  s={...s,lots:s.lots.map(l=>l.itemId==='p1'&&l.code!==mo.lot?{...l,status:'hold'}:l)}
  s=ok(A.transferStock(s,ctx(s),'p1','w3','w4',10))
  const copy=s.lots.find(l=>l.code===mo.lot&&l.warehouseId==='w4')
  assert.equal(copy.sourceType,'production','the transferred copy keeps its origin')
  assert.equal(findTraceOrder(s,mo.lot).id,id)
  // The master BOM changes afterwards; the unbuild still returns what this order put in.
  const master=s.boms.find(b=>b.id===mo.bomId)
  s=ok(A.saveBom(s,ctx(s),{...master,components:master.components.map(k=>({...k,qty:k.qty*5}))}))
  const content=A.unbuildContent(s,'p1',[{lot:mo.lot,qty:2}])
  assert.ok(content.basis.some(b=>b.includes(mo.code)),content.basis.join('; '))
  const k=mo.bomSnapshot.components.find(x=>x.materialId==='rm1')
  assert.ok(content.lines.find(l=>l.materialId==='rm1').qty<=k.qty*2+1e-6,'never more than the snapshot quantity')
  const trace=buildTraceability(s,id)
  assert.ok(trace.upstreamLots.every(l=>mo.consumed.some(c=>c.lot===l.code&&c.materialId===l.itemId)),'upstream lots are the ones this order consumed')
})

/* ------------------------------------------------------------ 31–32 references -- */

test('P1-31/32: referenced records cannot be deleted; copies get unique codes',()=>{
  let s=fresh()
  refused(s,A.deleteEntity(s,ctx(s),'products','p4'),/BOM|qoldiq/)
  const c=created(s,'p1',2);s=c.state
  // rm3 in an open order's snapshot, even after it leaves the master BOM.
  const t={...s,boms:s.boms.map(b=>({...b,components:b.components.filter(k=>k.materialId!=='rm3')})),purchaseOrders:s.purchaseOrders.map(p=>({...p,items:p.items.filter(i=>i.materialId!=='rm3')})),stockBalances:s.stockBalances.filter(b=>b.itemId!=='rm3')}
  refused(t,A.deleteEntity(t,ctx(t),'rawMaterials','rm3'),/ishlab chiqarish buyurtmasi/)
  refused(s,A.deleteEntity(s,ctx(s),'workCenters','wc4'),/O‘chirib bo‘lmaydi/)
  let d=ok(A.duplicateEntity(s,ctx(s),'products','p1'))
  d=ok(A.duplicateEntity(d,ctx(d),'products','p1'))
  const skus=d.products.map(p=>p.sku.toLowerCase())
  assert.equal(new Set(skus).size,skus.length,'every SKU is unique')
})
