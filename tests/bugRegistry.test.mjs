// Regression tests for the unified bug register (docs/BUG_REGISTRY.md). One test per fixed finding,
// named by its register ID; each one reproduces the original defect and asserts the fixed behaviour.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createSeedState,createInitialState} from '../.test-dist/mockData.mjs'
import {orderCosting,estimateOrderCost,remainingQty,stockOf,orderQcHold} from '../.test-dist/manufacturingEngine.mjs'
import {toCsv,neutralize} from '../.test-dist/exportData.mjs'
import {isoDate,addDays} from '../.test-dist/dates.mjs'

let counter=0
const fresh=()=>createSeedState(new Date())
const ctx=(s,userId='em1',now=new Date())=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-r${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(out,pattern)=>{assert.equal(out.result.ok,false,'expected the action to be refused');if(pattern)assert.match(out.result.message,pattern);return out}
const orderOf=(s,id)=>s.productionOrders.find(o=>o.id===id)
const balanceOf=(s,warehouseId,itemId)=>s.stockBalances.find(b=>b.warehouseId===warehouseId&&b.itemId===itemId)
const today=()=>isoDate(new Date())

function confirmed(s,productId='p1',quantity=10,extra={}){
  const created=A.createProductionOrder(s,ctx(s),{productId,quantity,...extra});s=ok(created,'create: ')
  s=ok(A.transitionProduction(s,ctx(s),created.result.id,'Tasdiqlangan'),'confirm: ')
  return {s,id:created.result.id}
}
function started(s,productId='p1',quantity=10,extra){
  const c=confirmed(s,productId,quantity,extra)
  return {s:ok(A.transitionProduction(c.s,ctx(c.s),c.id,'Jarayonda'),'start: '),id:c.id}
}
function finishOps(s,id){
  for(const wo of orderOf(s,id).workOrders.filter(w=>w.status!=='Yakunlangan')){
    s=ok(A.startWorkOrder(s,ctx(s),id,wo.id),'wo start: ')
    s=ok(A.finishWorkOrder(s,ctx(s),id,wo.id),'wo finish: ')
  }
  return s
}
function passPending(s,id,userId='em4'){
  for(const q of s.qualityChecks.filter(q=>q.sourceId===id&&q.status==='Pending'))s=ok(A.resolveQuality(s,ctx(s,userId),q.id,'Passed'),'pass: ')
  return s
}
/** Ops done, `good` reported, sent to QC. */
function inQc(s,id,good=remainingQty(orderOf(s,id))){
  s=finishOps(s,id)
  s=ok(A.reportOutput(s,ctx(s),id,good,0),'output: ')
  return ok(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'),'to QC: ')
}
function quarantinedReceipt(s,qty=5,lot='REG-LOT'){
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty,price:22500}],status:'Tasdiqlangan'});s=ok(po)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm1',qty,lot))
  return {s,poId:po.result.id,check:s.qualityChecks.find(q=>q.sourceId===po.result.id&&q.status==='Pending')}
}

/* ------------------------------------------------------------------ Critical / High ---------------- */

test('BUG-04: adding a raw warehouse does not move where orders reserve and issue raw material',()=>{
  let s=fresh()
  s=ok(A.createEntity(s,ctx(s),'warehouses',{name:'Yangi xomashyo',code:'WH-RAW2',branchId:'b1',type:'Raw',status:'Faol',locations:[]},'Ombor'))
  assert.equal(A.rawWarehouseFor(s,'w3'),'w1','the branch default raw store stays the source')
  const before=balanceOf(s,'w1','rm1').reserved
  const c=confirmed(s,'p1',10);s=c.s
  assert.equal(orderOf(s,c.id).status,'Tasdiqlangan','reserved from w1, not waiting on the empty new store')
  assert.ok(balanceOf(s,'w1','rm1').reserved>before)
})

test('BUG-05b: a decided quality check cannot be decided again',()=>{
  let {s,check}=quarantinedReceipt(fresh())
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed'))
  refused(A.resolveQuality(s,ctx(s,'em4'),check.id,'Scrap','again'),/allaqachon hal qilingan/)
})

