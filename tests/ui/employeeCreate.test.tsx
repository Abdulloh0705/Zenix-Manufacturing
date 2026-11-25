import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react'
import {mountApp,seedState,STATE_KEY} from './appFixture'
import {byText,cleanup,click,flush,type} from './helpers'

afterEach(cleanup)

type Row={id:string;name:string;workCenterId:string;roleId:string}
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)||'{}') as {employees:Row[]}
const accounts=()=>(JSON.parse(localStorage.getItem('zenix-auth-v1')||'{}').accounts||[]) as {employeeId:string;username:string}[]
const dialog=()=>[...document.querySelectorAll('[role="dialog"]')].find(d=>d.textContent?.includes('Yangi xodim'))!
const field=(label:string,root:ParentNode=dialog())=>[...root.querySelectorAll('.field')].find(row=>row.querySelector('label')?.textContent?.startsWith(label))!
const trigger=(label:string)=>field(label).querySelector<HTMLButtonElement>('[role="combobox"]')!
async function choose(label:string,option:string){
  await click(trigger(label))
  const el=[...document.querySelectorAll('[role="option"]')].find(o=>o.textContent?.trim().startsWith(option))
  assert.ok(el,`option ${option} in ${label}`)
  await click(el)
}
async function openModal(){
  await mountApp('/employees')
  await click(byText('Xodim qo‘shish'))
  assert.ok(dialog(),'modal open')
}

test('work center defaults to "Tanlanmagan" and the modal offers Qo‘shish beside Saqlash va login yaratish',async()=>{
  await openModal()
  assert.equal(trigger('Work center').textContent?.trim(),'Tanlanmagan')
  const add=byText('Qo‘shish','button',dialog()),login=byText('Saqlash va login yaratish','button',dialog())
  assert.ok(add?.classList.contains('secondary-glass-btn'))
  assert.ok(login?.classList.contains('primary-glass-btn'))
  // The dropdown opens and closes again on a second press.
  await click(trigger('Work center'))
  assert.equal(trigger('Work center').getAttribute('aria-expanded'),'true')
  assert.ok([...document.querySelectorAll('[role="option"]')].some(o=>o.textContent?.startsWith('Laser Cutting')))
  await click(trigger('Work center'))
  assert.equal(trigger('Work center').getAttribute('aria-expanded'),'false')
})

test('a delegated branch creator sees only the permitted branch and its work centers',async()=>{
  seedState(s=>({...s,roles:s.roles.map(r=>r.id==='role2'?{...r,permissions:{...r.permissions,employees:{view:true,create:true},users:{view:true,create:true}}}:r)}))
  await mountApp('/employees','em2')
  await click(byText('Xodim qo‘shish'))
  await click(trigger('Asosiy filial'))
  assert.deepEqual([...document.querySelectorAll('[role="option"]')].map(o=>o.textContent?.trim()),['— Tanlang —','Toshkent zavodi'])
  await click(trigger('Asosiy filial'))
  await click(trigger('Work center'))
  assert.equal([...document.querySelectorAll('[role="option"]')].some(o=>o.textContent?.includes('Assembly')),false)
})

test('Qo‘shish creates the employee without a work center or login, closes and lists it',async()=>{
  await openModal()
  const before=stored().employees.length,accountsBefore=accounts().length
  await type(field('F.I.Sh').querySelector('input'),'Bekzod Qodirov')
  await choose('Rol (RBAC)','Ishlab chiqarish menejeri')
  await click(byText('Qo‘shish','button',dialog()))
  await flush(30)
  const rows=stored().employees.filter(e=>e.name==='Bekzod Qodirov')
  assert.equal(rows.length,1)
  assert.equal(stored().employees.length,before+1)
  assert.equal(rows[0].workCenterId,'')
  assert.equal(accounts().length,accountsBefore,'no login created')
  assert.equal(accounts().some(a=>a.employeeId===rows[0].id),false)
  assert.equal(dialog(),undefined,'modal closed')
  assert.equal(document.body.textContent?.includes('Akkaunt ochish'),false,'no login step')
  assert.ok(document.querySelector('.toast-success'),'success toast')
  assert.ok([...document.querySelectorAll('tbody tr')].some(r=>r.textContent?.includes('Bekzod Qodirov')),'list refreshed')
})

test('a selected work center is saved with its id',async()=>{
  await openModal()
  await type(field('F.I.Sh').querySelector('input'),'Laylo Tursunova')
  await choose('Work center','Laser Cutting')
  assert.ok(trigger('Work center').textContent?.startsWith('Laser Cutting'))
  await click(byText('Qo‘shish','button',dialog()))
  await flush(30)
  const row=stored().employees.find(e=>e.name==='Laylo Tursunova')
  assert.equal(row?.workCenterId,'wc2')
  assert.equal(row?.roleId,'role5')
})

