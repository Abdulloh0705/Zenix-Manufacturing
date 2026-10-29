// Pre-merge checks (2026-10-29): v4 → v5 data compatibility, serial scale, and timestamps around a company zone change.
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as D from '../.test-dist/dates.mjs'
import * as F from '../.test-dist/format.mjs'
import * as PS from '../.test-dist/persistence.mjs'
import * as SN from '../.test-dist/serials.mjs'
import * as N from '../.test-dist/notifications.mjs'
import {SCHEMA_VERSION,migrateState} from '../.test-dist/migrations.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const RUNTIME_ZONE=D.timeZone()
afterEach(()=>{D.setTimeZone(RUNTIME_ZONE);D.setZoneHistory(undefined)})
const T0=new Date(2026,9,21,8,0)
let counter=0
const ctx=(s,now=T0)=>({now,user:s.employees.find(e=>e.id==='em1'),id:p=>`${p}-pm${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const clone=v=>JSON.parse(JSON.stringify(v))

/** Data exactly as a v4 (Phase 4) build saved it: no Phase 5 lists or fields, a serial range record, unkeyed notifications. */
function v4Saved(){
  const s=clone(createInitialState(T0))
  delete s.supplierReplacements;delete s.receivableReconciliations
  s.schemaVersion=4
  s.lots=[{id:'lot-r',code:'SN-VK210-000001…000004',kind:'serial',itemId:'p2',itemType:'finished',qty:4,originalQty:4,warehouseId:'w3',status:'available',sourceType:'production',sourceId:'mo-old',sourceCode:'MO-OLD',createdAt:'2026-09-01 08:00',serialFrom:'SN-VK210-000001',serialTo:'SN-VK210-000004',consumedBy:[]}]
  s.stockBalances=[{id:'b-p2',warehouseId:'w3',itemId:'p2',itemType:'finished',onHand:4,reserved:0,incoming:0,quarantine:0,unit:'dona'}]
  s.stockMovements=[{id:'m-old',date:'2026-09-01 08:00',type:'Production +',itemId:'p2',itemType:'finished',warehouseId:'w3',qty:4,source:'MO-OLD',note:'',user:'Tizim',lot:'SN-VK210-000001…000004'}]
  s.notifications=[{id:'n-old',type:'quality',title:'Eski',text:'x',severity:'info',read:false,date:'2026-09-01 08:00'}]
  return s
}

test('Pre-merge 1: v4 data loads as v5 without changing any stored record; a second load migrates nothing',()=>{
  assert.equal(SCHEMA_VERSION,5)
  const saved=v4Saved()
  const {state,report}=PS.prepareStored(clone(saved),createInitialState(T0))
  assert.equal(state.schemaVersion,5)
  assert.deepEqual(report.migrations.map(m=>m.split(':')[0]),['v5'],'the v5 mark is a migration: the app keeps a v4 backup first')
  assert.deepEqual([state.supplierReplacements,state.receivableReconciliations],[[],[]])
  for(const key of ['lots','stockBalances','stockMovements','notifications','purchaseOrders','salesOrders','customers','receivables','roles'])assert.deepEqual(state[key],saved[key],`${key} unchanged`)
  assert.deepEqual(state.settings.company,saved.settings.company,'no zone history is invented')
  const again=PS.prepareStored(JSON.parse(PS.strictStringify(state)),createInitialState(T0))
  assert.deepEqual(again.report.migrations,[],'idempotent')
  assert.deepEqual(migrateState(state).applied,[])
  // v5 data is "newer" for any v4 build: one that knows the lock opens it read-only instead of overwriting it.
  assert.ok(state.schemaVersion>4)
  assert.equal(PS.newerSchema(state),undefined,'this build reads its own version')
})

test('Pre-merge 2: loaded v4 data works with the Phase 5 rules — legacy range readable, new commands and scans run',()=>{
  let {state:s}=PS.prepareStored(v4Saved(),createInitialState(T0))
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:false,autoQualityChecks:false}}}
  assert.equal(SN.serialIssues(s).legacyRanges.length,1)
  assert.equal(SN.serialStatus(s,'SN-VK210-000002'),undefined,'units of the old range are not invented')
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p2',qty:2,price:1000}]});s=ok(so)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(s.lots[0].qty,2)
  const scanned=N.scanNotifications(s,ctx(s))
  assert.ok(scanned.notifications.some(n=>n.id==='n-old'),'old unkeyed notifications are kept')
  assert.doesNotThrow(()=>PS.strictStringify(scanned))
})

test('Pre-merge 3: 10 000 serial units are posted in linear time, one ledger row each, in serial order',()=>{
  let s=createInitialState(T0)
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:false,autoQualityChecks:false}}}
  const stock=(st,key,wh,qty)=>({...st,lots:[...st.lots,{id:`l-${key}`,code:`${key}-L`,kind:'lot',itemId:key,itemType:st.products.some(p=>p.id===key)?'finished':'raw',qty,originalQty:qty,warehouseId:wh,status:'available',sourceType:'purchase',sourceId:'x',sourceCode:'X',createdAt:'2026-10-01 08:00',consumedBy:[]}],
    stockBalances:[...st.stockBalances,{id:`b-${key}`,warehouseId:wh,itemId:key,itemType:st.products.some(p=>p.id===key)?'finished':'raw',onHand:qty,reserved:0,incoming:0,quarantine:0,unit:'x'}]})
  s=stock(stock(stock(s,'rm2','w1',30000),'rm4','w1',90000),'p3','w3',30000)
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p2',quantity:10000,start:'2026-10-21',due:'2026-12-30'});s=ok(mo)
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'));s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Jarayonda'))
  const t=performance.now()
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,10000))
  const ms=performance.now()-t
  assert.ok(ms<3000,`10 000 units took ${Math.round(ms)} ms (was quadratic: one full ledger copy per unit)`)
  const rows=s.stockMovements.filter(m=>m.type==='Production +'&&m.itemId==='p2')
  assert.equal(rows.length,10000)
  assert.deepEqual([rows[0].lot,rows.at(-1).lot],['SN-VK210-000001','SN-VK210-010000'],'the output block lists units in number order (same order as the former one-by-one posting)')
  assert.equal(new Set(rows.map(r=>r.id)).size,10000)
  // Storage budget (Chrome localStorage ≈ 5.2 M characters per origin): about 600 characters per unit.
  const per=(PS.strictStringify(s).length-PS.strictStringify(createInitialState(T0)).length)/10000
  assert.ok(per<700,`${Math.round(per)} characters per serial unit`)
})

test('Pre-merge 4: a timestamp written around a zone change is never shown as a precise time',()=>{
  const history=D.recordZoneChange({name:'X',currency:'UZS',timezone:'Asia/Tashkent',taxId:''},{timezone:'UTC'},new Date('2026-10-21T06:00:00Z')).zoneHistory
  D.setTimeZone('UTC');D.setZoneHistory(history)
  // 08:00 reads as 03:00Z in Tashkent (before the change) and 08:00Z in UTC (after it): both possible.
  assert.deepEqual(D.stampZones('2026-10-21 08:00'),['Asia/Tashkent','UTC'])
  assert.equal(D.isAmbiguousStamp('2026-10-21 08:00'),true)
  assert.match(D.displayStamp('2026-10-21 08:00'),/^2026-10-21 08:00 \(zona o‘zgarishi — vaqt noaniq\)$/)
  assert.match(F.relativeTime('2026-10-21 08:00',new Date('2026-10-21T12:00:00Z')),/vaqt noaniq/)
  // Known zones: an old Tashkent time is shown in today's zone; a time of the current zone as written.
  assert.equal(D.displayStamp('2026-10-20 10:00'),'2026-10-20 05:00')
  assert.equal(D.displayStamp('2026-10-22 10:00'),'2026-10-22 10:00')
  assert.equal(F.relativeTime('2026-10-22 10:00',new Date('2026-10-22T12:00:00Z')),'2 soat oldin')
  assert.equal(D.displayStamp('2026-10-21'),'2026-10-21','calendar days never move')
  // Without a recorded change nothing is converted or marked.
  D.setZoneHistory(undefined)
  assert.equal(D.displayStamp('2026-10-21 08:00'),'2026-10-21 08:00')
  assert.equal(D.isAmbiguousStamp('2026-10-21 08:00'),false)
})