test('BUG-06: an order sent to QC with quantity left can go back, produce the rest and close normally',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=finishOps(s,id)
  refused(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'),/natijasini qayd eting/)
  s=ok(A.reportOutput(s,ctx(s),id,6,0))
  s=ok(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'))
  refused(A.reportOutput(s,ctx(s),id,4,0))
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'),'back from QC: ')
  s=ok(A.reportOutput(s,ctx(s),id,4,0))
  s=ok(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'))
  s=passPending(s,id)
  s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'))
  assert.equal(orderOf(s,id).completed,10)
  assert.equal(orderOf(s,id).quantity,10,'never closed with quantity 0')
})

test('BUG-06: short close without any output is refused (it would complete with quantity 0)',()=>{
  const {s,id}=started(fresh(),'p1',10)
  refused(A.shortCloseProduction(s,ctx(s),id,'x'),/bekor qiling/)
})

test('BUG-07: the stock ledger is never truncated and document references never repeat',()=>{
  let s=createInitialState()
  for(let i=0;i<650;i++)s=ok(A.adjustStock(s,ctx(s),'rm4','w1',1,'count'))
  const moved=s.stockMovements.filter(m=>m.itemId==='rm4'&&m.warehouseId==='w1').reduce((a,m)=>a+m.qty,0)
  assert.equal(s.stockMovements.length,650)
  assert.equal(moved,balanceOf(s,'w1','rm4').onHand)
  const refs=s.stockMovements.map(m=>m.source)
  assert.equal(new Set(refs).size,refs.length,'every ADJ reference is unique')
})

test('BUG-08: a completed order keeps the cost it had when it closed',()=>{
  const s=fresh()
  const done=s.productionOrders.find(o=>o.status==='Yakunlangan'&&o.costSnapshot)
  assert.ok(done,'completed orders store a cost snapshot')
  const before=orderCosting(s,done).actual.total
  const repriced={...s,rawMaterials:s.rawMaterials.map(m=>({...m,standardCost:m.standardCost*2})),employees:s.employees.map(e=>({...e,hourlyCost:e.hourlyCost*3}))}
  assert.equal(orderCosting(repriced,orderOf(repriced,done.id)).actual.total,before)
  assert.equal(done.actualCost,done.costSnapshot.actual.total,'stored actualCost uses the same formula')
})

/* ------------------------------------------------------------------ Medium ------------------------- */

test('BUG-09: the open rest of a partially received PO can be closed and stops counting as incoming',()=>{
  let s=createInitialState()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',warehouseId:'w1',lines:[{materialId:'rm1',qty:1000,price:22500}],status:'Tasdiqlangan'});s=ok(po)
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,autoQualityChecks:false}}}
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm1',400))
  refused(A.cancelPurchase(s,ctx(s),po.result.id))
  refused(A.closePurchaseShort(s,ctx(s),po.result.id,''),/sabab/i)
  s=ok(A.closePurchaseShort(s,ctx(s),po.result.id,'supplier stopped'))
  assert.equal(balanceOf(s,'w1','rm1').incoming,0)
  assert.equal(s.purchaseOrders.find(p=>p.id===po.result.id).status,'Qabul qilindi')
  assert.equal(balanceOf(s,'w1','rm1').onHand,400,'what was received stays')
})

test('BUG-10: a stock count cannot take stock below what is reserved plus quarantined',()=>{
  let {s}=quarantinedReceipt(createInitialState(),5)
  refused(A.adjustStock(s,ctx(s),'rm1','w1',-5,'count'),/karantin/)
})

test('BUG-11: maintenance can start while a breakdown stop is open and ends that stop',()=>{
  let s=fresh()
  s=ok(A.startDowntime(s,ctx(s),'eq3','Unplanned stop','breakdown'))
  const req=A.createEntity(s,ctx(s),'maintenanceRequests',{code:'MR-REG-01',equipmentId:'eq3',type:'Corrective',priority:'Kritik',status:'Yangi',requestedBy:'em2',scheduled:'',reason:'x',downtimeHours:1},'MR');s=ok(req)
  const ma=A.approveMaintenanceRequest(s,ctx(s),req.result.id);s=ok(ma)
  s=ok(A.startMaintenance(s,ctx(s),ma.result.id),'start during breakdown: ')
  assert.equal(s.downtimeEvents.filter(d=>d.equipmentId==='eq3'&&!d.end).length,1,'one stop, not two')
  s=ok(A.completeMaintenance(s,ctx(s),ma.result.id,0))
  assert.equal(s.downtimeEvents.filter(d=>d.equipmentId==='eq3'&&!d.end).length,0)
})

