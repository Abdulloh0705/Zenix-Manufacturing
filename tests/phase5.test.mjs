// Phase 5: the connected manufacturing chain with cross-module invariants after every step and after refused
// actions, plus loading of legacy / corrupted stored data and the cross-tab write guard.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as P from '../.test-dist/planning.mjs'
import * as PS from '../.test-dist/persistence.mjs'
import * as Auth from '../.test-dist/auth.mjs'
import {createInitialState,createSeedState} from '../.test-dist/mockData.mjs'
import {SCHEMA_VERSION} from '../.test-dist/migrations.mjs'
import {createSyncedSlot} from '../.test-dist/syncedState.mjs'

// Wednesday 2026-10-21 08:00 local time.
const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p5t${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const orderOf=(s,id)=>s.productionOrders.find(o=>o.id===id)
const bal=(s,wh,item)=>s.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===item)||{onHand:0,reserved:0,quarantine:0,incoming:0}
const clone=v=>JSON.parse(JSON.stringify(v))

/**
 * Cross-module invariants that must hold after every successful or refused operation:
 * stock = its movements, never negative / NaN, commitments within on-hand, raw reservations backed by open
 * orders, references resolvable, ids unique, and the load-time repair finds nothing to repair.
 */
function assertInvariants(s,step){
  const at=m=>`[${step}] ${m}`
  const finite=(v,label)=>assert.ok(typeof v==='number'&&Number.isFinite(v),at(`${label} = ${v}`))
  for(const b of s.stockBalances){
    for(const f of ['onHand','reserved','incoming','quarantine']){finite(b[f]||0,`${b.itemId}@${b.warehouseId}.${f}`);assert.ok((b[f]||0)>=-1e-9,at(`${b.itemId}@${b.warehouseId}.${f} < 0`))}
    assert.ok(b.reserved+(b.quarantine||0)<=b.onHand+1e-6,at(`${b.itemId}@${b.warehouseId}: reserved ${b.reserved} + quarantine ${b.quarantine} > on hand ${b.onHand}`))
    const moved=s.stockMovements.filter(m=>m.warehouseId===b.warehouseId&&m.itemId===b.itemId).reduce((a,m)=>a+m.qty,0)
    assert.ok(Math.abs(moved-b.onHand)<1e-3,at(`${b.itemId}@${b.warehouseId}: on hand ${b.onHand} ≠ movements ${moved}`))
    assert.ok(s.warehouses.some(w=>w.id===b.warehouseId),at(`balance in unknown warehouse ${b.warehouseId}`))
  }
  // Raw material reservations equal what open orders hold (no reservation without an owner, none counted twice).
  const held=new Map()
  for(const o of s.productionOrders.filter(E.isOpenOrder))for(const r of E.orderReservations(s,o)){const k=`${r.materialId}@${r.warehouseId}`;held.set(k,(held.get(k)||0)+r.qty)}
  for(const b of s.stockBalances.filter(x=>x.itemType==='raw'))assert.ok(Math.abs((held.get(`${b.itemId}@${b.warehouseId}`)||0)-b.reserved)<1e-3,at(`${b.itemId}@${b.warehouseId}: reserved ${b.reserved} ≠ held by orders ${held.get(`${b.itemId}@${b.warehouseId}`)||0}`))
  for(const o of s.productionOrders){
    for(const f of ['quantity','completed','scrap','progress','estimatedCost','actualCost'])finite(o[f],`${o.code}.${f}`)
    assert.ok(o.completed>=0&&o.scrap>=0,at(`${o.code} negative output`))
    assert.ok(s.products.some(p=>p.id===o.productId),at(`${o.code} → unknown product`))
    if(o.costSnapshot)for(const k of ['material','labor','machine','overhead','total'])finite(o.costSnapshot.actual[k],`${o.code}.costSnapshot.actual.${k}`)
  }
  for(const p of s.purchaseOrders){
    assert.ok(s.suppliers.some(x=>x.id===p.supplierId),at(`${p.code} → unknown supplier`))
    for(const l of p.items)assert.ok(l.received<=l.qty+1e-6&&l.received>=0,at(`${p.code} ${l.materialId}: received ${l.received} of ${l.qty}`))
  }
  for(const so of s.salesOrders){
    assert.ok(s.customers.some(c=>c.id===so.customerId),at(`${so.code} → unknown customer`))
    for(const l of so.items)assert.ok(l.delivered<=l.qty+1e-6&&l.delivered>=0,at(`${so.code}: delivered ${l.delivered} of ${l.qty}`))
  }
  const sources={purchase:s.purchaseOrders,production:s.productionOrders,return:s.returns,subcontract:s.subcontractOrders}
  for(const q of s.qualityChecks)assert.ok((sources[q.sourceType]||[]).some(x=>x.id===q.sourceId),at(`QC ${q.id} → unknown ${q.sourceType} ${q.sourceId}`))
  for(const l of s.lots){finite(l.qty,`lot ${l.code}.qty`);assert.ok(l.qty>=-1e-9,at(`lot ${l.code} negative`))}
  // The data the app writes must load back without any repair (otherwise every reload would report problems).
  assert.deepEqual(PS.repairCollections(s,createInitialState(T0)).issues,[],at('stored data would need repair'))
}

