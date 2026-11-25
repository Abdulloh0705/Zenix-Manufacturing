// Phase 4 manufacturing simulation findings (2026-11-20): a lot split across two stores is scanned out of the
// order's own reservation, and a spare part is valued at its lot cost like any other issue.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as I from '../.test-dist/inventory.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

const T0=new Date(2026,9,21,8,0)
let counter=0
const ctx=(s,userId='em1')=>({now:T0,user:s.employees.find(e=>e.id===userId),id:p=>`${p}-p4m${++counter}`})
const ok=(out,label='')=>{assert.ok(out.result.ok,`${label}${out.result.message}`);return out.state}
const bal=(s,key,wh)=>s.stockBalances.find(b=>I.keyOf(b)===key&&b.warehouseId===wh)
function withLot(s,key,warehouseId,qty,code,extra={}){
  const m=s.rawMaterials.find(x=>x.id===key),prev=bal(s,key,warehouseId)
  return {...s,lots:[...s.lots,{id:`lot-${code}-${warehouseId}`,code,kind:'lot',itemId:key,itemType:'raw',qty,originalQty:qty,warehouseId,status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-10-01 08:00',consumedBy:[],...extra}],
    stockBalances:[...s.stockBalances.filter(b=>!(I.keyOf(b)===key&&b.warehouseId===warehouseId)),{id:`st-${key}-${warehouseId}`,warehouseId,key,itemId:key,itemType:'raw',onHand:(prev?.onHand||0)+qty,reserved:prev?.reserved||0,incoming:0,quarantine:0,unit:m.unit}]}
}

test('a lot code held in two raw stores is scanned out of the order’s own reservation',()=>{
  // A second raw store in the same branch, listed first, holds a transferred part of the same lot.
  let s=createInitialState(T0)
  s={...s,warehouses:[...s.warehouses,{id:'w5',name:'Second raw store',code:'RAW-2',branchId:'b1',type:'Raw',status:'Faol',locations:['MAIN']}]}
  s=withLot(s,'rm2','w5',10,'LOT-SPLIT')
  s=withLot(s,'rm2','w1',10,'LOT-SPLIT')
  const created=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:5});s=ok(created)
  const id=created.result.id
  s=ok(A.transitionProduction(s,ctx(s),id,'Tasdiqlangan'),'reserve ')
  const reserved=s.productionOrders.find(o=>o.id===id).reservations
  assert.deepEqual(reserved.map(r=>r.warehouseId),['w1'],'reserved in the default raw store')
  s=ok(A.transitionProduction(s,ctx(s),id,'Jarayonda'),'start ')
  s=ok(A.recordMaterialScan(s,ctx(s),id,'LOT-SPLIT'),'scan ')
  const o=s.productionOrders.find(x=>x.id===id)
  const issued=o.consumed[0]?.qty
  assert.ok(issued>0.72&&issued<0.75,'one unit of BOM qty incl. waste')
  assert.deepEqual(o.consumed.map(c=>[c.warehouseId,c.lot]),[['w1','LOT-SPLIT']])
  assert.equal(bal(s,'rm2','w5').onHand,10,'the free copy in the other store is untouched')
  assert.equal(o.reservations.reduce((n,r)=>n+r.qty,0),Math.round((reserved.reduce((n,r)=>n+r.qty,0)-issued)*1000)/1000,'the reservation shrinks by the scanned amount')
})

test('a spare part is valued at its lot cost, not the standard price, and the expense follows',()=>{
  let s=createInitialState(T0)
  const request={id:'mr-p4',code:'MR-P4',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:'2026-10-21',reason:'Gidravlika bosimi tushadi',downtimeHours:2}
  s=withLot({...s,maintenanceRequests:[request,...s.maintenanceRequests]},'rm4','w1',20,'HW-P4',{unitCost:8000})
  const standard=s.rawMaterials.find(m=>m.id==='rm4').standardCost
  assert.notEqual(standard,8000,'the fixture lot cost differs from the standard price')
  const approved=A.approveMaintenanceRequest(s,ctx(s),'mr-p4');s=ok(approved)
  const id=approved.result.id
  s=ok(A.issueMaintenancePart(s,ctx(s),id,{materialId:'rm4',warehouseId:'w1',qty:2,key:'p4-k1'}))
  const part=s.maintenanceOrders.find(m=>m.id===id).parts[0]
  assert.equal(part.unitCost,8000)
  assert.equal(A.maintenancePartsCost(s.maintenanceOrders.find(m=>m.id===id)),16000)
  s=ok(A.startMaintenance(s,ctx(s),id))
  s=ok(A.completeMaintenance(s,ctx(s),id,150000,'Muhr almashtirildi'))
  assert.deepEqual(s.expenses.filter(e=>e.note?.startsWith(s.maintenanceOrders.find(m=>m.id===id).code)).map(e=>e.amount),[166000])
})
