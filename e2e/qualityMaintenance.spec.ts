import {test,expect,type Page} from '@playwright/test'
import {openWith,qualityMaintenanceState,settle,stored,watchErrors} from './fixtures'

// Quality & Maintenance: every view fits desktop / tablet / phone; CAPA action and spare-part issue through the UI.
let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())
const overflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)
const QUALITY=['','checks','alerts','control-points','capa','defects','rework','scrap'],EQUIPMENT=['','work-centers','maintenance','preventive','downtime','requests','repair']

test('quality and maintenance views fit every width; CAPA action and spare part work end to end',async({page})=>{
  const {state,alertId,orderId}=qualityMaintenanceState()
  await openWith(page,state,'/quality')
  for(const size of [page.viewportSize()!,{width:820,height:1180}]){
    await page.setViewportSize(size)
    for(const [base,views] of [['/quality',QUALITY],['/equipment',EQUIPMENT]] as const)for(const v of views){
      await page.goto(`${base}${v?`?view=${v}`:''}`)
      await expect(page.locator('main h1').first()).toHaveText(/\S/)
      await expect(page.getByText('Sahifada xatolik')).toHaveCount(0)
      await settle(page)
      expect(await overflow(page),`${base} ${v||'home'} @${size.width}px`).toBeLessThanOrEqual(1)
    }
  }
  await page.goto(`/quality?view=alerts&id=${alertId}`)
  // Centre the button first: a button at the drawer's edge scrolls on focus and the click would land beside it.
  const addBtn=page.getByRole('button',{name:'Amal qo‘shish'})
  await addBtn.evaluate(el=>el.scrollIntoView({block:'center'}));await settle(page)
  await addBtn.click()
  const add=page.getByRole('dialog',{name:'CAPA amali'})
  await add.locator('textarea').fill('E2E matritsani almashtirish')
  await add.getByRole('button',{name:'Qo‘shish'}).click()
  await expect(add).toBeHidden()
  await expect(page.getByText('CAPA amallari tasdiqlanishi kerak')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(1)

  await page.goto(`/equipment?view=maintenance&id=${orderId}`)
  const partBtn=page.getByRole('button',{name:'Qism berish'})
  await partBtn.evaluate(el=>el.scrollIntoView({block:'center'}));await settle(page)
  await partBtn.click()
  const issue=page.getByRole('dialog',{name:'Ehtiyot qism berish'})
  await issue.getByLabel('Qism miqdori').fill('3')
  await issue.getByRole('button',{name:'Berish'}).click()
  await expect(issue).toBeHidden()
  const s=await stored(page)
  expect(s.qualityAlerts.find(a=>a.id===alertId)!.capa!.length).toBe(1)
  expect(s.maintenanceOrders.find(m=>m.id===orderId)!.parts![0].qty).toBe(3)
  expect(s.stockBalances.find(b=>b.itemId==='rm4'&&b.warehouseId==='w1')!.onHand).toBe(47)
})