/* ------------------------------------------------------------------ the connected chain -- */

test('P5-01: Sales → MRP → PO → partial receipt → QC → MO → Shop Floor → Final QC → delivery → return → trace, with invariants at every step',()=>{
  let s=createInitialState(T0)
  assertInvariants(s,'start')

  // 1. Sales demand.
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p3',qty:100,mode:'Make-to-stock',deliveryDate:'2026-10-30'});s=ok(so,'sales order: ')
  assertInvariants(s,'sales order')

  // 2. Demand → MRP make suggestion for the product, pegged to the sales order.
  const opts={today:TODAY,bucket:'day',horizonDays:14}
  const make=P.runMrp(s,opts).suggestions.find(x=>x.type==='make'&&x.itemId==='p3')
  assert.ok(make,'MRP suggests making the sold product')
  assert.ok(make.origins.some(r=>r.id===so.result.id||r.code===orderCode(s,so.result.id)),'the suggestion is pegged to the sales order')
  const mo=A.confirmMrpSuggestion(s,ctx(s),make.key,opts);s=ok(mo,'make suggestion: ')
  assertInvariants(s,'MO from MRP')
  const moId=mo.result.id
  assert.equal(P.runMrp(s,opts).suggestions.some(x=>x.type==='make'&&x.itemId==='p3'&&x.netQty>0&&x.needDate===make.needDate&&!x.existing),false,'the demand is covered — no second make suggestion')

  // 3. MRP → Purchase Order for the component; confirming the same suggestion again creates nothing.
  const buy=P.runMrp(s,opts).suggestions.find(x=>x.type==='buy'&&x.itemId==='rm2')
  assert.ok(buy,'MRP suggests buying the component of the planned order')
  const po=A.confirmMrpSuggestion(s,ctx(s),buy.key,opts);s=ok(po,'buy suggestion: ')
  const poCount=s.purchaseOrders.length
  const again=A.confirmMrpSuggestion(s,ctx(s),buy.key,opts)
  assert.equal((again.result.ok?again.state:s).purchaseOrders.length,poCount,'a repeated confirmation does not duplicate the PO')
  s=ok(A.confirmPurchase(s,ctx(s),po.result.id))
  assertInvariants(s,'PO confirmed')
  const line=s.purchaseOrders.find(p=>p.id===po.result.id).items.find(l=>l.materialId==='rm2')
  const poWh=s.purchaseOrders.find(p=>p.id===po.result.id).warehouseId

  // 4. Partial receipt → mandatory incoming QC: the units wait in quarantine and cannot be reserved.
  const half=Math.floor(line.qty/2)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',half),'partial receipt: ')
  assertInvariants(s,'partial receipt')
  assert.equal(bal(s,poWh,'rm2').quarantine,half,'received units are quarantined until inspected')
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm2',line.qty),/qoldi|ortiq|ko‘p|oshib|qabul/i)
  // Without released stock the order waits for material (reported as not done) instead of reserving quarantine.
  const confirmed=A.transitionProduction(s,ctx(s),moId,'Tasdiqlangan');s=confirmed.state
  assert.equal(confirmed.result.ok,false);assert.equal(orderOf(s,moId).status,'Material kutilmoqda')
  assertInvariants(s,'MO confirmed before QC')
  assert.equal(orderOf(s,moId).materialReserved,false,'quarantined material is not reserved')
  const firstCheck=s.qualityChecks.find(q=>q.sourceId===po.result.id&&q.status==='Pending')
  assert.ok(firstCheck,'the receipt has a pending incoming inspection')
  s=ok(A.resolveQuality(s,ctx(s,'em4'),firstCheck.id,'Passed'),'incoming QC: ')
  assertInvariants(s,'first receipt released')
  refused(s,A.resolveQuality(s,ctx(s,'em4'),firstCheck.id,'Passed'))

  // Rest of the PO, inspected too; the waiting MO is reserved from released stock only.
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',line.qty-half),'second receipt: ')
  const secondCheck=s.qualityChecks.find(q=>q.sourceId===po.result.id&&q.status==='Pending')
  assert.ok(secondCheck,'the second receipt is inspected as well')
  s=ok(A.resolveQuality(s,ctx(s,'em4'),secondCheck.id,'Passed'))
  assertInvariants(s,'second receipt released')
  if(!orderOf(s,moId).materialReserved)s=ok(A.transitionProduction(s,ctx(s),moId,'Tasdiqlangan'),'reserve after release: ')
  assert.equal(orderOf(s,moId).materialReserved,true,'MO confirmation reserves the released material')
  assertInvariants(s,'MO reserved')
  const snapshotBefore=clone(orderOf(s,moId).bomSnapshot)

  // 5. Shop Floor: every job card, actual output plus scrap. Completing without Final QC is refused.
  s=ok(A.transitionProduction(s,ctx(s),moId,'Jarayonda'))
  for(const wo of orderOf(s,moId).workOrders){
    s=ok(A.startWorkOrder(s,ctx(s,'em1',new Date(T0.getTime()+60e3)),moId,wo.id))
    s=ok(A.finishWorkOrder(s,ctx(s,'em1',new Date(T0.getTime()+90*60e3)),moId,wo.id))
  }
  const qty=E.remainingQty(orderOf(s,moId))
  refused(s,A.reportOutput(s,ctx(s),moId,-1,0))
  s=ok(A.reportOutput(s,ctx(s),moId,qty-4,4,'Shop Floor scrap','p5-report-1'),'output: ')
  const afterReport=s
  const repeat=A.reportOutput(s,ctx(s),moId,qty-4,4,'Shop Floor scrap','p5-report-1')
  assert.deepEqual((repeat.result.ok?repeat.state:s).productionOrders.find(o=>o.id===moId).completed,orderOf(afterReport,moId).completed,'a repeated report (same key) posts nothing twice')
  assertInvariants(s,'output reported')
  refused(s,A.transitionProduction(s,ctx(s),moId,'Yakunlangan'))

  // 6. Final QC → finished stock released; the order completes once.
  s=ok(A.transitionProduction(s,ctx(s),moId,'Sifat nazoratida'))
  const order=orderOf(s,moId)
  const heldBefore=bal(s,order.warehouseId,'p3').quarantine
  assert.ok(heldBefore>=qty-4,'good output waits in Final QC quarantine')
  for(const q of s.qualityChecks.filter(q=>q.sourceType==='production'&&q.sourceId===moId&&q.status==='Pending'))s=ok(A.resolveQuality(s,ctx(s,'em4'),q.id,'Passed'),'final QC: ')
  assertInvariants(s,'final QC passed')
  s=ok(A.transitionProduction(s,ctx(s),moId,'Yakunlangan'),'complete: ')
  assertInvariants(s,'MO completed')
  refused(s,A.transitionProduction(s,ctx(s),moId,'Yakunlangan'))
  const fg=bal(s,order.warehouseId,'p3')
  assert.equal(fg.quarantine,0,'nothing stays in quarantine after the pass')
  assert.ok(fg.onHand>=qty-4,'the good units are finished stock')
  assert.equal(orderOf(s,moId).scrap,4)

  // 7. Actual costing and OEE from the recorded production.
  const done=orderOf(s,moId)
  assert.ok(done.costSnapshot&&done.costSnapshot.actual.total>0,'actual cost is frozen at completion')
  const frozen=clone(done.costSnapshot)
  const oee=E.workCenterOee(s,done.workOrders[0].workCenterId,7,new Date(T0.getTime()+3*3600e3))
  for(const [k,v] of Object.entries(oee))if(typeof v==='number')assert.ok(Number.isFinite(v),`OEE ${k} = ${v}`)

  // 8. Finished goods → sales delivery. Scrap left 96 of the 100 sold: the whole order cannot ship, the 96 can.
  const reserved=A.reserveSalesOrder(s,ctx(s),so.result.id);if(reserved.result.ok)s=reserved.state
  const available=E.stockOf(s,'p3').available+s.salesOrders.find(x=>x.id===so.result.id).items[0].reserved
  assert.equal(available,qty-4)
  refused(s,A.deliverSalesOrder(s,ctx(s),so.result.id),/yetarli emas/)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id,{p3:available}),'delivery: ')
  assertInvariants(s,'delivered')
  assert.equal(s.salesOrders.find(x=>x.id===so.result.id).items[0].delivered,available)
  refused(s,A.deliverSalesOrder(s,ctx(s),so.result.id,{p3:1}),/yetarli emas/)

  // 12. LOT traceability: purchase lot → MO → output lot → sale.
  const trace=E.buildTraceability(s,moId)
  assert.ok(trace.upstreamLots.some(l=>l.sourceType==='purchase'&&l.sourceId===po.result.id),'the consumed purchase lot is traced')
  assert.ok(trace.purchases.some(p=>p.id===po.result.id),'the purchase order is in the trace')
  assert.ok(trace.outputLots.length>0,'the order produced a lot')
  assert.ok(trace.downstreamSales.some(x=>x.id===so.result.id),'the sale is traced from the production lot')

  // 9. Return → quarantine → disposition (decided once).
  const ret=A.createReturn(s,ctx(s),{salesOrderId:so.result.id,productId:'p3',qty:3,reason:'Tirnalgan'});s=ok(ret,'return: ')
  assertInvariants(s,'return received')
  assert.ok(s.stockBalances.some(b=>b.itemId==='p3'&&(b.quarantine||0)>=3),'returned units are quarantined')
  // The return inspection is closed only by the disposition decision, never directly as a QC result.
  const returnCheck=s.qualityChecks.find(q=>q.sourceType==='return'&&q.sourceId===ret.result.id&&q.status==='Pending')
  if(returnCheck)refused(s,A.resolveQuality(s,ctx(s,'em4'),returnCheck.id,'Scrap'),/Qaytarishlar/)
  s=ok(A.dispositionReturn(s,ctx(s),ret.result.id,'Scrap'),'disposition: ')
  assertInvariants(s,'return disposed')
  assert.equal(s.returns.find(x=>x.id===ret.result.id).status,'Scrap')
  refused(s,A.dispositionReturn(s,ctx(s),ret.result.id,'Omborga qaytarildi'))

  // 10. BOM revision after the fact: the completed order keeps its snapshot and its frozen cost.
  const draft=A.createBomDraft(s,ctx(s),'p3','bom3');s=ok(draft,'BOM draft: ')
  const d=s.boms.find(b=>b.id===draft.result.id)
  s=ok(A.saveBom(s,ctx(s),{...d,components:d.components.map(c=>({...c,qty:c.qty*2}))}),'BOM save: ')
  s=ok(A.activateBom(s,ctx(s),draft.result.id),'BOM activate: ')
  assertInvariants(s,'new BOM revision')
  assert.deepEqual(orderOf(s,moId).bomSnapshot,snapshotBefore,'the historical MO keeps its BOM snapshot')
  assert.deepEqual(orderOf(s,moId).costSnapshot,frozen,'and its frozen cost')
  const next=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:10});s=ok(next)
  assert.equal(orderOf(s,next.result.id).bomId,draft.result.id,'a new order uses the new revision')
})

