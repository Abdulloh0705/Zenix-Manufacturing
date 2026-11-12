import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {AUTH_KEY,SESSION_KEY,STATE_KEY,adminState,confirmedPurchase,openWith,reservedOrder,settle,stored,watchErrors} from './fixtures'
import {makeCredential} from '../src/shared/lib/crypto'
import {createEmptyTenantState} from '../src/data/mockData'

// Smoke flows on desktop and phone (see playwright.config.ts). Each test starts from the signed-in Business Owner
// saved by auth.setup.ts and, where it needs records, from data built by the domain commands (fixtures.ts).

let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())

const h1=(page:import('@playwright/test').Page)=>page.locator('main h1').first()

test('modules open from deep links, unknown pages show Not found',async({page})=>{
  await page.goto('/')
  await expect(h1(page)).toHaveText('Boshqaruv paneli')
  for(const path of ['/production?view=orders','/purchases?view=orders','/sales?view=orders','/warehouse','/quality?view=checks','/equipment','/settings?view=system']){
    await page.goto(path)
    await expect(h1(page),path).toHaveText(/\S/)
    await expect(page.getByText('Sahifada xatolik')).toHaveCount(0)
  }
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading',{name:'Sahifa topilmadi'})).toBeVisible()
  await page.getByRole('link',{name:'Boshqaruv paneliga o‘tish'}).click()
  await expect(h1(page)).toHaveText('Boshqaruv paneli')
})

