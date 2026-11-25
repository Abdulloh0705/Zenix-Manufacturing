import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import type {ManufacturingState} from '../../src/types'

// Inventory completion: two-step transfers with partial receipt and return, stocktaking sessions with approval.
afterEach(cleanup)
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const text=()=>document.body.textContent||''
const lot=(itemId:string,code:string,qty:number)=>({id:`l-${code}`,code,kind:'lot' as const,itemId,itemType:'raw' as const,qty,originalQty:qty,warehouseId:'w1',status:'available' as const,sourceType:'purchase' as const,sourceId:'po',sourceCode:'PO-1',createdAt:'2026-10-01 08:00',consumedBy:[]})
const balance=(itemId:string,onHand:number,unit:string)=>({id:`st-${itemId}`,warehouseId:'w1',itemId,itemType:'raw' as const,onHand,reserved:0,incoming:0,quarantine:0,unit})
const bal=(s:ManufacturingState,itemId:string,wh:string)=>s.stockBalances.find(b=>b.itemId===itemId&&b.warehouseId===wh)
/**
 * Opens a deep link on the same stored data. Under MemoryRouter, setting `?id=` from a page rebuilds the query from
 * window.location (empty in tests) and drops `view=`; deep links are how the app opens records, so tests use them.
 */
async function remount(path:string){
  const saved=Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)!]))
  await cleanup()
  for(const [k,v] of Object.entries(saved))localStorage.setItem(k,v)
  await mountApp(path)
}
async function pick(field:string,option:string){
  const f=[...lastDialog().querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent?.includes(field))!
  await click(f.querySelector('.custom-select-trigger'))
  await click([...document.querySelectorAll('[role="option"]')].find(o=>o.textContent?.trim()===option)!)
}

test('two-step transfer: dispatched stock is in transit, received in part, the rest returns to the source',async()=>{
  seedState(s=>({...s,stockBalances:[balance('rm2',50,'kg')],lots:[lot('rm2','L1',50)]}))
  await mountApp('/warehouse?view=transfers')
  await click(byText('Yangi transfer'))
  await pick('Qabul qiluvchi ombor','Chirchiq ombori')
  await type(lastDialog().querySelector('input[aria-label="Miqdor"]'),'30')
  await click(byText('Yo‘lga chiqarish','button',lastDialog()))
  assert.ok(lastDialog().textContent?.includes('Transfer sababini yozing'),'missing reason is rejected in the form')
  assert.equal(stored().stockTransfers?.length||0,0)
  await type(lastDialog().querySelector('input[placeholder^="Masalan: ishlab chiqarish"]'),'Ishlab chiqarish uchun zaxira')
  await click(byText('Yo‘lga chiqarish','button',lastDialog()))
  await flush(60)
  let s=stored()
  assert.equal(s.stockTransfers![0].status,'Yo‘lda')
  assert.deepEqual([bal(s,'rm2','w1')!.onHand,bal(s,'rm2','w4')!.onHand,bal(s,'rm2','w4')!.incoming],[20,0,30],'in transit: out of the source, only incoming in the target')
  const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent?.includes(s.stockTransfers![0].ref))!
  assert.ok(row.textContent?.includes('Yo‘lda'))
  await remount(`/warehouse?view=transfers&id=${s.stockTransfers![0].id}`)
  await click(byText('Qabul qilish'))
  const input=lastDialog().querySelector<HTMLInputElement>('input[aria-label="L1 qabul miqdori"]')!
  assert.equal(input.value,'30','defaults to what is still in transit')
  await type(input,'31')
  assert.equal((byText('Qabulni tasdiqlash','button',lastDialog()) as HTMLButtonElement).disabled,true,'over-receipt blocked before submit')
  await type(input,'10')
  assert.ok(lastDialog().textContent?.includes('20 kg yo‘lda qoladi'))
  await click(byText('Qabulni tasdiqlash','button',lastDialog()));await flush(60)
  s=stored()
  assert.equal(s.stockTransfers![0].status,'Qisman qabul qilindi')
  assert.deepEqual([bal(s,'rm2','w4')!.onHand,bal(s,'rm2','w4')!.incoming],[10,20])
  await click(byText('Manbaga qaytarish'))
  const back=byText('Qaytarish','button',lastDialog()) as HTMLButtonElement
  assert.equal(back.disabled,true,'a reason is required')
  await type(lastDialog().querySelector('textarea'),'Yuk shikastlangan')
  await click(back);await flush(60)
  s=stored()
  assert.equal(s.stockTransfers![0].status,'Yopildi')
  assert.deepEqual([bal(s,'rm2','w1')!.onHand,bal(s,'rm2','w4')!.onHand,bal(s,'rm2','w4')!.incoming],[40,10,0])
  assert.ok(text().includes('Manbaga qaytarildi'),'history shows the return')
})

