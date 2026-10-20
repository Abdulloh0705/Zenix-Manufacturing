// Regression tests for the release round: two tabs writing the same data (BUG-14), purchase-order approval
// and separation of duties (A-M6), role scope (A-H6), phone-number logins and sessions ended by a password change.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import * as Auth from '../.test-dist/auth.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {createSyncedSlot} from '../.test-dist/syncedState.mjs'

let counter=0
const fresh=()=>createSeedState(new Date())
const ctx=(s,userId='em1',now=new Date())=>({now,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-rel${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const refused=(out,pattern)=>{assert.equal(out.result.ok,false,'expected the action to be refused');if(pattern)assert.match(out.result.message,pattern);return out}

/* ------------------------------------------------------------------ BUG-14 -- */

function memoryStore(){
  const data=new Map()
  return {getRaw:k=>data.has(k)?data.get(k):null,setRaw:(k,v)=>{data.set(k,v);return true},data}
}
const customer=(s,c,name)=>A.createEntity(s,c,'customers',{name,phone:'+998901112233',email:'',address:'',status:'Faol',segment:'B2B',creditLimit:0},'Mijoz')

test('BUG-14: an action in a second tab continues from the first tab’s save instead of overwriting it',()=>{
  const store=memoryStore(),KEY='state'
  const seed=fresh()
  store.setRaw(KEY,JSON.stringify(seed))
  const parse=raw=>JSON.parse(raw)
  // Both tabs opened on the same data.
  const tabA=createSyncedSlot(store,KEY,parse,store.getRaw(KEY)),tabB=createSyncedSlot(store,KEY,parse,store.getRaw(KEY))
  let memA=parse(store.getRaw(KEY)),memB=parse(store.getRaw(KEY))

  // The old behaviour: each tab acts on its own copy and writes it later — the first change disappears.
  const naiveA=ok(customer(memA,ctx(memA),'Tab A mijozi'))
  const naiveB=ok(customer(memB,ctx(memB),'Tab B mijozi'))
  const lastWriteWins=[naiveA,naiveB].at(-1)
  assert.equal(lastWriteWins.customers.some(c=>c.name==='Tab A mijozi'),false,'old behaviour loses tab A’s customer')

  // Now: every action reads the latest save first and writes right after.
  memA=tabA.latest(memA).state
  memA=ok(customer(memA,ctx(memA),'Tab A mijozi'));assert.equal(tabA.write(memA),'saved')
  const base=tabB.latest(memB)
  assert.equal(base.changed,true,'tab B sees that tab A saved')
  memB=ok(customer(base.state,ctx(base.state),'Tab B mijozi'));assert.equal(tabB.write(memB),'saved')
  const saved=parse(store.getRaw(KEY))
  assert.ok(saved.customers.some(c=>c.name==='Tab A mijozi')&&saved.customers.some(c=>c.name==='Tab B mijozi'),'both customers are kept')
  // Tab A learns about tab B's save through the storage event; its own echo is ignored.
  assert.equal(tabA.receive(JSON.stringify(memA)),null,'identical text is not reloaded')
  assert.ok(tabA.receive(store.getRaw(KEY)).customers.some(c=>c.name==='Tab B mijozi'))
  assert.equal(tabB.write(memB),'same','an unchanged state is not written again')
})

test('BUG-14: an unreadable value written by another tab is ignored, and a refused write is reported',()=>{
  const store=memoryStore()
  store.setRaw('k','{"ok":1}')
  const slot=createSyncedSlot(store,'k',raw=>{const v=JSON.parse(raw);return v.ok?v:null},store.getRaw('k'))
  store.setRaw('k','{"ok":')
  assert.deepEqual(slot.latest({ok:'mine'}),{state:{ok:'mine'},changed:false},'half-written JSON keeps the current state')
  store.setRaw('k','{"other":1}')
  assert.equal(slot.latest({ok:'mine'}).changed,false,'a foreign shape is not adopted')
  const full={getRaw:()=>null,setRaw:()=>false}
  assert.equal(createSyncedSlot(full,'k',JSON.parse,null).write({a:1}),'failed')
})

/* -------------------------------------------------------------------- A-M6 -- */

function supplierLink(s){
  const link=s.supplierMaterials.find(l=>l.status!=='Arxiv'&&s.suppliers.some(x=>x.id===l.supplierId))
  assert.ok(link,'seed has a supplier ↔ material link')
  return link
}
const poPayload=(s,extra={})=>{const l=supplierLink(s);const qty=Math.max(1,l.moq||1)*(l.unitFactor||1);return {supplierId:l.supplierId,lines:[{materialId:l.materialId,qty,price:1000}],allowBelowMoq:true,...extra}}

test('A-M6: creating a PO that skips the draft stage needs the approve right',()=>{
  const role=id=>fresh().roles.find(r=>r.id===id)
  const manager=role('role2')
  assert.equal(X.hasPermission(manager,'purchases','create'),true)
  assert.equal(X.hasPermission(manager,'purchases','approve'),false)
  assert.equal(X.allowedBy(manager,X.actionRules('createPurchaseOrder',[{status:'Qoralama'}])),true,'a draft (RFQ) is allowed')
  assert.equal(X.allowedBy(manager,X.actionRules('createPurchaseOrder',[{status:'Tasdiqlangan'}])),false,'an approved PO is not')
  assert.equal(X.allowedBy(manager,X.actionRules('createPurchaseOrder',[{}])),false,'no status means approved')
  assert.equal(X.allowedBy(manager,X.actionRules('createPurchaseOrders',[[{status:'Qoralama'},{status:'Tasdiqlangan'}]])),false,'one approved PO in a batch needs approve')
  assert.equal(X.allowedBy(role('role7'),X.actionRules('createPurchaseOrder',[{}])),true,'the procurement manager approves')
})

test('A-M6: with dual approval on, the author of a large PO cannot approve it; another approver can',()=>{
  let s=fresh()
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,poDualApproval:true,poDualApprovalFrom:1}}}
  refused(A.createPurchaseOrder(s,ctx(s,'em1'),poPayload(s)),/ikki kishilik/)
  const draft=A.createPurchaseOrder(s,ctx(s,'em1'),poPayload(s,{status:'Qoralama'}));s=ok(draft)
  const po=s.purchaseOrders.find(p=>p.id===draft.result.id)
  assert.equal(po.createdBy,'em1')
  refused(A.confirmPurchase(s,ctx(s,'em1'),po.id),/boshqa xodim/)
  const approver=s.employees.find(e=>e.id!=='em1')
  s=ok(A.confirmPurchase(s,ctx(s,approver.id),po.id))
  assert.equal(s.purchaseOrders.find(p=>p.id===po.id).approvedBy,approver.id)
  // Below the threshold, or with the policy off, the author may approve.
  let small=fresh()
  const d2=A.createPurchaseOrder(small,ctx(small,'em1'),poPayload(small,{status:'Qoralama'}));small=ok(d2)
  ok(A.confirmPurchase(small,ctx(small,'em1'),d2.result.id),'policy off: ')
})

