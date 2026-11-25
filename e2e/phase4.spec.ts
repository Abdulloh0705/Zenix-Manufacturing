import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

// One isolated, local-only company. All business records below are entered through the UI.
test('phase 4 fresh-company business simulation',async({browser},testInfo)=>{
  test.setTimeout(600_000)
  const nonce=randomUUID().slice(0,8)
  const company=`ZENIX Phase4 Factory ${nonce}`
  const root=join('docs','audits','evidence','phase4')
  const run=join(root,`run-${nonce}`)
  if(existsSync(run))throw new Error('Phase 4 evidence path already exists')
  mkdirSync(run,{recursive:true})
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:{cookies:[],origins:[]}})
  const page=await context.newPage()
  const records:{stage:string;expected:string;actual:string;image:string}[]=[]
  const accounts:{role:string;name:string;login:string;password:string;signIn:string;permission:string}[]=[]
  const owner={role:'business_owner',name:'Phase4 Business Owner',login:`p4.owner.${nonce}`,password:`P4-${randomUUID()}-9a`,signIn:'PENDING',permission:'PENDING'}
  accounts.push(owner)
  async function shot(stage:string,expected:string,actual:string){
    const name=`${String(records.length+1).padStart(2,'0')}-${stage}.png`
    const source=testInfo.outputPath(name)
    await page.screenshot({path:source,fullPage:true})
    copyFileSync(source,join(run,name))
    records.push({stage,expected,actual,image:`run-${nonce}/${name}`})
  }
  async function state(){return page.evaluate(()=>{const session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}');const key=session.tenantId==='tenant-legacy-v3'?'zenix-manufacturing-v3-state':`zenix-erp-${session.tenantId}-state`;return {tenantId:session.tenantId,data:JSON.parse(localStorage.getItem(key)||'{}')}})}
  async function signOut(){await page.locator('button.profile').click();await page.getByRole('button',{name:'Chiqish'}).click();await expect(page).toHaveURL(/\/login/)}
  async function signIn(login:string,password:string){await page.goto('/login');await page.getByLabel('Telefon, login yoki e-pochta').fill(login);await page.locator('#login-password').fill(password);await page.getByRole('button',{name:'Kirish',exact:true}).click()}
  try{
    await page.goto('/')
    await expect(page).toHaveURL(/\/register/)
    await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
    await expect(page.getByText('Ism-familiyani kiriting')).toBeVisible()
    await shot('signup-validation','Required name rejected','Name validation visible')
    await page.getByLabel('Ism-familiya').fill(owner.name)
    await page.getByLabel('Kompaniya').fill(company)
    await page.getByLabel('Telefon raqami').fill(`+99897${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)
    await page.locator('#register-username').fill(owner.login)
    await page.locator('#register-password').fill(owner.password)
    await page.locator('#register-confirm').fill(owner.password)
    await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
    await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
    await page.getByText('Kalitni xavfsiz joyga saqladim').click()
    await page.getByRole('button',{name:'Davom etish'}).click()
    await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
    const initial=await state()
    expect(initial.data.products).toHaveLength(0)
    expect(initial.data.workCenters).toHaveLength(0)
    expect(initial.data.employees).toHaveLength(1)
    await shot('new-company-dashboard','Empty new tenant workspace','One owner, zero products and work centers')
    await signOut()
    await signIn(owner.login,'incorrect-password')
    await expect(page).toHaveURL(/\/login/)
    await signIn(owner.login,owner.password)
    await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
    owner.signIn='PASS'
    owner.permission='Owner dashboard visible'
    await page.reload()
    await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
    await shot('owner-relogin','Login and refresh retain session','PASS in isolated browser storage')

    await page.goto('/settings?view=locations')
    await page.getByRole('button',{name:'Qo‘shish'}).first().click()
    const branch=page.getByRole('dialog',{name:'Yangi filial'})
    await branch.getByLabel('Nomi').fill('Phase4 East Branch')
    await branch.getByLabel('Kod').fill(`E${nonce.toUpperCase()}`)
    await branch.getByRole('button',{name:'Saqlash'}).click()
    // Fixed after run 38407e97: the owner was refused (settings.create does not exist); it now uses settings.edit.
    await expect(branch).toHaveCount(0)
    expect((await state()).data.branches).toHaveLength(2)
    await shot('branch-created','New branch saved','Second branch stored')
    await page.getByRole('button',{name:'Qo‘shish'}).last().click()
    const line=page.getByRole('dialog',{name:'Yangi liniya'})
    await line.getByLabel('Nomi').fill('Phase4 Assembly Line')
    await line.getByLabel('Kod').fill(`L${nonce.toUpperCase()}`)
    await line.getByRole('button',{name:'Saqlash'}).click()
    await expect(line).toHaveCount(0)
    expect((await state()).data.productionLines).toHaveLength(1)
    await shot('line-created','New production line saved','One production line stored')
    await page.goto('/equipment?view=work-centers')
    await page.getByRole('button',{name:'Work center qo‘shish'}).click()
    const center=page.getByRole('dialog',{name:'Yangi work center'})
    await center.getByLabel('Nomi').fill('Phase4 Press Cell')
    await center.getByLabel('Kod').fill(`WC${nonce.toUpperCase()}`)
    await center.getByRole('button',{name:'Saqlash'}).click()
    await expect(center).toHaveCount(0)
    expect((await state()).data.workCenters).toHaveLength(1)
    await shot('work-center-created','New work center on the line','One work center stored')

    await page.goto('/materials')
    await page.getByRole('button',{name:'Xomashyo qo‘shish'}).click()
    const material=page.getByRole('dialog',{name:'Yangi xomashyo'})
    await material.getByLabel('Nomi').fill('Phase4 Steel Coil')
    await material.getByLabel('SKU').fill(`P4-RM-${nonce}`)
    await material.getByLabel('Kategoriya').fill('Metal')
    await material.getByLabel('Standart narx').fill('12000')
    await material.getByRole('button',{name:'Saqlash'}).click()
    await expect(page.getByText('Phase4 Steel Coil').first()).toBeVisible()
    await shot('raw-material-created','Raw material saved','Material visible in list')

    await page.goto('/purchases?view=suppliers')
    await page.getByRole('button',{name:'Supplier qo‘shish'}).click()
    const supplier=page.getByRole('dialog',{name:'Yangi supplier'})
    await supplier.getByLabel('Nomi').fill('Phase4 Metals Supplier')
    await supplier.getByLabel('Telefon').fill('+998901112233')
    await supplier.getByLabel('Email').fill('phase4@example.invalid')
    await supplier.getByRole('button',{name:'Material',exact:true}).click()
    await supplier.getByLabel('Narx').fill('10000')
    await supplier.getByRole('button',{name:'Saqlash'}).click()
    await expect(page.getByText('Phase4 Metals Supplier').first()).toBeVisible()
    await shot('supplier-created','Supplier linked to material','Supplier visible in list')

    await page.goto('/purchases?view=orders')
    await page.getByRole('button',{name:'Yangi PO'}).click()
    const po=page.getByRole('dialog',{name:'Yangi Purchase Order'})
    await po.getByLabel('Miqdor').fill('100')
    await po.getByLabel('Narx').fill('10000')
    await po.getByRole('button',{name:'Yaratish va tasdiqlash'}).click()
    const afterPo=await state()
    expect(afterPo.data.purchaseOrders).toHaveLength(1)
    await shot('purchase-order-created','100 kg at 10,000 UZS per kg','PO saved in browser storage')

    await page.goto('/purchases?view=receiving')
    await expect(page.getByRole('heading',{name:'Qabul qilish'})).toBeVisible()
    await page.getByLabel('Miqdor (kg)').fill('40')
    await page.getByRole('button',{name:'Qisman qabul'}).click()
    const partial=await state()
    expect(partial.data.purchaseOrders[0].items[0].received).toBe(40)
    await shot('partial-goods-receipt','40/100 kg received','PO received quantity 40 kg')
    await page.getByLabel('Miqdor (kg)').fill('60')
    await page.getByRole('button',{name:'Qabul',exact:true}).click()
    const received=await state()
    expect(received.data.purchaseOrders[0].items[0].received).toBe(100)
    expect(received.data.stockMovements.length).toBeGreaterThanOrEqual(2)
    await shot('full-goods-receipt','100/100 kg received','Two receipt movements, PO fully received')
    await page.goto('/warehouse?view=stock')
    await shot('inventory-after-receipt','100 kg raw material on hand','Warehouse stock view after UI receipts')

    await page.goto('/admin?view=users')
    const people=[
      {role:'admin',name:'Phase4 Admin',label:'Admin / Direktor',department:'Management',allow:'/admin?view=users',deny:'/platform'},
      {role:'production_manager',name:'Phase4 Production Manager',label:'Ishlab chiqarish menejeri',department:'Production',allow:'/production',deny:'/admin?view=users'},
      {role:'supply_sales',name:'Phase4 Procurement Manager',label:'Ta’minot va sotuv menejeri',department:'Procurement',allow:'/purchases',deny:'/admin?view=users'},
      {role:'supply_sales',name:'Phase4 Sales Manager',label:'Ta’minot va sotuv menejeri',department:'Sales',allow:'/sales',deny:'/admin?view=users'},
      {role:'warehouse',name:'Phase4 Warehouse Manager',label:'Omborchi',department:'Warehouse',warehouse:'Asosiy ombor',allow:'/warehouse',deny:'/admin?view=users'},
      {role:'warehouse',name:'Phase4 Warehouse Operator',label:'Omborchi',department:'Warehouse',warehouse:'Asosiy ombor',allow:'/warehouse',deny:'/admin?view=users'},
      {role:'quality',name:'Phase4 Quality Controller',label:'Sifat nazoratchisi',department:'Quality',allow:'/quality',deny:'/admin?view=users'},
      {role:'maintenance',name:'Phase4 Maintenance Engineer',label:'Texnik xizmat muhandisi',department:'Maintenance',allow:'/equipment',deny:'/admin?view=users'},
    ]
    for(let i=0;i<people.length;i++){
      const p=people[i]
      await page.getByRole('button',{name:'Foydalanuvchi qo‘shish'}).click()
      const dialog=page.getByRole('dialog',{name:'Foydalanuvchi qo‘shish'})
      await dialog.getByRole('tab',{name:/Yangi xodim/}).click()
      await dialog.getByLabel('F.I.Sh').fill(p.name)
      await dialog.getByLabel('Bo‘lim').click()
      await page.getByRole('option',{name:p.department,exact:true}).click()
      await dialog.getByRole('combobox',{name:'Rol'}).click()
      await page.getByRole('option',{name:p.label,exact:true}).click()
      // The form defaults to the newest branch (finding P4-U-01); these employees belong to the main site.
      await dialog.getByRole('combobox',{name:'Filial'}).click();await page.getByRole('option',{name:'Asosiy filial',exact:true}).click()
      if(p.warehouse){await dialog.getByLabel('Ish ombori').click();await page.getByRole('option',{name:p.warehouse,exact:true}).click()}
      const login=`p4.${nonce}.${i}`
      await dialog.getByLabel(/^Login/).fill(login)
      const temporary=await dialog.locator('input.mono').inputValue()
      await dialog.getByRole('button',{name:'Yaratish',exact:true}).click()
      await expect(page.getByRole('dialog',{name:'Kirish ma’lumotlari'})).toBeVisible()
      accounts.push({role:p.role,name:p.name,login,password:temporary,signIn:'PENDING',permission:'PENDING'})
      await page.getByRole('dialog',{name:'Kirish ma’lumotlari'}).getByRole('button',{name:'Yopish'}).last().click()
      await page.locator('.drawer-overlay .modal-close').click()
    }
    await shot('role-accounts-created','Eight distinct employee accounts','Eight role-scoped employees listed')
    await signOut()
    for(let i=0;i<people.length;i++){
      const p=people[i],a=accounts[i+1]
      await signIn(a.login,a.password)
      await expect(page.getByRole('heading',{name:'Yangi parol o‘rnating'})).toBeVisible()
      const replacement=`P4-${randomUUID()}-7z`
      await page.locator('#pw-current').fill(a.password)
      await page.locator('#pw-next').fill(replacement)
      await page.locator('#pw-confirm').fill(replacement)
      await page.getByRole('button',{name:'Parolni saqlash'}).click()
      await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
      a.password=replacement;a.signIn='PASS'
      await page.goto(p.allow)
      await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toHaveCount(0)
      await page.goto(p.deny)
      if(p.deny==='/platform')await expect(page.getByText('Platform administrator kirishi')).toBeVisible()
      else await expect(page.getByRole('heading',{name:'Ruxsat mavjud emas'})).toBeVisible()
      a.permission=`PASS: ${p.allow} allowed; ${p.deny} denied`
      await shot(`role-${i+1}-deny`,'Forbidden route rejected',a.permission)
      if(p.deny==='/platform')await page.goto('/')
      await signOut()
    }
    await signIn(owner.login,owner.password)
    await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')
    await page.goto('/admin?view=users')
    await page.getByRole('button',{name:'Foydalanuvchi qo‘shish'}).click()
    const op=page.getByRole('dialog',{name:'Foydalanuvchi qo‘shish'})
    await op.getByRole('tab',{name:/Yangi xodim/}).click()
    await op.getByRole('combobox',{name:'Rol'}).click()
    await page.getByRole('option',{name:'Operator',exact:true}).click()
    await op.getByLabel('Ish markazi').click()
    await expect(page.getByRole('option',{name:'Phase4 Press Cell',exact:true})).toBeVisible()
    await page.keyboard.press('Escape')
    await shot('operator-work-center','Operator can select a work center','Work center offered to the operator role')
    await op.getByRole('button',{name:'Bekor qilish'}).click()
  }finally{
    const snapshot=await state().catch(()=>null)
    if(snapshot?.tenantId){
      const storagePath=join(root,`run-${nonce}.storage.json`)
      if(!existsSync(storagePath))await context.storageState({path:storagePath})
      writeFileSync(join(run,'STATE_SUMMARY.json'),JSON.stringify({company,tenantId:snapshot.tenantId,recordIds:Object.fromEntries(['branches','productionLines','workCenters','rawMaterials','suppliers','purchaseOrders','stockMovements','qualityChecks','productionOrders','employees'].map(k=>[k,(snapshot.data[k]||[]).map((r:{id:string})=>r.id)]))},null,2))
    }
    const registry=process.env.PHASE4_ACCOUNTS_PATH||join(root,'TEST_ACCOUNTS.md')
    const content=`\n## Run ${nonce}\n\nCompany: ${company}\nBrowser state: run-${nonce}.storage.json (same origin only; localStorage backed)\n\n| # | Role | Employee | Login | Password | Signup | Sign in | Permission |\n|---|---|---|---|---|---|---|---|\n${accounts.map((a,i)=>`| ${i+1} | ${a.role} | ${a.name} | ${a.login} | ${a.password} | PASS | ${a.signIn} | ${a.permission} |`).join('\n')}\n`
    if(existsSync(registry))writeFileSync(registry,content,{flag:'a'})
    else writeFileSync(registry,`# Phase 4 local test accounts\n${content}`)
    writeFileSync(join(run,'SCREENSHOTS.md'),`# Screenshot metadata\n\n${records.map(r=>`- ${r.image}: ${r.stage}; desktop 1366×900; expected: ${r.expected}; actual: ${r.actual}; source: browser storage/UI state.`).join('\n')}\n`)
    await context.close()
  }
})
