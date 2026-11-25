import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react'
import {MemoryRouter} from 'react-router-dom'
import {AppProvider,useApp} from '../../src/app/providers/AppProvider/AppContext'
import App from '../../src/App'
import PlatformPage,{PLATFORM_SECTIONS,platformTicketLive,verifyPlatformAccess} from '../../src/features/platform/PlatformPage'
import {createSeedState} from '../../src/data/mockData'
import {byText,click,cleanup,flush,key,render,type} from './helpers'

afterEach(async()=>{await cleanup();sessionStorage.clear()})

const legacy='tenant-legacy-v3',second='tenant-11111111-2222-4333-8444-555555555555'
const saasOf=()=>JSON.parse(localStorage.getItem('zenix-saas-v1')||'null')
const platformOf=()=>JSON.parse(localStorage.getItem('zenix-platform-v1')||'null')
const text=()=>document.body.textContent||''
const heading=()=>document.querySelector('.pf-title h1')?.textContent

async function keys(){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
  const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')
  const ticket=async(actor:string,expiresAt=Date.now()+30*60000,purpose='zenix-platform-v1')=>`ZXR1.${expiresAt}.${Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(`${purpose}|${actor}|${expiresAt}`))).toString('base64url')}`
  return {publicKey,ticket}
}
function seedMetadata(){
  const now=new Date(),at=now.toISOString(),end=new Date(now.getTime()+3*86400000).toISOString()
  const metadata={version:1,
    tenants:[{id:legacy,name:'Factory A',status:'active',ownerAccountId:'owner-a',createdAt:at},{id:second,name:'Factory B',status:'active',ownerAccountId:'owner-b',createdAt:at}],
    memberships:[{id:'ma',tenantId:legacy,accountId:'owner-a',employeeId:'em1',status:'active',createdAt:at},{id:'mb',tenantId:second,accountId:'owner-b',employeeId:'em1',status:'active',createdAt:at}],
    subscriptions:[{id:'sa',tenantId:legacy,planId:'plus',status:'active',startsAt:at},{id:'sb',tenantId:second,planId:'enterprise',status:'trial',startsAt:at,endsAt:end}],events:[]}
  localStorage.setItem('zenix-saas-v1',JSON.stringify(metadata))
  localStorage.setItem('zenix-auth-v1',JSON.stringify({version:1,accounts:[{id:'owner-a',employeeId:'em1',username:'owner.a',email:'owner@factory-a.uz',hash:'SECRET-HASH',salt:'SECRET-SALT',iterations:1,status:'active',failedCount:0,mustChangePassword:false,createdAt:at}],policy:{},events:[],attempts:{}}))
  localStorage.setItem('zenix-manufacturing-v3-state','{"keep":"this private ERP data"}')
}
function ownerWorkspace(suspended=false){
  seedMetadata()
  const s=createSeedState();s.employees=s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)
  localStorage.setItem('zenix-manufacturing-v3-state',JSON.stringify(s))
  localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(new Date().toISOString()))
  const at=new Date().toISOString()
  localStorage.setItem('zenix-session-v1',JSON.stringify({id:'ses',accountId:'owner-a',employeeId:'em1',tenantId:legacy,startedAt:at,lastActivity:at,expiresAt:new Date(Date.now()+86400000).toISOString(),remember:true}))
  if(suspended){const meta=saasOf();meta.tenants[0].status='suspended';localStorage.setItem('zenix-saas-v1',JSON.stringify(meta))}
}
/** Signs in by storing a valid session; the page re-verifies its signature on mount. */
async function openPlatform(path='/platform',actor='platform.operator'){
  const {publicKey,ticket}=await keys()
  sessionStorage.setItem('zenix-platform-session-v1',JSON.stringify({actor,ticket:await ticket(actor)}))
  await render(<MemoryRouter initialEntries={[path]}><PlatformPage publicKey={publicKey}/></MemoryRouter>)
  await flush(80)
}
async function choose(el:Element|null,value:string){
  if(!el)throw new Error('choose: element not found')
  const select=el as HTMLSelectElement
  await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select),'value')!.set!.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}))})
}
const field=(label:string)=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent?.replace('*','').trim()===label);return l?document.getElementById(l.htmlFor):null}
const tableRows=(index:number)=>[...document.querySelectorAll('.pf-table')[index].querySelectorAll('tbody tr')]

