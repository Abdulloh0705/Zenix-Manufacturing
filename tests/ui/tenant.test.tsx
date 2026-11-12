import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react'
import {MemoryRouter} from 'react-router-dom'
import {AppProvider,useApp} from '../../src/app/providers/AppProvider/AppContext'
import {createEmptyTenantState,createSeedState} from '../../src/data/mockData'
import {useForm} from '../../src/shared/ui/Forms'
import {byText,cleanup,click,flush,render,type} from './helpers'

afterEach(cleanup)
const legacy='tenant-legacy-v3',legacyKey='zenix-manufacturing-v3-state'

function Workspace(){
  const app=useApp()
  const form=useForm({draft:''})
  return <div><span data-testid="company">{app.saas.tenant?.name||'—'}</span><span data-testid="products">{app.state.products.length}</span><span data-testid="stock">{app.state.stockBalances.length}</span><span data-testid="orders">{app.state.productionOrders.length}</span><span data-testid="audit">{app.state.activity.length}</span><span data-testid="role">{app.currentRole.key}</span><span data-testid="policy">{app.auth.policy.minPasswordLength}</span><input id="draft" {...form.input('draft')}/><button onClick={()=>app.switchTenant('not-authorized')}>Unauthorized</button><button onClick={()=>app.switchTenant((window as typeof window&{secondTenant:string}).secondTenant)}>Switch B</button><button onClick={()=>app.switchTenant(legacy)}>Switch A</button><button onClick={()=>app.setTheme('dark')}>Dark</button><button onClick={()=>app.updateSecurityPolicy({minPasswordLength:12})}>Policy 12</button><button onClick={()=>app.updateSecurityPolicy({minPasswordLength:13})}>Policy 13</button><button onClick={()=>{(window as typeof window&{pendingCreate?:Promise<unknown>}).pendingCreate=app.createUser({employeeId:'em2',username:'pending-user',password:'StrongPassphrase-34!'})}}>Pending account</button></div>
}

