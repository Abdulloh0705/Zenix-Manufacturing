import {test,expect} from '@playwright/test'
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

test('phase 4 invoice, payment and warehouse transfer through the saved company UI',async({browser},testInfo)=>{
  test.setTimeout(120_000)
  const saved=process.env.PHASE4_STATE_PATH||'',run=process.env.PHASE4_RUN_DIR||''
  test.skip(!saved||!run,'Continues a saved Phase 4 company: set PHASE4_STATE_PATH and PHASE4_RUN_DIR')
  if(!existsSync(saved)||!existsSync(run))throw new Error('PHASE4_STATE_PATH or PHASE4_RUN_DIR does not exist')
  const company=JSON.parse(readFileSync(join(run,'STATE_SUMMARY.json'),'utf8')).company as string
  const suffix=process.env.PHASE4_EVIDENCE_SUFFIX||''
  // Saved Phase 4 sessions expire after inactivity; refresh this isolated context only, never the storage file.
  const storage=JSON.parse(readFileSync(saved,'utf8'))
  for(const origin of storage.origins){const entry=origin.localStorage.find((v:{name:string})=>v.name==='zenix-session-v1');if(entry){const session=JSON.parse(entry.value),now=new Date();entry.value=JSON.stringify({...session,lastActivity:now.toISOString(),expiresAt:new Date(now.getTime()+12*60*60*1000).toISOString()})}}
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:storage})
  const page=await context.newPage()
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-manufacturing-v3-state')||'{}'))
  const shot=async(name:string)=>{const actual=suffix?name.replace(/\.png$/,`-${suffix}.png`):name;const source=testInfo.outputPath(actual);await page.screenshot({path:source,fullPage:true});if(!existsSync(join(run,actual)))copyFileSync(source,join(run,actual))}
  try{
    await page.goto('/')
    await expect(page.getByLabel('Faol kompaniya')).toHaveText(company)
    const before=await state()
    const po=before.purchaseOrders[0]
    expect(po.items[0].received).toBe(100)
    await page.goto(`/purchases?view=orders&id=${po.id}`)
    const drawer=page.getByRole('dialog').filter({hasText:po.code}).first()
    await drawer.getByRole('tab',{name:/Invoice \/ to‘lov/}).click()
    await drawer.getByRole('button',{name:'Invoice kiritish'}).click()
    const invoice=page.getByRole('dialog',{name:'Supplier invoice'})
    await invoice.getByPlaceholder('Supplier hujjat raqami').fill(`P4-INV-${company.slice(-8)}`)
    await invoice.getByRole('button',{name:'Kiritish'}).click()
    const invoiceDrawer=page.getByRole('dialog').filter({hasText:`P4-INV-${company.slice(-8)}`}).last()
    await invoiceDrawer.getByRole('button',{name:'Tasdiqlash'}).click()
    await page.getByRole('dialog',{name:'Invoice’ni tasdiqlash'}).getByRole('button',{name:'Tasdiqlash'}).click()
    expect((await state()).supplierInvoices).toHaveLength(1)
    await shot('phase4-invoice-approved-desktop.png')
    await page.keyboard.press('Escape')
    await drawer.getByRole('button',{name:'Supplier to‘lovini qayd etish'}).click()
    const pay=page.getByRole('dialog',{name:'Supplier to‘lovi'})
    await pay.locator('input').first().fill('200000')
    await pay.locator('textarea').fill('Phase4 local test bank payment')
    await pay.getByRole('button',{name:'To‘lovni yozish'}).click()
    const finance=await state()
    expect(finance.payables.filter((e:{kind:string})=>e.kind==='payment')).toHaveLength(1)
    expect(finance.supplierInvoices[0].total).toBe(1_000_000)
    expect(finance.payables.reduce((n:number,e:{amount:number})=>n+e.amount,0)).toBe(800_000)
    await shot('phase4-partial-payment-desktop.png')

    await page.goto('/warehouse?view=warehouses')
    await page.getByRole('button',{name:'Ombor qo‘shish'}).click()
    const warehouse=page.getByRole('dialog',{name:'Yangi ombor'})
    await warehouse.getByLabel('Nomi').fill('Phase4 Secondary Raw Store')
    await warehouse.getByLabel('Kod').fill(`P4-WH-${company.slice(-8)}`)
    await warehouse.getByRole('button',{name:'Saqlash'}).click()
    expect((await state()).warehouses).toHaveLength(2)
    await shot('phase4-second-warehouse-desktop.png')
    await page.goto('/warehouse?view=transfers')
    await page.getByRole('button',{name:'Yangi transfer'}).click()
    const transfer=page.getByRole('dialog',{name:'Omborlararo transfer'})
    await transfer.getByLabel('Qabul qiluvchi ombor').click()
    await page.getByRole('option',{name:'Phase4 Secondary Raw Store',exact:true}).click()
    await transfer.getByLabel('Miqdor').fill('101')
    await transfer.getByLabel('Transfer sababi').fill('Ikkinchi omborga zaxira yuborish')
    await transfer.getByRole('button',{name:'Yo‘lga chiqarish'}).click()
    await expect(transfer.getByText(/Mavjud/)).toBeVisible()
    await shot('phase4-negative-stock-rejected-desktop.png')
    await transfer.getByLabel('Miqdor').fill('25')
    await transfer.getByRole('button',{name:'Yo‘lga chiqarish'}).click()
    const dispatched=await state()
    expect(dispatched.stockTransfers).toHaveLength(1)
    expect(dispatched.stockTransfers[0].qty).toBe(25)
    await shot('phase4-transfer-dispatched-desktop.png')
    const ref=dispatched.stockTransfers[0].ref
    await page.getByText(ref).first().click()
    const transferDrawer=page.getByRole('dialog').filter({hasText:ref}).first()
    await transferDrawer.getByRole('button',{name:'Qabul qilish'}).click()
    const receive=page.getByRole('dialog',{name:'Transferni qabul qilish'})
    await receive.getByRole('button',{name:'Qabulni tasdiqlash'}).click()
    const arrived=await state()
    expect(arrived.stockTransfers[0].lines.reduce((n:number,l:{received:number})=>n+l.received,0)).toBe(25)
    const raw=arrived.rawMaterials[0].id
    const inPrimary=arrived.stockBalances.filter((b:{itemId:string;warehouseId:string})=>b.itemId===raw&&b.warehouseId==='w1').reduce((n:number,b:{onHand:number})=>n+b.onHand,0)
    const inSecondary=arrived.stockBalances.filter((b:{itemId:string;warehouseId:string})=>b.itemId===raw&&b.warehouseId===arrived.stockTransfers[0].to).reduce((n:number,b:{onHand:number})=>n+b.onHand,0)
    expect([inPrimary,inSecondary]).toEqual([75,25])
    await shot('phase4-transfer-received-desktop.png')
    const finalPath=join('docs','audits','evidence','phase4',`run-${company.slice(-8)}-stage3.storage.json`)
    if(!existsSync(finalPath))await context.storageState({path:finalPath})
  }finally{
    const s=await state().catch(()=>({}))
    if(!existsSync(join(run,'STAGE3_SUMMARY.json')))writeFileSync(join(run,'STAGE3_SUMMARY.json'),JSON.stringify({supplierInvoices:s.supplierInvoices,stockTransfers:s.stockTransfers,payables:s.payables,stockBalances:s.stockBalances},null,2))
    await context.close()
  }
})
