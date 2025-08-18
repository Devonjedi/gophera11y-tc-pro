import { useMemo, useState } from 'react';

function parseHex(hex:string){ const m=hex.replace('#',''); return [parseInt(m.slice(0,2),16),parseInt(m.slice(2,4),16),parseInt(m.slice(4,6),16)]; }
function luminance(r:number,g:number,b:number){ const s=[r,g,b].map(v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2]; }
function ratio(f:string,b:string){ const [r1,g1,b1]=parseHex(f), [r2,g2,b2]=parseHex(b); const L1=luminance(r1,g1,b1), L2=luminance(r2,g2,b2); const lighter=Math.max(L1,L2), darker=Math.min(L1,L2); return (lighter+0.05)/(darker+0.05); }

export default function Contrast(){
  const [fg,setFg] = useState('7a0019');
  const [bg,setBg] = useState('ffcc33');
  const r = useMemo(()=>ratio(fg,bg),[fg,bg]);
  return <div className="container">
    <div className="card">
      <h2>Brand Contrast (UMN Maroon/Gold)</h2>
      <div className="grid">
        <div className="card">
          Foreground #<input className="input" value={fg} onChange={e=>setFg(e.target.value.replace('#',''))}/>
          Background #<input className="input" value={bg} onChange={e=>setBg(e.target.value.replace('#',''))}/>
        </div>
        <div className="card" style={{background:'#'+bg, color:'#'+fg}}><p>Sample Aa text</p></div>
      </div>
      <p>Contrast ratio: <b>{r.toFixed(2)}:1</b></p>
      <ul>
        <li>WCAG AA (normal ≥ 4.5:1): {r>=4.5?'Pass':'Fail'}</li>
        <li>WCAG AA (large ≥ 3.0:1): {r>=3.0?'Pass':'Fail'}</li>
        <li>WCAG AAA (normal ≥ 7.0:1): {r>=7.0?'Pass':'Fail'}</li>
      </ul>
    </div>
  </div>
}
