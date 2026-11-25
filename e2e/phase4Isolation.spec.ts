import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

test('phase 4 new tenant isolation, logout guard and owner return',async({browser},testInfo)=>{
  test.setTimeout(90_000)
  const saved=process.env.PHASE4_STATE_PATH||'',run=process.env.PHASE4_RUN_DIR||''
  test.skip(!saved||!run,'Continues a saved Phase 4 company: set PHASE4_STATE_PATH and PHASE4_RUN_DIR')
  if(!existsSync(saved)||!existsSync(run))throw new Error('PHASE4_STATE_PATH or PHASE4_RUN_DIR does not exist')
  const company=JSON.parse(readFileSync(join(run,'STATE_SUMMARY.json'),'utf8')).company as string
  const registry=join('docs','audits','evidence','phase4','TEST_ACCOUNTS.md')
  const section=readFileSync(registry,'utf8').split(`## Run ${company.slice(-8)}`)[1]?.split('## Run ')[0]
  const ownerRow=section?.split('\n').find(x=>x.includes('| business_owner |'))?.split('|').map(x=>x.trim())
  if(!ownerRow)throw new Error('Owner credentials missing from local registry')
  const owner={login:ownerRow[4],password:ownerRow[5]}
  const nonce=randomUUID().slice(0,8)
  const b={name:`ZENIX Phase4 Isolation ${nonce}`,owner:'Phase4 Isolation Owner',login:`p4.isolation.${nonce}`,password:`P4-${randomUUID()}-8b`}
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:saved})
  const page=await context.newPage()
  const shot=async(name:string)=>{const src=testInfo.outputPath(name);await page.screenshot({path:src,fullPage:true});if(!existsSync(join(run,name)))copyFileSync(src,join(run,name))}
  const signIn=async(login:string,password:string)=>{await page.goto('/login');await page.getByLabel('Telefon, login yoki e-pochta').fill(login);await page.locator('#login-password').fill(password);await page.getByRole('button',{name:'Kirish',exact:true}).click();await expect(page.locator('main h1').first()).toHaveText('Boshqaruv paneli')}
  const signOut=async()=>{await page.locator('button.profile').click();await page.getByRole('button',{name:'Chiqish'}).click();await expect(page).toHaveURL(/\/login/)}
  try{
    await page.goto('/')
    await expect(page.getByLabel('Faol kompaniya')).toHaveText(company)
    await signOut()
    await page.goto('/register')
    await page.getByLabel('Ism-familiya').fill(b.owner)
    await page.getByLabel('Kompaniya').fill(b.name)
    await page.getByLabel('Telefon raqami').fill(`+99893${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`)
    await page.locator('#register-username').fill(b.login)
    await page.locator('#register-password').fill(b.password)
    await page.locator('#register-confirm').fill(b.password)
    await page.getByRole('button',{name:'Kompaniyani ro‘yxatdan o‘tkazish'}).click()
    await expect(page.getByRole('heading',{name:'Tiklash kalitini saqlang'})).toBeVisible()
    await page.getByText('Kalitni xavfsiz joyga saqladim').click()
    await page.getByRole('button',{name:'Davom etish'}).click()
    await signIn(b.login,b.password)
    await expect(page.getByLabel('Faol kompaniya')).toHaveText(b.name)
    const bState=await page.evaluate(()=>{const id=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}').tenantId;return JSON.parse(localStorage.getItem(`zenix-erp-${id}-state`)||'{}')})
    for(const key of ['rawMaterials','suppliers','purchaseOrders','products','stockMovements','employees'])expect(bState[key]).toHaveLength(key==='employees'?1:0)
    await shot(`phase4-isolation-b-${nonce}.png`)
    await signOut()
    await page.goto('/purchases')
    await expect(page).toHaveURL(/\/login/)
    await signIn(owner.login,owner.password)
    await expect(page.getByLabel('Faol kompaniya')).toHaveText(company)
    const aState=await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-manufacturing-v3-state')||'{}'))
    expect(aState.purchaseOrders).toHaveLength(1)
    expect(aState.products).toHaveLength(1)
    expect(aState.stockTransfers).toHaveLength(1)
    await page.goto('/warehouse?view=stock')
    await shot(`phase4-isolation-a-return-${nonce}.png`)
    const finalPath=join('docs','audits','evidence','phase4',`run-${company.slice(-8)}-final.storage.json`)
    if(!existsSync(finalPath))await context.storageState({path:finalPath})
    // Evidence of an earlier run is never replaced; a repeat run records under its own nonce.
    const summary=join(run,existsSync(join(run,'ISOLATION_SUMMARY.json'))?`ISOLATION_SUMMARY-${nonce}.json`:'ISOLATION_SUMMARY.json')
    writeFileSync(summary,JSON.stringify({a:company,b:b.name,aPurchaseOrders:aState.purchaseOrders.length,bPurchaseOrders:bState.purchaseOrders.length,aEmployees:aState.employees.length,bEmployees:bState.employees.length,logoutGuard:'PASS'},null,2))
    writeFileSync(registry,`\n## Isolation owner ${nonce}\n\n| # | Role | Employee | Login | Password | Signup | Sign in | Permission |\n|---|---|---|---|---|---|---|---|\n| 1 | business_owner | ${b.owner} | ${b.login} | ${b.password} | PASS | PASS | Own empty tenant only |\n`,{flag:'a'})
  }finally{await context.close()}
})
