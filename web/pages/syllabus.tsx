import { useState } from 'react';

const REQUIRED_KEYWORDS = ['disability','accommodation','disability resource center','drc','contact','confidential','syllabus','policy'];

function analyze(text:string){
  const t = text.toLowerCase();
  const found = REQUIRED_KEYWORDS.filter(k=>t.includes(k));
  const missing = REQUIRED_KEYWORDS.filter(k=>!t.includes(k));
  const hints = [];
  if(!t.includes('disability')) hints.push('Mention disability accommodations explicitly.');
  if(!t.includes('disability resource center') && !t.includes('drc')) hints.push('Reference the UMN Disability Resource Center (DRC).');
  if(!t.includes('accommodation')) hints.push('Use the word “accommodation”.');
  if(!t.includes('contact')) hints.push('Explain how students initiate accommodations (contact details).');
  return { found, missing, hints };
}

export default function Syllabus(){
  const [text,setText] = useState('');
  const [res,setRes] = useState<{found:string[],missing:string[],hints:string[]}|null>(null);
  return <div className="container">
    <div className="card">
      <h2>Syllabus Accessibility Checker (UMN Heuristics)</h2>
      <textarea className="input" rows={12} value={text} onChange={e=>setText(e.target.value)} />
      <button className="btn" style={{marginTop:8}} onClick={()=>setRes(analyze(text))} disabled={!text.trim()}>Check</button>
    </div>
    {res && <div className="grid">
      <div className="card"><h3>Detected</h3><ul>{res.found.map((k,i)=><li key={i}>✓ {k}</li>)}</ul></div>
      <div className="card"><h3>Missing</h3><ul>{res.missing.map((k,i)=><li key={i}>• {k}</li>)}</ul>
        <div className="card"><b>Hints</b><ul>{res.hints.map((h,i)=><li key={i}>{h}</li>)}</ul></div>
      </div>
    </div>}
  </div>
}
