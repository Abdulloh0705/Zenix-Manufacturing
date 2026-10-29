// The one export utility (audit #21): CSV (UTF-8 with BOM) and a real Office Open XML workbook (.xlsx) built here —
// a stored ZIP of SpreadsheetML parts, no dependency. Every file is exactly the format its name says. Text that a
// spreadsheet would run as a formula is neutralised in both formats; numbers stay numbers, calendar days and
// timestamps become real spreadsheet dates. An empty export is refused rather than saved as an empty file.

export type FlatRow=Record<string,string|number|boolean|null|undefined>
export type ExportFormat='csv'|'xlsx'
export type ExportResult={ok:boolean;message:string;filename?:string;rows?:number}

/** Text a spreadsheet would run as a formula (starting with =, +, -, @, tab or CR). */
const FORMULA_START=/^[=+\-@\t\r]/
/**
 * Formula-looking text gets a leading apostrophe, so an exported cell can never execute (BUG-18, CSV injection).
 * Numbers and booleans are written as they are.
 */
export function neutralize(value:unknown){
  if(typeof value==='number'||typeof value==='boolean')return String(value)
  const text=String(value??'')
  return FORMULA_START.test(text)?`'${text}`:text
}

const escapeCsv=(value:unknown)=>{
  const text=neutralize(value)
  return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text
}

/** Column names: every key that appears in any row, in first-seen order (a row without a value leaves the cell empty). */
export function columnsOf(rows:FlatRow[]){
  const seen=new Set<string>()
  for(const r of rows)for(const k of Object.keys(r))seen.add(k)
  return [...seen]
}

export function toCsv(rows:FlatRow[]){
  if(!rows.length)return ''
  const headers=columnsOf(rows)
  return [headers.map(escapeCsv).join(','),...rows.map(row=>headers.map(h=>escapeCsv(row[h])).join(','))].join('\r\n')
}

export function downloadBlob(filename:string,blob:Blob){
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download=filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),0)
}

export function downloadText(filename:string,text:string,mime='text/plain;charset=utf-8'){
  downloadBlob(filename,new Blob([text],{type:mime}))
}

