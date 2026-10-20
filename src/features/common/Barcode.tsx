import {useApp} from '../../app/providers/AppProvider/AppContext'
import {Icon,Modal} from '../../shared/ui'
import {isoDate} from '../../utils/dates'

// Code 39: 9 elements per character (bar/space alternating, starting with a bar), 1 = wide.
const CODE39:Record<string,string>={
  '0':'000110100','1':'100100001','2':'001100001','3':'101100000','4':'000110001','5':'100110000','6':'001110000','7':'000100101','8':'100100100','9':'001100100',
  A:'100001001',B:'001001001',C:'101001000',D:'000011001',E:'100011000',F:'001011000',G:'000001101',H:'100001100',I:'001001100',J:'000011100',
  K:'100000011',L:'001000011',M:'101000010',N:'000010011',O:'100010010',P:'001010010',Q:'000000111',R:'100000110',S:'001000110',T:'000010110',
  U:'110000001',V:'011000001',W:'111000000',X:'010010001',Y:'110010000',Z:'011010000','-':'010000101','.':'110000100',' ':'011000100','*':'010010100',
  '$':'010101000','/':'010100010','+':'010001010','%':'000101010',
}

export const code39Text=(value:string)=>value.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g,'-')

export function Barcode({value,height=56}:{value:string;height?:number}){
  const text=`*${code39Text(value)}*`
  const narrow=1.4,wide=3.4,gap=narrow
  const bars:Array<{x:number;w:number}>=[]
  let x=0
  for(const ch of text){
    const pattern=CODE39[ch]
    if(!pattern)continue
    for(let i=0;i<9;i++){
      const w=pattern[i]==='1'?wide:narrow
      if(i%2===0)bars.push({x,w})
      x+=w
    }
    x+=gap
  }
  return <svg className="barcode" viewBox={`0 0 ${x} ${height}`} role="img" aria-label={`Barcode ${code39Text(value)}`} preserveAspectRatio="none">
    <rect width={x} height={height} fill="#fff"/>
    {bars.map((b,i)=><rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#0b1220"/>)}
  </svg>
}

export type LabelData={title:string;code:string;lines:Array<[string,string]>}

export function LabelModal({label,onClose}:{label:LabelData|null;onClose:()=>void}){
  const app=useApp()
  return <Modal open={!!label} onClose={onClose} title="Label chop etish" subtitle="Code 39 · printer yoki PDF" size="sm"
    footer={<><button type="button" className="secondary-glass-btn" onClick={onClose}>Yopish</button><button type="button" className="primary-glass-btn" onClick={()=>window.print()}><Icon name="printer" size={16}/>Chop etish</button></>}>
    {label&&<div className="label-sheet print-area">
      <div className="label-head"><b>{app.state.settings.company.name}</b><span>{isoDate()}</span></div>
      <h3>{label.title}</h3>
      <dl>{label.lines.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <Barcode value={label.code}/>
      <code>{code39Text(label.code)}</code>
    </div>}
  </Modal>
}
