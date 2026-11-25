import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createSeedState,createEmptyTenantState} from '../.test-dist/mockData.mjs'

const now=new Date('2026-11-14T08:00:00.000Z')
let serial=0
const ctx=s=>({now,user:s.employees[0],id:p=>`${p}-isolation-${++serial}`})
const denied=(state,out)=>{
  assert.equal(out.result.ok,false,out.result.message)
  assert.equal(out.state,state,'a foreign-ID attempt must not mutate the supplied tenant state')
}

test('foreign record IDs cannot edit, delete, pay, or create a document in the other tenant state',()=>{
  const a=createSeedState(now)
  let b=createEmptyTenantState('ZENIX Demo Packaging','Demo B Owner')
  const supplier=A.createEntity(b,ctx(b),'suppliers',{name:'Demo B Resin Supply',phone:'+998900000002',email:'resin@example.invalid',leadTime:2,rating:5,status:'Faol',debt:0})
  assert.equal(supplier.result.ok,true,supplier.result.message)
  b=supplier.state
  const customer=A.createEntity(b,ctx(b),'customers',{name:'Demo B Buyer',phone:'+998900000003',email:'buyer@example.invalid',type:'B2B',status:'Faol',debt:0})
  assert.equal(customer.result.ok,true,customer.result.message)
  b=customer.state
  const aBefore=JSON.stringify(a),bBefore=JSON.stringify(b)

  for(const key of ['suppliers','customers','products','rawMaterials','boms','purchaseOrders','salesOrders','productionOrders','qualityChecks','maintenanceOrders','lots']){
    const id=a[key][0]?.id
    if(!id)continue
    denied(b,A.updateEntity(b,ctx(b),key,id,{name:'Intrusion'}))
    denied(b,A.deleteEntity(b,ctx(b),key,id))
  }
  denied(a,A.updateEntity(a,ctx(a),'suppliers',supplier.result.id,{name:'Intrusion'}))
  denied(a,A.deleteEntity(a,ctx(a),'suppliers',supplier.result.id))
  denied(a,A.updateEntity(a,ctx(a),'customers',customer.result.id,{name:'Intrusion'}))
  denied(a,A.deleteEntity(a,ctx(a),'customers',customer.result.id))
  denied(b,A.createSalesOrder(b,ctx(b),{customerId:'cu1',mode:'Make-to-stock',deliveryDate:'2026-11-20',lines:[{productId:'p1',qty:1,price:83000}]}))
  denied(b,A.createPurchaseOrder(b,ctx(b),{supplierId:'su1',warehouseId:'w1',status:'Qoralama',lines:[{materialId:'rm1',qty:10}]}))
  denied(b,A.recordCustomerPayment(b,ctx(b),{customerId:'cu1',amount:1000,key:'foreign-payment'}))
  assert.equal(JSON.stringify(a),aBefore)
  assert.equal(JSON.stringify(b),bBefore)
})