/** The UTF-8 byte order mark lets Excel read Uzbek and Russian letters (ʻ, ‘, ’, ж) correctly (B3-10). */
const UTF8_BOM='﻿'
const withExt=(name:string,ext:string)=>{const base=name.trim().replace(/[\\/:*?"<>|]+/g,'-')||'zenix-export';return base.toLowerCase().endsWith(`.${ext}`)?base:`${base}.${ext}`}

/* ------------------------------------------------------------- XLSX -- */

/** Rows a worksheet can hold besides its header row. */
export const XLSX_MAX_ROWS=1_048_575
const XML_BAD=/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu
const xml=(v:string)=>v.replace(XML_BAD,'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]!))
const colName=(i:number)=>{let s='',n=i+1;while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26)}return s}
const DAY=/^(\d{4})-(\d{2})-(\d{2})$/,STAMP=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/
/** Spreadsheet serial of a calendar day / wall-clock time (days since 1899-12-30): pure calendar math, no timezone. */
function serial(text:string){
  const m=STAMP.exec(text)||DAY.exec(text)
  if(!m)return null
  const [y,mo,d]=[Number(m[1]),Number(m[2]),Number(m[3])]
  const t=Date.UTC(y,mo-1,d)
  const back=new Date(t)
  if(back.getUTCFullYear()!==y||back.getUTCMonth()!==mo-1||back.getUTCDate()!==d)return null
  return (t-Date.UTC(1899,11,30))/864e5+(m[4]?(Number(m[4])*60+Number(m[5]))/1440:0)
}
// Cell styles (styles.xml cellXfs order): 0 text, 1 header, 2 integer, 3 decimal, 4 date, 5 date-time, 6 quoted text.
const S_HEAD=1,S_INT=2,S_DEC=3,S_DATE=4,S_STAMP=5,S_QUOTED=6

function cellXml(ref:string,value:unknown){
  if(value===null||value===undefined||value==='')return ''
  if(typeof value==='number')return Number.isFinite(value)?`<c r="${ref}" s="${Number.isInteger(value)?S_INT:S_DEC}"><v>${value}</v></c>`:''
  if(typeof value==='boolean')return `<c r="${ref}" t="b"><v>${value?1:0}</v></c>`
  const text=String(value)
  const n=serial(text)
  if(n!==null)return `<c r="${ref}" s="${text.length>10?S_STAMP:S_DATE}"><v>${n}</v></c>`
  // Inline strings never evaluate; formula-looking text also gets the quote prefix Excel itself uses for typed '=…'.
  return `<c r="${ref}" t="inlineStr"${FORMULA_START.test(text)?` s="${S_QUOTED}"`:''}><is><t xml:space="preserve">${xml(text)}</t></is></c>`
}

function sheetXml(headers:string[],rows:FlatRow[]){
  const width=headers.map((h,i)=>Math.min(60,Math.max(8,h.length+2,...rows.slice(0,500).map(r=>String(r[headers[i]]??'').length+2))))
  const head=`<row r="1">${headers.map((h,i)=>`<c r="${colName(i)}1" t="inlineStr" s="${S_HEAD}"><is><t xml:space="preserve">${xml(h)}</t></is></c>`).join('')}</row>`
  const body=rows.map((r,ri)=>`<row r="${ri+2}">${headers.map((h,ci)=>cellXml(`${colName(ci)}${ri+2}`,r[h])).join('')}</row>`).join('')
  const last=`${colName(headers.length-1)}${rows.length+1}`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/>`
    +`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    +`<cols>${width.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    +`<sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`
}

const STYLES=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  +`<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>`
  +`<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
  +`<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
  +`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
  +`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  +`<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
  +`<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  +`<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  +`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs>`
  +`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

const sheetTitle=(name:string)=>(name.replace(/[\\/?*[\]:]/g,' ').trim()||'Sheet1').slice(0,31)

/** Workbook parts of one worksheet named `sheet`. */
export function xlsxParts(rows:FlatRow[],sheet='ZENIX'):Record<string,string>{
  const headers=columnsOf(rows)
  return {
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetTitle(sheet))}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xml(sheetTitle(sheet)).replace(/'/g,"''")}'!$A$1:$${colName(headers.length-1)}$${rows.length+1}</definedName></definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':STYLES,
    'xl/worksheets/sheet1.xml':sheetXml(headers,rows),
  }
}

let CRC_TABLE:Uint32Array|undefined
export function crc32(bytes:Uint8Array){
  if(!CRC_TABLE){CRC_TABLE=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CRC_TABLE[n]=c>>>0}}
  let crc=0xFFFFFFFF
  for(let i=0;i<bytes.length;i++)crc=CRC_TABLE[(crc^bytes[i])&0xFF]^(crc>>>8)
  return (crc^0xFFFFFFFF)>>>0
}

/** A ZIP archive with the files stored (no compression) — valid for every unzip tool and for Excel. */
export function zipStored(files:Record<string,string|Uint8Array>,date=new Date(2026,0,1)):Uint8Array{
  const enc=new TextEncoder()
  const dosTime=(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2)
  const dosDate=((date.getFullYear()-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()
  const chunks:Uint8Array[]=[],central:Uint8Array[]=[]
  let offset=0
  for(const [name,content] of Object.entries(files)){
    const data=typeof content==='string'?enc.encode(content):content
    const nameBytes=enc.encode(name),crc=crc32(data)
    const local=new DataView(new ArrayBuffer(30))
    local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x0800,true);local.setUint16(8,0,true)
    local.setUint16(10,dosTime,true);local.setUint16(12,dosDate,true);local.setUint32(14,crc,true)
    local.setUint32(18,data.length,true);local.setUint32(22,data.length,true);local.setUint16(26,nameBytes.length,true);local.setUint16(28,0,true)
    const dir=new DataView(new ArrayBuffer(46))
    dir.setUint32(0,0x02014b50,true);dir.setUint16(4,20,true);dir.setUint16(6,20,true);dir.setUint16(8,0x0800,true);dir.setUint16(10,0,true)
    dir.setUint16(12,dosTime,true);dir.setUint16(14,dosDate,true);dir.setUint32(16,crc,true);dir.setUint32(20,data.length,true);dir.setUint32(24,data.length,true)
    dir.setUint16(28,nameBytes.length,true);dir.setUint16(30,0,true);dir.setUint16(32,0,true);dir.setUint16(34,0,true);dir.setUint16(36,0,true);dir.setUint32(38,0,true);dir.setUint32(42,offset,true)
    chunks.push(new Uint8Array(local.buffer),nameBytes,data)
    central.push(new Uint8Array(dir.buffer),nameBytes)
    offset+=30+nameBytes.length+data.length
  }
  const size=central.reduce((a,c)=>a+c.length,0)
  const end=new DataView(new ArrayBuffer(22))
  const count=Object.keys(files).length
  end.setUint32(0,0x06054b50,true);end.setUint16(8,count,true);end.setUint16(10,count,true);end.setUint32(12,size,true);end.setUint32(16,offset,true)
  const all=[...chunks,...central,new Uint8Array(end.buffer)]
  const out=new Uint8Array(all.reduce((a,c)=>a+c.length,0))
  let at=0
  for(const c of all){out.set(c,at);at+=c.length}
  return out
}

/** The .xlsx file bytes of `rows` (one worksheet, header row frozen and filterable). */
export function toXlsx(rows:FlatRow[],sheet?:string){
  return zipStored(xlsxParts(rows,sheet))
}

/* ----------------------------------------------------------- download -- */

/**
 * Exports `rows` as the named format and says what happened: no file is saved for an empty result, and a result too
 * large for one worksheet is refused with the count (CSV has no row limit).
 */
export function exportRows(format:ExportFormat,name:string,rows:FlatRow[],sheet?:string):ExportResult{
  if(!rows.length||!columnsOf(rows).length)return {ok:false,message:'Eksport uchun ma’lumot yo‘q — fayl yaratilmadi'}
  if(format==='xlsx'){
    if(rows.length>XLSX_MAX_ROWS)return {ok:false,message:`${rows.length} qator Excel varag‘iga sig‘maydi (maks. ${XLSX_MAX_ROWS}) — CSV’dan foydalaning`}
    const filename=withExt(name,'xlsx')
    downloadBlob(filename,new Blob([toXlsx(rows,sheet) as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
    return {ok:true,message:`${filename} yuklab olindi · ${rows.length} qator`,filename,rows:rows.length}
  }
  const filename=withExt(name,'csv')
  downloadText(filename,UTF8_BOM+toCsv(rows),'text/csv;charset=utf-8')
  return {ok:true,message:`${filename} yuklab olindi · ${rows.length} qator`,filename,rows:rows.length}
}

export function downloadCsv(filename:string,rows:FlatRow[]){
  return exportRows('csv',filename,rows)
}

export function downloadXlsx(filename:string,rows:FlatRow[],sheet?:string){
  return exportRows('xlsx',filename,rows,sheet)
}
