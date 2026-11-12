import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as Auth from '../.test-dist/auth.mjs'
import * as SaaS from '../.test-dist/saas.mjs'
import {backupSecurityBlocker,privilegedBackupBlocker} from '../.test-dist/backupSecurity.mjs'
import {customerSalesVolume} from '../.test-dist/receivables.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'

const now=new Date('2026-11-07T08:00:00.000Z')
let n=0
const id=p=>`${p}-33-${++n}`
const seed=()=>createSeedState(now)
const ctx=(s,employeeId)=>({now,user:s.employees.find(e=>e.id===employeeId),id})
const authCtx=(s,employeeId,tenantId)=>({now,actor:s.employees.find(e=>e.id===employeeId),tenantId,id})
const owner=s=>({...s,employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)})
const refused=(s,out)=>{assert.equal(out.result.ok,false);assert.equal(out.state,s)}
const credential={hash:'hash',salt:'salt',iterations:1}

test('P32-001: operational backup is allowed; role, assignment, scope and injected role changes are refused',()=>{
  const s=owner(seed())
  assert.equal(backupSecurityBlocker(s,{...s,products:s.products.map(p=>({...p,price:p.price+1}))}),null)
  const changed=(id,patch)=>({...s,employees:s.employees.map(e=>e.id===id?{...e,...patch}:e)})
  for(const roleId of ['role_owner','role0'])assert.ok(backupSecurityBlocker(s,changed('em2',{roleId})))
  assert.ok(backupSecurityBlocker(s,changed('em2',{workCenterId:'wc4'})))
  assert.ok(backupSecurityBlocker(s,{...s,roles:[...s.roles,{...s.roles[0],id:'injected',key:'super_admin'}]}))
  assert.ok(backupSecurityBlocker(s,{...s,roles:s.roles.map(r=>r.id==='role5'?{...r,permissions:{...r.permissions,users:{edit:true}}}:r)}))
  assert.equal(X.hasPermission(s.roles.find(r=>r.id==='role0'),'users','edit'),false)
})

test('P32-001: owner recovery restores valid custom roles and assignments while protected identities stay fixed',()=>{
  const s=owner(seed())
  const custom={id:'role-recovered',name:'Recovered HR',scope:'branch',rank:2,permissions:{employees:{view:true,edit:true}}}
  const restored={...s,roles:[...s.roles,custom],employees:s.employees.map(e=>e.id==='em2'?{...e,roleId:custom.id}:e)}
  assert.equal(privilegedBackupBlocker(s,restored,'em1',['em1','em2']),null)
  assert.ok(privilegedBackupBlocker(s,{...restored,employees:restored.employees.filter(e=>e.id!=='em2')},'em1',['em1','em2']))
  assert.ok(privilegedBackupBlocker(s,{...restored,employees:restored.employees.map(e=>e.id==='em1'?{...e,roleId:'role1'}:e)},'em1',['em1']))
  assert.ok(privilegedBackupBlocker(s,{...restored,roles:restored.roles.map(r=>r.id==='role_owner'?{...r,scope:'branch'}:r)},'em1',['em1']))
  assert.ok(privilegedBackupBlocker(s,{...restored,roles:[...restored.roles,{...custom,id:'injected',key:'super_admin'}]},'em1',['em1']))
})

test('P32-002: delegated branch manager cannot archive, move or reset another branch employee',()=>{
  let s=seed()
  s={...s,roles:s.roles.map(r=>r.id==='role2'?{...r,permissions:{...r.permissions,employees:{view:true,create:true,edit:true},users:{view:true,create:true,edit:true}}}:r)}
  const manager=ctx(s,'em2')
  refused(s,A.updateEntity(s,manager,'employees','em7',{status:'Arxiv'}))
  refused(s,A.updateEntity(s,manager,'employees','em7',{workCenterId:'wc1'}))
  refused(s,A.updateEntity(s,manager,'employees','em3',{workCenterId:'wc4'}))
  assert.equal(A.updateEntity(s,manager,'employees','em3',{shift:'B'}).result.ok,true)
  const accounts={...Auth.emptyAuthStore(),accounts:[{id:'other',employeeId:'em7',username:'other',...credential,status:'active',failedCount:0,mustChangePassword:false,createdAt:now.toISOString()}]}
  assert.ok(Auth.resetPassword(accounts,s,authCtx(s,'em2'),'other',credential).error)
  assert.ok(Auth.setAccountStatus(accounts,s,authCtx(s,'em2'),'other','blocked').error)
  assert.equal(Auth.resetPassword(accounts,s,authCtx(s,'em2'),'other',credential).store,undefined)
})