test('immediate transfer shows actor, route and mandatory reason after remount',async()=>{
  seedState(s=>({...s,stockBalances:[balance('rm2',10,'kg')],lots:[lot('rm2','L2',10)]}))
  await mountApp('/warehouse?view=transfers')
  await click(byText('Yangi transfer'))
  await click(byText('Darhol (bir vaqtda)'))
  await pick('Qabul qiluvchi ombor','Chirchiq ombori')
  await type(lastDialog().querySelector('input[aria-label="Miqdor"]'),'4')
  await type(lastDialog().querySelector('input[placeholder^="Masalan: ishlab chiqarish"]'),'Ishlab chiqarish ehtiyoji')
  await click(byText('Transfer qilish','button',lastDialog()));await flush(40)
  const s=stored(),tr=s.stockTransfers![0]
  assert.deepEqual([tr.mode,tr.reason,tr.createdBy,tr.receipts[0].by],['immediate','Ishlab chiqarish ehtiyoji','em1','em1'])
  assert.deepEqual([bal(s,'rm2','w1')!.onHand,bal(s,'rm2','w4')!.onHand],[6,4])
  await remount(`/warehouse?view=transfers&id=${tr.id}`)
  assert.ok(text().includes('Ishlab chiqarish ehtiyoji'))
  assert.ok(text().includes('Toshkent zavodi / Xomashyo ombori'))
  assert.ok(text().includes('Chirchiq sexi / Chirchiq ombori'))
  assert.ok(text().includes('Darhol ko‘chirildi'))
})

test('stocktaking session: count, save, review the difference and approve as an adjustment',async()=>{
  seedState(s=>({...s,stockBalances:[balance('rm2',50,'kg'),balance('rm4',100,'dona')],lots:[lot('rm2','L1',50),lot('rm4','H1',100)]}))
  await mountApp('/warehouse?view=inventory')
  assert.ok(text().includes('Inventarizatsiya hali o‘tkazilmagan'),'empty state')
  await click(byText('Yangi inventarizatsiya'))
  assert.ok(lastDialog().textContent?.includes('2 ta qoldiq qatori'))
  await click(byText('Ochish','button',lastDialog()));await flush(60)
  await remount(`/warehouse?view=inventory&count=${stored().stockCounts![0].id}`)
  const drawer=lastDialog()
  assert.ok(drawer.textContent?.includes('Inventarizatsiya'))
  const steel=drawer.querySelector<HTMLInputElement>('input[aria-label="Po‘lat list 1.5mm sanalgan miqdori"]')!
  await type(steel,'47')
  const approve=byText('Tasdiqlash','button',drawer) as HTMLButtonElement
  assert.equal(approve.disabled,true,'unsaved counts must be saved first')
  await click(byText('Sanoqni saqlash (1)','button',drawer));await flush(40)
  assert.equal(stored().stockCounts![0].lines.find(l=>l.itemKey==='rm2')!.counted,47)
  assert.ok(lastDialog().textContent?.includes('-3'),'difference shown')
  await click(byText('Tasdiqlash','button',lastDialog()))
  const confirm=lastDialog()
  assert.ok(confirm.textContent?.includes('1 ta farqli qator'))
  const ok=byText('Tasdiqlash','button',confirm) as HTMLButtonElement
  assert.equal(ok.disabled,true,'approval needs a note')
  await type(confirm.querySelector('textarea'),'Oylik sanoq')
  await click(ok);await flush(60)
  const s=stored()
  assert.equal(s.stockCounts![0].status,'Tasdiqlangan')
  assert.equal(bal(s,'rm2','w1')!.onHand,47);assert.equal(bal(s,'rm4','w1')!.onHand,100,'uncounted line unchanged')
  assert.ok(s.stockMovements.some(m=>m.type==='Adjustment -'&&m.qty===-3&&m.note.includes('Oylik sanoq')))
})
