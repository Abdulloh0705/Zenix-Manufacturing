// Phase 1/5 (2026-10-28) audit regressions: numeric input integrity (#1, #2, #18), referential integrity (#3, #13),
// schema / durable-save safety (#8, #9), duplicate-id quarantine (#14) and calendar dates (#22).
// Every refused action must return the very state it was given: no partial mutation.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as V from '../.test-dist/validation.mjs'
import * as PS from '../.test-dist/persistence.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import {createInitialState,createSeedState} from '../.test-dist/mockData.mjs'
import {SCHEMA_VERSION} from '../.test-dist/migrations.mjs'
import {createSyncedSlot} from '../.test-dist/syncedState.mjs'

// Wednesday 2026-10-21 08:00 local time.
const T0=new Date(2026,9,21,8,0)
let counter=0
const fresh=()=>createSeedState(T0)
const ctx=(s,userId='em1')=>({now:T0,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-it${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given (no partial mutation)')
  return out
}
const bal=(s,item,wh)=>s.stockBalances.find(b=>b.itemId===item&&b.warehouseId===wh)
const clone=v=>JSON.parse(JSON.stringify(v))
const NOT_NUMBERS=[Infinity,-Infinity,NaN,'abc','12abc',null,{},[]]

/* ------------------------------------------------------------ #1 #2 #18 numbers -- */

test('#1: inventory adjustment, transfer, count and receipt refuse NaN / ±Infinity / non-numeric / out-of-bound values',()=>{
  const s=fresh()
  for(const v of NOT_NUMBERS)refused(s,A.adjustStock(s,ctx(s),'rm1','w1',v,'sanoq'),/son kiriting/)
  refused(s,A.adjustStock(s,ctx(s),'rm1','w1',2e9,'sanoq'),/juda katta/)
  for(const v of [Infinity,NaN,-1])refused(s,A.transferStock(s,ctx(s),'rm1','w1','w2',v))
  const b=bal(s,'rm1','w1')
  for(const v of [Infinity,NaN,'x',-3])refused(s,A.countStock(s,ctx(s),b.id,v,'x'))
  const po=s.purchaseOrders.find(p=>['Tasdiqlangan','Yo‘lda','Qisman qabul'].includes(p.status)&&p.items.some(i=>i.qty>i.received))
  const line=po.items.find(i=>i.qty>i.received)
  for(const v of [Infinity,NaN,'abc'])refused(s,A.receivePurchase(s,ctx(s),po.id,line.materialId,v))
  // Nothing of it can reach storage as null: the strict serialiser refuses non-finite numbers.
  assert.throws(()=>PS.strictStringify({onHand:Infinity}),PS.NonFiniteNumberError)
  assert.throws(()=>PS.strictStringify({rows:[{id:'x',qty:NaN}]}),/x\.qty/)
  assert.equal(PS.strictStringify({qty:1.5}),'{"qty":1.5}')
})

test('#1: production and purchase orders refuse NaN / ±Infinity quantities and prices',()=>{
  const s=fresh()
  for(const v of NOT_NUMBERS)refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:v}))
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5e9}),/juda katta/)
  const draft=s.productionOrders.find(o=>o.status==='Qoralama')||ok(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:4})).productionOrders[0]
  const s2=s.productionOrders.includes(draft)?s:{...s,productionOrders:[draft,...s.productionOrders]}
  refused(s2,A.updateProductionOrder(s2,ctx(s2),draft.id,{quantity:Infinity}))
  for(const v of NOT_NUMBERS)refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:v}]}))
  for(const v of [Infinity,NaN,'abc'])refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:10,price:v}]}),/narx/)
  // A negative price used to be clamped to 0 silently: now it is refused.
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:10,price:-5}]}),/manfiy/)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:-10}]}),/0 dan katta/)
  // A blank or 0 form row is still just an unused row.
  const t=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:10,price:22000},{materialId:'rm2',qty:''},{materialId:'',qty:5}]}))
  assert.deepEqual(t.purchaseOrders[0].items.map(i=>[i.materialId,i.qty,i.price]),[['rm1',10,22000]])
})

