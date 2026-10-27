import {test as setup,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'

// First run of a clean browser: the app asks for a Super Admin. The password is generated per run and never
// stored in the repository; later tests reuse the signed-in browser state saved below (gitignored).
setup('first-run set-up creates the Super Admin and opens the dashboard',async({page})=>{
  const password=`E2e-${randomUUID().slice(0,12)}9a`
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading',{name:'Birinchi sozlash'})).toBeVisible()
  await expect(page.getByRole('combobox',{name:'Xodim'})).toContainText('Abdulloh Karimov')
  await page.getByLabel('Telefon yoki login').fill('e2e.admin')
  await page.locator('#setup-password').fill(password)
  await page.locator('#setup-confirm').fill(password)
  await page.getByRole('button',{name:'Super Admin yaratish'}).click()
  await expect(page.getByRole('heading',{level:1,name:'Boshqaruv paneli'})).toBeVisible()
  fs.mkdirSync('e2e/.auth',{recursive:true})
  await page.context().storageState({path:'e2e/.auth/admin.json'})
})
