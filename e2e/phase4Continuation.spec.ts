import {test,expect} from '@playwright/test'
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

test('phase 4 product, BOM and responsive route audit on the saved fresh company',async({browser},testInfo)=>{
  test.setTimeout(120_000)
  const saved=process.env.PHASE4_STATE_PATH||''
  const run=process.env.PHASE4_RUN_DIR||''
  test.skip(!saved||!run,'Continues a saved Phase 4 company: set PHASE4_STATE_PATH and PHASE4_RUN_DIR')
  if(!existsSync(saved)||!existsSync(run))throw new Error('PHASE4_STATE_PATH or PHASE4_RUN_DIR does not exist')
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:saved})
  const page=await context.newPage()
  const company=JSON.parse(readFileSync(join(run,'STATE_SUMMARY.json'),'utf8')).company as string
  const findings:{route:string;device:string;heading:string;overflow:boolean;error:string[]}[]=[]
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  const shot=async(name:string)=>{const source=testInfo.outputPath(name);await page.screenshot({path:source,fullPage:true});if(!existsSync(join(run,name)))copyFileSync(source,join(run,name))}
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-manufacturing-v3-state')||'{}'))
  try{
    await page.goto('/')
    await expect(page.getByLabel('Faol kompaniya')).toHaveText(company)
    await page.goto('/products')
    await page.getByRole('button',{name:'Mahsulot qo‘shish'}).click()
    const product=page.getByRole('dialog',{name:'Yangi mahsulot'})
    await product.getByLabel('Nomi').fill('Phase4 Steel Bracket')
    await product.getByLabel('SKU').fill(`P4-FG-${company.slice(-8).toUpperCase()}`)
    await product.getByLabel('Kategoriya').fill('Metal Parts')
    await product.getByLabel('Sotuv narxi').fill('30000')
    await product.getByLabel('Standart tannarx').fill('12000')
    await product.getByRole('button',{name:'Saqlash'}).click()
    expect((await state()).products).toHaveLength(1)
    await shot('phase4-finished-product-desktop.png')
    await page.goto('/products?view=bom')
    await page.getByRole('button',{name:'Yangi BOM'}).click()
    await page.getByRole('dialog',{name:'Yangi BOM revision'}).getByRole('button',{name:'Draft yaratish'}).click()
    expect((await state()).boms).toHaveLength(1)
    await page.getByRole('button',{name:'Tahrirlash',exact:true}).click()
    const editor=page.getByRole('dialog').filter({hasText:'Komponentlar'}).last()
    await editor.getByRole('button',{name:'Komponent',exact:true}).click()
    await editor.getByRole('button',{name:'Operatsiya',exact:true}).click()
    await editor.getByLabel('Nomi').fill('Cut and press')
    await editor.getByRole('button',{name:'Saqlash'}).click()
    await expect(editor.getByRole('alert')).toBeVisible()
    await shot('phase4-bom-blocked-desktop.png')
    await editor.getByRole('button',{name:'Yopish'}).last().click()

    const routes=['/','/production','/products','/materials','/warehouse','/purchases','/sales','/quality','/equipment','/employees','/costs','/reports','/settings','/ai','/admin','/subscription']
    for(const device of ['desktop','mobile']){
      await page.setViewportSize(device==='desktop'?{width:1366,height:900}:{width:393,height:850})
      for(const route of routes){
        const before=errors.length
        await page.goto(route)
        await expect(page.locator('main h1').first()).toBeVisible()
        const heading=await page.locator('main h1').first().innerText()
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
        findings.push({route,device,heading,overflow,error:errors.slice(before)})
        if(['/','/warehouse','/purchases','/production','/reports'].includes(route))await shot(`phase4-${device}-${route==='/'?'dashboard':route.slice(1)}.png`)
      }
    }
    await page.reload()
    expect((await state()).products).toHaveLength(1)
    expect((await state()).purchaseOrders).toHaveLength(1)
    const next=join('docs','audits','evidence','phase4',`run-${company.slice(-8)}-stage2.storage.json`)
    if(!existsSync(next))await context.storageState({path:next})
  }finally{
    if(!existsSync(join(run,'ROUTE_AUDIT_FINAL.json')))writeFileSync(join(run,'ROUTE_AUDIT_FINAL.json'),JSON.stringify(findings,null,2))
    if(!existsSync(join(run,'STAGE2_SUMMARY_FINAL.json')))writeFileSync(join(run,'STAGE2_SUMMARY_FINAL.json'),JSON.stringify({products:(await state().catch(()=>({products:[]}))).products?.map((p:{id:string})=>p.id),boms:(await state().catch(()=>({boms:[]}))).boms?.map((b:{id:string})=>b.id),pageErrors:errors},null,2))
    const metadata=`\n## Continuation screenshots\n\n${['phase4-finished-product-desktop.png','phase4-bom-blocked-desktop.png',...['desktop','mobile'].flatMap(d=>['dashboard','warehouse','purchases','production','reports'].map(r=>`phase4-${d}-${r}.png`))].filter(name=>existsSync(join(run,name))).map(name=>`- ${name}: ${name.includes('mobile')?'mobile 393×850':'desktop 1366×900'}; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.`).join('\n')}\n`
    writeFileSync(join(run,'SCREENSHOTS.md'),metadata,{flag:'a'})
    await context.close()
  }
})
