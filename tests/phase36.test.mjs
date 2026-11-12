import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as Auth from '../.test-dist/auth.mjs'
import * as Engine from '../.test-dist/manufacturingEngine.mjs'
import * as Profit from '../.test-dist/profitability.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'

const fresh=()=>createSeedState(new Date('2026-11-09T12:00:00Z'))
let serial=0
const ctx=(s,actor='em1')=>({now:new Date('2026-11-09T12:00:00Z'),user:s.employees.find(e=>e.id===actor),id:p=>`${p}-phase36-${++serial}`})
const authCtx=(s,actor='em1')=>({now:new Date('2026-11-09T12:00:00Z'),actor:s.employees.find(e=>e.id===actor),id:p=>`${p}-phase36-${++serial}`})
const ok=result=>{assert.equal(result.result.ok,true,result.result.message);return result.state}
const credential={hash:'example-hash',salt:'example-salt',iterations:1}

test('ZA-001: branch projection excludes foreign employees and expenses, including explicit multi-branch assignments',()=>{
  const base=fresh(),actor={...base.employees.find(e=>e.id==='em2'),branchId:'b1'}
  const s={...base,employees:[...base.employees.filter(e=>e.id!=='em2'),actor,{...base.employees[0],id:'foreign',name:'Foreign employee',roleId:'role5',branchId:'b2',workCenterId:'wc4'}],expenses:[...base.expenses,{id:'foreign-expense',date:'2026-11-09',type:'Overhead',sourceId:'manual',branchId:'b2',amount:12345,note:'other branch'}]}
  const one=X.scopedView(s,actor)
  assert.equal(one.employees.some(e=>e.id==='foreign'),false)
  assert.equal(one.expenses.some(e=>e.id==='foreign-expense'),false)
  assert.notEqual(X.scopeBlocker(s,actor,'updateEntity',['expenses','foreign-expense',{amount:1}]),null,'foreign expense ID cannot be edited')
  assert.notEqual(X.scopeBlocker(s,actor,'createEntity',['expenses',{date:'2026-11-09',type:'Overhead',sourceId:'manual',branchId:'b2',amount:1,note:'x'}]),null)
  const both=X.scopedView(s,{...actor,branchIds:['b1','b2']})
  assert.equal(both.employees.some(e=>e.id==='foreign'),true)
  assert.equal(both.expenses.some(e=>e.id==='foreign-expense'),true)
  assert.equal(X.scopedView(s,s.employees[0]),s,'company admin retains complete authorized view')
})

test('ZA-012: scoped employee profile requires a real assigned site',()=>{
  const s=fresh(),row={...s.employees[0],id:'new-worker',name:'New worker',roleId:'role2',workCenterId:undefined,warehouseId:undefined,branchId:undefined}
  assert.match(X.employeeWriteBlocker(s,s.employees[0],row),/filial|ish markazi|ombor/)
  assert.equal(X.employeeWriteBlocker(s,s.employees[0],{...row,branchId:'b1'}),null)
})

