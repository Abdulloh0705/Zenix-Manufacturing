// Phase 3/5 (2026-10-28) audit regressions: legacy LOT gaps left by Phase 2, units of measure (#24), variant stock
// identity (#15), warehouse locations (#17) and site-aware MRP (#16). A refused action returns the very state it was given.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as P from '../.test-dist/planning.mjs'
import * as X from '../.test-dist/access.mjs'
import * as U from '../.test-dist/uom.mjs'
import * as I from '../.test-dist/inventory.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,28,8,0)
const TODAY='2026-10-28'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p3x${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given (no partial mutation)')
  return out
}
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-6,`${msg||''} ${a} ≠ ${b}`)
const noQc=s=>({...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:false,autoQualityChecks:false}}})
const clean=()=>noQc(createInitialState(T0))
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
const order=(s,id)=>s.productionOrders.find(o=>o.id===id)
const lotSum=(s,key,wh,loc)=>Math.round(s.lots.filter(l=>I.keyOf(l)===key&&l.warehouseId===wh&&(loc===undefined||(l.location||'')===loc)).reduce((a,l)=>a+l.qty,0)*1000)/1000

/** Lot records (each optionally in a location) and the matching balance of an item key in a store; `untracked` adds stock without lots. */
function withStock(s,key,warehouseId,lots,untracked=0){
  const {itemId,variantId}=I.splitKey(key)
  const product=s.products.find(p=>p.id===itemId)
  const itemType=product?'finished':'raw'
  const unit=(product||s.rawMaterials.find(m=>m.id===itemId)).unit
  const rows=lots.map((l,i)=>({id:`lot-${key}-${warehouseId}-${l.code}-${l.location||''}`,code:l.code,kind:'lot',itemId,...(variantId?{variantId}:{}),itemType,qty:l.qty,originalQty:l.qty,warehouseId,...(l.location?{location:l.location}:{}),status:l.status||'available',
    sourceType:l.sourceType||'purchase',sourceId:l.sourceId||'po-x',sourceCode:l.sourceCode||'PO-X',createdAt:`2026-10-0${i+1} 08:00`,expiry:l.expiry,consumedBy:[]}))
  const onHand=rows.reduce((a,l)=>a+l.qty,0)+untracked
  const bins={}
  for(const l of rows)if(l.location)bins[l.location]=(bins[l.location]||0)+l.qty
  const quarantine=rows.filter(l=>['quarantine','hold','rework'].includes(l.status)).reduce((a,l)=>a+l.qty,0)
  return {...s,lots:[...s.lots,...rows],stockBalances:[...s.stockBalances.filter(b=>!(I.keyOf(b)===key&&b.warehouseId===warehouseId)),
    {id:`st-${key}-${warehouseId}`,warehouseId,itemId,...(variantId?{variantId}:{}),itemType,onHand,reserved:0,incoming:0,quarantine,unit,...(Object.keys(bins).length?{bins}:{})}]}
}
/** Every balance: non-negative, bins never above on hand, lots in a location never above that location's quantity. */
function assertLocations(s){
  for(const b of s.stockBalances){
    for(const f of ['onHand','reserved','incoming','quarantine'])assert.ok((b[f]||0)>=-1e-9,`${I.keyOf(b)}@${b.warehouseId} ${f}=${b[f]}`)
    assert.ok(I.binTotal(b)<=b.onHand+1e-6,`${I.keyOf(b)}@${b.warehouseId}: bins ${I.binTotal(b)} > onHand ${b.onHand}`)
    for(const [loc,q] of Object.entries(b.bins||{}))assert.ok(q>0,`${loc} kept with ${q}`)
  }
  const issues=I.inventoryIssues(s,()=>false).filter(i=>['bins-exceed','bin-negative','bin-unknown','lot-location'].includes(i.kind))
  assert.deepEqual(issues,[],'locations reconcile')
}
/** Runs a draft MO: confirm (reserves), start. */
function run(s,id){
  s=ok(A.transitionProduction(s,ctx(s),id,'Tasdiqlangan'),'confirm: ')
  return ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'),'start: ')
}

/* ---------------------------------------------------------------- legacy LOT gaps -- */

/** A p3 MO (rm2 only) confirmed against two FEFO lots of rm2, then turned into a pre-pin (legacy) reservation. */
function legacyOrder(){
  let s=withStock(clean(),'rm2','w1',[{code:'L-EARLY',qty:30,expiry:'2026-12-01'},{code:'L-LATE',qty:30,expiry:'2027-06-01'}])
  const c=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:10});s=ok(c)
  s=run(s,c.result.id)
  assert.ok(order(s,c.result.id).reservations[0].lots.length,'new reservations pin lots')
  // Data saved before lot pins existed: same quantity and warehouse, no lot.
  s={...s,productionOrders:s.productionOrders.map(o=>o.id===c.result.id?{...o,reservations:o.reservations.map(({lots:_l,untracked:_u,...r})=>r)}:o)}
  return {s,id:c.result.id}
}

test('Legacy #1: an old reservation without LOT cannot consume a lot it never held',()=>{
  const {s,id}=legacyOrder()
  const r=order(s,id).reservations[0]
  assert.equal(I.legacyGap(r,true),r.qty)
  refused(s,A.reportOutput(s,ctx(s),id,2),/eski \(LOT’siz\) rezerv/)
  refused(s,A.recordMaterialScan(s,ctx(s),id,'RM-ST-15'),/LOT bilan bog‘lash/)
  refused(s,A.recordMaterialScan(s,ctx(s),id,'L-LATE'),/LOT bilan bog‘lash/)
  assert.ok(I.inventoryIssues(s,k=>k==='rm2').some(i=>i.kind==='legacy-reservation'&&i.text.includes(order(s,id).code)))
})

