// "Yangi xodim" form rules: optional / required work center, department and branch filtering, no silent default,
// and the payload the existing createEntity('employees') action stores.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as F from '../.test-dist/employeeForm.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'

const now=new Date('2026-11-14T08:00:00.000Z')
let n=0
const id=p=>`${p}-ef-${++n}`
const seed=()=>{const s=createSeedState(now);return {...s,employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)}}
const ctx=s=>({now,user:s.employees.find(e=>e.id==='em1'),id})
// role2 = production manager (branch scope), role5 = operator (workcenter scope); wc1–wc3 are in b1, wc4 in b2.
const draft=(patch={})=>({name:'Bekzod Qodirov',department:'Production',roleId:'role2',branchId:'b1',branchIds:['b1'],workCenterId:'',warehouseId:'',shift:'A',status:'Faol',hourlyCost:'40000',attendance:'100',...patch})
const create=(s,d)=>A.createEntity(s,ctx(s),'employees',{...F.employeePayload(d),efficiency:0},'Xodim')

test('work center is optional for a branch role: no error, stored as none, nothing assigned by default',()=>{
  const s=seed()
  assert.deepEqual(Object.values(F.validateEmployeeDraft(s,draft())).filter(Boolean),[])
  const out=create(s,draft())
  assert.equal(out.result.ok,true,out.result.message)
  const row=out.state.employees.find(e=>e.id===out.result.id)
  assert.equal(row.workCenterId,'')
  assert.equal(out.state.employees.length,s.employees.length+1)
})

test('a selected work center is saved as that exact workCenterId',()=>{
  const s=seed()
  const out=create(s,draft({workCenterId:'wc2'}))
  assert.equal(out.result.ok,true,out.result.message)
  assert.equal(out.state.employees.find(e=>e.id===out.result.id).workCenterId,'wc2')
})

test('a work-center-scoped role must pick one; the error sits on workCenterId',()=>{
  const s=seed()
  assert.equal(F.validateEmployeeDraft(s,draft({roleId:'role5'})).workCenterId,'Bu rol uchun ish markazini tanlang')
  assert.equal(F.validateEmployeeDraft(s,draft({roleId:'role5',workCenterId:'wc1'})).workCenterId,undefined)
})

test('options follow branches and department; archived and foreign work centers are refused',()=>{
  const s=seed()
  assert.deepEqual(F.employeeWorkCenterOptions(s,draft()).map(w=>w.id),['wc1','wc2','wc3'])
  assert.deepEqual(F.employeeWorkCenterOptions(s,draft({branchId:'b2',branchIds:['b2']})).map(w=>w.id),['wc4'])
  assert.deepEqual(F.employeeWorkCenterOptions(s,draft({department:'Warehouse'})),[])
  assert.equal(F.usesWorkCenter(s,draft({department:'Warehouse'})),false)
  // An operator in a non-shop department is still bound to a work center.
  assert.deepEqual(F.employeeWorkCenterOptions(s,draft({department:'Warehouse',roleId:'role5'})).map(w=>w.id),['wc1','wc2','wc3'])
  assert.match(F.validateEmployeeDraft(s,draft({workCenterId:'wc4'})).workCenterId,/mavjud emas/)
  assert.match(F.validateEmployeeDraft(s,draft({workCenterId:'wc-missing'})).workCenterId,/topilmadi/)
  const archived={...s,workCenters:s.workCenters.map(w=>w.id==='wc2'?{...w,status:'Arxiv'}:w)}
  assert.match(F.validateEmployeeDraft(archived,draft({workCenterId:'wc2'})).workCenterId,/mavjud emas/)
  const branchless={...s,workCenters:[...s.workCenters,{...s.workCenters[0],id:'wc-unscoped',branchId:''}]}
  assert.equal(F.employeeWorkCenterOptions(branchless,draft()).some(w=>w.id==='wc-unscoped'),false)
  assert.match(F.validateEmployeeDraft(branchless,draft({workCenterId:'wc-unscoped'})).workCenterId,/mavjud emas/)
  // …but an employee already on it can keep it while editing.
  assert.equal(F.validateEmployeeDraft(archived,draft({workCenterId:'wc2'}),{workCenterId:'wc2'}).workCenterId,undefined)
})

test('the domain still refuses an invalid work center reference',()=>{
  const s=seed()
  const missing=create(s,draft({workCenterId:'wc-missing'}))
  assert.equal(missing.result.ok,false)
  assert.equal(missing.state,s)
  const foreign=create(s,draft({workCenterId:'wc4'}))
  assert.equal(foreign.result.ok,false)
  assert.equal(foreign.state,s)
})

test('department, role or branch changes keep a still-valid work center and clear (never replace) an invalid one',()=>{
  const s=seed()
  assert.deepEqual(F.reconcileWorkCenter(s,draft({workCenterId:'wc1',department:'Quality'})),{workCenterId:'wc1'})
  assert.deepEqual(F.reconcileWorkCenter(s,draft({workCenterId:'wc1',department:'Warehouse'})),{workCenterId:'',cleared:'Extrusion Press'})
  assert.deepEqual(F.reconcileWorkCenter(s,draft({workCenterId:'wc1',branchId:'b2',branchIds:['b2']})),{workCenterId:'',cleared:'Extrusion Press'})
  assert.deepEqual(F.reconcileWorkCenter(s,draft({workCenterId:''})),{workCenterId:''})
})

test('required fields: full name, branch for scoped roles, numbers in range',()=>{
  const s=seed()
  assert.equal(F.validateEmployeeDraft(s,draft({name:'  '})).name,'F.I.Sh majburiy')
  assert.equal(F.validateEmployeeDraft(s,draft({name:'Aziz'})).name,'Ism va familiyani kiriting')
  assert.equal(F.validateEmployeeDraft(s,draft({branchId:'',branchIds:[]})).branchId,'Filialni tanlang')
  assert.equal(F.validateEmployeeDraft(s,draft({roleId:'role1',branchId:'',branchIds:[]})).branchId,undefined)
  assert.equal(F.validateEmployeeDraft(s,draft({roleId:'role6'})).warehouseId,'Omborni tanlang')
  assert.ok(F.validateEmployeeDraft(s,draft({hourlyCost:'-1'})).hourlyCost)
  assert.ok(F.validateEmployeeDraft(s,draft({hourlyCost:''})).hourlyCost)
  assert.ok(F.validateEmployeeDraft(s,draft({attendance:'101'})).attendance)
  const payload=F.employeePayload(draft({name:'  Bekzod   Qodirov ',hourlyCost:'1500',attendance:'90'}))
  assert.equal(payload.name,'Bekzod   Qodirov')
  assert.equal(payload.hourlyCost,1500)
  assert.equal(payload.warehouseId,undefined)
})
