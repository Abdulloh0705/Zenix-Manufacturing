import './setup'
import {byText,cleanup,click,flush,render} from './helpers'
import {STATE_KEY,location,mountApp,seedState,signIn} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryRouter} from 'react-router-dom'
import App from '../../src/App'
import {AppProvider} from '../../src/app/providers/AppProvider/AppContext'
import {RootBoundary} from '../../src/app/RootBoundary'
import {createInitialState} from '../../src/data/mockData'

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
