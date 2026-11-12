import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'
import {actualOrderCost} from '../.test-dist/manufacturingEngine.mjs'
import {deliveredLotCost,profitabilityByProduct} from '../.test-dist/profitability.mjs'

const now=new Date('2026-11-07T09:00:00Z')
let serial=0
const ctx=(s,user='em1')=>({now,user:s.employees.find(e=>e.id===user),id:p=>`${p}-p34-${++serial}`})
const ok=out=>{assert.equal(out.result.ok,true,out.result.message);return out.state}

test('P32-011: Final QC released LOT ships before MO close with frozen actual COGS, then closes without reposting',()=>{
  let s=createInitialState(now)
  const made=A.createProductionOrder(s,ctx(s),{productId:'p1',quantity:4})
  s=ok(made)
  const base=s.productionOrders.find(o=>o.id===made.result.id)
  const mo={...base,status:'Sifat nazoratida',completed:4,qualityStatus:'Pending',qcHeld:4,materialReserved:false,
    consumed:[{id:'issue-p34',materialId:'rm1',qty:8,unitCost:5,lot:'RAW-P34',date:now.toISOString()}],
    workOrders:base.workOrders.map((w,i)=>({...w,status:'Yakunlangan',actualMin:i===0?60:0,machineRate:20,energyRate:2}))}
  const lot={id:'lot-p34',code:'LOT-P34',kind:'lot',itemId:'p1',itemType:'finished',qty:4,warehouseId:mo.warehouseId,status:'quarantine',sourceType:'production',sourceId:mo.id,sourceCode:mo.code,createdAt:now.toISOString(),consumedBy:[]}
  const check={id:'qc-p34',type:'Final',sourceType:'production',sourceId:mo.id,itemId:'p1',status:'Pending',inspectorId:'em4',date:now.toISOString(),lot:lot.code}
  const log={id:'labor-p34',orderId:mo.id,workOrderId:mo.workOrders[0].id,employeeId:'em1',workCenterId:mo.workOrders[0].workCenterId,start:now.toISOString(),minutes:60,hourlyRate:10}
  s={...s,productionOrders:[mo],lots:[lot],qualityChecks:[check],timeLogs:[log],stockBalances:[{id:'fg-p34',warehouseId:mo.warehouseId,itemId:'p1',itemType:'finished',onHand:4,reserved:0,incoming:0,quarantine:4,unit:'dona'}]}
  assert.equal(deliveredLotCost(s,'p1',lot.code,true),undefined,'quarantined output has no sellable cost')
  assert.equal(deliveredLotCost(s,'p1',lot.code),undefined)
  s=ok(A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed'))
  assert.equal(A.resolveQuality(s,ctx(s,'em4'),check.id,'Passed').result.ok,false,'Final QC cannot release twice')
  assert.equal(s.productionOrders[0].costSnapshot,undefined,'Final QC does not pretend the MO is closed')
  const actual=actualOrderCost(s,s.productionOrders[0])
  assert.ok(actual.material>0&&actual.labor>0&&actual.machine>0&&actual.energy>0&&actual.overhead>0,'all recorded cost components feed the LOT')
  assert.equal(deliveredLotCost(s,'p1',lot.code,true).unitCost,Math.round(actual.total/4*100)/100)
  assert.equal(deliveredLotCost(s,'p1',lot.code).unitCost,Math.round(actual.total/4*100)/100,'QC release freezes the LOT valuation')

  const sale=A.createSalesOrder(s,ctx(s),{customerId:'cu1',productId:'p1',qty:4,price:100,mode:'Make-to-stock',deliveryDate:'2026-11-08'})
  s=ok(sale)
  s=ok(A.deliverSalesOrder(s,ctx(s),sale.result.id,{p1:2}))
  const first=s.stockMovements.find(m=>m.type==='Sale -'&&m.source===s.salesOrders.find(o=>o.id===sale.result.id).code)
  assert.equal(first.lot,lot.code)
  assert.equal(first.unitCost,Math.round(actual.total/4*100)/100)
  assert.equal(first.costBasis,'provisional','open MO cost is clearly labelled provisional')
  assert.equal(profitabilityByProduct(s,'2026-11-01').find(r=>r.product.id==='p1').cogs,first.unitCost*2)
  assert.equal(profitabilityByProduct(s,'2026-11-01').find(r=>r.product.id==='p1').costBasis,'provisional')

  s=ok(A.transitionProduction(s,ctx(s),mo.id,'Yakunlangan'))
  assert.equal(A.transitionProduction(s,ctx(s),mo.id,'Yakunlangan').result.ok,false,'MO cannot close twice')
  assert.ok(s.productionOrders[0].costSnapshot,'MO close freezes its own reporting snapshot')
  assert.equal(s.stockMovements.find(m=>m.id===first.id).unitCost,first.unitCost,'close never reposts or revalues the shipment')
  assert.equal(profitabilityByProduct(s,'2026-11-01').find(r=>r.product.id==='p1').costBasis,'provisional','a pre-close shipment keeps its honest valuation label')
  s=ok(A.deliverSalesOrder(s,ctx(s),sale.result.id,{p1:2}))
  const shipments=s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===first.source)
  assert.equal(shipments.length,2)
  assert.equal(shipments.reduce((n,m)=>n-m.qty,0),4)
  assert.equal(profitabilityByProduct(s,'2026-11-01').find(r=>r.product.id==='p1').cogs,first.unitCost*4)
})

test('P32-011: a historical shipment without LOT provenance still has unavailable COGS',()=>{
  const base=createInitialState(now)
  const so={id:'so-old',code:'SO-OLD',customerId:'cu1',status:'Yetkazildi',mode:'Make-to-stock',items:[{productId:'p1',qty:1,price:100,delivered:1,reserved:0}],total:100,paymentStatus:'',deliveryDate:'2026-11-07',createdAt:'2026-11-07'}
  const movement={id:'ship-old',type:'Sale -',itemId:'p1',itemType:'finished',warehouseId:'w3',qty:-1,source:so.code,date:'2026-11-07',user:'seller',note:'old shipment'}
  const row=profitabilityByProduct({...base,salesOrders:[so],stockMovements:[movement]},'2026-11-01').find(r=>r.product.id==='p1')
  assert.equal(row.costBasis,'unavailable')
  assert.equal(row.cogs,null)
})
