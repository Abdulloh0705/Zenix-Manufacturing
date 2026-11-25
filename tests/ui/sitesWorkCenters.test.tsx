import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import type {ManufacturingState} from '../../src/types'

// Phase 4 blockers: the owner adds a branch and a production line in Settings, then a work center on that line.
afterEach(cleanup)
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const inputs=(root:ParentNode)=>[...root.querySelectorAll<HTMLInputElement>('input')]
const text=()=>document.body.textContent||''

test('Settings → Locations: the owner saves a new branch and a new production line',async()=>{
  seedState(s=>({...s,productionLines:[],workCenters:[]}))
  const branches=stored().branches.length
  await mountApp('/settings?view=locations')
  await click(byText('Qo‘shish'))
  let dialog=lastDialog()
  assert.ok(dialog.textContent?.includes('Yangi filial'))
  const [bName,bCode]=inputs(dialog)
  await type(bName,'Phase4 East Branch');await type(bCode,'east1')
  await click(byText('Saqlash','button',dialog));await flush(40)
  assert.equal(stored().branches.length,branches+1,'branch stored')
  assert.equal(stored().branches.find(b=>b.name==='Phase4 East Branch')?.code,'EAST1')
  assert.equal(document.querySelectorAll('[role="dialog"]').length,0,'modal closes after save')
  const add=[...document.querySelectorAll<HTMLElement>('button')].filter(b=>b.textContent?.trim()==='Qo‘shish')
  await click(add.at(-1)!)
  dialog=lastDialog()
  assert.ok(dialog.textContent?.includes('Yangi liniya'))
  const [lName,lCode]=inputs(dialog)
  await type(lName,'Phase4 Assembly Line');await type(lCode,'l-p4')
  await click(byText('Saqlash','button',dialog));await flush(40)
  assert.deepEqual(stored().productionLines.map(l=>[l.name,l.code]),[['Phase4 Assembly Line','L-P4']])
})

test('Work Centers: an empty company is told what is missing and the owner adds a work center on a line',async()=>{
  seedState(s=>({...s,workCenters:[]}))
  const line=stored().productionLines[0]
  await mountApp('/equipment?view=work-centers')
  assert.ok(text().includes('Work center kiritilmagan'),'empty state')
  await click(byText('Work center qo‘shish'))
  const dialog=lastDialog()
  assert.ok(dialog.textContent?.includes('Yangi work center'))
  const [name,code]=inputs(dialog)
  await click(byText('Saqlash','button',dialog));await flush(40)
  assert.equal(stored().workCenters.length,0,'required fields block an empty save')
  await type(name,'Phase4 Press');await type(code,'wc-p4')
  await click(byText('Saqlash','button',dialog));await flush(40)
  const [wc]=stored().workCenters
  assert.deepEqual([wc.name,wc.code,wc.lineId,wc.branchId,wc.status],['Phase4 Press','WC-P4',line.id,line.branchId,'Ishlamoqda'])
  assert.ok(text().includes('Phase4 Press'),'listed in the table')
})

test('Work Centers: a duplicate code is refused and a company without lines is sent to create one first',async()=>{
  seedState(s=>s)
  const existing=stored().workCenters[0]
  await mountApp('/equipment?view=work-centers')
  await click(byText('Work center qo‘shish'))
  let dialog=lastDialog()
  const [name,code]=inputs(dialog)
  await type(name,'Copy');await type(code,existing.code.toLowerCase())
  await click(byText('Saqlash','button',dialog));await flush(40)
  assert.ok(dialog.textContent?.includes('Bu kod band'))
  assert.equal(stored().workCenters.filter(w=>w.name==='Copy').length,0)
  await cleanup()
  seedState(s=>({...s,productionLines:[],workCenters:[]}))
  await mountApp('/equipment?view=work-centers')
  await click(byText('Work center qo‘shish'))
  dialog=lastDialog()
  assert.ok(dialog.textContent?.includes('Avval ishlab chiqarish liniyasini yarating'))
  assert.equal((byText('Saqlash','button',dialog) as HTMLButtonElement).disabled,true)
})
