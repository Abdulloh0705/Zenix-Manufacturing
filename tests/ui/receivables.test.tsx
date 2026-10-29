import './setup'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import type {ManufacturingState} from '../../src/types'

const proto=Object.getPrototypeOf(localStorage) as Storage
const nativeSetItem=proto.setItem
const nativeCreate=URL.createObjectURL
afterEach(async()=>{proto.setItem=nativeSetItem;URL.createObjectURL=nativeCreate;await cleanup()})
const text=()=>document.body.textContent||''
/** The topmost dialog (a modal opened from a drawer comes after it in the DOM). */
const dialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)??null
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState

/** Air Systems (cu2) owes 1 000 000 from before the ledger: one opening entry. */
const withOpening=()=>seedState(s=>({...s,customers:s.customers.map(c=>c.id==='cu2'?{...c,debt:1000000}:c),
  receivables:[{id:'aropen-1',key:'opening:cu2',customerId:'cu2',kind:'opening',amount:1000000,date:'2026-01-01 00:00',by:'system',byName:'Tizim'}]}))

test('audit #19: a payment whose save fails changes no balance; the retry posts it exactly once',async()=>{
  withOpening()
  await mountApp('/sales?view=customers&id=cu2')
  assert.ok(text().includes('Qarz (ledger)'),'the customer card shows the ledger balance')
  await click(byText('To‘lov qabul qilish'))
  await flush()
  const amount=dialog()!.querySelector<HTMLInputElement>('input')!
  await type(amount,'400000')
  proto.setItem=function(this:Storage,k:string,v:string){if(k===STATE_KEY)throw new DOMException('full','QuotaExceededError');return nativeSetItem.call(this,k,v)}
  await click(byText('To‘lovni qayd etish','button',dialog()!))
  await flush(40)
  assert.ok(dialog(),'the payment form stays open')
  assert.ok(text().includes('Saqlanmadi'),'the user is told it was not saved')
  proto.setItem=nativeSetItem
  assert.equal(stored().receivables!.length,1,'nothing was posted')
  assert.equal(stored().customers.find(c=>c.id==='cu2')!.debt,1000000)
  await click(byText('To‘lovni qayd etish','button',dialog()!))
  await flush(40)
  const after=stored()
  assert.deepEqual(after.receivables!.filter(e=>e.kind==='payment').map(e=>e.amount),[-400000],'posted once')
  assert.equal(after.customers.find(c=>c.id==='cu2')!.debt,600000)
  // Debt is not a typed field any more: the edit form shows it read-only.
  await click(byText('Tahrirlash'))
  await flush()
  const debtField=[...dialog()!.querySelectorAll<HTMLInputElement>('input')].find(i=>i.readOnly)
  assert.ok(debtField,'the balance is read-only in the customer form')
})

test('audit #21: the table export is a real .xlsx of exactly the filtered rows and the table’s columns',async()=>{
  withOpening()
  let blob:Blob|undefined
  URL.createObjectURL=((b:Blob)=>{blob=b;return 'blob:test'}) as typeof URL.createObjectURL
  await mountApp('/sales?view=customers&q=Air')
  await click([...document.querySelectorAll<HTMLButtonElement>('.toolbar-actions button')].find(b=>b.textContent?.trim()==='Excel')!)
  await flush()
  assert.ok(blob,'a file was produced')
  assert.equal(blob!.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const bytes=new Uint8Array(await blob!.arrayBuffer())
  assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4B,0x03,0x04],'a ZIP package, not HTML')
  const all=new TextDecoder().decode(bytes)
  const sheet=all.slice(all.indexOf('<worksheet'),all.indexOf('</worksheet>')+12)
  assert.equal(sheet.split('<row ').length-1,2,'header + the one customer the search left')
  const header=[...sheet.slice(0,sheet.indexOf('</row>')).matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(m=>m[1])
  assert.deepEqual(header,['Mijoz','Tur','Status','Buyurtmalar','Savdo hajmi','Qarz'])
  assert.ok(sheet.includes('Air Systems LLC')&&!sheet.includes('BuildTech'),'only the filtered row')
  assert.ok(/<c r="F2" s="2"><v>1000000<\/v><\/c>/.test(sheet),'the balance is a number cell')
})
