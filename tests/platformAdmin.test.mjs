// Super Admin completion — tenant edit, ticket priority, audit query, secret redaction, monitoring alerts, trends.
// Pure functions over demo metadata; no tenant ERP state is read or written.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as SaaS from '../.test-dist/saas.mjs'
import * as P from '../.test-dist/platform.mjs'

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
  const subscriptions=[
    {id:'s1',tenantId:T(1),planId:'plus',status:'active',startsAt:iso(-26)},
    {id:'s2',tenantId:T(2),planId:'enterprise',status:'trial',startsAt:iso(-10),endsAt:iso(3)},
    {id:'s3',tenantId:T(3),planId:'pro',status:'expired',startsAt:iso(-5)},
    {id:'s4',tenantId:T(4),planId:'free',status:'trial',startsAt:iso(-20),endsAt:iso(-1)},
  ]
  const saas={version:1,tenants,memberships:[],subscriptions,events:[]}
  assert.ok(SaaS.normalizeSaaSStore(saas),'fixture is valid metadata')
  return {saas,platform:P.emptyPlatformStore()}
}

test('tenant rename updates the platform display name, links audit to the company event and keeps other tenants',()=>{
  const snap=fixture()
  const out=P.opTenantRename(snap,actor,T(2),'  Beta Steel  ','Customer legal rename',now)
  assert.equal(out.ok,true)
  const saas=out.next.saas,a=out.next.platform.audit[0]
  assert.equal(saas.tenants.find(t=>t.id===T(2)).name,'Beta Steel')
  assert.deepEqual(saas.tenants.filter(t=>t.id!==T(2)),snap.saas.tenants.filter(t=>t.id!==T(2)),'other tenants untouched')
  assert.equal(saas.events[0].action,'tenant.rename');assert.equal(saas.events[0].tenantId,T(2))
  assert.equal(a.action,'tenant.rename');assert.equal(a.saasEventId,saas.events[0].id);assert.equal(a.detail,'Beta → Beta Steel');assert.equal(a.reason,'Customer legal rename')
  assert.ok(SaaS.normalizeSaaSStore(saas)&&P.normalizePlatformStore(out.next.platform),'result stays valid')
  assert.equal(snap.saas.tenants[1].name,'Beta','input snapshot is not mutated')
})

test('tenant rename rejects duplicates, bad length, secret-like text, no-ops, weak reasons and unknown companies',()=>{
  const snap=fixture(),r='Customer legal rename'
  const err=(name,reason=r,id=T(2),who=actor)=>{const o=P.opTenantRename(snap,who,id,name,reason,now);assert.equal(o.ok,false,name);return o.error}
  assert.match(err('alfa'),/boshqa kompaniyada/,'case-insensitive duplicate')
  assert.match(err('B'),/2–80/)
  assert.match(err('x'.repeat(81)),/2–80/)
  assert.match(err('api_key=abc'),/maxfiy/)
  assert.match(err('Beta'),/O‘zgarish yo‘q|Yangi/)
  assert.match(err('Beta Steel','abc'),/kamida 5/)
  assert.match(err('Beta Steel','password: hunter22'),/maxfiy|parol/)
  assert.match(err('Beta Steel',r,T(9)),/topilmadi/)
  assert.match(err('Beta Steel',r,T(2),'x'),/Operator/)
  assert.equal(P.tenantNameProblem(snap.saas,T(1),'Alfa'),null,'own name is not a duplicate of itself')
})

test('ticket priority change is recorded in history and audit; invalid priority is refused',()=>{
  const snap=fixture()
  const created=P.opTicketCreate(snap,actor,{tenantId:T(1),subject:'Cannot export report',category:'technical',priority:'normal',assignee:actor,note:''},now)
  assert.equal(created.ok,true)
  const id=created.next.platform.tickets[0].id
  const up=P.opTicketUpdate(created.next,actor,id,{priority:'urgent'},now)
  assert.equal(up.ok,true)
  const t=up.next.platform.tickets[0]
  assert.equal(t.priority,'urgent');assert.equal(t.notes.at(-1).kind,'priority');assert.equal(t.notes.at(-1).text,'normal → urgent')
  assert.equal(up.next.platform.audit[0].detail,'normal → urgent')
  assert.equal(P.opTicketUpdate(up.next,actor,id,{priority:'urgent'},now).ok,false,'same priority is a no-op')
  assert.equal(P.opTicketUpdate(up.next,actor,id,{priority:'critical'},now).ok,false)
})

