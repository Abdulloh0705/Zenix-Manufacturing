import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,key,type} from './helpers'
import {mountApp,seedState,STATE_KEY} from './appFixture'
import type {ManufacturingState} from '../../src/types'
import {createSeedState} from '../../src/data/mockData'

// Context-aware help and accessibility of the help surfaces (2026-11-21).
afterEach(cleanup)
const panel=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(d=>d.textContent?.includes('Sahifa bo‘yicha yordam'))||null
const helpButton=()=>document.querySelector<HTMLButtonElement>('button[aria-label="Yordam"]')!
async function openPanel(){helpButton().focus();await click(helpButton());await flush(40);return panel()!}
const actionRow=(root:HTMLElement,label:string)=>[...root.querySelectorAll('.help-actions-list li')].find(li=>li.querySelector('span')?.textContent===label)

/** The demo data set (orders, checks, maintenance) plus a peer engineer and keepers bound to w1 (branch b1) and w4 (branch b2). */
function seed(){
  seedState(()=>{
    const s=createSeedState()
    const em=(base:string,patch:Partial<ManufacturingState['employees'][number]>)=>({...s.employees.find(e=>e.id===base)!,...patch})
    const ma4=s.maintenanceOrders.find(m=>m.id==='ma-4')!
    return {...s,
      employees:[...s.employees,em('em5',{id:'em5-peer',name:'Peer Engineer'}),em('em2',{id:'wh-b1',name:'Keeper Bir',roleId:'role6',workCenterId:'',warehouseId:'w1'}),em('em2',{id:'wh-b2',name:'Keeper Ikki',roleId:'role6',workCenterId:'',warehouseId:'w4'})],
      maintenanceOrders:[{...ma4,id:'mt-mine',code:'MT-MINE',technicianId:'em5'},{...ma4,id:'mt-peer',code:'MT-PEER',technicianId:'em5-peer'},...s.maintenanceOrders],
    }
  })
}

test('engineer: the panel allows spare parts on their own order and explains the refusal on another’s',async()=>{
  seed()
  await mountApp('/equipment?view=maintenance&id=mt-mine','em5')
  let p=await openPanel()
  assert.match(p.textContent||'',/Ochilgan yozuv: MT-MINE/)
  assert.match(actionRow(p,'Qism berish')?.textContent||'',/Mumkin(?! emas)/)
  assert.match(p.textContent||'',/Sizga biriktirilgan ishlar/)
  assert.ok(p.querySelector('a[href="/equipment?view=maintenance&id=mt-mine"]'),'assigned order links to its real page')
  await cleanup();seed()
  await mountApp('/equipment?view=maintenance&id=mt-peer','em5')
  p=await openPanel()
  const row=actionRow(p,'Qism berish')!
  assert.match(row.textContent||'',/Mumkin emas/)
  assert.match(row.textContent||'',/Bu maintenance ishi sizga biriktirilmagan/)
  assert.match(p.textContent||'',/Texnik: Peer Engineer/)
})

test('warehouse keeper: own warehouse only, receiving / issuing / transfer explained, transfer refusal with the real reason',async()=>{
  seed()
  await mountApp('/warehouse?view=stock','wh-b1')
  const p=await openPanel()
  const notes=p.querySelector('[aria-labelledby="help-panel-context"]')!
  assert.match(notes.textContent||'',/Siz faqat shu omborlarda ishlaysiz: Xomashyo ombori\./)
  assert.doesNotMatch(notes.textContent||'',/Chirchiq ombori/)
  for(const t of ['Qabul (kirim)','Chiqim','Transfer'])assert.ok(notes.textContent?.includes(t),t)
  const transfer=[...notes.querySelectorAll('li')].find(li=>li.querySelector('b')?.textContent==='Transfer')!
  assert.match(transfer.textContent||'',/Mumkin emas.*siz faqat Xomashyo ombori omborida ishlaysiz/)
  await cleanup();seed()
  await mountApp('/warehouse?view=maintenance&mo=mt-mine','wh-b2')
  const far=await openPanel()
  assert.match(far.textContent||'',/Ochilgan yozuv topilmadi yoki sizning doirangizdan tashqarida/,'another branch’s order is not shown as actionable')
})

