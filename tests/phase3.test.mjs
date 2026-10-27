// Phase 3 regression tests: multi-line purchasing and goods receipts with inspection split, rejected-goods
// disposition, supplier KPIs and MRP supplier choice, BOM / routing revisions and validation, variants, ECO control,
// maintenance planning, capacity and reliability, and the permissions / scope of the new commands. Fixed clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as P from '../.test-dist/planning.mjs'
import * as M from '../.test-dist/maintenance.mjs'
import * as SM from '../.test-dist/supplierMaterials.mjs'
import {createInitialState,createSeedState} from '../.test-dist/mockData.mjs'

// Wednesday 2026-10-21 08:00 local time.
const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
const at=min=>new Date(T0.getTime()+min*60000)
const day=d=>new Date(T0.getTime()+d*86400000)
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p3t${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const bal=(s,wh,item)=>s.stockBalances.find(b=>b.warehouseId===wh&&b.itemId===item)||{onHand:0,reserved:0,quarantine:0,incoming:0}
const moves=(s,item,wh='w1')=>s.stockMovements.filter(m=>m.itemId===item&&m.warehouseId===wh)
const ledger=(s,item,wh='w1')=>Math.round(moves(s,item,wh).reduce((a,m)=>a+m.qty,0)*1000)/1000
const withPolicy=(s,patch)=>({...s,settings:{...s.settings,policies:{...s.settings.policies,...patch}}})
const base=()=>createInitialState(T0)
const poOf=(s,id)=>s.purchaseOrders.find(p=>p.id===id)
const role=(s,id)=>s.roles.find(r=>r.id===id)
const can=(s,name,roleId,args=[])=>X.allowedBy(role(s,roleId),X.actionRules(name,args))

function confirmedPo(s,lines,extra={},c=ctx(s)){
  const out=A.createPurchaseOrder(s,c,{supplierId:'su1',warehouseId:'w1',lines,status:'Tasdiqlangan',...extra})
  return {s:ok(out,'po: '),id:out.result.id}
}

/* ------------------------------------------------------------- 1 multi-line PO -- */

test('P3-01: a multi-line PO books every line, and draft lines are edited only while it is a draft',()=>{
  let s=base()
  const {s:st,id}=confirmedPo(s,[{materialId:'rm1',qty:100},{materialId:'rm2',qty:50,price:15000}]);s=st
  const po=poOf(s,id)
  assert.equal(po.items.length,2)
  assert.equal(po.total,100*22500+50*15000,'line price defaults to the supplier link; an entered price is kept')
  assert.equal(bal(s,'w1','rm1').incoming,100);assert.equal(bal(s,'w1','rm2').incoming,50)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:1},{materialId:'rm1',qty:2}]}),/ikki qatorda/)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm3',qty:5}]}),/biriktirilmagan/)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:0}]}),/Kamida bitta/)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w3',lines:[{materialId:'rm1',qty:5}]}),/Raw yoki Mixed/)
  const draft=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:10}],status:'Qoralama'});s=ok(draft)
  s=ok(A.updatePurchaseDraft(s,ctx(s),draft.result.id,{lines:[{materialId:'rm1',qty:20},{materialId:'rm2',qty:5}],expectedDate:'2026-11-02'}))
  assert.deepEqual(poOf(s,draft.result.id).items.map(i=>[i.materialId,i.qty]),[['rm1',20],['rm2',5]])
  assert.equal(bal(s,'w1','rm1').incoming,100,'a draft books no incoming')
  refused(s,A.updatePurchaseDraft(s,ctx(s),id,{lines:[{materialId:'rm1',qty:1}]}),/qoralama/)
})

/* -------------------------------------------------- 2/3 partial and duplicate receipts -- */

test('P3-02/03: partial receipts keep the remaining balance, never exceed the PO and a repeated submit posts once',()=>{
  let s=withPolicy(base(),{autoQualityChecks:false})
  const {s:st,id}=confirmedPo(s,[{materialId:'rm2',qty:100}]);s=st
  s=ok(A.receivePurchase(s,ctx(s),id,'rm2',40,undefined,undefined,{key:'k1',supplierLot:'SUP-77',location:'RAW-A1'}))
  let po=poOf(s,id)
  assert.equal(po.status,'Qisman qabul');assert.equal(po.items[0].received,40)
  assert.equal(bal(s,'w1','rm2').onHand,40);assert.equal(bal(s,'w1','rm2').incoming,60)
  const r=po.receipts[0]
  assert.deepEqual([r.supplierLot,r.location,r.receivedBy,r.inspection,r.accepted,r.rejected],['SUP-77','RAW-A1','em1','none',40,0])
  assert.ok(r.lot&&r.lot!=='SUP-77','the internal lot is separate from the supplier lot')
  const before=s.stockMovements.length
  refused(s,A.receivePurchase(s,ctx(s),id,'rm2',40,undefined,undefined,{key:'k1'}),/allaqachon/)
  assert.equal(s.stockMovements.length,before,'no duplicated movement')
  refused(s,A.receivePurchase(s,ctx(s),id,'rm2',61),/oshmasligi/)
  refused(s,A.receivePurchase(s,ctx(s),id,'rm2',-5),/miqdorini/)
  refused(s,A.receivePurchase(s,ctx(s),id,'rm2',10,undefined,undefined,{location:'NOWHERE'}),/joyi yo‘q/)
  refused(s,A.receivePurchase(s,ctx(s),id,'rm2',10,r.lot),/allaqachon mavjud/)
  s=ok(A.receivePurchase(s,ctx(s),id,'rm2',60))
  po=poOf(s,id)
  assert.equal(po.status,'Qabul qilindi');assert.equal(bal(s,'w1','rm2').incoming,0)
  refused(s,A.receivePurchase(s,ctx(s),id,'rm2',1),/to‘liq qabul/)
  assert.equal(ledger(s,'rm2'),100,'ledger = receipts')
  refused(s,A.cancelPurchase(s,ctx(s),id),/Qisman|yopilgan/)
})

/* ------------------------------------------------- 4 incoming QC quarantine / release -- */

