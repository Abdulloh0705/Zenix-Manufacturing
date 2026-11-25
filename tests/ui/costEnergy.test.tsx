import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {cleanup} from './helpers'
import {mountApp,seedState} from './appFixture'
import {createProductionOrder} from '../../src/domain/actions'
import {compactMoney} from '../../src/utils/format'
import type {ManufacturingState} from '../../src/types'

afterEach(async()=>{await cleanup()})

function seedCostedOrder(){
  seedState(s=>{
    const now=new Date(),ctx={now,user:s.employees.find(e=>e.id==='em1')!,id:(p:string)=>`${p}-energy-test`}
    const made=createProductionOrder(s,ctx,{productId:'p3',quantity:1})
    assert.ok(made.result.ok,made.result.message)
    const order=made.state.productionOrders[0]
    const planned={material:10,labor:20,machine:30,energy:40,overhead:50,total:150}
    const actual={material:20,labor:30,machine:40,energy:50,overhead:60,total:200}
    return {...made.state,productionOrders:[{...order,status:'Yakunlangan',completed:1,completedAt:now.toISOString(),costSnapshot:{planned,actual,at:now.toISOString()}}]} as ManufacturingState
  })
}

test('cost overview includes energy so components reconcile to total',async()=>{
  seedCostedOrder()
  await mountApp('/costs')
  const row=[...document.querySelectorAll('tr')].find(x=>x.querySelector('td')?.textContent==='Energiya')
  assert.ok(row,'energy has its own component row')
  assert.ok(row.textContent?.includes(compactMoney(40)))
  assert.ok(row.textContent?.includes(compactMoney(50)))
  const total=[...document.querySelectorAll('tr.total')].find(x=>x.textContent?.includes('Jami'))
  assert.ok(total?.textContent?.includes(compactMoney(200)))
})

test('cost report exposes energy as a cost component',async()=>{
  seedCostedOrder()
  await mountApp('/reports?view=costs')
  assert.ok(document.body.textContent?.includes('Energiya'))
})
