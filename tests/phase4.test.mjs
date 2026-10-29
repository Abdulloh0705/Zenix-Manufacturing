// Phase 4/5 (2026-10-29) audit regressions: customer receivables ledger (#19), one timezone-aware date layer (#20),
// real XLSX / CSV exports (#21), sub-day finite capacity (#23), runtime-based maintenance forecasts (#26), and the
// Phase 3 carry-over: safety stock per site and warehouse reservations against bin moves. A refused action returns
// the very state it was given. The company timezone is shared by every bundle (globalThis), so each test sets it.
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import * as P from '../.test-dist/planning.mjs'
import * as M from '../.test-dist/maintenance.mjs'
import * as X from '../.test-dist/access.mjs'
import * as I from '../.test-dist/inventory.mjs'
import * as R from '../.test-dist/receivables.mjs'
import * as D from '../.test-dist/dates.mjs'
import * as XP from '../.test-dist/exportData.mjs'
import {normalizeLoaded} from '../.test-dist/persistence.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const RUNTIME_ZONE=D.timeZone()
afterEach(()=>{D.setTimeZone(RUNTIME_ZONE)})

const T0=new Date(2026,9,21,8,0)
const TODAY='2026-10-21'
let counter=0
const ctx=(s,userId='em1',now=T0)=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p4x${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(s,out,pattern)=>{
  assert.equal(out.result.ok,false,`expected a refusal, got: ${out.result.message}`)
  if(pattern)assert.match(out.result.message,pattern)
  assert.equal(out.state,s,'a refused action returns the state it was given (no partial mutation)')
  return out
}
const noQc=s=>({...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:false,autoQualityChecks:false}}})
const clean=()=>noQc(createInitialState(T0))
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)

/** Lot records (optionally in a bin) and the matching balance of an item in a store. */
function withStock(s,key,warehouseId,lots){
  const product=s.products.find(p=>p.id===key)
  const itemType=product?'finished':'raw'
  const unit=(product||s.rawMaterials.find(m=>m.id===key)).unit
  const rows=lots.map((l,i)=>({id:`lot-${key}-${warehouseId}-${l.code}`,code:l.code,kind:'lot',itemId:key,itemType,qty:l.qty,originalQty:l.qty,warehouseId,...(l.location?{location:l.location}:{}),status:'available',
    sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:`2026-10-0${i+1} 08:00`,expiry:l.expiry,consumedBy:[]}))
  const bins={}
  for(const l of rows)if(l.location)bins[l.location]=(bins[l.location]||0)+l.qty
  return {...s,lots:[...s.lots,...rows],stockBalances:[...s.stockBalances.filter(b=>!(I.keyOf(b)===key&&b.warehouseId===warehouseId)),
    {id:`st-${key}-${warehouseId}`,warehouseId,itemId:key,itemType,onHand:rows.reduce((a,l)=>a+l.qty,0),reserved:0,incoming:0,quarantine:0,unit,...(Object.keys(bins).length?{bins}:{})}]}
}

/* ======================================================= Receivables #19 == */

/** A confirmed MTS order of 10 × p1 at 1 000 for BuildTech (cu1), fully reserved from lots in the finished store. */
function sold(qty=10,price=1000){
  let s=withStock(clean(),'p1','w3',[{code:'FG-1',qty:50}])
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',deliveryDate:'2026-10-25',lines:[{productId:'p1',qty,price}]});s=ok(so)
  return {s,id:so.result.id}
}

test('Finance 1: a delivery invoices exactly what was shipped and raises the debt once per shipment',()=>{
  let {s,id}=sold()
  assert.equal(R.customerBalance(s,'cu1'),0,'an order is not a receivable until it ships')
  s=ok(A.deliverSalesOrder(s,ctx(s),id,{p1:4}))
  assert.equal(R.customerBalance(s,'cu1'),4000)
  s=ok(A.deliverSalesOrder(s,ctx(s),id,{p1:6}))
  const inv=s.receivables.filter(e=>e.kind==='invoice')
  assert.deepEqual(inv.map(e=>e.amount).sort(),[4000,6000])
  assert.deepEqual(inv.map(e=>e.key).sort(),[`invoice:${id}:0-4`,`invoice:${id}:4-10`])
  assert.equal(R.customerBalance(s,'cu1'),10000)
  assert.equal(s.customers.find(c=>c.id==='cu1').debt,10000,'Customer.debt is the ledger balance')
  assert.equal(s.salesOrders.find(o=>o.id===id).paymentStatus,'To‘lanmagan')
  refused(s,A.deliverSalesOrder(s,ctx(s),id),/yopilgan/)
  assert.equal(R.customerBalance(s,'cu1'),10000,'a closed order is never invoiced again')
})