test('P3-04: inspected receipts wait in quarantine; a mandatory control point inspects even when sampling would skip',()=>{
  let s=base()
  const {s:st,id}=confirmedPo(s,[{materialId:'rm1',qty:100}]);s=st
  s=ok(A.receivePurchase(s,ctx(s),id,'rm1',100))
  const r=poOf(s,id).receipts[0]
  assert.equal(r.inspection,'pending');assert.equal(r.accepted,0)
  assert.equal(bal(s,'w1','rm1').quarantine,100)
  assert.equal(E.stockOf(s,'rm1').available,0,'nothing is usable before inspection')
  assert.equal(s.lots.find(l=>l.code===r.lot).status,'quarantine')
  const check=s.qualityChecks.find(q=>q.receiptId===r.id)
  assert.equal(check.id,r.qualityCheckId)
  assert.equal(check.controlPointId,'qcp1','the material’s own control point')
  s=ok(A.inspectReceipt(s,ctx(s,'em4'),check.id,100))
  assert.equal(bal(s,'w1','rm1').quarantine,0);assert.equal(E.stockOf(s,'rm1').available,100)
  assert.equal(poOf(s,id).receipts[0].inspection,'accepted')
  refused(s,A.inspectReceipt(s,ctx(s,'em4'),check.id,100),/allaqachon/)
  // Mandatory: automatic checks off and a sampling point that would not fire — a blocking point still inspects.
  let m=withPolicy(base(),{autoQualityChecks:false})
  m={...m,qualityControlPoints:m.qualityControlPoints.map(q=>q.id==='qcp5'?{...q,frequency:'Random',sampleRate:0,blocking:true}:q)}
  const p2=confirmedPo(m,[{materialId:'rm2',qty:30}]);m=p2.s
  m=ok(A.receivePurchase(m,ctx(m),p2.id,'rm2',30))
  assert.equal(bal(m,'w1','rm2').quarantine,30)
  assert.equal(poOf(m,p2.id).receipts[0].inspection,'pending')
})

/* ----------------------------------------------- 5/6 rejected disposition and returns -- */

function splitReceipt(){
  let s=base()
  const {s:st,id}=confirmedPo(s,[{materialId:'rm1',qty:100}]);s=st
  s=ok(A.receivePurchase(s,ctx(s),id,'rm1',100,'LOT-P3-A'))
  const check=s.qualityChecks.find(q=>q.sourceId===id)
  return {s,id,check}
}

test('P3-05: a split inspection releases the accepted part; the rejected part stays apart until scrapped',()=>{
  let {s,id,check}=splitReceipt()
  refused(s,A.inspectReceipt(s,ctx(s,'em4'),check.id,70),/sabab/)
  refused(s,A.inspectReceipt(s,ctx(s,'em4'),check.id,120),/0 dan 100/)
  s=ok(A.inspectReceipt(s,ctx(s,'em4'),check.id,70,'Sirt nuqsoni'))
  const q=s.qualityChecks.find(x=>x.id===check.id)
  assert.deepEqual([q.status,q.acceptedQty,q.rejectedQty],['Failed',70,30])
  assert.equal(bal(s,'w1','rm1').quarantine,30);assert.equal(E.stockOf(s,'rm1').available,70)
  const lots=s.lots.filter(l=>l.code==='LOT-P3-A')
  assert.deepEqual(lots.map(l=>[l.status,l.qty]).sort(),[['available',70],['hold',30]])
  const r=poOf(s,id).receipts[0]
  assert.deepEqual([r.inspection,r.accepted,r.rejected],['partial',70,30])
  assert.equal(SM.rejectedOpen(s,poOf(s,id),r),30)
  assert.ok(s.qualityAlerts.some(a=>a.sourceId===id),'an NCR records the rejection')
  refused(s,A.scrapRejectedReceipt(s,ctx(s,'em4'),check.id,''),/sabab/)
  refused(s,A.scrapRejectedReceipt(s,ctx(s,'em4'),check.id,'yaroqsiz',31),/30/)
  s=ok(A.scrapRejectedReceipt(s,ctx(s,'em4'),check.id,'yaroqsiz',10))
  assert.equal(bal(s,'w1','rm1').onHand,90);assert.equal(bal(s,'w1','rm1').quarantine,20)
  assert.equal(s.lots.find(l=>l.code==='LOT-P3-A'&&l.status==='available').qty,70,'the accepted lot part is untouched')
  assert.equal(ledger(s,'rm1'),90)
})

test('P3-06: a supplier return ships only the undecided rejected units and keeps the history',()=>{
  let {s,id,check}=splitReceipt()
  s=ok(A.inspectReceipt(s,ctx(s,'em4'),check.id,70,'Sirt nuqsoni'))
  s=ok(A.scrapRejectedReceipt(s,ctx(s,'em4'),check.id,'yaroqsiz',10))
  s=ok(A.returnPurchaseToSupplier(s,ctx(s,'em2'),check.id))
  const b=bal(s,'w1','rm1')
  assert.deepEqual([b.onHand,b.quarantine],[70,0])
  const ret=moves(s,'rm1').find(m=>m.type==='Supplier Return -')
  assert.equal(ret.qty,-20);assert.equal(ret.lot,'LOT-P3-A')
  const r=poOf(s,id).receipts[0]
  assert.deepEqual([r.accepted,r.rejected,r.scrapped,r.returned],[70,30,10,20])
  assert.equal(s.qualityChecks.find(q=>q.id===check.id).returnedQty,20)
  assert.equal(s.lots.find(l=>l.code==='LOT-P3-A'&&l.status==='available').qty,70)
  refused(s,A.returnPurchaseToSupplier(s,ctx(s,'em2'),check.id),/allaqachon qaytarilgan/)
  assert.equal(ledger(s,'rm1'),b.onHand,'balance = movements after receipt, scrap and return')
  assert.equal(poOf(s,id).items[0].received,100,'the PO keeps what was received; the return is its own document line')
})

/* -------------------------------------------------------- 7 supplier KPIs -- */

