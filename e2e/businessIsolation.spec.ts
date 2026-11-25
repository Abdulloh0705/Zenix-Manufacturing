import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createSeedState} from '../src/data/mockData'

const A='ZENIX Demo Manufacturing'
const B='ZENIX Demo Packaging'
const nonce=randomUUID().slice(0,8)
const credentials={
  a:{user:`demo.a.${nonce}`,password:`Demo-A-${randomUUID().slice(0,12)}9a`},
  b:{user:`demo.b.${nonce}`,password:`Demo-B-${randomUUID().slice(0,12)}9a`},
}
const stateKey=(id:string)=>id==='tenant-legacy-v3'?'zenix-manufacturing-v3-state':`zenix-erp-${id}-state`

async function register(page:Page,company:string,name:string,login:string,password:string,phone:string){
  await page.goto('/register')
  const additional=await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-saas-v1')||'{"tenants":[]}').tenants.length>0)
  await page.getByLabel('Ism-familiya').fill(name)
  await page.getByLabel('Kompaniya').fill(company)
  await page.getByLabel('Telefon raqami').fill(phone)
  await page.locator('#register-username').fill(login)
  await page.locator('#register-password').fill(password)
  await page.locator('#register-confirm').fill(password)
  await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
  await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
  await page.getByText('Kalitni xavfsiz joyga saqladim').click()
  await page.getByRole('button',{name:'Davom etish'}).click()
  if(additional){await expect(page).toHaveURL(/\/login/);await signIn(page,login,password)}
  await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
  return page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId as string)
}
async function signIn(page:Page,login:string,password:string){
  await page.goto('/login')
  await page.getByLabel('Telefon, login yoki e-pochta').fill(login)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button',{name:'Kirish',exact:true}).click()
  await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
}
async function signOut(page:Page){
  await page.locator('button.profile').click()
  await page.getByRole('button',{name:'Chiqish'}).click()
  await expect(page).toHaveURL(/\/login/)
}