test('Finance 2: a payment reduces the debt exactly once; overpayment and invalid amounts are refused',()=>{
  let {s,id}=sold()
  s=ok(A.deliverSalesOrder(s,ctx(s),id))
  const pay=(st,p)=>A.recordCustomerPayment(st,ctx(st),{customerId:'cu1',key:'pay-1',...p})
  for(const amount of [0,-5,NaN,Infinity,'abc','12.345'])refused(s,pay(s,{amount}))
  refused(s,pay(s,{amount:10001}),/oshmasin/)
  refused(s,pay(s,{amount:100,salesOrderId:'so-missing'}),/tegishli emas/)
  refused(s,pay(s,{amount:100,key:''}),/kalit/)
  s=ok(pay(s,{amount:3000,salesOrderId:id,method:'Naqd'}))
  assert.equal(R.customerBalance(s,'cu1'),7000)
  const again=pay(s,{amount:3000,salesOrderId:id})
  assert.ok(again.result.ok&&/allaqachon/.test(again.result.message))
  assert.equal(again.state,s,'the same payment sent twice changes nothing')
  assert.equal(s.salesOrders.find(o=>o.id===id).paymentStatus,'Qisman')
  // Without an order the payment settles the oldest open invoices first.
  s=ok(A.recordCustomerPayment(s,ctx(s),{customerId:'cu1',key:'pay-2',amount:7000}))
  assert.equal(R.customerBalance(s,'cu1'),0)
  assert.equal(s.salesOrders.find(o=>o.id===id).paymentStatus,'To‘langan')
  refused(s,A.recordCustomerPayment(s,ctx(s),{customerId:'cu1',key:'pay-3',amount:1}),/ochiq qarzi yo‘q/)
  // A paid order's status is derived: it cannot be typed back.
  refused(s,A.updateSalesMeta(s,ctx(s),id,{paymentStatus:'To‘lanmagan'}),/hisoblanadi/)
})

test('Finance 3: a return credits the returned units once and never more than was invoiced',()=>{
  let {s,id}=sold()
  s=ok(A.deliverSalesOrder(s,ctx(s),id))
  s=ok(A.recordCustomerPayment(s,ctx(s),{customerId:'cu1',key:'p',amount:10000}))
  s=ok(A.createReturn(s,ctx(s),{salesOrderId:id,productId:'p1',qty:2,reason:'Nuqson'}))
  const credits=()=>s.receivables.filter(e=>e.kind==='credit')
  assert.deepEqual(credits().map(e=>e.amount),[-2000])
  assert.equal(R.customerBalance(s,'cu1'),-2000,'a paid order credited back is a customer credit')
  refused(s,A.createReturn(s,ctx(s),{salesOrderId:id,productId:'p1',qty:9,reason:'Ortiqcha'}),/1–8/)
  s=ok(A.createReturn(s,ctx(s),{salesOrderId:id,productId:'p1',qty:8,reason:'Hammasi'}))
  assert.equal(credits().reduce((a,e)=>a+e.amount,0),-10000,'credits stop at the invoiced value')
  const r=R.orderReceivable(s,id)
  assert.deepEqual([r.invoiced,r.paid,r.credited],[10000,10000,10000])
  // Disposition of a return posts nothing to the ledger.
  const ret=s.returns[0]
  const before=s.receivables.length
  s=ok(A.dispositionReturn(s,ctx(s),ret.id,'Scrap'))
  assert.equal(s.receivables.length,before)
})

test('Finance 4: legacy Customer.debt becomes one opening entry on load; loading again adds nothing',()=>{
  const seed=createInitialState(T0)
  const legacy={...seed,customers:seed.customers.map(c=>c.id==='cu2'?{...c,debt:8600000}:c.id==='cu3'?{...c,debt:1200000.5}:c)}
  delete legacy.receivables
  const loaded=normalizeLoaded(JSON.parse(JSON.stringify(legacy)),seed)
  assert.deepEqual(loaded.receivables.map(e=>[e.customerId,e.kind,e.amount,e.key]),[['cu2','opening',8600000,'opening:cu2'],['cu3','opening',1200000.5,'opening:cu3']])
  for(const c of loaded.customers)assert.equal(R.customerBalance(loaded,c.id),c.debt,`${c.id}: balance unchanged by migration`)
  const again=normalizeLoaded(JSON.parse(JSON.stringify(loaded)),seed)
  assert.equal(again.receivables.length,2,'idempotent')
  // A new customer's starting debt is its opening entry; an edit can never overwrite the debt.
  let s=clean()
  const made=A.createEntity(s,ctx(s),'customers',{name:'Yangi',phone:'+998 90 111 22 33',type:'B2B',status:'Faol',debt:500});s=ok(made)
  assert.equal(R.customerBalance(s,made.result.id),500)
  refused(s,A.createEntity(s,ctx(s),'customers',{name:'Manfiy',phone:'+998 90 111 22 34',type:'B2B',status:'Faol',debt:-1}),/manfiy|musbat/)
  refused(s,A.updateEntity(s,ctx(s),'customers',made.result.id,{debt:0}),/qo‘lda o‘zgartirilmaydi/)
  s=ok(A.updateEntity(s,ctx(s),'customers',made.result.id,{name:'Yangi 2',debt:500}),'unchanged debt may be resent: ')
  refused(s,A.deleteEntity(s,ctx(s),'customers',made.result.id),/ledger/)
})