test('P3-07: supplier KPIs come from recorded POs, receipts and inspections — never from the stored rating',()=>{
  let s=base()
  const a=A.createPurchaseOrder(s,ctx(s,'em1',day(-10)),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:100,price:24750}],expectedDate:'2026-10-16',status:'Tasdiqlangan'});s=ok(a)
  const b=A.createPurchaseOrder(s,ctx(s,'em1',day(-9)),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm2',qty:50}],expectedDate:'2026-10-18',status:'Tasdiqlangan'});s=ok(b)
  s=ok(A.receivePurchase(s,ctx(s,'em1',day(-6)),a.result.id,'rm1',100))
  const check=s.qualityChecks.find(q=>q.sourceId===a.result.id)
  s=ok(A.inspectReceipt(s,ctx(s,'em4',day(-6)),check.id,90,'nuqson'))
  const k=SM.supplierPerformance(s,'su1',TODAY)
  assert.equal(k.dueLines,2)
  assert.equal(k.onTimePct,50,'A on time, B overdue and not received')
  assert.equal(k.avgLead,4)
  assert.equal(k.rejectionPct,10)
  assert.equal(k.priceVariancePct,Math.round(225000/(100*22500+50*14200)*1000)/10)
  assert.equal(k.fulfillmentPct,100)
  const none=SM.supplierPerformance(s,'su3',TODAY)
  assert.deepEqual([none.onTimePct,none.avgLead,none.rejectionPct,none.fulfillmentPct],[null,null,null,null])
  assert.ok(none.missing.length>=4,'missing data is named, not guessed')
  assert.equal(SM.supplierPurchaseHistory(s,'su1').length,2)
})

/* ------------------------------------------------------ 8 MRP supplier choice -- */

test('P3-08: without a preferred supplier MRP picks by need date, MOQ-raised total and quoted price',()=>{
  let s=base()
  s={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm2'?{...m,supplierId:''}:m),
    supplierMaterials:[...s.supplierMaterials,{id:'sm-x',supplierId:'su2',materialId:'rm2',supplierSku:'',price:12000,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:2000,leadTime:2,active:true,createdAt:TODAY}]}
  const needBy='2026-10-28'
  let pick=SM.chooseSupplier(s,'rm2',300,needBy,TODAY)
  assert.equal(pick.link.supplierId,'su1','the MOQ makes the cheaper unit price the dearer order')
  s={...s,supplierMaterials:s.supplierMaterials.map(l=>l.id==='sm-x'?{...l,moq:0}:l)}
  pick=SM.chooseSupplier(s,'rm2',300,needBy,TODAY)
  assert.equal(pick.link.supplierId,'su2')
  s={...s,supplierMaterials:s.supplierMaterials.map(l=>l.id==='sm-x'?{...l,leadTime:15}:l)}
  pick=SM.chooseSupplier(s,'rm2',300,needBy,TODAY)
  assert.equal(pick.link.supplierId,'su1','a supplier that cannot deliver by the need date loses')
  s={...s,supplierMaterials:s.supplierMaterials.map(l=>l.id==='sm-x'?{...l,leadTime:2,price:0}:l)}
  const options=SM.supplierOptions(s,'rm2',300,needBy,TODAY)
  assert.equal(options.find(o=>o.link.id==='sm-x').missing,'Narx kiritilmagan')
  assert.equal(SM.chooseSupplier(s,'rm2',300,needBy,TODAY).link.supplierId,'su1','an unquoted price is never "cheapest"')
  // In the plan: demand from an unreserved order, supplier chosen per suggestion with its lot size and lead time.
  s={...s,supplierMaterials:s.supplierMaterials.map(l=>l.id==='sm-x'?{...l,price:12000,moq:500}:l)}
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:100,start:'2026-10-26',due:'2026-10-27'});s=ok(mo)
  const plan=P.runMrp(s,{today:TODAY,bucket:'day',horizonDays:14})
  const sug=plan.suggestions.find(x=>x.itemId==='rm2')
  assert.ok(sug,'rm2 is short')
  assert.equal(sug.blocked,undefined,'two orderable suppliers no longer block the suggestion')
  const chosen=SM.chooseSupplier(s,'rm2',sug.netQty,sug.needDate,TODAY)
  assert.equal(sug.supplierId,chosen.link.supplierId)
  assert.equal(sug.qty,SM.orderProposal(chosen.link,sug.netQty).stockQty,'lot sized by the chosen supplier’s MOQ')
  assert.equal(sug.leadTime,chosen.link.leadTime,'release date uses the chosen supplier’s lead time')
  assert.ok(sug.issues.some(i=>i.startsWith('Supplier:')),'the automatic choice is explained')
})

/* ------------------------------------------------ 9/10 BOM creation and validation -- */

test('P3-09: BOM drafts validate components, by-products and units; released revisions are immutable',()=>{
  let s=base()
  const d=A.createBomDraft(s,ctx(s),'p3');s=ok(d)
  refused(s,A.createBomDraft(s,ctx(s),'p3'),/allaqachon/)
  const draft=s.boms.find(b=>b.id===d.result.id)
  assert.equal(draft.status,'Draft');assert.equal(draft.previousBomId,'bom3')
  const line=(o)=>({...draft,components:[{id:'c1',materialId:'rm2',qty:1,unit:'kg',waste:0,...o}]})
  refused(s,A.saveBom(s,ctx(s),line({qty:0})),/musbat/)
  refused(s,A.saveBom(s,ctx(s),line({materialId:'nope'})),/mavjud bo‘lmagan/)
  refused(s,A.saveBom(s,ctx(s),line({unit:'g'})),/birligi/)
  refused(s,A.saveBom(s,ctx(s),{...line({}),byProducts:[{productId:'p3',qty:1,unit:'dona'}]}),/o‘ziga/)
  refused(s,A.saveBom(s,ctx(s),{...line({}),byProducts:[{productId:'p4',qty:0,unit:'kg'}]}),/0 dan katta/)
  refused(s,A.saveBom(s,ctx(s),{...line({}),waste:120}),/waste/)
  s=ok(A.saveBom(s,ctx(s),{...line({qty:1.2}),byProducts:[{productId:'p4',qty:.02,unit:'kg'}]}))
  s=ok(A.activateBom(s,ctx(s),draft.id))
  const released=s.boms.find(b=>b.id===draft.id)
  assert.equal(released.status,'Faol');assert.ok(released.releasedAt)
  assert.equal(s.boms.find(b=>b.id==='bom3').status,'Arxiv')
  assert.ok(s.boms.find(b=>b.id==='bom3').archivedAt)
  refused(s,A.saveBom(s,ctx(s),{...released,components:released.components.map(c=>({...c,qty:9}))}),/o‘zgartirilmaydi/)
  refused(s,A.saveBom(s,ctx(s),{...s.boms.find(b=>b.id==='bom3'),notes:'x'}),/o‘zgartirilmaydi/)
  refused(s,A.deleteBomDraft(s,ctx(s),'bom3'),/Draft/)
  // Archiving the active revision leaves the product without one; orders keep their snapshots.
  s=ok(A.archiveBom(s,ctx(s),draft.id,'Mahsulot to‘xtatildi'))
  assert.equal(E.activeBomFor(s,'p3'),undefined)
  refused(s,A.archiveBom(s,ctx(s),draft.id,'x'),/allaqachon/)
})