test('second company registration stores a separate empty ERP workspace and signs its owner in',async({page})=>{
  await page.goto('/')
  const original=await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)
  await page.evaluate(key=>localStorage.removeItem(key),SESSION_KEY)
  await page.goto('/register')
  await page.getByLabel('Ism-familiya').fill('Ikkinchi Egasi')
  await page.getByLabel('Kompaniya').fill('Factory B')
  const login=`e2e.b.${randomUUID().slice(0,8)}`
  const password=`E2e-${randomUUID().slice(0,12)}9a`
  await page.getByLabel('Telefon raqami').fill(`+99891${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)
  await page.locator('#register-username').fill(login)
  await page.locator('#register-password').fill(password)
  await page.locator('#register-confirm').fill(password)
  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
  const result=await page.evaluate(()=>{
    const saas=JSON.parse(localStorage.getItem('zenix-saas-v1')||'{}')
    const tenant=saas.tenants.find((t:{name:string})=>t.name==='Factory B')
    return {count:saas.tenants.length,tenantId:tenant?.id,state:tenant?JSON.parse(localStorage.getItem(`zenix-erp-${tenant.id}-state`)||'{}'):null}
  })
  expect(result.count).toBe(2)
  expect(result.state?.products).toHaveLength(0)
  expect(result.state?.productionOrders).toHaveLength(0)
  expect(result.state?.activity).toHaveLength(0)
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe(original)
  await page.getByText('Kalitni xavfsiz joyga saqladim').click()
  await page.getByRole('button',{name:'Davom etish'}).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Telefon, login yoki e-pochta').fill(login)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button',{name:'Kirish',exact:true}).click()
  await expect(page.getByRole('heading',{level:1,name:'Boshqaruv paneli'})).toBeVisible()
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId)).toBe(result.tenantId)
  await page.reload()
  await expect(page.getByRole('heading',{level:1,name:'Boshqaruv paneli'})).toBeVisible()
})

test('creating a customer saves it; the dialog closes on Escape and returns focus',async({page})=>{
  await page.goto('/sales?view=customers')
  const add=page.getByRole('button',{name:'Mijoz qo‘shish'})
  await add.click();await settle(page)
  const dialog=page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(add).toBeFocused()
  await add.click();await settle(page)
  const name=`E2E mijoz ${randomUUID().slice(0,6)}`
  await dialog.locator('input').first().fill(name)
  const phone=dialog.locator('input[type="tel"], input[placeholder*="+998"]').first()
  if(await phone.count())await phone.fill('+998901112233')
  await dialog.getByRole('button',{name:/Saqlash|Yaratish|Qo‘shish/}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(name).first()).toBeVisible()
  expect((await stored(page)).customers.some(c=>c.name===name)).toBe(true)
})

test('tablet width keeps customer navigation and edit dialog usable',async({page})=>{
  await page.setViewportSize({width:820,height:1180})
  await page.goto('/sales?view=customers')
  await page.getByRole('button',{name:'Mijoz qo‘shish'}).click();await settle(page)
  const dialog=page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Nomi').fill('Tablet draft')
  const box=await dialog.boundingBox()
  expect(box&&box.x>=0&&box.x+box.width<=820).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('another tab changing tenant preserves an unsaved customer form until explicit reload',async({page,context})=>{
  await page.goto('/sales?view=customers')
  await page.getByRole('button',{name:'Mijoz qo‘shish'}).click();await settle(page)
  const draft=page.locator('.entity-modal input').first()
  await draft.fill('Unsaved Tenant A customer')
  const original=await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)
  const other=await context.newPage()
  // Same-origin static page gives this tab storage access without mounting a second app instance.
  await other.goto('/zenix-mark.svg')
  const second=`tenant-${randomUUID()}`
  const empty=createEmptyTenantState('Factory B','Demo Owner')
  empty.employees[0].roleId='role_owner'
  await other.evaluate(({id,state})=>{
    const session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
    const saas=JSON.parse(localStorage.getItem('zenix-saas-v1')||'{}')
    const at=new Date().toISOString()
    localStorage.setItem(`zenix-erp-${id}-state`,JSON.stringify(state))
    saas.tenants.push({id,name:'Factory B',status:'active',ownerAccountId:session.accountId,createdAt:at})
    saas.memberships.push({id:`member-${id}`,tenantId:id,accountId:session.accountId,employeeId:'em1',status:'active',createdAt:at})
    saas.subscriptions.push({id:`sub-${id}`,tenantId:id,planId:'enterprise',status:'active',startsAt:at})
    localStorage.setItem('zenix-saas-v1',JSON.stringify(saas))
    localStorage.setItem('zenix-session-v1',JSON.stringify({...session,tenantId:id,lastActivity:at}))
  },{id:second,state:empty})
  await other.close()
  await expect(page.getByRole('alertdialog',{name:'Boshqa oynada sessiya o‘zgardi'})).toBeVisible()
  await expect(draft).toHaveValue('Unsaved Tenant A customer')
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe(original)
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId)).toBe(second)
  await page.getByRole('button',{name:'O‘zgarishlarni bekor qilish va yangilash'}).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.locator('.entity-modal')).toHaveCount(0)
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId)).toBe(second)
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe(original)
})

test('another tab removing tenant membership blocks a dirty form and keeps saved data',async({page,context})=>{
  await page.goto('/sales?view=customers')
  await page.getByRole('button',{name:'Mijoz qo‘shish'}).click();await settle(page)
  const draft=page.locator('.entity-modal input').first()
  await draft.fill('Unsaved after membership change')
  const original=await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)
  const other=await context.newPage()
  await other.goto('/zenix-mark.svg')
  await other.evaluate(()=>{
    const session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
    const saas=JSON.parse(localStorage.getItem('zenix-saas-v1')||'{}')
    saas.memberships=saas.memberships.filter((m:{accountId:string;tenantId:string})=>m.accountId!==session.accountId||m.tenantId!==session.tenantId)
    localStorage.setItem('zenix-saas-v1',JSON.stringify(saas))
  })
  await other.close()
  await expect(page.getByRole('alertdialog',{name:'Boshqa oynada sessiya o‘zgardi'})).toBeVisible()
  await expect(draft).toHaveValue('Unsaved after membership change')
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe(original)
  await page.getByRole('button',{name:'O‘zgarishlarni bekor qilish va yangilash'}).click()
  await expect(page).toHaveURL(/\/login/)
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe(original)
})

test('partial receipt waits in quarantine until the incoming inspection passes',async({page})=>{
  const {state,poId}=confirmedPurchase()
  await openWith(page,state,`/purchases?view=receiving&po=${poId}`)
  await page.getByLabel('Miqdor (kg)').fill('40')
  await page.locator('.receive-btn').click()
  await expect(page.getByText(/40 kg qabul qilindi/)).toBeVisible()
  let s=await stored(page)
  const balance=()=>s.stockBalances.find(b=>b.itemId==='rm2'&&b.warehouseId==='w1')!
  expect([balance().onHand,balance().quarantine,balance().incoming]).toEqual([40,40,60])
  const check=s.qualityChecks.find(q=>q.sourceId===poId&&q.status==='Pending')!
  await page.goto(`/quality?view=checks&id=${check.id}`);await settle(page)
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('button',{name:'Passed',exact:true}).click()
  await dialog.getByRole('button',{name:'Natijani saqlash'}).click()
  await expect(dialog).toHaveCount(0)
  s=await stored(page)
  expect(s.qualityChecks.find(q=>q.id===check.id)!.status).toBe('Passed')
  expect([balance().onHand,balance().quarantine]).toEqual([40,0])
})

test('Shop Floor: job card, scrap and output, then the order goes to quality control',async({page})=>{
  const {state,moId}=reservedOrder()
  await openWith(page,state,`/production?view=shop-floor&mo=${moId}`)
  await expect(page.getByRole('heading',{name:'Sex ishlari'})).toBeVisible()
  await page.locator('.operator-btn.start').click()
  await page.locator('.operator-btn.complete').click()
  await page.locator('.operator-btn.warn',{hasText:'SCRAP'}).click();await settle(page)
  await page.getByRole('dialog').getByRole('button',{name:'Scrap saqlash'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.operator-btn',{hasText:'NATIJA'}).click();await settle(page)
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Tayyor (yaroqli)').fill('19')
  await dialog.getByRole('button',{name:'Qayd etish'}).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('.operator-btn',{hasText:'SIFAT NAZORATI'}).click()
  await expect.poll(async()=>(await stored(page)).productionOrders.find(o=>o.id===moId)!.status).toBe('Sifat nazoratida')
  const o=(await stored(page)).productionOrders.find(x=>x.id===moId)!
  expect([o.completed,o.scrap]).toEqual([19,1])
  expect(o.workOrders.every(w=>w.status==='Yakunlangan')).toBe(true)
})

test('global search opens the exact record through its deep link',async({page})=>{
  const {state,poCode}=confirmedPurchase()
  await openWith(page,state,'/')
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox',{name:'Global qidiruv'}).fill(poCode)
  await expect(page.getByRole('option').first()).toContainText(poCode)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/purchases\?.*id=/)
  await expect(page.getByRole('dialog')).toContainText(poCode)
})

test('theme choice persists across a reload',async({page})=>{
  await page.goto('/settings?view=appearance')
  await page.getByRole('main').getByRole('group',{name:'Theme'}).getByRole('button',{name:'Dark'}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  expect((await stored(page)).settings.theme).toBe('dark')
})

test('an operator cannot open Purchases and sees why',async({browser})=>{
  // Replace the setup browser's demo account with an owner and an operator (em3).
  const context=await browser.newContext()
  const page=await context.newPage()
  const password=`Op-${randomUUID().slice(0,10)}7z`
  const now=new Date().toISOString()
  const account=async(id:string,employeeId:string,username:string,pw:string)=>({id,employeeId,username,...await makeCredential(pw),status:'active',failedCount:0,mustChangePassword:false,createdAt:now})
  const auth={version:1,accounts:[await account('acc-admin','em1','e2e.root',`Ad-${randomUUID()}1`),await account('acc-op','em3','e2e.operator',password)],policy:{},events:[],attempts:{}}
  await page.goto('/login')
  await page.evaluate(([sk,s,ak,a,ses])=>{localStorage.setItem(sk,s);localStorage.setItem(ak,a);localStorage.removeItem(ses);localStorage.removeItem('zenix-saas-v1')},[STATE_KEY,JSON.stringify(adminState()),AUTH_KEY,JSON.stringify(auth),SESSION_KEY])
  await page.goto('/login')
  const metadata=await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-saas-v1')||'null'))
  expect(metadata?.memberships?.map((m:{accountId:string})=>m.accountId)).toEqual(['acc-admin','acc-op'])
  await page.getByLabel('Telefon, login yoki e-pochta').fill('e2e.operator')
  await page.locator('#login-password').fill(password)
  await page.getByRole('button',{name:'Kirish'}).click()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
  await page.goto('/purchases')
  await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toBeVisible()
  await page.goto('/production?view=orders')
  // The create action stays visible but disabled, with the reason as its title.
  await expect(page.getByTitle('Buyurtma yaratish uchun ruxsat yo‘q')).toBeDisabled()
  await context.close()
})

test('owner changes a demo plan; history remains and module entitlement changes',async({page})=>{
  await page.goto('/subscription')
  await expect(page.getByRole('heading',{name:'Obuna va limitlar'})).toBeVisible()
  const before=await stored(page)
  await page.getByRole('button',{name:'Demo rejaga o‘tish'}).first().click()
  await page.getByRole('button',{name:'Tasdiqlash'}).click()
  await expect(page.getByText('Joriy reja:')).toContainText('Free')
  const metadata=await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-saas-v1')||'null'))
  expect(metadata.subscriptions.at(-1).planId).toBe('free')
  expect(metadata.events[0].action).toBe('subscription.change')
  expect((await stored(page)).productionOrders).toEqual(before.productionOrders)
  await page.goto('/purchases')
  await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toBeVisible()
  await page.goto('/production')
  await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toHaveCount(0)
})

test('unreadable stored data opens the recovery screen instead of the app',async({page})=>{
  await page.goto('/')
  await page.evaluate(key=>localStorage.setItem(key,'{"productionOrders":[{"id":'),STATE_KEY)
  await page.reload()
  await expect(page.getByRole('heading',{name:'Ma’lumotlarni tiklash'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Nusxani yuklab olish'})).toBeVisible()
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe('{"productionOrders":[{"id":')
  await page.getByRole('button',{name:'Toza holatda ochish'}).click();await settle(page)
  await page.getByRole('dialog').getByRole('button',{name:'Toza holatda ochish'}).click()
  await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
})