function orderCode(s,id){return s.salesOrders.find(x=>x.id===id)?.code}

test('P5-02: maintenance downtime takes capacity from its work center and is undone when it ends',()=>{
  let s=createInitialState(T0)
  const now=new Date(T0.getTime()+3600e3)
  const cap=st=>E.calculateCapacityLoads(st,5,undefined,now).find(l=>l.workCenter.id==='wc2')
  const before=cap(s)
  const stop=A.startDowntime(s,ctx(s),'eq2','Maintenance','planned service');s=ok(stop)
  const during=cap(s)
  assert.ok(during.capacityMinutes<before.capacityMinutes||during.days.some(d=>d.blocked),'a stopped machine removes capacity')
  const event=s.downtimeEvents.find(e=>e.equipmentId==='eq2'&&!e.end)
  s=ok(A.endDowntime(s,ctx(s,'em1',now),event.id))
  refused(s,A.endDowntime(s,ctx(s,'em1',now),event.id))
})

test('P5-03: critical mutations are refused for roles without the right, and allowed for the owning role',()=>{
  const s=createInitialState(T0)
  const role=key=>s.roles.find(r=>r.key===key)
  const can=(key,name,args=[])=>X.allowedBy(role(key),X.actionRules(name,args))
  const critical=[['confirmPurchase',['po']],['receivePurchase',['po','rm2',1]],['deliverSalesOrder',['so']],['activateBom',['bom']],['adjustStock',['rm1','w1',1,'x']],['applyEngineeringChange',['eco']],['confirmMrpSuggestion',['k']],['dispositionReturn',['r','Scrap']]]
  for(const [name,args] of critical){
    assert.ok(X.actionRules(name,args),`${name} has a permission rule`)
    assert.equal(can('operator',name,args),false,`an operator cannot ${name}`)
    assert.equal(can('business_owner',name,args),true,`the business owner can ${name}`)
  }
  assert.equal(can('quality','resolveQuality',['q','Passed']),true,'the quality role decides inspections')
  assert.equal(can('operator','resolveQuality',['q','Passed']),false,'an operator cannot pass an inspection')
  assert.equal(can('operator','startWorkOrder',['mo','wo']),true,'an operator runs job cards')
  // An unknown command has no rule: the provider refuses it instead of allowing it by default.
  assert.equal(X.actionRules('noSuchCommand',[]),undefined)
})