test('P3-10: a multi-level BOM cannot loop back into itself',()=>{
  let s=base()
  const d=A.createBomDraft(s,ctx(s),'p3');s=ok(d)
  const draft=s.boms.find(b=>b.id===d.result.id)
  // p2 contains p3 (bom2); p3 containing p2 would make p3 a component of itself.
  refused(s,A.saveBom(s,ctx(s),{...draft,components:[...draft.components,{id:'loop',materialId:'p2',qty:1,unit:'dona',waste:0}]}),/Aylanma|Recursive/)
  refused(s,A.saveBom(s,ctx(s),{...draft,components:[...draft.components,{id:'self',materialId:'p3',qty:1,unit:'dona',waste:0}]}),/o‘z/)
  const tree=P.explodeBom(s,'bom2',10)
  assert.equal(tree.error,undefined)
  assert.ok(tree.lines.some(l=>l.itemId==='rm2'&&l.level>1),'the existing recursive explosion still reaches the sub-assembly')
})

/* ----------------------------------------------------------- 11 routing -- */

test('P3-11: routing operations validate dependencies and work centers; routings are copied into a new revision',()=>{
  let s=base()
  const d=A.createBomDraft(s,ctx(s),'p1');s=ok(d)
  const draft=s.boms.find(b=>b.id===d.result.id)
  const ops=draft.operations
  refused(s,A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===1?{...o,dependsOn:['ghost']}:o)),/bog‘liq operatsiya/)
  refused(s,A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===1?{...o,dependsOn:[o.id]}:o)),/o‘ziga/)
  refused(s,A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===0?{...o,dependsOn:[ops[ops.length-1].id]}:o)),/aylanma/)
  refused(s,A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===0?{...o,workCenterId:'wc-x'}:o)),/work center/)
  refused(s,A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===0?{...o,setupMin:-1}:o)),/manfiy/)
  refused(s,A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===0?{...o,employeeCount:0}:o)),/operatorlar/)
  const archivedWc={...s,workCenters:s.workCenters.map(w=>w.id===ops[0].workCenterId?{...w,status:'Arxiv'}:w)}
  refused(archivedWc,A.saveRouting(archivedWc,ctx(archivedWc),draft.id,ops),/arxiv/)
  s=ok(A.saveRouting(s,ctx(s),draft.id,ops.map((o,i)=>i===0?{...o,setupMin:o.setupMin+5}:o)))
  // Copy the routing of p2's active BOM into p1's draft: new ids, dependencies follow.
  s=ok(A.copyRouting(s,ctx(s),draft.id,'bom2'))
  const copied=s.boms.find(b=>b.id===draft.id).operations,src=s.boms.find(b=>b.id==='bom2').operations
  assert.equal(copied.length,src.length)
  assert.ok(copied.every(o=>!src.some(x=>x.id===o.id)),'new operation ids')
  for(const [i,o] of copied.entries())assert.deepEqual(o.dependsOn.map(dep=>copied.findIndex(x=>x.id===dep)),(src[i].dependsOn||[]).map(dep=>src.findIndex(x=>x.id===dep)))
  refused(s,A.copyRouting(s,ctx(s),'bom1','bom2'),/o‘zgartirilmaydi/)
  s=ok(A.activateBom(s,ctx(s),draft.id))
  const versions=s.boms.filter(b=>b.productId==='p1').map(b=>[b.version,b.status]).sort()
  assert.deepEqual(versions.map(v=>v[1]).sort(),['Arxiv','Faol'],'the old revision stays readable as history')
})

/* ----------------------------------------------------------- 12 variants -- */

test('P3-12: variant codes are unique and a variant resolves its own BOM, falling back to the product BOM',()=>{
  let s=base()
  refused(s,A.saveVariant(s,ctx(s),'p1',{code:'fg-al-4040-wht',values:{Rang:'qora'},priceDelta:0,status:'Faol'}),/band/)
  refused(s,A.saveVariant(s,ctx(s),'p1',{code:'FG-AL-4040',values:{Rang:'qora'},priceDelta:0,status:'Faol'}),/SKU/)
  refused(s,A.saveVariant(s,ctx(s),'p1',{code:'FG-AL-4040-X',values:{},priceDelta:0,status:'Faol'}),/atribut/)
  const v=A.saveVariant(s,ctx(s),'p1',{code:'fg-al-4040-blk',values:{Rang:'qora',Uzunlik:'6 m'},barcode:'4780001',priceDelta:1500,status:'Faol'});s=ok(v)
  const variant=s.products.find(p=>p.id==='p1').variants.find(x=>x.id===v.result.id)
  assert.equal(variant.code,'FG-AL-4040-BLK');assert.equal(variant.attributes,'Rang: qora · Uzunlik: 6 m')
  refused(s,A.saveVariant(s,ctx(s),'p1',{code:'FG-AL-4040-BLK2',values:{uzunlik:'6 m',rang:'Qora'},priceDelta:0,status:'Faol'}),/xuddi shu atributlar/)
  refused(s,A.saveVariant(s,ctx(s),'p2',{code:'FG-VK-NEW',values:{Rang:'oq'},barcode:'4780001',priceDelta:0,status:'Faol'}),/Shtrix-kod/)
  // A bypassing master-data write cannot create a duplicate code either.
  const p1=s.products.find(p=>p.id==='p1')
  refused(s,A.updateEntity(s,ctx(s),'products','p1',{variants:[...p1.variants,{...variant,id:'dup'}]}),/takrorlanmasin|band/)
  // Variant-specific BOM next to the general one.
  const d=A.createBomDraft(s,ctx(s),'p1',undefined,variant.id);s=ok(d)
  refused(s,A.createBomDraft(s,ctx(s),'p1',undefined,variant.id),/allaqachon/)
  const vd=s.boms.find(b=>b.id===d.result.id)
  assert.equal(vd.variantId,variant.id)
  s=ok(A.saveBom(s,ctx(s),{...vd,components:vd.components.map(c=>c.materialId==='rm3'?{...c,qty:.12}:c)}))
  s=ok(A.activateBom(s,ctx(s),vd.id))
  assert.equal(E.activeBomFor(s,'p1').id,'bom1','the general BOM stays active')
  assert.equal(E.activeBomFor(s,'p1',variant.id).id,vd.id)
  assert.equal(E.activeBomFor(s,'p1','v2').id,'bom1','a variant without its own BOM uses the general one')
  assert.equal(s.products.find(p=>p.id==='p1').defaultBomId,'bom1')
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p1',variantId:variant.id,quantity:5});s=ok(mo)
  const order=s.productionOrders.find(o=>o.id===mo.result.id)
  assert.equal(order.variantId,variant.id);assert.equal(order.bomId,vd.id)
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',lines:[{productId:'p1',variantId:variant.id,qty:2}],mode:'Make-to-stock'});s=ok(so)
  const line=s.salesOrders.find(o=>o.id===so.result.id).items[0]
  assert.equal(line.variantId,variant.id);assert.equal(line.price,s.products.find(p=>p.id==='p1').salePrice+1500)
  // An archived variant is not ordered again; a used one is archived, never removed.
  s=ok(A.saveVariant(s,ctx(s),'p1',{id:variant.id,code:variant.code,values:variant.values,priceDelta:1500,status:'Arxiv'}))
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',variantId:variant.id,quantity:1}),/arxiv/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',variantId:'v3',quantity:1}),/topilmadi/)
  const kept=s.products.find(p=>p.id==='p1')
  refused(s,A.updateEntity(s,ctx(s),'products','p1',{variants:kept.variants.filter(x=>x.id!==variant.id)}),/arxivlang/)
  assert.equal(s.stockBalances.filter(b=>b.itemId===variant.id).length,0,'variants never hold stock of their own')
  // Variants saved as text keep every part when they are edited (an unnamed part is not dropped).
  assert.deepEqual(A.variantValues('Rang: kumush anod · 6 m'),{Rang:'kumush anod','Xususiyat 2':'6 m'})
})