test('Finance 5: a manual adjustment needs sales.approve, an amount, a reason and an actor',()=>{
  let s=clean()
  const rule=X.actionRules('adjustCustomerBalance',[])
  assert.equal(X.allowedBy(s.roles.find(r=>r.key==='operator'),rule),false,'an operator may not adjust balances')
  assert.equal(X.allowedBy(s.roles.find(r=>r.key==='warehouse'),rule),false)
  assert.equal(X.allowedBy(s.roles.find(r=>r.key==='supply_sales'),rule),true,'the sales manager holds sales.approve')
  assert.equal(X.allowedBy(s.roles.find(r=>r.key==='supply_sales'),X.actionRules('recordCustomerPayment',[])),true)
  const adj=(p,st=s,c=ctx(st))=>A.adjustCustomerBalance(st,c,{customerId:'cu1',key:'a1',...p})
  refused(s,adj({amount:0,reason:'Akt-sverka'}),/0 dan farqli/)
  refused(s,adj({amount:NaN,reason:'Akt-sverka'}))
  refused(s,adj({amount:500,reason:'  '}),/sabab/i)
  refused(s,adj({amount:500,reason:'Akt-sverka'},s,{...ctx(s),user:undefined}),/kim/i)
  s=ok(adj({amount:-250,reason:'Akt-sverka № 12'}))
  const e=s.receivables[0]
  assert.deepEqual([e.kind,e.amount,e.reason,e.by],['adjustment',-250,'Akt-sverka № 12','em1'])
  assert.equal(R.customerBalance(s,'cu1'),-250)
  assert.equal(adj({amount:-250,reason:'Akt-sverka № 12'}).state,s,'the same adjustment is never posted twice')
})

/* ========================================================= Timezone #20 == */

test('Timezone 7/8: date-only values never shift; Tashkent and UTC day boundaries follow the company zone',()=>{
  for(const tz of ['Asia/Tashkent','UTC','America/New_York','Pacific/Kiritimati','Pacific/Pago_Pago']){
    assert.ok(D.setTimeZone(tz))
    assert.equal(D.addDays('2026-03-07',1),'2026-03-08',tz)
    assert.equal(D.addDays('2026-11-01',1),'2026-11-02',tz)
    assert.equal(D.daysBetween('2026-03-07','2026-03-09'),2,tz)
    assert.equal(D.weekStart('2026-10-25'),'2026-10-19',tz)
    assert.equal(D.dayOfWeek('2026-10-24'),6,tz)
    assert.equal(D.addMonths('2026-01-31',1),'2026-02-28',tz)
    assert.equal(D.shortDate('2026-10-01'),'1-okt',tz)
    assert.equal(D.isoDate(D.parseDate('2026-10-29')),'2026-10-29',`${tz}: a calendar day round-trips`)
  }
  D.setTimeZone('Asia/Tashkent')
  assert.equal(D.isoDate(new Date('2026-10-28T18:59:00Z')),'2026-10-28')
  assert.equal(D.isoDate(new Date('2026-10-28T19:00:00Z')),'2026-10-29','midnight in Tashkent is 19:00 UTC')
  assert.equal(D.stamp(new Date('2026-10-28T19:00:00Z')),'2026-10-29 00:00')
  D.setTimeZone('UTC')
  assert.equal(D.isoDate(new Date('2026-10-28T19:00:00Z')),'2026-10-28')
  assert.equal(D.parseDate('2026-10-29 00:00').toISOString(),'2026-10-29T00:00:00.000Z')
  assert.equal(D.setTimeZone('Mars/Olympus'),false,'an unknown zone is refused')
  assert.equal(D.timeZone(),'UTC','and the current one kept')
})

test('Timezone 9: daylight-saving transitions keep real elapsed minutes and valid wall-clock times',()=>{
  D.setTimeZone('America/New_York')
  assert.equal(D.minutesBetween('2026-03-08 00:00','2026-03-08 08:00'),420,'spring forward: the night is an hour shorter')
  assert.equal(D.minutesBetween('2026-11-01 00:00','2026-11-01 08:00'),540,'fall back: an hour longer')
  assert.equal(D.addMinutes('2026-03-08 01:30',60),'2026-03-08 03:30')
  assert.equal(D.stamp(D.parseDate('2026-03-08 02:30')),'2026-03-08 03:30','a skipped wall time moves forward by the gap')
  assert.equal(D.parseDate('2026-11-01 01:30').toISOString(),'2026-11-01T05:30:00.000Z','a repeated time takes its first occurrence')
  // A work center shift on the DST day starts at its wall-clock time and lasts its real length.
  const s=clean()
  const wc={...s.workCenters.find(w=>w.id==='wc1'),calendar:{workingDays:[0,1,2,3,4,5,6],shiftStart:'00:00'}}
  const w=E.workCenterWindows(s,wc,'2026-03-08',new Date('2026-03-01T12:00:00Z'))
  assert.equal(D.stamp(new Date(w.windows[0].from)),'2026-03-08 00:00')
  assert.equal(D.stamp(new Date(w.windows.at(-1).to)),'2026-03-08 09:00','480 real minutes from midnight end at 09:00 EDT')
  assert.equal(E.workCenterDay(s,wc,'2026-03-08',new Date('2026-03-01T12:00:00Z')).dayMinutes,480)
  D.setTimeZone('UTC')
  assert.equal(D.minutesBetween('2026-03-08 00:00','2026-03-08 08:00'),480)
})

