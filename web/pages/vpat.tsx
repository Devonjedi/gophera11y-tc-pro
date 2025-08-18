import { useMemo, useState } from 'react';
import axios from 'axios';
import { saveAs } from 'file-saver';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002';

type RawCriterion = {
  sc?: string;            // e.g., "1.4.3"
  level?: string;         // e.g., "AA"
  status?: string;        // e.g., "supports"
  criterion?: string;     // e.g., "WCAG 1.4.3"
  result?: string;        // e.g., "partially supports"
  notes?: string;
};

type Item = { sc: string; level: string; status: string; notes?: string };

type GeminiRisk = {
  overallRisk: 'low' | 'medium' | 'high';
  counts: { supports: number; partial: number; doesNotSupport: number; notApplicable: number };
  redFlags: string[];
  vendorAsks: string[];
};

export default function VPAT() {
  const [jsonText, setJsonText] = useState(
    '{\n' +
      '  "product": "Vendor LMS",\n' +
      '  "criteria": [\n' +
      '    {"sc":"1.1.1","level":"A","status":"supports"},\n' +
      '    {"criterion":"WCAG 1.4.3","result":"partially supports","notes":"contrast on buttons"}\n' +
      '  ]\n' +
      '}'
  );
  const [items, setItems] = useState<Item[]>([]);
  const [gemRisk, setGemRisk] = useState<GeminiRisk | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');

  // ---------- Normalization helpers ----------
  const normalizeOne = (r: RawCriterion): Item => {
    // Prefer explicit SC; else try to pull from a "criterion" like "WCAG 1.4.3"
    const sc =
      (r.sc || '').toString().trim() ||
      (r.criterion || '')
        .toString()
        .replace(/.*?(WCAG\s*)?/i, '')
        .trim();

    const level = (r.level || '').toString().trim().toUpperCase();

    // Normalize status/result into compact phrasing
    const raw = (r.status || r.result || '').toString().toLowerCase();
    let status = 'partially supports';
    if (raw.includes('does not') || raw.includes('not support')) status = 'does not support';
    else if (raw.includes('partial')) status = 'partially supports';
    else if (raw.includes('support')) status = 'supports';
    else if (raw.includes('n/a') || raw.includes('not applicable')) status = 'not applicable';

    return { sc: sc || '-', level: level || '-', status, notes: r.notes };
  };

  const normalizeAll = (obj: any): Item[] => {
    const arr: RawCriterion[] = Array.isArray(obj?.criteria)
      ? obj.criteria
      : Array.isArray(obj?.items)
      ? obj.items
      : [];
    return arr.map(normalizeOne);
  };

  // ---------- Local stats & quick risk ----------
  const stats = useMemo(() => {
    const s = { supports: 0, partial: 0, fails: 0, na: 0 };
    items.forEach((x) => {
      const t = (x.status || '').toLowerCase();
      if (t.includes('does not support')) s.fails++;
      else if (t.includes('partially')) s.partial++;
      else if (t.includes('support')) s.supports++;
      else if (t.includes('not applicable')) s.na++;
    });
    return s as { supports: number; partial: number; fails: number; na: number };
  }, [items]);

  const risk = useMemo(() => {
    // Local, transparent heuristic
    const score = Math.max(0, 100 - (stats.fails * 20 + stats.partial * 7));
    const band = score >= 85 ? 'Low' : score >= 70 ? 'Moderate' : 'High';
    return { score, band };
  }, [stats]);

  // ---------- Actions ----------
  const parseLocal = () => {
    try {
      const obj = JSON.parse(jsonText);
      const norm = normalizeAll(obj);
      if (!norm.length) {
        alert('No criteria/items found in JSON.');
        return;
      }
      setItems(norm);
      setGemRisk(null);
    } catch {
      alert('Invalid JSON');
    }
  };

  const exportAsk = () => {
    const asks = [
      'Provide latest ACR (VPAT) for all applicable platforms (web, iOS, Android).',
      'Share AT compatibility testing matrix (NVDA, JAWS, VoiceOver, TalkBack) and results.',
      'Confirm WCAG 2.2 Level AA conformance targets and roadmap for partial/fail items.',
      'Provide remediation timeline and named owner for each gap.',
      'Agree to accessibility contract language and reporting cadence.',
    ].join('\n');
    const blob = new Blob([asks], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, 'vendor-asklist.txt');
  };

  const downloadExtracted = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    saveAs(blob, 'vpat-extracted.json');
  };

  const downloadGeminiRisk = () => {
    if (!gemRisk) return;
    const blob = new Blob([JSON.stringify(gemRisk, null, 2)], { type: 'application/json' });
    saveAs(blob, 'vpat-risk.json');
  };

  // --- PDF → Extract JSON (upload) ---
  const onPickFile = async (file: File | null) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please select a PDF.');
      return;
    }
    setExtracting(true);
    try {
      const b64 = await fileToBase64(file);
      const resp = await axios.post(`${API}/ai/vpat-extract`, { pdfBase64: b64 });
      const pretty = JSON.stringify(resp.data, null, 2);
      setJsonText(pretty);
      const norm = normalizeAll(resp.data);
      setItems(norm);
      setGemRisk(null);
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setExtracting(false);
    }
  };

  // --- PDF URL → Extract JSON ---
  const extractFromUrl = async () => {
    if (!pdfUrl) return;
    setExtracting(true);
    try {
      const resp = await axios.post(`${API}/ai/vpat-extract`, { pdfUrl });
      const pretty = JSON.stringify(resp.data, null, 2);
      setJsonText(pretty);
      const norm = normalizeAll(resp.data);
      setItems(norm);
      setGemRisk(null);
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setExtracting(false);
    }
  };

  // --- Score with Gemini (server-side) ---
  const scoreWithGemini = async () => {
    setScoring(true);
    try {
      const vpatJson = JSON.parse(jsonText);
      const resp = await axios.post(`${API}/ai/vpat-score`, { vpatJson });
      setGemRisk(resp.data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setScoring(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <h2>VPAT / ACR — Extract & Score</h2>
        <p className="small">Upload a vendor ACR (PDF) or paste a public URL, then review/edit JSON and score risk.</p>

        {/* PDF file upload */}
        <div className="card" style={{ marginBottom: 8 }}>
          <label><b>Upload PDF</b></label>
          <input type="file" accept="application/pdf" onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
          <div className="small">We convert the file to base64 in the browser, then extract on the server.</div>
        </div>

        {/* PDF URL option */}
        <div className="card" style={{ marginBottom: 8 }}>
          <label><b>Or PDF URL</b></label>
          <input
            className="input"
            value={pdfUrl}
            onChange={(e) => setPdfUrl(e.target.value)}
            placeholder="https://example.com/vendor-acr.pdf"
          />
          <button className="btn" style={{ marginTop: 8 }} onClick={extractFromUrl} disabled={!pdfUrl || extracting}>
            {extracting ? 'Extracting…' : 'Extract from URL'}
          </button>
        </div>

        {/* JSON textarea */}
        <label><b>Extracted / Editable JSON</b></label>
        <textarea
          className="input"
          rows={14}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder='{"criteria":[{"sc":"1.1.1","level":"A","status":"supports"}]}'
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={parseLocal} disabled={extracting}>Score (Local)</button>
          <button className="btn" onClick={downloadExtracted} disabled={!jsonText.trim()}>Download Extracted JSON</button>
          <button className="btn alt" onClick={exportAsk} disabled={!items.length}>Export Vendor Asklist</button>
          <button className="btn alt" onClick={scoreWithGemini} disabled={!jsonText.trim() || scoring}>
            {scoring ? 'Scoring…' : 'Score with Gemini'}
          </button>
          <button className="btn" onClick={downloadGeminiRisk} disabled={!gemRisk}>Download Risk JSON</button>
        </div>
      </div>

      {/* Results */}
      {items.length > 0 && (
        <div className="card">
          <h3>Local Risk (quick estimate)</h3>
          <p>
            <b>Risk:</b> {risk.band} ({risk.score}/100) • Supports {stats.supports} • Partial {stats.partial} • Fails {stats.fails} • N/A {stats.na}
          </p>
          <table className="table" aria-label="Extracted VPAT criteria">
            <thead>
              <tr>
                <th>SC</th>
                <th>Level</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td>{x.sc}</td>
                  <td>{x.level}</td>
                  <td>{x.status}</td>
                  <td>{x.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gemRisk && (
        <div className="card">
          <h3>Gemini Risk Summary</h3>
          <p className="small">
            Overall Risk: <b>{gemRisk.overallRisk.toUpperCase()}</b> • Supports {gemRisk.counts?.supports ?? 0} • Partial {gemRisk.counts?.partial ?? 0} • Does Not Support {gemRisk.counts?.doesNotSupport ?? 0} • N/A {gemRisk.counts?.notApplicable ?? 0}
          </p>
          {!!gemRisk.redFlags?.length && (
            <>
              <b>Red Flags</b>
              <ul>{gemRisk.redFlags.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </>
          )}
          {!!gemRisk.vendorAsks?.length && (
            <>
              <b>Vendor Asks</b>
              <ul>{gemRisk.vendorAsks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </>
          )}
          <details style={{ marginTop: 8 }}>
            <summary>View as JSON</summary>
            <pre>{JSON.stringify(gemRisk, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

/** Convert a File (PDF) to a base64 data URL for POSTing to the server. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read error'));
    reader.onload = () => resolve(String(reader.result)); // data:application/pdf;base64,xxxx
    reader.readAsDataURL(file);
  });
}
