import {test,expect} from '@playwright/test'
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

// Refresh only the in-memory test context: the saved company was captured with a 30-minute idle session.
// The storage file on disk, including its auth data, is never rewritten by this check.
function activeTestState(path:string){
  const state=JSON.parse(readFileSync(path,'utf8'))
  for(const origin of state.origins){
    const entry=origin.localStorage.find((item:{name:string})=>item.name==='zenix-session-v1')
    if(!entry)continue
    const session=JSON.parse(entry.value),now=new Date()
    entry.value=JSON.stringify({...session,lastActivity:now.toISOString(),expiresAt:new Date(now.getTime()+12*60*60*1000).toISOString()})
  }
  return state
}

test('independent Phase 4 valuation agrees across UI and CSV',async({browser},testInfo)=>{
  const saved=process.env.PHASE4_STATE_PATH
  if(!saved||!existsSync(saved))test.skip(true,'PHASE4_STATE_PATH is required for the local saved company')
  const out=join('docs','audits','evidence','phase4','independent-codex-2026-11-20')
  if(!existsSync(out))mkdirSync(out,{recursive:true})
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:activeTestState(saved!)})
  const page=await context.newPage()
  const screenshot=async(name:string)=>{const path=testInfo.outputPath(name);await page.screenshot({path,fullPage:true});if(!existsSync(join(out,name)))copyFileSync(path,join(out,name))}
  try{
    await page.goto('/reports?view=inventory')
    const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('zenix-manufacturing-v3-state')||'{}'))
    const steel=s.rawMaterials.find((m:{name:string})=>m.name==='Phase4 Steel Coil')
    expect(steel).toBeTruthy()
    const balances=s.stockBalances.filter((b:{itemId:string})=>b.itemId===steel.id)
    const qty=balances.reduce((n:number,b:{onHand:number})=>n+b.onHand,0)
    const standard=qty*steel.standardCost
    const lotValue=s.lots.filter((l:{itemId:string;qty:number})=>l.itemId===steel.id&&l.qty>0).reduce((n:number,l:{qty:number;unitCost?:number;sourceId?:string})=>{
      const po=s.purchaseOrders.find((p:{id:string})=>p.id===l.sourceId)
      const paid=po?.items.find((line:{materialId:string})=>line.materialId===steel.id)?.price
      expect(l.unitCost??paid).toBe(10000)
      return n+l.qty*(l.unitCost??paid)
    },0)
    expect([qty,standard,lotValue,lotValue-standard]).toEqual([49,588000,490000,-98000])
    await expect(page.getByText('Zaxira qiymati · standart')).toBeVisible()
    await expect(page.getByText('LOT xarid tannarxida')).toBeVisible()
    await screenshot('inventory-report.png')
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV',exact:true}).click()])
    const csv=readFileSync((await download.path())!,'utf8').replace(/^\uFEFF/,'')
    const [header,...lines]=csv.trim().split(/\r?\n/)
    const names=header.split(','),rows=lines.filter(line=>line.includes('Phase4 Steel Coil')).map(line=>line.split(','))
    const col=(name:string)=>names.indexOf(name)
    expect(rows.length).toBeGreaterThan(0)
    const sum=(name:string)=>rows.reduce((n,row)=>n+Number(row[col(name)]),0)
    expect([sum('Qiymat (standart)'),sum('Qiymat (LOT)'),sum('Narx farqi (LOT − standart)')]).toEqual([standard,lotValue,lotValue-standard])
    await page.goto('/warehouse?view=stock')
    await expect(page.getByText('LOT tannarxida')).toBeVisible()
    await screenshot('warehouse-stock.png')
    await page.goto('/warehouse?view=warehouses')
    await expect(page.getByText('Qiymat (LOT)').first()).toBeVisible()
    await screenshot('warehouse-cards.png')
    await page.goto(`/materials?id=${steel.id}`)
    await expect(page.getByText('LOT xarid tannarxida').first()).toBeVisible()
    await screenshot('material-drawer.png')
    const report={qty,standard,lotValue,variance:lotValue-standard,csvRows:rows.length,source:'saved local-storage company; independent arithmetic'}
    if(!existsSync(join(out,'VALUATION_VERIFICATION.json')))writeFileSync(join(out,'VALUATION_VERIFICATION.json'),JSON.stringify(report,null,2))
  }finally{await context.close()}
})

test('fractional stock CSV rows retain the standard-value total',async({browser})=>{
  const saved=process.env.PHASE4_STATE_PATH
  if(!saved||!existsSync(saved))test.skip(true,'PHASE4_STATE_PATH is required for the local saved company')
  const context=await browser.newContext({locale:'uz-UZ',viewport:{width:1366,height:900},storageState:activeTestState(saved!)})
  const page=await context.newPage()
  try{
    await page.goto('/reports?view=inventory')
    await page.evaluate(()=>{
      const session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
      const keys=['zenix-manufacturing-v3-state',`zenix-erp-${session.tenantId}-state`]
      for(const key of keys){
        const stored=localStorage.getItem(key)
        if(!stored)continue
        const state=JSON.parse(stored)
        const item={...state.rawMaterials[0],id:'ind-fraction',name:'Independent Fractional Stock',sku:'IND-FRACTION',standardCost:123.45,lotTracking:false}
        state.rawMaterials.push(item)
        for(const [i,warehouseId] of ['w1',state.warehouses.find((w:{id:string})=>w.id!=='w1').id].entries()){
          state.stockBalances.push({id:`ind-fraction-${i}`,warehouseId,itemId:item.id,itemType:'raw',onHand:0.1,reserved:0,incoming:0,unit:'kg'})
        }
        localStorage.setItem(key,JSON.stringify(state))
      }
    })
    await page.reload()
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV',exact:true}).click()])
    const csv=readFileSync((await download.path())!,'utf8').replace(/^\uFEFF/,'')
    const [header,...lines]=csv.trim().split(/\r?\n/)
    const names=header.split(','),rows=lines.filter(line=>line.includes('Independent Fractional Stock')).map(line=>line.split(','))
    expect(rows).toHaveLength(2)
    const standard=rows.reduce((n,row)=>n+Number(row[names.indexOf('Qiymat (standart)')]),0)
    const actual=rows.reduce((n,row)=>n+Number(row[names.indexOf('Qiymat (LOT)')]),0)
    expect(Math.round(standard*100)/100).toBe(24.69)
    expect(Math.round(actual*100)/100).toBe(24.69)
  }finally{await context.close()}
})
