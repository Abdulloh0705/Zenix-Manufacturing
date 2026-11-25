import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {location,mountApp,STATE_KEY} from './appFixture'

afterEach(cleanup)
const body=()=>document.body.textContent||''

test('first-time role guidance can be skipped, stays dismissed on remount, and can be reopened',async()=>{
  const view=await mountApp('/')
  assert.ok(document.querySelector('[aria-label="Birinchi kirish yo‘riqnomasi"]'))
  assert.match(body(),/Sizning rolingiz: Biznes egasi/)
  await click(byText('Keyinroq','button',document.querySelector('[aria-label="Birinchi kirish yo‘riqnomasi"]')!))
  assert.equal(document.querySelector('[aria-label="Birinchi kirish yo‘riqnomasi"]'),null)
  const key=Object.keys(localStorage).find(k=>k.startsWith('zenix-help-onboarding-v1:'))!
  assert.equal(JSON.parse(localStorage.getItem(key)!), 'skipped')
  await view.unmount()
  await mountApp('/help')
  assert.equal(document.querySelector('[aria-label="Birinchi kirish yo‘riqnomasi"]'),null)
  await click(byText('Boshlang‘ich yo‘riqnomani qayta ko‘rish'))
  assert.match(body(),/Sizning rolingiz — Biznes egasi/)
  await click(byText('Tushundim'))
  assert.equal(JSON.parse(localStorage.getItem(key)!), 'done')
  assert.match(body(),/Amaliy yo‘riqnomalar/)
})

test('page-aware help shows actual transfer instructions and safe guide steps',async()=>{
  await mountApp('/warehouse?view=transfers')
  const before=localStorage.getItem(STATE_KEY)
  await click(document.querySelector('button[aria-label="Yordam"]'))
  const dialog=document.querySelector('[role="dialog"]')!
  assert.match(dialog.textContent||'',/Ombor · Transferlar/)
  assert.match(dialog.textContent||'',/Sabab majburiy/)
  await click(byText('Yordam markazi','a',dialog))
  await flush()
  assert.ok(location.current.startsWith('/help?topic='))
  assert.match(body(),/Ombor · Transferlar/)
  await click(byText('Omborlararo transfer','a'))
  assert.match(body(),/Qadam 1 \/ 3/)
  await click(byText('Keyingi qadam'))
  assert.match(body(),/Qadam 2 \/ 3/)
  assert.equal(localStorage.getItem(STATE_KEY),before,'tutorial navigation does not change business data')
  await click(byText('Sahifani ochish','a'))
  await flush()
  assert.equal(location.current,'/warehouse?view=transfers')
})

test('operator cannot open forbidden admin guide or find it in help search',async()=>{
  await mountApp('/help?guide=admin-user','em3')
  assert.match(body(),/Yo‘riqnoma ochilmadi/)
  assert.ok(!body().includes('Vaqtinchalik parol: birinchi kirishda'))
  const search=document.querySelector('input[aria-label="Yordam qidirish"]')
  await type(search,'foydalanuvchi yaratish')
  assert.match(body(),/Natija topilmadi/)
  assert.ok(!body().includes('Foydalanuvchi qo‘shish'))
})

test('search finds field names, answers FAQs and handles unavailable topic without crashing',async()=>{
  await mountApp('/help?topic=/warehouse:transfers')
  const search=document.querySelector('input[aria-label="Yordam qidirish"]')
  await type(search,'transfer sababi')
  assert.match(body(),/Omborlararo transfer/)
  await click([...document.querySelectorAll('[aria-label="Qidiruv natijalari"] button')].find(x=>x.querySelector('b')?.textContent==='Omborlararo transfer')||null)
  assert.match(body(),/Transfer sababi: kamida 5 belgi/)
  await type(search,'qoldiq bor')
  await click([...document.querySelectorAll('[aria-label="Qidiruv natijalari"] button')].find(x=>x.querySelector('b')?.textContent==='Nega qoldiq bor, lekin chiqim rad etildi?')||null)
  assert.match(body(),/Available qoldiq rezerv/)
  await click(byText('Boshlang‘ich yo‘riqnomani qayta ko‘rish'))
  assert.match(body(),/Sizning rolingiz — Biznes egasi/)
})

// ---- Completion checks (2026-11-21): every role, every route, every guide link ----
import {seedState,signIn} from './appFixture'
import {SYSTEM_ROLES,hasPermission} from '../../src/domain/access'
import {HELP_GUIDES,HELP_TOPICS,visibleGuides,visibleTopics} from '../../src/features/help/helpContent'
import type {ManufacturingState} from '../../src/types'

const guideSection=()=>document.querySelector('[aria-label="Amaliy yo‘riqnomalar"]')
const listedGuides=()=>[...(guideSection()?.querySelectorAll('.help-list-item b')||[])].map(b=>b.textContent)
const healthy=()=>!body().includes('Sahifa topilmadi')&&!body().includes('Sahifada xatolik yuz berdi')
/** One employee per existing role: seed people where they exist, a clone of em2 (branch b1, warehouse w1) otherwise. */
function employeeFor(roleId:string){
  const seeded:Record<string,string>={role_owner:'em1',role2:'em2',role5:'em3',role3:'em4',role4:'em5'}
  if(seeded[roleId])return seeded[roleId]
  const id=`help-${roleId}`
  seedState(s=>({...s,employees:[...s.employees,{...s.employees.find(e=>e.id==='em2')!,id,name:`Help ${roleId}`,roleId,warehouseId:'w1'} as ManufacturingState['employees'][number]]}))
  return id
}