test('platform ticket is bound to operator, signature, purpose and expiry',async()=>{
  const {publicKey,ticket}=await keys()
  const expiresAt=Date.now()+60000,actor='operator.one',valid=await ticket(actor,expiresAt)
  assert.equal(await verifyPlatformAccess(actor,valid,Date.now(),publicKey),true)
  assert.equal(await verifyPlatformAccess('other.operator',valid,Date.now(),publicKey),false)
  assert.equal(await verifyPlatformAccess(actor,valid,expiresAt+1,publicKey),false)
  assert.equal(platformTicketLive(valid,expiresAt+1),false)
  assert.equal(await verifyPlatformAccess(actor,await ticket(actor,expiresAt,'zenix-recovery-v1'),Date.now(),publicKey),false)
  const tampered=valid.slice(0,-2)+(valid.endsWith('AA')?'BB':'AA')
  assert.equal(await verifyPlatformAccess(actor,tampered,Date.now(),publicKey),false,'modified ticket rejected')
})

test('expired platform session removes company metadata while the page stays open and logs the expiry',async()=>{
  seedMetadata()
  const {publicKey,ticket}=await keys()
  const actor='platform.operator',expiresAt=Date.now()+60000
  await render(<MemoryRouter initialEntries={['/platform/companies']}><PlatformPage publicKey={publicKey}/></MemoryRouter>)
  const fields=document.querySelectorAll('.platform-page .ui-input')
  await type(fields[0],actor);await type(fields[1],await ticket(actor,expiresAt));await click(byText('Platformaga kirish'));await flush(80)
  assert.ok(text().includes('Factory A'))
  const originalNow=Date.now
  try{Date.now=()=>expiresAt+1;await flush(1100)}finally{Date.now=originalNow}
  assert.ok(text().includes('Platform administrator kirishi'))
  assert.equal(text().includes('Factory A'),false)
  assert.deepEqual(platformOf().audit.slice(0,2).map((a:{action:string})=>a.action),['session.expired','session.start'])
})

test('a forged platform session or a signed-in Business Owner cannot open the platform workspace',async()=>{
  sessionStorage.setItem('zenix-platform-session-v1',JSON.stringify({actor:'forged',ticket:'invalid'}))
  await render(<MemoryRouter initialEntries={['/platform/companies']}><AppProvider><App/></AppProvider></MemoryRouter>)
  await flush(80)
  assert.ok(text().includes('Platform administrator kirishi'))
  assert.equal(text().includes('Platforma ko‘rinishi'),false)
  assert.equal(sessionStorage.getItem('zenix-platform-session-v1'),null,'invalid session is discarded')
  await cleanup()
  ownerWorkspace()
  await render(<MemoryRouter initialEntries={['/platform']}><AppProvider><App/></AppProvider></MemoryRouter>)
  await flush(80)
  assert.ok(text().includes('Platform administrator kirishi'))
  assert.equal(document.querySelector('.pf-nav-item'),null)
})

