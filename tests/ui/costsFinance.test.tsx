import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {cleanup,click,flush} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import {supplierBalance} from '../../src/domain/payables'
import {todayISO} from '../../src/utils/dates'
import {compactMoney} from '../../src/utils/format'
import type {ManufacturingState} from '../../src/types'

afterEach(async()=>{await cleanup()})
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
const rowWith=(text:string)=>[...document.querySelectorAll('tr')].find(r=>r.textContent?.includes(text))

/** One completed maintenance order with its automatic expense next to one hand-typed expense, both dated today. */
function seedExpenses(){
  const today=todayISO()
  seedState(s=>({...s,
    maintenanceOrders:[{id:'mo-fn',code:'MNT-FN1',equipmentId:'eq1',type:'Corrective',status:'Yakunlangan',scheduled:today,completed:`${today} 10:00`,technicianId:'em1',cost:250000,note:''},...s.maintenanceOrders],
    expenses:[
      {id:'ex-auto',date:today,type:'Maintenance',sourceId:'eq1',branchId:'b1',amount:250000,note:'MNT-FN1 · Extrusion Press 1800T'},
      {id:'ex-manual',date:today,type:'Transport',sourceId:'manual',branchId:'b1',amount:70000,note:'Yuk tashish FN'},
      ...s.expenses]}))
}

test('FN-002 UI: an automatic expense is labelled, opens no editor and has no delete button; a manual one keeps both',async()=>{
  seedExpenses()
  await mountApp('/costs?view=expenses')
  const auto=rowWith('MNT-FN1 · Extrusion')!,manual=rowWith('Yuk tashish FN')!
  assert.ok(auto,'the automatic expense is listed')
  assert.ok(auto.textContent?.includes('avtomatik · MNT-FN1'),'its source document is named')
  assert.equal(auto.querySelector('[aria-label="Xarajatni o‘chirish"]'),null,'no delete for a document cost')
  assert.ok(manual.querySelector('[aria-label="Xarajatni o‘chirish"]'),'a manual expense can still be deleted')
  await click(auto.querySelector('td'))
  await flush()
  assert.equal(document.querySelector('[role="dialog"]'),null,'clicking the automatic row opens no editor')
  await click(manual.querySelector('td'))
  await flush()
  assert.ok(document.querySelector('[role="dialog"]')?.textContent?.includes('Xarajatni tahrirlash'),'the manual row opens its editor')
  assert.equal(stored().expenses.find(e=>e.id==='ex-auto')!.amount,250000)
})

test('costs overview shows supplier payables from the same ledger as Purchases',async()=>{
  seedState(s=>{
    const supplierId=s.suppliers[0].id
    const payables=[{id:'ap-fn',key:'opening:fn',supplierId,kind:'opening' as const,amount:3400000,date:'2026-01-01 00:00',by:'system',reason:'Ochilish',currency:'UZS' as const}]
    return {...s,payables,suppliers:s.suppliers.map(x=>({...x,debt:x.id===supplierId?3400000:0}))}
  })
  await mountApp('/costs')
  const s=stored()
  const expected=s.suppliers.reduce((a,x)=>a+Math.max(0,supplierBalance(s,x.id)),0)
  assert.equal(expected,3400000)
  const kpi=[...document.querySelectorAll<HTMLElement>('.kpi, [class*="kpi"]')].find(k=>k.textContent?.includes('Kreditorlik qarzi'))
  assert.ok(kpi,'the payables KPI is shown')
  assert.ok(kpi.textContent?.includes(compactMoney(expected)),`KPI shows ${compactMoney(expected)}`)
})
