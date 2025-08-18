import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { Bar } from 'react-chartjs-2';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { saveAs } from 'file-saver';
Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const API = process.env.NEXT_PUBLIC_API_URL || 'https://gophera11y-api.onrender.com';

type CrawlPage = { url:string, depth:number, impacts:{critical:number,serious:number,moderate:number,minor:number}, total:number, score:number, error?:string };
type Progress = { processed:number, queued:number, currentUrl:string };

export default function Crawl(){
  const [seed, setSeed] = useState('https://twin-cities.umn.edu/');
  const [maxDepth, setMaxDepth] = useState(2);
  const [limit, setLimit] = useState(8);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{pages:CrawlPage[], siteScore:number}|null>(null);
  const [progress, setProgress] = useState<Progress|null>(null);

  useEffect(()=>{
    const s = io(API);
    s.on('crawl:progress', (p:Progress)=> setProgress(p));
    s.on('crawl:done', (r:any)=> setResult(r));
    return () => { s.close(); };
  },[]);

  const runCrawl = async () => {
    setLoading(true); setResult(null); setProgress(null);
    try{
      const resp = await axios.post(`${API}/crawl`, { url: seed, maxDepth, limit });
      setResult(resp.data);
    }catch(e:any){
      alert(e?.response?.data?.error || e.message);
    }finally{
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if(!result) return;
    const rows = [['url','critical','serious','moderate','minor','total','score']];
    result.pages.forEach(p=>rows.push([p.url, String(p.impacts.critical), String(p.impacts.serious), String(p.impacts.moderate), String(p.impacts.minor), String(p.total), String(p.score)]));
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, 'crawl.csv');
  };

  const totals = useMemo(()=>{
    if(!result) return {critical:0,serious:0,moderate:0,minor:0};
    return result.pages.reduce((a,p)=>({critical:a.critical+p.impacts.critical,serious:a.serious+p.impacts.serious,moderate:a.moderate+p.impacts.moderate,minor:a.minor+p.impacts.minor}),{critical:0,serious:0,moderate:0,minor:0});
  },[result]);

  const chartData = useMemo(()=>({ labels:['critical','serious','moderate','minor'], datasets:[{ label:'Total violations', data:[totals.critical, totals.serious, totals.moderate, totals.minor]}]}),[totals]);

  return <div className="container">
    <div className="card">
      <h2>Depth‑2 Crawl (same origin)</h2>
      <div className="grid">
        <div className="card">
          <label>Seed URL</label>
          <input className="input" value={seed} onChange={e=>setSeed(e.target.value)} />
          <label>Max Depth</label>
          <select className="input" value={maxDepth} onChange={e=>setMaxDepth(parseInt(e.target.value))}>
            <option value={1}>1</option><option value={2}>2</option>
          </select>
          <label>Page Limit</label>
          <input className="input" type="number" value={limit} onChange={e=>setLimit(parseInt(e.target.value)||1)} />
          <button className="btn" style={{marginTop:8}} onClick={runCrawl} disabled={loading}>{loading?'Crawling…':'Run Crawl'}</button>
          {progress && <p className="small">Processed {progress.processed} • Queued {progress.queued} • Current {progress.currentUrl}</p>}
        </div>
        <div className="card">
          <h3>Totals</h3>
          <div className="card"><Bar data={chartData}/></div>
          {result && <p><b>Site Score:</b> {result.siteScore}/100 <span className="small">(transparent formula in API response)</span></p>}
          <button className="btn alt" onClick={exportCsv} disabled={!result}>Export CSV</button>
        </div>
      </div>
    </div>
    {result && <div className="card">
      <h3>Pages</h3>
      <table className="table">
        <thead><tr><th>URL</th><th>Depth</th><th>Critical</th><th>Serious</th><th>Moderate</th><th>Minor</th><th>Total</th><th>Score</th></tr></thead>
        <tbody>
          {result.pages.map((p,i)=>(<tr key={i}><td style={{maxWidth:420,overflow:'hidden',textOverflow:'ellipsis'}}>{p.url}</td><td>{p.depth}</td><td>{p.impacts.critical}</td><td>{p.impacts.serious}</td><td>{p.impacts.moderate}</td><td>{p.impacts.minor}</td><td>{p.total}</td><td>{p.score}</td></tr>))}
        </tbody>
      </table>
    </div>}
  </div>
}
