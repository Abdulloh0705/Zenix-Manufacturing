import {byText,cleanup,click,render} from './helpers'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {useState} from 'react'
import {ResourceTable} from '../../src/shared/ui'
import type {Column} from '../../src/shared/ui'
import {compareValues,paginate,sortRows} from '../../src/shared/ui/tableSort'

afterEach(cleanup)

test('sort: numbers by value, displayed numbers and dates by meaning, empty values last',()=>{
  assert.deepEqual(sortRows([300,1200000,45],v=>v,1),[45,300,1200000])
  assert.ok(compareValues('1 200 000','300')>0,'grouped digits are a number, not text')
  assert.ok(compareValues('9,5%','10%')<0)
  assert.ok(compareValues('02.11.2026','30.10.2026')>0,'dd.mm.yyyy compares chronologically')
  assert.ok(compareValues('2026-01-05','2025-12-31')>0)
  assert.ok(compareValues('MO-10','MO-9')>0,'codes use natural order')
  assert.deepEqual(sortRows([{v:5},{v:null},{v:1}],r=>r.v,1).map(r=>r.v),[1,5,null])
  assert.deepEqual(sortRows([{v:5},{v:null},{v:1}],r=>r.v,-1).map(r=>r.v),[5,1,null],'empty stays last when descending')
})

test('paginate: clamps the page into range',()=>{
  const rows=Array.from({length:23},(_,i)=>i)
  assert.deepEqual(paginate(rows,3,10),{pages:3,page:3,from:20,slice:[20,21,22]})
  assert.equal(paginate(rows,9,10).page,3)
  assert.equal(paginate([],1,10).pages,1)
})

type Row={id:string;code:string;amount:number;date:string}
const money=(n:number)=>`${n.toLocaleString('ru-RU')} so‘m`
const columns:Column<Row>[]=[
  {key:'code',label:'Kod'},
  {key:'amount',label:'Summa',align:'right',render:r=><b>{money(r.amount)}</b>},
  {key:'date',label:'Sana',render:r=>r.date.split('-').reverse().join('.')},
]
const rows:Row[]=Array.from({length:12},(_,i)=>({id:`r${i}`,code:`MO-${i+1}`,amount:[300,1200000,45,9000][i%4]*(i+1),date:`2026-${String(12-i).padStart(2,'0')}-01`}))

function Table({data=rows}:{data?:Row[]}){const [q,setQ]=useState('');return <ResourceTable rows={data} columns={columns} query={q} onQuery={setQ} emptyTitle="Buyurtma yo‘q"/>}
const cells=(col:number)=>[...document.querySelectorAll('tbody tr')].map(tr=>tr.children[col].textContent)

test('ResourceTable: a formatted money column sorts numerically, a formatted date column chronologically',async()=>{
  await render(<Table/>)
  await click(byText('Summa'))
  const asc=cells(1).map(t=>Number(t!.replace(/\D/g,'')))
  assert.deepEqual(asc,[...asc].sort((a,b)=>a-b),'ascending by amount')
  assert.equal(document.querySelector('th[aria-sort]')?.getAttribute('aria-sort'),'ascending')
  await click(byText('Summa'))
  const desc=cells(1).map(t=>Number(t!.replace(/\D/g,'')))
  assert.deepEqual(desc,[...desc].sort((a,b)=>b-a))
  await click(byText('Sana'))
  assert.equal(cells(2)[0],'01.01.2026','earliest date first')
})

test('ResourceTable: pagination pages through rows; search filters; no-results offers a reset',async()=>{
  await render(<Table/>)
  assert.equal(document.querySelectorAll('tbody tr').length,10)
  await click(document.querySelector('[aria-label="Keyingi sahifa"]'))
  assert.equal(document.querySelectorAll('tbody tr').length,2)
  assert.match(document.querySelector('.pagination b')!.textContent!,/2 \/ 2/)
  const input=document.querySelector<HTMLInputElement>('.search-inline input')!
  const {type}=await import('./helpers')
  await type(input,'MO-11')
  assert.deepEqual(cells(0),['MO-11'],'search uses the visible text; page reset to 1')
  await type(input,'nothing-matches')
  assert.ok(document.body.textContent!.includes('Natija topilmadi'))
  await click(byText('Filtrlarni tozalash'))
  assert.equal(input.value,'')
  assert.equal(document.querySelectorAll('tbody tr').length,10)
})

test('ResourceTable: an empty list shows the empty state, not a no-results message',async()=>{
  await render(<Table data={[]}/>)
  assert.ok(document.body.textContent!.includes('Buyurtma yo‘q'))
  assert.equal(document.querySelector('.pagination'),null)
})