/* ------------------------------------------------------------------ stored data -- */

/** What a v3 browser (before system roles, supplier links, receipts inspection and Phase 2–4 fields) saved. */
function legacyV3(){
  const s=clone(createSeedState(T0))
  delete s.schemaVersion
  delete s.supplierMaterials
  s.roles=s.roles.filter(r=>!r.key).map(({key:_k,system:_s,...r})=>r)
  if(!s.roles.length)s.roles=[{id:'role1',name:'Production Admin',scope:'all',permissions:{production:{view:true,edit:true}}}]
  s.employees=s.employees.map(e=>({...e,roleId:'role1'}))
  delete s.settings.uiDensity;delete s.settings.tableDensity
  for(const o of s.productionOrders){delete o.reservations;delete o.qcHeld;delete o.outputKeys;for(const w of o.workOrders){delete w.history;delete w.reportKeys}}
  for(const p of s.purchaseOrders)for(const r of p.receipts){delete r.inspection;delete r.accepted;delete r.rejected}
  delete s.lots;delete s.forecasts
  return s
}

test('P5-04: legacy (v3) data migrates to the current schema without losing records',()=>{
  const legacy=legacyV3()
  const {state,report}=PS.prepareStored(clone(legacy),createInitialState(T0))
  assert.equal(state.schemaVersion,SCHEMA_VERSION)
  assert.ok(report.migrations.length>0,'the v4 migration ran')
  assert.ok(state.roles.some(r=>r.key==='super_admin'),'system roles exist after migration')
  assert.ok(Array.isArray(state.supplierMaterials)&&Array.isArray(state.lots)&&Array.isArray(state.forecasts),'lists added later start as lists')
  assert.equal(state.productionOrders.length,legacy.productionOrders.length,'no order is lost')
  assert.deepEqual(state.productionOrders.map(o=>o.id),legacy.productionOrders.map(o=>o.id))
  assert.equal(state.purchaseOrders.flatMap(p=>p.receipts).length,legacy.purchaseOrders.flatMap(p=>p.receipts).length,'receipts are kept')
  assert.ok(state.settings.uiDensity&&state.settings.tableDensity,'new preferences get defaults')
  assert.deepEqual(report.issues,[],'valid legacy data needs no repair')
  // Idempotent: loading the migrated data again changes nothing.
  const again=PS.prepareStored(clone(state),createInitialState(T0))
  assert.deepEqual(again.state,state)
  assert.deepEqual(again.report.migrations,[])
})

