import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import * as A from '../../src/domain/actions'
import type {ManufacturingState} from '../../src/types'

// Quality & Maintenance completion: CAPA actions in the NCR drawer, maintenance request rejection, spare parts.
afterEach(cleanup)
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const text=()=>document.body.textContent||''
let n=0
const ctx=(s:ManufacturingState):A.Ctx=>({now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:p=>`${p}-qmui${++n}`})
const must=(o:A.Outcome)=>{if(!o.result.ok)throw new Error(o.result.message);return o.state}
const request=(s:ManufacturingState)=>({...s,maintenanceRequests:[{id:'mr-ui',code:'MR-UI',equipmentId:'eq1',type:'Corrective' as const,priority:'Yuqori' as const,status:'Yangi' as const,requestedBy:'em3',scheduled:new Date().toISOString().slice(0,10),reason:'Moy oqmoqda',downtimeHours:2},...s.maintenanceRequests]})

test('NCR drawer: a CAPA action is added, done with evidence, and cannot be verified by the person who did it',async()=>{
  let alertId=''
  // An NCR names a real document (SEC-02): a draft MO stands in for the inspected order.
  seedState(base=>{const mo=A.createProductionOrder(base,ctx(base),{productId:'p3',quantity:5});const withMo=must(mo);const s=must(A.createQualityAlert(withMo,ctx(withMo),{title:'Teshik katta',sourceId:mo.result.id!,severity:'Yuqori',reason:'Final QC',ownerId:'em1'}));alertId=s.qualityAlerts[0].id;return s})
  await mountApp(`/quality?view=alerts&id=${alertId}`)
  assert.ok(text().includes('CAPA amali yo‘q'),'empty state')
  await click(byText('Amal qo‘shish'))
  const add=lastDialog()
  assert.equal((byText('Qo‘shish','button',add) as HTMLButtonElement).disabled,true,'description required')
  await type(add.querySelector('textarea'),'Matritsani almashtirish')
  await click(byText('Qo‘shish','button',add));await flush(40)
  assert.equal(stored().qualityAlerts[0].capa!.length,1)
  assert.ok(text().includes('CAPA amallari tasdiqlanishi kerak'),'the NCR shows why it cannot close')
  await click(byText('Bajarildi','button'))
  await type(lastDialog().querySelector('textarea'),'Akt №55, matritsa M-14')
  await click(byText('Bajarildi','button',lastDialog()));await flush(40)
  const c=stored().qualityAlerts[0].capa![0]
  assert.deepEqual([c.status,c.evidence],['Bajarildi','Akt №55, matritsa M-14'])
  assert.equal((byText('Tekshirish','button') as HTMLButtonElement).disabled,true,'self-verification blocked')
})

test('maintenance: a request is rejected with a reason; spare parts are issued from stock in the work order drawer',async()=>{
  seedState(base=>request(base))
  await mountApp('/equipment?view=requests')
  await click(byText('Rad etish'))
  const modal=lastDialog()
  assert.equal((byText('Rad etish','button',modal) as HTMLButtonElement).disabled,true)
  await type(modal.querySelector('textarea'),'Takroriy so‘rov')
  await click(byText('Rad etish','button',modal));await flush(40)
  assert.equal(stored().maintenanceRequests[0].status,'Rad etilgan')
  assert.ok(text().includes('rad etildi: Takroriy so‘rov'))
  await cleanup()
  let orderId=''
  seedState(base=>{
    let s=request(base)
    s=must(A.adjustStock(s,ctx(s),'rm4','w1',50,'Opening'))
    const out=A.approveMaintenanceRequest(s,ctx(s),'mr-ui');orderId=out.result.id!;return must(out)
  })
  await mountApp(`/equipment?view=maintenance&id=${orderId}`)
  assert.ok(text().includes('Ehtiyot qism berilmagan'))
  await click(byText('Qism berish'))
  const issue=lastDialog()
  await type(issue.querySelector('input[aria-label="Qism miqdori"]'),'100000')
  assert.equal((byText('Berish','button',issue) as HTMLButtonElement).disabled,true,'more than free stock is blocked')
  await type(issue.querySelector('input[aria-label="Qism miqdori"]'),'4')
  await click(byText('Berish','button',issue));await flush(40)
  const s=stored(),order=s.maintenanceOrders.find(m=>m.id===orderId)!
  assert.equal(order.parts!.length,1)
  assert.ok(s.stockMovements.some(m=>m.type==='Maintenance Issue -'&&m.source===order.code&&m.qty===-4))
})