test('a valid platform session grants no tenant workspace or manufacturing permission; suspension blocks the tenant',async()=>{
  seedMetadata()
  const {ticket}=await keys()
  sessionStorage.setItem('zenix-platform-session-v1',JSON.stringify({actor:'platform.operator',ticket:await ticket('platform.operator')}))
  let probe:{signedIn:boolean;production:boolean;tenant:string|null}|null=null
  function Probe(){const app=useApp();probe={signedIn:app.auth.signedIn,production:app.can('production','create'),tenant:app.saas.tenant?.id||null};return null}
  await render(<MemoryRouter><AppProvider><Probe/></AppProvider></MemoryRouter>)
  await flush(60)
  assert.deepEqual(probe,{signedIn:false,production:false,tenant:null})
  await cleanup()
  ownerWorkspace()
  await render(<MemoryRouter><AppProvider><Probe/></AppProvider></MemoryRouter>)
  await flush(60)
  assert.equal(probe!.tenant,legacy);assert.equal(probe!.production,true)
  await cleanup()
  ownerWorkspace(true)
  await render(<MemoryRouter><AppProvider><Probe/></AppProvider></MemoryRouter>)
  await flush(60)
  assert.equal(probe!.tenant,null);assert.equal(probe!.production,false)
})

test('navigation reaches every platform section and unknown paths show a not-found state',async()=>{
  seedMetadata()
  await openPlatform()
  assert.equal(PLATFORM_SECTIONS.length,10)
  assert.equal(document.querySelectorAll('.pf-nav-item').length,10)
  assert.ok(document.querySelector('nav[aria-label="Platforma bo‘limlari"]'))
  assert.ok(document.querySelector('button.pf-menu[aria-controls="pf-nav"][aria-expanded="false"]'),'mobile menu toggle is labelled')
  for(const s of PLATFORM_SECTIONS){
    await click([...document.querySelectorAll('.pf-nav-item')].find(a=>a.textContent===s.label)!)
    await flush(20)
    assert.equal(heading(),s.label)
    assert.equal(document.querySelector('.pf-nav-item[aria-current="page"]')?.textContent,s.label)
    assert.equal(text().includes('Bo‘lim topilmadi'),false)
  }
  await cleanup();seedMetadata()
  await openPlatform('/platform/unknown')
  assert.ok(text().includes('Bo‘lim topilmadi'))
})

test('overview shows derived counts and no fabricated revenue, uptime or latency values',async()=>{
  seedMetadata()
  await openPlatform()
  const kpi=(label:string)=>[...document.querySelectorAll('.kpi')].find(k=>k.querySelector('.kpi-label')?.textContent===label)?.querySelector('strong')?.textContent
  assert.equal(kpi('Jami kompaniyalar'),'2');assert.equal(kpi('Faol kompaniyalar'),'2');assert.equal(kpi('Sinovda'),'1');assert.equal(kpi('Faol a’zoliklar'),'2')
  assert.ok(text().includes('Factory B'),'trial ending in 3 days is listed')
  assert.ok(text().includes('Backend kerak'))
  assert.equal(/\$|so‘m|99\.9|\d\s?ms\b/.test(document.querySelector('.pf-content')!.textContent||''),false)
  await cleanup()
  await openPlatform()
  assert.ok(text().includes('Hali kompaniya ro‘yxatdan o‘tmagan'),'empty state without metadata')
})

test('companies: search, filter, owner privacy, suspend with reason, duplicate protection, ERP data untouched',async()=>{
  seedMetadata()
  const erp=localStorage.getItem('zenix-manufacturing-v3-state')
  await openPlatform('/platform/companies')
  await type(document.querySelector('input[aria-label="Kompaniyani qidirish"]'),'factory b')
  assert.equal(tableRows(0).length,1)
  await type(document.querySelector('input[aria-label="Kompaniyani qidirish"]'),'')
  await choose(document.querySelector('select[aria-label="Obuna filtri"]'),'trial')
  assert.deepEqual(tableRows(0).map(r=>r.querySelector('b')?.textContent),['Factory B'])
  await click(byText('Filtrlarni tozalash'))
  await click([...document.querySelectorAll('.pf-link')].find(b=>b.textContent?.includes('Factory A'))!)
  assert.ok(text().includes('owner.a · o••••@factory-a.uz'),'owner email masked')
  assert.equal(text().includes('owner@factory-a.uz'),false)
  assert.equal(text().includes('SECRET-HASH')||text().includes('SECRET-SALT'),false)
  await click(byText('Kompaniyani to‘xtatish'))
  assert.equal(byText('To‘xtatish')!.hasAttribute('disabled'),true,'reason required')
  await type(document.querySelector('.entity-modal textarea'),'password: supersecret')
  assert.equal(byText('To‘xtatish')!.hasAttribute('disabled'),true,'secret-like reason cannot reach audit')
  await type(document.querySelector('.entity-modal textarea'),'Policy review')
  await click(byText('To‘xtatish'))
  await flush(80)
  const saved=saasOf()
  assert.equal(saved.tenants[0].status,'suspended');assert.equal(saved.tenants[0].suspensionReason,'Policy review')
  assert.equal(saved.events.length,1)
  const audit=platformOf().audit[0]
  assert.equal(audit.action,'tenant.suspend');assert.equal(audit.actor,'platform.operator');assert.equal(audit.saasEventId,saved.events[0].id)
  assert.equal(localStorage.getItem('zenix-manufacturing-v3-state'),erp)
  assert.ok(byText('Kompaniyani qayta faollashtirish'),'drawer now offers reactivation, not a second suspension')
})