test('Legacy #2: reconciliation pins FEFO lots, keeps quantity, warehouse and order, then issue takes exactly them',()=>{
  let {s,id}=legacyOrder()
  const before=order(s,id).reservations[0]
  s=ok(A.allocateLegacyLots(s,ctx(s),'mo',id))
  const after=order(s,id).reservations[0]
  assert.deepEqual([after.materialId,after.warehouseId,after.qty],[before.materialId,before.warehouseId,before.qty])
  assert.deepEqual(after.lots,[{lot:'L-EARLY',qty:before.qty}],'earliest expiry first')
  assert.equal(bal(s,'rm2','w1').reserved,before.qty,'the balance reservation did not change')
  refused(s,A.allocateLegacyLots(s,ctx(s),'mo',id),/LOT’siz eski rezerv yo‘q/)
  s=ok(A.reportOutput(s,ctx(s),id,10))
  assert.ok(order(s,id).consumed.every(c=>c.lot==='L-EARLY'),'issued from the reconciled lot only')
  near(lotSum(s,'rm2','w1'),Math.round((60-before.qty)*1000)/1000)
})

test('Legacy #2b: insufficient eligible lots leave the reservation unchanged (expired / reserved by others / scope)',()=>{
  let {s,id}=legacyOrder()
  const expired={...s,lots:s.lots.map(l=>l.itemId==='rm2'?{...l,expiry:'2026-10-01'}:l)}
  refused(expired,A.allocateLegacyLots(expired,ctx(expired),'mo',id),/LOT yetarli emas/)
  // Another order pinned the lots first.
  const other=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:70})
  let s2=ok(other)
  s2={...s2,productionOrders:s2.productionOrders.map(o=>o.id===other.result.id?{...o,materialReserved:true,status:'Tasdiqlangan',reservations:[{materialId:'rm2',warehouseId:'w1',qty:55,lots:[{lot:'L-EARLY',qty:30},{lot:'L-LATE',qty:25}]}]}:o)}
  refused(s2,A.allocateLegacyLots(s2,ctx(s2),'mo',id),/LOT yetarli emas/)
  // A warehouse-bound keeper of another store may not reconcile it.
  const keeper={...s,employees:[...s.employees,{...s.employees[0],id:'em-k4',roleId:'role6',workCenterId:'wc4',warehouseId:'w4'}]}
  assert.match(X.commandBlocker(keeper,keeper.employees.find(e=>e.id==='em-k4'),'allocateLegacyLots',['mo',id])||'',/omboriga tegishli|ruxsat/)
  refused(s,A.allocateLegacyLots(s,ctx(s),'mo','mo-nope'),/topilmadi/)
})

test('Legacy SO: a delivery of a pre-pin sales reservation of a lot-tracked product is reconciled first',()=>{
  let s=withStock(clean(),'p1','w3',[{code:'FG-L1',qty:20,sourceType:'production'}])
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:5}]});s=ok(so)
  s={...s,salesOrders:s.salesOrders.map(o=>o.id===so.result.id?{...o,items:o.items.map(i=>({...i,reservations:i.reservations.map(({lots:_l,...r})=>r)}))}:o)}
  refused(s,A.deliverSalesOrder(s,ctx(s),so.result.id),/LOT bilan bog‘lash/)
  s=ok(A.allocateLegacyLots(s,ctx(s),'so',so.result.id))
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(lotSum(s,'p1','w3'),15)
  assert.ok(s.stockMovements.filter(m=>m.type==='Sale -').every(m=>m.lot==='FG-L1'))
})

test('Legacy #3: a lot-tracked negative adjustment without enough lot records fails atomically',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'L1',qty:10}],5)
  refused(s,A.adjustStock(s,ctx(s),'rm2','w1',-12,'Sanoq'),/LOT bilan kuzatiladi.*LOT’siz qoldiqni ombor balansi bilan hisobdan chiqarib bo‘lmaydi/)
  refused(s,A.adjustStock(s,ctx(s),'rm2','w1',-3,'Sanoq',{lots:[{lot:'NOPE',qty:3}]}),/LOT/)
  refused(s,A.adjustStock(s,ctx(s),'rm2','w1',-3,'Sanoq',{lots:[{lot:'L1',qty:2}]}),/yig‘indisi/)
  // Reserved lot quantity is not available to a write-off either.
  const c=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:5});s=ok(c)
  s=ok(A.transitionProduction(s,ctx(s),c.result.id,'Tasdiqlangan'))
  const pinned=order(s,c.result.id).reservations[0].lots.reduce((a,p)=>a+p.qty,0)
  refused(s,A.adjustStock(s,ctx(s),'rm2','w1',-(10-pinned+0.5),'Sanoq'),/LOT bilan kuzatiladi/)
  // countStock goes through the same rule.
  const b=bal(s,'rm2','w1')
  refused(s,A.countStock(s,ctx(s),b.id,b.reserved,'Sanoq'),/LOT/)
})

test('Legacy #4: a valid tracked adjustment writes off named or FEFO lots with one ledger row per lot, never twice',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'L-A',qty:4,expiry:'2026-11-01'},{code:'L-B',qty:10,expiry:'2027-01-01'}])
  s=ok(A.adjustStock(s,ctx(s),'rm2','w1',-6,'Sanoq',{key:'adj-1'}))
  assert.equal(bal(s,'rm2','w1').onHand,8)
  assert.deepEqual(s.lots.filter(l=>l.itemId==='rm2').map(l=>[l.code,l.qty]).sort(),[['L-A',0],['L-B',8]])
  assert.deepEqual(s.stockMovements.filter(m=>m.type==='Adjustment -').map(m=>[m.lot,m.qty]).sort(),[['L-A',-4],['L-B',-2]])
  refused(s,A.adjustStock(s,ctx(s),'rm2','w1',-6,'Sanoq',{key:'adj-1'}),/allaqachon qayd etilgan/)
  // Expired stock can be written off by name.
  s={...s,lots:s.lots.map(l=>l.code==='L-B'?{...l,expiry:'2026-10-01'}:l)}
  s=ok(A.adjustStock(s,ctx(s),'rm2','w1',-3,'Muddati o‘tgan',{lots:[{lot:'L-B',qty:3}]}))
  assert.equal(lotSum(s,'rm2','w1'),5)
  // Untracked items keep working from the balance alone.
  s=withStock(s,'p4','w3',[],50)
  s=ok(A.adjustStock(s,ctx(s),'p4','w3',-20,'Sanoq'))
  assert.equal(bal(s,'p4','w3').onHand,30)
  refused(s,A.adjustStock(s,ctx(s),'p4','w3',0,'Sanoq'),/Farq/)
  refused(s,A.adjustStock(s,ctx(s),'rm-nope','w1',1,'x'),/topilmadi/)
})