test('ZA-002: subcontract service is allocated once across partial receipts and lot valuations',()=>{
  let s=fresh(),order=s.subcontractOrders[0]
  s=ok(A.advanceSubcontract(s,ctx(s),order.id))
  const first=ok(A.advanceSubcontract(s,ctx(s),order.id,50,'receipt-one'))
  const repeated=ok(A.advanceSubcontract(first,ctx(first),order.id,50,'receipt-one'))
  assert.equal(repeated,first,'same receipt key is an idempotent no-op')
  const second=ok(A.advanceSubcontract(first,ctx(first),order.id,150,'receipt-two'))
  order=second.subcontractOrders.find(o=>o.id===order.id)
  assert.equal(order.receipts.length,2)
  assert.equal(order.receipts.reduce((n,r)=>n+r.serviceCost,0),order.cost)
  assert.equal(order.receipts.reduce((n,r)=>n+r.qty,0),order.qty)
  assert.equal(second.expenses.filter(e=>e.sourceId===order.id).length,s.expenses.filter(e=>e.sourceId===order.id).length,'accepted service is inventory value, not overhead expense')
  let accepted=second
  for(const receipt of order.receipts){
    const check=accepted.qualityChecks.find(q=>q.sourceType==='subcontract'&&q.receiptId===receipt.id)
    accepted=ok(A.resolveQuality(accepted,ctx(accepted),check.id,'Passed'))
    const lot=accepted.lots.find(l=>l.code===receipt.lot&&l.sourceId===order.id)
    assert.ok(lot)
    assert.equal(lot.unitCost,receipt.unitCost)
    assert.equal(lot.costBasis,receipt.costBasis)
    assert.equal(Engine.issueUnitCost(accepted,order.productId,receipt.lot),receipt.unitCost,'MO issue takes the accepted subcontract LOT value into WIP')
    assert.equal(Profit.deliveredLotCost(accepted,order.productId,receipt.lot)?.unitCost,receipt.unitCost,'shipment COGS reads the same frozen LOT value')
  }
})

test('subcontract quote correction is audited before receipts; posted cost and sent material cannot be silently cancelled',()=>{
  const s=fresh(),order=s.subcontractOrders[0]
  const corrected=ok(A.correctSubcontractServiceCost(s,ctx(s),order.id,5000000,1,'Supplier invoice correction'))
  const fixed=corrected.subcontractOrders.find(o=>o.id===order.id)
  assert.equal(fixed.serviceCostUZS,5000000)
  assert.equal(fixed.serviceCorrections.length,1)
  const inProduction=ok(A.advanceSubcontract(corrected,ctx(corrected),order.id))
  const received=ok(A.advanceSubcontract(inProduction,ctx(inProduction),order.id,10,'corrected-receipt'))
  assert.equal(received.subcontractOrders.find(o=>o.id===order.id).receipts[0].serviceCost,250000)
  assert.match(A.correctSubcontractServiceCost(received,ctx(received),order.id,6000000,1,'Late invoice').result.message,/Qabul boshlangan/)
  assert.match(A.cancelSubcontract(received,ctx(received),order.id,'Supplier cancellation').result.message,/qaytarish hisobi/)
  const draft={...order,id:'draft-36',code:'SUB-DRAFT-36',status:'Draft'}
  const cancelled=ok(A.cancelSubcontract({...s,subcontractOrders:[...s.subcontractOrders,draft]},ctx(s),draft.id,'No longer required'))
  assert.equal(cancelled.subcontractOrders.find(o=>o.id===draft.id).status,'Bekor')
})

test('foreign-currency service freezes the dispatch rate and an undocumented historical material cost stays estimated',()=>{
  let s=fresh(),old=s.subcontractOrders[0]
  const draft={...old,id:'fx-36',code:'SUB-FX-36',status:'Draft',qty:1,cost:100,currency:'USD',exchangeRate:12000,warehouseId:'w3',materialCost:undefined,serviceCostUZS:undefined,sentMaterials:undefined,receipts:undefined}
  s={...s,subcontractOrders:[...s.subcontractOrders,draft]}
  const sent=ok(A.advanceSubcontract(s,ctx(s),draft.id))
  const frozen=sent.subcontractOrders.find(o=>o.id===draft.id)
  assert.equal(frozen.serviceCostUZS,1200000)
  assert.ok(frozen.materialCost>=0)
  const undocumented={...old,id:'legacy-36',code:'SUB-LEGACY-36',status:'Ishlab chiqarishda',materialCost:undefined,sentMaterials:undefined,serviceCostUZS:undefined}
  const legacy=ok(A.advanceSubcontract({...s,subcontractOrders:[...s.subcontractOrders,undocumented]},ctx(s),undocumented.id,1,'legacy-receipt'))
  assert.equal(legacy.subcontractOrders.find(o=>o.id===undocumented.id).receipts[0].costBasis,'estimated')
  assert.equal(legacy.subcontractOrders.find(o=>o.id===undocumented.id).materialCost,undefined,'missing historical material cost is not invented')
})

