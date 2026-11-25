// Phase 4 business decisions (2026-11-20):
//  P4-M-04 BOTH — the maintenance engineer and the warehouse side may issue spare parts, through one domain command;
//  P4-I-01 STANDARD — stock is valued at standard cost; the actual lot cost and the variance are shown beside it,
//  while production keeps costing issues at the lot's own cost.
// Every call goes through the same gate the app uses (role rule + scope, `commandBlocker`), then the domain action.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as I from '../.test-dist/inventory.mjs'
import {commandBlocker,MAINTENANCE_PART_RULES,actionRules} from '../.test-dist/access.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,10,20,9,0)
let counter=0
const ctx=(s,userId)=>({now:T0,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p4d${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
/** Runs a domain command as `userId`, refused exactly as the app refuses it (rule, then scope). */
function as(s,userId,name,...args){
  const blocked=commandBlocker(s,s.employees.find(e=>e.id===userId),name,args)
  if(blocked)return {state:s,result:{ok:false,message:blocked}}
  return A[name](s,ctx(s,userId),...args)
}
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)

/**
 * Seed + roles for the five actors: em5 Maintenance Engineer (role4, branch b1), wh-mgr store keeper (role6) of w1,
 * wh-op1 a custom "Ombor operatori" with warehouse view/create only, wh-op2 the same with warehouse.edit,
 * wh-b2 a store keeper of w4 (branch b2). em4 (quality) and em3 (operator) hold no spare-part right.
 * rm4 (lot tracked) gets one lot HW-D, 20 pcs at a lot cost of 8 000 in w1; an approved maintenance order on eq1 (wc1, b1).
 */
function fixture(){
  let s=createInitialState(T0)
  const opRole=(id,actions)=>({id,name:`Ombor operatori ${id}`,scope:'warehouse',permissions:{warehouse:Object.fromEntries(actions.map(a=>[a,true])),materials:{view:true}},rank:1})
  const keeper=(id,roleId,warehouseId)=>({id,name:`Keeper ${id}`,roleId,department:'Warehouse',workCenterId:'',warehouseId,shift:'A',status:'Faol',attendance:100,efficiency:100,hourlyCost:30000})
  s={...s,
    roles:[...s.roles,opRole('role-whop-view',['view','create']),opRole('role-whop-edit',['view','create','edit'])],
    employees:[...s.employees,keeper('wh-mgr','role6','w1'),keeper('wh-op1','role-whop-view','w1'),keeper('wh-op2','role-whop-edit','w1'),keeper('wh-b2','role6','w4')],
    // rm4 in w1: exactly one lot, nothing else.
    lots:[...s.lots.filter(l=>!(l.itemId==='rm4'&&l.warehouseId==='w1')),{id:'lot-hwd',code:'HW-D',kind:'lot',itemId:'rm4',itemType:'raw',qty:20,originalQty:20,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-11-01 08:00',consumedBy:[],unitCost:8000}],
    stockBalances:[...s.stockBalances.filter(b=>!(b.itemId==='rm4'&&b.warehouseId==='w1')),{id:'st-rm4-w1',warehouseId:'w1',itemId:'rm4',itemType:'raw',onHand:20,reserved:0,incoming:0,quarantine:0,unit:'dona'}],
    maintenanceRequests:[{id:'mr-d',code:'MR-D',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:'2026-11-20',reason:'Gidravlika bosimi tushadi',downtimeHours:2},...s.maintenanceRequests],
  }
  const approved=as(s,'em5','approveMaintenanceRequest','mr-d');s=ok(approved,'approve ')
  return {s,orderId:approved.result.id}
}
const issue=(s,user,orderId,qty,key,warehouseId='w1')=>as(s,user,'issueMaintenancePart',orderId,{materialId:'rm4',warehouseId,qty,key})
const order=(s,id)=>s.maintenanceOrders.find(m=>m.id===id)

test('P4-M-04: the rule is BOTH — equipment.edit or warehouse.edit, for issue and return alike',()=>{
  assert.deepEqual(MAINTENANCE_PART_RULES,[['equipment','edit'],['warehouse','edit']])
  assert.deepEqual(actionRules('issueMaintenancePart'),MAINTENANCE_PART_RULES)
  assert.deepEqual(actionRules('returnMaintenancePart'),MAINTENANCE_PART_RULES)
})

test('P4-M-04: Maintenance Engineer issues a spare part — stock, lot, cost and audit trail are recorded',()=>{
  let {s,orderId}=fixture()
  const moves=s.stockMovements.length
  s=ok(issue(s,'em5',orderId,3,'k-eng'),'engineer ')
  const m=order(s,orderId),part=m.parts[0]
  assert.equal(bal(s,'rm4','w1').onHand,17,'20 − 3')
  assert.equal(s.lots.find(l=>l.code==='HW-D'&&l.warehouseId==='w1').qty,17,'drawn from lot HW-D')
  assert.deepEqual([part.materialId,part.warehouseId,part.qty,part.by,part.key],['rm4','w1',3,'em5','k-eng'])
  assert.deepEqual(part.lots,[{lot:'HW-D',qty:3,unitCost:8000}])
  assert.equal(part.unitCost,8000,'valued at the lot cost (production costing rule)')
  const mv=s.stockMovements.slice(0,s.stockMovements.length-moves)
  assert.deepEqual(mv.map(x=>[x.type,x.itemId,x.warehouseId,x.qty,x.source,x.lot,x.user]),[['Maintenance Issue -','rm4','w1',-3,m.code,'HW-D',s.employees.find(e=>e.id==='em5').name]])
  assert.ok(m.history.some(h=>h.action==='Ehtiyot qism berildi'&&h.by==='em5'),'maintenance history names the operator')
  assert.ok(s.activity.some(a=>a.action==='Ehtiyot qism berildi'&&a.source===m.code),'activity log')
})

test('P4-M-04: only the assigned engineer may issue or return, with no side effects on refusal',()=>{
  let {s,orderId}=fixture()
  const engineer=s.employees.find(e=>e.id==='em5')
  s={...s,employees:[...s.employees,
    {...engineer,id:'em5-other',name:'Other branch engineer',workCenterId:'wc4',branchId:'b2'},
    {...engineer,id:'em5-peer',name:'Same branch engineer',workCenterId:'wc2',branchId:'b1'}]}
  for(const user of ['em5-peer','em5-other']){
    const out=issue(s,user,orderId,1,`unassigned-${user}`)
    assert.equal(out.result.ok,false,user)
    assert.match(out.result.message,/biriktirilmagan|boshqa filialga/)
    assert.equal(out.state,s,'stock, cost, history and activity retain the exact state object')
    const direct=A.issueMaintenancePart(s,ctx(s,user),orderId,{materialId:'rm4',warehouseId:'w1',qty:1,key:`direct-${user}`})
    assert.equal(direct.result.ok,false,'direct domain call is also refused')
    assert.equal(direct.state,s)
  }
  s=ok(issue(s,'em5',orderId,1,'assigned'))
  const part=order(s,orderId).parts[0]
  const denied=as(s,'em5-peer','returnMaintenancePart',orderId,part.id,1,'unassigned-return')
  assert.equal(denied.result.ok,false)
  assert.equal(denied.state,s)
  s=ok(as(s,'wh-mgr','returnMaintenancePart',orderId,part.id,1,'warehouse-return'))
  assert.equal(order(s,orderId).parts[0].returned,1,'warehouse staff retain the existing store-based right')
  const reassigned={...s,maintenanceOrders:s.maintenanceOrders.map(m=>m.id===orderId?{...m,technicianId:'em5-peer'}:m)}
  const stale=A.issueMaintenancePart(reassigned,ctx(reassigned,'em5'),orderId,{materialId:'rm4',warehouseId:'w1',qty:1,key:'stale-modal'})
  assert.equal(stale.result.ok,false,'assignment is checked when a previously opened form submits')
  assert.equal(stale.state,reassigned)
})

test('P4-M-04: Warehouse Manager issues through the same command and validation',()=>{
  let {s,orderId}=fixture()
  s=ok(issue(s,'wh-mgr',orderId,4,'k-wh'),'warehouse manager ')
  const part=order(s,orderId).parts[0]
  assert.deepEqual([part.qty,part.by,part.unitCost,part.lots[0].lot],[4,'wh-mgr',8000,'HW-D'])
  assert.equal(bal(s,'rm4','w1').onHand,16)
  // The keeper can also take an unused part back; the engineer can return what the keeper issued (one shared record).
  s=ok(as(s,'em5','returnMaintenancePart',orderId,part.id,1,'r-1'),'engineer return ')
  assert.equal(bal(s,'rm4','w1').onHand,17)
  s=ok(as(s,'wh-mgr','returnMaintenancePart',orderId,part.id,1,'r-2'),'keeper return ')
  assert.equal(order(s,orderId).parts[0].returned,2)
})

test('P4-M-04: Warehouse Operator — DENY with view/create only, PASS with warehouse.edit',()=>{
  let {s,orderId}=fixture()
  const denied=issue(s,'wh-op1',orderId,1,'k-op1')
  assert.equal(denied.result.ok,false)
  assert.match(denied.result.message,/ruxsat yo‘q/)
  assert.equal(bal(denied.state,'rm4','w1').onHand,20)
  s=ok(issue(s,'wh-op2',orderId,1,'k-op2'),'operator with edit ')
  assert.equal(order(s,orderId).parts[0].by,'wh-op2')
})

test('P4-M-04: roles without either right are refused, and nothing moves',()=>{
  const {s,orderId}=fixture()
  for(const user of ['em4','em3']){
    const out=issue(s,user,orderId,1,`k-${user}`)
    assert.equal(out.result.ok,false,user)
    assert.match(out.result.message,/ruxsat yo‘q/,user)
    assert.equal(out.state,s,`${user}: state unchanged`)
  }
})

test('P4-M-04: scope still applies — a keeper issues only from their own warehouse',()=>{
  const {s,orderId}=fixture()
  const other=issue(s,'wh-b2',orderId,1,'k-b2')
  assert.equal(other.result.ok,false)
  assert.match(other.result.message,/omboriga tegishli|filialga tegishli/)
  const wrongStore=issue(s,'wh-mgr',orderId,1,'k-w3','w3')
  assert.equal(wrongStore.result.ok,false,'w3 is not the keeper’s warehouse')
})

test('P4-M-04: insufficient stock is refused for both sides',()=>{
  const {s,orderId}=fixture()
  for(const user of ['em5','wh-mgr']){
    const out=issue(s,user,orderId,21,`k-big-${user}`)
    assert.equal(out.result.ok,false,user)
    assert.match(out.result.message,/bo‘sh qoldiq 20/,user)
    assert.equal(bal(out.state,'rm4','w1').onHand,20)
  }
})

test('P4-M-04: a repeated issue (same key) deducts stock once, whoever resends it',()=>{
  let {s,orderId}=fixture()
  s=ok(issue(s,'em5',orderId,2,'k-dup'))
  const moves=s.stockMovements.length
  const again=issue(s,'em5',orderId,2,'k-dup')
  assert.ok(again.result.ok)
  assert.match(again.result.message,/allaqachon berilgan/)
  const viaKeeper=issue(again.state,'wh-mgr',orderId,2,'k-dup')
  assert.match(viaKeeper.result.message,/allaqachon berilgan/)
  s=viaKeeper.state
  assert.equal(order(s,orderId).parts.length,1)
  assert.equal(bal(s,'rm4','w1').onHand,18)
  assert.equal(s.stockMovements.length,moves,'no second ledger row')
})

test('P4-M-04: parts from both sides join the maintenance cost once, at completion',()=>{
  let {s,orderId}=fixture()
  s=ok(issue(s,'em5',orderId,2,'k-a'))
  s=ok(issue(s,'wh-mgr',orderId,3,'k-b'))
  assert.equal(A.maintenancePartsCost(order(s,orderId)),5*8000)
  s=ok(as(s,'em5','startMaintenance',orderId))
  s=ok(as(s,'em5','completeMaintenance',orderId,100000,'Muhr almashtirildi'))
  const code=order(s,orderId).code
  assert.deepEqual(s.expenses.filter(e=>e.note?.startsWith(code)).map(e=>e.amount),[140000])
})

/* ------------------------------------------------------------ P4-I-01 -- */

/** rmX: standard 12 000, bought on PO-V at 10 000; 49 kg of lot LOT-V in w1 (the Phase 4 run's 588 000 vs 490 000). */
function valuationFixture({untracked=0}={}){
  const s=createInitialState(T0)
  return {...s,
    rawMaterials:[...s.rawMaterials,{id:'rmX',name:'Valuation test steel',sku:'RM-VX',category:'Metall',unit:'kg',status:'Faol',standardCost:12000,minStock:0,reorderPoint:0,supplierId:'su1',leadTime:1,lotTracking:true,expiryTracking:false}],
    purchaseOrders:[...s.purchaseOrders,{...s.purchaseOrders[0],id:'po-v',code:'PO-V',items:[{materialId:'rmX',qty:49,received:49,price:10000}]}],
    lots:[...s.lots,{id:'lot-v',code:'LOT-V',kind:'lot',itemId:'rmX',itemType:'raw',qty:49,originalQty:49,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po-v',sourceCode:'PO-V',createdAt:'2026-11-10 08:00',consumedBy:[]}],
    stockBalances:[...s.stockBalances,{id:'st-v',warehouseId:'w1',itemId:'rmX',itemType:'raw',onHand:49+untracked,reserved:0,incoming:0,quarantine:0,unit:'kg'}],
  }
}

test('P4-I-01: the book value stays at standard cost; the lot value and the variance sit beside it',()=>{
  const s=valuationFixture()
  const v=E.stockValuation(s,bal(s,'rmX','w1'))
  assert.equal(v.standard,588000,'49 × 12 000 — standard (the inventory value)')
  assert.equal(v.actual,490000,'49 × 10 000 — the PO price of lot LOT-V')
  assert.equal(v.variance,-98000,'actual − standard: bought below standard')
  assert.deepEqual([v.lotQty,v.untrackedQty],[49,0],'the same quantity on both bases')
})

test('P4-I-01: stock no lot accounts for is valued at standard on both bases',()=>{
  const s=valuationFixture({untracked:1})
  const v=E.stockValuation(s,bal(s,'rmX','w1'))
  assert.deepEqual([v.standard,v.actual,v.variance,v.untrackedQty],[600000,502000,-98000,1])
})

test('P4-I-01: inventory totals equal Σ on hand × standard cost, as every inventory screen showed before',()=>{
  const s=valuationFixture()
  const std=id=>s.rawMaterials.find(m=>m.id===id)?.standardCost??s.products.find(p=>p.id===id)?.standardCost??0
  const before=Math.round(s.stockBalances.reduce((a,b)=>a+b.onHand*std(b.itemId),0)*100)/100
  const total=E.inventoryValuation(s)
  assert.equal(total.standard,before)
  assert.equal(Math.round((total.actual-total.standard)*100)/100,total.variance)
  const w1=E.inventoryValuation(s,s.stockBalances.filter(b=>b.warehouseId==='w1'))
  const parts=s.stockBalances.filter(b=>b.warehouseId==='w1').map(b=>E.stockValuation(s,b))
  assert.equal(w1.standard,Math.round(parts.reduce((a,v)=>a+v.standard,0)*100)/100,'the warehouse total is the sum of its lines')
})

test('P4-I-01: production still costs an issue at the lot’s purchase price, not the standard',()=>{
  let s=valuationFixture()
  // p3’s BOM made of rmX only, 0.5 kg per piece, no waste.
  s={...s,boms:s.boms.map(b=>b.productId==='p3'&&b.status==='Faol'?{...b,components:[{...b.components[0],materialId:'rmX',qty:0.5,waste:0}],operations:b.operations.map(o=>({...o,barcodeStep:false}))}:b)}
  assert.equal(E.issueUnitCost(s,'rmX','LOT-V'),10000)
  const created=as(s,'em1','createProductionOrder',{productId:'p3',quantity:10});s=ok(created,'create ')
  const id=created.result.id
  s=ok(as(s,'em1','transitionProduction',id,'Tasdiqlangan'),'release ')
  s=ok(as(s,'em1','transitionProduction',id,'Jarayonda'),'start ')
  s=ok(as(s,'em1','recordMaterialScan',id,'LOT-V'),'scan ')
  const o=s.productionOrders.find(x=>x.id===id)
  assert.ok(o.consumed.length>0,'material issued')
  assert.ok(o.consumed.every(c=>c.lot==='LOT-V'&&c.unitCost===10000),'consumption valued at the lot price')
  assert.equal(E.consumptionValue(s,o.consumed),o.consumed.reduce((a,c)=>a+c.qty*10000,0))
  // What is left in the store keeps the standard book value; its variance stays visible.
  const left=bal(s,'rmX','w1').onHand,v=E.stockValuation(s,bal(s,'rmX','w1'))
  assert.equal(v.standard,Math.round(left*12000*100)/100)
  assert.equal(v.actual,Math.round(left*10000*100)/100)
})
