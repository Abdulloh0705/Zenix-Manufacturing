// Sales completion (2026-11-12): exact serial units at delivery, sellable-unit list, and editing open order lines.
// A refused command returns the very state it was given (no partial mutation).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as I from '../.test-dist/inventory.mjs'
import * as SN from '../.test-dist/serials.mjs'
import * as R from '../.test-dist/receivables.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-sc${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given')
  return out
}
const policies=(s,p)=>({...s,settings:{...s.settings,policies:{...s.settings.policies,...p}}})
const clean=(p={requireFinalQc:false,autoQualityChecks:false})=>policies(createInitialState(T0),p)
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
function withStock(s,key,warehouseId,lots){
  const product=s.products.find(p=>p.id===key)
  const itemType=product?'finished':'raw'
  const unit=(product||s.rawMaterials.find(m=>m.id===key)).unit
  const rows=lots.map((l,i)=>({id:`lot-${key}-${warehouseId}-${l.code}`,code:l.code,kind:'lot',itemId:key,itemType,qty:l.qty,originalQty:l.qty,warehouseId,status:'available',
    sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:`2026-10-0${i+1} 08:00`,consumedBy:[]}))
  const old=bal(s,key,warehouseId)
  return {...s,lots:[...s.lots,...rows],stockBalances:[...s.stockBalances.filter(b=>b!==old),
    {id:`st-${key}-${warehouseId}`,warehouseId,itemId:key,itemType,onHand:(old?.onHand||0)+rows.reduce((a,l)=>a+l.qty,0),reserved:old?.reserved||0,incoming:0,quarantine:0,unit}]}
}
const p2Parts=s=>withStock(withStock(withStock(s,'rm2','w1',[{code:'ST-1',qty:200}]),'rm4','w1',[{code:'HW-1',qty:500}]),'p3','w3',[{code:'P3-1',qty:200}])
function makeSerials(s,qty){
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p2',quantity:qty,start:TODAY,due:'2026-10-30'});s=ok(mo,'mo: ')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'),'confirm: ')
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Jarayonda'),'start: ')
  s=ok(A.reportOutput(s,ctx(s),mo.result.id,qty),'output: ')
  return s
}
function sell(s,qty,productId='p2',price=200000){
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',deliveryDate:'2026-10-25',lines:[{productId,qty,price}]});s=ok(so,'so: ')
  return {s,id:so.result.id,code:s.salesOrders.find(o=>o.id===so.result.id).code}
}
const SNo=n=>`SN-VK210-00000${n}`
const shippedLots=(s,code)=>s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===code).map(m=>m.lot).sort()
const soOf=(s,id)=>s.salesOrders.find(o=>o.id===id)
const pins=(s,id)=>soOf(s,id).items[0].reservations.flatMap(r=>(r.lots||[]).map(p=>p.lot)).sort()

test('delivery ships exactly the chosen serial unit, not the FEFO one; the reserved unit returns to free stock',()=>{
  let s=makeSerials(p2Parts(clean()),3)
  const so=sell(s,1);s=so.s
  assert.deepEqual(pins(s,so.id),[SNo(1)],'reservation pins the oldest unit')
  const list=A.sellableSerials(s,s.employees.find(e=>e.id==='em1'),soOf(s,so.id),'p2',TODAY)
  assert.deepEqual(list.map(u=>[u.code,u.reserved]),[[SNo(1),true],[SNo(2),false],[SNo(3),false]],'own reserved unit first')
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id,{p2:1},{p2:[SNo(3)]}))
  assert.deepEqual(shippedLots(s,so.code),[SNo(3)],'the ledger row carries the chosen number')
  assert.equal(SN.serialStatus(s,SNo(3)).status,'sold')
  assert.equal(SN.serialStatus(s,SNo(1)).status,'available')
  const o=soOf(s,so.id)
  assert.equal(o.status,'Yetkazildi');assert.equal(o.items[0].delivered,1);assert.equal(o.items[0].reserved,0);assert.deepEqual(o.items[0].reservations,[])
  assert.equal(bal(s,'p2','w3').reserved,0,'no reservation is left behind');assert.equal(bal(s,'p2','w3').onHand,2)
  assert.equal(R.orderReceivable(s,so.id).invoiced,200000,'the shipment is invoiced once')
})

