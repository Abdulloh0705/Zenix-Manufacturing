import test from 'node:test'
import assert from 'node:assert/strict'
import {commandBlocker,hasPermission} from '../.test-dist/access.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {HELP_GUIDES,HELP_TOPICS} from '../.test-dist/helpContent.mjs'
import {actionCheck,contextNotes,guideProbe,moduleOfPath,recordContext,transferCheck,unavailableGuides,workContext} from '../.test-dist/helpContext.mjs'

// Context-aware help (2026-11-21): every "can / cannot" the help shows must be the answer of the real access rules
// (role matrix, commandBlocker with its maintenance assignment and branch / warehouse / work-center scope, record status).

const guide=id=>HELP_GUIDES.find(g=>g.id===id)
function ctxFor(s,employeeId){
  const employee=s.employees.find(e=>e.id===employeeId),role=s.roles.find(r=>r.id===employee.roleId)
  return {state:s,employee,role,can:(m,a='view')=>hasPermission(role,m,a),company:'Test MChJ'}
}
const clone=(s,base,patch)=>({...s.employees.find(e=>e.id===base),...patch})
const maint=(s,id,technicianId,status='Rejada',equipmentId='eq2')=>({...s.maintenanceOrders.find(m=>m.id==='ma-4'),id,code:id.toUpperCase(),technicianId,status,equipmentId,parts:[]})
function seed(){
  const s=createSeedState()
  return {...s,
    employees:[...s.employees,clone(s,'em5',{id:'em5-peer',name:'Peer Engineer'}),
      clone(s,'em2',{id:'wh-b1',name:'Keeper B1',roleId:'role6',workCenterId:'',warehouseId:'w1'}),
      clone(s,'em2',{id:'wh-b2',name:'Keeper B2',roleId:'role6',workCenterId:'',warehouseId:'w4'})],
    maintenanceOrders:[maint(s,'mt-mine','em5'),maint(s,'mt-peer','em5-peer'),maint(s,'mt-done','em5','Yakunlangan'),...s.maintenanceOrders],
  }
}
const actionOf=(record,label)=>record.actions.find(a=>a.label===label)
const blocker=(s,id,name,args)=>commandBlocker(s,s.employees.find(e=>e.id===id),name,args)

test('Maintenance Engineer: spare-part guidance only for orders assigned to them, and why not otherwise',()=>{
  const s=seed(),ctx=ctxFor(s,'em5')
  const wc=workContext(ctx)
  assert.equal(wc.assignmentRule,true)
  assert.deepEqual(wc.assigned.map(m=>m.id).sort(),['ma-4','mt-mine'])
  const mine=recordContext(ctx,'/equipment','?view=maintenance&id=mt-mine')
  assert.equal(actionOf(mine,'Qism berish').ok,true)
  assert.match(mine.facts[0],/\(siz\)/)
  const peer=recordContext(ctx,'/equipment','?view=maintenance&id=mt-peer')
  assert.equal(actionOf(peer,'Qism berish').ok,false)
  assert.equal(actionOf(peer,'Qism berish').reason,'Bu maintenance ishi sizga biriktirilmagan')
  assert.equal(actionOf(peer,'Qism berish').reason,blocker(s,'em5','issueMaintenancePart',['mt-peer',{}]),'same words as the command')
  const done=recordContext(ctx,'/equipment','?view=maintenance&id=mt-done')
  assert.equal(actionOf(done,'Qism berish').ok,false)
  assert.match(actionOf(done,'Qism berish').reason,/Yakunlangan/)
  assert.match(done.next,/yopilgan/)
  assert.equal(guideProbe(ctx,guide('maintenance')).state,'ready')
  assert.match(guideProbe(ctx,guide('maintenance')).text,/MT-MINE/)
  assert.doesNotMatch(guideProbe(ctx,guide('maintenance')).text,/MT-PEER/)
  const note=contextNotes(ctx,'equipment').find(n=>n.id==='mt-assigned')
  assert.equal(note.ok,true);assert.match(note.text,/MT-MINE/)
  // Nothing assigned: the guide says so instead of describing an action they cannot take.
  const bare={...s,maintenanceOrders:s.maintenanceOrders.filter(m=>m.technicianId!=='em5')}
  const idle=guideProbe(ctxFor(bare,'em5'),guide('maintenance'))
  assert.equal(idle.state,'idle');assert.match(idle.text,/biriktirilgan ochiq maintenance ishi yo‘q/)
  // Another equipment-editing role is not bound to assignment (the rule is the Maintenance Engineer's only).
  assert.equal(workContext(ctxFor(s,'em2')).assignmentRule,false)
  assert.equal(actionOf(recordContext(ctxFor(s,'em2'),'/equipment','?view=maintenance&id=mt-peer'),'Qism berish').ok,true)
})