test('every existing role sees exactly its permitted guides in the Help Center, never another role’s',async()=>{
  for(const role of SYSTEM_ROLES){
    const allowed=(m:string,a:'view'|'create'|'edit'|'delete'|'approve'|'execute'|'export'='view')=>hasPermission(role,m,a)
    const expected=visibleGuides(allowed).map(g=>g.title)
    const employee=employeeFor(role.id)
    await mountApp('/help',employee)
    assert.match(body(),new RegExp(`Sizning rolingiz — ${role.name}`),`${role.key}: onboarding names the role`)
    await click(byText('Tushundim'))
    assert.deepEqual(listedGuides().sort(),[...expected].sort(),`${role.key}: guide list`)
    for(const g of HELP_GUIDES.filter(x=>!expected.includes(x.title)))assert.ok(!listedGuides().includes(g.title),`${role.key} must not see ${g.id}`)
    const pages=document.querySelectorAll('.help-topic').length
    assert.equal(pages,visibleTopics(allowed).length,`${role.key}: page topics`)
    assert.ok(healthy())
    await cleanup()
  }
})

test('the page-aware help panel resolves on every route the owner can open, and links back correctly',async()=>{
  // jsdom has no Element#scrollTo (the AI chat scrolls its log); browsers do.
  if(!Element.prototype.scrollTo)Element.prototype.scrollTo=()=>{}
  for(const topic of HELP_TOPICS){
    await mountApp(topic.path)
    assert.ok(healthy(),`${topic.path} renders`)
    await click(document.querySelector('button[aria-label="Yordam"]'))
    const dialog=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
    assert.ok(dialog.textContent?.includes(topic.title),`${topic.path}: panel shows “${topic.title}”`)
    const center=byText('Yordam markazi','a',dialog) as HTMLAnchorElement
    assert.equal(decodeURIComponent(center.getAttribute('href')||''),`/help?topic=${topic.id}`)
    await cleanup()
  }
})

test('“Sahifani ochish” in every guide opens its real route without changing business data',async()=>{
  for(const guide of HELP_GUIDES){
    await mountApp(`/help?guide=${guide.id}`)
    const before=localStorage.getItem(STATE_KEY)
    assert.ok(body().includes(guide.purpose),`${guide.id}: guide opens`)
    for(const label of ['Boshlashdan oldin','Kiritiladigan ma’lumotlar','Kutilayotgan natija','Keyingi ish','Agar amal bajarilmasa'])assert.ok(body().includes(label),`${guide.id}: ${label}`)
    for(let i=1;i<guide.steps.length;i++)await click(byText('Keyingi qadam'))
    assert.match(body(),new RegExp(`Qadam ${guide.steps.length} / ${guide.steps.length}`))
    assert.equal(localStorage.getItem(STATE_KEY),before,`${guide.id}: stepping through the tutorial writes nothing`)
    await click(byText('Sahifani ochish','a'));await flush()
    const topic=HELP_TOPICS.find(t=>t.id===guide.topic)!
    assert.equal(location.current,topic.path,`${guide.id}: link target`)
    assert.ok(healthy(),`${guide.id}: target page renders`)
    await cleanup()
  }
})

test('the profile menu opens the Help Center; help on a page without a catalog entry stays safe',async()=>{
  await mountApp('/')
  await click(document.querySelector('button[aria-label^="Profil:"]'))
  await click(byText('Yordam markazi','button'))
  await flush()
  assert.equal(location.current,'/help')
  assert.match(body(),/Yordam markazi/)
  await click(document.querySelector('button[aria-label="Yordam"]'))
  const dialog=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
  assert.match(dialog.textContent||'',/Sahifa qo‘llanmasi topilmadi/)
  await cleanup()
  await mountApp('/no-such-page')
  await click(document.querySelector('button[aria-label="Yordam"]'))
  assert.match(([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)?.textContent)||'',/Sahifa qo‘llanmasi topilmadi/)
})

test('onboarding started from the banner is completed once per account; another user still gets their own',async()=>{
  const first=await mountApp('/warehouse')
  const banner=()=>document.querySelector('[aria-label="Birinchi kirish yo‘riqnomasi"]')
  await click(byText('Yo‘riqnomani boshlash','button',banner()!))
  await flush()
  assert.equal(location.current,'/help?onboarding=1')
  assert.equal(banner(),null,'no banner on top of the Help Center')
  const opened=document.querySelector('[aria-label="Boshlang‘ich yo‘riqnoma"]')!
  assert.ok(byText('Ombor','a',opened),'open modules link to real routes')
  await click(byText('Tushundim'))
  const key=Object.keys(localStorage).find(k=>k.startsWith('zenix-help-onboarding-v1:'))!
  assert.equal(JSON.parse(localStorage.getItem(key)!),'done')
  await first.unmount()
  await mountApp('/production')
  assert.equal(banner(),null,'completed onboarding stays dismissed on other pages')
  // The operator signs in on the same browser: their onboarding is separate and lists only their work.
  const owner=localStorage.getItem(key)
  await cleanup()
  localStorage.setItem(key,owner!)
  signIn('em3')
  await mountApp('/production?view=shop-floor','em3')
  assert.ok(banner(),'operator still sees first-time guidance')
  assert.match(banner()?.textContent||'',/Operator/)
  await click(byText('Yo‘riqnomani boshlash','button',banner()!));await flush()
  const view=document.querySelector('[aria-label="Boshlang‘ich yo‘riqnoma"]')!
  assert.ok(view.textContent?.includes('Sex ishini bajarish'))
  assert.ok(!view.textContent?.includes('Foydalanuvchi yaratish'))
  assert.equal(byText('Admin Panel','a',view),null)
})
