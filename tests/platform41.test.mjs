// Phase 4.1 — platform (SaaS operator) domain. Pure functions over demo metadata; no tenant ERP state is read.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as SaaS from '../.test-dist/saas.mjs'
import * as P from '../.test-dist/platform.mjs'
import {hasPermission} from '../.test-dist/access.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const now=new Date('2026-11-09T08:00:00.000Z')
const iso=(days)=>new Date(now.getTime()+days*86400000).toISOString()
const T=(n)=>`tenant-0000000${n}-0000-4000-8000-000000000000`
const actor='platform.operator'

function fixture(){
  const tenants=[
    {id:T(1),name:'Alfa',status:'active',ownerAccountId:'a1',createdAt:iso(-40)},
    {id:T(2),name:'Beta',status:'active',ownerAccountId:'a2',createdAt:iso(-10)},
    {id:T(3),name:'Gamma',status:'suspended',ownerAccountId:'a3',createdAt:iso(-5),suspensionReason:'policy review'},
    {id:T(4),name:'Delta',status:'active',ownerAccountId:'a4',createdAt:iso(-2)},
    {id:T(5),name:'Epsilon',status:'active',ownerAccountId:'a5',createdAt:iso(-1)},
  ]
  const m=(t,a,status='active')=>({id:`m-${t}-${a}`,tenantId:t,accountId:a,employeeId:'em1',status,createdAt:iso(-1)})
  const memberships=[m(T(1),'a1'),m(T(1),'shared'),m(T(2),'a2'),m(T(2),'shared'),m(T(3),'a3'),m(T(4),'a4','disabled'),m(T(4),'x4')]
  const subscriptions=[
    // Alfa: a trial history row followed by an active Plus row — counted once, as active Plus.
    {id:'s1a',tenantId:T(1),planId:'enterprise',status:'trial',startsAt:iso(-40),endsAt:iso(-26)},
    {id:'s1b',tenantId:T(1),planId:'plus',status:'active',startsAt:iso(-26)},
    {id:'s2',tenantId:T(2),planId:'enterprise',status:'trial',startsAt:iso(-10),endsAt:iso(3)},
    {id:'s3',tenantId:T(3),planId:'pro',status:'active',startsAt:iso(-5)},
    {id:'s4',tenantId:T(4),planId:'free',status:'trial',startsAt:iso(-20),endsAt:iso(-1)},
  ]
  const saas={version:1,tenants,memberships,subscriptions,events:[]}
  assert.ok(SaaS.normalizeSaaSStore(saas),'fixture is valid metadata')
  return {saas,platform:P.emptyPlatformStore()}
}

test('overview counts are derived from stored records, one row per tenant, with no revenue fields',()=>{
  const snap=fixture(),o=P.platformOverview(snap.saas,snap.platform,now)
  assert.equal(o.total,5);assert.equal(o.active,4);assert.equal(o.suspended,1)
  assert.deepEqual(o.byStatus,{trial:1,active:2,grace:0,expired:1,suspended:0,none:1})
  assert.deepEqual(o.byPlan,{free:1,plus:1,pro:1,enterprise:1})
  assert.equal(Object.values(o.byPlan).reduce((a,b)=>a+b,0)+o.byStatus.none,o.total,'no tenant counted twice')
  // Suspended tenant Gamma and the disabled Delta member are excluded; `shared` is one account in two tenants.
  assert.equal(o.activeMemberships,5);assert.equal(o.activeAccounts,4)
  assert.deepEqual(o.expiringTrials.map(r=>r.name),['Beta'])
  assert.equal(o.expiringTrials[0].daysLeft,3)
  for(const k of ['mrr','revenue','uptime','latency'])assert.equal(k in o,false)
  const empty=P.platformOverview({version:1,tenants:[],memberships:[],subscriptions:[],events:[]},P.emptyPlatformStore(),now)
  assert.equal(empty.total,0);assert.deepEqual(empty.expiringTrials,[])
})

test('effective status treats lapsed trial/grace as expired and missing trial end as expired',()=>{
  assert.equal(P.effectiveStatus(undefined,now),'none')
  assert.equal(P.effectiveStatus({status:'trial',endsAt:iso(-1)},now),'expired')
  assert.equal(P.effectiveStatus({status:'trial'},now),'expired')
  assert.equal(P.effectiveStatus({status:'grace',endsAt:iso(2)},now),'grace')
  assert.equal(P.effectiveStatus({status:'active'},now),'active')
  assert.equal(P.maskEmail('owner@factory.uz'),'o••••@factory.uz')
  assert.equal(P.maskEmail(undefined),'—')
})