test('#2: sales orders refuse negative and non-finite prices and quantities; a given 0 price is kept',()=>{
  const s=fresh()
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:2,price:-1}]}),/manfiy/)
  for(const v of [Infinity,NaN,'abc'])refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:2,price:v}]}),/narx/)
  for(const v of [-2,Infinity,NaN])refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:v}]}))
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:2,price:1e13}]}),/juda katta/)
  const t=ok(A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:2,price:0}]}))
  assert.equal(t.salesOrders[0].items[0].price,0,'a free line is a business decision, not an error')
  const d=ok(A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:3}]}))
  assert.equal(d.salesOrders[0].items[0].price,s.products.find(p=>p.id==='p1').salePrice,'no price → the product price')
})

test('#18: fractional quantities follow the unit — kept exactly in kg, refused in pieces, never floored',()=>{
  const s=fresh()
  // Pieces (dona): refused, not truncated.
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2.5}),/butun son/)
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:1.5}]}),/butun son/)
  refused(s,A.adjustStock(s,ctx(s),'rm4','w1',1.5,'sanoq'),/butun son/)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su3',lines:[{materialId:'rm4',qty:10.5}]}),/butun son/)
  // Kilograms: up to three decimals kept exactly; more decimals are refused rather than rounded.
  const before=bal(s,'rm1','w1').onHand
  const t=ok(A.adjustStock(s,ctx(s),'rm1','w1',0.125,'sanoq'))
  assert.equal(Math.round((bal(t,'rm1','w1').onHand-before)*1000)/1000,0.125)
  refused(s,A.adjustStock(s,ctx(s),'rm1','w1',0.1234,'sanoq'),/3 ta kasr/)
  const po=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:12.345}]}))
  assert.equal(po.purchaseOrders[0].items[0].qty,12.345)
  // Output of a running order: whole units only.
  const running=s.productionOrders.find(o=>o.status==='Jarayonda')
  if(running)refused(s,A.reportOutput(s,ctx(s),running.id,1.5,0),/butun son/)
  // The shared rule itself.
  assert.deepEqual(V.checkQuantity(3,{decimals:0}),{value:3})
  assert.match(V.checkQuantity(0,{}).error,/0 dan katta/)
  assert.deepEqual(V.checkQuantity('',{allowZero:true,blankAsZero:true}),{value:0})
  assert.ok('error' in V.checkQuantity('',{allowZero:true}),'blank is not a count')
  assert.deepEqual(V.checkQuantity(-2,{signed:true}),{value:-2})
  assert.equal(V.itemDecimals(s,'p2'),0,'serial-tracked products are whole pieces')
  assert.equal(V.itemDecimals(s,'rm1'),3)
})

/* ------------------------------------------------------------ #3 #13 references -- */

test('#3: an adjustment needs an existing item and an existing, active warehouse of its kind — no orphan balance or movement',()=>{
  let s=fresh()
  const ledger=x=>[x.stockBalances.length,x.stockMovements.length,x.lots.length]
  const start=ledger(s)
  refused(s,A.adjustStock(s,ctx(s),'nope','w1',5,'x'),/Item topilmadi/)
  refused(s,A.adjustStock(s,ctx(s),'rm1','w-nope',5,'x'),/Ombor topilmadi/)
  refused(s,A.adjustStock(s,ctx(s),'rm1','w3',5,'x'),/saqlamaydi/)
  refused(s,A.adjustStock(s,ctx(s),'p1','w1',5,'x'),/saqlamaydi/)
  refused(s,A.transferStock(s,ctx(s),'nope','w1','w2',1),/Item topilmadi/)
  refused(s,A.transferStock(s,ctx(s),'rm1','w-nope','w2',1),/Manba ombor/)
  s={...s,warehouses:s.warehouses.map(w=>w.id==='w2'?{...w,status:'Arxiv'}:w)}
  refused(s,A.adjustStock(s,ctx(s),'rm1','w2',5,'x'),/arxivlangan/)
  assert.deepEqual(ledger(s),start)
  assert.ok(s.stockBalances.every(b=>s.warehouses.some(w=>w.id===b.warehouseId)&&(s.products.some(p=>p.id===b.itemId)||s.rawMaterials.some(m=>m.id===b.itemId))),'every balance line has its item and warehouse')
  // A scoped role cannot act on a warehouse id that does not exist (it has no branch to compare).
  const em2=s.employees.find(e=>e.id==='em2')
  assert.match(X.scopeBlocker(s,em2,'adjustStock',['rm1','w-nope',5,'x'])||'',/Noma’lum ombor/)
  assert.equal(X.scopeBlocker(s,em2,'adjustStock',['rm1','w1',5,'x']),null)
})