/* --------------------------------------------- 13–16 ECO and historical snapshots -- */

function ecoReady(){
  let s=base()
  const c=A.createEngineeringChange(s,ctx(s,'em2'),{productId:'p1',title:'Billet sarfi',reason:'Chiqindi kamaydi',changeSummary:'rm1 1.13 → 1.1',effectiveDate:TODAY});s=ok(c)
  const eco=s.engineeringChanges.find(e=>e.id===c.result.id)
  const draft=s.boms.find(b=>b.id===eco.newBomId)
  s=ok(A.saveBom(s,ctx(s,'em2'),{...draft,components:draft.components.map(k=>k.materialId==='rm1'?{...k,qty:1.1}:k)}))
  return {s,eco,draftId:draft.id}
}

test('P3-13/14: an approved ECO releases exactly the reviewed revision; old orders keep their snapshot',()=>{
  let {s,eco,draftId}=ecoReady()
  const old=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10});s=ok(old)
  const snapshot=JSON.stringify(s.productionOrders.find(o=>o.id===old.result.id).bomSnapshot)
  refused(s,A.setEcoStatus(s,ctx(s,'em2'),eco.id,'Approved'),/o‘tish mumkin emas/)
  s=ok(A.setEcoStatus(s,ctx(s,'em2'),eco.id,'Review'))
  const reviewed=s.engineeringChanges.find(e=>e.id===eco.id)
  assert.ok(reviewed.changes.some(c=>c.area==='component'&&c.field==='qty'&&c.old==='1.13 kg'&&c.proposed==='1.1 kg'),'old vs proposed values are frozen')
  const draft=s.boms.find(b=>b.id===draftId)
  refused(s,A.saveBom(s,ctx(s,'em2'),{...draft,notes:'late edit'}),/qulflangan/)
  refused(s,A.activateBom(s,ctx(s),draftId),/ECO/)
  refused(s,A.setEcoStatus(s,ctx(s,'em2'),eco.id,'Approved'),/o‘zingiz/)
  s=ok(A.setEcoStatus(s,ctx(s,'em1'),eco.id,'Approved'))
  const approved=s.engineeringChanges.find(e=>e.id===eco.id)
  assert.equal(approved.approvedBy,'em1');assert.ok(approved.approvedAt)
  s=ok(A.applyEngineeringChange(s,ctx(s,'em1'),eco.id))
  const active=E.activeBomFor(s,'p1')
  assert.equal(active.id,draftId);assert.equal(active.ecoId,eco.id)
  assert.equal(active.components.find(k=>k.materialId==='rm1').qty,1.1)
  assert.equal(JSON.stringify(active.components),JSON.stringify(draft.components),'exactly the reviewed content')
  assert.equal(s.boms.find(b=>b.id==='bom1').status,'Arxiv')
  assert.equal(s.boms.find(b=>b.id==='bom1').components.find(k=>k.materialId==='rm1').qty,1.13,'the old revision is unchanged history')
  assert.equal(JSON.stringify(s.productionOrders.find(o=>o.id===old.result.id).bomSnapshot),snapshot,'the old order keeps its BOM and routing')
  const fresh=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:10});s=ok(fresh)
  assert.equal(s.productionOrders.find(o=>o.id===fresh.result.id).bomId,draftId)
  const done=s.engineeringChanges.find(e=>e.id===eco.id)
  assert.deepEqual(done.history.map(h=>h.action),['Yaratildi','Reviewga yuborildi','Tasdiqlandi','Qo‘llandi'])
})

