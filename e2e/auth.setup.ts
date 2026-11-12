import {test as setup,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import {build} from 'esbuild'

// First run of a clean browser: the app asks for a Business Owner. The password is generated per run and never
// stored in the repository; later tests reuse the signed-in browser state saved below (gitignored).
setup('first-run set-up creates the Business Owner and opens the dashboard',async({page})=>{
  const password=`E2e-${randomUUID().slice(0,12)}9a`
  await page.goto('/')
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading',{name:'Yangi biznes yaratish'})).toBeVisible()
  await expect(page.getByLabel('Ism-familiya')).toHaveValue('')
  await expect(page.getByLabel('Kompaniya')).toHaveValue('')
  await page.getByLabel('Ism-familiya').fill('E2E Biznes Egasi')
  await page.getByLabel('Kompaniya').fill('E2E Zavod')
  await page.getByLabel('Telefon raqami').fill(`+99890${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)
  await page.locator('#register-username').fill('e2e.admin')
  await page.locator('#register-password').fill(password)
  await page.locator('#register-confirm').fill(password)
  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
  await page.getByText('Kalitni xavfsiz joyga saqladim').click()
  await page.getByRole('button',{name:'Davom etish'}).click()
  await expect(page.getByRole('heading',{level:1,name:'Boshqaruv paneli'})).toBeVisible()
  const stateKey='zenix-manufacturing-v3-state'
  const clean=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),stateKey)
  expect(clean.products).toEqual([])
  expect(clean.customers).toEqual([])
  expect(clean.productionOrders).toEqual([])
  expect(clean.employees).toHaveLength(1)
  expect(clean.employees[0].name).toBe('E2E Biznes Egasi')

  // Other browser tests exercise existing master data. Load it only into the test profile.
  const bundle=await build({entryPoints:['src/data/mockData.ts'],bundle:true,write:false,format:'esm',platform:'node'})
  const fixtures=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  const demo=fixtures.createInitialState()
  const employees=demo.employees.map((employee:{id:string})=>employee.id===clean.employees[0].id?clean.employees[0]:employee)
  await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:stateKey,state:{...demo,employees,activity:clean.activity,settings:{...demo.settings,company:clean.settings.company}}})
  fs.mkdirSync('e2e/.auth',{recursive:true})
  await page.context().storageState({path:'e2e/.auth/admin.json'})
})
