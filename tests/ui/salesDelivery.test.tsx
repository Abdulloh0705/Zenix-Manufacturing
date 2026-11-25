import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import type {ManufacturingState} from '../../src/types'
import {compactMoney} from '../../src/utils/format'

afterEach(async()=>{await cleanup()})
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState

function seedPartialOrder(){
  seedState(s=>({...s,
    salesOrders:[{id:'so-partial',code:'SO-PARTIAL',customerId:'cu1',status:'Tasdiqlangan',mode:'Make-to-stock',items:[{productId:'p3',qty:5,price:47500,delivered:0,reserved:0}],total:237500,paymentStatus:'To‘lanmagan',deliveryDate:'2026-11-20',createdAt:'2026-11-12'}],
    stockBalances:[{id:'bal-partial',warehouseId:'w3',itemId:'p3',itemType:'finished',onHand:2,reserved:0,incoming:0,quarantine:0,unit:'dona'}],
    lots:[{id:'lot-partial',code:'LOT-PARTIAL',kind:'lot',itemId:'p3',itemType:'finished',qty:2,originalQty:2,warehouseId:'w3',status:'available',sourceType:'production',sourceId:'mo-old',sourceCode:'MO-OLD',createdAt:'2026-11-11 09:00',consumedBy:[]}],
  } as ManufacturingState))
}

test('sales order drawer permits partial delivery and limits the form to usable stock',async()=>{
  seedPartialOrder()
  await mountApp('/sales?view=orders&id=so-partial')
  const open=byText('Yetkazib berish') as HTMLButtonElement
  assert.ok(open)
  assert.equal(open.disabled,false,'partial stock is enough to open delivery')
  await click(open)
  const dialog=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
  const amount=dialog.querySelector<HTMLInputElement>('input[aria-label="Panel kronshteyn yetkazish miqdori"]')!
  assert.ok(amount)
  assert.equal(amount.value,'2','defaults to the quantity that can actually ship')
  const confirm=byText('Yetkazishni tasdiqlash','button',dialog) as HTMLButtonElement
  await type(amount,'3')
  assert.equal(confirm.disabled,true,'quantity above available stock is rejected before submit')
  await type(amount,'1.5')
  assert.equal(confirm.disabled,true,'fractional finished units are rejected')
  await type(amount,'2')
  assert.equal(confirm.disabled,false)
  await click(confirm)
  await flush(450)
  const state=stored()
  assert.equal(state.salesOrders[0].items[0].delivered,2)
  assert.ok(byText('Qaytarish'),'partially delivered goods can be returned from the order drawer')
  assert.equal(state.stockBalances.find(b=>b.id==='bal-partial')?.onHand,0)
  assert.equal(state.stockMovements.filter(m=>m.type==='Sale -'&&m.source==='SO-PARTIAL').reduce((n,m)=>n+m.qty,0),-2)
})


test('sales overview values only the undelivered portion of open orders',async()=>{
  seedPartialOrder()
  const state=stored()
  state.salesOrders[0].items[0].delivered=2
  localStorage.setItem(STATE_KEY,JSON.stringify(state))
  await mountApp('/sales')
  const card=[...document.querySelectorAll<HTMLElement>('.kpi')].find(x=>x.querySelector('.kpi-label')?.textContent==='Ochiq buyurtmalar')
  assert.ok(card)
  assert.equal(card.querySelector('em')?.textContent,compactMoney(3*47500))
})

// ---------------------------------------------------------------- Sales completion: serial picking, edit, returns
const unit=(code:string,createdAt:string)=>({id:`lot-${code}`,code,kind:'serial',serialFrom:code,serialTo:code,itemId:'p2',itemType:'finished',qty:1,originalQty:1,warehouseId:'w3',status:'available',sourceType:'production',sourceId:'mo-x',sourceCode:'MO-X',createdAt,consumedBy:[]})
function seedSerialOrder(){
  seedState(s=>({...s,
    salesOrders:[
      {id:'so-sn',code:'SO-SN',customerId:'cu1',status:'Tasdiqlangan',mode:'Make-to-stock',items:[{productId:'p2',qty:2,price:180000,delivered:0,reserved:0}],total:360000,paymentStatus:'To‘lanmagan',deliveryDate:'2026-11-20',createdAt:'2026-11-12'},
      {id:'so-other',code:'SO-OTHER',customerId:'cu1',status:'Tayyor',mode:'Make-to-stock',items:[{productId:'p2',qty:1,price:180000,delivered:0,reserved:1,warehouseId:'w3',reservations:[{warehouseId:'w3',qty:1,lots:[{lot:'SN-C',qty:1}]}]}],total:180000,paymentStatus:'To‘lanmagan',deliveryDate:'2026-11-20',createdAt:'2026-11-12'},
    ],
    stockBalances:[{id:'bal-sn',warehouseId:'w3',itemId:'p2',itemType:'finished',onHand:3,reserved:1,incoming:0,quarantine:0,unit:'dona'}],
    lots:[unit('SN-A','2026-11-01 08:00'),unit('SN-B','2026-11-02 08:00'),unit('SN-C','2026-11-03 08:00')],
  } as unknown as ManufacturingState))
}
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const checkbox=(root:HTMLElement,code:string)=>[...root.querySelectorAll<HTMLLabelElement>('label.check-line')].find(l=>l.querySelector('b')?.textContent===code)?.querySelector('input') as HTMLInputElement|undefined

