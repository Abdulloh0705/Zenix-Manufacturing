import './setup'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../../src/domain/actions'
import type {Ctx} from '../../src/domain/actions'
import type {ManufacturingState} from '../../src/types'

// Phase 5/5: the serial register, supplier replacement, legacy return credits and real notifications as the user
// reaches them in the app (real AppContext command gate, durable save, scan after success).
afterEach(async()=>{await cleanup()})
const text=()=>document.body.textContent||''
const dialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)??null
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
let n=0
const ctx=(s:ManufacturingState):Ctx=>({now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:p=>`${p}-ui5${++n}`})
const run=(s:ManufacturingState,out:{state:ManufacturingState;result:{ok:boolean;message:string}})=>{assert.ok(out.result.ok,out.result.message);return out.state}

test('audit #25: the serial register shows each unit where it is or how it left; a legacy range is listed apart',async()=>{
  seedState(s=>{
    const unit=(code:string,qty:number)=>({id:`lot-${code}`,code,kind:'serial' as const,itemId:'p2',itemType:'finished' as const,qty,originalQty:1,warehouseId:'w3',status:'available' as const,sourceType:'production' as const,sourceId:'mo-x',sourceCode:'MO-X',createdAt:'2026-10-20 08:00',serialFrom:code,serialTo:code,batch:'SN-1…2',consumedBy:[]})
    const legacy={...unit('SN-OLD-000001…000009',4),id:'lot-legacy',serialFrom:'SN-OLD-000001',serialTo:'SN-OLD-000009',batch:undefined}
    const mv=(id:string,type:string,qty:number,lot:string,source:string)=>({id,date:'2026-10-20 09:00',type,itemId:'p2',itemType:'finished' as const,warehouseId:'w3',qty,source,note:'',user:'Tizim',lot})
    return {...s,lots:[unit('SN-T-000001',1),unit('SN-T-000002',0),legacy],
      stockBalances:[{id:'b',warehouseId:'w3',itemId:'p2',itemType:'finished',onHand:5,reserved:0,incoming:0,quarantine:0,unit:'dona'}],
      stockMovements:[mv('m3','Sale -',-1,'SN-T-000002','SO-1'),mv('m2','Production +',1,'SN-T-000002','MO-X'),mv('m1','Production +',1,'SN-T-000001','MO-X')]}
  })
  await mountApp('/warehouse?view=serials')
  const rows=[...document.querySelectorAll('tbody tr')].map(r=>r.textContent||'')
  assert.ok(rows.some(r=>r.includes('SN-T-000001')&&r.includes('Omborda')),'in stock')
  assert.ok(rows.some(r=>r.includes('SN-T-000002')&&r.includes('Sotilgan')),'sold, with its last movement')
  assert.ok(text().includes('Eski serial diapazonlari (1)'),'legacy range shown apart')
  assert.equal(rows.filter(r=>r.includes('SN-OLD-000005')).length,0,'no unit is invented from the range')
})

/** rm2: 100 received into QC, 70 accepted, 30 rejected and shipped back (built with the real commands). */
function returnedReceipt(s:ManufacturingState){
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,autoQualityChecks:true,requireFinalQc:false}}}
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',lines:[{materialId:'rm2',qty:100}],status:'Tasdiqlangan'});s=run(s,po)
  s=run(s,A.receivePurchase(s,ctx(s),po.result.id!,'rm2',100))
  const q=s.qualityChecks.find(x=>x.sourceId===po.result.id)!
  s=run(s,A.inspectReceipt(s,ctx(s),q.id,70,'Zang'))
  return run(s,A.returnPurchaseToSupplier(s,ctx(s),q.id))
}

test('audit #27: replacement is requested once, received into QC only, and the event is notified once',async()=>{
  seedState(returnedReceipt)
  await mountApp('/purchases?view=replacements')
  assert.ok(text().includes('Qaytarilgan, almashtirish so‘ralmagan (1)'))
  await click(byText('Almashtirish so‘rash'))
  await flush()
  await click(byText('So‘rash','button',dialog()!))
  await flush(40)
  let s=stored()
  assert.equal(s.supplierReplacements!.length,1)
  const rep=s.supplierReplacements![0]
  assert.equal(rep.qty,30)
  assert.equal(s.notifications.filter(x=>x.key===`replacement:${rep.id}:open`).length,1,'one notification for the event')
  await click(byText('Qabul'))
  await flush()
  const qty=dialog()!.querySelector<HTMLInputElement>('input[type="number"]')!
  await type(qty,'20')
  await click(byText('Qabul','button',dialog()!))
  await flush(40)
  s=stored()
  const receipt=s.purchaseOrders[0].receipts.find(r=>r.replacementId===rep.id)!
  assert.equal(receipt.qty,20)
  const b=s.stockBalances.find(x=>x.itemId==='rm2'&&x.warehouseId==='w1')!
  assert.deepEqual([b.onHand,b.quarantine],[90,20],'replacement waits in incoming QC')
  assert.equal(s.purchaseOrders[0].items[0].received,100,'the PO line is untouched')
  assert.equal(s.supplierReplacements![0].status,'Qisman')
})

