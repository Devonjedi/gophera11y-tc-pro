import { useMemo, useState } from 'react';
import { saveAs } from 'file-saver';

type Row = { os:string, at:string, browser:string, scenario:string, result:string, notes:string };

export default function ATMatrix(){
  const [rows, setRows] = useState<Row[]>([
    { os:'Windows 11', at:'NVDA 2024.2', browser:'Chrome 126', scenario:'Navigate headings and landmarks', result:'', notes:'' }
  ]);
  const [newRow, setNewRow] = useState<Row>({ os:'', at:'', browser:'', scenario:'', result:'', notes:'' });

  const add = () => { setRows([...rows, newRow]); setNewRow({ os:'', at:'', browser:'', scenario:'', result:'', notes:'' }); };
  const update = (i:number, k:keyof Row, v:string) => {
    const cp = rows.slice(); (cp[i] as any)[k] = v; setRows(cp);
  };
  const remove = (i:number) => setRows(rows.filter((_,idx)=>idx!==i));

  const exportCsv = () => {
    const header = ['os','at','browser','scenario','result','notes'];
    const csv = [header.join(',')].concat(rows.map(r=>[r.os,r.at,r.browser,r.scenario,r.result,r.notes].map(x=>`"${(x||'').replace(/"/g,'""')}"`).join(','))).join('\\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    saveAs(blob, 'at-matrix.csv');
  };

  return <div className="container">
    <div className="card">
      <h2>Assistive Technology Test Matrix</h2>
      <p className="small">Track manual tests across Windows/macOS/iOS/Android with NVDA, JAWS, VoiceOver, TalkBack. Export CSV to attach in reviews.</p>
      <table className="table">
        <thead><tr><th>OS</th><th>AT</th><th>Browser/App</th><th>Scenario</th><th>Result</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          {rows.map((r,i)=>(<tr key={i}>
            <td><input className="input" value={r.os} onChange={e=>update(i,'os',e.target.value)}/></td>
            <td><input className="input" value={r.at} onChange={e=>update(i,'at',e.target.value)}/></td>
            <td><input className="input" value={r.browser} onChange={e=>update(i,'browser',e.target.value)}/></td>
            <td><input className="input" value={r.scenario} onChange={e=>update(i,'scenario',e.target.value)}/></td>
            <td><input className="input" value={r.result} onChange={e=>update(i,'result',e.target.value)}/></td>
            <td><input className="input" value={r.notes} onChange={e=>update(i,'notes',e.target.value)}/></td>
            <td><button className="btn" onClick={()=>remove(i)}>✕</button></td>
          </tr>))}
          <tr>
            <td><input className="input" value={newRow.os} onChange={e=>setNewRow({...newRow, os:e.target.value})}/></td>
            <td><input className="input" value={newRow.at} onChange={e=>setNewRow({...newRow, at:e.target.value})}/></td>
            <td><input className="input" value={newRow.browser} onChange={e=>setNewRow({...newRow, browser:e.target.value})}/></td>
            <td><input className="input" value={newRow.scenario} onChange={e=>setNewRow({...newRow, scenario:e.target.value})}/></td>
            <td><input className="input" value={newRow.result} onChange={e=>setNewRow({...newRow, result:e.target.value})}/></td>
            <td><input className="input" value={newRow.notes} onChange={e=>setNewRow({...newRow, notes:e.target.value})}/></td>
            <td><button className="btn alt" onClick={add}>Add</button></td>
          </tr>
        </tbody>
      </table>
      <div className="right"><button className="btn alt" onClick={exportCsv}>Export CSV</button></div>
    </div>
  </div>
}