test('suspend/reactivate needs a valid actor and reason, refuses duplicates and audits with a linked event',()=>{
  const snap=fixture()
  const before=JSON.stringify(snap)
  assert.equal(P.opTenantStatus(snap,actor,T(1),'suspended','no',now).ok,false)
  assert.equal(P.opTenantStatus(snap,'x',T(1),'suspended','policy review',now).ok,false)
  assert.equal(P.opTenantStatus(snap,actor,T(3),'suspended','policy review',now).ok,false,'already suspended')
  assert.equal(P.opTenantStatus(snap,actor,'tenant-missing','suspended','policy review',now).ok,false)
  assert.equal(JSON.stringify(snap),before,'failed actions leave both stores untouched')
  const out=P.opTenantStatus(snap,actor,T(1),'suspended','Abuse investigation',now)
  assert.equal(out.ok,true)
  const t=out.next.saas.tenants.find(x=>x.id===T(1))
  assert.equal(t.status,'suspended');assert.equal(t.suspensionReason,'Abuse investigation')
  assert.deepEqual(out.next.saas.memberships,snap.saas.memberships,'memberships preserved')
  assert.deepEqual(out.next.saas.subscriptions,snap.saas.subscriptions,'subscriptions preserved')
  const a=out.next.platform.audit[0]
  assert.equal(a.action,'tenant.suspend');assert.equal(a.actor,actor);assert.equal(a.outcome,'success');assert.equal(a.saasEventId,out.next.saas.events[0].id)
  assert.equal(P.opTenantStatus(out.next,actor,T(1),'suspended','Abuse investigation',now).ok,false,'repeat click is rejected')
  // A linked SaaS event is not listed twice in the audit trail.
  assert.equal(P.auditTrail(out.next.saas,out.next.platform).length,1)
  // A suspended tenant loses non-core entitlement for its members only through tenant status (checked at login/session).
  assert.equal(SaaS.normalizeSaaSStore(out.next.saas)!==null,true)
})

test('legacy platform events without a linked audit entry stay visible once',()=>{
  const snap=fixture()
  const legacy=SaaS.setTenantStatus(snap.saas,T(2),'suspended','old.operator','older reason',now)
  const trail=P.auditTrail(legacy,snap.platform)
  assert.equal(trail.length,1);assert.equal(trail[0].action,'tenant.suspend');assert.match(trail[0].detail,/eski/)
})

test('subscription override: grace gets an end date from policy, trial cannot be granted, no-op is refused',()=>{
  const snap=fixture()
  assert.equal(P.opOverride(snap,actor,T(2),'pro','trial','extend trial please',now).ok,false)
  assert.equal(P.opOverride(snap,actor,T(1),'plus','active','same as before',now).ok,false,'no-op')
  const grace=P.opOverride(snap,actor,T(4),'free','grace','Payment promised',now)
  assert.equal(grace.ok,true)
  const sub=SaaS.subscriptionFor(grace.next.saas,T(4))
  assert.equal(sub.status,'grace');assert.equal(sub.endsAt,iso(7))
  assert.equal(SaaS.subscriptionActive(sub,now),true);assert.equal(SaaS.subscriptionActive(sub,new Date(Date.parse(iso(8)))),false,'grace lapses')
  assert.equal(grace.next.saas.subscriptions.length,snap.saas.subscriptions.length+1,'history is appended, never rewritten')
  assert.equal(grace.next.platform.audit[0].action,'subscription.override')
  assert.match(grace.next.platform.audit[0].detail,/free\/expired → free\/grace/)
  const custom={...snap,platform:{...snap.platform,settings:{...snap.platform.settings,graceDays:3}}}
  assert.equal(SaaS.subscriptionFor(P.opOverride(custom,actor,T(4),'free','grace','Payment promised',now).next.saas,T(4)).endsAt,iso(3))
  assert.equal(SaaS.platformOverridePlan(snap.saas,T(4),'free','grace',actor,'no end date',now),null,'grace without end is refused')
})

