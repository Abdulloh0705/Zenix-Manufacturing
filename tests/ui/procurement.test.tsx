import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import * as A from '../../src/domain/actions'
import type {ManufacturingState} from '../../src/types'

// Procurement completion: purchase requests → PO, supplier invoice 3-way match with a price exception, requisites.
afterEach(cleanup)
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const text=()=>document.body.textContent||''
let n=0
const ctx=(s:ManufacturingState,user='em1'):A.Ctx=>({now:new Date(),user:s.employees.find(e=>e.id===user)!,id:p=>`${p}-ui${++n}`})
const must=(o:A.Outcome)=>{if(!o.result.ok)throw new Error(o.result.message);return o.state}

test('purchase request: created and submitted from the form; own request cannot be approved; approved one becomes a PO draft',async()=>{
  seedState(s=>s)
  await mountApp('/purchases?view=requests')
  assert.ok(text().includes('Bo‘lim ehtiyojini xarid so‘rovi sifatida kiriting'),'empty state')
  await click(byText('Yangi so‘rov'))
  await click(byText('Tasdiqlashga yuborish','button',lastDialog()))
  assert.ok(lastDialog().textContent?.includes('musbat miqdor'),'validation before submit')
  await type(lastDialog().querySelector('input[aria-label="Miqdor 1"]'),'50')
  await click(byText('Tasdiqlashga yuborish','button',lastDialog()));await flush(60)
  let s=stored()
  assert.equal(s.purchaseRequests![0].status,'Yuborilgan');assert.equal(s.purchaseRequests![0].lines[0].qty,50)
  // The creator sees the request but cannot decide it.
  await cleanup()
  seedState(()=>({...s,employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)}))
  await mountApp(`/purchases?view=requests&pr=${s.purchaseRequests![0].id}`)
  assert.equal((byText('Tasdiqlash','button',lastDialog()) as HTMLButtonElement).disabled,true)
  assert.ok(lastDialog().textContent?.includes('boshqa xodim tasdiqlaydi'))
  // A request someone else raised and approved is turned into a PO draft.
  await cleanup()
  seedState(base=>{let x=must(A.createPurchaseRequest(base,ctx(base,'em2'),{lines:[{materialId:'rm2',qty:120}],neededBy:'2030-01-01',warehouseId:'w1',submit:true}));x=must(A.decidePurchaseRequest(x,ctx(x,'em1'),x.purchaseRequests![0].id,'approve'));return x})
  s=stored()
  await mountApp(`/purchases?view=requests&pr=${s.purchaseRequests![0].id}`)
  await click(byText('PO yaratish','button',lastDialog()))
  await click(byText('PO yaratish','button',lastDialog()));await flush(60)
  s=stored()
  const po=s.purchaseOrders.find(p=>p.requestIds?.includes(s.purchaseRequests![0].id))!
  assert.equal(po.status,'Qoralama');assert.equal(po.items[0].qty,120)
  assert.equal(s.purchaseRequests![0].status,'Buyurtma qilingan')
})

test('supplier invoice: over-billing is flagged, a price variance needs an exception reason and is posted once',async()=>{
  let poId=''
  seedState(base=>{
    const link=base.supplierMaterials.find(l=>l.materialId==='rm2')!
    const po=A.createPurchaseOrder(base,ctx(base),{supplierId:link.supplierId,lines:[{materialId:'rm2',qty:100,price:1000}],allowBelowMoq:true})
    poId=po.result.id!
    return must(A.receivePurchase(must(po),ctx(must(po)),poId,'rm2',60))
  })
  const stockBefore=stored().stockBalances.filter(b=>b.itemId==='rm2').reduce((a,b)=>a+b.onHand,0)
  await mountApp(`/purchases?view=orders&id=${poId}`)
  await click([...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent?.includes('Invoice / to‘lov'))!)
  await click(byText('Invoice kiritish'))
  const modal=lastDialog()
  const qty=modal.querySelector<HTMLInputElement>('input[aria-label="Po‘lat list 1.5mm invoice miqdori"]')!
  assert.equal(qty.value,'60','defaults to received and not yet billed')
  await type(modal.querySelector('input[placeholder="Supplier hujjat raqami"]'),'F-100')
  await type(qty,'70')
  assert.ok(modal.textContent?.includes('Qabul qilinmagan miqdor'),'over-billing flagged')
  await type(qty,'60')
  await type(modal.querySelector('input[aria-label="Po‘lat list 1.5mm invoice narxi"]'),'1100')
  assert.ok(modal.textContent?.includes('Narx farqi'))
  await click(byText('Kiritish','button',modal));await flush(60)
  let s=stored()
  assert.equal(s.supplierInvoices![0].status,'Tekshirilmoqda')
  assert.equal(s.stockBalances.filter(b=>b.itemId==='rm2').reduce((a,b)=>a+b.onHand,0),stockBefore,'an invoice never changes stock')
  await click(byText('Istisno bilan tasdiqlash','button',lastDialog()))
  const confirm=byText('Tasdiqlash','button',lastDialog()) as HTMLButtonElement
  assert.equal(confirm.disabled,true,'exception reason required')
  await type(lastDialog().querySelector('textarea'),'Kelishilgan narx o‘zgarishi')
  await click(confirm);await flush(60)
  s=stored()
  assert.equal(s.supplierInvoices![0].status,'Tasdiqlangan')
  assert.deepEqual(s.payables!.filter(e=>e.invoiceId===s.supplierInvoices![0].id).map(e=>[e.kind,e.amount]),[['adjustment',6000]])
})

test('supplier form validates bank requisites before saving',async()=>{
  seedState(s=>s)
  await mountApp('/purchases?view=suppliers')
  await click(byText('Yangi supplier')??byText('Supplier qo‘shish'))
  const dialog=lastDialog()
  await type(dialog.querySelector('input[name="name"]')??dialog.querySelector('input'),'Rekvizit Test MChJ')
  const field=(label:string)=>[...dialog.querySelectorAll('.field')].find(f=>f.querySelector('label')?.textContent?.includes(label))!.querySelector('input')!
  await type(field('STIR'),'12345')
  await type(field('Hisob raqami'),'1234')
  await click(byText('Saqlash','button',dialog));await flush(40)
  assert.ok(dialog.textContent?.includes('STIR 9 ta raqam'));assert.ok(dialog.textContent?.includes('Hisob raqami 20 ta raqam'))
  assert.equal(stored().suppliers.some(x=>x.name==='Rekvizit Test MChJ'),false,'nothing saved')
})