test('required fields block both actions, show errors beside the fields and keep what was typed',async()=>{
  await openModal()
  const before=stored().employees.length
  await type(field('F.I.Sh').querySelector('input'),'Aziz')
  await click(byText('Qo‘shish','button',dialog()))
  assert.equal(field('F.I.Sh').querySelector('.field-error')?.textContent,'Ism va familiyani kiriting')
  // The default Operator role is bound to a work center, and none was picked for it.
  assert.equal(field('Work center').querySelector('.field-error')?.textContent,'Bu rol uchun ish markazini tanlang')
  assert.equal(trigger('Work center').getAttribute('aria-invalid'),'true')
  await click(byText('Saqlash va login yaratish','button',dialog()))
  assert.equal(stored().employees.length,before)
  assert.ok(dialog(),'modal stays open')
  assert.equal(field('F.I.Sh').querySelector('input')?.value,'Aziz')
  await type(field('F.I.Sh').querySelector('input'),'')
  await click(byText('Qo‘shish','button',dialog()))
  assert.equal(field('F.I.Sh').querySelector('.field-error')?.textContent,'F.I.Sh majburiy')
})

test('changing department or branch clears a work center that no longer fits, without picking another',async()=>{
  await openModal()
  await choose('Rol (RBAC)','Ishlab chiqarish menejeri')
  await choose('Work center','Extrusion Press')
  await choose('Bo‘lim','Quality')
  assert.ok(trigger('Work center').textContent?.startsWith('Extrusion Press'),'still valid for Quality')
  await choose('Bo‘lim','Warehouse')
  assert.equal(trigger('Work center').textContent?.trim(),'Tanlanmagan')
  assert.ok(field('Work center').textContent?.includes('“Extrusion Press” olib tashlandi'))
  assert.equal(trigger('Work center').disabled,true)
  await choose('Bo‘lim','Production')
  await choose('Work center','Extrusion Press')
  await choose('Asosiy filial','Chirchiq sexi')
  assert.equal(trigger('Work center').textContent?.trim(),'Tanlanmagan')
  await click(trigger('Work center'))
  const options=[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent?.trim())
  assert.deepEqual(options,['Tanlanmagan','Assembly · ASM-01'])
})

test('a double press saves one employee only',async()=>{
  await openModal()
  const before=stored().employees.length
  await type(field('F.I.Sh').querySelector('input'),'Bir Marta')
  await choose('Rol (RBAC)','Ishlab chiqarish menejeri')
  const add=byText('Qo‘shish','button',dialog())!
  await act(async()=>{
    add.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}))
    add.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:2}))
  })
  await flush(30)
  assert.equal(stored().employees.filter(e=>e.name==='Bir Marta').length,1)
  assert.equal(stored().employees.length,before+1)
})

test('Saqlash va login yaratish saves the employee once, validates the login step and creates one account',async()=>{
  await openModal()
  await type(field('F.I.Sh').querySelector('input'),'Login Operator')
  await choose('Work center','Extrusion Press')
  await click(byText('Saqlash va login yaratish','button',dialog()))
  await flush(30)
  const row=stored().employees.find(e=>e.name==='Login Operator')!
  assert.ok(row)
  assert.equal(row.workCenterId,'wc1')
  const step=[...document.querySelectorAll('[role="dialog"]')].find(d=>d.textContent?.includes('Akkaunt ochish'))!
  assert.ok(step,'login step opens')
  assert.ok(step.textContent?.includes('Xodim profili saqlandi'))
  // Empty login: error beside the field, nothing created.
  await click(byText('Yaratish','button',step))
  assert.equal(field('Login',step).querySelector('.field-error')?.textContent,'Login majburiy')
  await type(field('Login',step).querySelector('input'),'a b')
  assert.match(field('Login',step).querySelector('.field-error')?.textContent||'',/^Login:/)
  await type(field('E-pochta',step).querySelector('input'),'not-an-email')
  assert.equal(field('E-pochta',step).querySelector('.field-error')?.textContent,'E-pochta noto‘g‘ri')
  assert.equal(accounts().some(a=>a.employeeId===row.id),false)
  await type(field('Login',step).querySelector('input'),'login.operator')
  await type(field('E-pochta',step).querySelector('input'),'')
  await click(byText('Yaratish','button',step))
  for(let i=0;i<100&&!document.body.textContent?.includes('Kirish ma’lumotlari');i++)await flush(20)
  assert.ok(document.body.textContent?.includes('Kirish ma’lumotlari'))
  assert.equal(accounts().filter(a=>a.employeeId===row.id).length,1)
  assert.equal(accounts().find(a=>a.employeeId===row.id)?.username,'login.operator')
  assert.equal(stored().employees.filter(e=>e.name==='Login Operator').length,1)
})