test('platform registration, populated A business, nine role accounts, and two-way isolation',async({browser},testInfo)=>{
  test.setTimeout(240_000)
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:{cookies:[],origins:[]}})
  const page=await context.newPage()
  try{
    await page.goto('/platform')
    await expect(page.getByText('Platform administrator kirishi')).toBeVisible()
    // The platform UI has no account/password bootstrap. Its supported create-company control explains registration.
    const jwk=JSON.parse(process.env.ZENIX_E2E_PLATFORM_JWK||'null')
    expect(jwk).toBeTruthy()
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])
    const actor='qa.platform',expiresAt=Date.now()+20*60_000
    const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(`zenix-platform-v1|${actor}|${expiresAt}`))
    await page.getByLabel('Operator ID').fill(actor)
    await page.getByLabel('Imzolangan chipta').fill(`ZXR1.${expiresAt}.${Buffer.from(sig).toString('base64url')}`)
    await page.getByRole('button',{name:'Platformaga kirish'}).click()
    await expect(page.locator('.pf-title h1')).toHaveText('Platforma ko‘rinishi')
    await page.goto('/platform/companies')
    await page.getByRole('button',{name:'Yangi kompaniya'}).click()
    await expect(page.getByRole('dialog')).toContainText('/register')
    await page.getByRole('dialog').getByRole('link',{name:'Ro‘yxatdan o‘tish sahifasi'}).click()
    await expect(page).toHaveURL(/\/register/)

    const aId=await register(page,A,'Demo A Owner',credentials.a.user,credentials.a.password,'+998901110001')
    expect(aId).toMatch(/^tenant-/)
    const aNew=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),stateKey(aId))
    expect(aNew).toMatchObject({settings:{company:{name:A}},products:[],purchaseOrders:[],salesOrders:[]})
    const seed=createSeedState(new Date())
    // Existing test-only domain history exercises procurement, stock, manufacturing, sales, QC, and finance.
    // Keep the registered owner and tenant identity; no application data outside this fresh browser context is touched.
    const populated={...seed,
      suppliers:seed.suppliers.map((s,i)=>({...s,name:`Demo A ${s.name}`,phone:`+9989000001${String(i).padStart(2,'0')}`,email:`supplier${i}@example.invalid`,contactPerson:`Demo Contact ${i+1}`,address:'Demo Industrial Park',inn:String(i+1).padStart(9,'0'),bankAccount:String(i+1).padStart(20,'0'),mfo:String(i+1).padStart(5,'0')})),
      customers:seed.customers.map((c,i)=>({...c,name:`Demo A ${c.name}`,phone:`+9989000002${String(i).padStart(2,'0')}`,email:`customer${i}@example.invalid`})),
      employees:[{...seed.employees[0],...aNew.employees[0]},...seed.employees.slice(1).map(e=>({...e,name:`Demo A ${e.name}`}))],roles:aNew.roles,
      settings:{...seed.settings,company:{...seed.settings.company,name:A,taxId:'DEMO-A-001'}}}
    await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:stateKey(aId),state:populated})
    await page.reload()
    await expect(page.getByLabel('Faol kompaniya')).toHaveText(A)
    await page.screenshot({path:testInfo.outputPath('business-a-dashboard.png'),fullPage:true})

    const people=[
      {name:'Daler Production Manager',role:'Ishlab chiqarish menejeri',department:'Production',branch:'Toshkent zavodi'},
      {name:'Kamola Production Operator',role:'Operator',department:'Production',branch:'Toshkent zavodi',workCenter:'Extrusion Press'},
      {name:'Farhod Warehouse Manager',role:'Omborchi',department:'Warehouse',branch:'Toshkent zavodi',warehouse:'Xomashyo ombori'},
      {name:'Maftuna Warehouse Operator',role:'Omborchi',department:'Warehouse',branch:'Chirchiq sexi',warehouse:'Chirchiq ombori'},
      {name:'Jasur Procurement Manager',role:'Ta’minot va sotuv menejeri',department:'Procurement',branch:'Toshkent zavodi'},
      {name:'Nilufar Sales Manager',role:'Ta’minot va sotuv menejeri',department:'Sales',branch:'Toshkent zavodi'},
      {name:'Aziza Quality Inspector',role:'Sifat nazoratchisi',department:'Quality',branch:'Toshkent zavodi'},
      {name:'Sardor Maintenance Technician',role:'Texnik xizmat muhandisi',department:'Maintenance',branch:'Toshkent zavodi'},
      {name:'Demo A Business Admin',role:'Admin / Direktor',department:'Management',branch:'Toshkent zavodi'},
    ]
    const rolePasswords=new Map<number,string>()
    await page.goto('/admin?view=users')
    for(let i=0;i<people.length;i++){
      const p=people[i]
      await page.getByRole('button',{name:'Foydalanuvchi qo‘shish'}).click()
      const dialog=page.getByRole('dialog',{name:'Foydalanuvchi qo‘shish'})
      await dialog.getByRole('tab',{name:/Yangi xodim/}).click()
      await dialog.getByLabel('F.I.Sh').fill(p.name)
      await dialog.getByLabel('Bo‘lim').click()
      await page.getByRole('option',{name:p.department,exact:true}).click()
      await dialog.getByRole('combobox',{name:'Rol'}).click()
      await page.getByRole('option',{name:p.role,exact:true}).click()
      await dialog.getByLabel('Filial').click()
      await page.getByRole('option',{name:p.branch,exact:true}).click()
      if(p.workCenter){await dialog.getByLabel('Ish markazi').click();await page.getByRole('option',{name:p.workCenter,exact:true}).click()}
      if(p.warehouse){await dialog.getByLabel('Ish ombori').click();await page.getByRole('option',{name:p.warehouse,exact:true}).click()}
      await dialog.getByLabel(/^Login/).fill(`demo.${nonce}.${i}`)
      if([1,2,6,8].includes(i))rolePasswords.set(i,await dialog.locator('input.mono').inputValue())
      await dialog.getByRole('button',{name:'Yaratish',exact:true}).click()
      await expect(page.getByRole('dialog',{name:'Kirish ma’lumotlari'})).toBeVisible()
      await page.getByRole('dialog',{name:'Kirish ma’lumotlari'}).getByRole('button',{name:'Yopish'}).last().click()
      await page.locator('.drawer-overlay .modal-close').click()
    }
    const aState=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),stateKey(aId))
    const aAuth=await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}'))
    for(const p of people)expect(aState.employees.some((e:{name:string})=>e.name===p.name)).toBe(true)
    expect(aState.branches.length).toBeGreaterThanOrEqual(2)
    expect(aState.warehouses.length).toBeGreaterThanOrEqual(2)
    expect(aState.workCenters.length).toBeGreaterThanOrEqual(2)
    expect(aState.purchaseOrders.length).toBeGreaterThan(0)
    expect(aState.suppliers.every((s:{bankAccount?:string;mfo?:string})=>s.bankAccount?.length===20&&s.mfo?.length===5)).toBe(true)
    expect(aState.productionOrders.length).toBeGreaterThan(0)
    expect(aState.salesOrders.length).toBeGreaterThan(0)
    expect(aAuth.accounts.filter((a:{username:string})=>a.username.startsWith(`demo.${nonce}.`))).toHaveLength(9)
    await signOut(page)

    for(const index of [8,1,2,6]){
      await page.goto('/login')
      await page.getByLabel('Telefon, login yoki e-pochta').fill(`demo.${nonce}.${index}`)
      await page.locator('#login-password').fill(rolePasswords.get(index)!)
      await page.getByRole('button',{name:'Kirish',exact:true}).click()
      await expect(page.getByRole('heading',{name:'Yangi parol o‘rnating'})).toBeVisible()
      const replacement=`New-${randomUUID().slice(0,12)}9a`
      await page.locator('#pw-current').fill(rolePasswords.get(index)!)
      await page.locator('#pw-next').fill(replacement)
      await page.locator('#pw-confirm').fill(replacement)
      await page.getByRole('button',{name:'Parolni saqlash'}).click()
      await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
      if(index===8){
        await page.goto('/admin?view=users')
        await expect(page.getByText('Demo A Business Admin').first()).toBeVisible()
        await page.goto('/warehouse?view=lots&q=LOT-RM-AL-6063-OPEN')
        await expect(page.getByText('LOT-RM-AL-6063-OPEN')).toBeVisible()
      }else{
        await page.goto(index===1?'/purchases':index===2?'/equipment':'/admin?view=users')
        await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toBeVisible()
      }
      await signOut(page)
    }

    const bId=await register(page,B,'Demo B Owner',credentials.b.user,credentials.b.password,'+998901110002')
    expect(bId).not.toBe(aId)
    await page.screenshot({path:testInfo.outputPath('business-b-dashboard.png'),fullPage:true})
    const bState=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),stateKey(bId))
    expect(bState.settings.company.name).toBe(B)
    for(const key of ['suppliers','customers','rawMaterials','products','boms','purchaseOrders','salesOrders','productionOrders','qualityChecks','maintenanceOrders','lots','receivables','payables'])expect(bState[key]).toHaveLength(0)
    expect(bState.employees).toHaveLength(1)
    await page.goto(`/sales?view=orders&id=${encodeURIComponent(aState.salesOrders[0].id)}`)
    await expect(page.locator('.drawer-overlay')).toHaveCount(0)
    await page.goto('/sales?view=customers&q=Demo%20A%20BuildTech')
    await expect(page.getByText('Demo A BuildTech Group')).toHaveCount(0)
    await page.goto('/warehouse?view=lots&q=LOT-RM-AL-6063-OPEN')
    await expect(page.getByText('LOT-RM-AL-6063-OPEN')).toHaveCount(0)
    await page.goto('/sales?view=customers')
    await page.getByRole('button',{name:'Mijoz qo‘shish'}).click()
    const customer=page.getByRole('dialog',{name:'Yangi mijoz'})
    await customer.getByLabel('Nomi').fill('Demo B Buyer')
    await customer.getByLabel('Telefon').fill('+998900000301')
    await customer.getByLabel('Email').fill('buyer@example.invalid')
    await customer.getByRole('button',{name:'Saqlash'}).click()
    await expect(page.getByText('Demo B Buyer')).toBeVisible()
    const [bExport]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV'}).click()])
    const bCsv=readFileSync((await bExport.path())!,'utf8')
    expect(bCsv).toContain('Demo B Buyer')
    expect(bCsv).not.toContain('Demo A BuildTech Group')
    await page.reload()
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId)).toBe(bId)
    await signOut(page)
    await signIn(page,credentials.a.user,credentials.a.password)
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId)).toBe(aId)
    await page.goto('/warehouse?view=lots&q=LOT-RM-AL-6063-OPEN')
    await expect(page.getByText('LOT-RM-AL-6063-OPEN')).toBeVisible()
    await page.goto('/sales?view=customers&q=Demo%20B%20Buyer')
    await expect(page.getByText('Demo B Buyer')).toHaveCount(0)
    await page.goto('/sales?view=customers')
    const [aExport]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV'}).click()])
    const aCsv=readFileSync((await aExport.path())!,'utf8')
    expect(aCsv).toContain('Demo A BuildTech Group')
    expect(aCsv).not.toContain('Demo B Buyer')
    const final=await page.evaluate(({aKey,bKey})=>({a:localStorage.getItem(aKey),b:localStorage.getItem(bKey),saas:JSON.parse(localStorage.getItem('zenix-saas-v1')||'{}')}),{aKey:stateKey(aId),bKey:stateKey(bId)})
    expect(JSON.parse(final.a!).settings.company.name).toBe(A)
    expect(JSON.parse(final.b!).settings.company.name).toBe(B)
    expect(JSON.parse(final.b!).customers.map((c:{name:string})=>c.name)).toEqual(['Demo B Buyer'])
    expect(JSON.parse(final.a!).customers.some((c:{name:string})=>c.name==='Demo B Buyer')).toBe(false)
    expect(final.saas.memberships.filter((m:{tenantId:string})=>m.tenantId===aId)).toHaveLength(10)
    expect(final.saas.memberships.filter((m:{tenantId:string})=>m.tenantId===bId)).toHaveLength(1)
    for(const id of [aId,bId])expect(final.saas.subscriptions.find((s:{tenantId:string})=>s.tenantId===id)).toMatchObject({planId:'enterprise',status:'trial'})
    await page.goto('/platform/companies')
    await expect(page.getByText(A,{exact:true})).toBeVisible()
    await expect(page.getByText(B,{exact:true})).toBeVisible()
    await page.screenshot({path:testInfo.outputPath('platform-companies.png'),fullPage:true})
  }finally{await context.close()}
})