test('#13: archived masters stay readable in history but are refused for new orders',()=>{
  let s=fresh()
  const soWithP1=ok(A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:1}]}))
  s=soWithP1
  const archive=(x,key,id)=>({...x,[key]:x[key].map(r=>r.id===id?{...r,status:'Arxiv'}:r)})
  let t=archive(s,'products','p1')
  refused(t,A.createProductionOrder(t,ctx(t),{productId:'p1',quantity:2}),/arxivlangan/)
  refused(t,A.createSalesOrder(t,ctx(t),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:1}]}),/arxivlangan/)
  assert.ok(t.salesOrders.some(o=>o.items.some(i=>i.productId==='p1')),'the old order still shows the archived product')
  assert.equal(E.itemName(t,'p1'),s.products.find(p=>p.id==='p1').name)
  t=archive(s,'customers','cu2')
  refused(t,A.createSalesOrder(t,ctx(t),{customerId:'cu2',mode:'Make-to-stock',lines:[{productId:'p1',qty:1}]}),/arxivlangan/)
  t=archive(s,'suppliers','su1')
  refused(t,A.createPurchaseOrder(t,ctx(t),{supplierId:'su1',lines:[{materialId:'rm1',qty:10}]}),/arxivlangan/)
  t=archive(s,'rawMaterials','rm1')
  refused(t,A.createPurchaseOrder(t,ctx(t),{supplierId:'su1',lines:[{materialId:'rm1',qty:10}]}),/arxivlangan/)
  refused(t,A.adjustStock(t,ctx(t),'rm1','w1',5,'x'),/arxivlangan/)
  ok(A.adjustStock(t,ctx(t),'rm1','w1',-1,'hisobdan chiqarish'),'writing off what is left of an archived item is allowed: ')
  // Unknown references on new orders.
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2,workCenterId:'wc-nope'}),/Ish markazi/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2,responsibleId:'em-nope'}),/xodim/)
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm-nope',qty:10}]}),/topilmadi/)
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p-nope',qty:1}]}),/topilmadi/)
})

test('#13: master-data writes check references, branch ↔ line consistency and numbers',()=>{
  const s=fresh()
  refused(s,A.createEntity(s,ctx(s),'warehouses',{name:'X',code:'WH-X',branchId:'b-nope',type:'Raw',status:'Faol',locations:[]}),/topilmadi/)
  const archivedBranch={...s,branches:s.branches.map(b=>b.id==='b2'?{...b,status:'Arxiv'}:b)}
  refused(archivedBranch,A.createEntity(archivedBranch,ctx(archivedBranch),'warehouses',{name:'X',code:'WH-X',branchId:'b2',type:'Raw',status:'Faol',locations:[]}),/arxivlangan/)
  refused(s,A.createEntity(s,ctx(s),'workCenters',{name:'X',code:'WC-X',branchId:'b1',lineId:'l3',capacity:1,efficiency:80,status:'Ishlamoqda',machineIds:[],costPerHour:0}),/boshqa filial/)
  refused(s,A.createEntity(s,ctx(s),'equipment',{name:'X',workCenterId:'wc-nope'}),/topilmadi/)
  refused(s,A.createEntity(s,ctx(s),'products',{name:'X',sku:'FG-X',unit:'dona',salePrice:-1,standardCost:0}),/salePrice/)
  refused(s,A.createEntity(s,ctx(s),'products',{name:'X',sku:'FG-X',unit:'dona',salePrice:Infinity,standardCost:0}),/salePrice/)
  refused(s,A.createEntity(s,ctx(s),'expenses',{type:'Overhead',amount:100,date:'2026-02-30',sourceId:'',note:''}),/sana/)
  ok(A.createEntity(s,ctx(s),'warehouses',{name:'X',code:'WH-X',branchId:'b1',type:'Raw',status:'Faol',locations:[]}))
  // An existing record whose untouched reference is archived stays editable.
  const t={...s,branches:s.branches.map(b=>b.id==='b1'?{...b,status:'Arxiv'}:b)}
  ok(A.updateEntity(t,ctx(t),'warehouses','w1',{name:'Xomashyo ombori 2'}))
})