test('P5-05: corrupted records are set aside or completed, counted and reported — the rest loads',()=>{
  const s=clone(createSeedState(T0))
  const keep=s.productionOrders.length
  s.productionOrders.push(null,'garbage',{code:'NO-ID'})
  s.productionOrders[0]={...s.productionOrders[0],workOrders:undefined,consumed:null,quantity:null}
  delete s.productionOrders[1].bomSnapshot
  s.stockBalances[0]={...s.stockBalances[0],onHand:'12',reserved:undefined}
  s.purchaseOrders[0]={...s.purchaseOrders[0],receipts:'x'}
  s.customers.push({...s.customers[0]})
  s.settings={...s.settings,notifications:'broken',policies:null}
  const {state,report}=PS.prepareStored(s,createInitialState(T0))
  assert.equal(state.productionOrders.length,keep,'non-records are set aside, every real order stays')
  const po=report.issues.find(i=>i.collection==='productionOrders')
  assert.equal(po.dropped,3);assert.equal(po.repaired,2)
  assert.deepEqual(state.productionOrders[0].workOrders,[]);assert.deepEqual(state.productionOrders[0].consumed,[]);assert.equal(state.productionOrders[0].quantity,0)
  assert.deepEqual(state.productionOrders[1].bomSnapshot.components,[],'a missing snapshot is never rebuilt from today’s BOM')
  assert.match(state.productionOrders[1].bomSnapshot.notes,/saqlanmagan/)
  assert.equal(state.stockBalances[0].onHand,12);assert.equal(state.stockBalances[0].reserved,0)
  assert.deepEqual(state.purchaseOrders[0].receipts,[])
  assert.deepEqual(report.issues.find(i=>i.collection==='customers').duplicateIds,[s.customers[0].id],'duplicate ids are reported')
  // Audit #14: the first copy stays in use, the later one is quarantined unchanged (no longer two records with one id).
  assert.equal(state.customers.length,s.customers.length-1)
  assert.deepEqual(state.quarantinedRecords,[{collection:'customers',id:s.customers[0].id,reason:'duplicate-id',record:s.customers[0]}])
  assert.equal(typeof state.settings.notifications,'object');assert.equal(typeof state.settings.policies.shiftMinutes,'number','broken settings groups fall back to defaults')
  assert.ok(PS.changedRecords(report))
  assert.match(PS.describeReport(report),/chetga olindi.*to‘ldirildi.*takroriy/)
  // The engine runs on the repaired data.
  assert.doesNotThrow(()=>{P.runMrp(state,{today:TODAY});E.calculateCapacityLoads(state,5,undefined,T0)})
})

