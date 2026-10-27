import {setSystemDark} from './setup'
import {byText,cleanup,click,flush,key,type} from './helpers'
import {location,mountApp,seedState,signIn,storedSettings} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {applyAppearance,normalizePrefs,resolveTheme} from '../../src/app/theme/preferences'

afterEach(async()=>{await cleanup();setSystemDark(false)})
const html=()=>document.documentElement

test('preferences: saved values from older builds migrate to supported ones',()=>{
  assert.deepEqual(normalizePrefs({theme:'midnight',appearance:'Graphite',fontSize:'huge',uiDensity:undefined,reducedMotion:'yes'}),{theme:'system',appearance:'neutral',fontSize:'standard',uiDensity:'standard',tableDensity:'standard',reducedMotion:false})
  assert.equal(normalizePrefs({appearance:'emerald-night'}).appearance,'mint','a light/dark item id maps to its family')
  assert.equal(normalizePrefs({appearance:'ZENIX Steel'}).appearance,'blue')
  assert.equal(normalizePrefs({appearance:'aurora'}).appearance,'blue','unknown → default family')
  assert.equal(resolveTheme('system',true),'dark')
  assert.equal(resolveTheme('light',true),'light')
})

test('preferences: applyAppearance writes every preference onto <html> (portals inherit it)',()=>{
  const root=document.createElement('html')
  applyAppearance(root,{theme:'dark',appearance:'pink',fontSize:'large',uiDensity:'compact',tableDensity:'comfortable',reducedMotion:true},'dark')
  assert.deepEqual({...root.dataset},{theme:'dark',bg:'crimson-night',family:'pink',fontSize:'large',density:'compact',tableDensity:'comfortable'})
  assert.ok(root.classList.contains('reduced-motion'))
  assert.equal(root.style.getPropertyValue('--accent').toLowerCase(),'#d58c9a')
})

test('theme: System follows the OS preference live, Light/Dark override it',async()=>{
  await mountApp('/settings?view=appearance')
  assert.equal(html().dataset.theme,'light')
  setSystemDark(true);await flush()
  assert.equal(html().dataset.theme,'dark','OS switched to dark → app follows')
  await click(byText('Light'))
  assert.equal(html().dataset.theme,'light')
  setSystemDark(false);setSystemDark(true);await flush()
  assert.equal(html().dataset.theme,'light','explicit Light ignores the OS')
})

test('appearance: background family, densities and font size apply app-wide and persist across reloads',async()=>{
  const view=await mountApp('/settings?view=appearance')
  await click([...document.querySelectorAll('.swatch')].find(b=>b.textContent!.includes('Emerald'))!)
  await click(byText('Ixcham',`[aria-label="Interfeys zichligi"] button`))
  await click(byText('Keng',`[aria-label="Jadval zichligi"] button`))
  await click(byText('Katta',`[aria-label="Shrift o‘lchami"] button`))
  assert.equal(html().dataset.family,'mint')
  assert.equal(html().dataset.density,'compact')
  assert.equal(html().dataset.tableDensity,'comfortable')
  assert.equal(html().dataset.fontSize,'large')
  await flush(400) // the state save is debounced
  assert.deepEqual([storedSettings().appearance,storedSettings().uiDensity,storedSettings().tableDensity,storedSettings().fontSize],['mint','compact','comfortable','large'])
  await view.unmount();html().removeAttribute('data-family');html().removeAttribute('data-density')
  await mountApp('/')
  assert.equal(html().dataset.family,'mint','restored on the next visit')
  assert.equal(html().dataset.density,'compact')
})

test('global search: Ctrl+K focuses search, arrows + Enter open the exact record',async()=>{
  await mountApp('/')
  await key(window as unknown as Element,'k',{ctrlKey:true})
  const input=document.querySelector<HTMLInputElement>('input[aria-label="Global qidiruv"]')!
  assert.equal(document.activeElement,input,'Ctrl+K puts focus in the search box')
  await type(input,'Alyuminiy')
  const options=[...document.querySelectorAll('[role="option"]')]
  assert.ok(options.length>1,'results listed')
  const groups=[...document.querySelectorAll('.search-group-label')].map(g=>g.textContent)
  assert.ok(groups.includes('Xomashyo'),'grouped by record type')
  assert.equal(input.getAttribute('aria-activedescendant'),'gs-0')
  // Arrow down to the first raw-material result, then open it.
  const target=options.findIndex(o=>o.parentElement!.querySelector('.search-group-label')?.textContent==='Xomashyo')
  assert.ok(target>0)
  for(let i=0;i<target;i++)await key(input,'ArrowDown')
  assert.equal(input.getAttribute('aria-activedescendant'),`gs-${target}`)
  await key(input,'Enter')
  assert.match(location.current,/^\/materials\?view=all&id=rm/,'Enter opens that material by id')
  await flush(60)
  assert.ok(document.querySelector('[role="dialog"]'),'the material drawer is open')
})

test('global search: Escape closes the results',async()=>{
  await mountApp('/')
  const input=document.querySelector<HTMLInputElement>('input[aria-label="Global qidiruv"]')!
  input.focus();await type(input,'a')
  assert.ok(document.querySelector('.search-popover'))
  await key(document,'Escape')
  assert.equal(Boolean(document.querySelector('.search-popover')),false)
})

