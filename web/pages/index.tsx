import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { Bar } from 'react-chartjs-2';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { saveAs } from 'file-saver';
Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const API = process.env.NEXT_PUBLIC_API_URL || '/api';
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  process.env.NEXT_PUBLIC_API_URL ||          // if you set only one env, reuse it
  undefined;                                  // fall back to same-origin if undefined

type AxeViolation = { id: string; impact?: string; help: string; tags: string[]; nodes: any[] };
type ScanData = any;
type Note = { id?: number; text: string; url: string; ts: string };

export default function Home() {
  const [url, setUrl] = useState('https://twin-cities.umn.edu/');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScanData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared notes state + socket
  const [notes, setNotes] = useState<Note[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [noteText, setNoteText] = useState('');

  // Row expander for violation details
  const [openRow, setOpenRow] = useState<number | null>(null);

  // Gemini summary modal state
  const [gemOpen, setGemOpen] = useState(false);
  const [gemJson, setGemJson] = useState<any>(null);

  useEffect(() => {
    const SOCKET_URL =
      process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "";

    const s = io(SOCKET_URL, {
      path: "/socket.io",
      transports: ["polling"], // <— Force HTTP long-polling (reliable across Vercel/Render)
      upgrade: false,
      withCredentials: true,
    });

    setSocket(s);

    const init = (n: Note[]) => setNotes(n);
    const upd = (n: Note[]) => setNotes(n);

    s.on("notes:init", init);
    s.on("notes:updated", upd);

    return () => {
      s.off("notes:init", init);
      s.off("notes:updated", upd);
      s.close();
    };
  }, []);


  const addNote = () => {
    const text = noteText.trim();
    if (!socket || !text) return;
    socket.emit('notes:add', { text, url, ts: new Date().toISOString() } as Note);
    setNoteText('');
  };

  const clearNotes = () => socket?.emit('notes:clear');

  // Scan actions
  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await axios.get(`${API}/scan`, { params: { url } });
      setData(resp.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  // Gemini summarize (structured JSON)
  const summarizeGemini = async () => {
    if (!data) return;
    try {
      const resp = await axios.post(`${API}/ai/summarize-axe`, { results: data.results });
      setGemJson(resp.data);
      setGemOpen(true);
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message);
    }
  };

  const downloadJSON = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveAs(blob, 'scan.json');
  };

  const downloadReport = async () => {
    if (!data) return;
    const scorePenalty = (data.results.violations || []).reduce((acc: number, v: any) => {
      return acc + (v.impact === 'critical' ? 5 : v.impact === 'serious' ? 3 : v.impact === 'moderate' ? 1 : v.impact === 'minor' ? 0.5 : 0);
    }, 0);
    const score = Math.max(0, Math.round(100 - Math.min(100, scorePenalty * 2)));
    const resp = await axios.post(
      `${API}/report`,
      { url: data.url, results: data.results, score },
      { responseType: 'blob' }
    );
    saveAs(resp.data, 'scan-report.html');
  };

  // Chart data
  const grouped = useMemo(() => {
    const g: Record<string, number> = {};
    (data?.results?.violations || []).forEach((v: AxeViolation) => {
      const wcag = (v.tags || []).find((t) => t.startsWith('wcag')) || 'other';
      g[wcag] = (g[wcag] || 0) + 1;
    });
    return g;
  }, [data]);

  const chartData = useMemo(
    () => ({
      labels: Object.keys(grouped),
      datasets: [{ label: 'Violations', data: Object.values(grouped) }],
    }),
    [grouped]
  );

  return (
    <div className="container">
      <div className="card">
        <h2>Scan a UMN Page</h2>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://*.umn.edu/" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn" onClick={runScan} disabled={loading}>
            {loading ? 'Scanning…' : 'Run Scan'}
          </button>

          {/* Gemini JSON summary modal */}
          <button className="btn alt" onClick={summarizeGemini} disabled={!data}>
            AI Summary
          </button>

          <button className="btn" onClick={downloadJSON} disabled={!data}>
            Download JSON
          </button>
          <button className="btn" onClick={downloadReport} disabled={!data}>
            Download Report
          </button>
        </div>

        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

        {data && (
          <>
            <div className="badge">{new URL(data.url).hostname}</div>
            <div className="badge">{new Date(data.timestamp).toLocaleString()}</div>
            <p className="small">
              <b>{data.results.violations.length}</b> violations • <span>{data.results.passes.length} passing checks</span>
            </p>

            <div className="card">
              <Bar data={chartData} />
            </div>

            <table className="table" aria-describedby="violations-help">
              <caption id="violations-help" className="small" style={{ textAlign: 'left', marginBottom: 6 }}>
                Click “Details” for selectors & HTML snippet (axe Node(s)).
              </caption>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Impact</th>
                  <th>WCAG</th>
                  <th>Help</th>
                </tr>
              </thead>
              <tbody>
                {data.results.violations.slice(0, 120).map((v: AxeViolation, i: number) => {
                  const wcag = (v.tags || []).filter((t) => t.startsWith('wcag')).join(', ') || 'other';
                  const detailsId = `violation-details-${i}`;
                  const isOpen = openRow === i;

                  return (
                    <>
                      <tr key={`row-${i}`}>
                        <td>
                          <code className="kbd">{v.id}</code>
                          <button
                            className="btn alt"
                            style={{ marginLeft: 8, padding: '2px 8px' }}
                            aria-expanded={isOpen}
                            aria-controls={detailsId}
                            onClick={() => setOpenRow(isOpen ? null : i)}
                          >
                            {isOpen ? 'Hide' : 'Details'}
                          </button>
                        </td>
                        <td>{v.impact || '-'}</td>
                        <td>{wcag}</td>
                        <td>{v.help}</td>
                      </tr>

                      {isOpen && (
                        <tr key={`details-${i}`} id={detailsId}>
                          <td colSpan={4}>
                            {(v as any).nodes?.length ? (
                              (v as any).nodes.slice(0, 5).map((n: any, j: number) => {
                                const selector = Array.isArray(n.target) ? n.target.join(' ') : String(n.target || '');
                                const html = String(n.html || '');
                                return (
                                  <div key={j} className="card" style={{ marginTop: 8 }}>
                                    <div>
                                      <b>Selector:</b> <code className="kbd">{selector || '(not provided)'}</code>
                                    </div>
                                    {html && (
                                      <div style={{ marginTop: 6 }}>
                                        <b>HTML:</b>{' '}
                                        <code className="kbd">{html.length > 200 ? html.slice(0, 200) + '…' : html}</code>
                                      </div>
                                    )}
                                    {n.failureSummary && (
                                      <div className="small" style={{ marginTop: 6 }}>
                                        {n.failureSummary}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="small">No node details available.</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Shared Notes panel (always visible) */}
      <div className="card">
        <h2>Shared Notes</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            className="input"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Observation, repro, AT behavior (NVDA/JAWS/VO/TB)…"
          />
          <button className="btn" onClick={addNote}>
            Add
          </button>
          <button className="btn alt" onClick={clearNotes}>
            Clear
          </button>
        </div>
        <ul>
          {notes
            .slice()
            .reverse()
            .map((n) => (
              <li key={n.id || `${n.ts}-${n.text.slice(0, 8)}`}>
                <span className="small">{new Date(n.ts).toLocaleString()}</span> — <b>{n.url}</b> — {n.text}
              </li>
            ))}
        </ul>
      </div>

      {/* Gemini JSON modal */}
      {gemOpen && (
        <>
          <div
            onClick={() => setGemOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 999 }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Gemini Summary"
            className="card"
            style={{ position: 'fixed', inset: '10% 10%', background: '#fff', zIndex: 1000, overflow: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Gemini Summary (JSON)</h3>
              <button className="btn" onClick={() => setGemOpen(false)}>Close</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{JSON.stringify(gemJson, null, 2)}</pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="btn"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(gemJson, null, 2))}
              >
                Copy
              </button>
              <button
                className="btn alt"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(gemJson, null, 2)], { type: 'application/json' });
                  saveAs(blob, 'gemini-summary.json');
                }}
              >
                Download JSON
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