test('Warehouse scope: each keeper is told their own warehouses and every check matches the command',()=>{
  const s=seed()
  const b1=ctxFor(s,'wh-b1'),b2=ctxFor(s,'wh-b2'),owner=ctxFor(s,'em1')
  assert.deepEqual(workContext(b1).warehouses,['Xomashyo ombori'])
  assert.equal(workContext(b1).allWarehouses,false)
  assert.deepEqual(workContext(b2).warehouses,['Chirchiq ombori'])
  assert.equal(workContext(owner).allWarehouses,true)
  assert.equal(workContext(owner).warehouses.length,4)
  // Stock count: only the keeper's own store.
  const count=guideProbe(b1,guide('stock-count'))
  assert.equal(count.state,'ready');assert.match(count.text,/Xomashyo ombori/);assert.doesNotMatch(count.text,/Chirchiq/)
  const foreign=actionCheck(b1,'createStockCount',[{warehouseId:'w4'}])
  assert.equal(foreign.ok,false);assert.equal(foreign.reason,blocker(s,'wh-b1','createStockCount',[{warehouseId:'w4'}]))
  // Transfer availability is whatever dispatchTransfer allows from the keeper's store, reason included.
  const direct=blocker(s,'wh-b1','dispatchTransfer',[{from:'w1',to:'w2'}])
  const tr=transferCheck(b1)
  assert.equal(tr.ok,['w2','w3','w4'].some(to=>!blocker(s,'wh-b1','dispatchTransfer',[{from:'w1',to}])))
  if(!tr.ok)assert.equal(tr.reason,direct)
  assert.equal(transferCheck(owner).ok,true)
  // Spare parts for a maintenance order in another branch: refused with the scope reason.
  const far=recordContext(b2,'/warehouse','?view=maintenance&mo=mt-mine')
  assert.equal(actionOf(far,'Qism berish').ok,false)
  assert.equal(actionOf(far,'Qism berish').reason,blocker(s,'wh-b2','issueMaintenancePart',['mt-mine',{}]))
  assert.equal(actionOf(recordContext(b1,'/warehouse','?view=maintenance&mo=mt-mine'),'Qism berish').ok,true)
  // Receiving, issuing and transferring are explained as different operations, each with its own availability.
  const notes=contextNotes(b1,'warehouse')
  assert.deepEqual(notes.map(n=>n.id),['wh-scope','wh-receive','wh-issue','wh-transfer'])
  assert.match(notes[0].text,/faqat shu omborlarda/)
  assert.equal(notes.find(n=>n.id==='wh-transfer').ok,tr.ok)
})

test('Production Operator: actions at their own work center, no instructions to edit or plan orders',()=>{
  const s=seed(),op=ctxFor(s,'em3')
  assert.equal(workContext(op).workCenter,'Laser Cutting')
  const paused=recordContext(op,'/production','?view=orders&id=mo-8')
  const wo=s.productionOrders.find(o=>o.id==='mo-8').workOrders.find(w=>w.status!=='Yakunlangan')
  const start=actionOf(paused,'Operatsiyani boshlash (START)')
  assert.equal(start.ok,false)
  assert.equal(start.reason,blocker(s,'em3','startWorkOrder',['mo-8',wo.id]),'other work center → scope reason')
  assert.match(start.reason,/Laser Cutting/)
  const draft=recordContext(op,'/production','?view=orders&id=mo-12')
  assert.match(actionOf(draft,'Operatsiyani boshlash (START)').reason,/Qoralama/)
  assert.match(draft.next,/tasdiqlaydi/)
  const edit=actionOf(paused,'Buyurtmani tahrirlash va rejalash')
  assert.equal(edit.ok,false);assert.match(edit.reason,/Ishlab chiqarish: Tahrir/)
  const limits=contextNotes(op,'production').find(n=>n.id==='op-limits')
  assert.match(limits.text,/MO yaratish/);assert.match(limits.text,/tahrirlash/)
  assert.ok(unavailableGuides(op,'/production:orders').some(x=>x.guide.id==='production-order'&&/Ishlab chiqarish: Yaratish/.test(x.reason)))
  // Shop-floor guide: idle until an operation at Laser Cutting can be started.
  assert.equal(guideProbe(op,guide('shop-floor')).state,'idle')
  const ready={...s,productionOrders:s.productionOrders.map(o=>o.id==='mo-11'?{...o,status:'Tasdiqlangan'}:o)}
  const probe=guideProbe(ctxFor(ready,'em3'),guide('shop-floor'))
  assert.equal(probe.state,'ready');assert.match(probe.text,/Laser Cutting/)
  // An operator without a work center cannot start anything, and is told why.
  const lost={...s,employees:s.employees.map(e=>e.id==='em3'?{...e,workCenterId:''}:e)}
  assert.equal(guideProbe(ctxFor(lost,'em3'),guide('shop-floor')).state,'blocked')
})