/* -------------------------------------------------------------------- A-H6 -- */

function orderAt(s,inside){
  // A confirmed MO whose operations do (inside=true) or do not include work center wc2 (em3’s).
  for(const p of s.products){
    const out=A.createProductionOrder(s,ctx(s),{productId:p.id,quantity:2})
    if(!out.result.ok)continue
    const o=out.state.productionOrders.find(x=>x.id===out.result.id)
    if(o.workOrders.some(w=>w.workCenterId==='wc2')===inside)return {s:out.state,o}
  }
  return null
}

test('A-H6: an operator works only at their own work center; Super Admin and all-scope roles are not limited',()=>{
  const s0=fresh()
  const operator=s0.employees.find(e=>e.id==='em3')
  assert.equal(X.roleOf(s0,'em3').scope,'workcenter')
  const away=orderAt(s0,false)
  assert.ok(away,'seed has an MO without wc2 operations')
  assert.match(X.scopeBlocker(away.s,operator,'reportOutput',[away.o.id,1]),/faqat/)
  assert.match(X.scopeBlocker(away.s,operator,'startWorkOrder',[away.o.id,away.o.workOrders[0].id]),/faqat/)
  const home=orderAt(s0,true)
  if(home){
    const wo=home.o.workOrders.find(w=>w.workCenterId==='wc2')
    assert.equal(X.scopeBlocker(home.s,operator,'startWorkOrder',[home.o.id,wo.id]),null,'own work center is allowed')
    const other=home.o.workOrders.find(w=>w.workCenterId!=='wc2')
    if(other)assert.match(X.scopeBlocker(home.s,operator,'startWorkOrder',[home.o.id,other.id]),/faqat/,'another step of the same MO is not')
  }
  assert.equal(X.scopeBlocker(away.s,away.s.employees.find(e=>e.id==='em1'),'reportOutput',[away.o.id,1]),null,'Admin (scope all)')
  assert.equal(X.scopeBlocker(away.s,operator,'createSalesOrder',[{}]),null,'calls that touch no place are not scope-limited')
  const homeless={...operator,workCenterId:''}
  assert.match(X.scopeBlocker({...away.s,employees:away.s.employees.map(e=>e.id==='em3'?homeless:e)},homeless,'reportOutput',[away.o.id,1]),/biriktirilmagan/)
})

