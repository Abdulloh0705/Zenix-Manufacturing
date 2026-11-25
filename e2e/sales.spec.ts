import {test,expect} from '@playwright/test'
import {openWith,serialSalesOrder,settle,stored,watchErrors} from './fixtures'

// Sales completion: a serial product ships the units the user names; order edit and drawer fit every viewport.
let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())
const noPageOverflow=(page:import('@playwright/test').Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)

test('serial delivery ships the picked units; edit dialog and drawer fit desktop, tablet and phone',async({page})=>{
  const {state,soId,soCode}=serialSalesOrder()
  await openWith(page,state,`/sales?view=orders&id=${soId}`)
  const drawer=page.getByRole('dialog').filter({hasText:soCode})
  await expect(drawer).toBeVisible()
  expect(await noPageOverflow(page)).toBe(true)
  await drawer.getByRole('button',{name:'Tahrirlash'}).click()
  const edit=page.getByRole('dialog',{name:'Buyurtmani tahrirlash'})
  await expect(edit.getByLabel('Ventilyatsiya korpusi miqdori')).toHaveValue('2')
  expect(await noPageOverflow(page)).toBe(true)
  await edit.getByRole('button',{name:'Bekor qilish'}).click()
  await settle(page)
  await drawer.getByRole('button',{name:'Yetkazib berish'}).click()
  const ship=page.getByRole('dialog',{name:'Yetkazib berish'})
  const picker=ship.getByRole('group',{name:'Ventilyatsiya korpusi serial raqamlari'})
  await expect(picker.getByLabel(/SN-E2E-1/)).toBeChecked()
  await expect(picker.getByLabel(/SN-E2E-2/)).toBeChecked()
  expect(await noPageOverflow(page)).toBe(true)
  await picker.getByLabel(/SN-E2E-1/).uncheck()
  await picker.getByLabel(/SN-E2E-3/).check()
  await ship.getByRole('button',{name:'Yetkazishni tasdiqlash'}).click()
  await expect(ship).toBeHidden()
  const after=await stored(page)
  expect(after.stockMovements.filter(m=>m.type==='Sale -'&&m.source===soCode).map(m=>m.lot).sort()).toEqual(['SN-E2E-2','SN-E2E-3'])
  expect(after.salesOrders.find(o=>o.id===soId)!.status).toBe('Yetkazildi')
  await page.setViewportSize({width:820,height:1180})
  await drawer.getByRole('tab',{name:'Bajarilish'}).click()
  await expect(drawer).toContainText('SN SN-E2E-3')
  expect(await noPageOverflow(page)).toBe(true)
})