test('subscription override records grace with a policy end date and audit; trial is not offered',async()=>{
  seedMetadata()
  await openPlatform('/platform/subscriptions')
  await click(tableRows(1)[0].querySelector('button'))
  const modal=document.querySelector('.entity-modal')!
  assert.equal([...modal.querySelectorAll('option')].some(o=>(o as HTMLOptionElement).value==='trial'),false)
  await choose(field('Obuna holati'),'grace')
  await type(modal.querySelector('textarea'),'password: supersecret')
  assert.equal(byText('Davom etish')!.hasAttribute('disabled'),true,'unsafe override reason is blocked')
  await type(modal.querySelector('textarea'),'Payment promised by phone')
  await click(byText('Davom etish'));await click(byText('Override yozish'));await flush(80)
  const sub=saasOf().subscriptions.at(-1)
  assert.equal(sub.status,'grace');assert.ok(Date.parse(sub.endsAt)>Date.now())
  assert.equal(platformOf().audit[0].action,'subscription.override')
  assert.ok(text().includes('Bu to‘lov tasdig‘i emas'))
})

test('feature restriction is audited and removes only the plan entitlement',async()=>{
  seedMetadata()
  await openPlatform('/platform/features')
  const row=tableRows(1).find(r=>r.textContent?.startsWith('Sotuv'))!
  await click(row.querySelector('button'))
  await type(document.querySelector('.entity-modal textarea'),'Contract dispute')
  await click(byText('O‘chirish','.entity-modal button'));await flush(80)
  const f=saasOf().featureOverrides
  assert.equal(f.length,1);assert.equal(f[0].module,'sales');assert.equal(f[0].state,'disabled')
  assert.equal(platformOf().audit[0].action,'feature.disable')
  assert.equal(tableRows(1).find(r=>r.textContent?.startsWith('Sozlamalar'))!.querySelector('button'),null,'core module has no switch')
})

test('settings validate input, require a reason for sensitive changes and record the diff',async()=>{
  seedMetadata()
  await openPlatform('/platform/settings')
  await type(field('Sinov muddati (kun)'),'0')
  await click(byText('Saqlash'))
  assert.ok(text().includes('Sinov muddati 1–60 kun'))
  assert.equal(document.querySelector('.entity-modal'),null,'invalid form does not open confirmation')
  await type(field('Sinov muddati (kun)'),'30')
  await click(byText('Saqlash'))
  assert.equal(document.querySelector('.entity-modal'),null,'sensitive change needs a reason first')
  await type(field('O‘zgarish sababi'),'password: supersecret')
  await click(byText('Saqlash'))
  assert.equal(document.querySelector('.entity-modal'),null,'unsafe settings reason is blocked')
  await type(field('O‘zgarish sababi'),'Pilot customers')
  await click(byText('Saqlash'))
  assert.ok(document.querySelector('.entity-modal')?.textContent?.includes('14 → 30'))
  await click(byText('Saqlash','.entity-modal button'));await flush(80)
  assert.equal(platformOf().settings.defaultTrialDays,30)
  const a=platformOf().audit[0]
  assert.equal(a.action,'settings.update');assert.equal(a.reason,'Pilot customers');assert.match(a.detail,/defaultTrialDays: 14 → 30/)
  assert.equal(saasOf().subscriptions.length,2,'existing subscriptions untouched')
})

