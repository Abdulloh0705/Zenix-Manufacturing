import {cleanup,flush,key} from './helpers'
import {mountApp} from './appFixture'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {DOCK_H,BOTTOM_SAFE,TOP_SAFE,DOCK_POSITION_KEY,dockBounds,ratioFromTop,readRatio,topFromRatio} from '../../src/layout/AppLayout/aiDock'
import {buildSearchIndex,searchRecords} from '../../src/layout/AppLayout/searchIndex'
import {notificationModule,visibleNotifications,unreadCount} from '../../src/layout/AppLayout/notificationsView'
import {createInitialState} from '../../src/data/mockData'
import type {NotificationItem} from '../../src/types'

afterEach(cleanup)

test('AI dock: Y stays inside the usable band and the safe area; X never changes',()=>{
  assert.deepEqual(dockBounds(800),{min:TOP_SAFE,max:800-DOCK_H-BOTTOM_SAFE})
  assert.equal(dockBounds(800,34).max,800-DOCK_H-BOTTOM_SAFE-34,'iOS home-indicator inset respected')
  assert.equal(topFromRatio(2,800),800-DOCK_H-BOTTOM_SAFE,'ratio clamped')
  assert.equal(topFromRatio(-1,800),TOP_SAFE)
  assert.equal(ratioFromTop(10_000,800),1)
  assert.equal(dockBounds(100).max,TOP_SAFE,'tiny viewport never inverts the band')
  // Resize keeps the same relative spot.
  const r=ratioFromTop(400,800)
  assert.ok(Math.abs(topFromRatio(r,600)-(TOP_SAFE+r*(600-DOCK_H-BOTTOM_SAFE-TOP_SAFE)))<1e-9)
  assert.equal(readRatio('garbage'),.82);assert.equal(readRatio(null),.82);assert.equal(readRatio(5),1);assert.equal(readRatio(.3),.3)
})

test('AI dock: keyboard moves it (persisted), Enter opens the panel above it, Escape closes the panel',async()=>{
  Object.defineProperty(window,'innerHeight',{configurable:true,value:800})
  await mountApp('/')
  const dock=document.querySelector<HTMLButtonElement>('.ai-dock')!
  assert.ok(dock,'launcher rendered')
  const before=parseFloat(dock.style.top)
  dock.focus()
  await key(dock,'ArrowUp')
  assert.ok(parseFloat(dock.style.top)<before,'↑ moves it up')
  assert.ok(Number(localStorage.getItem(DOCK_POSITION_KEY))<.82,'position stored')
  await (await import('./helpers')).click(dock)
  dock.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))
  await flush()
  assert.ok(document.querySelector('.ai-panel'),'panel open')
  assert.ok(dock.classList.contains('is-hidden'),'launcher hides while the panel is open')
  await key(document,'Escape')
  await flush()
  assert.equal(Boolean(document.querySelector('.ai-panel')),false)
})

test('search index: real records with deep links; serials only from serial lots; permissions respected',()=>{
  const s=createInitialState()
  const all=buildSearchIndex(s,()=>true)
  const types=new Set(all.map(r=>r.type))
  for(const t of ['Mahsulot','Xomashyo','Ombor','Yetkazib beruvchi','Mijoz','Uskuna','Xodim'])assert.ok(types.has(t),`${t} indexed`)
  assert.ok(all.filter(r=>r.type==='Mahsulot').every(r=>/id=p/.test(r.path)))
  assert.equal(all.filter(r=>r.type==='Serial').length,s.lots.filter(l=>l.kind==='serial').length,'no invented serials')
  const onlyMaterials=buildSearchIndex(s,m=>m==='materials')
  assert.ok(onlyMaterials.length>0&&onlyMaterials.every(r=>r.path.startsWith('/materials')))
  assert.deepEqual(searchRecords(all,'  '),[])
  const hit=searchRecords(all,s.rawMaterials[0].sku)
  assert.equal(hit[0].path,`/materials?view=all&id=${s.rawMaterials[0].id}`)
})

const n=(o:Partial<NotificationItem>):NotificationItem=>({id:'n',type:'production',title:'t',text:'x',severity:'info',read:false,date:'2026-10-26 10:00',...o})
test('notifications: module permission + category preference decide visibility; read state is per person',()=>{
  const list=[n({id:'a',type:'quality',path:'/quality?view=alerts&id=q1'}),n({id:'b',type:'low-stock',path:'/materials?view=all&id=rm1'}),n({id:'c',type:'production',path:'/production?view=orders&id=mo1',readBy:['em2']})]
  const prefs={lowStock:true,quality:false,maintenance:true,delay:true,ai:true}
  assert.deepEqual(visibleNotifications(list,()=>true,prefs).map(x=>x.id),['b','c'],'quality turned off')
  assert.deepEqual(visibleNotifications(list,m=>m!=='materials',{...prefs,quality:true}).map(x=>x.id),['a','c'],'no access to materials')
  assert.equal(notificationModule(n({type:'low-stock'})),'materials','unlinked notification falls back to its type')
  assert.equal(unreadCount(list,'em2'),2)
  assert.equal(unreadCount(list,'em1'),3)
})