/* ---------------------------------------------------------------------- UoM (#24) -- */

test('UoM #5–#9: one conversion service — compatible, packs, incompatible, missing factor, exact decimals',()=>{
  const kg={name:'Alyuminiy',unit:'kg'},pcs={name:'Bolt',unit:'dona',packs:[{unit:'quti',factor:24}]}
  assert.deepEqual(U.convertQty(kg,1500,'g'),{value:1.5,factor:0.001})
  assert.equal(U.convertQty(kg,1.234,'kg','g').value,1234)
  assert.equal(U.convertQty({unit:'l'},250,'ml').value,0.25)
  assert.equal(U.convertQty({unit:'m'},45,'cm').value,0.45)
  assert.equal(U.convertQty(pcs,2,'quti').value,48)
  assert.equal(U.convertQty(pcs,5,'pcs').value,5,'piece ↔ piece')
  assert.match(U.convertQty(kg,1,'l').error,/konversiyasi mumkin emas/)
  assert.match(U.convertQty({unit:'dona'},1,'quti').error,/koeffitsiyenti yo‘q/,'a box is never assumed to hold N pieces')
  assert.match(U.convertQty({unit:'dona'},1,'kg').error,/mumkin emas/)
  assert.match(U.convertQty(kg,Number.NaN,'g').error,/son/)
  assert.match(U.convertQty(kg,0.5,'g').error,/kasr/,'0.0005 kg needs more decimals than kg keeps — refused, not rounded')
  assert.equal(U.convertQty(kg,0.5,'g','kg','half-up').value,0.001)
  // Float noise never reaches stored values: 0.1 + 0.2 kg in grams is exactly 300.
  assert.equal(U.convertQty(kg,0.1+0.2,'kg','g').value,300)
  let sum=0;for(let i=0;i<10;i++)sum=U.roundQty(sum+U.convertQty(kg,100,'g').value,3)
  assert.equal(sum,1)
  assert.equal(U.convertUnitCost(kg,22500,'kg','g').value,22.5,'price follows the quantity the other way')
  assert.equal(U.packsProblem({unit:'dona',packs:[{unit:'quti',factor:2.5}]}),'quti: dona butun sanaladi — koeffitsiyent butun son bo‘lishi kerak')
  assert.match(U.packsProblem({unit:'kg',packs:[{unit:'g',factor:1}]}),/standart birlik/)
  assert.equal(U.packsProblem({unit:'kg',packs:[{unit:'qop',factor:25}]}),null)
  assert.deepEqual(U.unitOptions(pcs),['dona','quti'])
})

test('UoM #10: BOM, PO and receiving quantities reconcile after conversion',()=>{
  let s=clean()
  // Master data: rm4 (dona) gets a pack; a broken pack is refused.
  refused(s,A.updateEntity(s,ctx(s),'rawMaterials','rm4',{packs:[{unit:'quti',factor:0}]},'Xomashyo'),/koeffitsiyent/)
  s=ok(A.updateEntity(s,ctx(s),'rawMaterials','rm4',{packs:[{unit:'quti',factor:100}]},'Xomashyo'))
  // A BOM line in grams: stored with its factor; the order's plan is in kg.
  const draft=A.createBomDraft(s,ctx(s),'p1');s=ok(draft)
  const bom=s.boms.find(b=>b.id===draft.result.id)
  s=ok(A.saveBom(s,ctx(s),{...bom,components:bom.components.map(c=>c.materialId==='rm1'?{...c,unit:'g',qty:1130}:c)}))
  const line=s.boms.find(b=>b.id===bom.id).components.find(c=>c.materialId==='rm1')
  assert.deepEqual([line.unit,line.qty,line.factor],['g',1130,0.001])
  near(E.perUnit(line),E.perUnit({qty:1.13,waste:line.waste}),'1130 g per unit = 1.13 kg per unit')
  near(P.explodeBom(s,bom.id,10).totals.find(t=>t.itemId==='rm1').qty,Math.round(10*E.perUnit({qty:1.13,waste:line.waste})*1000)/1000)
  assert.equal(P.explodeBom(s,bom.id,10).totals.find(t=>t.itemId==='rm1').unit,'kg')
  // Receiving in another unit: converted strictly, the typed quantity kept on the receipt.
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su3',lines:[{materialId:'rm4',qty:500}],status:'Tasdiqlangan'});s=ok(po)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',2,undefined,undefined,{unit:'kg'}),/mumkin emas/)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',2,undefined,undefined,{unit:'paket'}),/koeffitsiyenti yo‘q/)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm4',6,undefined,undefined,{unit:'quti'}),/qolgan 500/)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm4',2,undefined,undefined,{unit:'quti'}))
  const p=s.purchaseOrders.find(x=>x.id===po.result.id)
  assert.deepEqual([p.items[0].received,p.receipts[0].qty,p.receipts[0].entered],[200,200,{qty:2,unit:'quti'}])
  assert.equal(bal(s,'rm4','w1').onHand,200)
  assert.equal(lotSum(s,'rm4','w1'),200,'the lot is in stock units')
  // kg material received in grams.
  const po2=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:10}],status:'Tasdiqlangan'});s=ok(po2)
  s=ok(A.receivePurchase(s,ctx(s),po2.result.id,'rm2',2500,undefined,undefined,{unit:'g'}))
  assert.equal(bal(s,'rm2','w1').onHand,2.5)
  // An adjustment and a transfer accept a unit too.
  s=ok(A.adjustStock(s,ctx(s),'rm2','w1',500,'Topildi',{unit:'g'}))
  assert.equal(bal(s,'rm2','w1').onHand,3)
})