test('operator: START refused outside their work center, planning actions listed as closed with the missing right',async()=>{
  seed()
  await mountApp('/production?view=orders&id=mo-8','em3')
  const p=await openPanel()
  const start=actionRow(p,'Operatsiyani boshlash (START)')!
  assert.match(start.textContent||'',/Mumkin emas.*siz faqat Laser Cuttingda ishlaysiz/)
  assert.match(actionRow(p,'Buyurtmani tahrirlash va rejalash')?.textContent||'',/Ishlab chiqarish: Tahrir/)
  const closed=p.querySelector('[aria-labelledby="help-panel-closed"]')!
  assert.match(closed.textContent||'',/MO yaratish.*Kerakli ruxsat: Ishlab chiqarish: Yaratish/)
  assert.equal(byText('MO yaratish','a',p),null,'no link to steps for a closed action')
  assert.match(p.textContent||'',/Siz faqat Laser Cutting ish markazidagi operatsiyalarni bajarasiz/)
})

test('quality inspector: a decided check is final, a pending one is open, each with its next step',async()=>{
  seed()
  await mountApp('/quality?view=checks&id=qc-19','em4')
  let p=await openPanel()
  assert.match(actionRow(p,'Natijani kiritish')?.textContent||'',/Qaror yakuniy \(Passed\)/)
  await cleanup();seed()
  await mountApp('/quality?view=checks&id=qc-16','em4')
  p=await openPanel()
  assert.match(actionRow(p,'Natijani kiritish')?.textContent||'',/Mumkin(?! emas)/)
  assert.match(p.textContent||'',/Keyingi qadam\..*karantinda qoladi/)
  for(const t of ['Tekshiruv','Karantin va chiqarish','Rework','CAPA tekshiruvi'])assert.ok(p.textContent?.includes(t),t)
})

test('keyboard: the panel takes focus, Escape closes it and focus returns to the Yordam button',async()=>{
  await mountApp('/warehouse?view=transfers')
  const p=await openPanel()
  assert.ok(p.contains(document.activeElement),'focus moves into the dialog')
  assert.equal(p.getAttribute('aria-modal'),'true')
  assert.ok(p.getAttribute('aria-labelledby')&&document.getElementById(p.getAttribute('aria-labelledby')!)?.textContent?.includes('Sahifa bo‘yicha yordam'),'dialog is named by its title')
  assert.equal(helpButton().getAttribute('aria-expanded'),'true')
  await key(document.activeElement||document,'Escape');await flush(40)
  assert.equal(panel(),null)
  assert.equal(document.activeElement,helpButton(),'focus is restored to the opener')
  assert.equal(helpButton().getAttribute('aria-expanded'),'false')
})

test('Help Center: results are announced, a chosen result receives focus, guide steps are announced',async()=>{
  await mountApp('/help?q=x')
  const search=document.querySelector('input[aria-label="Yordam qidirish"]')!
  const status=()=>document.getElementById('help-search-status')!
  assert.equal(search.getAttribute('aria-describedby'),'help-search-status')
  assert.equal(status().getAttribute('aria-live'),'polite')
  await type(search,'inventarizatsiya')
  assert.match(status().textContent||'',/\d+ ta natija topildi/)
  await type(search,'zzzz-yoq')
  assert.equal(status().textContent,'Natija topilmadi')
  await type(search,'Sanoqni saqlash')
  const result=[...document.querySelectorAll<HTMLElement>('[aria-label="Qidiruv natijalari"] button')].find(b=>b.querySelector('b')?.textContent==='Inventarizatsiya o‘tkazish')!
  await click(result);await flush(30)
  const detail=document.querySelector('[aria-label="Tanlangan yordam mavzusi"]')!
  assert.equal(document.activeElement,detail,'focus moves to the opened guide')
  assert.ok(detail.querySelector('h2')?.textContent==='Inventarizatsiya o‘tkazish','the guide has its own heading')
  assert.match(detail.textContent||'',/Hozir bajarish mumkin|Hozir bajarib bo‘lmaydi|Hozircha ish yo‘q/,'personal availability is shown')
  const live=detail.querySelector('[role="status"]')!
  assert.match(live.textContent||'',/Qadam 1 dan 3/)
  await click(byText('Keyingi qadam'))
  assert.match(live.textContent||'',/Qadam 2 dan 3/)
  assert.ok(detail.querySelector('li.finished .sr-only')?.textContent?.includes('o‘tilgan'),'a passed step is not conveyed by colour alone')
})

test('dismissing the onboarding banner keeps keyboard focus on the page; context reads never write data',async()=>{
  seed()
  await mountApp('/equipment?view=maintenance&id=mt-peer','em5')
  const before=localStorage.getItem(STATE_KEY)
  const banner=document.querySelector('[aria-label="Birinchi kirish yo‘riqnomasi"]')!
  await click(byText('Keyinroq','button',banner));await flush(30)
  assert.equal(document.activeElement,document.getElementById('main'))
  await openPanel()
  await key(document.activeElement||document,'Escape');await flush(30)
  assert.equal(localStorage.getItem(STATE_KEY),before,'opening context help changes no business data')
})
