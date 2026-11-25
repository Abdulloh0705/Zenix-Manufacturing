import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {cleanup} from './helpers'
import {mountApp,seedState} from './appFixture'
import {createProductionOrder} from '../../src/domain/actions'

afterEach(async()=>{await cleanup()})

test('production yield counts original output once when a rework MO completes',async()=>{
  seedState(s=>{
    const made=createProductionOrder(s,{now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:(p:string)=>`${p}-yield`},{productId:'p3',quantity:100})
    assert.ok(made.result.ok,made.result.message)
    const base=made.state.productionOrders[0]
    const today=new Date().toISOString()
    const original={...base,id:'yield-original',code:'MO-YIELD',status:'Yakunlangan' as const,quantity:100,completed:95,scrap:5,completedAt:today,due:today.slice(0,10),reworkOf:undefined}
    const rework={...original,id:'yield-rework',code:'MO-REWORK',quantity:5,completed:5,scrap:0,reworkOf:original.id}
    return {...s,productionOrders:[original,rework]}
  })
  await mountApp('/reports?view=production')
  const yieldCard=[...document.querySelectorAll('.kpi')].find(el=>el.querySelector('.kpi-label')?.textContent==='Yield')
  assert.equal(yieldCard?.querySelector('strong')?.textContent,'95.0%')
})