test('A-H6: branch scope refuses warehouses and work centers of another branch',()=>{
  let s=fresh()
  const quality=s.employees.find(e=>X.roleOf(s,e.id)?.scope==='branch')
  assert.ok(quality)
  const home=s.workCenters.find(w=>w.id===quality.workCenterId)
  s={...s,branches:[...s.branches,{id:'br-x',name:'Samarqand',code:'SMQ',status:'Faol'}],warehouses:[...s.warehouses,{id:'wh-x',name:'Samarqand ombori',code:'SMQ-R',branchId:'br-x',type:'Raw',status:'Faol',locations:[]}]}
  const own=s.warehouses.find(w=>w.branchId===home.branchId)
  assert.equal(X.scopeBlocker(s,quality,'adjustStock',['m1',own.id,1,'x']),null)
  assert.match(X.scopeBlocker(s,quality,'adjustStock',['m1','wh-x',1,'x']),/boshqa filial/)
  assert.match(X.scopeBlocker(s,quality,'transferStock',['m1',own.id,'wh-x',1]),/boshqa filial/)
})

/* ---------------------------------------------------------------- auth -- */

const T0='2026-10-20T08:00:00.000Z'
const actx=(s,actorId,now=new Date(T0))=>({now,actor:actorId?s.employees.find(e=>e.id===actorId):undefined,id:p=>`${p}-a${++counter}`})
const cred={hash:'h',salt:'s',iterations:1}

test('auth: a phone number is a login in any common spelling and is stored in one form',()=>{
  const s=createSeedState(new Date(T0))
  const out=Auth.setupFirstAdmin(Auth.emptyAuthStore(),s,actx(s),{employeeId:'em1',username:'+998 90 123-45-67',credential:cred})
  assert.equal(out.error,undefined,out.error)
  assert.equal(out.store.accounts[0].username,'+998901234567')
  for(const typed of ['+998901234567','+998 90 123 45 67','998901234567','(90) 123-45-67','901234567'])
    assert.equal(Auth.findAccount(out.store,typed)?.id,out.store.accounts[0].id,typed)
  assert.equal(Auth.findAccount(out.store,'+998901234568'),undefined)
  assert.equal(Auth.validateUsername('+998901234567'),null)
  assert.equal(Auth.validateUsername('qa.admin'),null)
  assert.match(Auth.validateUsername('+99'),/telefon/)
  // Phone-number accounts stay unique however they are typed.
  const second=Auth.createAccount(out.store,out.state,actx(out.state,'em1'),{employeeId:'em2',username:'998 90 123 45 67',credential:cred})
  assert.match(second.error,/band/)
})

