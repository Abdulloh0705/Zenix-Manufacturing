import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {AUTH_KEY,SESSION_KEY,STATE_KEY,adminState,confirmedPurchase,openWith,reservedOrder,settle,stored,watchErrors} from './fixtures'
import {makeCredential} from '../src/shared/lib/crypto'

// Smoke flows on desktop and phone (see playwright.config.ts). Each test starts from the signed-in Super Admin
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
  await expect(page.getByRole('heading',{name:'Shop Floor'})).toBeVisible()
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
  await page.keyboard.type(poCode)
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
  // A fresh browser with two accounts: the Super Admin and an operator (em3), passwords generated per run.
  const context=await browser.newContext()
  const page=await context.newPage()
  const password=`Op-${randomUUID().slice(0,10)}7z`
  const now=new Date().toISOString()
  const account=async(id:string,employeeId:string,username:string,pw:string)=>({id,employeeId,username,...await makeCredential(pw),status:'active',failedCount:0,mustChangePassword:false,createdAt:now})
  const auth={version:1,accounts:[await account('acc-admin','em1','e2e.root',`Ad-${randomUUID()}1`),await account('acc-op','em3','e2e.operator',password)],policy:{},events:[],attempts:{}}
  await page.goto('/login')
  await page.evaluate(([sk,s,ak,a,ses])=>{localStorage.setItem(sk,s);localStorage.setItem(ak,a);localStorage.removeItem(ses)},[STATE_KEY,JSON.stringify(adminState()),AUTH_KEY,JSON.stringify(auth),SESSION_KEY])
  await page.goto('/login')
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
