import './setup'
import {byText,cleanup,click,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import type {ManufacturingState,SalesOrder} from '../../src/types'

// Audit Phase 2/5: rejected stock mutations keep their form, deep links outside the role's scope explain themselves.
afterEach(cleanup)
const text=()=>document.body.textContent||''
const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]')
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState

test('audit #11: a LOT-tracked transfer without lot records is refused — form stays open, no success, nothing moves',async()=>{
  seedState(s=>({...s,
    stockBalances:[{id:'st-x',warehouseId:'w1',itemId:'rm2',itemType:'raw',onHand:20,reserved:0,incoming:0,quarantine:0,unit:'kg'}],
    lots:[{id:'l-x',code:'L1',kind:'lot',itemId:'rm2',itemType:'raw',qty:5,originalQty:5,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po',sourceCode:'PO',createdAt:'2026-10-01 08:00',consumedBy:[]}]}))
  await mountApp('/warehouse?view=transfers')
  await click(byText('Yangi transfer'))
  // Found by its label: the form also offers source / target locations (audit #17).
  const target=[...dialog()!.querySelectorAll('.field')].find(f=>f.querySelector('label')?.textContent?.includes('Qabul qiluvchi ombor'))!
  await click(target.querySelector('.custom-select-trigger'))
  await click([...document.querySelectorAll('[role="option"]')].find(o=>o.textContent?.trim()==='WIP ombori')!)
  await type(dialog()!.querySelector('input[type="number"]'),'10')
  await click(byText('Transfer qilish','button',dialog()!))
  assert.ok(dialog(),'the form is not closed as if it had worked')
  assert.match(text(),/LOT bilan kuzatiladi/)
  assert.ok(!text().includes('transfer yakunlandi'),'no success message')
  const s=stored()
  assert.equal(s.stockBalances.find(b=>b.warehouseId==='w1'&&b.itemId==='rm2')!.onHand,20)
  assert.ok(!s.stockBalances.some(b=>b.warehouseId==='w2'),'nothing arrived in WIP')
  assert.ok(!s.stockMovements.some(m=>m.type.startsWith('Transfer')))
})

test('audit #7: a deep link to another branch’s sales order shows a no-access state, not its data',async()=>{
  const so:SalesOrder={id:'so-b2',code:'SO-B2-001',customerId:'cu1',status:'Tayyor',mode:'Make-to-stock',items:[{productId:'p3',qty:2,price:1,delivered:0,reserved:2,reservations:[{warehouseId:'w4',qty:2}]}],total:2,paymentStatus:'To‘lanmagan',deliveryDate:'2026-11-01',createdAt:'2026-10-28'}
  seedState(s=>({...s,salesOrders:[so]}))
  // em2: production manager of branch b1 (work center wc1); the order sits in w4 (branch b2).
  await mountApp('/sales?view=orders&id=so-b2','em2')
  assert.ok(text().includes('Yozuv topilmadi yoki ko‘rish ruxsati yo‘q'),'the drawer explains why nothing opens')
  assert.ok(!text().includes('SO-B2-001'),'the hidden order is not shown anywhere')
  await click(byText('Yopish','button',dialog()!))
  assert.equal(dialog(),null)
})
