import test from 'node:test'
import assert from 'node:assert/strict'
import * as Auth from '../.test-dist/auth.mjs'
import * as SaaS from '../.test-dist/saas.mjs'
import {migrateState} from '../.test-dist/migrations.mjs'
import {createEmptyTenantState,createInitialState} from '../.test-dist/mockData.mjs'

const now=new Date('2026-10-31T08:00:00.000Z')
const id=p=>`${p}-test`
const credential={hash:'hash',salt:'salt',iterations:100000}
function registered(){
  const before=createInitialState(now)
  const result=Auth.setupFirstAdmin(Auth.emptyAuthStore(),before,{now,id},{employeeId:'em1',username:'owner',credential,name:'Owner One',company:'Factory A'})
  assert.equal(result.error,undefined)
  const store=SaaS.newTenant(result.state,result.store.accounts[0],now)
  return {before,state:result.state,auth:result.store,store,tenant:store.tenants[0]}
}

test('business registration assigns company owner without platform privilege and preserves operational records',()=>{
  const {before,state,auth,store,tenant}=registered()
  assert.equal(state.employees.find(e=>e.id==='em1').roleId,state.roles.find(r=>r.key==='business_owner').id)
  assert.equal(state.productionOrders.length,before.productionOrders.length)
  assert.equal(auth.accounts.length,1)
  assert.equal(store.memberships[0].accountId,auth.accounts[0].id)
  assert.equal(tenant.name,'Factory A')
  assert.equal(store.subscriptions[0].planId,'enterprise','seeded demo records fit the trial')
  assert.equal(store.subscriptions[0].status,'trial')
  assert.equal(SaaS.normalizeSaaSStore(store),store)
})

test('legacy public Super Admin keeps its historical assignment without gaining company or platform authority',()=>{
  const s=createInitialState(now)
  const legacy={...s,schemaVersion:5,employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role0'}:e)}
  const migrated=migrateState(legacy)
  assert.ok(migrated.applied.some(x=>x.startsWith('v6')))
  assert.equal(migrated.state.employees.find(e=>e.id==='em1').roleId,'role0')
  assert.equal(Auth.accountManageBlocker(migrated.state,migrated.state.employees[0],'em2'), 'users.edit ruxsati yo‘q')
  assert.deepEqual(migrated.state.productionOrders,legacy.productionOrders)
  assert.equal(migrateState(migrated.state).state,migrated.state)
})

test('legacy tenant migration binds existing accounts to one preserved ERP state',()=>{
  const {state,auth}=registered()
  const migrated=SaaS.legacyTenant(state,auth,now)
  assert.equal(migrated.tenants[0].id,'tenant-legacy-v3')
  assert.equal(migrated.memberships[0].accountId,auth.accounts[0].id)
  assert.equal(migrated.subscriptions[0].status,'active')
  assert.equal(migrated.subscriptions[0].planId,'enterprise')
})

test('missing SaaS metadata never assigns a known new-company identity to legacy records',()=>{
  const {state,auth}=registered()
  const other={...auth.accounts[0],id:'other-owner',tenantId:`tenant-${crypto.randomUUID()}`,username:'other'}
  const migrated=SaaS.legacyTenant(state,{...auth,accounts:[other,...auth.accounts]},now)
  assert.equal(migrated.tenants[0].ownerAccountId,auth.accounts[0].id)
  assert.deepEqual(migrated.memberships.map(m=>m.accountId),[auth.accounts[0].id])
})

test('membership, tenant status and subscription deny access independently',()=>{
  const {auth,store,tenant}=registered()
  assert.ok(SaaS.membershipFor(store,auth.accounts[0],tenant.id))
  assert.equal(SaaS.membershipFor(store,auth.accounts[0],'another-company'),undefined)
  assert.equal(SaaS.entitlement(store,tenant.id,'production',now),true)
  const expired={...store,subscriptions:store.subscriptions.map(s=>({...s,endsAt:'2026-10-30T00:00:00.000Z'}))}
  assert.equal(SaaS.entitlement(expired,tenant.id,'production',now),false)
  assert.equal(SaaS.normalizeSaaSStore({...store,memberships:[{...store.memberships[0],status:'forged'}]}),null)
  assert.equal(SaaS.normalizeSaaSStore({...store,tenants:[...store.tenants,{...tenant,id:'another-company'}]}),null,'tenant IDs must map to dedicated state keys')
  assert.equal(SaaS.normalizeSaaSStore({...store,memberships:[{...store.memberships[0],tenantId:'another-company'}]}),null)
})

test('downgrade retains historical rows and blocks only new records above plan limits',()=>{
  const {state,store,tenant,auth}=registered()
  const free=SaaS.changePlan(store,tenant.id,'free',auth.accounts[0].id,now)
  assert.equal(free.subscriptions.length,2)
  assert.equal(free.events[0].action,'subscription.change')
  assert.equal(SaaS.entitlement(free,tenant.id,'purchases',now),false)
  assert.equal(SaaS.entitlement(free,tenant.id,'production',now),true)
  assert.ok(SaaS.limitBlocker(state,free,tenant.id,'employees'))
  assert.equal(state.employees.length,7,'downgrade does not delete people')
  assert.deepEqual(state.productionOrders,registered().state.productionOrders)
})

test('new tenant starts without another company’s manufacturing, stock, commercial or audit records',()=>{
  const a=createInitialState(now)
  a.productionOrders.push({id:'private-order'})
  a.activity.push({id:'private-audit'})
  const b=createEmptyTenantState('Factory B','New Owner')
  assert.equal(b.settings.company.name,'Factory B')
  assert.equal(b.employees.length,1)
  assert.equal(b.employees[0].name,'New Owner')
  assert.equal(b.roles.some(r=>r.key==='super_admin'),false,'platform legacy role is not provisioned for new companies')
  assert.ok(b.roles.some(r=>r.key==='business_owner'),'required company roles stay available')
  for(const key of ['products','rawMaterials','boms','stockBalances','stockMovements','productionOrders','purchaseOrders','salesOrders','suppliers','customers','lots','receivables','activity','notifications','expenses','qualityChecks','equipment'])assert.equal(b[key].length,0,key)
  assert.equal(a.productionOrders[0].id,'private-order')
  assert.equal(SaaS.tenantStateKey(SaaS.LEGACY_TENANT_ID),SaaS.LEGACY_STATE_KEY)
  assert.notEqual(SaaS.tenantStateKey(`tenant-${crypto.randomUUID()}`),SaaS.LEGACY_STATE_KEY)
  assert.equal(SaaS.tenantStateKey('../other'),null)
})

test('platform actions require reason and preserve operational state while auditing changes',()=>{
  const {state,store,tenant}=registered()
  assert.equal(SaaS.setTenantStatus(store,tenant.id,'suspended','operator','',now),null)
  const suspended=SaaS.setTenantStatus(store,tenant.id,'suspended','operator','support review',now)
  assert.equal(suspended.tenants[0].status,'suspended')
  assert.equal(suspended.events[0].reason,'support review')
  const override=SaaS.platformOverridePlan(suspended,tenant.id,'plus','active','operator','manual demo approval',now)
  assert.equal(SaaS.subscriptionFor(override,tenant.id).planId,'plus')
  assert.equal(override.events[0].action,'subscription.override.demo')
  assert.equal(state.productionOrders.length,registered().state.productionOrders.length)
  assert.equal(SaaS.platformOverridePlan(override,tenant.id,'plus','trial','operator','manual demo approval',now),null)
})