test('P32-003/009: scoped manager cannot widen roles; explicit custom rank enables delegated HR',()=>{
  let s=seed()
  s={...s,roles:s.roles.map(r=>r.id==='role2'?{...r,permissions:{...r.permissions,roles:{view:true,create:true,edit:true},users:{view:true,create:true,edit:true},employees:{view:true,create:true,edit:true}}}:r)}
  refused(s,A.createRole(s,ctx(s,'em2'),{name:'Global',scope:'all'}))
  const created=A.createRole(s,ctx(s,'em2'),{name:'Local'})
  assert.equal(created.result.ok,true)
  assert.equal(created.state.roles.find(r=>r.id===created.result.id).scope,'branch')
  refused(s,A.updateRole(s,ctx(s,'em2'),'role5',{name:'Operator',scope:'all'}))
  refused(s,A.updateRolePermission(s,ctx(s,'em2'),'role5','users','edit',true))
  refused(s,A.duplicateEntity(s,ctx(s,'em2'),'employees','em1'))
  s=owner(s)
  const hr=A.createRole(s,ctx(s,'em1'),{name:'HR',scope:'branch',rank:2})
  assert.equal(hr.result.ok,true)
  assert.equal(X.roleRank(hr.state.roles.find(r=>r.id===hr.result.id)),2)
  assert.equal(X.assignRoleBlocker(hr.state,hr.state.employees.find(e=>e.id==='em1'),undefined,hr.result.id),null)
})

test('delegated Manager creates only a subordinate employee inside the assigned branch',()=>{
  const base=seed()
  const s={...base,roles:base.roles.map(r=>r.id==='role2'?{...r,permissions:{...r.permissions,employees:{view:true,create:true,edit:true},users:{view:true,create:true,edit:true}}}:r)}
  const worker={name:'Branch Worker',department:'Production',roleId:'role5',workCenterId:'wc1',shift:'A',status:'Faol',hourlyCost:0,attendance:100,efficiency:0}
  refused(s,A.createEntity(s,ctx(s,'em2'),'employees',{...worker,roleId:'role_owner'}))
  refused(s,A.createEntity(s,ctx(s,'em2'),'employees',{...worker,workCenterId:'wc4'}))
  const created=A.createEntity(s,ctx(s,'em2'),'employees',worker)
  assert.equal(created.result.ok,true)
  const result=Auth.createAccount(Auth.emptyAuthStore(),created.state,authCtx(created.state,'em2','tenant-a'),{employeeId:created.result.id,username:'branchworker',credential})
  assert.equal(result.error,undefined)
  assert.equal(result.store.accounts[0].employeeId,created.result.id)
})

test('P32-004: expired and suspended plans cannot self-reactivate; trial retains its deadline',()=>{
  const s=owner(seed())
  const account={id:'owner-account',employeeId:'em1',username:'owner',...credential,status:'active',failedCount:0,mustChangePassword:false,createdAt:now.toISOString()}
  const initial=SaaS.newTenant(s,account,now),tenantId=initial.tenants[0].id
  const trial=SaaS.changePlan(initial,tenantId,'plus',account.id,now)
  assert.equal(SaaS.subscriptionFor(trial,tenantId).status,'trial')
  assert.equal(SaaS.subscriptionFor(trial,tenantId).endsAt,SaaS.subscriptionFor(initial,tenantId).endsAt)
  for(const status of ['expired','suspended']){
    const overridden=SaaS.platformOverridePlan(initial,tenantId,'free',status,'platform','verified override',now)
    assert.equal(SaaS.changePlan(overridden,tenantId,'enterprise',account.id,now),overridden)
    assert.equal(SaaS.entitlement(overridden,tenantId,'production',now),false)
  }
  const suspended=SaaS.setTenantStatus(initial,tenantId,'suspended','platform','verified reason',now)
  assert.equal(SaaS.changePlan(suspended,tenantId,'pro',account.id,now),suspended)
  assert.equal(SaaS.subscriptionActive({...SaaS.subscriptionFor(initial,tenantId),endsAt:undefined},now),false)
  const paid=SaaS.platformOverridePlan(initial,tenantId,'plus','active','platform','verified payment',now)
  assert.equal(SaaS.changePlan(paid,tenantId,'pro',account.id,now),paid,'upgrade needs platform payment verification')
  assert.equal(SaaS.subscriptionFor(SaaS.changePlan(paid,tenantId,'free',account.id,now),tenantId).status,'active','downgrade remains active')
})

