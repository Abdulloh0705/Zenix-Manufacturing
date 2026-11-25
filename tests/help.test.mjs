import test from 'node:test'
import assert from 'node:assert/strict'
import {SYSTEM_ROLES,hasPermission} from '../.test-dist/access.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {HELP_COPY,HELP_GUIDES,HELP_TOPICS,canUseGuide,dailyGuides,onboardingKey,searchHelp,topicAt,visibleGuides,visibleTopics,workflowPartners} from '../.test-dist/helpContent.mjs'
import {moduleNav} from '../.test-dist/helpContent.mjs'

const can=role=>(module,action='view')=>hasPermission(role,module,action)
const byKey=key=>SYSTEM_ROLES.find(r=>r.key===key)

test('every current module view and AI route has explicit help; unknown view remains safe',()=>{
  const expected=moduleNav.reduce((n,x)=>n+(x.items?.length||1),0)+1
  assert.equal(HELP_TOPICS.length,expected)
  for(const topic of HELP_TOPICS){
    assert.ok(HELP_COPY[topic.id],`missing help for ${topic.id}`)
    assert.ok(topic.summary.length>20)
    assert.ok(topic.path.startsWith('/'))
  }
  assert.equal(topicAt('/warehouse','?view=transfers',can(byKey('warehouse')))?.id,'/warehouse:transfers')
  assert.equal(topicAt('/warehouse','?view=missing',can(byKey('warehouse'))),undefined)
  assert.equal(topicAt('/not-real','',can(byKey('admin'))),undefined)
  assert.equal(topicAt('/ai','',can(byKey('operator'))),undefined)
})

test('all existing roles receive only permitted topics and actionable guides',()=>{
  for(const role of SYSTEM_ROLES){
    const allowed=can(role)
    assert.ok(visibleTopics(allowed).length>0,role.key)
    for(const topic of visibleTopics(allowed)){
      if(topic.id==='/ai')assert.equal(allowed('ai'),true)
      else {
        const nav=moduleNav.find(n=>n.path===topic.path.split('?')[0])
        assert.ok((nav.anyOf||[nav.module]).some(m=>allowed(m)),`${role.key}: ${topic.id}`)
      }
    }
    for(const guide of visibleGuides(allowed))assert.equal(canUseGuide(guide,allowed),true,`${role.key}: ${guide.id}`)
    for(const guide of dailyGuides(role,allowed))assert.ok(visibleGuides(allowed).includes(guide))
  }
  const op=can(byKey('operator')),warehouse=can(byKey('warehouse')),quality=can(byKey('quality'))
  assert.ok(visibleGuides(op).some(g=>g.id==='shop-floor'))
  assert.ok(!visibleGuides(op).some(g=>['admin-user','transfer','purchase-decision'].includes(g.id)))
  assert.ok(visibleGuides(warehouse).some(g=>g.id==='warehouse-maintenance'))
  assert.ok(!visibleGuides(warehouse).some(g=>g.id==='maintenance'))
  assert.ok(visibleGuides(quality).some(g=>g.id==='quality-check'))
  assert.ok(!visibleGuides(quality).some(g=>g.id==='transfer'))
  assert.equal(visibleGuides(can(byKey('super_admin'))).length,0,'legacy role is read-only')
})

test('search, role recommendations and partners do not reveal forbidden operations',()=>{
  const op=can(byKey('operator'))
  assert.deepEqual(searchHelp('foydalanuvchi yaratish',op),[])
  assert.ok(searchHelp('sex',op).some(h=>h.id==='shop-floor'))
  assert.ok(searchHelp('transfer sababi',can(byKey('warehouse'))).some(h=>h.id==='transfer'))
  assert.ok(!searchHelp('transfer sababi',op).some(h=>h.id==='transfer'))
  assert.deepEqual(searchHelp(' ',op),[])
  const partners=workflowPartners(byKey('operator'),SYSTEM_ROLES,op)
  assert.ok(!partners.includes('Eski Super Admin'))
})

test('catalog browsing and tutorial data do not mutate business state',()=>{
  const state=createSeedState(),before=structuredClone(state)
  const allowed=can(byKey('business_owner'))
  visibleTopics(allowed);visibleGuides(allowed);searchHelp('LOT',allowed)
  for(const guide of HELP_GUIDES){assert.ok(guide.steps.length>=2);assert.ok(guide.result);assert.ok(guide.errors.length)}
  assert.deepEqual(state,before)
  assert.notEqual(onboardingKey('tenant-a','account-1','em1'),onboardingKey('tenant-b','account-1','em1'))
  assert.notEqual(onboardingKey('tenant-a','account-1','em1'),onboardingKey('tenant-a','account-2','em1'))
})

// ---- Completion checks (2026-11-21): catalog ↔ real routes/permissions/UI labels ----
import fs from 'node:fs'
import path from 'node:path'
import {actionRules,entityRules} from '../.test-dist/access.mjs'
import {requirementRules,searchHelp as search} from '../.test-dist/helpContent.mjs'

const read=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?read(path.join(dir,e.name)):/\.(tsx?|css)$/.test(e.name)?[path.join(dir,e.name)]:[])
const appSource=read('src').filter(f=>!f.includes(`${path.sep}features${path.sep}help${path.sep}`)).map(f=>fs.readFileSync(f,'utf8')).join('\n')