/* ----------------------------------------------------------------- variants (#15) -- */

/** Clean data with raw stock for p1 and p1 variant stock switched on (no legacy stock). */
function variantState(){
  let s=withStock(withStock(clean(),'rm1','w1',[{code:'AL-1',qty:500}]),'rm3','w1',[{code:'PC-1',qty:50,expiry:'2027-06-01'}])
  return ok(A.setVariantStock(s,ctx(s),'p1',true))
}

test('Variant #11: variant A demand never uses variant B stock',()=>{
  let s=variantState()
  s=ok(A.adjustStock(s,ctx(s),I.stockKey('p1','v2'),'w3',10,'Opening'))
  assert.equal(A.salesAvailable(s,s.employees[0],'p1',TODAY,'v1'),0)
  assert.equal(A.salesAvailable(s,s.employees[0],'p1',TODAY,'v2'),10)
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',variantId:'v1',qty:5}]});s=ok(so)
  const line=s.salesOrders.find(o=>o.id===so.result.id).items[0]
  assert.equal(line.reserved,0,'nothing of v2 is reserved for v1')
  assert.equal(bal(s,'p1~v2','w3').reserved,0)
  refused(s,A.deliverSalesOrder(s,ctx(s),so.result.id),/yetarli emas/)
  // A line of a variant-tracked product must name its variant; the product total is the sum, never twice.
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',qty:1}]}),/variantni tanlang/)
  refused(s,A.adjustStock(s,ctx(s),'p1','w3',5,'x'),/variantni tanlang/)
  assert.equal(E.productStockOf(s,'p1').onHand,10)
  assert.equal(E.stockOf(s,'p1').onHand,0,'the bare product key holds only legacy (unassigned) stock')
})

test('Variant #12/#13: production adds to the variant made; delivery consumes exactly the reserved variant',()=>{
  let s=variantState()
  refused(s,A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5}),/variantni tanlang/)
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p1',variantId:'v1',quantity:5});s=ok(mo)
  s=run(s,mo.result.id)
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,5))
  assert.equal(bal(s,'p1~v1','w3').onHand,5)
  assert.equal(bal(s,'p1~v2','w3'),undefined)
  const lot=s.lots.find(l=>l.sourceId===mo.result.id)
  assert.deepEqual([lot.itemId,lot.variantId],['p1','v1'])
  assert.ok(s.stockMovements.some(m=>m.type==='Production +'&&m.itemId==='p1'&&m.variantId==='v1'))
  s=ok(A.adjustStock(s,ctx(s),'p1~v2','w3',7,'Opening'))
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',variantId:'v1',qty:4}]});s=ok(so)
  assert.deepEqual(s.salesOrders.find(o=>o.id===so.result.id).items[0].reservations[0].lots,[{lot:lot.code,qty:4}])
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.deepEqual([bal(s,'p1~v1','w3').onHand,bal(s,'p1~v1','w3').reserved,bal(s,'p1~v2','w3').onHand],[1,0,7])
  assert.ok(s.stockMovements.filter(m=>m.type==='Sale -').every(m=>m.variantId==='v1'&&m.lot===lot.code))
  // A return goes back as the shipped variant.
  s=ok(A.createReturn(s,ctx(s),{salesOrderId:so.result.id,productId:'p1',qty:1,reason:'Tirnalgan'}))
  assert.equal(bal(s,'p1~v1','w3').quarantine,1)
  assert.equal(s.returns[0].variantId,'v1')
  // Costing of the order is its own consumption (the variant actually made).
  assert.ok(order(s,mo.result.id).consumed.length>0)
})

test('Variant #14: legacy product stock is preserved as unassigned, offered to no variant, and reconciled explicitly',()=>{
  let s=withStock(clean(),'p1','w3',[{code:'FG-OLD',qty:20,sourceType:'production',sourceId:'mo-old',sourceCode:'MO-OLD'}])
  // Open sales lines of a variant reserved on the product: switching would change their meaning.
  const held=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',variantId:'v1',qty:2}]})
  refused(ok(held),A.setVariantStock(ok(held),ctx(ok(held)),'p1',true),/rezerv qilgan/)
  s=ok(A.setVariantStock(s,ctx(s),'p1',true))
  assert.deepEqual([E.stockOf(s,'p1').onHand,E.stockOf(s,'p1~v1').onHand,E.stockOf(s,'p1~v2').onHand,E.productStockOf(s,'p1').onHand],[20,0,0,20])
  assert.ok(I.inventoryIssues(s,()=>true).some(i=>i.kind==='variant-unassigned'&&i.qty===20))
  assert.equal(A.salesAvailable(s,s.employees[0],'p1',TODAY,'v1'),0,'legacy stock is not offered to any variant')
  refused(s,A.assignVariantStock(s,ctx(s),{warehouseId:'w3',productId:'p1',variantId:'v1',qty:21}),/kerak 21/)
  refused(s,A.assignVariantStock(s,ctx(s),{warehouseId:'w3',productId:'p1',variantId:'v9',qty:1}),/variant/i)
  s=ok(A.assignVariantStock(s,ctx(s),{warehouseId:'w3',productId:'p1',variantId:'v1',qty:8,note:'Sanoq'}))
  assert.deepEqual([E.stockOf(s,'p1').onHand,E.stockOf(s,'p1~v1').onHand,E.productStockOf(s,'p1').onHand],[12,8,20])
  const moved=s.lots.find(l=>l.variantId==='v1')
  assert.deepEqual([moved.code,moved.sourceType,moved.sourceCode,moved.qty],['FG-OLD','production','MO-OLD',8],'lot provenance kept')
  const mv=s.stockMovements.filter(m=>m.type.startsWith('Variant reconcile'))
  assert.equal(mv.reduce((a,m)=>a+m.qty,0),0,'out of the product = into the variant')
  // Off again only when no variant holds anything.
  refused(s,A.setVariantStock(s,ctx(s),'p1',false),/variantlarda qoldiq/)
  refused(s,A.updateEntity(s,ctx(s),'products','p1',{variantStock:false},'Mahsulot'),/faqat/)
})