test('serial picks are refused when the count is wrong, the unit is sold, held by another order, unknown, duplicated or QC-held',()=>{
  let s=makeSerials(p2Parts(clean()),3)
  const a=sell(s,1);s=a.s
  const b=sell(s,1);s=b.s
  assert.deepEqual([pins(s,a.id),pins(s,b.id)],[[SNo(1)],[SNo(2)]])
  refused(s,A.deliverSalesOrder(s,ctx(s),b.id,{p2:1},{p2:[]}),/1 ta serial raqam tanlang \(0/)
  refused(s,A.deliverSalesOrder(s,ctx(s),b.id,{p2:1},{p2:[SNo(1)]}),/boshqa buyurtma uchun band/)
  refused(s,A.deliverSalesOrder(s,ctx(s),b.id,{p2:1},{p2:['SN-NOPE-1']}),/bunday serial raqam yo‘q/)
  refused(s,A.deliverSalesOrder(s,ctx(s),b.id,{p2:1},{p2:`${SNo(2)},${SNo(2)}`}),/ikki marta/)
  refused(s,A.deliverSalesOrder(s,ctx(s),b.id,{p2:1},{p2:['bad serial!']}),/noto‘g‘ri/)
  s=ok(A.deliverSalesOrder(s,ctx(s),a.id,{p2:1},{p2:[SNo(1)]}))
  refused(s,A.deliverSalesOrder(s,ctx(s),b.id,{p2:1},{p2:[SNo(1)]}),/sotilgan.*qayta sotib bo‘lmaydi/)
  // A unit put on QC hold is not sellable even though it is in stock.
  const held={...s,lots:s.lots.map(l=>l.code===SNo(3)&&l.qty>0?{...l,status:'hold'}:l)}
  refused(held,A.deliverSalesOrder(held,ctx(held),b.id,{p2:1},{p2:[SNo(3)]}),/sotuvga yaroqsiz/)
  // A product without serial tracking takes no serial list.
  let t=withStock(clean(),'p3','w3',[{code:'L-1',qty:5}])
  const c=sell(t,1,'p3',1000);t=c.s
  refused(t,A.deliverSalesOrder(t,ctx(t),c.id,{p3:1},{p3:['X-1']}),/serial raqam bilan yuritilmaydi/)
})

test('partial serial delivery keeps the rest reserved; the remaining unit ships later and returns name the sold unit',()=>{
  let s=makeSerials(p2Parts(clean()),3)
  const so=sell(s,2);s=so.s
  assert.deepEqual(pins(s,so.id),[SNo(1),SNo(2)])
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id,{p2:1},{p2:[SNo(2)]}))
  let o=soOf(s,so.id)
  assert.equal(o.status,'Tayyor','still fully reserved for what is left')
  assert.equal(o.items[0].delivered,1);assert.equal(o.items[0].reserved,1);assert.deepEqual(pins(s,so.id),[SNo(1)])
  assert.equal(bal(s,'p2','w3').reserved,1)
  refused(s,A.deliverSalesOrder(s,ctx(s),so.id,{p2:2},{p2:[SNo(1),SNo(3)]}),/maksimum 1/)
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id,{p2:1},{p2:[SNo(3)]}))
  o=soOf(s,so.id)
  assert.equal(o.status,'Yetkazildi');assert.equal(bal(s,'p2','w3').reserved,0,'the unused pin on 000001 was released')
  assert.deepEqual(shippedLots(s,so.code),[SNo(2),SNo(3)])
  assert.equal(SN.serialStatus(s,SNo(1)).status,'available')
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:so.id,productId:'p2',qty:1,reason:'Nuqson',serials:SNo(1)}),/yetkazilmagan/)
  s=ok(A.createReturn(s,ctx(s),{salesOrderId:so.id,productId:'p2',qty:1,reason:'Nuqson',serials:SNo(3)}))
  assert.equal(SN.serialStatus(s,SNo(3)).status,'quarantine')
})

test('without a serial list a serial line still ships its reserved units (FEFO, unchanged behaviour)',()=>{
  let s=makeSerials(p2Parts(clean()),2)
  const so=sell(s,1);s=so.s
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id))
  assert.deepEqual(shippedLots(s,so.code),[SNo(1)])
})

test('editing an open order: quantity up reserves more, down releases, price only on undelivered lines',()=>{
  let s=withStock(clean(),'p3','w3',[{code:'L-1',qty:10}])
  const so=sell(s,3,'p3',1000);s=so.s
  assert.equal(bal(s,'p3','w3').reserved,3)
  s=ok(A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:6,price:900}]))
  let o=soOf(s,so.id)
  assert.deepEqual([o.items[0].qty,o.items[0].price,o.total,o.items[0].reserved,o.status],[6,900,5400,6,'Tayyor'])
  assert.equal(bal(s,'p3','w3').reserved,6)
  s=ok(A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:2}]))
  o=soOf(s,so.id)
  assert.deepEqual([o.items[0].qty,o.items[0].reserved,o.total],[2,2,1800]);assert.equal(bal(s,'p3','w3').reserved,2,'excess reservation released')
  s=ok(A.deliverSalesOrder(s,ctx(s),so.id,{p3:1}))
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:2,price:1000}]),/narxi o‘zgarmaydi/)
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:0}]),/miqdor/)
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:1.5}]),/miqdor/)
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:2}]),/O‘zgarish yo‘q/)
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p1',qty:2}]),/Yangi mahsulot/)
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:2,price:-5}]),/narx/)
  // Cutting the line to what was delivered closes the order and frees the reservation.
  s=ok(A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:1}]))
  o=soOf(s,so.id)
  assert.equal(o.status,'Yetkazildi');assert.equal(o.items[0].reserved,0);assert.equal(bal(s,'p3','w3').reserved,0)
  refused(s,A.updateSalesOrderLines(s,ctx(s),so.id,[{productId:'p3',qty:3}]),/Yopilgan/)
})

test('make-to-order lines are not edited here (their quantity belongs to the MO)',()=>{
  let s=withStock(clean(),'p3','w3',[{code:'L-1',qty:10}])
  const so=sell(s,2,'p3',1000);s=so.s
  const mto={...s,salesOrders:s.salesOrders.map(o=>o.id===so.id?{...o,mode:'Make-to-order'}:o)}
  refused(mto,A.updateSalesOrderLines(mto,ctx(mto),so.id,[{productId:'p3',qty:3}]),/MTO/)
})