test('P3-15: an ECO is applied once; a revision changed after approval or a stale base is refused without changes',()=>{
  let {s,eco,draftId}=ecoReady()
  s=ok(A.setEcoStatus(s,ctx(s,'em2'),eco.id,'Review'))
  s=ok(A.setEcoStatus(s,ctx(s,'em1'),eco.id,'Approved'))
  // Tampered data (the draft changed although it was locked) is not released.
  const tampered={...s,boms:s.boms.map(b=>b.id===draftId?{...b,components:b.components.map(k=>({...k,qty:k.qty*2}))}:b)}
  refused(tampered,A.applyEngineeringChange(tampered,ctx(tampered),eco.id),/o‘zgargan/)
  // Not before its effective date.
  const future={...s,engineeringChanges:s.engineeringChanges.map(e=>e.id===eco.id?{...e,effectiveDate:'2026-12-01'}:e)}
  refused(future,A.applyEngineeringChange(future,ctx(future),eco.id),/kuchga/)
  const applied=ok(A.applyEngineeringChange(s,ctx(s),eco.id))
  refused(applied,A.applyEngineeringChange(applied,ctx(applied),eco.id),/allaqachon qo‘llangan/)
  refused(applied,A.cancelEngineeringChange(applied,ctx(applied,'em2'),eco.id,'x'),/qo‘llangan/)
  refused(applied,A.setEcoStatus(applied,ctx(applied,'em1'),eco.id,'Rejected'),/o‘tish mumkin emas/)
  // A change raised on a base that is no longer active is refused.
  let t=ecoReady().s
  const e2=t.engineeringChanges[0]
  t=ok(A.setEcoStatus(t,ctx(t,'em2'),e2.id,'Review'));t=ok(A.setEcoStatus(t,ctx(t,'em1'),e2.id,'Approved'))
  t={...t,boms:t.boms.map(b=>b.id==='bom1'?{...b,status:'Arxiv'}:b),products:t.products.map(p=>p.id==='p1'?{...p,defaultBomId:'bom-other'}:p)}
  t={...t,boms:[...t.boms,{...t.boms.find(b=>b.id==='bom1'),id:'bom-other',version:'v9.9',status:'Faol'}]}
  refused(t,A.applyEngineeringChange(t,ctx(t),e2.id),/faol/)
  // Empty change and rejection / cancellation.
  let u=base()
  const c=A.createEngineeringChange(u,ctx(u,'em2'),{productId:'p2',title:'',reason:'test',changeSummary:'',effectiveDate:TODAY});u=ok(c)
  refused(u,A.setEcoStatus(u,ctx(u,'em2'),c.result.id,'Review'),/farq qilmaydi/)
  refused(u,A.createEngineeringChange(u,ctx(u,'em2'),{productId:'p2',title:'',reason:'ikkinchi',changeSummary:'',effectiveDate:TODAY}),/bog‘langan/)
  u=ok(A.cancelEngineeringChange(u,ctx(u,'em2'),c.result.id,'kerak emas'))
  assert.equal(u.engineeringChanges.find(e=>e.id===c.result.id).status,'Cancelled')
})

test('P3-16: ECO approval needs the approve right, never the author, and cancellation is owner or approver only',()=>{
  const s=base()
  assert.equal(can(s,'setEcoStatus','role5',['x','Approved']),false,'operator')
  assert.equal(can(s,'setEcoStatus','role3',['x','Approved']),false,'quality inspector')
  assert.equal(can(s,'setEcoStatus','role6',['x','Review']),false,'warehouse')
  assert.equal(can(s,'setEcoStatus','role2',['x','Review']),true,'engineering may submit')
  assert.equal(can(s,'applyEngineeringChange','role5'),false)
  assert.equal(can(s,'archiveBom','role3'),false)
  let {s:t,eco}=ecoReady()
  t=ok(A.setEcoStatus(t,ctx(t,'em2'),eco.id,'Review'))
  refused(t,A.setEcoStatus(t,ctx(t,'em2'),eco.id,'Approved'),/o‘zingiz/)
  refused(t,A.cancelEngineeringChange(t,ctx(t,'em4'),eco.id,'x'),/muallif yoki tasdiqlovchi/)
  refused(t,A.cancelEngineeringChange(t,ctx(t,'em2'),eco.id,''),/sabab/)
})

/* ------------------------------------------------------- 17–20 maintenance -- */

test('P3-17: maintenance runs requested → planned → in progress → completed, with stop, cost and history',()=>{
  let s=base()
  const req=A.createEntity(s,ctx(s,'em3'),'maintenanceRequests',{code:'MR-P3',equipmentId:'eq2',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:TODAY,reason:'Shovqin',downtimeHours:2},'MR');s=ok(req)
  const ma=A.approveMaintenanceRequest(s,ctx(s,'em5'),req.result.id);s=ok(ma)
  let m=s.maintenanceOrders.find(x=>x.id===ma.result.id)
  assert.deepEqual([m.status,m.scheduled,m.plannedHours,m.technicianId],['Rejada',`${TODAY} 09:00`,2,'em5'])
  refused(s,A.completeMaintenance(s,ctx(s,'em5'),m.id,100),/boshlanishi/)
  s=ok(A.startMaintenance(s,ctx(s,'em5',at(60)),m.id))
  refused(s,A.startMaintenance(s,ctx(s,'em5',at(61)),m.id),/rejalashtirilgan/)
  assert.equal(s.equipment.find(e=>e.id==='eq2').status,'To‘xtagan')
  assert.ok(s.downtimeEvents.some(d=>d.sourceId===m.id&&!d.end))
  refused(s,A.completeMaintenance(s,ctx(s,'em5',at(150)),m.id,-1),/manfiy/)
  s=ok(A.completeMaintenance(s,ctx(s,'em5',at(150)),m.id,250000,'Podshipnik almashtirildi'))
  m=s.maintenanceOrders.find(x=>x.id===m.id)
  assert.deepEqual([m.status,m.downtimeMinutes,m.cost],['Yakunlangan',90,250000])
  assert.deepEqual(m.history.map(h=>h.action),['So‘rovdan rejalashtirildi','Boshlandi','Yakunlandi'])
  assert.ok(s.expenses.some(x=>x.type==='Maintenance'&&x.amount===250000))
  assert.equal(s.maintenanceRequests.find(r=>r.id===req.result.id).status,'Yakunlangan')
  assert.equal(s.equipment.find(e=>e.id==='eq2').nextMaintenance,base().equipment.find(e=>e.id==='eq2').nextMaintenance,'corrective work does not move the preventive plan')
  // Cancellation of planned work only.
  const pm=A.createMaintenanceOrder(s,ctx(s,'em5'),{equipmentId:'eq1',type:'Preventive',scheduled:'2026-10-23',plannedHours:3});s=ok(pm)
  s=ok(A.cancelMaintenance(s,ctx(s,'em5'),pm.result.id,'qism kelmadi'))
  assert.equal(s.maintenanceOrders.find(x=>x.id===pm.result.id).status,'Bekor')
  refused(s,A.cancelMaintenance(s,ctx(s,'em5'),pm.result.id),/rejalashtirilgan/)
  refused(s,A.createMaintenanceOrder(s,ctx(s,'em5'),{equipmentId:'eq1',type:'Preventive',scheduled:'2026-10-01'}),/o‘tgan/)
  refused(s,A.createMaintenanceOrder(s,ctx(s,'em5'),{equipmentId:'eq1',type:'Preventive',scheduled:'2026-10-23',technicianId:'em7'}),/roli/)
})

