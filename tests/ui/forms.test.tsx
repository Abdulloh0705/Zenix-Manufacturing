import {byText,cleanup,click,flush,key,render,type} from './helpers'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {useState} from 'react'
import {Field,Input,Modal,Select,Tabs,Toggle,required,useForm} from '../../src/shared/ui'

afterEach(cleanup)

type Rec={id:string;name:string}
function Editor({record,onSave}:{record:Rec;onSave:(v:{name:string})=>void}){
  // Same component instance stays mounted while the record changes (drawer switching records).
  const form=useForm(()=>({name:record.name}),v=>({name:required(v.name,'Nomi')}),record.id)
  return <form onSubmit={e=>{e.preventDefault();form.submit(v=>{onSave(v)})}}>
    <Field label="Nomi" error={form.error('name')}><Input id="name" {...form.input('name')}/></Field>
    <button id="save" type="submit">Saqlash</button>
  </form>
}

test('Form: switching to another record resets values, touched state and errors (no stale state)',async()=>{
  const a={id:'a',name:'Alpha'},b={id:'b',name:'Beta'}
  const view=await render(<Editor record={a} onSave={()=>undefined}/>)
  const input=()=>document.getElementById('name') as HTMLInputElement
  await type(input(),'')
  await click(document.getElementById('save'))
  assert.ok(document.querySelector('.field-error'),'validation error shown for record A')
  await view.rerender(<Editor record={b} onSave={()=>undefined}/>)
  assert.equal(input().value,'Beta','values come from record B')
  assert.equal(document.querySelector('.field-error'),null,'record A’s error is gone')
})

test('Form: a failed submit focuses the first invalid field',async()=>{
  await render(<Modal open onClose={()=>undefined} title="T"><Editor record={{id:'x',name:''}} onSave={()=>undefined}/></Modal>)
  await click(document.getElementById('save'))
  await flush()
  assert.equal(document.activeElement?.id,'name')
  assert.equal(document.activeElement?.getAttribute('aria-invalid'),'true')
})

test('Form: a double submit saves once',async()=>{
  let saves=0
  await render(<Editor record={{id:'x',name:'Ok'}} onSave={()=>{saves++}}/>)
  const save=document.getElementById('save')
  await click(save);await click(save)
  assert.equal(saves,1)
})

test('Select: keyboard opens, moves with arrows, picks with Enter; listbox semantics',async()=>{
  function S(){const [v,setV]=useState('a');return <><Select value={v} onChange={setV} ariaLabel="Harf"><option value="a">Alfa</option><option value="b">Beta</option><option value="c" disabled>Gamma</option></Select><output id="out">{v}</output></>}
  await render(<S/>)
  const trigger=document.querySelector<HTMLButtonElement>('.custom-select-trigger')!
  assert.equal(trigger.getAttribute('aria-haspopup'),'listbox')
  trigger.focus()
  await key(trigger,'ArrowDown')
  assert.equal(trigger.getAttribute('aria-expanded'),'true')
  assert.ok(document.querySelector('[role="listbox"]'))
  await key(trigger,'ArrowDown')
  assert.equal(document.getElementById(trigger.getAttribute('aria-activedescendant')!)?.textContent,'Beta')
  await key(trigger,'ArrowDown')
  assert.equal(document.getElementById(trigger.getAttribute('aria-activedescendant')!)?.textContent,'Beta','disabled option is skipped')
  await key(trigger,'Enter')
  assert.equal(document.getElementById('out')?.textContent,'b')
  assert.equal(trigger.getAttribute('aria-expanded'),'false')
  await key(trigger,'ArrowDown')
  await key(document,'Escape')
  assert.equal(trigger.getAttribute('aria-expanded'),'false','Escape closes the list')
})

test('Tabs: ArrowRight / ArrowLeft / Home / End move selection and focus (roving tabindex)',async()=>{
  function T(){const [v,setV]=useState('one');return <Tabs items={['one','two','three']} active={v} onChange={setV}/>}
  await render(<T/>)
  const tabs=()=>[...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  tabs()[0].focus()
  await key(tabs()[0],'ArrowRight')
  assert.equal(tabs()[1].getAttribute('aria-selected'),'true')
  assert.equal(document.activeElement,tabs()[1])
  assert.deepEqual(tabs().map(t=>t.tabIndex),[-1,0,-1])
  await key(tabs()[1],'ArrowLeft')
  assert.equal(tabs()[0].getAttribute('aria-selected'),'true')
  await key(tabs()[0],'ArrowLeft')
  assert.equal(tabs()[2].getAttribute('aria-selected'),'true','wraps around')
  await key(tabs()[2],'Home')
  assert.equal(tabs()[0].getAttribute('aria-selected'),'true')
})

test('Toggle: a disabled switch does not change and says why',async()=>{
  let changed=false
  await render(<Toggle checked={false} disabled disabledReason="Ruxsat yo‘q" onChange={()=>{changed=true}} label="Test"/>)
  await click(document.querySelector('[role="switch"]'))
  assert.equal(changed,false)
  assert.equal(document.querySelector('.toggle-row')?.getAttribute('title'),'Ruxsat yo‘q')
  assert.ok(byText('Test','b'))
})