/* ------------------------------------------------------------ #8 #9 storage -- */

function memoryStore(initial={}){
  const data={...initial}
  return {data,fail:false,getRaw:k=>data[k]??null,setRaw(k,t){if(this.fail)return false;data[k]=t;return true}}
}
const parse=raw=>{const v=JSON.parse(raw);return PS.looksLikeState(v)&&PS.newerSchema(v)===undefined?v:null}

test('#8: data of a newer schema is recognised and can never be overwritten by this build',()=>{
  const newer={...clone(createInitialState(T0)),schemaVersion:SCHEMA_VERSION+1,futureList:[{id:'f1'}]}
  assert.equal(PS.newerSchema(newer),SCHEMA_VERSION+1)
  assert.equal(PS.newerSchema(createInitialState(T0)),undefined)
  assert.equal(PS.isNewerSchemaText(JSON.stringify(newer)),true)
  assert.equal(PS.isNewerSchemaText('{broken'),false)
  // Another tab of a newer version saved: this tab's write is refused and the newer text stays byte-identical.
  const store=memoryStore({k:JSON.stringify(createInitialState(T0))})
  const slot=createSyncedSlot(store,'k',parse,store.data.k,{locked:PS.isNewerSchemaText,stringify:PS.strictStringify})
  const newerText=JSON.stringify(newer)
  store.data.k=newerText
  assert.deepEqual(slot.latest('mine'),{state:'mine',changed:false},'newer data is not taken in as if it were readable')
  assert.equal(slot.write({...createInitialState(T0),currentEmployeeId:'x'}),'locked')
  assert.equal(store.data.k,newerText,'not downgraded')
})

test('#9: a save that is refused by storage or cannot be serialised is never reported as written',()=>{
  const s=createInitialState(T0)
  const store=memoryStore({k:JSON.stringify(s)})
  const slot=createSyncedSlot(store,'k',parse,store.data.k,{locked:PS.isNewerSchemaText,stringify:PS.strictStringify})
  const original=store.data.k
  assert.equal(slot.write({...s,stockBalances:[{id:'b',onHand:Infinity}]}),'invalid')
  assert.equal(store.data.k,original,'nothing written')
  store.fail=true
  assert.equal(slot.write({...s,currentEmployeeId:'other'}),'failed')
  assert.equal(store.data.k,original)
  store.fail=false
  assert.equal(slot.write({...s,currentEmployeeId:'other'}),'saved')
  assert.equal(JSON.parse(store.data.k).currentEmployeeId,'other')
})

/* ------------------------------------------------------------ #14 duplicate ids -- */