test('BUG-12: an item unit cannot change once quantities exist in it, and BOM lines use the stock unit',()=>{
  let s=fresh()
  refused(A.updateEntity(s,ctx(s),'rawMaterials','rm1',{unit:'g'},'Xomashyo'),/birligini/)
  const bom=s.boms.find(b=>b.id==='bom1')
  refused(A.saveBom(s,ctx(s),{...bom,components:bom.components.map(c=>c.materialId==='rm1'?{...c,unit:'g'}:c)}),/birligi/)
})

test('BUG-13: the same output report submitted twice is posted once',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=ok(A.reportOutput(s,ctx(s),id,4,0,'','key-1'))
  refused(A.reportOutput(s,ctx(s),id,4,0,'','key-1'),/allaqachon/)
  assert.equal(orderOf(s,id).completed,4)
})

test('BUG-15 / N-16: master data writes keep SKUs unique and NCRs need a root cause to close',()=>{
  let s=fresh()
  refused(A.createEntity(s,ctx(s),'rawMaterials',{name:'Dup',sku:'fg-al-4040',unit:'kg'},'Xomashyo'),/SKU/)
  const dup=A.duplicateEntity(s,ctx(s),'products','p1','Mahsulot');s=ok(dup)
  const dup2=A.duplicateEntity(s,ctx(s),'products','p1','Mahsulot');s=ok(dup2)
  assert.notEqual(s.products.find(p=>p.id===dup.result.id).sku,s.products.find(p=>p.id===dup2.result.id).sku)
  const alert=s.qualityAlerts.find(a=>a.status!=='Yopilgan')
  if(alert)refused(A.updateEntity(s,ctx(s),'qualityAlerts',alert.id,{status:'Yopilgan',rootCause:''},'NCR'),/root cause/)
})

test('BUG-18: exported cells never start a spreadsheet formula; time is booked to who starts the work',()=>{
  assert.equal(neutralize('=HYPERLINK("x")'),`'=HYPERLINK("x")`)
  assert.equal(neutralize('@SUM(A1)'),`'@SUM(A1)`)
  assert.equal(neutralize(-5),'-5','numbers stay numbers')
  assert.equal(toCsv([{a:'+1'}]),"a\r\n'+1")
  let {s,id}=started(fresh(),'p1',10)
  const wo=orderOf(s,id).workOrders[0]
  s=ok(A.startWorkOrder(s,ctx(s,'em6'),id,wo.id))
  assert.equal(s.timeLogs.find(t=>t.workOrderId===wo.id).employeeId,'em6')
})

/* ------------------------------------------------------------------ QC state chain (N-xx) ---------- */

test('N-01: no Final check before output; output added after a pass needs a new pass',()=>{
  let {s,id}=started(fresh(),'p1',10)
  refused(A.createQualityCheck(s,ctx(s,'em4'),{type:'Final',sourceType:'production',sourceId:id,itemId:'p1'}),/natija/)
  s=inQc(s,id,6)
  s=passPending(s,id)
  assert.equal(orderOf(s,id).qualityStatus,'Passed')
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'))
  s=ok(A.reportOutput(s,ctx(s),id,4,0))
  assert.equal(orderOf(s,id).qualityStatus,'Pending','the new 4 are uninspected')
  assert.equal(orderQcHold(s,orderOf(s,id)),4)
  s=ok(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'))
  refused(A.transitionProduction(s,ctx(s),id,'Yakunlangan'),/Passed emas|Pending/)
  s=passPending(s,id)
  s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'))
})

test('N-02: a Final scrap decision removes the held units from stock, so they can never be released',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,10)
  const o=orderOf(s,id),before=balanceOf(s,o.warehouseId,'p1')
  const q=s.qualityChecks.find(x=>x.sourceId===id&&x.type==='Final'&&x.status==='Pending')
  s=ok(A.resolveQuality(s,ctx(s,'em4'),q.id,'Scrap','cracked'))
  const after=balanceOf(s,o.warehouseId,'p1')
  assert.equal(before.onHand-after.onHand,10)
  assert.equal(before.quarantine-after.quarantine,10)
  assert.equal(orderOf(s,id).scrap,10)
  assert.equal(orderOf(s,id).completed,0)
  s=passPending(s,id)
  s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'),'a fully scrapped order may close: ')
  assert.equal(balanceOf(s,o.warehouseId,'p1').quarantine,after.quarantine,'nothing released later')
})