test('owner self-service cannot upgrade an active plan, revive an expired one or reset a trial deadline',()=>{
  const snap=fixture()
  assert.equal(SaaS.changePlan(snap.saas,T(1),'enterprise','a1',now),snap.saas,'active upgrade needs verified payment')
  assert.equal(SaaS.changePlan(snap.saas,T(4),'enterprise','a4',now),snap.saas,'expired trial cannot self-revive')
  let s=snap.saas
  for(const plan of ['plus','pro','enterprise','free','pro'])s=SaaS.changePlan(s,T(2),plan,'a2',now)
  assert.equal(SaaS.subscriptionFor(s,T(2)).endsAt,iso(3),'repeated selection keeps the original trial deadline')
  assert.equal(SaaS.subscriptionFor(s,T(2)).status,'trial')
  const down=SaaS.changePlan(snap.saas,T(1),'free','a1',now)
  assert.equal(SaaS.subscriptionFor(down,T(1)).planId,'free')
  assert.equal(down.subscriptions.length,snap.saas.subscriptions.length+1,'downgrade appends history')
})

test('feature restriction only removes plan modules, never grants a module or an RBAC permission',()=>{
  const snap=fixture()
  assert.equal(SaaS.entitlement(snap.saas,T(1),'sales',now),true)
  assert.equal(P.opFeature(snap,actor,T(1),'settings',false,'not allowed core',now).ok,false,'core module cannot be disabled')
  assert.equal(P.opFeature(snap,actor,T(1),'platform',false,'not allowed module',now).ok,false)
  assert.equal(P.opFeature(snap,actor,T(1),'ai',false,'Plus has no AI module',now).ok,false,'cannot restrict a module outside the plan')
  assert.equal(P.opFeature(snap,actor,T(1),'ai',true,'try to grant AI',now).ok,false,'there is no grant operation')
  const off=P.opFeature(snap,actor,T(1),'sales',false,'Contract dispute',now)
  assert.equal(off.ok,true)
  assert.equal(SaaS.entitlement(off.next.saas,T(1),'sales',now),false)
  assert.equal(SaaS.entitlement(off.next.saas,T(2),'sales',now),true,'other tenants unaffected')
  assert.equal(SaaS.entitlement(off.next.saas,T(1),'subscription',now),true)
  assert.equal(P.opFeature(off.next,actor,T(1),'sales',false,'Contract dispute',now).ok,false,'duplicate')
  const on=P.opFeature(off.next,actor,T(1),'sales',true,'Dispute resolved',now)
  assert.equal(SaaS.entitlement(on.next.saas,T(1),'sales',now),true)
  assert.equal(on.next.saas.featureOverrides.length,2,'history kept')
  assert.deepEqual(on.next.platform.audit.map(a=>a.action),['feature.restore','feature.disable'])
  // Entitlement and RBAC stay independent: a restored module still needs the role permission.
  const s=createInitialState(now),viewer=s.roles.find(r=>!r.permissions?.sales?.includes?.('delete'))
  if(viewer)assert.equal(hasPermission(viewer,'sales','delete'),false)
  assert.equal(SaaS.normalizeSaaSStore(on.next.saas)!==null,true)
  assert.equal(SaaS.normalizeSaaSStore({...on.next.saas,featureOverrides:[{...on.next.saas.featureOverrides[0],tenantId:'tenant-unknown'}]}),null,'override for unknown tenant rejected')
  assert.equal(SaaS.normalizeSaaSStore({...on.next.saas,featureOverrides:[{...on.next.saas.featureOverrides[0],module:'platform'}]}),null)
})