test('Variant #15: non-variant products and variant-as-configuration keep working as before',()=>{
  let s=withStock(withStock(clean(),'rm2','w1',[{code:'ST-1',qty:200}]),'p1','w3',[{code:'FG-1',qty:10,sourceType:'production'}])
  // p1 without variant stock: a variant line is a configuration of the shared product stock.
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',variantId:'v2',qty:3}]});s=ok(so)
  assert.equal(bal(s,'p1','w3').reserved,3)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(bal(s,'p1','w3').onHand,7)
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:10});s=ok(mo)
  s=run(s,mo.result.id)
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,10))
  assert.equal(bal(s,'p3','w3').onHand,10)
  assert.equal(s.lots.find(l=>l.sourceId===mo.result.id).variantId,undefined)
})

/* ---------------------------------------------------------------- locations (#17) -- */

test('Location #16/#17: a receipt goes into its bin; warehouse totals equal the location ledger',()=>{
  let s=clean()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:100}],status:'Tasdiqlangan'});s=ok(po)
  refused(s,A.receivePurchase(s,ctx(s),po.result.id,'rm2',10,undefined,undefined,{location:'FG-A'}),/joyi yo‘q/)
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',60,undefined,undefined,{location:'RAW-A1'}))
  s=ok(A.receivePurchase(s,ctx(s),po.result.id,'rm2',40))
  const b=bal(s,'rm2','w1')
  assert.deepEqual([b.onHand,b.bins,I.unassignedQty(b)],[100,{'RAW-A1':60},40])
  assert.equal(s.lots.find(l=>l.itemId==='rm2'&&l.location==='RAW-A1').qty,60)
  assert.equal(s.stockMovements.find(m=>m.type==='Purchase +'&&m.location==='RAW-A1').qty,60)
  // Production issue takes lots from the bins they sit in (FEFO by receipt): bins and lots stay in step.
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:50});s=ok(mo)
  s=run(s,mo.result.id)
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,50))
  const after=bal(s,'rm2','w1')
  near(after.onHand,100-50*E.perUnit({qty:.72,waste:3.8}))
  near(I.binQty(after,'RAW-A1'),lotSum(s,'rm2','w1','RAW-A1'),'bin = its lots')
  near(I.unassignedQty(after),lotSum(s,'rm2','w1',''),'unassigned = its lots')
  assertLocations(s)
})

test('Location #18: a bin move is atomic, keeps the warehouse total and moves a lot only from where it sits',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'L1',qty:30,location:'RAW-A1'},{code:'L2',qty:20}],5)
  const total=bal(s,'rm2','w1').onHand
  const mv=(p)=>A.moveStockBin(s,ctx(s),{warehouseId:'w1',itemId:'rm2',...p})
  refused(s,mv({from:'RAW-A1',to:'RAW-A1',qty:1}),/bir xil/)
  refused(s,mv({from:'RAW-A1',to:'NOPE',qty:1}),/joyi yo‘q/)
  refused(s,mv({from:'RAW-A1',to:'RAW-A2',qty:31}),/30/)
  refused(s,mv({from:'RAW-A2',to:'RAW-A1',qty:1,lot:'L1'}),/bor, 1 ko‘chirib|turgan joyidan/)
  refused(s,mv({from:'',to:'RAW-A2',qty:1,lot:'L1'}),/turgan joyidan/)
  refused(s,mv({from:'RAW-A1',to:'RAW-A2',qty:0}),/Miqdor/)
  s=ok(mv({from:'RAW-A1',to:'RAW-A2',qty:12,lot:'L1'}))
  s=ok(A.moveStockBin(s,ctx(s),{warehouseId:'w1',itemId:'rm2',from:'',to:'RAW-A2',qty:25}))
  const b=bal(s,'rm2','w1')
  assert.deepEqual([b.onHand,b.bins],[total,{'RAW-A1':18,'RAW-A2':37}])
  assert.equal(lotSum(s,'rm2','w1','RAW-A2'),32,'12 of L1 + 20 of L2 (lots first) — 5 untracked moved too')
  assert.equal(s.stockMovements.filter(m=>m.type.startsWith('Bin transfer')).reduce((a,m)=>a+m.qty,0),0)
  const moved=s.lots.find(l=>l.code==='L1'&&l.location==='RAW-A2')
  assert.deepEqual([moved.sourceType,moved.sourceCode],['purchase','PO-X'])
  assertLocations(s)
})

test('Location #19: a warehouse-to-warehouse LOT transfer keeps provenance and reconciles out = in',()=>{
  let s=withStock(clean(),'rm3','w1',[{code:'PC-9',qty:40,location:'RAW-A2',expiry:'2027-03-01',sourceId:'po-9',sourceCode:'PO-9'}])
  refused(s,A.transferStock(s,ctx(s),'rm3','w1','w4',5,undefined,{toLocation:'RAW-A1'}),/joyi yo‘q/)
  refused(s,A.transferStock(s,ctx(s),'rm3','w1','w4',5,undefined,{fromLocation:'RAW-A1'}),/0 kg bor/)
  s=ok(A.transferStock(s,ctx(s),'rm3','w1','w4',15,[{lot:'PC-9',qty:15}],{fromLocation:'RAW-A2',toLocation:'MIX-01'}))
  assert.deepEqual([bal(s,'rm3','w1').onHand,bal(s,'rm3','w1').bins,bal(s,'rm3','w4').onHand,bal(s,'rm3','w4').bins],[25,{'RAW-A2':25},15,{'MIX-01':15}])
  const copy=s.lots.find(l=>l.warehouseId==='w4'&&l.code==='PC-9')
  assert.deepEqual([copy.location,copy.expiry,copy.sourceId,copy.sourceCode,copy.qty],['MIX-01','2027-03-01','po-9','PO-9',15])
  const tr=s.stockMovements.filter(m=>m.type.startsWith('Transfer'))
  assert.equal(tr.reduce((a,m)=>a+m.qty,0),0)
  assert.deepEqual(tr.map(m=>m.location).sort(),['MIX-01','RAW-A2'])
  assertLocations(s)
})