test('auth: a password reset or change ends sessions that began earlier',()=>{
  const s0=createSeedState(new Date(T0))
  const setup=Auth.setupFirstAdmin(Auth.emptyAuthStore(),s0,actx(s0),{employeeId:'em1',username:'boss',credential:cred})
  const s=setup.state
  const made=Auth.createAccount(setup.store,s,actx(s,'em1'),{employeeId:'em3',username:'op1',credential:cred,mustChangePassword:false})
  const acc=made.store.accounts.find(a=>a.username==='op1')
  const later=new Date('2026-10-20T09:00:00.000Z')
  const signed=Auth.recordSuccess(made.store,actx(s,'em3',later),acc,true)
  assert.equal(Auth.sessionProblem(signed.session,signed.store,s,later),null)
  const reset=Auth.resetPassword(signed.store,s,actx(s,'em1',new Date('2026-10-20T10:00:00.000Z')),acc.id,{hash:'h2',salt:'s2',iterations:1})
  assert.equal(Auth.sessionProblem(signed.session,reset.store,s,new Date('2026-10-20T10:00:01.000Z')),'credentials')
  // A session started after the change is fine.
  const again=Auth.recordSuccess(reset.store,actx(s,'em3',new Date('2026-10-20T10:05:00.000Z')),reset.store.accounts.find(a=>a.id===acc.id),true)
  assert.equal(Auth.sessionProblem(again.session,again.store,s,new Date('2026-10-20T10:06:00.000Z')),null)
})

/* ------------------------------------------------------------ N-19/B3-15 -- */

test('N-19/B3-15: unbuild returns the content of the MO that made the units, not today’s BOM, at the chosen recovery %',()=>{
  let s=fresh()
  // A finished lot made by an MO, with free stock.
  const lot=s.lots.find(l=>l.sourceType==='production'&&l.qty>=1&&l.status!=='quarantine'&&s.productionOrders.some(o=>o.id===l.sourceId&&o.completed>0))
  assert.ok(lot,'seed has a finished lot made by an MO')
  const mo=s.productionOrders.find(o=>o.id===lot.sourceId)
  // Only this lot is left for the product, so the unbuild takes it.
  s={...s,lots:s.lots.map(l=>l.itemId===lot.itemId&&l.id!==lot.id&&l.kind==='lot'?{...l,qty:0}:l)}
  const available=s.stockBalances.filter(b=>b.itemId===lot.itemId).reduce((a,b)=>a+b.onHand-b.reserved-(b.quarantine||0),0)
  if(available<1)return
  // Later the BOM is changed: every component doubled.
  const bom=s.boms.find(b=>b.productId===lot.itemId&&b.status==='Faol')
  if(bom)s={...s,boms:s.boms.map(b=>b.id===bom.id?{...b,components:b.components.map(c=>({...c,qty:c.qty*2}))}:b)}
  const half=A.unbuildProduct(s,ctx(s),lot.itemId,1,50)
  const after=ok(half)
  const source=after.stockMovements.find(m=>m.type==='Unbuild -')?.source
  const returned=after.stockMovements.filter(m=>m.type==='Return +'&&m.source===source)
  assert.ok(returned.length,'materials come back')
  for(const m of returned){
    const c=mo.bomSnapshot.components.find(x=>x.materialId===m.itemId)
    if(c)assert.ok(m.qty<=c.qty*0.5+1e-9,`${m.itemId}: ${m.qty} must follow the MO's BOM ${mo.bomVersion} (≤ ${c.qty*0.5}), not the doubled one`)
    assert.match(m.note,/50%/)
    assert.doesNotMatch(m.note,/97%/)
  }
  refused(A.unbuildProduct(s,ctx(s),lot.itemId,1,120),/0–100%/)
})

/* -------------------------------------------------------------------- N-14 -- */

test('N-14: MRP needBy is when the demand needs the material, not today + lead time',async()=>{
  const {createMrpPlan}=await import('../.test-dist/manufacturingEngine.mjs')
  const {createInitialState}=await import('../.test-dist/mockData.mjs')
  const {isoDate,addDays}=await import('../.test-dist/dates.mjs')
  let s=createInitialState()
  s={...s,forecasts:[],salesOrders:[]}
  const today=isoDate(new Date())
  const start=addDays(today,40)
  const made=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:50,start,due:addDays(start,5)})
  s=ok(made)
  const mo=s.productionOrders.find(o=>o.id===made.result.id)
  assert.equal(mo.materialReserved,false)
  const plan=createMrpPlan(s)
  const raws=mo.bomSnapshot.components.filter(c=>s.rawMaterials.some(m=>m.id===c.materialId))
  assert.ok(raws.length)
  for(const c of raws){
    const row=plan.purchases.find(p=>p.materialId===c.materialId)
    assert.equal(row.needBy,start,`${c.materialId}: needed when the MO starts`)
  }
  // A material nobody needs on a date keeps "today + lead time".
  const idle=plan.purchases.find(p=>!raws.some(c=>c.materialId===p.materialId))
  if(idle){const m=s.rawMaterials.find(x=>x.id===idle.materialId);assert.equal(idle.needBy,addDays(today,m.leadTime))}
})