test('Timezone 10: MRP, receivables and maintenance read today and timestamps in the company zone',()=>{
  const s=clean()
  const at=new Date('2026-10-28T20:00:00Z')
  D.setTimeZone('Asia/Tashkent')
  const east=ok(A.recordEquipmentRuntime(s,ctx(s,'em1',at),'eq1',100))
  const eastAdj=ok(A.adjustCustomerBalance(s,ctx(s,'em1',at),{customerId:'cu1',amount:5,reason:'Zona testi',key:'z'}))
  const eastPlan=P.runMrp(s)
  assert.equal(eastPlan.today,D.todayISO())
  D.setTimeZone('UTC')
  const west=ok(A.recordEquipmentRuntime(s,ctx(s,'em1',at),'eq1',100))
  assert.equal(east.equipment.find(e=>e.id==='eq1').runtimeLog[0].at,'2026-10-29 01:00')
  assert.equal(west.equipment.find(e=>e.id==='eq1').runtimeLog[0].at,'2026-10-28 20:00')
  assert.equal(eastAdj.receivables[0].date,'2026-10-29 01:00')
  // +14 h and −11 h are always on different calendar days: "today" really comes from the company zone.
  D.setTimeZone('Pacific/Kiritimati');const kiri=P.runMrp(s).today
  D.setTimeZone('Pacific/Pago_Pago');const pago=P.runMrp(s).today
  assert.notEqual(kiri,pago)
  assert.equal(D.daysBetween(pago,kiri)>=1,true)
  assert.equal(M.maintenanceDue({...s.equipment[0],maintenancePlan:{unit:'day',interval:10},lastMaintenance:'2026-10-20',nextMaintenance:''},'2026-10-29').dueDate,'2026-10-30')
})

/* =========================================================== Exports #21 == */

/** Entries of a stored ZIP: checks every local header and CRC; returns name → text. */
function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={}
  let at=0
  while(view.getUint32(at,true)===0x04034b50){
    const crc=view.getUint32(at+14,true),size=view.getUint32(at+18,true),nameLen=view.getUint16(at+26,true),extra=view.getUint16(at+28,true)
    assert.equal(view.getUint16(at+8,true),0,'stored')
    const name=new TextDecoder().decode(bytes.slice(at+30,at+30+nameLen))
    const data=bytes.slice(at+30+nameLen+extra,at+30+nameLen+extra+size)
    assert.equal(XP.crc32(data),crc,`${name}: CRC`)
    files[name]=new TextDecoder().decode(data)
    at+=30+nameLen+extra+size
  }
  assert.equal(view.getUint32(at,true),0x02014b50,'central directory follows the entries')
  const end=bytes.length-22
  assert.equal(view.getUint32(end,true),0x06054b50,'end of central directory')
  assert.equal(view.getUint16(end+10,true),Object.keys(files).length)
  return files
}
const parseXml=text=>{const doc=new new JSDOM('').window.DOMParser().parseFromString(text,'application/xml');assert.equal(doc.getElementsByTagName('parsererror').length,0,'well-formed XML');return doc}

test('Export 11/13: XLSX is a valid OOXML package — numbers, dates, Uzbek/Russian text, formulas neutralised',()=>{
  const rows=[{Nomi:'Oʻzbekiston — Ташкент',Soni:1200,Narx:12.5,Sana:'2026-10-29',Vaqt:'2026-10-29 14:05',Izoh:'=HYPERLINK("http://x")'},{Nomi:'@SUM(A1)',Soni:-3,Bor:true}]
  const files=unzip(XP.toXlsx(rows,'Sotuv/2026'))
  assert.deepEqual(Object.keys(files).sort(),['[Content_Types].xml','_rels/.rels','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/workbook.xml','xl/worksheets/sheet1.xml'])
  for(const text of Object.values(files))parseXml(text)
  const sheet=parseXml(files['xl/worksheets/sheet1.xml'])
  const cell=ref=>[...sheet.getElementsByTagName('c')].find(c=>c.getAttribute('r')===ref)
  assert.deepEqual([...sheet.getElementsByTagName('row')[0].getElementsByTagName('c')].map(c=>c.textContent),['Nomi','Soni','Narx','Sana','Vaqt','Izoh','Bor'],'columns of every row')
  assert.equal(cell('A2').textContent,'Oʻzbekiston — Ташкент')
  assert.deepEqual([cell('B2').getAttribute('t'),cell('B2').textContent],[null,'1200'],'numbers stay numbers')
  assert.equal(cell('D2').textContent,'46324','a calendar day is a date serial')
  assert.ok(Math.abs(Number(cell('E2').textContent)-46324.5868)<1e-4,'a timestamp keeps its time of day')
  assert.equal(sheet.getElementsByTagName('f').length,0,'no formula is ever written')
  assert.equal(cell('F2').getAttribute('t'),'inlineStr')
  assert.equal(cell('F2').getAttribute('s'),'6','formula-looking text is quote-prefixed')
  assert.equal(cell('A3').getAttribute('s'),'6')
  assert.equal(cell('G3').getAttribute('t'),'b')
  assert.match(files['xl/workbook.xml'],/name="Sotuv 2026"/,'sheet names lose characters Excel forbids')
  assert.match(files['xl/styles.xml'],/quotePrefix="1"/)
})

