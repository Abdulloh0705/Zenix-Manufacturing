import {test as setup,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'

// First run of a clean browser: the app asks for a Super Admin. The password is generated per run and never
// stored in the repository; later tests reuse the signed-in browser state saved below (gitignored).
setup('first-run set-up creates the Super Admin and opens the dashboard',async({page})=>{
  const password=`E2e-${randomUUID().slice(0,12)}9a`
  await page.goto('/')
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading',{name:'Ro‘yxatdan o‘tish'})).toBeVisible()
  await expect(page.getByLabel('Ism-familiya')).toHaveValue('Abdulloh Karimov')
  await page.getByLabel('Telefon yoki login').fill('e2e.admin')
  await page.locator('#register-password').fill(password)
  await page.locator('#register-confirm').fill(password)
  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
  await page.getByText('Kalitni xavfsiz joyga saqladim').click()
  await page.getByRole('button',{name:'Davom etish'}).click()
  await expect(page.getByRole('heading',{level:1,name:'Boshqaruv paneli'})).toBeVisible()
  fs.mkdirSync('e2e/.auth',{recursive:true})
  await page.context().storageState({path:'e2e/.auth/admin.json'})
})