const notification=(over:Record<string,unknown>)=>({id:'n-t',type:'quality',title:'Quality failure',text:'QC',severity:'danger',read:false,date:new Date().toISOString(),path:'/quality?view=alerts&id=qa-x',...over})

test('notifications: unread count, click opens the linked record and marks it read',async()=>{
  seedState(s=>({...s,notifications:[notification({}),notification({id:'n-2',type:'low-stock',title:'Past qoldiq',path:'/materials?view=all&id=rm1'})]}))
  await mountApp('/')
  const bell=document.querySelector('button[aria-label^="Bildirishnomalar"]')!
  assert.match(bell.getAttribute('aria-label')!,/2 ta o‘qilmagan/)
  await click(bell)
  await click([...document.querySelectorAll('.notification-item')].find(b=>b.textContent!.includes('Past qoldiq'))!)
  assert.equal(location.current,'/materials?view=all&id=rm1')
  assert.match(document.querySelector('button[aria-label^="Bildirishnomalar"]')!.getAttribute('aria-label')!,/1 ta o‘qilmagan/)
})

test('notifications: turning a category off hides it in the bell',async()=>{
  seedState(s=>({...s,settings:{...s.settings,notifications:{...s.settings.notifications,quality:false}},notifications:[notification({}),notification({id:'n-2',type:'low-stock',title:'Past qoldiq',path:'/materials?view=all&id=rm1'})]}))
  await mountApp('/')
  assert.match(document.querySelector('button[aria-label^="Bildirishnomalar"]')!.getAttribute('aria-label')!,/1 ta o‘qilmagan/)
  await click(document.querySelector('button[aria-label^="Bildirishnomalar"]'))
  assert.equal(document.querySelectorAll('.notification-item').length,1)
})

test('date filter: without a period every Quality check is listed',async()=>{
  const day=(n:number)=>new Date(Date.now()-n*864e5).toISOString()
  seedState(s=>({...s,qualityChecks:[
    {id:'qc-new',type:'Final',sourceType:'production',sourceId:'mo-x',itemId:s.products[0].id,status:'Passed',inspectorId:'em4',date:day(1)},
    {id:'qc-old',type:'Final',sourceType:'production',sourceId:'mo-y',itemId:s.products[0].id,status:'Passed',inspectorId:'em4',date:day(60)},
  ] as typeof s.qualityChecks}))
  await mountApp('/quality?view=checks')
  assert.equal(document.querySelectorAll('tbody tr').length,2,'no period → both checks')
})

test('date filter: ?range= limits Quality checks to the period',async()=>{
  const day=(n:number)=>new Date(Date.now()-n*864e5).toISOString()
  seedState(s=>({...s,qualityChecks:[
    {id:'qc-new',type:'Final',sourceType:'production',sourceId:'mo-x',itemId:s.products[0].id,status:'Passed',inspectorId:'em4',date:day(1)},
    {id:'qc-old',type:'Final',sourceType:'production',sourceId:'mo-y',itemId:s.products[0].id,status:'Passed',inspectorId:'em4',date:day(60)},
  ] as typeof s.qualityChecks}))
  await mountApp('/quality?view=checks&range=7')
  assert.equal(document.querySelectorAll('tbody tr').length,1)
})

test('deep link: /quality?view=checks&id= opens that check',async()=>{
  seedState(s=>({...s,qualityChecks:[{id:'qc-1',type:'Final',sourceType:'production',sourceId:'mo-x',itemId:s.products[0].id,status:'Pending',inspectorId:'em4',date:new Date().toISOString()}] as typeof s.qualityChecks}))
  await mountApp('/quality?view=checks&id=qc-1')
  assert.ok(document.querySelector('[role="dialog"]'),'check dialog open')
})

test('no permission: a role without the module sees a clear state, not a crash',async()=>{
  signIn('em3')
  await mountApp('/costs','em3')
  assert.ok(document.body.textContent!.includes('Ruxsat mavjud emas'))
  assert.ok(byText('Boshqaruv paneliga qaytish','a'))
})

test('unknown route shows Not found with a way back',async()=>{
  await mountApp('/no-such-page')
  assert.ok(document.body.textContent!.includes('Sahifa topilmadi'))
})

test('CRUD: creating a customer from the Sales page adds it to the list',async()=>{
  await mountApp('/sales?view=customers')
  const before=document.querySelectorAll('tbody tr').length
  const add=[...document.querySelectorAll<HTMLButtonElement>('main button')].find(b=>/Yangi mijoz|Mijoz qo/.test(b.textContent||''))
  assert.ok(add,'create button exists')
  await click(add!)
  await flush()
  const dialog=document.querySelector('[role="dialog"]')!
  const name=dialog.querySelector<HTMLInputElement>('input')!
  await type(name,'UI Test Mijoz')
  const phone=[...dialog.querySelectorAll<HTMLInputElement>('input')].find(i=>/tel|phone|\+998/i.test(i.type+i.placeholder+i.name))
  if(phone)await type(phone,'+998901112233')
  await click([...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>/Saqlash|Yaratish|Qo‘shish/.test(b.textContent||''))!)
  await flush(60)
  assert.equal(Boolean(document.querySelector('[role="dialog"]')),false,'dialog closed after save')
  assert.ok(document.body.textContent!.includes('UI Test Mijoz'))
  assert.ok(document.querySelectorAll('tbody tr').length>=Math.min(before+1,10))
})