test('delivery of a serial product ships the units the user picks; other orders’ units are not offered',async()=>{
  seedSerialOrder()
  await mountApp('/sales?view=orders&id=so-sn')
  await click(byText('Yetkazib berish'))
  const dialog=lastDialog()
  assert.ok(dialog.querySelector('fieldset.serial-picker'))
  assert.equal(checkbox(dialog,'SN-C'),undefined,'a unit reserved by another order is not offered')
  assert.equal(checkbox(dialog,'SN-A')!.checked,true);assert.equal(checkbox(dialog,'SN-B')!.checked,true)
  const confirm=byText('Yetkazishni tasdiqlash','button',dialog) as HTMLButtonElement
  await click(checkbox(dialog,'SN-A')!)
  assert.equal(confirm.disabled,true,'serial count must match the quantity')
  assert.ok(dialog.querySelector('[role="alert"]')?.textContent?.includes('2 ta serial raqam tanlang (1 ta tanlangan)'))
  await type(dialog.querySelector('input[aria-label="Ventilyatsiya korpusi yetkazish miqdori"]'),'1')
  assert.equal(confirm.disabled,false)
  await click(confirm);await flush(450)
  const state=stored()
  assert.deepEqual(state.stockMovements.filter(m=>m.type==='Sale -'&&m.source==='SO-SN').map(m=>m.lot),['SN-B'],'exactly the picked unit, not the FEFO one')
  assert.equal(state.salesOrders.find(o=>o.id==='so-sn')!.items[0].delivered,1)
  assert.equal(state.lots.find(l=>l.code==='SN-C')!.qty,1,'the other order keeps its unit')
  await click(byText('Bajarilish'))
  assert.ok(document.body.textContent?.includes('SN SN-B'),'shipment history names the serial')
})

test('editing an open order changes quantity and price with validation and shows the discount',async()=>{
  seedPartialOrder()
  await mountApp('/sales?view=orders&id=so-partial')
  await click(byText('Tahrirlash'))
  const dialog=lastDialog()
  const qty=dialog.querySelector<HTMLInputElement>('input[aria-label="Panel kronshteyn miqdori"]')!
  const save=byText('Saqlash','button',dialog) as HTMLButtonElement
  assert.equal(save.disabled,true,'nothing changed yet')
  await type(qty,'0')
  assert.equal(save.disabled,true);assert.ok(dialog.textContent?.includes('Butun musbat miqdor kiriting'))
  await type(qty,'4')
  const price=dialog.querySelector<HTMLInputElement>('input[aria-label="Panel kronshteyn narxi"]')!
  await type(price,'42750')
  assert.ok(dialog.textContent?.includes('Chegirma'),'discount against the list price is shown')
  await click(save);await flush(450)
  const o=stored().salesOrders.find(x=>x.id==='so-partial')!
  assert.deepEqual([o.items[0].qty,o.items[0].price,o.total],[4,42750,171000])
  assert.equal(o.items[0].reserved,2,'available stock reserved for the larger quantity')
})

test('order lines show returned and remaining quantities; the return form offers only returnable lines',async()=>{
  seedPartialOrder()
  const state=stored()
  state.salesOrders[0].items[0].delivered=2
  localStorage.setItem(STATE_KEY,JSON.stringify(state))
  await mountApp('/sales?view=orders&id=so-partial')
  const head=[...document.querySelectorAll('.drawer th')].map(t=>t.textContent)
  assert.ok(head.includes('Qaytarilgan')&&head.includes('Qolgan'))
  const row=document.querySelector('.drawer tbody tr')!
  assert.equal(row.querySelectorAll('td')[5].textContent,'3','5 ordered − 2 delivered')
  await click(byText('Qaytarish'))
  assert.ok(lastDialog().textContent?.includes('2 qaytarish mumkin'))
})
