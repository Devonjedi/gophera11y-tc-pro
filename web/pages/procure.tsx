import { useMemo, useState } from 'react';

export default function Procure(){
  const [wcagLevel, setWcagLevel] = useState<'AA'|'AAA'>('AA');
  const [requireACR, setRequireACR] = useState(true);
  const [umClause, setUmClause] = useState(true);

  const checklist = useMemo(()=>{
    const items = [];
    items.push('Follow UMN Digital Accessibility Policy & Procedures.');
    if(requireACR) items.push('Require vendor ACR/VPAT for all platforms (web, iOS, Android).');
    items.push('Target conformance: WCAG 2.2 Level '+wcagLevel+'.');
    items.push('AT compatibility validation: NVDA, JAWS, VoiceOver, TalkBack + test matrix.');
    items.push('Remediation plan/timeline for partial or fail criteria.');
    if(umClause) items.push('Include UMN accessibility contract language (appendix) in the agreement.');
    items.push('Ensure media/documents meet accessibility (captions, PDF/UA or HTML alternatives).');
    return items;
  },[wcagLevel, requireACR, umClause]);

  const clause = `UMN Accessibility Provision (Draft)
Vendor shall ensure the Solution conforms to the University of Minnesota's Accessibility of Digital Content and Information Technology Policy and associated procedures, including Digital Accessibility in Procurement. Vendor shall provide an Accessibility Conformance Report (ACR/VPAT) and remediate or provide equally effective alternate access for any gaps within an agreed timeline.`;

  return <div className="container">
    <div className="card">
      <h2>UMN Procurement Helper (Demo)</h2>
      <label><input type="checkbox" checked={requireACR} onChange={e=>setRequireACR(e.target.checked)}/> Require ACR/VPAT</label><br/>
      <label>Target WCAG Level: </label>
      <select value={wcagLevel} onChange={e=>setWcagLevel(e.target.value as any)}><option value="AA">AA</option><option value="AAA">AAA</option></select><br/>
      <label><input type="checkbox" checked={umClause} onChange={e=>setUmClause(e.target.checked)}/> Include UMN clause</label>
    </div>
    <div className="grid">
      <div className="card"><h3>Pre‑Award Checklist</h3><ul>{checklist.map((c,i)=><li key={i}>• {c}</li>)}</ul></div>
      <div className="card"><h3>Draft Contract Language</h3><textarea className="input" rows={14} defaultValue={clause}/></div>
    </div>
  </div>
}