test('P3-18: preventive plans compute due dates by days, weeks, months and running hours',()=>{
  assert.equal(M.nextDueDate({unit:'day',interval:10},'2026-10-21'),'2026-10-31')
  assert.equal(M.nextDueDate({unit:'week',interval:2},'2026-10-21'),'2026-11-04')
  assert.equal(M.nextDueDate({unit:'month',interval:1},'2026-01-31'),'2026-02-28')
  assert.equal(M.nextDueDate({unit:'runtime',interval:250},'2026-10-21'),undefined)
  let s=base()
  s=ok(A.saveMaintenancePlan(s,ctx(s,'em5'),'eq1',{unit:'week',interval:2,durationHours:4}))
  let eq=s.equipment.find(e=>e.id==='eq1')
  assert.equal(eq.nextMaintenance,'2026-11-04','no service yet: the plan counts from today')
  assert.equal(M.maintenanceDue(eq,TODAY).state,'ok')
  assert.equal(M.maintenanceDue({...eq,nextMaintenance:'2026-10-19'},TODAY).state,'overdue')
  assert.equal(M.maintenanceDue({...eq,nextMaintenance:'2026-10-23'},TODAY).state,'soon')
  refused(s,A.saveMaintenancePlan(s,ctx(s,'em5'),'eq1',{unit:'week',interval:0}),/musbat/)
  // Running hours: without readings the plan cannot say anything.
  s=ok(A.saveMaintenancePlan(s,ctx(s,'em5'),'eq2',{unit:'runtime',interval:250}))
  assert.equal(M.maintenanceDue(s.equipment.find(e=>e.id==='eq2'),TODAY).state,'no-data')
  s=ok(A.recordEquipmentRuntime(s,ctx(s,'em5'),'eq2',1000))
  s=ok(A.recordEquipmentRuntime(s,ctx(s,'em5'),'eq2',1100))
  assert.deepEqual([M.maintenanceDue(s.equipment.find(e=>e.id==='eq2'),TODAY).usedHours,M.maintenanceDue(s.equipment.find(e=>e.id==='eq2'),TODAY).leftHours],[100,150])
  refused(s,A.recordEquipmentRuntime(s,ctx(s,'em5'),'eq2',1050),/kamaya olmaydi/)
  s=ok(A.recordEquipmentRuntime(s,ctx(s,'em5'),'eq2',1260))
  assert.equal(M.maintenanceDue(s.equipment.find(e=>e.id==='eq2'),TODAY).state,'overdue')
  assert.ok(s.notifications.some(n=>n.title==='Servis vaqti keldi'))
  // Planning: due machines get one PM each; a machine without a plan is reported.
  s={...s,equipment:s.equipment.map(e=>e.id==='eq3'?{...e,maintenanceIntervalDays:0,maintenancePlan:undefined,nextMaintenance:''}:e)}
  const planned=A.planPreventiveMaintenance(s,ctx(s,'em5'),20);s=ok(planned)
  assert.match(planned.result.message,/reja ma’lumoti yo‘q/)
  const pm=s.maintenanceOrders.filter(m=>m.type==='Preventive')
  assert.deepEqual(pm.map(m=>m.equipmentId).sort(),['eq1','eq2'])
  assert.equal(pm.find(m=>m.equipmentId==='eq2').scheduled,`${TODAY} 09:00`,'overdue runtime service is planned for today')
  assert.equal(pm.find(m=>m.equipmentId==='eq1').plannedHours,4)
  assert.equal(A.planPreventiveMaintenance(s,ctx(s,'em5'),20).state,s,'no duplicate PM orders')
  // Completing the preventive service restarts the plan.
  const eq2pm=pm.find(m=>m.equipmentId==='eq2')
  s=ok(A.startMaintenance(s,ctx(s,'em5'),eq2pm.id));s=ok(A.completeMaintenance(s,ctx(s,'em5',at(120)),eq2pm.id,0))
  eq=s.equipment.find(e=>e.id==='eq2')
  assert.equal(eq.runtimeAtService,1260);assert.equal(M.maintenanceDue(eq,TODAY).leftHours,250)
  const eq1pm=pm.find(m=>m.equipmentId==='eq1')
  s=ok(A.startMaintenance(s,ctx(s,'em5'),eq1pm.id));s=ok(A.completeMaintenance(s,ctx(s,'em5',at(240)),eq1pm.id,0))
  assert.equal(s.equipment.find(e=>e.id==='eq1').nextMaintenance,'2026-11-04')
})

test('P3-19: planned maintenance takes capacity once, and overlapping services of one machine need an override',()=>{
  let s=base()
  const wc2=s.workCenters.find(w=>w.id==='wc2')
  const before=E.workCenterDay(s,wc2,'2026-10-22',T0)
  const pm=A.createMaintenanceOrder(s,ctx(s,'em5'),{equipmentId:'eq2',type:'Preventive',scheduled:'2026-10-22 09:00',plannedHours:4});s=ok(pm)
  const after=E.workCenterDay(s,wc2,'2026-10-22',T0)
  assert.equal(after.blocked-before.blocked,240)
  assert.equal(after.clock,before.clock-240)
  const clash=A.createMaintenanceOrder(s,ctx(s,'em5'),{equipmentId:'eq2',type:'Corrective',scheduled:'2026-10-22 11:00',plannedHours:2})
  refused(s,clash,/kesishadi/);assert.equal(clash.result.code,'needs-override')
  const forced=A.createMaintenanceOrder(s,ctx(s,'em5'),{equipmentId:'eq2',type:'Corrective',scheduled:'2026-10-22 11:00',plannedHours:2,override:'Favqulodda, birga bajariladi'})
  assert.ok(forced.result.ok);assert.equal(forced.state.maintenanceOrders.find(m=>m.id===forced.result.id).override.reason,'Favqulodda, birga bajariladi')
  // Work in progress across midnight: tomorrow loses only the rest of the planned window — the stop so far is not added twice.
  let t=base()
  const run=A.createMaintenanceOrder(t,ctx(t,'em5'),{equipmentId:'eq2',type:'Corrective',scheduled:`${TODAY} 08:00`,plannedHours:30});t=ok(run)
  t=ok(A.startMaintenance(t,ctx(t,'em5'),run.result.id))
  const tomorrow=E.workCenterDay(t,t.workCenters.find(w=>w.id==='wc2'),'2026-10-22',at(60))
  assert.equal(tomorrow.blocked,360,'08:00–14:00 of the planned 30 h')
  // The finite schedule avoids the planned window.
  assert.equal(P.scheduleConflicts(s,{workOrders:[{id:'w',operationId:'o',workCenterId:'wc2',status:'Tayyor',dependsOn:[]}]},'2026-10-22',T0).length,0,'a partial service does not block the whole day')
})