/** Runs an export with the browser download stubbed; returns the result and the blob it saved. */
async function capture(fn){
  let blob,name
  const saved={document:globalThis.document,window:globalThis.window,create:URL.createObjectURL,revoke:URL.revokeObjectURL}
  globalThis.window={setTimeout:f=>f()}
  globalThis.document={createElement:()=>({click(){},remove(){},set href(v){},set download(v){name=v}}),body:{appendChild(){}}}
  URL.createObjectURL=b=>{blob=b;return 'blob:x'}
  URL.revokeObjectURL=()=>{}
  try{const result=fn();return {result,blob,name,bytes:blob?new Uint8Array(await blob.arrayBuffer()):undefined}}
  finally{globalThis.document=saved.document;globalThis.window=saved.window;URL.createObjectURL=saved.create;URL.revokeObjectURL=saved.revoke}
}

test('Export 12/14: CSV is UTF-8 with BOM; files carry their real extension; empty results save nothing',async()=>{
  const csv=await capture(()=>XP.exportRows('csv','hisobot',[{Nomi:'Ташкент',Izoh:'+998 90',Soni:5}]))
  assert.deepEqual([...csv.bytes.slice(0,3)],[0xEF,0xBB,0xBF])
  assert.equal(new TextDecoder().decode(csv.bytes.slice(3)),"Nomi,Izoh,Soni\r\nТашкент,'+998 90,5")
  assert.deepEqual([csv.name,csv.result.ok,csv.blob.type],['hisobot.csv',true,'text/csv;charset=utf-8'])
  const xlsx=await capture(()=>XP.exportRows('xlsx','zenix-sales/2026',[{a:1}]))
  assert.deepEqual([xlsx.name,xlsx.blob.type],['zenix-sales-2026.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
  assert.deepEqual([...xlsx.bytes.slice(0,4)],[0x50,0x4B,0x03,0x04],'a ZIP, not HTML')
  const empty=await capture(()=>XP.exportRows('xlsx','bo‘sh',[]))
  assert.deepEqual([empty.result.ok,empty.blob],[false,undefined],'no empty file is presented as an export')
  assert.match(empty.result.message,/ma’lumot yo‘q/)
  // Only the rows given (the filtered view) and only their columns are exported.
  const filtered=[{Mijoz:'Air Systems',Qarz:8600000}]
  const files=unzip(XP.toXlsx(filtered))
  const sheet=parseXml(files['xl/worksheets/sheet1.xml'])
  assert.equal(sheet.getElementsByTagName('row').length,2)
  assert.match(files['xl/worksheets/sheet1.xml'],/<dimension ref="A1:B2"\/>/)
})

/* ===================================================== Scheduling #23 == */

/** p1 MO of 100 (bo1 extrusion 50 min on wc1 → bo2 paint 48 min on wc3) at 100 % efficiency, given calendars. */
function scheduled(calendars={},qty=100,extra=s=>s){
  let s=clean()
  s={...s,workCenters:s.workCenters.map(w=>({...w,efficiency:100,...(calendars[w.id]?{calendar:calendars[w.id]}:{})}))}
  s=extra(s)
  const c=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:qty,start:TODAY,due:'2026-10-30'});s=ok(c)
  return {s,id:c.result.id}
}
const opOf=(plan,orderId,name)=>plan.operations.find(o=>o.orderId===orderId&&o.name===name)
const run=(s,now=T0)=>P.scheduleOperations(s,{now})

test('Scheduling 15/17: shift breaks are not productive and an operation waits for its predecessor',()=>{
  const {s,id}=scheduled({wc1:{breaks:[{start:'08:30',minutes:60}]}})
  const plan=run(s)
  const ext=opOf(plan,id,'Ekstruziya'),paint=opOf(plan,id,'Bo‘yash')
  assert.deepEqual([ext.start,ext.end],['2026-10-21 08:00','2026-10-21 09:50'],'30 min, the break, then 20 min')
  assert.ok(paint.start>=ext.end,'painting starts after extrusion ends')
  assert.deepEqual([paint.start,paint.end],['2026-10-21 09:50','2026-10-21 10:38'])
  assert.equal(E.workCenterDay(s,s.workCenters.find(w=>w.id==='wc1'),TODAY,T0).dayMinutes,420,'480 − 60 min break')
  // A completed operation is history: it is not scheduled again and its successor starts now.
  const done={...s,productionOrders:s.productionOrders.map(o=>o.id===id?{...o,workOrders:o.workOrders.map(w=>w.operationId==='bo1'?{...w,status:'Yakunlangan',actualMin:50,completedAt:'2026-10-21 07:50'}:w)}:o)}
  const p2=run(done)
  assert.equal(opOf(p2,id,'Ekstruziya'),undefined)
  assert.equal(opOf(p2,id,'Bo‘yash').start,'2026-10-21 08:00')
})

