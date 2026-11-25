import {test,expect,type Page} from '@playwright/test'
import {openWith,qualityMaintenanceState,stored,watchErrors} from './fixtures'

let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())

/** Two test accounts/memberships in this isolated browser context; no credentials or saved auth files are written. */
async function useEngineer(page:Page,employeeId:string){
  await page.evaluate(id=>{
    const auth=JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}')
    const saas=JSON.parse(localStorage.getItem('zenix-saas-v1')||'{}')
    const session=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
    const owner=auth.accounts[0],tenantId=session.tenantId
    const accountId=`e2e-account-${id}`
    if(!auth.accounts.some((a:{id:string})=>a.id===accountId))auth.accounts.push({...owner,id:accountId,employeeId:id,username:`e2e.${id}`,email:undefined,phone:undefined})
    if(!saas.memberships.some((m:{accountId:string;tenantId:string})=>m.accountId===accountId&&m.tenantId===tenantId))saas.memberships.push({id:`e2e-membership-${id}`,tenantId,accountId,employeeId:id,status:'active',createdAt:new Date().toISOString()})
    const now=new Date()
    localStorage.setItem('zenix-auth-v1',JSON.stringify(auth))
    localStorage.setItem('zenix-saas-v1',JSON.stringify(saas))
    localStorage.setItem('zenix-session-v1',JSON.stringify({...session,accountId,employeeId:id,startedAt:now.toISOString(),lastActivity:now.toISOString(),expiresAt:new Date(now.getTime()+12*60*60*1000).toISOString()}))
  },employeeId)
  await page.reload()
}

test('only the currently assigned Maintenance Engineer can issue a spare part',async({page},testInfo)=>{
  const {state,orderId}=qualityMaintenanceState()
  const engineer=state.employees.find(e=>e.id==='em5')!
  const seeded={...state,employees:[...state.employees,{...engineer,id:'em5-peer',name:'Second Maintenance Engineer'}]}
  await openWith(page,seeded,`/equipment?view=maintenance&id=${orderId}`)
  await useEngineer(page,'em5-peer')
  await page.goto(`/equipment?view=maintenance&id=${orderId}`)
  await expect(page.getByText('Bu maintenance ishi sizga biriktirilmagan')).toBeVisible()
  await expect(page.getByRole('button',{name:'Qism berish'})).toHaveCount(0)
  expect((await stored(page)).stockBalances.find(b=>b.itemId==='rm4'&&b.warehouseId==='w1')!.onHand).toBe(50)

  await useEngineer(page,'em5')
  await page.goto(`/equipment?view=maintenance&id=${orderId}`)
  await page.getByRole('button',{name:'Qism berish'}).click()
  const issue=page.getByRole('dialog',{name:'Ehtiyot qism berish'})
  await issue.getByLabel('Qism miqdori').fill('2')
  // Another authorized planner has changed the assignment since the modal opened.
  await page.evaluate(id=>{
    const key='zenix-manufacturing-v3-state',s=JSON.parse(localStorage.getItem(key)||'{}')
    s.maintenanceOrders=s.maintenanceOrders.map((m:{id:string})=>m.id===id?{...m,technicianId:'em5-peer'}:m)
    localStorage.setItem(key,JSON.stringify(s))
  },orderId)
  await issue.getByRole('button',{name:'Berish'}).click()
  await expect(issue).toBeVisible()
  const denied=await stored(page)
  expect(denied.maintenanceOrders.find(m=>m.id===orderId)!.parts||[]).toHaveLength(0)
  expect(denied.stockBalances.find(b=>b.itemId==='rm4'&&b.warehouseId==='w1')!.onHand).toBe(50)
  await page.screenshot({path:testInfo.outputPath('unassigned-engineer-denied.png'),fullPage:true})

  await useEngineer(page,'em5-peer')
  await page.goto(`/equipment?view=maintenance&id=${orderId}`)
  await page.getByRole('button',{name:'Qism berish'}).click()
  const assigned=page.getByRole('dialog',{name:'Ehtiyot qism berish'})
  await assigned.getByLabel('Qism miqdori').fill('2')
  await assigned.getByRole('button',{name:'Berish'}).click()
  await expect(assigned).toBeHidden()
  const done=await stored(page)
  expect(done.maintenanceOrders.find(m=>m.id===orderId)!.parts![0].by).toBe('em5-peer')
  expect(done.stockBalances.find(b=>b.itemId==='rm4'&&b.warehouseId==='w1')!.onHand).toBe(48)
  await page.screenshot({path:testInfo.outputPath('assigned-engineer-issued.png'),fullPage:true})
})