/* ------------------------------------------------------------------ BUG-16 -- */

test('BUG-16: OEE counts idle shift time and stops that are still open',async()=>{
  const {workCenterOee}=await import('../.test-dist/manufacturingEngine.mjs')
  const {createInitialState}=await import('../.test-dist/mockData.mjs')
  const base=createInitialState()
  const now=new Date()
  const wc=base.workCenters[0]
  const bomOp={id:'op',name:'Op',workCenterId:wc.id,setupMin:0,runMin:1,employeeCount:1,instructions:'',qualityCheck:false}
  const order={id:'mo-oee',code:'MO-OEE',productId:base.products[0].id,quantity:100,completed:90,scrap:10,bomId:'b',bomVersion:'1',bomSnapshot:{components:[],operations:[bomOp]},warehouseId:'',lineId:'',workCenterId:wc.id,responsibleId:'',status:'Jarayonda',start:'',due:'',progress:0,priority:'Normal',
    workOrders:[{id:'wo',operationId:'op',name:'Op',workCenterId:wc.id,sequence:1,status:'Yakunlangan',plannedMin:100,actualMin:120,dependsOn:[]}],consumed:[],startedAt:now.toISOString(),createdAt:now.toISOString()}
  const s={...base,productionOrders:[order],downtimeEvents:[],timeLogs:[],settings:{...base.settings,policies:{...base.settings.policies,shiftMinutes:480}}}
  const idle=workCenterOee(s,wc.id,7,now)
  assert.equal(idle.plannedMinutes,480,'one shift on the day it worked')
  assert.equal(idle.idleMinutes,360)
  assert.equal(idle.availability,25,'2 h of a 8 h shift is 25%, not 100%')
  assert.equal(idle.performance,83,'100 units × 1 min ideal in 120 min')
  assert.equal(idle.quality,90)
  // A machine stopped an hour ago and still down: the hour counts although the event has no end yet.
  const open={id:'dt',equipmentId:'e',workCenterId:wc.id,reason:'Breakdown',start:new Date(now.getTime()-60*60000).toISOString(),minutes:0,note:''}
  const down=workCenterOee({...s,downtimeEvents:[open]},wc.id,7,now)
  assert.equal(down.downtimeMinutes,60)
  assert.equal(down.idleMinutes,300)
})

/* ------------------------------------------------------------- BUG-07 / A-M2 -- */

test('BUG-07/A-M2: the activity feed is not cut by the domain; overflow is split off for the archive with the actor id kept',()=>{
  let s=fresh()
  s={...s,activity:Array.from({length:A.ACTIVITY_LIMIT},(_,i)=>({id:`old-${i}`,date:'2026-01-01 08:00',user:'X',action:'old',module:'Tizim',severity:'info'}))}
  const next=A.logActivity(s,ctx(s,'em1'),'Yangi amal','Tizim')
  assert.equal(next.activity.length,A.ACTIVITY_LIMIT+1,'nothing is dropped when the entry is written')
  assert.equal(next.activity[0].userId,'em1','who did it is stored by id, not only by name')
  const split=A.splitActivityOverflow(next)
  assert.equal(split.state.activity.length,A.ACTIVITY_LIMIT)
  assert.deepEqual(split.overflow.map(a=>a.id),[`old-${A.ACTIVITY_LIMIT-1}`],'the oldest entry goes to the archive')
  assert.equal(A.splitActivityOverflow(split.state).overflow.length,0)
})

/* -------------------------------------------------------------------- N-20 -- */