test('support ticket workflow: create, update status, history, secrets rejected',async()=>{
  seedMetadata()
  await openPlatform('/platform/support')
  assert.ok(text().includes('Murojaat hali yo‘q'))
  await click(byText('Yangi murojaat'))
  await choose(field('Kompaniya'),second)
  await type(field('Mavzu'),'Cannot add employee')
  await type(field('Izoh'),'password: hunter2')
  await click(byText('Yaratish'));await flush(60)
  assert.equal(platformOf()?.tickets?.length||0,0,'secret-like note rejected, nothing stored')
  await type(field('Izoh'),'Owner reports limit message')
  await click(byText('Yaratish'));await flush(60)
  assert.equal(platformOf().tickets.length,1)
  await click([...document.querySelectorAll('.pf-link')].find(b=>b.textContent==='Cannot add employee')!)
  await choose(field('Holatni o‘zgartirish'),'in_progress')
  await click(byText('Saqlash','.drawer button'));await flush(60)
  const t=platformOf().tickets[0]
  assert.equal(t.status,'in_progress');assert.equal(t.tenantId,second)
  assert.deepEqual(platformOf().audit.slice(0,2).map((a:{action:string})=>a.action),['ticket.update','ticket.create'])
  assert.equal(saasOf().events.length,0,'support never writes company metadata')
})

test('system health reports browser diagnostics only and marks server metrics unavailable',async()=>{
  seedMetadata()
  await openPlatform('/platform/health')
  await flush(40)
  assert.ok(text().includes('localStorage (yozish/o‘qish)'))
  assert.ok(text().includes('Ulanmagan'))
  assert.ok(text().includes('CPU, xotira, worker holati'))
  assert.equal(/\d+\s?%\s*(CPU|uptime)|\d+\s?ms\b/i.test(text()),false)
})

test('an expired ticket at write time signs out and leaves company metadata unchanged',async()=>{
  seedMetadata()
  const before=localStorage.getItem('zenix-saas-v1')
  await openPlatform('/platform/companies')
  await click([...document.querySelectorAll('.pf-link')].find(b=>b.textContent?.includes('Factory A'))!)
  await click(byText('Kompaniyani to‘xtatish'))
  await type(document.querySelector('.entity-modal textarea'),'Policy review')
  const originalNow=Date.now
  try{Date.now=()=>originalNow()+31*60000;await click(byText('To‘xtatish'));await flush(80)}finally{Date.now=originalNow}
  assert.equal(localStorage.getItem('zenix-saas-v1'),before)
  assert.ok(text().includes('Platform administrator kirishi'))
})

test('closed registration policy blocks a new company signup without touching existing tenants',async()=>{
  seedMetadata()
  localStorage.setItem('zenix-platform-v1',JSON.stringify({version:1,settings:{brandName:'ZENIX',supportEmail:'',supportPhone:'',defaultTrialDays:14,graceDays:7,registration:'closed'},audit:[],tickets:[]}))
  const before=localStorage.getItem('zenix-saas-v1')
  let result:{ok:boolean;message:string}|null=null
  function Signup(){const app=useApp();return <button type="button" onClick={async()=>{result=await app.setupSuperAdmin({employeeId:'em1',name:'New Owner',company:'Factory C',username:'new.owner',password:'StrongPassphrase-34!'})}}>Signup</button>}
  await render(<MemoryRouter><AppProvider><Signup/></AppProvider></MemoryRouter>)
  await flush(40)
  await click(byText('Signup'));await flush(80)
  assert.equal(result!.ok,false)
  assert.match(result!.message,/yopilgan/)
  assert.equal(localStorage.getItem('zenix-saas-v1'),before)
})