test('P5-06: only ZENIX-shaped data is accepted; data from a newer app version is flagged, not downgraded',()=>{
  for(const bad of [null,[],'x',{},{productionOrders:'no'}])assert.equal(PS.looksLikeState(bad),false)
  const newer={...clone(createInitialState(T0)),schemaVersion:SCHEMA_VERSION+3,futureList:[{id:'f1'}]}
  const {state,report}=PS.prepareStored(newer,createInitialState(T0))
  assert.equal(report.newerVersion,SCHEMA_VERSION+3)
  assert.equal(state.schemaVersion,SCHEMA_VERSION+3,'the newer version mark is kept')
  assert.deepEqual(state.futureList,[{id:'f1'}],'unknown data of the newer version is kept')
  assert.match(PS.describeReport(report),/yangiroq versiya/)
})

test('P5-07: a tab never overwrites another tab’s newer save; a refused write is reported',()=>{
  const data=new Map()
  const store={getRaw:k=>data.has(k)?data.get(k):null,setRaw:(k,v)=>{data.set(k,v);return true}}
  const parse=raw=>{const v=JSON.parse(raw);return v&&typeof v==='object'?v:null}
  store.setRaw('k',JSON.stringify({n:0}))
  const a=createSyncedSlot(store,'k',parse,store.getRaw('k')),b=createSyncedSlot(store,'k',parse,store.getRaw('k'))
  assert.equal(a.write({n:1,by:'a'}),'saved')
  // Tab B has not read tab A's save: writing would destroy it.
  assert.equal(b.write({n:1,by:'b'}),'conflict')
  assert.deepEqual(JSON.parse(store.getRaw('k')),{n:1,by:'a'},'tab A’s data is still stored')
  const base=b.latest({n:0})
  assert.equal(base.changed,true);assert.deepEqual(base.state,{n:1,by:'a'})
  assert.equal(b.write({...base.state,n:2,by:'b'}),'saved','after reading it, tab B continues from tab A’s data')
  // A half-written value is not worth protecting.
  store.setRaw('k','{"n":')
  assert.equal(a.write({n:3}),'saved')
  const failing=createSyncedSlot({getRaw:()=>null,setRaw:()=>false},'k',parse,null)
  assert.equal(failing.write({n:1}),'failed')
})

