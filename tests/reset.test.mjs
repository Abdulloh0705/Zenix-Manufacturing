import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createInitialState,createSeedState} from '../.test-dist/mockData.mjs'
import {clearTransactions,holdsOnlyDemoRecords,isGeneratedDemoId,TRANSACTION_KEYS} from '../.test-dist/reset.mjs'
import {dashboardSnapshot} from '../.test-dist/dashboard.mjs'
import {createMrpPlan,materialShortages,stockOf} from '../.test-dist/manufacturingEngine.mjs'
import {isoDate,addDays} from '../.test-dist/dates.mjs'

// Same shape as the app's ids (AppContext uid): prefix-<time36>-<random>.
const uid=p=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`
const ctx=s=>({now:new Date(),user:s.employees[0],id:uid})
const ok=out=>{assert.ok(out.result.ok,out.result.message);return out}
const MASTERS=['branches','warehouses','productionLines','workCenters','products','rawMaterials','boms','suppliers','supplierMaterials','customers','equipment','employees','roles','qualityControlPoints']

test('initial state holds master data and no transactions',()=>{
  const s=createInitialState()
  for(const key of [...TRANSACTION_KEYS,'attachments'])assert.equal(s[key].length,0,key)
  // roles: the eight system roles (Super Admin … Ta’minot va sotuv menejeri) since schema v4
  assert.deepEqual(MASTERS.map(k=>s[k].length),[2,4,3,4,4,4,3,3,4,3,3,7,9,5])
  for(const key of MASTERS)for(const r of s[key])assert.ok(!isGeneratedDemoId(r.id),`${key} ${r.id}`)
  assert.ok(s.boms.every(b=>b.status==='Faol'),'each product keeps its active BOM')
  assert.ok(s.products.filter(p=>p.defaultBomId).every(p=>s.boms.some(b=>b.id===p.defaultBomId)))
  assert.ok(s.suppliers.every(x=>x.debt===0)&&s.customers.every(x=>x.debt===0),'no balances without invoices/payments')
  assert.ok(s.supplierMaterials.every(l=>l.lastPurchaseOrderId===undefined&&l.lastPrice===undefined))
  const today=isoDate(new Date())
  for(const e of s.equipment){
    assert.equal(e.status,'Ishlamoqda');assert.equal(e.lastMaintenance,'')
    assert.equal(e.nextMaintenance,addDays(today,e.maintenanceIntervalDays))
    assert.deepEqual([e.mtbf,e.mttr,e.downtime,e.maintenanceCost],[0,0,0,0])
  }
})

test('dashboard on the clean state: empty history, signals only from master rules',()=>{
  const s=createInitialState(),d=dashboardSnapshot(s)
  assert.equal(d.output.today,0);assert.equal(d.output.week,0);assert.equal(d.output.trendPlanned,0)
  assert.equal(d.open.length,0);assert.equal(d.closed.done,0);assert.equal(d.closed.cancelled,0)
  assert.equal(d.delivery.rate,null);assert.equal(d.quality.passRate,null);assert.equal(d.cost.orders,0)
  assert.equal(d.oee.availability+d.oee.performance+d.oee.quality,0,'OEE shows its empty state')
  assert.equal(d.downtime.minutes,0);assert.equal(d.downtime.open.length,0)
  assert.equal(d.serviceDue.length,0,'no machine is due within three days')
  assert.equal(d.capacity.loadMinutes,0);assert.equal(d.capacity.overloaded.length,0)
  // No demand and no stock: the only gap is each material's safety stock (minStock), the existing MRP rule.
  assert.ok(d.materials.shortages.every(r=>r.required===0&&r.available===0&&r.incoming===0&&r.shortage===r.m.minStock))
  assert.equal(d.materials.shortages.length,s.rawMaterials.filter(m=>m.minStock>0||m.reorderPoint>0).length)
  assert.deepEqual(d.materials.states.map(x=>[x.state,x.count]),[['Shortage',0],['Kritik',4],['Reorder',0],['Normal',0]])
  assert.equal(d.materials.waiting.length,0)
})

test('clearing the generated demo history gives exactly the initial state',()=>{
  const demo=createSeedState(new Date())
  assert.ok(holdsOnlyDemoRecords(demo))
  assert.ok(demo.productionOrders.length&&demo.stockBalances.length&&demo.engineeringChanges.length&&demo.attachments.length)
  const clean=clearTransactions(demo),fresh=createInitialState()
  for(const key of [...MASTERS,...TRANSACTION_KEYS,'attachments','settings','currentEmployeeId'])assert.deepEqual(clean[key],fresh[key],key)
  assert.deepEqual(clearTransactions(clean),clean,'idempotent')
})

test('records entered in the app are detected; masters survive a reset, transactions do not',()=>{
  let s=createSeedState(new Date())
  const link={materialId:'rm2',supplierSku:'',price:14000,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:0,leadTime:5,active:true}
  s=ok(A.saveSupplier(s,ctx(s),{supplier:{name:'Test Steel',phone:'+998 90 000 00 00',leadTime:5,rating:5,status:'Faol'},links:[link]})).state
  const su=s.suppliers.find(x=>x.name==='Test Steel')
  s=ok(A.addAttachment(s,ctx(s),{entityType:'supplier',entityId:su.id,name:'contract.pdf',size:10,mime:'application/pdf'})).state
  s=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:su.id,materialId:'rm2',qty:100,price:14000})).state
  assert.equal(holdsOnlyDemoRecords(s),false,'an app-created record makes the state ambiguous')
  const clean=clearTransactions(s)
  assert.ok(clean.suppliers.some(x=>x.id===su.id),'user supplier kept')
  assert.ok(clean.supplierMaterials.some(l=>l.supplierId===su.id),'user link kept')
  assert.deepEqual(clean.attachments.map(a=>a.name),['contract.pdf'],'only attachments on surviving master records')
  assert.equal(clean.purchaseOrders.length,0)
})

test('the clean state works: purchase → receipt → inspection puts usable stock on hand',()=>{
  let s=createInitialState()
  const po=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm1',qty:2000,price:22500}))
  s=po.state
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm1',2000)).state
  for(const q of s.qualityChecks.filter(q=>q.status==='Pending'))s=ok(A.resolveQuality(s,ctx(s),q.id,'Passed','','OK')).state
  assert.equal(stockOf(s,'rm1').available,2000)
  const rm1=materialShortages(s,createMrpPlan(s)).find(r=>r.id==='rm1')
  assert.equal(rm1,undefined,'2000 kg is above the 1300 kg reorder point')
})