test('Quality Inspector: inspection, quarantine, rework and release follow permissions and check state',()=>{
  const s=seed(),qi=ctxFor(s,'em4')
  const pending=recordContext(qi,'/quality','?view=checks&id=qc-16')
  assert.equal(actionOf(pending,'Natijani kiritish').ok,blocker(s,'em4','resolveQuality',['qc-16','Passed'])===null)
  assert.match(pending.next,/karantinda qoladi/)
  const ret=recordContext(qi,'/quality','?view=checks&id=qc-20')
  assert.match(actionOf(ret,'Natijani kiritish').reason,/Sotuv → Qaytarishlar/)
  assert.equal(ret.links.length,qi.can('sales')?1:0)
  const decided=recordContext(qi,'/quality','?view=checks&id=qc-19')
  assert.match(actionOf(decided,'Natijani kiritish').reason,/Qaror yakuniy \(Passed\)/)
  assert.match(recordContext(qi,'/quality','?view=checks&id=qc-18').next,/NCR/)
  const notes=contextNotes(qi,'quality')
  assert.deepEqual(notes.map(n=>n.id),['q-inspect','q-quarantine','q-rework','q-capa'])
  assert.equal(notes.find(n=>n.id==='q-capa').ok,qi.can('quality','approve'))
  assert.equal(notes.find(n=>n.id==='q-inspect').ok,qi.can('quality','edit'))
  // An operator reading the same check is told the missing right, not given the decision steps.
  const op=actionCheck(ctxFor(s,'em3'),'resolveQuality',['qc-16','Passed'])
  assert.equal(op.ok,false);assert.match(op.reason,/Sifat: Tahrir/)
})

test('unavailable actions name the exact missing right and carry no steps; unknown records stay safe',()=>{
  const s=seed(),op=ctxFor(s,'em3'),owner=ctxFor(s,'em1')
  const closed=unavailableGuides(op,'/warehouse:transfers')
  assert.deepEqual(closed.map(x=>x.guide.id),['transfer'])
  assert.equal(closed[0].reason,'Kerakli ruxsat: Ombor: Tahrir')
  for(const topic of HELP_TOPICS){
    for(const {guide,reason} of unavailableGuides(op,topic.id))for(const step of guide.steps)assert.ok(!reason.includes(step))
    assert.deepEqual(unavailableGuides(owner,topic.id),[],`owner has every action on ${topic.id}`)
  }
  assert.equal(recordContext(owner,'/equipment','?view=maintenance&id=nope'),'missing')
  assert.equal(recordContext(owner,'/quality','?view=checks&id=nope'),'missing')
  assert.equal(recordContext(owner,'/sales','?view=orders&id=so-1'),undefined,'pages without reliable record context get general help')
  assert.equal(moduleOfPath('/warehouse'),'warehouse')
  assert.equal(moduleOfPath('/not-real'),'not-real')
})

test('context helpers only read: running them for every role and page leaves the state untouched',()=>{
  const s=seed(),before=structuredClone(s)
  for(const id of ['em1','em2','em3','em4','em5','em5-peer','wh-b1','wh-b2']){
    const ctx=ctxFor(s,id)
    workContext(ctx);transferCheck(ctx)
    for(const m of ['warehouse','production','quality','equipment','purchases','sales'])contextNotes(ctx,m)
    for(const g of HELP_GUIDES)guideProbe(ctx,g)
    for(const t of HELP_TOPICS)unavailableGuides(ctx,t.id)
    for(const q of ['?view=maintenance&id=mt-mine','?view=maintenance&id=mt-peer'])recordContext(ctx,'/equipment',q)
    recordContext(ctx,'/production','?view=orders&id=mo-10');recordContext(ctx,'/quality','?view=checks&id=qc-16')
  }
  assert.deepEqual(s,before)
})