// ---------------------------------------------------------------- Super Admin completion
const storePlatform=(patch:Record<string,unknown>)=>localStorage.setItem('zenix-platform-v1',JSON.stringify({version:1,settings:{brandName:'ZENIX',supportEmail:'',supportPhone:'',defaultTrialDays:14,graceDays:7,registration:'open'},audit:[],tickets:[],...patch}))
const modalSave=()=>byText('Saqlash','.entity-modal button')!

test('companies: create explains the owner registration path; edit renames with validation, reason and linked audit',async()=>{
  seedMetadata()
  const erp=localStorage.getItem('zenix-manufacturing-v3-state')
  await openPlatform('/platform/companies')
  await click(byText('Yangi kompaniya'))
  const modal=document.querySelector('.entity-modal')!
  assert.ok(modal.textContent?.includes('/register'));assert.ok(modal.textContent?.includes('Backend kerak'),'invite is marked as backend work')
  assert.ok(modal.querySelector('a[href="/register"]'),'registration link while registration is open')
  await click(byText('Yopish'))
  assert.equal(document.querySelector('.entity-modal'),null)
  await click([...document.querySelectorAll('.pf-link')].find(b=>b.textContent?.includes('Factory A'))!)
  await click(byText('Tahrirlash'))
  const name=field('Platformadagi nomi')!,reason=()=>document.querySelector('.entity-modal textarea')
  await type(name,'factory b');await type(reason(),'Legal rename')
  assert.ok(text().includes('Bu nom boshqa kompaniyada ishlatilgan'));assert.equal(modalSave().hasAttribute('disabled'),true)
  await type(name,'Factory Alpha');await type(reason(),'token=abc123456')
  assert.equal(modalSave().hasAttribute('disabled'),true,'secret-like reason cannot reach audit')
  await type(reason(),'Legal rename')
  await click(modalSave());await flush(80)
  assert.equal(saasOf().tenants[0].name,'Factory Alpha')
  const a=platformOf().audit[0]
  assert.equal(a.action,'tenant.rename');assert.equal(a.detail,'Factory A → Factory Alpha');assert.equal(a.saasEventId,saasOf().events[0].id)
  assert.equal(localStorage.getItem('zenix-manufacturing-v3-state'),erp,'tenant ERP data untouched')
  assert.ok(document.querySelector('.pf-table')!.textContent!.includes('Factory Alpha'),'company list reflects the change')
  assert.ok(text().includes('Kompaniya nomi o‘zgardi'),'drawer history shows the audit entry')
})

test('companies table paginates and filters return to the first page',async()=>{
  seedMetadata()
  const meta=saasOf(),at=new Date().toISOString()
  for(let i=0;i<11;i++){const id=`tenant-${crypto.randomUUID()}`;meta.tenants.push({id,name:`Plant ${String(i).padStart(2,'0')}`,status:'active',ownerAccountId:`o-${i}`,createdAt:at})}
  localStorage.setItem('zenix-saas-v1',JSON.stringify(meta))
  await openPlatform('/platform/companies')
  assert.equal(tableRows(0).length,10);assert.ok(text().includes('1–10 / 13'))
  await click(document.querySelector('button[aria-label="Keyingi sahifa"]'))
  assert.equal(tableRows(0).length,3)
  await type(document.querySelector('input[aria-label="Kompaniyani qidirish"]'),'plant 1')
  assert.equal(tableRows(0).length,1,'filter result shown from page 1');assert.equal(document.querySelector('.pf-pager'),null)
})

