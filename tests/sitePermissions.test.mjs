// Phase 4 blockers: a new company's owner builds its structure — branch → production line → work center — and that
// work center is what BOM routing and operator accounts point to.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import {employeeWorkCenterOptions,workCenterError} from '../.test-dist/employeeForm.mjs'
import {createEmptyTenantState} from '../.test-dist/mockData.mjs'

let n=0
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-sp${++n}`})
// Registration gives the first employee the Business Owner role (src/domain/auth.ts), as here.
const tenant=()=>{const s=createEmptyTenantState('Phase4 Test Factory','Phase4 Owner'),owner=s.roles.find(r=>r.key==='business_owner');return {...s,employees:s.employees.map((e,i)=>i?e:{...e,roleId:owner.id})}}
const role=(s,key)=>s.roles.find(r=>r.key===key)
const must=o=>{assert.equal(o.result.ok,true,o.result.message);return o.state}

test('the settings module has no create right, so branch and line creation is ruled by settings.edit',()=>{
  const settings=X.PERMISSION_MODULES.find(m=>m.key==='settings')
  assert.equal(settings.actions.includes('create'),false)
  assert.deepEqual(X.entityRules('branches','create'),[['settings','edit']])
  assert.deepEqual(X.entityRules('productionLines','create'),[['settings','edit']])
  // Everything else keeps its own module and action.
  assert.deepEqual(X.entityRules('branches','edit'),[['settings','edit']])
  assert.deepEqual(X.entityRules('workCenters','create'),[['equipment','create']])
  assert.deepEqual(X.entityRules('warehouses','create'),[['warehouse','create']])
})

test('a new company owner may create a branch, a production line and a work center',()=>{
  const s=tenant(),owner=s.employees[0]
  assert.equal(X.roleOf(s,owner.id)?.key,'business_owner')
  for(const key of ['branches','productionLines','workCenters'])assert.equal(X.allowedBy(X.roleOf(s,owner.id),X.entityRules(key,'create')),true,key)
})

test('only roles holding settings.edit add branches and lines; work centers follow equipment.create',()=>{
  const s=tenant()
  const may=(key,entity)=>X.allowedBy(role(s,key),X.entityRules(entity,'create'))
  assert.equal(may('admin','branches'),true)
  for(const key of ['production_manager','supply_sales','warehouse','quality','maintenance','operator']){
    assert.equal(may(key,'branches'),false,`${key} branch`)
    assert.equal(may(key,'productionLines'),false,`${key} line`)
  }
  assert.equal(may('production_manager','workCenters'),true)
  assert.equal(may('maintenance','workCenters'),true)
  assert.equal(may('warehouse','workCenters'),false)
  assert.equal(may('supply_sales','workCenters'),false)
})

test('branch → line → work center chain in an empty tenant; the work center keeps its line’s branch',()=>{
  let s=tenant()
  const branch=A.createEntity(s,ctx(s),'branches',{name:'East',code:'EAST',status:'Faol'},'Filial');s=must(branch)
  const line=A.createEntity(s,ctx(s),'productionLines',{name:'Assembly',code:'L-EAST',branchId:branch.result.id,shift:'08:00–20:00',capacity:0,utilization:0,status:'Ishlamoqda'},'Liniya');s=must(line)
  const wc=A.createEntity(s,ctx(s),'workCenters',{name:'Press',code:'WC-EAST',branchId:branch.result.id,lineId:line.result.id,capacity:0,efficiency:100,status:'Ishlamoqda',machineIds:[],costPerHour:0},'Work center');s=must(wc)
  assert.deepEqual([s.branches.length,s.productionLines.length,s.workCenters.length],[2,1,1])
  assert.equal(s.workCenters[0].branchId,branch.result.id)
  const wrong=A.createEntity(s,ctx(s),'workCenters',{name:'Wrong',code:'WC-X',branchId:'b1',lineId:line.result.id,capacity:0,efficiency:100,status:'Ishlamoqda',machineIds:[],costPerHour:0},'Work center')
  assert.equal(wrong.result.ok,false)
  assert.match(wrong.result.message,/boshqa filialga/)
})

test('a new work center unblocks BOM routing and an operator’s work center choice',()=>{
  let s=tenant()
  const line=A.createEntity(s,ctx(s),'productionLines',{name:'Main line',code:'L1',branchId:'b1',shift:'08:00–20:00',capacity:0,utilization:0,status:'Ishlamoqda'},'Liniya');s=must(line)
  const op={id:'op1',name:'Cut and press',workCenterId:'',setupMin:10,runMin:1,employeeCount:1,instructions:'',qualityCheck:false,dependsOn:[]}
  assert.match(A.routingBlocker(s,[op]),/work center topilmadi/)
  const operator=role(s,'operator')
  assert.equal(employeeWorkCenterOptions(s,{department:'Production',roleId:operator.id,branchIds:['b1']}).length,0)
  const wc=A.createEntity(s,ctx(s),'workCenters',{name:'Press',code:'WC1',branchId:'b1',lineId:line.result.id,capacity:0,efficiency:100,status:'Ishlamoqda',machineIds:[],costPerHour:0},'Work center');s=must(wc)
  assert.equal(A.routingBlocker(s,[{...op,workCenterId:wc.result.id}]),null)
  assert.deepEqual(employeeWorkCenterOptions(s,{department:'Production',roleId:operator.id,branchIds:['b1']}).map(w=>w.id),[wc.result.id])
  assert.equal(workCenterError(s,{department:'Production',roleId:operator.id,branchIds:['b1'],workCenterId:wc.result.id}),undefined)
})