test('Phase 5 finance: an old-order return waits for an authorised credit decision and is credited once',async()=>{
  seedState(s=>{
    s={...s,customers:s.customers.map(c=>c.id==='cu2'?{...c,debt:1000000}:c),
      receivables:[{id:'aropen-1',key:'opening:cu2',customerId:'cu2',kind:'opening',amount:1000000,date:'2026-01-01 00:00',by:'system',byName:'Tizim'}],
      lots:[{id:'l1',code:'P3-OLD',kind:'lot',itemId:'p3',itemType:'finished',qty:20,originalQty:20,warehouseId:'w3',status:'available',sourceType:'production',sourceId:'x',sourceCode:'MO-OLD',createdAt:'2026-01-01 08:00',consumedBy:[]}],
      stockBalances:[{id:'b',warehouseId:'w3',itemId:'p3',itemType:'finished',onHand:20,reserved:0,incoming:0,quarantine:0,unit:'dona'}],
      stockMovements:[{id:'m1',date:'2026-01-10 10:00',type:'Sale -',itemId:'p3',itemType:'finished',warehouseId:'w3',qty:-5,source:'SO-OLD',note:'',user:'Tizim',lot:'P3-OLD'}],
      salesOrders:[{id:'so-old',code:'SO-OLD',customerId:'cu2',status:'Yetkazildi',mode:'Make-to-stock',items:[{productId:'p3',qty:5,price:200000,delivered:5,reserved:0}],total:1000000,paymentStatus:'To‘lanmagan',deliveryDate:'2026-01-10',createdAt:'2026-01-05 09:00'}]}
    return run(s,A.createReturn(s,ctx(s),{salesOrderId:'so-old',productId:'p3',qty:2,reason:'Nuqson'}))
  })
  await mountApp('/sales?view=receivables')
  assert.ok(text().includes('Qaror kutilmoqda'))
  await click(byText('Kredit-nota'))
  await flush()
  await type(dialog()!.querySelector('textarea'),'Solishtirish dalolatnomasi №4')
  await click(byText('Tasdiqlash','button',dialog()!))
  await flush(40)
  const s=stored()
  assert.equal(s.receivables!.filter(e=>e.kind==='credit').length,1)
  assert.equal(s.customers.find(c=>c.id==='cu2')!.debt,600000)
  assert.equal(s.receivableReconciliations![0].status,'credited')
  assert.ok(text().includes('Kreditlandi'))
})

test('audit #27: notification categories can be switched off and the setting is saved',async()=>{
  seedState(s=>s)
  await mountApp('/settings?view=notifications')
  const row=[...document.querySelectorAll<HTMLElement>('.toggle-row')].find(e=>e.querySelector('b')?.textContent==='Xarid va qabul')
  assert.ok(row,'purchase notifications have a real switch (page: '+text().slice(0,120)+')')
  await click(row!.querySelector('[role="switch"]'))
  await flush(40)
  assert.equal(stored().settings.notifications.purchase,false)
})

test('pre-merge: opening v4 data keeps a v4 backup under its own key; an older v3→v4 backup is not lost',async()=>{
  seedState(s=>({...s,schemaVersion:4}))
  localStorage.setItem('zenix-manufacturing-before-v4',JSON.stringify({savedAt:'2026-01-01 00:00',from:3,to:4,state:{marker:'v3-copy'}}))
  await mountApp('/')
  const v5=JSON.parse(localStorage.getItem('zenix-manufacturing-before-v5')||'null')
  assert.ok(v5,'the v4 data was copied before the upgrade')
  assert.equal(v5.from,4)
  assert.equal(v5.state.schemaVersion,4)
  assert.equal(JSON.parse(localStorage.getItem('zenix-manufacturing-before-v4')!).state.marker,'v3-copy','the earlier backup stays')
})