test('audit journal: redacts planted secrets, filters, validates dates, paginates and opens a detail drawer',async()=>{
  seedMetadata()
  const audit=Array.from({length:30},(_,i)=>({id:`pa-${i}`,at:new Date(Date.now()-i*60000).toISOString(),actor:i%2?'op.two':'op.one',action:'ticket.update',targetType:'ticket',targetId:`t-${i}`,outcome:'success',detail:`entry ${i}`}))
  audit[0]={...audit[0],reason:'password: hunter22',outcome:'denied'} as typeof audit[0]
  storePlatform({audit})
  await openPlatform('/platform/audit')
  assert.equal(heading(),'Audit jurnali')
  assert.equal(text().includes('hunter22'),false,'planted secret is never rendered');assert.ok(text().includes('[maxfiy qiymat yashirildi]'))
  assert.equal(tableRows(0).length,25);assert.ok(text().includes('1–25 / 30'))
  await click(document.querySelector('button[aria-label="Keyingi sahifa"]'))
  assert.equal(tableRows(0).length,5)
  await choose(document.querySelector('select[aria-label="Operator filtri"]'),'op.one')
  assert.equal(tableRows(0).length,15,'filter resets to page 1')
  await choose(document.querySelector('select[aria-label="Natija"]'),'denied')
  assert.equal(tableRows(0).length,1)
  await type(document.querySelector('input[aria-label="Auditni qidirish"]'),'hunter22')
  assert.equal(document.querySelectorAll('.pf-table').length,0,'secret value is not searchable')
  await click(byText('Filtrlarni tozalash'))
  await type(document.querySelector('input[aria-label="Sanadan"]'),'2030-01-02');await type(document.querySelector('input[aria-label="Sanagacha"]'),'2030-01-01')
  assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes('“Dan” sanasi'))
  await click(byText('Filtrlarni tozalash'))
  await click(document.querySelector('.pf-table .pf-link'))
  const drawer=document.querySelector('.drawer')!
  assert.ok(drawer.textContent?.includes('Audit yozuvi'));assert.ok(drawer.textContent?.includes('pa-0'));assert.equal(drawer.textContent?.includes('hunter22'),false)
  await click(byText('Shu operator amallari'))
  assert.equal((document.querySelector('select[aria-label="Operator filtri"]') as HTMLSelectElement).value,'op.one')
})

test('security: platform permissions stay separate from company roles; events and operators are listed',async()=>{
  seedMetadata()
  const at=(m:number)=>new Date(Date.now()-m*60000).toISOString()
  storePlatform({audit:[
    {id:'s1',at:at(1),actor:'platform.operator',action:'tenant.suspend',targetType:'tenant',targetId:legacy,tenantId:legacy,outcome:'denied'},
    {id:'s2',at:at(5),actor:'platform.operator',action:'session.start',targetType:'session',targetId:'platform',outcome:'success'},
    {id:'s3',at:at(9),actor:'other.operator',action:'ticket.create',targetType:'ticket',targetId:'t1',outcome:'success'},
  ]})
  await openPlatform('/platform/security')
  const matrix=document.querySelector('table[aria-label="Platforma ruxsatlari matritsasi"]')!
  const rows=[...matrix.querySelectorAll('tbody tr')]
  assert.equal(rows.find(r=>r.textContent?.startsWith('Kompaniya ERP'))!.textContent!.includes('Ruxsat'),false,'operator never gets ERP access')
  assert.equal(rows.every(r=>r.querySelectorAll('td')[2].textContent==='Yo‘q'),true,'Business Owner holds no platform capability')
  const events=document.querySelector('table[aria-label="Xavfsizlik hodisalari"]')!.textContent!
  assert.ok(events.includes('Operator kirdi'));assert.ok(events.includes('Rad etilgan'));assert.equal(events.includes('Murojaat yaratildi'),false)
  const ops=document.querySelector('table[aria-label="Platforma operatorlari"]')!.textContent!
  assert.ok(ops.includes('platform.operator · siz'));assert.ok(ops.includes('other.operator'))
})