test('safeText hides secret-like stored text; audit search cannot find it',()=>{
  assert.equal(P.safeText('Policy review'),'Policy review')
  assert.equal(P.safeText('token=abc123'),P.REDACTED_TEXT)
  assert.equal(P.safeText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.demo.signature'),P.REDACTED_TEXT)
  assert.match(P.ticketTextProblem('Bearer eyJhbGciOiJIUzI1NiJ9.demo.signature'),/maxfiy/)
  assert.equal(P.safeText('ZXR1.1799999999999.sig'),P.REDACTED_TEXT)
  assert.equal(P.safeText(undefined),'')
  const planted=[{id:'x1',at:iso(0),actor,action:'tenant.suspend',targetType:'tenant',targetId:T(1),tenantId:T(1),reason:'password: hunter22',outcome:'success'}]
  assert.equal(P.auditQuery(planted,{query:'hunter22'}).length,0,'secret value is not searchable')
  assert.equal(P.auditQuery([{...planted[0],reason:'Bearer eyJhbGciOiJIUzI1NiJ9.demo.signature'}],{query:'eyJhbGciOiJIUzI1NiJ9'}).length,0,'Bearer token is not searchable')
  assert.equal(P.auditQuery(planted,{query:'maxfiy qiymat'}).length,1,'redaction marker is what the operator sees')
})

test('audit query filters by actor, type, outcome and inclusive local dates, sorts, and reports reversed ranges',()=>{
  const day=(d)=>{const x=new Date(2026,10,d,12);return x.toISOString()}
  const e=(id,d,a,extra={})=>({id,at:day(d),actor:a,action:'ticket.update',targetType:'ticket',targetId:id,outcome:'success',...extra})
  const rows=[e('a',3,'op.one'),e('b',5,'op.two',{outcome:'denied'}),e('c',7,'op.one',{targetType:'settings',action:'settings.update'}),e('d',9,'op.two')]
  assert.deepEqual(P.auditQuery(rows,{}).map(r=>r.id),['d','c','b','a'],'newest first by default')
  assert.deepEqual(P.auditQuery(rows,{sort:'oldest'}).map(r=>r.id),['a','b','c','d'])
  assert.deepEqual(P.auditQuery(rows,{actor:'op.one'}).map(r=>r.id),['c','a'])
  assert.deepEqual(P.auditQuery(rows,{type:'settings'}).map(r=>r.id),['c'])
  assert.deepEqual(P.auditQuery(rows,{outcome:'denied'}).map(r=>r.id),['b'])
  assert.deepEqual(P.auditQuery(rows,{from:'2026-11-05',to:'2026-11-07'}).map(r=>r.id),['c','b'],'both ends inclusive')
  assert.match(P.auditRangeProblem('2026-11-07','2026-11-05'),/keyin/)
  assert.deepEqual(P.auditQuery(rows,{from:'2026-11-07',to:'2026-11-05'}),[],'reversed range is not silently swapped')
  assert.equal(P.auditRangeProblem('2026-11-05',''),null)
  assert.deepEqual(P.auditQuery(rows,{query:'beta'},()=>'Beta'),[],'tenant label is searched only for rows with a tenant')
})

test('monitoring alerts are derived from records only and ordered by severity',()=>{
  const snap=fixture()
  let platform=snap.platform
  const ticket=(n,priority,updatedAt)=>({id:`t${n}`,number:n,tenantId:null,subject:'Subject long',category:'other',priority,status:'open',assignee:actor,createdAt:updatedAt,createdBy:actor,updatedAt,notes:[]})
  platform={...platform,tickets:[ticket(1,'urgent',iso(0)),ticket(2,'high',iso(-10)),{...ticket(3,'urgent',iso(-30)),status:'closed'}],
    audit:[{id:'d1',at:iso(-0.1),actor,action:'tenant.suspend',targetType:'tenant',targetId:T(1),outcome:'denied'},{id:'d2',at:iso(-3),actor,action:'tenant.suspend',targetType:'tenant',targetId:T(1),outcome:'failed'}]}
  const alerts=P.platformAlerts(snap.saas,platform,now)
  const ids=alerts.map(a=>a.id)
  assert.ok(ids.includes(`sub-expired-${T(4)}`),'lapsed trial on an active company')
  assert.ok(ids.includes(`sub-none-${T(5)}`),'active company without subscription')
  assert.ok(ids.includes(`sub-ending-${T(2)}`),'trial ending within 3 days')
  assert.equal(ids.some(i=>i.endsWith(T(3))),false,'suspended company gets no subscription alert')
  assert.equal(ids.includes(`sub-ending-${T(1)}`)||ids.includes(`sub-expired-${T(1)}`),false,'healthy active plan has no alert')
  assert.ok(ids.includes('tenants-suspended'))
  assert.equal(alerts.find(a=>a.id==='tickets-urgent').title.startsWith('1 '),true,'closed urgent ticket not counted')
  assert.ok(ids.includes('tickets-high'));assert.ok(ids.includes('tickets-stale'))
  assert.match(alerts.find(a=>a.id==='audit-problems').title,/1 ta/,'only the last 24 hours')
  const order={danger:0,warning:1,info:2}
  assert.deepEqual(alerts.map(a=>order[a.severity]),[...alerts.map(a=>order[a.severity])].sort((a,b)=>a-b))
  assert.equal(alerts.every(a=>a.link.startsWith('/platform')),true)
  assert.deepEqual(P.platformAlerts(null,P.emptyPlatformStore(),now),[],'nothing stored → no alerts')
  const full={...P.emptyPlatformStore(),audit:Array.from({length:P.PLATFORM_AUDIT_LIMIT},(_,i)=>({id:`a${i}`,at:iso(-2),actor,action:'session.start',targetType:'session',targetId:'platform',outcome:'success'}))}
  assert.ok(P.platformAlerts(null,full,now).some(a=>a.id==='audit-capacity'))
})

test('registration trend, operator summary, security events and ticket counts',()=>{
  const snap=fixture()
  const trend=P.registrationsByMonth(snap.saas,now,3)
  assert.deepEqual(trend.map(m=>m.key),['2026-09','2026-10','2026-11'])
  assert.deepEqual(trend.map(m=>m.count),[1,1,3],'Alfa in Sep, Beta in Oct, Gamma/Delta/Epsilon in Nov')
  let platform=P.sessionAudit(P.emptyPlatformStore(),'op.one','session.start',new Date(iso(-2)))
  const s=P.opSettings({saas:snap.saas,platform},'op.one',{...platform.settings,brandName:'ZENIX Cloud'},'',new Date(iso(-1)))
  platform=P.sessionAudit(s.next.platform,'op.two','session.start',now)
  const ops=P.platformOperators(platform)
  assert.deepEqual(ops.map(o=>o.actor),['op.two','op.one'],'most recent first')
  assert.equal(ops[1].sessions,1);assert.equal(ops[1].actions,1);assert.equal(ops[1].lastAction,'settings.update')
  const events=P.securityEvents(P.auditTrail(snap.saas,platform))
  assert.deepEqual(events.map(e=>e.action),['session.start','settings.update','session.start'])
  const created=P.opTicketCreate({saas:snap.saas,platform},actor,{tenantId:null,subject:'General question',category:'other',priority:'low',assignee:actor,note:''},now)
  const c=P.ticketCounts(created.next.platform)
  assert.equal(c.open,1);assert.equal(c.open_total,1);assert.equal(c.closed,0)
})
