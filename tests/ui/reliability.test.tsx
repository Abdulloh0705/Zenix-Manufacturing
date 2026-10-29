import './setup'
import {byText,cleanup,click,flush,render,type} from './helpers'
import {STATE_KEY,location,mountApp,seedState,signIn} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryRouter} from 'react-router-dom'
import App from '../../src/App'
import {AppProvider} from '../../src/app/providers/AppProvider/AppContext'
import {RootBoundary} from '../../src/app/RootBoundary'
import {createInitialState} from '../../src/data/mockData'
import {SCHEMA_VERSION} from '../../src/domain/migrations'

const CORRUPT_KEY='zenix-manufacturing-v3-unreadable',REPAIR_KEY='zenix-manufacturing-v3-before-repair',SESSION_KEY='zenix-session-v1'
const proto=Object.getPrototypeOf(localStorage) as Storage
const nativeSetItem=proto.setItem
afterEach(async()=>{proto.setItem=nativeSetItem;await cleanup()})
const text=()=>document.body.textContent||''
const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]')

async function mountRaw(path='/'){
  const view=await render(<MemoryRouter initialEntries={[path]}><AppProvider><App/></AppProvider></MemoryRouter>)
  await flush(60)
  return view
}

test('unreadable stored data opens recovery mode: nothing is written until the user chooses to start clean',async()=>{
  signIn()
  const raw='{"productionOrders":[{"id":"mo-1"'
  localStorage.setItem(STATE_KEY,raw)
  await mountRaw('/')
  assert.ok(text().includes('Ma’lumotlarni tiklash'),'the recovery screen is shown instead of the app')
  window.dispatchEvent(new Event('pagehide'))
  await flush(400)
  assert.equal(localStorage.getItem(STATE_KEY),raw,'the unreadable data is not overwritten by saves or the close flush')
  await click(byText('Toza holatda ochish'))
  await click(byText('Toza holatda ochish','button',dialog()!))
  await flush(60)
  assert.equal(JSON.parse(localStorage.getItem(CORRUPT_KEY)!).raw,raw,'the original text is kept aside')
  assert.ok(Array.isArray(JSON.parse(localStorage.getItem(STATE_KEY)!).productionOrders),'a valid working copy is saved')
  assert.ok(!text().includes('Ma’lumotlarni tiklash'),'the app opens')
})

test('broken records are repaired on load, reported, and the original is downloadable from Tizim',async()=>{
  seedState(s=>({...s,customers:[...s.customers,null as never],stockBalances:[{id:'sb-x',warehouseId:'w1',itemId:'rm1',itemType:'raw',onHand:null as never,reserved:0,incoming:0,unit:'kg'}]}))
  await mountApp('/settings?view=system')
  await flush(60)
  assert.ok(text().includes('chetga olindi'),'the user is told what loading found')
  assert.ok(localStorage.getItem(REPAIR_KEY),'the pre-repair text is kept')
  assert.ok(text().includes('Tiklash nusxalari')&&text().includes('Tiklashdan oldingi ma’lumot'),'the copy is listed for download')
})

test('a refused save shows a lasting warning until saving works again',async()=>{
  await mountApp('/settings?view=appearance')
  proto.setItem=function(this:Storage,k:string,v:string){if(k===STATE_KEY)throw new DOMException('full','QuotaExceededError');return nativeSetItem.call(this,k,v)}
  await click(byText('Katta',`[aria-label="Shrift o‘lchami"] button`))
  await flush(60)
  assert.ok(document.querySelector('.storage-alert'),'the banner stays while saves fail')
  assert.ok(text().includes('saqlanmadi'))
  proto.setItem=nativeSetItem
  await click(byText('Ixcham',`[aria-label="Interfeys zichligi"] button`))
  await flush(60)
  assert.equal(document.querySelector('.storage-alert'),null,'the banner clears after a successful save')
  assert.equal(JSON.parse(localStorage.getItem(STATE_KEY)!).settings.fontSize,'large','the change made while failing is saved now too')
})