test('N-20: extra material beyond the BOM plan needs a reason, comes from free stock, is capped and recorded',()=>{
  let s=fresh()
  const made=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:5});s=ok(made)
  s=ok(A.transitionProduction(s,ctx(s),made.result.id,'Tasdiqlangan'))
  s=ok(A.transitionProduction(s,ctx(s),made.result.id,'Jarayonda'))
  const o=s.productionOrders.find(x=>x.id===made.result.id)
  const c=o.bomSnapshot.components.find(x=>s.rawMaterials.some(m=>m.id===x.materialId))
  refused(A.issueExtraMaterial(s,ctx(s),o.id,c.materialId,1,''),/sabab/i)
  refused(A.issueExtraMaterial(s,ctx(s),o.id,'nope',1,'scrap o‘rniga'),/BOM/)
  const before=s.stockBalances.filter(b=>b.itemId===c.materialId).reduce((a,b)=>a+b.onHand,0)
  const reservedBefore=s.stockBalances.filter(b=>b.itemId===c.materialId).reduce((a,b)=>a+b.reserved,0)
  const extra=Math.min(0.5,c.qty)
  const after=ok(A.issueExtraMaterial(s,ctx(s),o.id,c.materialId,extra,'2 dona scrap o‘rniga'))
  const mo=after.productionOrders.find(x=>x.id===o.id)
  assert.equal(mo.extraIssues.length,1)
  assert.equal(mo.extraIssues[0].by,'em1')
  assert.ok(Math.abs(after.stockBalances.filter(b=>b.itemId===c.materialId).reduce((a,b)=>a+b.onHand,0)-(before-extra))<1e-6)
  assert.equal(after.stockBalances.filter(b=>b.itemId===c.materialId).reduce((a,b)=>a+b.reserved,0),reservedBefore,'reservations are not touched')
  assert.ok(after.stockMovements.some(m=>m.source===o.code&&/Qo‘shimcha chiqim/.test(m.note)))
  // The extra is capped at the BOM plan of that material.
  refused(A.issueExtraMaterial(after,ctx(after),o.id,c.materialId,c.qty*5*(1+(c.waste||0)/100)*3,'yana'),/oshmasin|yetarli emas/)
  // Only planners may do it: operators run work but do not allow extra material.
  assert.equal(X.allowedBy(after.roles.find(r=>r.id==='role5'),X.actionRules('issueExtraMaterial',[])),false)
})

/* -------------------------------------------------------------------- N-07 -- */

function receivedSubcontract(policy){
  let s=fresh()
  s={...s,settings:{...s.settings,policies:{...s.settings.policies,requireFinalQc:policy}}}
  const sc=s.subcontractOrders.find(o=>o.status!=='Qabul qilindi')
  assert.ok(sc,'seed has an open subcontract order')
  while(s.subcontractOrders.find(o=>o.id===sc.id).status!=='Qabul qilindi')s=ok(A.advanceSubcontract(s,ctx(s),sc.id))
  return {s,sc:s.subcontractOrders.find(o=>o.id===sc.id)}
}

test('N-07: a subcontract receipt waits in quarantine for incoming QC; Passed releases it, Scrap writes it off',()=>{
  const {s,sc}=receivedSubcontract(true)
  const q=s.qualityChecks.find(x=>x.sourceType==='subcontract'&&x.sourceId===sc.id)
  assert.ok(q&&q.status==='Pending','an incoming check is opened')
  const bal=x=>x.stockBalances.find(b=>b.warehouseId===sc.warehouseId&&b.itemId===sc.productId)
  assert.ok((bal(s).quarantine||0)>=sc.qty,'the received units are quarantined')
  refused(A.resolveQuality(s,ctx(s),q.id,'Rework','x'),/Passed|Scrap/)
  const passed=ok(A.resolveQuality(s,ctx(s),q.id,'Passed'))
  assert.equal((bal(passed).quarantine||0),(bal(s).quarantine||0)-sc.qty)
  assert.equal(bal(passed).onHand,bal(s).onHand)
  const scrapped=ok(A.resolveQuality(s,ctx(s),q.id,'Scrap','qoplama nuqsoni'))
  assert.equal(bal(scrapped).onHand,bal(s).onHand-sc.qty,'scrap leaves stock')
  refused(A.resolveQuality(passed,ctx(passed),q.id,'Scrap','again'),/allaqachon/)
  // Without the QC policy the receipt is available at once, as before.
  const off=receivedSubcontract(false)
  assert.equal(off.s.qualityChecks.some(x=>x.sourceType==='subcontract'&&x.sourceId===off.sc.id),false)
})

