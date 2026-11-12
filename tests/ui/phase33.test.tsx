import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mountApp,STATE_KEY} from './appFixture'
import {byText,cleanup,click,flush,type} from './helpers'

afterEach(cleanup)

test('tenant role lists exclude the historical Super Admin role',async()=>{
  await mountApp('/admin?view=roles')
  const adminRoles=document.querySelector('[role="listbox"][aria-label="Rollar"]')
  assert.ok(adminRoles)
  assert.equal(adminRoles.textContent?.includes('Eski Super Admin'),false)
  await cleanup()
  await mountApp('/employees?view=roles')
  const employeeRoles=document.querySelector('[role="listbox"][aria-label="Rollar"]')
  assert.ok(employeeRoles)
  assert.equal(employeeRoles.textContent?.includes('Eski Super Admin'),false)
})

test('owner creates a scoped Operator account in company user management with forced local activation',async()=>{
  await mountApp('/admin?view=users')
  await click(byText('Foydalanuvchi qo‘shish'))
  await click(byText('Yangi xodim'))
  const dialog=document.querySelector('[role="dialog"]')!
  const field=(label:string)=>[...dialog.querySelectorAll('.field')].find(row=>row.querySelector('label')?.textContent?.includes(label))!
  await type(field('F.I.Sh').querySelector('input'),'Yangi Operator')
  await type(field('Login').querySelector('input'),'operator33')
  assert.ok(dialog.textContent?.includes('E-pochta yoki SMS yuborilmaydi'))
  await click(byText('Yaratish','button',dialog))
  for(let i=0;i<100;i++){
    const accounts=JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}').accounts||[]
    if(accounts.some((a:{username:string})=>a.username==='operator33'))break
    await flush(25)
  }
  const state=JSON.parse(localStorage.getItem(STATE_KEY)||'{}')
  const auth=JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}')
  const account=auth.accounts.find((a:{username:string})=>a.username==='operator33')
  assert.ok(account)
  assert.equal(account.mustChangePassword,true)
  const employee=state.employees.find((e:{id:string})=>e.id===account.employeeId)
  assert.equal(employee.roleId,'role5')
  assert.equal(employee.workCenterId,'wc1')
  assert.equal(auth.accounts.filter((a:{employeeId:string})=>a.employeeId===employee.id).length,1)
})

test('retrying a failed login creation reuses the employee profile',async()=>{
  await mountApp('/admin?view=users')
  await click(byText('Foydalanuvchi qo‘shish'))
  await click(byText('Yangi xodim'))
  const dialog=document.querySelector('[role="dialog"]')!
  const field=(label:string)=>[...dialog.querySelectorAll('.field')].find(row=>row.querySelector('label')?.textContent?.includes(label))!
  await type(field('F.I.Sh').querySelector('input'),'Takror Operator')
  await type(field('Login').querySelector('input'),'retry.operator')
  await type(field('E-pochta').querySelector('input'),'invalid-email')
  await click(byText('Yaratish','button',dialog))
  for(let i=0;i<100&&!dialog.textContent?.includes('Xodim profili saqlandi');i++)await flush(20)
  assert.ok(dialog.textContent?.includes('Xodim profili saqlandi'))
  await type(field('E-pochta').querySelector('input'),'retry@example.com')
  await click(byText('Yaratish','button',dialog))
  for(let i=0;i<100&&!document.body.textContent?.includes('Kirish ma’lumotlari');i++)await flush(20)
  const state=JSON.parse(localStorage.getItem(STATE_KEY)||'{}')
  const auth=JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}')
  const employees=state.employees.filter((e:{name:string})=>e.name==='Takror Operator')
  assert.equal(employees.length,1)
  assert.equal(auth.accounts.filter((a:{employeeId:string})=>a.employeeId===employees[0].id).length,1,document.body.textContent?.slice(-1000))
})