test('Location #20: counts and adjustments per location never create negative stock',()=>{
  let s=withStock(clean(),'p4','w3',[],0)
  s=ok(A.adjustStock(s,ctx(s),'p4','w3',30,'Topildi',{location:'FG-A'}))
  s=ok(A.adjustStock(s,ctx(s),'p4','w3',10,'Topildi'))
  refused(s,A.adjustStock(s,ctx(s),'p4','w3',-31,'Sanoq',{location:'FG-A'}),/FG-A.*30/)
  refused(s,A.adjustStock(s,ctx(s),'p4','w3',-41,'Sanoq'),/manfiy|kam/)
  const b=bal(s,'p4','w3')
  refused(s,A.countStock(s,ctx(s),b.id,-1,'Sanoq',{location:'FG-A'}),/Sanalgan/)
  refused(s,A.countStock(s,ctx(s),b.id,5,'Sanoq',{location:'NOPE'}),/joyi yo‘q/)
  s=ok(A.countStock(s,ctx(s),b.id,25,'Sanoq',{location:'FG-A'}))
  const after=bal(s,'p4','w3')
  assert.deepEqual([after.onHand,after.bins,I.unassignedQty(after)],[35,{'FG-A':25},10])
  s=ok(A.countStock(s,ctx(s),b.id,0,'Sanoq',{location:''}))
  assert.deepEqual([bal(s,'p4','w3').onHand,bal(s,'p4','w3').bins],[25,{'FG-A':25}])
  // A location holding stock cannot be removed from the warehouse.
  refused(s,A.updateEntity(s,ctx(s),'warehouses','w3',{locations:['FG-B','DISPATCH']},'Ombor'),/FG-A joyida qoldiq bor/)
  assertLocations(s)
})

test('Location #21: a user outside the warehouse scope cannot change its locations',()=>{
  const s=withStock(clean(),'rm2','w1',[{code:'L1',qty:10,location:'RAW-A1'}])
  const people={...s,employees:[...s.employees,{...s.employees[0],id:'em-k1',roleId:'role6',workCenterId:'wc1',warehouseId:'w1'},{...s.employees[0],id:'em-k4',roleId:'role6',workCenterId:'wc4',warehouseId:'w4'},{...s.employees[0],id:'em-op',roleId:'role5',workCenterId:'wc1'}]}
  const who=id=>people.employees.find(e=>e.id===id)
  const args=[{warehouseId:'w1',itemId:'rm2',from:'RAW-A1',to:'RAW-A2',qty:1}]
  assert.equal(X.commandBlocker(people,who('em-k1'),'moveStockBin',args),null)
  assert.match(X.commandBlocker(people,who('em-k4'),'moveStockBin',args),/Xomashyo ombori omboriga tegishli/)
  assert.match(X.commandBlocker(people,who('em-op'),'moveStockBin',args),/ruxsat yo‘q/)
  assert.match(X.commandBlocker(people,who('em-k4'),'adjustStock',['rm2','w1',-1,'x',{location:'RAW-A1'}]),/omboriga tegishli/)
  assert.match(X.commandBlocker(people,who('em-k4'),'assignVariantStock',[{warehouseId:'w3',productId:'p1',variantId:'v1',qty:1}]),/omboriga tegishli/)
  assert.match(X.commandBlocker(people,who('em-op'),'setVariantStock',['p1',true]),/ruxsat yo‘q/)
})

/* ------------------------------------------------------------------- site MRP (#16) -- */

/** Clean data with a p3 draft MO in branch b1 (rm2 demand) and rm2 stock only in b2's store. */
function siteState(){
  let s=withStock(clean(),'rm2','w4',[{code:'B2-ST',qty:300}])
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:100,start:TODAY,due:'2026-11-03'});s=ok(mo)
  return {s,mo:mo.result.id,need:E.plannedIssue(order(s,mo.result.id),'rm2')}
}

test('Site MRP #22/#26: branch A never treats branch B stock as its own; a transfer is only recommended',()=>{
  const {s,need}=siteState()
  const before=JSON.stringify(s)
  const plan=P.runMrp(s,{today:TODAY})
  const b1=plan.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b1'),b2=plan.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b2')
  assert.deepEqual([b1.available,b2.available],[0,300])
  near(b1.buckets[0].gross,need)
  assert.equal(b2.buckets.reduce((a,x)=>a+x.gross,0),0,'b1 demand is not b2 demand')
  const buy=plan.suggestions.find(x=>x.type==='buy'&&x.itemId==='rm2'&&x.branchId==='b1')
  assert.ok(buy&&buy.key.endsWith('@b1'),'b1 still gets its own buy suggestion')
  assert.ok(!plan.suggestions.some(x=>x.itemId==='rm2'&&x.branchId==='b2'),'b2 has no need')
  const tr=plan.transfers.find(t=>t.itemId==='rm2')
  assert.deepEqual([tr.fromBranchId,tr.toBranchId,tr.forSuggestion],['b2','b1',buy.key])
  assert.ok(tr.qty>0&&tr.qty<=300)
  assert.equal(JSON.stringify(s),before,'planning never moves stock')
  assert.equal(P.runMrp(s,{today:TODAY,branchId:'b2'}).rows.every(r=>r.branchId==='b2'),true)
})

