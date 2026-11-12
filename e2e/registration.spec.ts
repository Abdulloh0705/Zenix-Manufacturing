import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {SESSION_KEY,STATE_KEY,watchErrors} from './fixtures'

// Public business registration and employee activation, end to end, on desktop and phone. Each test starts from the
// signed-in Business Owner saved by auth.setup.ts; identifiers and passwords are random per run (isolated data).

let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())

const h1=(page:Page)=>page.locator('main h1').first()
const phone=()=>`+99897${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`
async function signOut(page:Page){
  await page.locator('button.profile').click()
  await page.getByRole('button',{name:'Chiqish'}).click()
  await expect(page).toHaveURL(/\/login/)
}
async function signIn(page:Page,login:string,password:string){
  await page.getByLabel('Telefon, login yoki e-pochta').fill(login)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button',{name:'Kirish',exact:true}).click()
}

test('a new business registers from Login, gets its own workspace and its owner signs in by phone',async({page})=>{
  await page.goto('/')
  const original=await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)
  await page.evaluate(key=>localStorage.removeItem(key),SESSION_KEY)
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/register$/)
  await page.goto('/signin?next=%2Fproduction')
  await expect(page).toHaveURL(/\/login\?next=%2Fproduction$/)
  await page.getByRole('link',{name:'Yangi biznes yaratish'}).click()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading',{name:'Yangi biznes yaratish'})).toBeVisible()
  await expect(page.getByLabel(/^Rol/)).toHaveCount(0)

  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByText('Ism-familiyani kiriting')).toBeVisible()

  const login=`e2e.n.${randomUUID().slice(0,8)}`,tel=phone(),password=`E2e-${randomUUID().slice(0,12)}9a`
  await page.getByLabel('Ism-familiya').fill('Nodira Egamova')
  await page.getByLabel('Kompaniya').fill('Factory N')
  await page.getByLabel('Telefon raqami').fill(tel)
  await page.locator('#register-username').fill(login)
  await page.locator('#register-password').fill(password)
  await page.locator('#register-confirm').fill(password)
  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
  await page.getByText('Kalitni xavfsiz joyga saqladim').click()
  await page.getByRole('button',{name:'Davom etish'}).click()
  await expect(page).toHaveURL(/\/login/)

  // The same login cannot register a second company.
  await page.goto('/register')
  await page.getByLabel('Ism-familiya').fill('Boshqa Egasi')
  await page.getByLabel('Kompaniya').fill('Factory Dup')
  await page.getByLabel('Telefon raqami').fill(phone())
  await page.locator('#register-username').fill(login)
  await page.locator('#register-password').fill(password)
  await page.locator('#register-confirm').fill(password)
  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByText('Bu login yoki e-pochta band')).toBeVisible()

  await page.goto('/login')
  await signIn(page,tel,password)
  await expect(h1(page)).toHaveText('Boshqaruv paneli')
  const result=await page.evaluate(()=>{
    const saas=JSON.parse(localStorage.getItem('zenix-saas-v1')||'{}'),session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
    const tenant=saas.tenants.find((t:{id:string})=>t.id===session.tenantId)
    const state=JSON.parse(localStorage.getItem(`zenix-erp-${session.tenantId}-state`)||'{}')
    return {name:tenant?.name,dup:saas.tenants.some((t:{name:string})=>t.name==='Factory Dup'),employees:state.employees?.length,products:state.products?.length,legacyRole:state.roles?.some((r:{key:string})=>r.key==='super_admin'),role:state.roles?.find((r:{id:string})=>r.id===state.employees?.[0]?.roleId)?.key}
  })
  expect(result).toEqual({name:'Factory N',dup:false,employees:1,products:0,legacyRole:false,role:'business_owner'})
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE_KEY)).toBe(original)

  // A company owner has no platform access.
  await page.goto('/platform')
  await expect(page.getByText('Platform administrator kirishi')).toBeVisible()
  await page.goto('/')
  await signOut(page)
})