test('P3-20: MTBF / MTTR come from recorded failures only, with an explicit insufficient-data state',()=>{
  let s=base()
  let r=M.reliabilityOf(s,'eq1')
  assert.deepEqual([r.failures,r.mtbfHours,r.mttrHours],[0,null,null])
  assert.ok(r.mtbfNote&&r.mttrNote)
  s=ok(A.startDowntime(s,ctx(s,'em2'),'eq1','Unplanned stop','Moy oqishi'))
  s=ok(A.endDowntime(s,ctx(s,'em2',at(60)),s.downtimeEvents[0].id))
  // A planned service and a set-up are not failures.
  s=ok(A.startDowntime(s,ctx(s,'em2',at(120)),'eq1','Setup / changeover'))
  s=ok(A.endDowntime(s,ctx(s,'em2',at(150)),s.downtimeEvents[0].id))
  r=M.reliabilityOf(s,'eq1')
  assert.deepEqual([r.failures,r.mttrHours,r.mtbfHours],[1,1,null])
  s=ok(A.startDowntime(s,ctx(s,'em2',at(600)),'eq1','Unplanned stop','Qayta'))
  s=ok(A.endDowntime(s,ctx(s,'em2',at(690)),s.downtimeEvents[0].id))
  r=M.reliabilityOf(s,'eq1')
  assert.deepEqual([r.failures,r.mttrHours,r.mtbfHours],[2,1.3,9],'MTBF = running time between the two failures (60 → 600 min)')
  assert.equal(s.equipment.find(e=>e.id==='eq1').mtbf,base().equipment.find(e=>e.id==='eq1').mtbf,'nothing is written into the legacy fields')
})

/* ---------------------------------------------------------- 21 RBAC / scope -- */

test('P3-21: the new commands follow role permissions and location scope',()=>{
  const s=base()
  for(const name of ['updatePurchaseDraft','inspectReceipt','scrapRejectedReceipt','saveRouting','copyRouting','archiveBom','saveVariant','cancelEngineeringChange','createMaintenanceOrder','updateMaintenanceOrder','saveMaintenancePlan','recordEquipmentRuntime'])assert.ok(X.actionRules(name,[]),`${name} has a rule`)
  assert.equal(can(s,'inspectReceipt','role3'),true,'quality inspects')
  assert.equal(can(s,'inspectReceipt','role6'),false,'the warehouse does not decide quality')
  assert.equal(can(s,'scrapRejectedReceipt','role6'),false)
  assert.equal(can(s,'updatePurchaseDraft','role3'),false)
  assert.equal(can(s,'createMaintenanceOrder','role4'),true,'maintenance engineer')
  assert.equal(can(s,'createMaintenanceOrder','role5'),false,'operator')
  assert.equal(can(s,'saveVariant','role6'),false)
  assert.equal(can(s,'saveRouting','role2'),true)
  // Location scope: the maintenance engineer (branch b1) cannot plan work on a b2 machine.
  const t={...s,equipment:[...s.equipment,{...s.equipment[0],id:'eq9',name:'B2 press',serial:'B2',workCenterId:'wc4'}]}
  const em5=t.employees.find(e=>e.id==='em5')
  assert.match(X.scopeBlocker(t,em5,'createMaintenanceOrder',[{equipmentId:'eq9'}]),/filial/)
  assert.equal(X.scopeBlocker(t,em5,'createMaintenanceOrder',[{equipmentId:'eq2'}]),null)
  const out=A.createMaintenanceOrder(t,ctx(t,'em5'),{equipmentId:'eq9',type:'Corrective',scheduled:'2026-10-22'})
  assert.ok(out.result.ok,'the domain itself does not know scope; the app checks scope before every call')
  const order=out.state.maintenanceOrders.find(m=>m.id===out.result.id)
  assert.match(X.scopeBlocker(out.state,em5,'startMaintenance',[order.id]),/filial/,'existing orders are scoped by their machine too')
  // A warehouse-bound role inspects / disposes only receipts of its own warehouse.
  const keeper={...t.employees[0],id:'emw',roleId:'role6',warehouseId:'w4'}
  let u={...withPolicy(base(),{}),employees:[...base().employees,keeper]}
  const po=confirmedPo(u,[{materialId:'rm1',qty:10}]);u=po.s
  u=ok(A.receivePurchase(u,ctx(u),po.id,'rm1',10))
  const check=u.qualityChecks.find(q=>q.sourceId===po.id)
  assert.match(X.scopeBlocker(u,keeper,'scrapRejectedReceipt',[check.id,'x']),/omboriga/)
  assert.match(X.scopeBlocker(u,keeper,'updatePurchaseDraft',[po.id,{warehouseId:'w1'}]),/omboriga/)
})

/* ------------------------------------------------------ 22 earlier workflows -- */

test('P3-22: the demo history still builds and the MRP → PO → receive → QC flow runs end to end',()=>{
  const seeded=createSeedState(T0)
  assert.ok(seeded.engineeringChanges.some(e=>e.status==='Applied'&&e.history?.length),'the seed ECO went through the new workflow')
  assert.ok(seeded.engineeringChanges.some(e=>e.status==='Review'&&e.changes?.length))
  let s=base()
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:200,start:'2026-10-23',due:'2026-10-26'});s=ok(mo)
  const plan=P.runMrp(s,{today:TODAY,bucket:'day',horizonDays:14})
  const sug=plan.suggestions.find(x=>x.itemId==='rm2')
  const po=A.confirmMrpSuggestion(s,ctx(s),sug.key,{bucket:'day',horizonDays:14});s=ok(po)
  s=ok(A.confirmPurchase(s,ctx(s),po.result.id))
  const qty=poOf(s,po.result.id).items[0].qty
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',qty))
  const check=s.qualityChecks.find(q=>q.sourceId===po.result.id)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed'))
  assert.equal(poOf(s,po.result.id).receipts[0].inspection,'accepted')
  assert.equal(bal(s,'w1','rm2').quarantine,0)
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'))
  assert.ok(s.productionOrders.find(o=>o.id===mo.result.id).materialReserved,'the received material is reserved for the order')
})