test('Site MRP #23/#24: incoming supply and reservations count at their own site, once',()=>{
  let {s,mo}=siteState()
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:500}],status:'Tasdiqlangan',warehouseId:'w4',expectedDate:'2026-11-02'});s=ok(po)
  let plan=P.runMrp(s,{today:TODAY})
  assert.equal(plan.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b2').buckets.reduce((a,x)=>a+x.scheduled,0),500)
  assert.equal(plan.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b1').buckets.reduce((a,x)=>a+x.scheduled,0),0)
  // Stock moved to b1 by a real transfer, then the MO reserves it: its need leaves gross and the stock leaves available.
  s=ok(A.transferStock(s,ctx(s),'rm2','w4','w1',200))
  s=ok(A.transitionProduction(s,ctx(s),mo,'Tasdiqlangan'))
  plan=P.runMrp(s,{today:TODAY})
  const b1=plan.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b1')
  assert.equal(b1.buckets.reduce((a,x)=>a+x.gross,0),0,'a reserved order is not demand again')
  near(b1.available,200-b1.reserved)
  near(b1.reserved,E.plannedIssue(order(s,mo),'rm2'))
})

test('Site MRP #25: variant demand plans the variant with its BOM; BOM UoM converts into the component unit',()=>{
  let s=variantState()
  // A v1-specific BOM revision with its aluminium line in grams.
  const draft=A.createBomDraft(s,ctx(s),'p1',undefined,'v1');s=ok(draft)
  const bom=s.boms.find(b=>b.id===draft.result.id)
  s=ok(A.saveBom(s,ctx(s),{...bom,components:bom.components.map(c=>c.materialId==='rm1'?{...c,unit:'g',qty:2000}:c)}))
  s=ok(A.activateBom(s,ctx(s),bom.id))
  s={...s,salesOrders:[{id:'so-v',code:'SO-V',customerId:'cu1',status:'Tasdiqlangan',mode:'Make-to-order',branchId:'b1',items:[{productId:'p1',variantId:'v1',qty:40,price:1,delivered:0,reserved:0}],total:40,paymentStatus:'',deliveryDate:'2026-11-04',createdAt:TODAY}]}
  const plan=P.runMrp(s,{today:TODAY})
  const make=plan.suggestions.find(x=>x.type==='make'&&x.branchId==='b1')
  assert.equal(make.itemId,'p1~v1')
  assert.match(make.makeOrBuy,new RegExp(bom.code))
  const line=s.boms.find(b=>b.id===bom.id).components.find(c=>c.materialId==='rm1')
  const planned=plan.rows.find(r=>r.itemId==='rm1'&&r.branchId==='b1').buckets.reduce((a,x)=>a+x.gross,0)
  near(planned,make.qty*2*(1+line.waste/100),'2000 g per unit = 2 kg per unit')
  assert.ok(!plan.suggestions.some(x=>x.itemId==='p1~v2'),'v2 has no demand')
  // Confirming makes an MO for the variant at the planning site.
  const out=A.confirmMrpSuggestion(s,ctx(s),make.key);s=ok(out)
  assert.deepEqual([order(s,out.result.id).variantId,order(s,out.result.id).bomId],['v1',bom.id])
})

test('Site MRP #27: suggestions keep their demand, land at their site and are never duplicated',()=>{
  let {s,mo}=siteState()
  const buy=P.runMrp(s,{today:TODAY}).suggestions.find(x=>x.type==='buy'&&x.itemId==='rm2'&&x.branchId==='b1')
  assert.ok(buy.refs.some(r=>r.kind==='mo'&&r.id===mo),'the shortage names the order it comes from')
  refused(s,A.confirmMrpSuggestion(s,ctx(s),'buy:rm2:2026-01-01@b1'),/topilmadi/)
  const po=A.confirmMrpSuggestion(s,ctx(s),buy.key);s=ok(po)
  const draft=s.purchaseOrders.find(p=>p.id===po.result.id)
  assert.equal(draft.warehouseId,'w1','into the b1 raw store')
  assert.deepEqual(draft.productionOrderIds,[mo])
  assert.equal(P.runMrp(s,{today:TODAY}).suggestions.find(x=>x.key===buy.key).existing,draft.code)
  refused(s,A.confirmMrpSuggestion(s,ctx(s),buy.key),/allaqachon yaratilgan/)
  // A b2 planner may not raise a b1 document.
  const planner={...s,employees:[...s.employees,{...s.employees[0],id:'em-pm2',roleId:'role2',workCenterId:'wc4'}]}
  assert.match(X.commandBlocker(planner,planner.employees.find(e=>e.id==='em-pm2'),'confirmMrpSuggestion',[buy.key])||'',/boshqa filialga|ruxsat/)
})

/* ----------------------------------------------------------- end-to-end workflow -- */

