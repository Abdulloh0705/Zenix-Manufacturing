import {test,expect,type Page} from '@playwright/test'
import {watchErrors} from './fixtures'

// Platform workspace (SaaS operator). The signed-in Business Owner from auth.setup.ts is the tenant session; the
// operator signs in with a ticket signed by the throwaway key generated in playwright.config.ts.

let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())

async function ticket(actor:string,minutes=20){
  const jwk=JSON.parse(process.env.ZENIX_E2E_PLATFORM_JWK||'null')
  if(!jwk)throw new Error('ZENIX_E2E_PLATFORM_JWK missing: run through playwright.config.ts')
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])
  const expiresAt=Date.now()+minutes*60000
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(`zenix-platform-v1|${actor}|${expiresAt}`))
  return `ZXR1.${expiresAt}.${Buffer.from(sig).toString('base64url')}`
}
const gate=(page:Page)=>page.getByText('Platform administrator kirishi')
async function openSection(page:Page,label:string){
  const menu=page.locator('button.pf-menu')
  if(await menu.isVisible())await menu.click()
  await page.getByRole('navigation',{name:'Platforma bo‘limlari'}).getByRole('link',{name:label,exact:true}).click()
  await expect(page.locator('.pf-title h1')).toHaveText(label)
}
const noPageOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)

test('a signed-in Business Owner meets the platform gate; a forged ticket is refused',async({page})=>{
  await page.goto('/platform/companies')
  await expect(gate(page)).toBeVisible()
  await expect(page.locator('.pf-nav-item')).toHaveCount(0)
  await page.getByLabel('Operator ID').fill('platform.e2e')
  await page.getByLabel('Imzolangan chipta').fill(`ZXR1.${Date.now()+600000}.forged`)
  await page.getByRole('button',{name:'Platformaga kirish'}).click()
  await expect(page.getByRole('alert')).toContainText('noto‘g‘ri')
  await expect(page.locator('.pf-nav-item')).toHaveCount(0)
})

test('operator manages companies, settings and diagnostics without touching tenant ERP data',async({page})=>{
  await page.goto('/platform')
  const erpBefore=await page.evaluate(()=>localStorage.getItem('zenix-manufacturing-v3-state'))
  await page.getByLabel('Operator ID').fill('platform.e2e')
  await page.getByLabel('Imzolangan chipta').fill(await ticket('platform.e2e'))
  await page.getByRole('button',{name:'Platformaga kirish'}).click()
  await expect(page.locator('.pf-title h1')).toHaveText('Platforma ko‘rinishi')
  await expect(page.locator('.kpi').filter({hasText:'Jami kompaniyalar'}).locator('strong')).not.toHaveText('0')
  expect(await noPageOverflow(page)).toBe(true)

  await openSection(page,'Kompaniyalar')
  await expect(page.locator('.pf-table tbody tr').first()).toBeVisible()
  await page.locator('.pf-link').first().click()
  await expect(page.getByRole('dialog')).toContainText('Biznes egasi')
  await expect(page.getByRole('table',{name:'Kompaniya a’zolari'})).toContainText('e2e.admin')
  await page.keyboard.press('Escape')

  await openSection(page,'Platforma sozlamalari')
  await page.getByLabel('Imtiyoz davri (kun)').fill('45')
  await page.getByRole('button',{name:'Saqlash'}).click()
  await expect(page.getByText('Imtiyoz muddati 1–30 kun')).toBeVisible()
  await page.getByLabel('Imtiyoz davri (kun)').fill('10')
  await page.getByLabel('O‘zgarish sababi').fill('E2E grace policy')
  await page.getByRole('button',{name:'Saqlash'}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Saqlash'}).click()
  await expect(page.getByRole('status').filter({hasText:'Platforma sozlamalari saqlandi'})).toBeVisible()

  await openSection(page,'Xavfsizlik va audit')
  await expect(page.locator('.pf-table')).toContainText('Sozlamalar o‘zgardi')

  await openSection(page,'Tizim holati')
  await expect(page.getByText('Ulanmagan').first()).toBeVisible()
  expect(await noPageOverflow(page)).toBe(true)

  expect(await page.evaluate(()=>localStorage.getItem('zenix-manufacturing-v3-state'))).toBe(erpBefore)
  await page.getByRole('button',{name:'Chiqish'}).click()
  await expect(gate(page)).toBeVisible()
})
