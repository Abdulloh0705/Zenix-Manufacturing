import {test,expect,type Page} from '@playwright/test'
import {openWith,reservedOrder,settle,stored,watchErrors} from './fixtures'

// Manufacturing views (overview, orders, Gantt / calendar / capacity, MPS, MRP, operations, shop floor, advanced) and
// the order drawer must render without errors or horizontal page overflow on desktop, tablet and phone.
let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())
const overflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)
const VIEWS=['','orders','planning&mode=Gantt','planning&mode=Calendar','planning&mode=Capacity','mps','mrp','operations','shop-floor','advanced']

test('every production view and the order drawer fit desktop, tablet and phone widths',async({page})=>{
  const {state,moId}=reservedOrder()
  await openWith(page,state,'/production')
  const sizes=[page.viewportSize()!,{width:820,height:1180}]
  for(const size of sizes){
    await page.setViewportSize(size)
    for(const v of VIEWS){
      await page.goto(`/production${v?`?view=${v}`:''}`)
      await expect(page.locator('main h1').first()).toHaveText(/\S/)
      await expect(page.getByText('Sahifada xatolik')).toHaveCount(0)
      await settle(page)
      expect(await overflow(page),`${v||'overview'} @${size.width}px`).toBeLessThanOrEqual(1)
    }
    await page.goto(`/production?view=orders&id=${moId}`)
    const drawer=page.getByRole('dialog').first()
    await expect(drawer).toBeVisible()
    for(const tab of await drawer.getByRole('tab').all()){
      await tab.click();await settle(page)
      expect(await overflow(page),`drawer tab @${size.width}px`).toBeLessThanOrEqual(1)
    }
  }
  const s=await stored(page)
  expect(s.productionOrders.find(o=>o.id===moId)!.materialReserved).toBe(true)
})