test('Scheduling 16: planned maintenance and recorded downtime block the machine interval',()=>{
  const {s,id}=scheduled({},100,st=>({...st,maintenanceOrders:[{id:'pm1',code:'PM-1',equipmentId:'eq1',type:'Preventive',status:'Rejada',scheduled:'2026-10-21 08:00',plannedHours:2,technicianId:'em5',cost:0,note:''}],
    downtimeEvents:[{id:'d1',equipmentId:'eq3',workCenterId:'wc3',reason:'Unplanned stop',start:'2026-10-21 10:00',end:'2026-10-21 11:00',minutes:60,note:''}]}))
  const plan=run(s)
  const ext=opOf(plan,id,'Ekstruziya'),paint=opOf(plan,id,'Bo‘yash')
  assert.deepEqual([ext.start,ext.end],['2026-10-21 10:00','2026-10-21 10:50'],'the 08:00–10:00 service blocks the press')
  assert.deepEqual([paint.start,paint.end],['2026-10-21 11:00','2026-10-21 11:48'],'the paint line is down until 11:00')
  // Without a duration a planned service takes its whole day — no invented precision.
  const whole={...s,maintenanceOrders:[{...s.maintenanceOrders[0],scheduled:'2026-10-21 09:00',plannedHours:undefined}]}
  const w=E.workCenterWindows(whole,whole.workCenters.find(x=>x.id==='wc1'),TODAY,T0)
  assert.deepEqual([w.windows.length,w.notes.length],[0,1])
  assert.equal(opOf(run(whole),id,'Ekstruziya').start,'2026-10-22 08:00')
})

test('Scheduling 18: a work center never runs more operations at once than its parallel capacity',()=>{
  const two=(cal)=>{let {s,id}=scheduled(cal);const c=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:100,start:TODAY,due:'2026-10-30'});s=ok(c);return {s,a:id,b:c.result.id}}
  const overlap=(plan,wc)=>{const ops=plan.operations.filter(o=>o.workCenterId===wc).map(o=>[D.parseDate(o.start).getTime(),D.parseDate(o.end).getTime()]);let max=0;for(const [a] of ops)max=Math.max(max,ops.filter(([x,y])=>x<=a&&a<y).length);return max}
  let {s,a,b}=two({})
  let plan=run(s)
  assert.equal(overlap(plan,'wc1'),1)
  assert.ok(opOf(plan,b,'Ekstruziya').start>=opOf(plan,a,'Ekstruziya').end,'one press, one job at a time')
  ;({s,a,b}=two({wc1:{parallel:2}}))
  // Phase 5 (machine capacity gap): wc1 has one registered machine (eq1) — a parallel cap of 2 never books it twice at once.
  assert.equal(overlap(run(s),'wc1'),1,'one machine, one job at a time, whatever the cap')
  assert.equal(E.workCenterDay(s,s.workCenters.find(w=>w.id==='wc1'),TODAY,T0).capacity,480)
  // A second registered machine makes the two units real.
  const twin={...s,equipment:[...s.equipment,{...s.equipment.find(e=>e.id==='eq1'),id:'eq1b',name:'Press 2'}]}
  plan=run(twin)
  assert.deepEqual([opOf(plan,a,'Ekstruziya').start,opOf(plan,b,'Ekstruziya').start],['2026-10-21 08:00','2026-10-21 08:00'],'two parallel machines run both')
  assert.equal(overlap(plan,'wc1'),2)
  assert.equal(E.workCenterDay(twin,twin.workCenters.find(w=>w.id==='wc1'),TODAY,T0).capacity,960)
  // A machine down halves nothing it does not have: with one machine and parallel 2, a stop blocks both units.
  const down={...s,downtimeEvents:[{id:'d',equipmentId:'eq1',workCenterId:'wc1',reason:'Unplanned stop',start:'2026-10-21 08:00',end:'2026-10-21 09:00',minutes:60,note:''}]}
  assert.equal(opOf(run(down),a,'Ekstruziya').start,'2026-10-21 09:00')
})

test('Scheduling 19: invalid rescheduling is refused and leaves the state unchanged',()=>{
  const {s,id}=scheduled()
  const c=ctx(s)
  refused(s,A.rescheduleProductionOrder(s,c,id,'2026-10-20'),/o‘tgan sana/)
  refused(s,A.rescheduleProductionOrder(s,c,id,'2026-02-30'),/Sana noto‘g‘ri/)
  const weekend=refused(s,A.rescheduleProductionOrder(s,c,id,'2026-10-24'),/ishlamaydi/)
  assert.equal(weekend.result.code,'needs-override')
  const busy={...s,maintenanceOrders:[{id:'pm',code:'PM-9',equipmentId:'eq1',type:'Corrective',status:'Rejada',scheduled:'2026-10-22 08:00',technicianId:'em5',cost:0,note:''}]}
  assert.equal(refused(busy,A.rescheduleProductionOrder(busy,ctx(busy),id,'2026-10-22'),/band/).result.code,'needs-override')
  const running={...s,productionOrders:s.productionOrders.map(o=>o.id===id?{...o,status:'Jarayonda'}:o)}
  refused(running,A.rescheduleProductionOrder(running,ctx(running),id,'2026-10-23'),/boshlangan/)
  // Work-center calendar data is validated before it is stored.
  for(const calendar of [{shiftStart:'25:00'},{breaks:[{start:'12:00',minutes:0}]},{parallel:0},{parallel:1.5}])
    refused(s,A.updateEntity(s,ctx(s),'workCenters','wc1',{calendar}))
})

