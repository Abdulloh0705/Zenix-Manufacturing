import './setup'
import {byText,cleanup,click,flush,render,type} from './helpers'
import {STATE_KEY} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react'
import {MemoryRouter,useLocation} from 'react-router-dom'
import App from '../../src/App'
import {AppProvider} from '../../src/app/providers/AppProvider/AppContext'
import {createInitialState} from '../../src/data/mockData'
import {makeCredential} from '../../src/shared/lib/crypto'

// Public business registration as a new customer meets it: entry point on Login, platform policy, phone identity,
// duplicates and isolation from the company already in this browser.
const AUTH_KEY='zenix-auth-v1',SAAS_KEY='zenix-saas-v1',PLATFORM_KEY='zenix-platform-v1',PASSWORD='Egasi2026x'
const text=()=>document.body.textContent||''
const input=(id:string)=>document.getElementById(id)
let path=''
function Probe(){path=useLocation().pathname;return null}
afterEach(cleanup)

async function open(at='/'){
  await render(<MemoryRouter initialEntries={[at]}><AppProvider><App/><Probe/></AppProvider></MemoryRouter>)
  await flush(60)
}
async function until(done:()=>boolean){
  for(let i=0;i<300&&!done();i++)await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  assert.ok(done(),`still waiting; page says: ${text().slice(0,240)}`)
}
async function existingCompany(){
  const state=createInitialState()
  state.employees=state.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)
  localStorage.setItem(STATE_KEY,JSON.stringify(state))
  localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(new Date().toISOString()))
  const owner={id:'acc-owner',employeeId:'em1',username:'boss',phone:'+998901112233',...await makeCredential(PASSWORD),status:'active',failedCount:0,mustChangePassword:false,createdAt:'2026-01-01T00:00:00.000Z'}
  localStorage.setItem(AUTH_KEY,JSON.stringify({version:1,accounts:[owner],policy:{},events:[],attempts:{}}))
}
const policy=(registration:'open'|'closed',defaultTrialDays=14)=>localStorage.setItem(PLATFORM_KEY,JSON.stringify({version:1,settings:{brandName:'ZENIX',supportEmail:'',supportPhone:'',defaultTrialDays,graceDays:7,registration},audit:[],tickets:[]}))
async function fill(p:{name?:string;company?:string;phone?:string;username?:string;password?:string}){
  await type(input('register-name'),p.name??'Yangi Egasi')
  await type(input('register-company'),p.company??'Factory N')
  await type(input('register-phone'),p.phone??'+998 93 777 88 99')
  await type(input('register-username'),p.username??'new.owner')
  await type(input('register-password'),p.password??'Yangi2026x')
  await type(input('register-confirm'),p.password??'Yangi2026x')
  await click(byText('Kompaniyani ro‘yxatdan o‘tkazish'))
}

test('Login offers “Yangi biznes yaratish”; Register has no role choice and states the trial policy',async()=>{
  await existingCompany()
  await open('/login')
  const cta=byText('Yangi biznes yaratish','a')
  assert.ok(cta,'business registration entry point is visible on Login')
  await click(cta)
  assert.equal(path,'/register')
  assert.equal(document.querySelector('#auth-title')?.textContent,'Yangi biznes yaratish')
  assert.ok(text().includes('14 kunlik demo sinov'))
  for(const id of ['register-name','register-company','register-phone','register-username','register-email','register-password','register-confirm'])assert.ok(input(id),id)
  assert.equal([...document.querySelectorAll('label')].some(l=>/^Rol\b/.test(l.textContent||'')),false,'no role selection on public registration')
  assert.ok(text().includes('Rol tanlanmaydi'))
})

test('closed platform policy: Login explains instead of linking, Register refuses; a fresh browser can still set up',async()=>{
  await existingCompany()
  policy('closed')
  await open('/login')
  assert.equal(byText('Yangi biznes yaratish','a'),null)
  assert.equal(document.querySelector('.auth-tabs'),null)
  assert.ok(text().includes('Yangi biznes ro‘yxati hozircha platforma tomonidan yopilgan'))
  await cleanup()
  await existingCompany();policy('closed')
  await open('/register')
  assert.equal(input('register-name'),null,'no form while registration is closed')
  assert.ok(text().includes('vaqtincha yopilgan'))
  await cleanup()
  policy('closed')
  await open('/register')
  assert.ok(input('register-phone'),'first company of a browser is not blocked by the platform policy')
})

test('a new company gets the configured trial, an owner-only account, its own ERP state, and the owner signs in by phone',async()=>{
  await existingCompany()
  policy('open',21)
  const original=localStorage.getItem(STATE_KEY)
  await open('/register')
  assert.ok(text().includes('21 kunlik demo sinov'))
  await fill({})
  await until(()=>text().includes('Tiklash kalitini saqlang'))
  const saas=JSON.parse(localStorage.getItem(SAAS_KEY)||'{}'),auth=JSON.parse(localStorage.getItem(AUTH_KEY)||'{}')
  const tenant=saas.tenants.find((t:{name:string})=>t.name==='Factory N')
  const sub=saas.subscriptions.find((s:{tenantId:string})=>s.tenantId===tenant.id)
  assert.equal(sub.status,'trial');assert.equal(sub.planId,'enterprise')
  assert.equal(Math.round((Date.parse(sub.endsAt)-Date.parse(sub.startsAt))/86400000),21)
  const account=auth.accounts.find((a:{username:string})=>a.username==='new.owner')
  assert.equal(account.phone,'+998937778899');assert.equal(account.tenantId,tenant.id)
  const state=JSON.parse(localStorage.getItem(`zenix-erp-${tenant.id}-state`)||'{}')
  const role=state.roles.find((r:{id:string})=>r.id===state.employees[0].roleId)
  assert.equal(role.key,'business_owner');assert.equal(state.employees.length,1)
  assert.equal(state.roles.some((r:{key?:string})=>r.key==='super_admin'),false)
  assert.equal(Object.keys(role.permissions).includes('platform')&&role.permissions.platform.length>0,false,'no platform permission')
  assert.equal(localStorage.getItem(STATE_KEY),original,'existing company ERP untouched')
  await click(byText('Kalitni xavfsiz joyga saqladim','label'))
  await click(byText('Davom etish'))
  await flush(60)
  assert.equal(path,'/login')
  await type(input('login-name'),'93 777 88 99')
  await type(input('login-password'),'Yangi2026x')
  await click(byText('Kirish'))
  await until(()=>path==='/')
  assert.equal(JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId,tenant.id)
})

test('duplicate login or phone and invalid input are refused without writing anything',async()=>{
  await existingCompany()
  await open('/register')
  await flush(40)
  const before={saas:localStorage.getItem(SAAS_KEY),auth:localStorage.getItem(AUTH_KEY)}
  await fill({phone:'12'})
  assert.ok(text().includes('Telefon raqami noto‘g‘ri'))
  await fill({username:'boss'})
  await until(()=>text().includes('Bu login yoki e-pochta band'))
  await fill({username:'other.owner',phone:'+998 90 111 22 33'})
  await until(()=>text().includes('Bu telefon raqami boshqa akkauntda'))
  await fill({username:'third.owner',phone:'+998 95 000 00 01',password:'qisqa'})
  assert.ok(text().includes('kamida 8'))
  assert.equal(localStorage.getItem(SAAS_KEY),before.saas)
  assert.equal(localStorage.getItem(AUTH_KEY),before.auth)
})