test('N-03: a receipt is returned to the supplier only once',()=>{
  let {s,check}=quarantinedReceipt(fresh(),5)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.id,'Failed','bad cert'))
  s=ok(A.returnPurchaseToSupplier(s,ctx(s),check.id))
  refused(A.returnPurchaseToSupplier(s,ctx(s),check.id),/allaqachon/)
})

test('N-04: orders of different sales orders are not merged; a merge keeps its sales order linked',()=>{
  let s=createInitialState()
  s={...s,stockBalances:[]}
  const so1=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p1',qty:5,mode:'Make-to-order',deliveryDate:addDays(today(),5)});s=ok(so1)
  const so2=A.createSalesOrder(s,ctx(s),{customerId:'cu2',productId:'p1',qty:5,mode:'Make-to-order',deliveryDate:addDays(today(),5)});s=ok(so2)
  const ids=s.productionOrders.filter(o=>o.salesOrderId).map(o=>o.id)
  refused(A.mergeProduction(s,ctx(s),ids),/sotuv/)
})

test('N-05: a customer-return check is decided only through the return disposition',()=>{
  const s=fresh()
  const ret=s.returns.find(r=>r.status==='Inspection')
  refused(A.resolveQuality(s,ctx(s,'em4'),ret.qualityCheckId,'Passed'),/Qaytarishlar/)
  refused(A.createQualityCheck(s,ctx(s,'em4'),{sourceType:'return',sourceId:ret.id,itemId:ret.productId}))
})

test('N-06: rework is limited to units that exist and are not already being reworked',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,10)
  refused(A.createReworkOrder(s,ctx(s),id,5000,'x'),/oshmasligi/)
  s=ok(A.createReworkOrder(s,ctx(s),id,6,'x'))
  refused(A.createReworkOrder(s,ctx(s),id,5,'x'),/oshmasligi/)
})

test('N-08: switching Final QC off mid-run releases the held output at completion',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,10)
  const o=orderOf(s,id),q0=balanceOf(s,o.warehouseId,'p1').quarantine
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:false}}}
  s={...s,qualityChecks:s.qualityChecks.map(q=>q.sourceId===id&&q.status==='Pending'?{...q,status:'Hold'}:q)}
  s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'))
  assert.equal(q0-balanceOf(s,o.warehouseId,'p1').quarantine,10)
})

test('N-09: operations of a cancelled order are frozen',()=>{
  let {s,id}=started(fresh(),'p1',10)
  const wo=orderOf(s,id).workOrders[0]
  s=ok(A.startWorkOrder(s,ctx(s),id,wo.id))
  s=ok(A.transitionProduction(s,ctx(s),id,'Bekor qilingan'))
  refused(A.finishWorkOrder(s,ctx(s),id,wo.id),/holatida/)
})

test('N-10 / B3-09: records still in use cannot be deleted',()=>{
  const s=fresh()
  refused(A.deleteEntity(s,ctx(s),'productionLines',s.settings.defaultLineId,'Liniya'))
  refused(A.deleteEntity(s,ctx(s),'branches',s.settings.defaultBranchId,'Filial'))
  refused(A.deleteEntity(s,ctx(s),'workCenters','wc3','WC'),/uskuna|operatsiya/)
})

test('N-12: the author of an ECO does not approve it',()=>{
  const s=fresh()
  const eco=s.engineeringChanges.find(e=>e.status==='Review')
  refused(A.setEcoStatus(s,ctx(s,eco.ownerId),eco.id,'Approved'),/o‘zingiz/)
})

