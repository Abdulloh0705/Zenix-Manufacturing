export type FlatRow=Record<string,string|number|boolean|null|undefined>

/**
 * Text a spreadsheet would run as a formula (starting with =, +, -, @, tab or CR) gets a leading apostrophe,
 * so an exported cell can never execute (BUG-18, CSV injection). Numbers and booleans are written as they are.
 */
export function neutralize(value:unknown){
  if(typeof value==='number'||typeof value==='boolean')return String(value)
  const text=String(value??'')
  return /^[=+\-@\t\r]/.test(text)?`'${text}`:text
}

const escapeCsv=(value:unknown)=>{
  const text=neutralize(value)
  return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text
}

export function toCsv(rows:FlatRow[]){
  if(!rows.length)return ''
  const headers=Object.keys(rows[0])
  return [headers.map(escapeCsv).join(','),...rows.map(row=>headers.map(h=>escapeCsv(row[h])).join(','))].join('\r\n')
}

export function downloadText(filename:string,text:string,mime='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type:mime})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download=filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),0)
}

/** The UTF-8 byte order mark lets Excel read Uzbek letters (ʻ, ‘, ’) correctly (B3-10). */
const UTF8_BOM='﻿'

export function downloadCsv(filename:string,rows:FlatRow[]){
  downloadText(filename.endsWith('.csv')?filename:`${filename}.csv`,UTF8_BOM+toCsv(rows),'text/csv;charset=utf-8')
}

export function downloadExcel(filename:string,rows:FlatRow[]){
  if(!rows.length){downloadText(filename.endsWith('.xls')?filename:`${filename}.xls`,'','application/vnd.ms-excel');return}
  const headers=Object.keys(rows[0])
  const html=`<meta charset="utf-8"><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(neutralize(h))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${escapeHtml(neutralize(r[h]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  downloadText(filename.endsWith('.xls')?filename:`${filename}.xls`,html,'application/vnd.ms-excel;charset=utf-8')
}

const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch))