test('v4→v5 near the storage quota: when the pre-upgrade copy does not fit, the original stays stored and downloadable until the first change',async()=>{
  signIn()
  const v4={...createInitialState(),schemaVersion:4}
  v4.employees=v4.employees.map(e=>e.id==='em1'?{...e,roleId:'role0'}:e)
  const raw=JSON.stringify(v4)
  localStorage.setItem(STATE_KEY,raw)
  localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(new Date().toISOString()))
  // Room for the working copy to be rewritten, not for a second full copy beside it.
  const used=()=>{let n=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)!;n+=k.length+(localStorage.getItem(k)||'').length}return n}
  const limit=used()+Math.floor(raw.length/2)
  proto.setItem=function(this:Storage,k:string,v:string){const old=localStorage.getItem(k);if(used()-(old===null?0:k.length+old.length)+k.length+v.length>limit)throw new DOMException('full','QuotaExceededError');return nativeSetItem.call(this,k,v)}
  await mountRaw('/settings?view=system')
  await flush(400)
  window.dispatchEvent(new Event('pagehide'))
  await flush(60)
  assert.equal(localStorage.getItem('zenix-manufacturing-before-v5'),null,'the pre-upgrade copy did not fit')
  assert.equal(localStorage.getItem(STATE_KEY),raw,'the v4 original is not written over by the load, the save timer or the close flush')
  assert.ok(text().includes('Asl ma’lumot o‘zgartirilmadi'),'the user is told the original is held and where to download it')
  assert.ok(text().includes('Asl ma’lumot (brauzerda nusxasi saqlanmadi)'),'the original is listed under Tiklash nusxalari')
})