test('ZA-004: public owner entry rejects missing identity before creating an account',()=>{
  const s=fresh(),store=Auth.emptyAuthStore()
  const common={employeeId:'em1',username:'new.owner',phone:'+998 90 555 44 33',credential,company:'Acme',name:'Owner'}
  assert.match(Auth.registerCompanyOwner(store,s,authCtx(s),{...common,name:' '} ).error,/Ism/)
  assert.match(Auth.registerCompanyOwner(store,s,authCtx(s),{...common,company:' '} ).error,/Kompaniya/)
  assert.match(Auth.registerCompanyOwner(store,s,authCtx(s),{...common,phone:''}).error,/Telefon/)
  assert.match(Auth.registerCompanyOwner(store,s,authCtx(s),{...common,phone:'90-12'}).error,/Telefon/)
  assert.equal(store.accounts.length,0)
  const created=Auth.registerCompanyOwner(store,s,authCtx(s),common)
  assert.equal(created.store?.accounts.length,1)
  assert.equal(created.state?.employees.find(e=>e.id==='em1')?.roleId,'role_owner')
  assert.equal(created.store?.accounts[0].phone,'+998905554433','phone stored canonically')
  assert.equal(Auth.findAccount(created.store,'90 555 44 33')?.id,created.store?.accounts[0].id,'owner signs in by phone')
  assert.match(Auth.registerCompanyOwner(created.store,s,authCtx(s),{...common,username:'other.owner'}).error,/telefon|allaqachon/i,'phone reused by another account is refused')
})

test('temporary employee credentials expire unused and a reissue restores the change-password flow',()=>{
  const s=fresh(),store=Auth.emptyAuthStore(),created=Auth.createAccount(store,s,authCtx(s),{employeeId:'em2',username:'worker.one',credential})
  assert.equal(created.error,undefined,created.error)
  const account=created.store.accounts[0]
  assert.equal(account.mustChangePassword,true)
  assert.match(Auth.signInBlocker(s,account,account.employeeId,new Date('2026-11-17T12:00:00Z')),/muddati/)
  const reissued=Auth.resetPassword(created.store,s,authCtx(s),account.id,credential)
  assert.equal(reissued.error,undefined,reissued.error)
  const changed=Auth.changeOwnPassword(reissued.store,authCtx(s),account.id,credential)
  assert.equal(changed.error,undefined,changed.error)
  assert.equal(changed.store.accounts[0].temporaryExpiresAt,undefined)
})

test('an existing scoped account loses sign-in when its assigned site is removed',()=>{
  const s=fresh(),store=Auth.emptyAuthStore(),created=Auth.createAccount(store,s,authCtx(s),{employeeId:'em2',username:'worker.site',credential})
  assert.equal(created.error,undefined,created.error)
  const invalid={...s,employees:s.employees.map(e=>e.id==='em2'?{...e,workCenterId:'',warehouseId:undefined,branchId:undefined,branchIds:undefined}:e)}
  assert.match(Auth.signInBlocker(invalid,created.store.accounts[0]),/filial|ish markazi|ombor/)
  assert.equal(Auth.sessionProblem(Auth.recordSuccess(created.store,authCtx(s),created.store.accounts[0],false).session,created.store,invalid,new Date('2026-11-09T12:00:00Z')),'blocked')
})

test('ZA-005: consumed ticket fingerprints survive auth-store reload normalization',()=>{
  const fingerprint='a'.repeat(64),store=Auth.normalizeAuthStore({...Auth.emptyAuthStore(),consumedRecoveryTickets:[fingerprint,'bad']})
  assert.deepEqual(store.consumedRecoveryTickets,[fingerprint])
  assert.deepEqual(Auth.normalizeAuthStore(JSON.parse(JSON.stringify(store))).consumedRecoveryTickets,[fingerprint])
})
