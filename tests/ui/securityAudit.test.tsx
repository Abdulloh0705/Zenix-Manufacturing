// Security audit (2026-11-14), UI provider: a permission narrowed in another tab no longer authorises an action here,
// the activity archive is read through the role's scope, and signed tickets are typed into masked fields. Each case
// failed against the code before its fix (SEC-11, SEC-12, SEC-13 in docs/BUG_REGISTRY.md).
import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryRouter} from 'react-router-dom'
import {AppProvider,useApp} from '../../src/app/providers/AppProvider/AppContext'
import PlatformPage from '../../src/features/platform/PlatformPage'
import type {ActionResult} from '../../src/types'
import {STATE_KEY,seedState,signIn} from './appFixture'
import {byText,cleanup,click,flush,render} from './helpers'

afterEach(async()=>{await cleanup();localStorage.clear();sessionStorage.clear()})

type Probe=typeof window&{secResult?:ActionResult;secArchive?:string[]}
const probe=window as Probe

function Actions({name}:{name:string}){
  const app=useApp()
  return <div>
    <button type="button" onClick={()=>{probe.secResult=app.createEntity('customers',{name,phone:'',email:'',address:'',debt:0,status:'Faol'})}}>Create customer</button>
    <button type="button" onClick={()=>{probe.secArchive=app.activityArchive().map(a=>a.id)}}>Read archive</button>
  </div>
}
async function mount(employeeId:string,name='Yangi mijoz'){
  signIn(employeeId)
  await render(<MemoryRouter><AppProvider><Actions name={name}/></AppProvider></MemoryRouter>)
  await flush(60)
}
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)||'{}')

test('SEC-11: a role narrowed in another tab cannot still authorise a generic write in this tab',async()=>{
  const SELLER={id:'role-sec-sales',name:'Sotuvchi',scope:'all',description:'',permissions:{sales:{view:true,create:true,edit:true}}}
  seedState(s=>({...s,roles:[...s.roles,SELLER],employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e.id==='em2'?{...e,roleId:SELLER.id}:e)}))
  await mount('em2','Birinchi mijoz')
  await click(byText('Create customer'))
  assert.equal(probe.secResult?.ok,true,`control: the right is held — ${probe.secResult?.message}`)
  assert.ok(stored().customers.some((c:{name:string})=>c.name==='Birinchi mijoz'))
  // Another tab (an administrator) removes sales.create and saves; no storage event has reached this tab yet.
  const narrowed=stored()
  narrowed.roles=narrowed.roles.map((r:{id:string;permissions:Record<string,Record<string,boolean>>})=>r.id===SELLER.id?{...r,permissions:{sales:{view:true}}}:r)
  narrowed.customers=narrowed.customers.map((c:{name:string})=>c.name==='Birinchi mijoz'?{...c,name:'Birinchi mijoz (tahrir)'}:c)
  localStorage.setItem(STATE_KEY,JSON.stringify(narrowed))
  probe.secResult=undefined
  await click(byText('Create customer'))
  await flush(20)
  assert.equal(probe.secResult?.ok,false,'the narrowed role refuses the write')
  assert.match(probe.secResult?.message||'',/ruxsat/)
  assert.equal(stored().customers.filter((c:{name:string})=>c.name.startsWith('Birinchi mijoz')).length,1,'no second customer was saved')
  assert.ok(stored().customers.some((c:{name:string})=>c.name==='Birinchi mijoz (tahrir)'),'the other tab’s save is kept')
})

test('SEC-12: the activity archive shows a site-bound role only its own site’s history, like the live feed',async()=>{
  const AUDITOR={id:'role-sec-audit',name:'Chirchiq auditor',scope:'workcenter',description:'',permissions:{audit:{view:true},production:{view:true}}}
  seedState(s=>({...s,roles:[...s.roles,AUDITOR],employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e.id==='em7'?{...e,roleId:AUDITOR.id}:e)}))
  const entry=(id:string,userId:string,user:string)=>({id,date:'2026-10-01 08:00',user,userId,action:'Eski yozuv',module:'Ishlab chiqarish',severity:'info'})
  localStorage.setItem('zenix-activity-archive-v1',JSON.stringify([entry('arc-b1','em2','Toshkent menejeri'),entry('arc-b2','em7','Chirchiq operatori')]))
  await mount('em7')
  await click(byText('Read archive'))
  assert.deepEqual(probe.secArchive,['arc-b2'],'branch b1 history stays out of the Chirchiq auditor’s log')
  await cleanup();localStorage.clear()
  seedState(s=>({...s,employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)}))
  localStorage.setItem('zenix-activity-archive-v1',JSON.stringify([entry('arc-b1','em2','Toshkent menejeri'),entry('arc-b2','em7','Chirchiq operatori')]))
  await mount('em1')
  await click(byText('Read archive'))
  assert.deepEqual(probe.secArchive?.sort(),['arc-b1','arc-b2'],'a company-wide owner still reads all of it')
})

test('SEC-13: the platform sign-in ticket is typed into a masked field',async()=>{
  await render(<MemoryRouter initialEntries={['/platform']}><PlatformPage publicKey="demo-public-key"/></MemoryRouter>)
  await flush(40)
  const label=[...document.querySelectorAll('label')].find(l=>l.textContent?.startsWith('Imzolangan chipta'))
  assert.equal(label?.querySelector('input')?.getAttribute('type'),'password')
  assert.equal(label?.querySelector('input')?.getAttribute('autocomplete'),'off')
})