/* ============================================ Maintenance forecast #26 == */

const READ=(day,h=8)=>new Date(2026,9,day,h,0)
/** eq1 on a runtime plan with meter readings on the given October days (hours). */
function metered(interval,readings,patch=e=>e){
  let s=clean()
  s=ok(A.saveMaintenancePlan(s,ctx(s),'eq1',{unit:'runtime',interval}))
  for(const [day,hours] of readings)s=ok(A.recordEquipmentRuntime(s,ctx(s,'em1',READ(day)),'eq1',hours))
  return {...s,equipment:s.equipment.map(e=>e.id==='eq1'?patch(e):e)}
}
/** The date `n` Monday–Friday working days after a day. */
const plusWorkingDays=(day,n)=>{let d=day,left=n;while(left>0){d=D.addDays(d,1);if(![0,6].includes(D.dayOfWeek(d)))left-=1}return d}

test('Maintenance 20: the next runtime service is projected from the machine’s own recorded usage',()=>{
  // 1000 → 1040 h between Mon 5 Oct and Mon 19 Oct = 10 working days → 4 h per working day (not an assumed 8).
  const s=metered(500,[[5,1000],[12,1020],[19,1040]])
  const f=M.runtimeForecast(s,s.equipment.find(e=>e.id==='eq1'),TODAY)
  assert.equal(f.state,'estimated')
  assert.deepEqual([f.hoursPerDay,f.basisDays,f.leftHours,f.readings],[4,10,460,3])
  assert.equal(f.dueDate,plusWorkingDays('2026-10-19',115),'460 h ÷ 4 h on working days only')
  // Double the usage, half the time.
  const fast=metered(500,[[5,1000],[19,1080]])
  assert.equal(M.runtimeForecast(fast,fast.equipment.find(e=>e.id==='eq1'),TODAY).dueDate,plusWorkingDays('2026-10-19',53))
  assert.equal(s.equipment.find(e=>e.id==='eq1').nextMaintenance,'','a forecast never writes the machine’s schedule')
})

test('Maintenance 21: too little usage history gives no date — “Ma’lumot yetarli emas”',()=>{
  const cases=[
    ['one reading',metered(500,[[19,1000]])],
    ['two days apart',metered(500,[[17,1000],[19,1010]])],
    ['no hours run',metered(500,[[5,1000],[19,1000]])],
    ['old last reading',metered(500,[[1,1000],[9,1040]]),'2026-11-30'],
  ]
  for(const [label,s,today=TODAY] of cases){
    const f=M.runtimeForecast(s,s.equipment.find(e=>e.id==='eq1'),today)
    assert.equal(f.state,'insufficient',label)
    assert.equal(f.dueDate,undefined,label)
    assert.match(f.reason,/Ma’lumot yetarli emas/,label)
  }
  const stopped=metered(500,[[5,1000],[19,1040]],e=>({...e,status:'To‘xtagan'}))
  assert.equal(M.runtimeForecast(stopped,stopped.equipment.find(e=>e.id==='eq1'),TODAY).state,'inactive')
  const daily=clean()
  assert.equal(M.runtimeForecast(daily,daily.equipment[0],TODAY).state,'not-runtime')
})

test('Maintenance 22: a forecast date plans one preventive order, never a duplicate; confirmed dates stay apart',()=>{
  // 100 h interval, 80 h run in 10 working days (8 h/day) → 20 h left → due on the 3rd working day after 19 Oct.
  let s=metered(100,[[5,1000],[19,1080]])
  const f=M.runtimeForecast(s,s.equipment.find(e=>e.id==='eq1'),TODAY)
  assert.equal(f.dueDate,'2026-10-22')
  assert.equal(M.forecastWarnings(s,TODAY,14).length,1,'an estimated service with no PM is a capacity warning')
  s=ok(A.planPreventiveMaintenance(s,ctx(s),14))
  const pm=s.maintenanceOrders.filter(m=>m.equipmentId==='eq1'&&m.type==='Preventive')
  assert.deepEqual(pm.map(m=>m.scheduled),['2026-10-22 09:00'])
  assert.equal(M.forecastWarnings(s,TODAY,14).length,0,'once planned it is in the capacity plan')
  const again=A.planPreventiveMaintenance(s,ctx(s),14)
  assert.equal(again.state.maintenanceOrders.filter(m=>m.equipmentId==='eq1'&&m.type==='Preventive').length,1)
  refused(s,A.createMaintenanceOrder(s,ctx(s),{equipmentId:'eq1',type:'Preventive',scheduled:'2026-10-27'}),/allaqachon rejada/)
  const after=M.runtimeForecast(s,s.equipment.find(e=>e.id==='eq1'),TODAY)
  assert.deepEqual([after.dueDate,after.scheduled],['2026-10-22',{code:pm[0].code,date:'2026-10-22'}],'estimate and confirmed date are reported apart')
  assert.equal(s.equipment.find(e=>e.id==='eq1').nextMaintenance,'')
  // The planned service blocks the press in finite scheduling.
  const w=E.workCenterWindows(s,s.workCenters.find(x=>x.id==='wc1'),'2026-10-22',T0)
  assert.equal(w.notes.length,1,'a PM without a duration blocks its whole day')
})