test('every help topic links to a real route and a view the page actually renders',()=>{
  const routes=[...fs.readFileSync('src/App.tsx','utf8').matchAll(/Route path="([^"]+)"/g)].map(m=>m[1])
  const tenantRoutes=routes.filter(r=>!['*','/login','/register','/forgot-password','/setup','/platform/*','/help'].includes(r))
  for(const route of tenantRoutes)assert.ok(HELP_TOPICS.some(t=>t.path.split('?')[0]===route),`route ${route} has help`)
  for(const topic of HELP_TOPICS){
    const [pathname,query]=topic.path.split('?')
    assert.ok(routes.includes(pathname),`${topic.id}: ${pathname} is a route`)
    const view=new URLSearchParams(query||'').get('view')
    if(!view)continue
    const folder=path.join('src','features',pathname.slice(1))
    const source=read(folder).map(f=>fs.readFileSync(f,'utf8')).join('\n')
    assert.ok(source.includes(`'${view}'`),`${topic.id}: the ${pathname} page handles view “${view}”`)
  }
})

test('guides reference existing topics, real permission rules and labels that exist in the UI',()=>{
  const ids=HELP_GUIDES.map(g=>g.id)
  assert.equal(new Set(ids).size,ids.length,'guide ids are unique')
  for(const guide of HELP_GUIDES){
    assert.ok(HELP_TOPICS.some(t=>t.id===guide.topic),`${guide.id}: topic ${guide.topic}`)
    assert.ok(guide.requirements.length,`${guide.id}: states what it needs`)
    for(const r of guide.requirements){
      if(r.command)assert.ok(actionRules(r.command,r.args||[])?.length,`${guide.id}: ${r.command} is a guarded domain command`)
      if(r.entity)assert.ok(entityRules(r.entity,r.action).length,`${guide.id}: ${r.entity}.${r.action}`)
      assert.ok(requirementRules(r).length,`${guide.id}: requirement resolves to rules`)
    }
    for(const field of ['prerequisites','steps','fields','errors'])assert.ok(guide[field].length,`${guide.id}: ${field}`)
    assert.ok(guide.result&&guide.next,`${guide.id}: result and next action`)
    const quoted=[...[...guide.steps,...guide.fields,...guide.errors,...guide.prerequisites,guide.result,guide.next].join(' ').matchAll(/“([^”]+)”/g)].map(m=>m[1])
    for(const label of quoted)assert.ok(appSource.includes(label),`${guide.id}: “${label}” is a real UI label`)
  }
})

test('each existing role gets exactly the guides its permission matrix allows',()=>{
  const expected={
    super_admin:[],
    business_owner:HELP_GUIDES.map(g=>g.id),
    admin:HELP_GUIDES.map(g=>g.id),
    production_manager:['material','purchase-request','purchase-order','goods-receipt','bom','production-order','shop-floor','maintenance','warehouse-maintenance','transfer','delivery','reports','stock-count','maintenance-request','maintenance-run'],
    operator:['shop-floor','maintenance-request'],
    quality:['quality-check','capa','reports'],
    maintenance:['maintenance','warehouse-maintenance','reports','maintenance-request','maintenance-run'],
    warehouse:['goods-receipt','warehouse-maintenance','transfer','delivery','reports','stock-count','supplier-invoice','customer-payment'],
    supply_sales:['purchase-request','purchase-decision','purchase-order','goods-receipt','sales-order','delivery','reports','supplier-invoice','customer-payment'],
  }
  assert.deepEqual(Object.keys(expected).sort(),SYSTEM_ROLES.map(r=>r.key).sort(),'every system role is covered')
  for(const role of SYSTEM_ROLES){
    const allowed=can(role)
    assert.deepEqual(visibleGuides(allowed).map(g=>g.id).sort(),[...expected[role.key]].sort(),role.key)
    // Every rule a visible guide needs is really held by the role: no instructions for unauthorized actions.
    for(const guide of visibleGuides(allowed))for(const r of guide.requirements)assert.ok(requirementRules(r).some(([m,a])=>hasPermission(role,m,a)),`${role.key}: ${guide.id}`)
    for(const guide of HELP_GUIDES.filter(g=>!expected[role.key].includes(g.id)))assert.equal(search(guide.title,allowed).some(h=>h.kind==='guide'&&h.id===guide.id),false,`${role.key} cannot find ${guide.id}`)
  }
})

test('a view-only custom role reads the pages but gets no instructions for create/edit actions',()=>{
  const viewer={id:'r-view',name:'Kuzatuvchi',scope:'company',rank:1,permissions:{warehouse:{view:true},purchases:{view:true},sales:{view:true}}}
  const allowed=can(viewer)
  assert.ok(visibleTopics(allowed).some(t=>t.id==='/warehouse:transfers'))
  assert.deepEqual(visibleGuides(allowed),[])
  assert.equal(search('transfer sababi',allowed).some(h=>h.kind==='guide'),false)
})

test('search covers titles, descriptions, steps, fields and common errors',()=>{
  const owner=can(byKey('business_owner'))
  const ids=q=>search(q,owner).map(h=>h.id)
  assert.ok(ids('Inventarizatsiya o‘tkazish').includes('stock-count'),'title')
  assert.ok(ids('fizik sanoqni').includes('stock-count'),'description')
  assert.ok(ids('Sanoqni saqlash').includes('stock-count'),'step')
  assert.ok(ids('FEFO').includes('maintenance'),'field')
  assert.ok(ids('qayta sanang').includes('stock-count'),'common error')
  assert.ok(ids('Natijani saqlash').includes('quality-check'))
  assert.ok(ids('SANOQNI   saqlash').includes('stock-count'),'case and spacing are ignored')
  assert.deepEqual(search('mavjud-bo‘lmagan-atama-xyz',owner),[])
})

test('page explanations quote only labels that exist in the UI',()=>{
  const quoted=Object.values(HELP_COPY).flatMap(c=>[...`${c.summary} ${c.detail}`.matchAll(/“([^”]+)”/g)].map(m=>m[1]))
  assert.ok(quoted.length>0)
  for(const label of quoted)assert.ok(appSource.includes(label),`“${label}” is a real UI label`)
})