test('N-13: an order with an open in-process inspection is not completed',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,10)
  const fin=s.qualityChecks.find(q=>q.sourceId===id&&q.type==='Final'&&q.status==='Pending')
  s=ok(A.resolveQuality(s,ctx(s,'em4'),fin.id,'Passed'))
  assert.ok(s.qualityChecks.some(q=>q.sourceId===id&&q.type==='Jarayon'&&q.status==='Pending'),'fixture: auto in-process checks are pending')
  refused(A.transitionProduction(s,ctx(s),id,'Yakunlangan'),/Pending/)
})

test('N-15: planned labor is costed with production wages, not the company average',()=>{
  const s=fresh()
  const bom=s.boms.find(b=>b.id==='bom1')
  const base=estimateOrderCost(s,{bomSnapshot:bom,quantity:100}).labor
  const bossRaise={...s,employees:s.employees.map(e=>e.department==='Management'?{...e,hourlyCost:e.hourlyCost*50}:e)}
  assert.equal(estimateOrderCost(bossRaise,{bomSnapshot:bom,quantity:100}).labor,base,'management wages do not move planned labor')
})

test('N-21 / B3-11: transfers go only to an active warehouse that stores that kind of item',()=>{
  let s=fresh()
  refused(A.transferStock(s,ctx(s),'rm1','w1','nope',1),/mavjud emas/)
  refused(A.transferStock(s,ctx(s),'rm1','w1','w3',1),/saqlamaydi/)
  s={...s,warehouses:s.warehouses.map(w=>w.id==='w4'?{...w,status:'Arxiv'}:w)}
  refused(A.transferStock(s,ctx(s),'p1','w3','w4',1),/arxiv/)
})

test('N-22: found stock of a lot-tracked material gets its own lot',()=>{
  let s=fresh()
  const lots=s.lots.length
  s=ok(A.adjustStock(s,ctx(s),'rm1','w1',7,'found'))
  assert.equal(s.lots.length,lots+1)
  assert.equal(s.lots[0].qty,7)
})

test('N-23 / B3-14: a due date before the start is refused; same-day MTO delivery is due today',()=>{
  let s=createInitialState()
  refused(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5,start:today(),due:addDays(today(),-1)}),/Muddat/)
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p1',qty:5,mode:'Make-to-order',deliveryDate:today()});s=ok(so)
  const mo=s.productionOrders.find(o=>o.salesOrderId===so.result.id)
  assert.equal(mo.due,today())
})

test('N-24: a split make-to-order child is listed on its sales order',()=>{
  let s=fresh()
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p3',qty:20,mode:'Make-to-order',deliveryDate:addDays(today(),6)});s=ok(so)
  const mo=s.productionOrders.find(o=>o.salesOrderId===so.result.id)
  const sp=A.splitProduction(s,ctx(s),mo.id,5);s=ok(sp)
  assert.ok(s.salesOrders.find(x=>x.id===so.result.id).productionOrderIds.includes(sp.result.id))
})

test('N-25: low-stock alerts are de-duplicated per material, not by SKU text',()=>{
  let s=createInitialState()
  // The longer SKU is alerted first; its text contains rm1's SKU, which used to suppress rm1's own alert.
  s={...s,rawMaterials:[{...s.rawMaterials[0],id:'rmx',sku:`${s.rawMaterials[0].sku}-X`,name:'Variant'},...s.rawMaterials]}
  s=ok(A.adjustStock(s,ctx(s),'rmx','w1',1,'x'))
  s=ok(A.adjustStock(s,ctx(s),'rm1','w1',1,'x'))
  const paths=s.notifications.filter(n=>n.type==='low-stock').map(n=>n.path)
  assert.ok(paths.includes('/materials?view=all&id=rm1')&&paths.includes('/materials?view=all&id=rmx'),'both materials alerted')
})

test('N-26: completing a repair books its parts and labour as maintenance cost',()=>{
  let s=fresh()
  const ro=A.createEntity(s,ctx(s),'repairOrders',{code:'REP-REG',equipmentId:'eq3',status:'Yangi',issue:'x',technicianId:'em5',partsCost:100000,laborHours:2,createdAt:''},'Repair');s=ok(ro)
  for(let i=0;i<4;i++)s=ok(A.advanceRepair(s,ctx(s),ro.result.id))
  const rate=s.employees.find(e=>e.id==='em5').hourlyCost
  assert.ok(s.expenses.some(e=>e.type==='Maintenance'&&e.amount===100000+2*rate))
})

