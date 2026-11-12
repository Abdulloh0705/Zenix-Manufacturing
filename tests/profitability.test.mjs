import test from 'node:test'
import assert from 'node:assert/strict'
import {profitabilityByProduct} from '../.test-dist/profitability.mjs'
import {createInitialState} from '../.test-dist/mockData.mjs'

test('P3-P1-03: partial delivery and return reduce net sales and COGS once',()=>{
  const base=createInitialState(new Date('2026-11-07T00:00:00Z'))
  const price=100
  const so={id:'so-profit',code:'SO-PROFIT',customerId:'cu1',status:'Tasdiqlangan',mode:'Make-to-stock',items:[{productId:'p1',qty:10,price,delivered:5,reserved:0}],total:1000,paymentStatus:'',deliveryDate:'2026-11-10',createdAt:'2026-11-01'}
  const sale={id:'move-profit',type:'Sale -',itemId:'p1',itemType:'finished',warehouseId:'w2',qty:-5,source:so.code,date:'2026-11-06T10:00:00Z',user:'seller'}
  const ret={id:'ret-profit',code:'RET-PROFIT',salesOrderId:so.id,customerId:'cu1',productId:'p1',qty:2,reason:'defect',status:'Inspection',createdAt:'2026-11-07T10:00:00Z'}
  const s={...base,salesOrders:[so],stockMovements:[sale],returns:[ret],productionOrders:[]}
  const row=profitabilityByProduct(s,'2026-11-01').find(r=>r.product.id==='p1')
  assert.equal(row.qty,3)
  assert.equal(row.revenue,300)
  assert.equal(row.cogs,null,'a movement without a LOT cannot claim actual cost')
  assert.equal(row.margin,null)
  assert.equal(row.costBasis,'unavailable')
  const returnOnly=profitabilityByProduct(s,'2026-11-07').find(r=>r.product.id==='p1')
  assert.equal(returnOnly.qty,-2)
  assert.equal(returnOnly.revenue,-200)
  assert.equal(profitabilityByProduct(s,'2026-11-08').length,0)
})