/** Opens the new-customer dialog on Sales, types a name and presses save. */
async function submitCustomer(name:string){
  if(!dialog()){
    await click([...document.querySelectorAll<HTMLButtonElement>('main button')].find(b=>/Yangi mijoz|Mijoz qo/.test(b.textContent||''))!)
    await flush()
    await type(dialog()!.querySelector<HTMLInputElement>('input')!,name)
    const phone=[...dialog()!.querySelectorAll<HTMLInputElement>('input')].find(i=>/tel|phone|\+998/i.test(i.type+i.placeholder+i.name))
    if(phone)await type(phone,'+998901112233')
  }
  await click([...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(b=>/Saqlash|Yaratish|Qo‘shish/.test(b.textContent||''))!)
  await flush(60)
}
const storedCustomers=(name:string)=>(JSON.parse(localStorage.getItem(STATE_KEY)!).customers as {name:string}[]).filter(c=>c.name===name).length

test('audit #9: an action whose save fails is undone, reported and its form stays open; retrying applies it once',async()=>{
  await mountApp('/sales?view=customers')
  proto.setItem=function(this:Storage,k:string,v:string){if(k===STATE_KEY)throw new DOMException('full','QuotaExceededError');return nativeSetItem.call(this,k,v)}
  await submitCustomer('Saqlanmagan Mijoz')
  assert.ok(dialog(),'the form is not closed as if it had been saved')
  assert.ok(text().includes('Saqlanmadi'),'the user is told it was not saved')
  assert.ok(!text().replace(dialog()!.textContent||'','').includes('Saqlanmagan Mijoz'),'the record is not shown as created')
  assert.equal(storedCustomers('Saqlanmagan Mijoz'),0)
  proto.setItem=nativeSetItem
  await submitCustomer('Saqlanmagan Mijoz')
  assert.equal(dialog(),null,'saving works again: the form closes')
  assert.equal(storedCustomers('Saqlanmagan Mijoz'),1,'the retry creates it exactly once')
})

test('audit #8: data saved by a newer app version opens read-only — nothing is written, export is offered, no clean start',async()=>{
  signIn()
  const raw=JSON.stringify({...createInitialState(),schemaVersion:SCHEMA_VERSION+1,futureList:[{id:'f1'}]})
  localStorage.setItem(STATE_KEY,raw)
  await mountRaw('/')
  assert.ok(text().includes('Ma’lumotlarni tiklash')&&text().includes('yangiroq versiyasida'),'the recovery screen explains why')
  assert.ok(byText('Nusxani yuklab olish'),'the original can be exported')
  assert.equal(byText('Toza holatda ochish'),null,'no way to replace it from this build')
  window.dispatchEvent(new Event('pagehide'))
  await flush(400)
  assert.equal(localStorage.getItem(STATE_KEY),raw,'not downgraded by saves or the close flush')
})

test('audit #8: when another tab of a newer version saves, this tab stops writing instead of overwriting it',async()=>{
  await mountApp('/sales?view=customers')
  const newer=JSON.parse(localStorage.getItem(STATE_KEY)!)
  newer.schemaVersion=SCHEMA_VERSION+1
  const raw=JSON.stringify(newer)
  nativeSetItem.call(localStorage,STATE_KEY,raw)
  await submitCustomer('Eski Tab Mijozi')
  assert.equal(localStorage.getItem(STATE_KEY),raw,'the newer data is left exactly as it was')
  assert.ok(text().includes('yangiroq versiyasida'),'this tab switches to the read-only recovery screen')
})

test('a preference change continues from another tab’s newer save instead of overwriting it',async()=>{
  await mountApp('/settings?view=appearance')
  // Another tab adds a customer and saves (no storage event reaches this tab yet).
  const other=JSON.parse(localStorage.getItem(STATE_KEY)!)
  other.customers.push({...other.customers[0],id:'cu-other-tab',name:'Boshqa tab mijozi'})
  nativeSetItem.call(localStorage,STATE_KEY,JSON.stringify(other))
  await click(byText('Katta',`[aria-label="Shrift o‘lchami"] button`))
  await flush(400)
  const saved=JSON.parse(localStorage.getItem(STATE_KEY)!)
  assert.ok(saved.customers.some((c:{id:string})=>c.id==='cu-other-tab'),'the other tab’s customer survives')
  assert.equal(saved.settings.fontSize,'large','and this tab’s change is saved')
})

test('a malformed stored session is not restored: the user is sent to sign in',async()=>{
  signIn()
  const session=JSON.parse(localStorage.getItem(SESSION_KEY)!)
  delete session.expiresAt
  localStorage.setItem(SESSION_KEY,JSON.stringify(session))
  localStorage.setItem(STATE_KEY,JSON.stringify(createInitialState()))
  await mountRaw('/production')
  assert.ok(location.current===''||!text().includes('Ishlab chiqarish ·'),'no page opens without a valid session')
  assert.ok(text().includes('Tizimga kirish'),'the sign-in page is shown')
})

test('an unknown record id in a deep link does not break the page',async()=>{
  await mountApp('/sales?view=orders&id=does-not-exist')
  assert.ok(!text().includes('Sahifada xatolik'),'no page error')
  assert.ok(document.querySelector('main h1'),'the page renders')
})

function Boom():never{throw new Error('render failed: secret stack detail')}

test('root boundary: a crash outside the pages shows a plain recovery card, no technical detail',async()=>{
  const original=console.error;console.error=()=>{}
  try{
    localStorage.setItem(STATE_KEY,'{"keep":true}')
    await render(<RootBoundary><Boom/></RootBoundary>)
    assert.ok(text().includes('Ilovada kutilmagan xatolik'))
    assert.ok(!text().includes('secret stack detail'),'the error message is not shown to the user')
    assert.ok(byText('Qayta yuklash')&&byText('Ma’lumot nusxasini yuklab olish'),'reload and a copy of the saved data are offered')
  }finally{console.error=original}
})