test('settings: validation, sensitive change reason, diff audit, existing subscriptions untouched',()=>{
  const snap=fixture(),base=snap.platform.settings
  assert.ok(P.validateSettings({...base,defaultTrialDays:0}).defaultTrialDays)
  assert.ok(P.validateSettings({...base,defaultTrialDays:1.5}).defaultTrialDays)
  assert.ok(P.validateSettings({...base,graceDays:31}).graceDays)
  assert.ok(P.validateSettings({...base,supportEmail:'nope'}).supportEmail)
  assert.ok(P.validateSettings({...base,brandName:' '}).brandName)
  assert.deepEqual(P.validateSettings(base),{})
  assert.equal(P.opSettings(snap,actor,base,'',now).ok,false,'no change')
  assert.equal(P.opSettings(snap,actor,{...base,defaultTrialDays:30},'',now).ok,false,'sensitive change needs a reason')
  assert.equal(P.opSettings(snap,actor,{...base,supportEmail:'help@zenix.uz'},'',now).ok,true,'contact change needs no reason')
  const out=P.opSettings(snap,actor,{...base,defaultTrialDays:30,registration:'closed'},'Pilot capacity',now)
  assert.equal(out.ok,true)
  assert.equal(out.next.saas,snap.saas,'tenant subscriptions not migrated')
  assert.match(out.next.platform.audit[0].detail,/defaultTrialDays: 14 → 30/)
  assert.deepEqual(P.registrationPolicy(out.next.platform),{open:false,trialDays:30})
  assert.deepEqual(P.registrationPolicy(null),{open:true,trialDays:14})
  assert.deepEqual(P.registrationPolicy({broken:true}),{open:true,trialDays:14},'damaged policy falls back to defaults')
  // newTenant honours the configured trial length and clamps invalid values.
  const s=createInitialState(now),account={id:'acc',employeeId:'em1',createdAt:now.toISOString()}
  assert.equal(SaaS.newTenant(s,account,now,30).subscriptions[0].endsAt,iso(30))
  assert.equal(SaaS.newTenant(s,account,now,999).subscriptions[0].endsAt,iso(14))
})

test('support tickets: validation, transitions, secrets rejected, closed is final, audit kept',()=>{
  const snap=fixture()
  const base={tenantId:T(1),subject:'Cannot add employee',category:'account',priority:'high',assignee:actor,note:'Owner reports limit message'}
  assert.equal(P.opTicketCreate(snap,actor,{...base,subject:'hi'},now).ok,false)
  assert.equal(P.opTicketCreate(snap,actor,{...base,tenantId:'tenant-nope'},now).ok,false)
  assert.equal(P.opTicketCreate(snap,actor,{...base,note:'password: hunter2'},now).ok,false)
  assert.equal(P.opTicketCreate(snap,actor,{...base,note:'ZXR1.1799999999999.abc'},now).ok,false)
  assert.equal(P.opTicketCreate(snap,actor,{...base,assignee:'?'},now).ok,false)
  const created=P.opTicketCreate(snap,actor,base,now)
  assert.equal(created.ok,true)
  const t=created.next.platform.tickets[0]
  assert.equal(t.number,1);assert.equal(t.status,'open');assert.equal(t.notes.length,2)
  assert.equal(P.opTicketCreate(created.next,actor,{...base,tenantId:null},now).next.platform.tickets[0].number,2)
  assert.equal(P.opTicketUpdate(created.next,actor,t.id,{},now).ok,false)
  const prog=P.opTicketUpdate(created.next,actor,t.id,{status:'in_progress',assignee:'support.two',note:'Checked plan limit'},now)
  assert.equal(prog.ok,true)
  const t2=prog.next.platform.tickets[0]
  assert.equal(t2.status,'in_progress');assert.equal(t2.assignee,'support.two');assert.equal(t2.notes.length,5)
  const closed=P.opTicketUpdate(prog.next,actor,t.id,{status:'closed'},now)
  assert.equal(P.opTicketUpdate(closed.next,actor,t.id,{status:'open'},now).ok,false,'closed is final')
  assert.equal(P.canTransition('resolved','open'),true)
  assert.deepEqual(closed.next.platform.audit.map(a=>a.action),['ticket.update','ticket.update','ticket.create'])
  assert.equal(closed.next.saas,snap.saas,'support never mutates company metadata')
})

test('platform store normalization rejects malformed data and caps audit',()=>{
  assert.deepEqual(P.normalizePlatformStore(null),P.emptyPlatformStore())
  assert.equal(P.normalizePlatformStore({version:2}),null)
  assert.equal(P.normalizePlatformStore({version:1,settings:{defaultTrialDays:-1},audit:[],tickets:[]}),null)
  assert.equal(P.normalizePlatformStore({version:1,settings:{},audit:[{id:'a'}],tickets:[]}),null)
  const ok=P.normalizePlatformStore({version:1,settings:{brandName:'Acme'},audit:[],tickets:[]})
  assert.equal(ok.settings.graceDays,7,'missing settings default')
  let p=P.emptyPlatformStore()
  for(let i=0;i<P.PLATFORM_AUDIT_LIMIT+5;i++)p=P.sessionAudit(p,actor,'session.start',now)
  assert.equal(p.audit.length,P.PLATFORM_AUDIT_LIMIT)
  assert.equal(P.sessionAudit(P.emptyPlatformStore(),'<script>','session.start',now).audit[0].actor,'unknown')
})
