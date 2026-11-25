import {test,expect,type Page} from '@playwright/test'
import {partlyReceivedPurchase,openWith,settle,stored,watchErrors} from './fixtures'
import * as A from '../src/domain/actions'
import {supplierBalance} from '../src/domain/payables'
import {compactMoney} from '../src/utils/format'
import type {ManufacturingState} from '../src/types'

// Costs & Finance completion: a supplier payment recorded in Purchases moves the payables figure on Costs by exactly
// its amount (one ledger); an expense posted by a maintenance order is read-only on the Costs expense list.
let errors:ReturnType<typeof watchErrors>
test.beforeEach(({page})=>{errors=watchErrors(page)})
test.afterEach(()=>errors.assertClean())
const noPageOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)
const payables=(s:ManufacturingState)=>s.suppliers.reduce((a,x)=>a+Math.max(0,supplierBalance(s,x.id)),0)

/** The partly received PO plus a completed maintenance order (its automatic expense) and one manual expense. */
function financeState(){
  const {state,poId,poCode}=partlyReceivedPurchase()
  let s=state
  const ctx={now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:(p:string)=>`${p}-fin${Math.random().toString(36).slice(2,8)}`}
  const ok=(o:A.Outcome)=>{if(!o.result.ok)throw new Error(o.result.message);return o.state}
  s={...s,maintenanceRequests:[{id:'mr-fin',code:'MR-FIN',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em1',scheduled:new Date().toISOString().slice(0,10),reason:'Moy oqmoqda',downtimeHours:1},...s.maintenanceRequests]}
  const approved=A.approveMaintenanceRequest(s,ctx,'mr-fin');s=ok(approved)
  s=ok(A.startMaintenance(s,ctx,approved.result.id!))
  s=ok(A.completeMaintenance(s,ctx,approved.result.id!,180000,'E2E'))
  s=ok(A.createEntity(s,ctx,'expenses',{date:new Date().toISOString().slice(0,10),type:'Transport',sourceId:'manual',branchId:'b1',amount:45000,note:'E2E yuk tashish'}))
  return {state:s,poId,poCode,maintenanceCode:s.maintenanceOrders.find(m=>m.id===approved.result.id)!.code}
}

test('a supplier payment in Purchases lowers Costs payables by exactly its amount',async({page})=>{
  const {state,poId,poCode}=financeState()
  const before=payables(state)
  await openWith(page,state,'/costs')
  const kpi=page.locator('.kpi-grid').getByRole('button').filter({hasText:'Kreditorlik qarzi'})
  await expect(kpi).toContainText(compactMoney(before))
  expect(await noPageOverflow(page)).toBe(true)
  await page.goto(`/purchases?view=orders&id=${poId}`)
  const drawer=page.getByRole('dialog').filter({hasText:poCode}).first()
  await drawer.getByRole('tab',{name:/Invoice \/ to‘lov/}).click()
  await drawer.getByRole('button',{name:'Supplier to‘lovini qayd etish'}).click()
  const pay=page.getByRole('dialog',{name:'Supplier to‘lovi'})
  await pay.locator('input').first().fill('25000')
  await pay.locator('textarea').fill('Bank o‘tkazmasi E2E')
  await pay.getByRole('button',{name:'To‘lovni yozish'}).click()
  await expect(pay).toBeHidden()
  const after=await stored(page)
  expect(after.payables!.filter(e=>e.kind==='payment'&&e.purchaseOrderId===poId).map(e=>e.amount)).toEqual([-25000])
  expect(payables(after)).toBe(before-25000)
  await page.keyboard.press('Escape');await settle(page)
  await page.goto('/costs')
  await expect(page.locator('.kpi-grid').getByRole('button').filter({hasText:'Kreditorlik qarzi'})).toContainText(compactMoney(before-25000))
})

test('an automatic maintenance expense is read-only; a manual expense opens its editor',async({page})=>{
  const {state,maintenanceCode}=financeState()
  await openWith(page,state,'/costs?view=expenses')
  const auto=page.locator('tr').filter({hasText:`${maintenanceCode} ·`})
  const manual=page.locator('tr').filter({hasText:'E2E yuk tashish'})
  await expect(auto).toContainText(`avtomatik · ${maintenanceCode}`)
  await expect(auto.getByRole('button',{name:'Xarajatni o‘chirish'})).toHaveCount(0)
  await expect(manual.getByRole('button',{name:'Xarajatni o‘chirish'})).toHaveCount(1)
  expect(await noPageOverflow(page)).toBe(true)
  await auto.locator('td').first().click()
  await expect(page.getByRole('dialog',{name:'Xarajatni tahrirlash'})).toHaveCount(0)
  await manual.locator('td').first().click()
  const edit=page.getByRole('dialog',{name:'Xarajatni tahrirlash'})
  await expect(edit).toBeVisible()
  await edit.getByRole('button',{name:'Bekor qilish'}).click()
  await expect(edit).toBeHidden()
})
