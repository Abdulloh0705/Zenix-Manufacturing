import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as E from '../.test-dist/manufacturingEngine.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const now=new Date(2026,10,20,9)
let seq=0
const ctx=s=>({now,user:s.employees[0],id:p=>`${p}-ind-${++seq}`})
const done=o=>{assert.equal(o.result.ok,true,o.result.message);return o.state}

test('P4-I-01 independent: totals round after summing valid fractional stock values',()=>{
  const s=createInitialState(now)
  const item={...s.rawMaterials[0],id:'ind-steel',standardCost:123.45}
  s.rawMaterials=[item]
  s.stockBalances=['w1','w2'].map((warehouseId,i)=>({id:`ind-b${i}`,warehouseId,itemId:item.id,itemType:'raw',onHand:0.1,reserved:0,incoming:0,unit:'kg'}))
  s.lots=[]
  const expected=Math.round(s.stockBalances.reduce((sum,b)=>sum+b.onHand*item.standardCost,0)*100)/100
  assert.equal(expected,24.69,'independent old standard-cost formula')
  assert.equal(E.inventoryValuation(s).standard,expected)
})

test('P4-I-01 independent: empty, zero cost, missing LOT cost, mixed LOTs and two warehouses',()=>{
  const s=createInitialState(now)
  const steel={...s.rawMaterials[0],id:'ind-steel',standardCost:12}
  const free={...s.rawMaterials[0],id:'ind-free',standardCost:0}
  s.rawMaterials=[steel,free]
  s.stockBalances=[
    {id:'ind-a',warehouseId:'w1',itemId:steel.id,itemType:'raw',onHand:5,reserved:0,incoming:0,unit:'kg'},
    {id:'ind-b',warehouseId:'w2',itemId:steel.id,itemType:'raw',onHand:3,reserved:0,incoming:0,unit:'kg'},
    {id:'ind-c',warehouseId:'w1',itemId:free.id,itemType:'raw',onHand:4,reserved:0,incoming:0,unit:'kg'},
  ]
  const lot=(id,warehouseId,itemId,qty,unitCost)=>({id,code:id,kind:'lot',itemId,itemType:'raw',qty,originalQty:qty,warehouseId,status:'available',sourceType:'adjustment',sourceId:'opening',sourceCode:'OPEN',...(unitCost===undefined?{}:{unitCost}),createdAt:'2026-11-01 08:00',consumedBy:[]})
  s.lots=[lot('a1','w1',steel.id,2,10),lot('a2','w1',steel.id,1,15),lot('b1','w2',steel.id,3,8),lot('c1','w1',free.id,4,undefined)]
  assert.deepEqual(E.stockValuation(s,s.stockBalances[0]),{standard:60,actual:59,variance:-1,lotQty:3,untrackedQty:2})
  assert.deepEqual(E.stockValuation(s,s.stockBalances[1]),{standard:36,actual:24,variance:-12,lotQty:3,untrackedQty:0})
  assert.deepEqual(E.stockValuation(s,s.stockBalances[2]),{standard:0,actual:0,variance:0,lotQty:4,untrackedQty:0})
  assert.deepEqual(E.inventoryValuation(s),{standard:96,actual:83,variance:-13,lotQty:10,untrackedQty:2})
  assert.deepEqual(E.inventoryValuation({...s,stockBalances:[],lots:[]}),{standard:0,actual:0,variance:0,lotQty:0,untrackedQty:0})
})

test('P4-M-04 independent: partial return of mixed-cost LOTs leaves the actual part cost',()=>{
  let s=createInitialState(now)
  s.stockBalances=[{id:'ind-stock',warehouseId:'w1',itemId:'rm4',itemType:'raw',onHand:2,reserved:0,incoming:0,quarantine:0,unit:'dona'}]
  s.lots=[
    {id:'ind-lot-a',code:'IND-A',kind:'lot',itemId:'rm4',itemType:'raw',qty:1,originalQty:1,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'ind-po',sourceCode:'IND-PO',unitCost:100,createdAt:'2026-11-01 08:00',consumedBy:[]},
    {id:'ind-lot-b',code:'IND-B',kind:'lot',itemId:'rm4',itemType:'raw',qty:1,originalQty:1,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'ind-po',sourceCode:'IND-PO',unitCost:200,createdAt:'2026-11-02 08:00',consumedBy:[]},
  ]
  s.maintenanceRequests=[{id:'ind-request',code:'IND-MR',equipmentId:'eq1',type:'Corrective',priority:'Normal',status:'Yangi',requestedBy:'em1',scheduled:'2026-11-20',reason:'Test',downtimeHours:1}]
  const approved=A.approveMaintenanceRequest(s,ctx(s),'ind-request');s=done(approved)
  const orderId=approved.result.id
  s=done(A.issueMaintenancePart(s,ctx(s),orderId,{materialId:'rm4',warehouseId:'w1',qty:2,key:'ind-issue'}))
  const part=s.maintenanceOrders.find(m=>m.id===orderId).parts[0]
  assert.deepEqual(part.lots.map(l=>[l.lot,l.qty]),[['IND-A',1],['IND-B',1]])
  assert.equal(A.maintenancePartsCost(s.maintenanceOrders.find(m=>m.id===orderId)),300,'100 + 200')
  s=done(A.returnMaintenancePart(s,ctx(s),orderId,part.id,1,'ind-return'))
  const remaining=s.maintenanceOrders.find(m=>m.id===orderId)
  assert.equal(s.lots.filter(l=>l.code==='IND-A'&&l.warehouseId==='w1').reduce((n,l)=>n+l.qty,0),1,'the 100-cost lot came back')
  assert.equal(A.maintenancePartsCost(remaining),200,'only the 200-cost lot remains issued')
  s=done(A.startMaintenance(s,ctx(s),orderId))
  s=done(A.completeMaintenance(s,ctx(s),orderId,1000,'Repair complete'))
  assert.equal(s.expenses.find(e=>e.note?.startsWith(remaining.code)).amount,1200,'1,000 work + 200 remaining part')
})
