import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush} from './helpers'
import {mountApp,seedState} from './appFixture'

// P4-U-01: a branch added later is listed first; create forms must still default to the company default branch.
afterEach(cleanup)
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
/** Text of the combobox inside the field whose label starts with `label`. */
const comboText=(root:ParentNode,label:string)=>[...root.querySelectorAll<HTMLElement>('.field')].find(f=>f.querySelector('label')?.textContent?.trim().startsWith(label))?.querySelector('[role="combobox"]')?.textContent?.trim()

function seedWithNewestBranch(){
  seedState(s=>({...s,
    settings:{...s.settings,defaultBranchId:'b1'},
    branches:[{id:'b-new',name:'Newest East Branch',code:'EAST',status:'Faol' as const},...s.branches],
    // An owner without a home site, as after registration.
    employees:s.employees.map(e=>e.id==='em1'?{...e,branchId:undefined,branchIds:undefined,workCenterId:'',warehouseId:undefined}:e),
  }))
}

test('new user form defaults to the company default branch, not the newest one',async()=>{
  seedWithNewestBranch()
  await mountApp('/admin?view=users')
  await click(byText('Foydalanuvchi qo‘shish'));await flush(40)
  const dialog=lastDialog()
  const tab=[...dialog.querySelectorAll<HTMLElement>('[role="tab"]')].find(t=>t.textContent?.includes('Yangi xodim'))
  if(tab){await click(tab);await flush(20)}
  const branch=comboText(lastDialog(),'Filial')
  assert.ok(branch,'the branch field is shown')
  assert.match(branch!,/Toshkent zavodi/,`default branch is the company default b1 (got “${branch}”)`)
  assert.doesNotMatch(branch!,/Newest East Branch/)
})

test('new production line form defaults to the company default branch',async()=>{
  seedWithNewestBranch()
  await mountApp('/settings?view=locations')
  const add=[...document.querySelectorAll<HTMLElement>('button')].filter(b=>b.textContent?.trim()==='Qo‘shish')
  await click(add.at(-1)!);await flush(20)
  const branch=comboText(lastDialog(),'Filial')
  assert.ok(branch,'the branch field is shown')
  assert.match(branch!,/Toshkent zavodi/,`default branch is the company default b1 (got “${branch}”)`)
})