/* ------------------------------------------------------------------ Audit #3 (B3-xx) --------------- */

test('B3-01: a split child of a passed order starts uninspected',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,4)
  s=passPending(s,id)
  assert.equal(orderOf(s,id).qualityStatus,'Passed')
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'))
  const sp=A.splitProduction(s,ctx(s),id,3);s=ok(sp)
  assert.equal(orderOf(s,sp.result.id).qualityStatus,'Pending')
})

test('B3-03: an incoming check must name one receipt',()=>{
  const {s,poId}=quarantinedReceipt(fresh())
  refused(A.createQualityCheck(s,ctx(s,'em4'),{type:'Kirish',sourceType:'purchase',sourceId:poId,itemId:'rm1'}),/receipt/)
})

test('B3-04: one product sits on one sales line',()=>{
  const s=fresh()
  refused(A.createSalesOrder(s,ctx(s),{customerId:'cu1',lines:[{productId:'p1',qty:2},{productId:'p1',qty:2}],mode:'Make-to-stock'}),/ikki qatorda/)
})

test('B3-05: expired material is neither received nor issued',()=>{
  let s=fresh()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su2',warehouseId:'w1',lines:[{materialId:'rm3',qty:10,price:68000}],status:'Tasdiqlangan'});s=ok(po)
  refused(A.receivePurchase(s,ctx(s),po.result.id,'rm3',10,'OLD',addDays(today(),-30)),/muddati o‘tgan/)
  // Older data: an expired lot is the only usable stock left.
  s={...s,lots:s.lots.map(l=>l.itemId==='rm1'&&l.qty>0?{...l,expiry:addDays(today(),-1)}:l)}
  const c=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:1});s=ok(c)
  s=ok(A.transitionProduction(s,ctx(s),c.result.id,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),c.result.id,'Jarayonda'))
  const r=A.reportOutput(s,ctx(s),c.result.id,1,0)
  if(r.result.ok)assert.ok(!r.state.productionOrders.find(o=>o.id===c.result.id).consumed.some(x=>x.lot&&s.lots.find(l=>l.code===x.lot)?.expiry<today()),'no expired lot consumed')
})

test('B3-06: a draft under an open ECO is activated only by applying the ECO',()=>{
  const s=fresh()
  const eco=s.engineeringChanges.find(e=>e.status==='Review')
  refused(A.activateBom(s,ctx(s),eco.newBomId),/ECO/)
})

test('B3-07: an order with output waiting in Final QC is not cancelled',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,10)
  refused(A.transitionProduction(s,ctx(s),id,'Bekor qilingan'),/karantin/)
})

test('B3-08: output after a lot was released starts a new lot instead of re-quarantining the released one',()=>{
  let {s,id}=started(fresh(),'p1',10)
  s=inQc(s,id,5)
  s=passPending(s,id)
  const first=orderOf(s,id).lot
  assert.equal(s.lots.find(l=>l.code===first).status,'available')
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'))
  s=ok(A.reportOutput(s,ctx(s),id,5,0))
  assert.equal(s.lots.find(l=>l.code===first).status,'available','released lot stays released')
  assert.notEqual(orderOf(s,id).lot,first)
  assert.equal(s.lots.find(l=>l.code===orderOf(s,id).lot).status,'quarantine')
})

test('B3-13: a return-rework names a source order only when the returned lot came from it',()=>{
  let s=fresh()
  const ret=s.returns.find(r=>r.status==='Inspection')
  s={...s,returns:s.returns.map(r=>r.id===ret.id?{...r,lot:undefined}:r)}
  const d=A.dispositionReturn(s,ctx(s,'em4'),ret.id,'Rework');s=ok(d)
  const mo=orderOf(s,s.returns.find(r=>r.id===ret.id).reworkOrderId)
  assert.equal(mo.reworkOf,ret.id,'without a lot the rework belongs to the return itself')
})