test('owner creates an employee with role and branch; the employee activates and sees only permitted work',async({page})=>{
  await page.goto('/admin?view=users')
  await page.getByRole('button',{name:'Foydalanuvchi qo‘shish'}).click()
  const dialog=page.getByRole('dialog',{name:'Foydalanuvchi qo‘shish'})
  await dialog.getByRole('tab',{name:/Yangi xodim/}).click()
  const login=`e2e.op.${randomUUID().slice(0,8)}`
  await dialog.getByLabel('F.I.Sh').fill('Sardor Operatorov')
  await expect(dialog.getByLabel('Filial')).toBeVisible()
  await dialog.getByLabel(/^Login/).fill(login)
  const temporary=await dialog.locator('input.mono').inputValue()
  expect(temporary.length).toBeGreaterThanOrEqual(8)
  await dialog.getByRole('button',{name:'Yaratish',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  const handoff=page.getByRole('dialog',{name:'Kirish ma’lumotlari'})
  await expect(handoff).toContainText(login)
  await expect(handoff).toContainText(temporary)
  await handoff.getByRole('button',{name:'Yopish',exact:true}).last().click()
  const created=await page.evaluate(user=>{
    const auth=JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}'),state=JSON.parse(localStorage.getItem('zenix-manufacturing-v3-state')||'{}')
    const account=auth.accounts.find((a:{username:string})=>a.username===user)
    const employee=state.employees.find((e:{id:string})=>e.id===account?.employeeId)
    return {must:account?.mustChangePassword,expires:Boolean(account?.temporaryExpiresAt),role:state.roles.find((r:{id:string})=>r.id===employee?.roleId)?.key,branch:employee?.branchId}
  },login)
  expect(created).toEqual({must:true,expires:true,role:'operator',branch:'b1'})
  // The new user's details drawer opens after creation; close it before using the top bar.
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer-overlay')).toHaveCount(0)

  await signOut(page)
  await signIn(page,login,temporary)
  await expect(page.getByRole('heading',{name:'Yangi parol o‘rnating'})).toBeVisible()
  const next=`Op-${randomUUID().slice(0,10)}7z`
  await page.locator('#pw-current').fill(temporary)
  await page.locator('#pw-next').fill(next)
  await page.locator('#pw-confirm').fill(next)
  await page.getByRole('button',{name:'Parolni saqlash'}).click()
  await expect(h1(page)).toHaveText('Boshqaruv paneli')
  const workspace=page.getByRole('navigation',{name:'Rolga mos ish joyi'})
  await expect(workspace.getByRole('link',{name:'Sex ishlari'})).toHaveAttribute('href','/production?view=shop-floor')
  await expect(workspace.getByRole('link',{name:'Xarid buyurtmalari'})).toHaveCount(0)
  await page.goto('/purchases')
  await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toBeVisible()
  await page.goto('/admin?view=users')
  await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toBeVisible()

  // Session expiry: an expired stored session sends the employee back to Login.
  await page.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key)||'{}');s.expiresAt=new Date(Date.now()-1000).toISOString();localStorage.setItem(key,JSON.stringify(s))},SESSION_KEY)
  await page.reload()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel('Telefon, login yoki e-pochta')).toBeVisible()
})

test('Employees creates a profile then hands off a one-time login',async({page})=>{
  await page.goto('/employees')
  await page.getByRole('button',{name:'Xodim qo‘shish'}).click()
  const employee=page.getByRole('dialog',{name:'Yangi xodim'})
  await employee.getByLabel('F.I.Sh').fill('Madina Operator')
  await employee.getByRole('button',{name:'Saqlash va login yaratish'}).click()
  await expect(employee).toHaveCount(0)
  const account=page.getByRole('dialog',{name:'Akkaunt ochish'})
  const login=`e2e.employee.${randomUUID().slice(0,8)}`
  await account.getByLabel('Login').fill(login)
  const temporary=await account.locator('input.mono').inputValue()
  await account.getByRole('button',{name:'Yaratish',exact:true}).click()
  const handoff=page.getByRole('dialog',{name:'Kirish ma’lumotlari'})
  await expect(handoff).toContainText(login)
  await expect(handoff).toContainText(temporary)
  await handoff.getByRole('button',{name:'Yopish',exact:true}).last().click()
  await expect(page.getByRole('dialog',{name:'Kirish ma’lumotlari'})).toHaveCount(0)
  await signOut(page)
  await signIn(page,login,temporary)
  await expect(page.getByRole('heading',{name:'Yangi parol o‘rnating'})).toBeVisible()
})