test('tenant switch remounts workspace, applies membership role and keeps state keys independent',async()=>{
  const now=new Date(),second=`tenant-${crypto.randomUUID()}`
  ;(window as typeof window&{secondTenant:string}).secondTenant=second
  const a=createSeedState(),b=createEmptyTenantState('Factory B','Member B')
  a.settings.company.name='Factory A'
  a.employees=a.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)
  b.employees=b.employees.map(e=>({...e,roleId:'role2',branchId:b.settings.defaultBranchId}))
  localStorage.setItem(legacyKey,JSON.stringify(a))
  localStorage.setItem(`zenix-erp-${second}-state`,JSON.stringify(b))
  localStorage.setItem('zenix-manufacturing-v3-clean-start',JSON.stringify(now.toISOString()))
  localStorage.setItem(`zenix-manufacturing-v3-clean-start:${second}`,JSON.stringify(now.toISOString()))
  const account={id:'same-account',employeeId:'em1',username:'shared',hash:'x',salt:'x',iterations:1,status:'active',failedCount:0,mustChangePassword:false,createdAt:now.toISOString()}
  localStorage.setItem('zenix-auth-v1',JSON.stringify({version:1,accounts:[account],policy:{},events:[],attempts:{}}))
  const at=now.toISOString(),membership=(tenantId:string)=>({id:`m-${tenantId}`,tenantId,accountId:account.id,employeeId:'em1',status:'active',createdAt:at})
  localStorage.setItem('zenix-saas-v1',JSON.stringify({version:1,tenants:[{id:legacy,name:'Factory A',status:'active',ownerAccountId:account.id,createdAt:at},{id:second,name:'Factory B',status:'active',ownerAccountId:account.id,createdAt:at}],memberships:[membership(legacy),membership(second)],subscriptions:[{id:'sub-a',tenantId:legacy,planId:'enterprise',status:'active',startsAt:at},{id:'sub-b',tenantId:second,planId:'enterprise',status:'active',startsAt:at}],events:[]}))
  localStorage.setItem('zenix-session-v1',JSON.stringify({id:'ses',accountId:account.id,employeeId:'em1',tenantId:legacy,startedAt:at,lastActivity:at,expiresAt:new Date(now.getTime()+86400000).toISOString(),remember:true}))
  await render(<MemoryRouter><AppProvider><Workspace/></AppProvider></MemoryRouter>)
  await flush(60)
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory A')
  assert.equal(document.querySelector('[data-testid="products"]')?.textContent,String(a.products.length))
  assert.ok(a.stockBalances.length>0&&a.productionOrders.length>0&&a.activity.length>0)
  await click(byText('Policy 12'))
  assert.equal(document.querySelector('[data-testid="policy"]')?.textContent,'12')
  await type(document.getElementById('draft'),'unfinished')
  await click(byText('Unauthorized'))
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory A')
  await click(byText('Switch B'))
  await flush(60)
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory B')
  assert.equal(document.querySelector('[data-testid="products"]')?.textContent,'0')
  assert.equal(document.querySelector('[data-testid="stock"]')?.textContent,'0')
  assert.equal(document.querySelector('[data-testid="orders"]')?.textContent,'0')
  assert.equal(document.querySelector('[data-testid="audit"]')?.textContent,'0')
  assert.equal(document.querySelector('[data-testid="role"]')?.textContent,'production_manager')
  assert.equal(document.querySelector('[data-testid="policy"]')?.textContent,'8')
  assert.equal((document.getElementById('draft') as HTMLInputElement).value,'')
  await click(byText('Dark'))
  await flush(60)
  await click(byText('Switch A'))
  await flush(60)
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory A')
  assert.equal(document.querySelector('[data-testid="stock"]')?.textContent,String(a.stockBalances.length))
  assert.equal(document.querySelector('[data-testid="orders"]')?.textContent,String(a.productionOrders.length))
  assert.equal(document.querySelector('[data-testid="audit"]')?.textContent,String(a.activity.length))
  assert.equal(document.querySelector('[data-testid="policy"]')?.textContent,'12')
  assert.equal(JSON.parse(localStorage.getItem(legacyKey)||'{}').settings.theme,a.settings.theme)
  assert.equal(JSON.parse(localStorage.getItem(`zenix-erp-${second}-state`)||'{}').settings.theme,'dark')

  // A harmless activity update leaves the current form and workspace alone.
  const current=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
  const activity={...current,lastActivity:new Date(now.getTime()+1000).toISOString()}
  localStorage.setItem('zenix-session-v1',JSON.stringify(activity))
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'zenix-session-v1',newValue:JSON.stringify(activity)})))
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory A')
  assert.equal(document.querySelector('[role="alertdialog"]'),null)

  // A clean form follows the other tab immediately.
  const remote={...activity,tenantId:second}
  localStorage.setItem('zenix-session-v1',JSON.stringify(remote))
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'zenix-session-v1',newValue:JSON.stringify(remote)})))
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory B')
  assert.equal(document.querySelector('[role="alertdialog"]'),null)

  await click(byText('Switch A'))
  await type(document.getElementById('draft'),'unsaved before remote switch')
  const beforeWrite=localStorage.getItem(legacyKey)
  const beforeAuth=localStorage.getItem('zenix-auth-v1')
  const beforeSaaS=localStorage.getItem('zenix-saas-v1')
  act(()=>{byText('Pending account')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  const pending=(window as typeof window&{pendingCreate?:Promise<{ok:boolean}>}).pendingCreate
  assert.ok(pending,'account creation entered its async credential step')
  const another=JSON.parse(localStorage.getItem('zenix-session-v1')||'{}')
  const remoteAgain={...another,tenantId:second}
  localStorage.setItem('zenix-session-v1',JSON.stringify(remoteAgain))
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'zenix-session-v1',newValue:JSON.stringify(remoteAgain)})))
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'zenix-session-v1',newValue:JSON.stringify(remoteAgain)})))
  assert.equal(document.querySelectorAll('[role="alertdialog"]').length,1)
  assert.equal(document.querySelector('[data-testid="company"]')?.textContent,'Factory A')
  assert.equal((document.getElementById('draft') as HTMLInputElement).value,'unsaved before remote switch')
  await click(byText('Policy 13'))
  await click(byText('Dark'))
  assert.equal(localStorage.getItem(legacyKey),beforeWrite,'stale tab cannot write business data')
  assert.equal(localStorage.getItem('zenix-auth-v1'),beforeAuth,'stale tab cannot write security data')
  assert.equal((await pending).ok,false,'the pending account action must fail after the remote switch')
  assert.equal(localStorage.getItem('zenix-saas-v1'),beforeSaaS,'the pending action cannot add a tenant membership')

  // A remote sign-out is also a changed session: the draft remains visible until explicit discard.
  localStorage.removeItem('zenix-session-v1')
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'zenix-session-v1',newValue:null})))
  assert.equal(document.querySelectorAll('[role="alertdialog"]').length,1)
  assert.equal((document.getElementById('draft') as HTMLInputElement).value,'unsaved before remote switch')
  assert.equal(localStorage.getItem(legacyKey),beforeWrite)
})