test('Workflow: SO variant A → site MRP → PO → bin receipt → QC → reservation → issue → finished A → delivery → trace',()=>{
  let s=createInitialState(T0)
  s=ok(A.setVariantStock(s,ctx(s),'p1',true))
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p1',variantId:'v1',qty:20}],deliveryDate:'2026-11-06',branchId:'b1'});s=ok(so)
  let plan=P.runMrp(s,{today:TODAY})
  const make=plan.suggestions.find(x=>x.itemId==='p1~v1'&&x.branchId==='b1')
  assert.ok(make.refs.some(r=>r.id===so.result.id))
  const mo=A.confirmMrpSuggestion(s,ctx(s),make.key);s=ok(mo)
  assert.equal(order(s,mo.result.id).variantId,'v1')
  plan=P.runMrp(s,{today:TODAY})
  for(const m of ['rm1','rm3']){
    // The suggestion pegged to the MO (an earlier one may only restore safety stock).
    const buy=plan.suggestions.find(x=>x.type==='buy'&&x.itemId===m&&x.branchId==='b1'&&x.refs.some(r=>r.kind==='mo'))
    assert.ok(buy.origins.some(r=>r.kind==='mo'&&r.id===mo.result.id),`${m} shortage traced to its demand`)
    const po=A.confirmMrpSuggestion(s,ctx(s),buy.key);s=ok(po)
    s=ok(A.confirmPurchase(s,ctx(s),po.result.id))
    const line=s.purchaseOrders.find(p=>p.id===po.result.id).items[0]
    s=ok(A.receivePurchase(s,ctx(s),po.result.id,m,line.qty,undefined,m==='rm3'?'2027-06-01':undefined,{location:'RAW-A1'}))
    const qc=s.qualityChecks.find(q=>q.sourceId===po.result.id&&q.status==='Pending')
    if(qc){
      assert.equal(bal(s,m,'w1').quarantine,line.qty,'held in QC until inspected')
      s=ok(A.resolveQuality(s,ctx(s),qc.id,'Passed'))
    }
    assert.equal(I.binQty(bal(s,m,'w1'),'RAW-A1'),line.qty)
  }
  const id=mo.result.id
  s=run(s,id)
  assert.ok(order(s,id).materialReserved)
  assert.ok(order(s,id).reservations.every(r=>r.lots?.length&&!r.untracked),'reserved as real lots')
  for(const wo of order(s,id).workOrders){s=ok(A.startWorkOrder(s,ctx(s),id,wo.id),'wo: ');s=ok(A.finishWorkOrder(s,ctx(s),id,wo.id),'wo: ')}
  s=ok(A.reportOutput(s,ctx(s),id,order(s,id).quantity))
  assert.equal(bal(s,'p1~v1','w3').quarantine,order(s,id).quantity,'finished A waits in Final QC')
  s=ok(A.transitionProduction(s,ctx(s),id,'Sifat nazoratida'))
  assert.ok(s.qualityChecks.some(q=>q.sourceId===id&&q.type==='Final'&&q.status==='Pending'))
  for(const q of s.qualityChecks.filter(q=>q.sourceId===id&&q.status==='Pending'))s=ok(A.resolveQuality(s,ctx(s),q.id,'Passed'))
  s=ok(A.transitionProduction(s,ctx(s),id,'Yakunlangan'))
  assert.ok(order(s,id).costSnapshot,'cost frozen for the variant actually made')
  assert.ok(bal(s,'p1~v1','w3').onHand>=20)
  assert.equal(bal(s,'p1~v2','w3'),undefined)
  s=ok(A.reserveSalesOrder(s,ctx(s),so.result.id))
  s=ok(A.deliverSalesOrder(s,ctx(s),so.result.id))
  assert.equal(s.salesOrders.find(o=>o.id===so.result.id).status,'Yetkazildi')
  const trace=E.buildTraceability(s,id)
  assert.ok(trace.upstreamLots.every(l=>l.sourceType==='purchase'&&l.location==='RAW-A1'||l.location===undefined))
  assert.ok(trace.downstreamSales.some(o=>o.id===so.result.id))
  assert.ok(trace.outputLots.every(l=>l.variantId==='v1'))
  // Raw bins drained as the lots in them were issued; everything reconciles.
  assertLocations(s)
  assert.deepEqual(I.inventoryIssues(s,k=>['rm1','rm3'].includes(k)||k.startsWith('p1')),[])
})

test('Boundaries: zero, invalid ids, stale or duplicate commands and archived records are refused without change',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'L1',qty:10,location:'RAW-A1'}])
  refused(s,A.moveStockBin(s,ctx(s),{warehouseId:'w-nope',itemId:'rm2',from:'RAW-A1',to:'RAW-A2',qty:1}),/topilmadi/)
  refused(s,A.moveStockBin(s,ctx(s),{warehouseId:'w1',itemId:'rm-nope',from:'RAW-A1',to:'RAW-A2',qty:1}),/topilmadi/)
  refused(s,A.moveStockBin(s,ctx(s),{warehouseId:'w1',itemId:'rm2',from:'RAW-A1',to:'RAW-A2',qty:Number.NaN}),/Miqdor/)
  refused(s,A.transferStock(s,ctx(s),'p1~v1','w3','w4',1),/variantlar alohida qoldiq sifatida yuritilmaydi/)
  refused(s,A.setVariantStock(s,ctx(s),'p3',true),/faol variant yo‘q/)
  refused(s,A.setVariantStock(s,ctx(s),'p-nope',true),/topilmadi/)
  refused(s,A.assignVariantStock(s,ctx(s),{warehouseId:'w3',productId:'p1',variantId:'v1',qty:1}),/avval variant qoldig‘ini yoqing/)
  refused(s,A.setForecast(s,ctx(s),'p1','2026-13-01',5),/sana/)
  refused(s,A.setForecast(s,ctx(s),'p1','2026-11-02',5,{branchId:'b-nope'}),/Filial/)
  refused(s,A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',branchId:'b-nope',lines:[{productId:'p3',qty:1}]}),/Filial/)
  const archived={...s,warehouses:s.warehouses.map(w=>w.id==='w1'?{...w,status:'Arxiv'}:w)}
  refused(archived,A.moveStockBin(archived,ctx(archived),{warehouseId:'w1',itemId:'rm2',from:'RAW-A1',to:'RAW-A2',qty:1}),/arxivlangan/)
  // A forecast per site and variant is its own row; setting it again updates, never duplicates.
  s=ok(A.setForecast(s,ctx(s),'p1','2026-11-02',5,{branchId:'b2',variantId:'v1'}))
  s=ok(A.setForecast(s,ctx(s),'p1','2026-11-02',7,{branchId:'b2',variantId:'v1'}))
  assert.deepEqual(s.forecasts.map(f=>[f.branchId,f.variantId,f.qty]),[['b2','v1',7]])
})