/* ================================================ Phase 3 carry-over == */

test('MRP 23: safety stock is held and netted per site — no site borrows another’s',()=>{
  let s=clean()
  s={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm2'?{...m,minStock:0,siteSafety:{b1:50,b2:120}}:m)}
  s=withStock(s,'rm2','w1',[{code:'B1',qty:40}])
  s=withStock(s,'rm2','w4',[{code:'B2',qty:100}])
  const plan=P.runMrp(s,{today:TODAY})
  const row=b=>plan.rows.find(r=>r.itemId==='rm2'&&r.branchId===b)
  assert.deepEqual([row('b1').safety,row('b2').safety],[50,120])
  const need=b=>plan.suggestions.filter(x=>x.itemId==='rm2'&&x.branchId===b).reduce((a,x)=>a+x.netQty,0)
  assert.deepEqual([need('b1'),need('b2')],[10,20],'each site restores its own safety stock from its own stock')
  assert.ok(plan.suggestions.filter(x=>x.itemId==='rm2').every(x=>x.refs.every(r=>r.kind==='safety')),'pegged to safety stock')
  assert.equal(plan.transfers.filter(t=>t.itemId==='rm2').length,0,'neither site has stock above its own safety to spare')
  // With more stock at b2 than it must keep, only the excess is offered — never b2's safety stock.
  const rich=withStock(s,'rm2','w4',[{code:'B2',qty:300}])
  const p2=P.runMrp(rich,{today:TODAY})
  const tr=p2.transfers.filter(t=>t.itemId==='rm2')
  assert.equal(tr.reduce((a,t)=>a+t.qty,0),10)
  assert.ok(tr.every(t=>t.fromBranchId==='b2'&&t.toBranchId==='b1'))
  assert.equal(p2.suggestions.filter(x=>x.itemId==='rm2'&&x.branchId==='b2').length,0)
  // Data saved before sites keeps one company figure: minStock at the default branch only.
  const legacy={...s,rawMaterials:s.rawMaterials.map(m=>m.id==='rm2'?{...m,minStock:70,siteSafety:undefined}:m)}
  const p3=P.runMrp(legacy,{today:TODAY})
  assert.deepEqual([p3.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b1').safety,p3.rows.find(r=>r.itemId==='rm2'&&r.branchId==='b2').safety],[70,0])
  assert.equal(P.siteSafetyStock(legacy,{minStock:70},'b2'),0)
  refused(s,A.updateEntity(s,ctx(s),'rawMaterials','rm2',{siteSafety:{b9:5}}),/Filial topilmadi/)
  refused(s,A.updateEntity(s,ctx(s),'rawMaterials','rm2',{siteSafety:{b1:-1}}),/musbat/)
})

test('Inventory 24: bin moves never break warehouse-level reservations; decreases stop at reserved stock',()=>{
  let s=withStock(clean(),'rm2','w1',[{code:'L1',qty:30,location:'RAW-A1',expiry:'2027-01-01'},{code:'L2',qty:20,location:'RAW-A2',expiry:'2027-02-01'}])
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:10});s=ok(mo)
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Tasdiqlangan'))
  const reserved=bal(s,'rm2','w1').reserved
  assert.ok(reserved>0,'the order reserved rm2 in w1')
  // Every unit may move between bins: the warehouse total and its reservation stay as they are.
  s=ok(A.moveStockBin(s,ctx(s),{warehouseId:'w1',itemId:'rm2',from:'RAW-A1',to:'RAW-A2',qty:30}))
  const b=bal(s,'rm2','w1')
  assert.deepEqual([b.onHand,b.reserved,b.bins],[50,reserved,{'RAW-A2':50}])
  assert.ok(I.binTotal(b)<=b.onHand+1e-9)
  const free=b.onHand-b.reserved-(b.quarantine||0)
  refused(s,A.adjustStock(s,ctx(s),'rm2','w1',-(free+1),'Inventarizatsiya',{location:'RAW-A2'}))
  refused(s,A.transferStock(s,ctx(s),'rm2','w1','w4',free+1))
  s=ok(A.adjustStock(s,ctx(s),'rm2','w1',-free,'Inventarizatsiya',{location:'RAW-A2'}))
  assert.deepEqual([bal(s,'rm2','w1').onHand,bal(s,'rm2','w1').reserved],[reserved,reserved],'only free stock was written off')
  // The reservation is still issued in full from what is left.
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id,'Jarayonda'))
})