test('P32-005: tenant login failure policy locks at its own threshold and tags audit events',()=>{
  const base=Auth.emptyAuthStore()
  const store={...base,policies:{'tenant-a':{...base.policy,maxFailedAttempts:3,lockMinutes:30},'tenant-b':{...base.policy,maxFailedAttempts:4,lockMinutes:60}}}
  const policy=Auth.loginFailurePolicy(store,['tenant-a','tenant-b'])
  assert.equal(policy.maxFailedAttempts,3)
  assert.equal(policy.lockMinutes,60)
  let current={...store,policy}
  for(let i=0;i<3;i++)current=Auth.recordFailure(current,{now,tenantId:'tenant-a',id},'operator')
  assert.ok(Auth.lockState(current,'operator',now))
  assert.equal(current.events[0].type,'lockout')
  assert.equal(current.events[0].tenantId,'tenant-a')
})

test('owner issues an Operator account with fixed role; employee changes temporary password',()=>{
  let s=owner(seed())
  const created=A.createEntity(s,ctx(s,'em1'),'employees',{name:'Yangi Operator',department:'Production',roleId:'role5',workCenterId:'wc1',shift:'A',status:'Faol',hourlyCost:0,attendance:100,efficiency:0})
  assert.equal(created.result.ok,true)
  s=created.state
  const employeeId=created.result.id
  const result=Auth.createAccount(Auth.emptyAuthStore(),s,authCtx(s,'em1','tenant-test'),{employeeId,username:'newoperator',credential,mustChangePassword:true})
  assert.equal(result.error,undefined)
  assert.equal(result.store.accounts[0].tenantId,'tenant-test')
  assert.equal(result.store.accounts[0].mustChangePassword,true)
  assert.equal(X.hasPermission(X.roleOf(s,employeeId),'users','edit'),false)
  const changed=Auth.changeOwnPassword(result.store,authCtx(s,employeeId,'tenant-test'),result.id,{hash:'new',salt:'new',iterations:1})
  assert.equal(changed.store.accounts[0].mustChangePassword,false)
  assert.equal(s.employees.find(e=>e.id===employeeId).roleId,'role5')
})

test('P32-006/007/008: invalid status, partial-delivery cancellation and historical employee deletion are atomic',()=>{
  const s=owner(seed()),order=s.productionOrders.find(o=>o.status==='Tasdiqlangan')
  for(const target of ['','Yakunlandi','Qoralama','Material kutilmoqda',null])refused(s,A.transitionProduction(s,ctx(s,'em1'),order.id,target))
  const so=s.salesOrders[0]
  const partial={...s,salesOrders:s.salesOrders.map(o=>o.id===so.id?{...o,items:o.items.map((i,index)=>index?i:{...i,delivered:1})}:o)}
  refused(partial,A.cancelSalesOrder(partial,ctx(partial,'em1'),so.id))
  assert.equal(customerSalesVolume(partial,so.customerId),partial.salesOrders.filter(o=>o.customerId===so.customerId).reduce((sum,o)=>sum+o.items.reduce((amount,i)=>amount+i.delivered*i.price,0),0))
  assert.equal(customerSalesVolume({...partial,salesOrders:partial.salesOrders.map(o=>o.id===so.id?{...o,status:'Bekor'}:o)},so.customerId),customerSalesVolume(partial,so.customerId),'old cancelled deliveries remain in sales volume')
  const historical={...s,timeLogs:[...s.timeLogs,{id:'history-33',employeeId:'em7',orderId:'old',workOrderId:'old',workCenterId:'wc4',start:'2026-11-01 08:00',minutes:60}]}
  refused(historical,A.deleteEntity(historical,ctx(historical,'em1'),'employees','em7'))
  assert.ok(A.referenceBlocker(historical,'employees','em7'))
})