test('P5-08: malformed stored sessions and accounts cannot sign anyone in or live forever',()=>{
  assert.equal(Auth.normalizeSession(null),null)
  assert.equal(Auth.normalizeSession({id:'s',accountId:'a',employeeId:'e'}),null,'a session without times is not restored')
  assert.equal(Auth.normalizeSession({id:'s',accountId:'a',employeeId:'e',startedAt:'x',lastActivity:'x',expiresAt:'x'}),null)
  const now=new Date().toISOString(),later=new Date(Date.now()+864e5).toISOString()
  const good={id:'s',accountId:'a',employeeId:'em1',startedAt:now,lastActivity:now,expiresAt:later,remember:'yes'}
  assert.deepEqual(Auth.normalizeSession(good),{...good,remember:false},'only a real boolean remembers the session')
  const store=Auth.normalizeAuthStore({accounts:[null,'x',{id:'a',employeeId:'em1',username:'u',status:'active'}],events:[null],policy:'bad'})
  assert.equal(store.accounts.length,1);assert.equal(store.events.length,0);assert.equal(typeof store.policy.idleMinutes,'number')
  const s=createInitialState(T0)
  assert.equal(Auth.sessionProblem({...good,expiresAt:undefined},store,s,new Date()),'expired','a session with an unreadable expiry is expired')
})

test('P5-09: the generated demo history satisfies the same cross-module invariants',()=>{
  assertInvariants(createSeedState(T0),'demo history')
})

test('P5-10: recovery never infers an owner from account order',()=>{
  const s=createInitialState(T0)
  const at=d=>new Date(T0.getTime()+d*1000).toISOString()
  const acc=(id,employeeId,createdAt,status='active')=>({id,employeeId,username:id,hash:'x',salt:'x',iterations:1,status,failedCount:0,mustChangePassword:false,createdAt})
  const store=Auth.normalizeAuthStore({accounts:[acc('a2','em2',at(5)),acc('a0','em9',at(0)),acc('a1','em1',at(1)),acc('ab','em3',at(-5),'blocked')]})
  assert.equal(Auth.superAdminInvariant(store,s),false,'clean data holds no Super Admin')
  const fixed=Auth.restoreSuperAdmin(store,s)
  assert.equal(fixed,s,'no account gains ownership from creation order')
  assert.equal(Auth.superAdminInvariant(store,fixed),false)
})
