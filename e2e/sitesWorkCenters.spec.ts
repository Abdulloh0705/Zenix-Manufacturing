import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'

// Phase 4 blockers in a freshly registered company: the owner builds branch → line → work center, a BOM routing
// operation is saved on that work center and an operator account is bound to it. Nothing is written outside the
// isolated browser context; the password is generated per run and never stored.
const state=(page:Page)=>page.evaluate(()=>{
  const session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
  const key=session.tenantId==='tenant-legacy-v3'?'zenix-manufacturing-v3-state':`zenix-erp-${session.tenantId}-state`
  return JSON.parse(localStorage.getItem(key)||'{}')
})

test('a new company owner creates a branch, a line and a work center that BOM routing and an operator use',async({browser})=>{
  test.setTimeout(180_000)
  const nonce=randomUUID().slice(0,8).toUpperCase()
  // A clean context without the shared owner session; the project's own viewport (desktop or mobile) applies.
  const context=await browser.newContext({locale:'uz-UZ',storageState:{cookies:[],origins:[]}})
  const page=await context.newPage()
  try{
    const password=`Sw-${randomUUID()}-4c`
    await page.goto('/register')
    await page.getByLabel('Ism-familiya').fill('Sites Owner')
    await page.getByLabel('Kompaniya').fill(`Sites Factory ${nonce}`)
    await page.getByLabel('Telefon raqami').fill(`+99891${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)
    await page.locator('#register-username').fill(`sites.owner.${nonce.toLowerCase()}`)
    await page.locator('#register-password').fill(password)
    await page.locator('#register-confirm').fill(password)
    await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
    await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
    await page.getByText('Kalitni xavfsiz joyga saqladim').click()
    await page.getByRole('button',{name:'Davom etish'}).click()
    await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
    expect((await state(page)).workCenters).toHaveLength(0)

    // Branch and production line (the owner was refused both before: settings.create does not exist).
    await page.goto('/settings?view=locations')
    await page.getByRole('button',{name:'Qo‘shish'}).first().click()
    const branch=page.getByRole('dialog',{name:'Yangi filial'})
    await branch.getByLabel('Nomi').fill('East Branch')
    await branch.getByLabel('Kod').fill(`E${nonce}`)
    await branch.getByRole('button',{name:'Saqlash'}).click()
    await expect(branch).toHaveCount(0)
    expect((await state(page)).branches).toHaveLength(2)
    await page.getByRole('button',{name:'Qo‘shish'}).last().click()
    const line=page.getByRole('dialog',{name:'Yangi liniya'})
    await line.getByLabel('Nomi').fill('Assembly Line')
    await line.getByLabel('Kod').fill(`L${nonce}`)
    await line.getByRole('button',{name:'Saqlash'}).click()
    await expect(line).toHaveCount(0)
    const lines=(await state(page)).productionLines
    expect(lines).toHaveLength(1)
    await expect(page.getByText('Assembly Line')).toBeVisible()

    // Work center on that line.
    await page.goto('/equipment?view=work-centers')
    await expect(page.getByText('Work center kiritilmagan')).toBeVisible()
    await page.getByRole('button',{name:'Work center qo‘shish'}).click()
    const wcDialog=page.getByRole('dialog',{name:'Yangi work center'})
    await wcDialog.getByLabel('Nomi').fill('Press Cell')
    await wcDialog.getByLabel('Kod').fill(`WC${nonce}`)
    await wcDialog.getByRole('button',{name:'Saqlash'}).click()
    await expect(wcDialog).toHaveCount(0)
    const [wc]=(await state(page)).workCenters
    expect([wc.lineId,wc.branchId]).toEqual([lines[0].id,lines[0].branchId])
    await expect(page.getByRole('button',{name:'Press Cell — tahrirlash'})).toBeVisible()

    // BOM routing operation on the new work center.
    await page.goto('/materials')
    await page.getByRole('button',{name:'Xomashyo qo‘shish'}).click()
    const material=page.getByRole('dialog',{name:'Yangi xomashyo'})
    await material.getByLabel('Nomi').fill('Steel Coil')
    await material.getByLabel('SKU').fill(`SW-RM-${nonce}`)
    await material.getByLabel('Kategoriya').fill('Metal')
    await material.getByLabel('Standart narx').fill('12000')
    await material.getByRole('button',{name:'Saqlash'}).click()
    await expect(material).toHaveCount(0)
    await page.goto('/products')
    await page.getByRole('button',{name:'Mahsulot qo‘shish'}).click()
    const product=page.getByRole('dialog',{name:'Yangi mahsulot'})
    await product.getByLabel('Nomi').fill('Steel Bracket')
    await product.getByLabel('SKU').fill(`SW-FG-${nonce}`)
    await product.getByLabel('Kategoriya').fill('Metal Parts')
    await product.getByLabel('Sotuv narxi').fill('30000')
    await product.getByLabel('Standart tannarx').fill('12000')
    await product.getByRole('button',{name:'Saqlash'}).click()
    await expect(product).toHaveCount(0)
    await page.goto('/products?view=bom')
    await page.getByRole('button',{name:'Yangi BOM'}).click()
    await page.getByRole('dialog',{name:'Yangi BOM revision'}).getByRole('button',{name:'Draft yaratish'}).click()
    await page.getByRole('button',{name:'Tahrirlash',exact:true}).click()
    const editor=page.getByRole('dialog').filter({hasText:'Komponentlar'}).last()
    await editor.getByRole('button',{name:'Komponent',exact:true}).click()
    await editor.getByRole('button',{name:'Operatsiya',exact:true}).click()
    await editor.getByLabel('Nomi').fill('Cut and press')
    await editor.getByRole('button',{name:'Saqlash'}).click()
    await expect(editor.getByRole('alert')).toHaveCount(0)
    await expect.poll(async()=>(await state(page)).boms[0]?.operations?.[0]?.workCenterId).toBe(wc.id)

    // Operator account bound to the work center.
    await page.goto('/admin?view=users')
    await page.getByRole('button',{name:'Foydalanuvchi qo‘shish'}).click()
    const user=page.getByRole('dialog',{name:'Foydalanuvchi qo‘shish'})
    await user.getByRole('tab',{name:/Yangi xodim/}).click()
    await user.getByLabel('F.I.Sh').fill('Line Operator')
    await user.getByLabel('Bo‘lim').click()
    await page.getByRole('option',{name:'Production',exact:true}).click()
    await user.getByRole('combobox',{name:'Rol'}).click()
    await page.getByRole('option',{name:'Operator',exact:true}).click()
    await user.getByLabel('Ish markazi').click()
    await page.getByRole('option',{name:'Press Cell',exact:true}).click()
    await user.getByLabel(/^Login/).fill(`sites.op.${nonce.toLowerCase()}`)
    await user.getByRole('button',{name:'Yaratish',exact:true}).click()
    await expect(page.getByRole('dialog',{name:'Kirish ma’lumotlari'})).toBeVisible()
    const operator=(await state(page)).employees.find((e:{name:string})=>e.name==='Line Operator')
    expect(operator?.workCenterId).toBe(wc.id)
  }finally{await context.close()}
})