test('support: KPI shortcuts, category filter and priority change with history and audit',async()=>{
  seedMetadata()
  await openPlatform('/platform/support')
  for(const [subject,category] of [['Billing question','billing'],['Login problem','account']]){
    await click(byText('Yangi murojaat'))
    await type(field('Mavzu'),subject);await choose(field('Toifa'),category)
    await click(byText('Yaratish'));await flush(60)
  }
  assert.equal(platformOf().tickets.length,2)
  await choose(document.querySelector('select[aria-label="Toifa"]'),'billing')
  assert.deepEqual(tableRows(0).map(r=>r.querySelector('.pf-link')?.textContent),['Billing question'])
  await click([...document.querySelectorAll('.pf-link')].find(b=>b.textContent==='Billing question')!)
  await choose(field('Ustuvorlik'),'urgent')
  await click(byText('Saqlash','.drawer button'));await flush(60)
  const t=platformOf().tickets.find((x:{subject:string})=>x.subject==='Billing question')
  assert.equal(t.priority,'urgent');assert.equal(t.notes.at(-1).kind,'priority')
  assert.equal(platformOf().audit[0].detail,'normal → urgent')
  assert.ok(text().includes('Ustuvorlik: normal → urgent'))
  await key(document,'Escape');await flush(20)
  await click([...document.querySelectorAll('button.kpi')].find(k=>k.querySelector('.kpi-label')?.textContent==='Jarayonda')!)
  assert.equal((document.querySelector('select[aria-label="Murojaat holati"]') as HTMLSelectElement).value,'in_progress')
  assert.ok(text().includes('Mos murojaat yo‘q'))
})

test('monitoring and overview show record-derived alerts; alert links open the focused subscription',async()=>{
  seedMetadata()
  await openPlatform('/platform/health')
  assert.equal(heading(),'Monitoring')
  assert.ok(text().includes('Factory B: sinov 3 kunda tugaydi'))
  await choose(document.querySelector('select[aria-label="Ogohlantirish darajasi"]'),'danger')
  assert.ok(text().includes('Bu darajada ogohlantirish yo‘q'))
  await choose(document.querySelector('select[aria-label="Ogohlantirish darajasi"]'),'all')
  await click(byText('Ochish','.pf-alerts a'));await flush(20)
  assert.equal(heading(),'Rejalar va obunalar')
  assert.equal((document.querySelector('input[aria-label="Obunani qidirish"]') as HTMLInputElement).value,'Factory B')
  assert.equal(tableRows(1).length,1);assert.ok(tableRows(1)[0].classList.contains('pf-focus'))
  await click([...document.querySelectorAll('.pf-nav-item')].find(a=>a.textContent==='Platforma ko‘rinishi')!)
  assert.ok(text().includes('Ogohlantirishlar'));assert.ok(text().includes('Ro‘yxatdan o‘tish dinamikasi'))
  assert.equal(/\$|so‘m|99\.9|\d\s?ms\b/.test(document.querySelector('.pf-content')!.textContent||''),false,'no fabricated money or latency')
})

test('features show the entitlement result; settings can load platform defaults for review',async()=>{
  seedMetadata()
  storePlatform({settings:{brandName:'ZENIX',supportEmail:'',supportPhone:'',defaultTrialDays:30,graceDays:7,registration:'open'}})
  await openPlatform('/platform/features')
  const row=(label:string)=>tableRows(1).find(r=>r.textContent?.startsWith(label))!
  assert.ok(row('Sotuv').textContent!.includes('Ochiq'),'Plus plan includes sales')
  assert.ok(row('AI yordamchi').textContent!.includes('rejada yo‘q'))
  await click([...document.querySelectorAll('.pf-nav-item')].find(a=>a.textContent==='Platforma sozlamalari')!)
  await click(byText('Standart qiymatlar'))
  assert.equal((field('Sinov muddati (kun)') as HTMLInputElement).value,'14')
  assert.ok(field('O‘zgarish sababi'),'sensitive default still needs a reason')
  assert.equal(platformOf().settings.defaultTrialDays,30,'nothing saved without confirmation')
})