/* ------------------------------------------------------------------ BUG-17 -- */

test('BUG-17: control point frequency decides whether an automatic check is created',()=>{
  const every={frequency:'Every time',sampleRate:100},demand={frequency:'On demand',sampleRate:100}
  assert.equal(A.controlPointDue(every,'k',3),true)
  assert.equal(A.controlPointDue(demand,'k',0),false,'on demand: inspectors create it by hand')
  assert.equal(A.controlPointDue(undefined,'k',0),true,'no control point: the policy decides')
  const periodic={frequency:'Periodic',sampleRate:25}
  assert.deepEqual([0,1,2,3,4,5,6,7,8].map(n=>A.controlPointDue(periodic,'k',n)),[true,false,false,false,true,false,false,false,true],'every 4th event')
  const random={frequency:'Random',sampleRate:30}
  const hits=Array.from({length:1000},(_,i)=>A.controlPointDue(random,`ev-${i}`,i)).filter(Boolean).length
  assert.ok(hits>230&&hits<370,`about 30% sampled (${hits}/1000)`)
  assert.equal(A.controlPointDue(random,'ev-7',7),A.controlPointDue(random,'ev-7',7),'the same event always gets the same decision')
  assert.equal(A.controlPointDue({frequency:'Random',sampleRate:0},'x',0),false)
})

test('N-07: material still in incoming QC quarantine does not leave for the subcontractor',()=>{
  let s=fresh()
  const made=A.createEntity(s,ctx(s),'subcontractOrders',{code:'SUB-TEST-01',supplierId:s.suppliers[0].id,productId:'p3',qty:10,status:'Draft',materialIds:[],expectedDate:'2026-12-01',cost:1000},'Subcontract')
  s=ok(made)
  const sc=s.subcontractOrders.find(o=>o.code==='SUB-TEST-01')
  // Every unit of the components is put on hold in QC.
  const bom=s.boms.find(b=>b.productId==='p3'&&b.status==='Faol')
  assert.ok(bom,'p3 has an active BOM')
  const ids=new Set(bom.components.map(c=>c.materialId))
  const held={...s,stockBalances:s.stockBalances.map(b=>ids.has(b.itemId)?{...b,reserved:0,quarantine:b.onHand}:b)}
  refused(A.advanceSubcontract(held,ctx(held),sc.id),/karantin/)
  ok(A.advanceSubcontract({...s,stockBalances:s.stockBalances.map(b=>ids.has(b.itemId)?{...b,onHand:b.onHand+10000}:b)},ctx(s),sc.id),'free stock ships: ')
})

/* ------------------------------------------------------------------ B3-10 -- */

test('B3-10: CSV downloads start with a UTF-8 BOM so Excel reads Uzbek letters',async()=>{
  const {downloadCsv}=await import('../.test-dist/exportData.mjs')
  let blob
  const saved={document:globalThis.document,window:globalThis.window,create:URL.createObjectURL,revoke:URL.revokeObjectURL}
  globalThis.window={setTimeout:(fn)=>fn()}
  globalThis.document={createElement:()=>({click(){},remove(){},set href(v){},set download(v){}}),body:{appendChild(){}}}
  URL.createObjectURL=b=>{blob=b;return 'blob:x'}
  URL.revokeObjectURL=()=>{}
  try{downloadCsv('test',[{Nomi:'Oʻzbekiston',Soni:1}])}finally{globalThis.document=saved.document;globalThis.window=saved.window;URL.createObjectURL=saved.create;URL.revokeObjectURL=saved.revoke}
  const bytes=new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes.slice(0,3)],[0xEF,0xBB,0xBF])
  assert.match(new TextDecoder().decode(bytes),/Oʻzbekiston/)
})