test('#14: duplicate ids are quarantined unchanged — first copy stays in use, nothing deleted or re-numbered, idempotent',()=>{
  const s=clone(fresh())
  const first=s.rawMaterials[0],second={...first,name:'Boshqa nusxa',standardCost:1}
  s.rawMaterials.push(second,{...first})
  s.stockBalances.push({...s.stockBalances[0]})
  const {state,report}=PS.prepareStored(s,createInitialState(T0))
  assert.equal(state.rawMaterials.filter(m=>m.id===first.id).length,1,'one record per id')
  assert.equal(state.rawMaterials.find(m=>m.id===first.id).name,first.name,'the copy every lookup already used stays')
  assert.equal(state.stockBalances.filter(b=>b.id===s.stockBalances[0].id).length,1)
  assert.deepEqual(state.quarantinedRecords.map(q=>[q.collection,q.id,q.record.name??null]),[['rawMaterials',first.id,'Boshqa nusxa'],['rawMaterials',first.id,first.name],['stockBalances',s.stockBalances[0].id,null]])
  assert.ok(PS.changedRecords(report),'the original text is kept aside by the caller')
  assert.match(PS.describeReport(report),/karantinga olindi/)
  // Loading the repaired data again changes nothing more.
  const again=PS.prepareStored(clone(state),createInitialState(T0))
  assert.equal(again.report.issues.length,0)
  assert.deepEqual(again.state.quarantinedRecords,state.quarantinedRecords)
  // Loading the same broken text twice does not quarantine the same record twice.
  const twice=PS.prepareStored({...clone(s),quarantinedRecords:state.quarantinedRecords},createInitialState(T0))
  assert.equal(twice.state.quarantinedRecords.length,3)
  assert.doesNotThrow(()=>E.calculateCapacityLoads(state,5,undefined,T0))
})

/* ------------------------------------------------------------ #22 dates -- */

test('#22: impossible calendar dates are refused, valid ISO dates keep working',()=>{
  for(const d of ['2026-99-99','2026-02-30','2025-02-29','2026-13-01','2026-04-31','2026-1-5','26-01-05','2026-01-05x','',null,20260105])assert.equal(V.isIsoDate(d),false,String(d))
  for(const d of ['2024-02-29','2026-12-31','2026-01-01'])assert.equal(V.isIsoDate(d),true,d)
  assert.equal(V.isIsoStamp('2026-10-21 23:59'),true)
  for(const d of ['2026-10-21 24:00','2026-10-21 12:60','2026-02-30 10:00'])assert.equal(V.isIsoStamp(d),false,d)
  const s=fresh()
  refused(s,A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:10}],expectedDate:'2026-99-99'}),/sana/)
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:1}],deliveryDate:'2026-02-30'}),/sana/)
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2,due:'2026-13-01'}),/sana/)
  const po=s.purchaseOrders[0],so=s.salesOrders.find(o=>o.status!=='Bekor'&&o.status!=='Yetkazildi')
  refused(s,A.updatePurchaseMeta(s,ctx(s),po.id,{expectedDate:'2026-99-99'}),/sana/)
  if(so)refused(s,A.updateSalesMeta(s,ctx(s),so.id,{deliveryDate:'2026-04-31'}),/sana/)
  // Valid ISO dates are unchanged in meaning and compare correctly.
  const t=ok(A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2,start:'2026-10-22',due:'2026-11-02'}))
  assert.deepEqual([t.productionOrders[0].start,t.productionOrders[0].due],['2026-10-22','2026-11-02'])
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:2,start:'2026-11-02',due:'2026-10-22'}),/oldin/)
})

/* ------------------------------------------------------------ valid flows still work -- */

test('valid production, purchase, sales and recovery flows are unchanged',()=>{
  let s=fresh()
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:12});s=ok(mo)
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'))
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm1',qty:250.5,price:22500.25}]});s=ok(po)
  const row=s.purchaseOrders.find(p=>p.id===po.result.id)
  assert.deepEqual([row.items[0].qty,row.items[0].price],[250.5,22500.25])
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm1',100.25))
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p3',qty:4,price:47000}]});s=ok(so)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id,{p3:'2'}))
  assert.equal(s.salesOrders.find(o=>o.id===so.result.id).items[0].delivered,2)
  // The repaired / migrated load of valid data finds nothing and serialises strictly.
  const loaded=PS.prepareStored(clone(s),createInitialState(T0))
  assert.equal(loaded.report.issues.length,0)
  assert.doesNotThrow(()=>PS.strictStringify(loaded.state))
})
