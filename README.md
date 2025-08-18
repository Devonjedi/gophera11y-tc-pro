# GopherA11y-TC Pro

A UMN-focused **digital accessibility auditing tool** that demonstrates real-world skills for a Digital Accessibility Specialist: automated WCAG scans, structured AI summaries (Gemini), VPAT/ACR intake & scoring, procurement-ready reports, and real-time collaboration notes.

---

## 1) Purpose & Value

- **For UMN stakeholders** (Academic Technology, procurement, web teams): quickly assess pages or vendor products, get a **clear WCAG risk summary**, generate a **shareable report**, and **collaborate live** during reviews.
- **For candidates**: shows experience with **WCAG 2.2**, **assistive-tech testing workflows**, **vendor review (VPAT/ACR)**, and a modern production stack (Next.js, Node/Express, Puppeteer + axe, Socket.io, Gemini).

---

## 2) Architecture

```
/web  (Next.js 14 + TypeScript) — Frontend
  pages/index.tsx     # Scanner UI + charts + shared notes + Gemini JSON modal
  pages/vpat.tsx      # VPAT/ACR quick review (paste JSON or extract from PDF via API)
  styles/*            # Light styles (cards, badges, buttons)
  next.config.mjs     # (optional) dev rewrites to API

/api  (Node 20 + Express) — Backend
  index.js            # Server, security middleware, Socket.io, scan queue, routes
  gemini.js           # Gemini client + model fallback + local-summary fallback
  routes/
    ai-summary.js     # POST /ai/summarize-axe   → structured WCAG summary (Gemini → local)
    ai-vpat.js        # POST /ai/vpat-score      → risk, counts, red flags, vendor asks
    ai-vpat-pdf.js    # POST /ai/vpat-extract    → extract simplified VPAT JSON from PDF
  util/redact.js      # Prompt redaction helper
  samples/sample-vpat.json
```

**Shared runtime**
- **Socket.io** for real-time shared notes
- **Puppeteer + @axe-core/puppeteer** for automated accessibility analysis
- **Chart.js** for violations visualization

---

## 3) Tech Stack

**Frontend**
- Next.js 14 / React / TypeScript
- `react-chartjs-2` + `chart.js`
- `socket.io-client`, `file-saver`

**Backend**
- Node 20 + Express
- Socket.io (WebSocket)
- Puppeteer (Chromium) + `@axe-core/puppeteer` (automated WCAG checks)
- `@google/generative-ai` (Gemini 1.5 Pro/Flash; JSON responses via `responseSchema`)
- `helmet`, `express-rate-limit`, `cors`, `dns/promises` (SSRF/IP guard)

**Why this stack?**
- Mirrors common university & vendor stacks (Node/Next).
- Puppeteer + axe is an industry standard for automated audits.
- Gemini JSON mode produces procurement-friendly, structured outputs.

---

## 4) Key Features

### 4.1 Scanner (pages/index.tsx)
- Scan any URL (optionally restrict to `*.umn.edu` in production).
- View counts by impact and **WCAG tags**; expand rows to see **Node(s)** selectors & HTML snippet.
- **AI Summary (Gemini)** → one-click, schema-validated JSON:
  - `executiveSummary`, `topRules`, `impactCounts`, `wcagFocus`
  - Model fallback: **Pro → Flash → local deterministic summary** if LLM quota is hit.
- Download **scan.json** and **HTML report**.

### 4.2 VPAT / ACR Quick Review (pages/vpat.tsx)
- Paste simplified VPAT/ACR JSON **or** extract from a PDF via `/ai/vpat-extract`.
- See risk band & counts (supports / partial / fails / not applicable).
- Export a **vendor asklist** (TXT) for procurement follow-ups.

### 4.3 Real-Time Shared Notes
- Collaborative notes for audit sessions (e.g., NVDA output, repro steps).
- Powered by Socket.io; updates are live across all clients.

### 4.4 Reports & Scoring
- Simple site score based on impact weights:
  - `critical=5, serious=3, moderate=1, minor=0.5`
  - `score = 100 − min(100, 2 × Σ(weight))`
- HTML report includes totals, impacts, WCAG tags, and rule names.

### 4.5 Security & Governance (server)
- `helmet` headers, `express-rate-limit`, `cors` allowlist.
- Optional **UMN-only** scan restriction for production.
- **SSRF guard**: rejects private IP ranges (10/172/192.168/loopback).
- **Auth**: by default **open** for portfolio demos; can enforce `ADMIN_API_KEY` later.

---

## 5) Environment Configuration

### 5.1 API (`/api/.env`)
```env
# Required (for AI features)
GEMINI_API_KEY=your_key
# Try Pro then Flash (fallbacks)
GEMINI_MODELS=gemini-1.5-pro,gemini-1.5-flash

# Recommended for public demo
ALLOW_UNSECURED=true            # open API (auth not required)
UMN_ONLY=true                   # restrict scans to *.umn.edu domains (prod-friendly)
ALLOWED_ORIGINS=http://localhost:3000,https://your-vercel-app.vercel.app
RATE_LIMIT_MAX=60               # max requests/min/IP
REQUEST_BODY_LIMIT=1mb
TRUST_PROXY=true
PORT=4002

# Optional: if you later want to require a key in production
# ADMIN_API_KEY=superlonghex
```

### 5.2 Web (`/web/.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:4002
NEXT_PUBLIC_SOCKET_URL=http://localhost:4002
```

*(In production, set both to your deployed API URL.)*

---

## 6) Local Development

```bash
# API
cd api
npm ci
node index.js         # starts on :4002

# Web
cd ../web
npm ci
npm run dev           # http://localhost:3000
```

**(Optional) Dev rewrites** — `web/next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*',       destination: 'http://localhost:4002/:path*' },
      { source: '/socket.io/:path*', destination: 'http://localhost:4002/socket.io/:path*' },
    ];
  },
};
export default nextConfig;
```

---

## 7) Production Deployment

### Option A (Recommended): Web on **Vercel**, API on **Cloud Run** or **Render**
- **API**: use the provided Dockerfile (installs Chromium). Set env vars as in `/api/.env`. Cloud Run & Render both support WebSockets.
- **Web**: deploy `web/` to Vercel. Set:
  ```
  NEXT_PUBLIC_API_URL=https://<your-api-host>
  NEXT_PUBLIC_SOCKET_URL=https://<your-api-host>
  ```
- Add your Vercel domain to API `ALLOWED_ORIGINS`.

### Option B: Single VM (Nginx reverse proxy + PM2)
- Run the API on port `4002` and the Next.js app on `3000`.
- Nginx proxies: `api.yourdomain.com` → 4002 (with `/socket.io` upgrade), `a11y.yourdomain.com` → 3000.
- Use Let’s Encrypt (Certbot) for TLS.

---

## 8) API Endpoints

> Unless you enforce `ADMIN_API_KEY`, these are open (still protected by rate limit, UMN-only restriction, and SSRF guard).

- **GET `/health`** → `{ ok: true }`.

- **GET `/scan?url=...`** or **POST `/scan`** `{ url }`  
  Enqueues a scan job (Puppeteer + axe) and returns `{ jobId, status: "queued" }`.  
  Worker runs the scan; when done, it emits `scan:done` (Socket.io) and stores the result in memory.  
  *(For simple demos, you may return the result directly.)*

- **GET `/scan/status/:id`** → `{ id, status, url, result?, error? }`.

- **POST `/report`** `{ url, results, score }` → **HTML** report.

- **POST `/ai/summarize-axe`** `{ results }` → JSON:
  ```json
  {
    "executiveSummary": "string",
    "topRules": ["string"],
    "impactCounts": { "critical": 0, "serious": 0, "moderate": 0, "minor": 0 },
    "wcagFocus": ["string"]
  }
  ```
  Fallbacks: Pro → Flash → local deterministic summary.

- **POST `/ai/vpat-extract`** `{ pdfBase64? , pdfUrl? }` → simplified VPAT JSON:
  ```json
  { "product": "optional", "criteria": [{ "criterion": "WCAG x.x.x", "result": "supports|partially supports|does not support|not applicable", "notes": "optional" }] }
  ```

- **POST `/ai/vpat-score`** `{ vpatJson }` → `{ overallRisk, counts, redFlags, vendorAsks }`.

---

## 9) Socket.io Events

**Server → Client**
- `notes:init` (on connect) → current notes array
- `notes:updated` → after add/clear
- `scan:done` → `{ jobId, url, timestamp }` when a scan finishes

**Client → Server**
- `notes:add` → `{ text, url, ts }`
- `notes:clear`
---

## 10) Frontend Components (What they do)

### `pages/index.tsx`
- **State**: `url`, `loading`, `data`, `error`, `openRow`, `notes`, `noteText`, `gemOpen`, `gemJson`.
- **Actions**:  
  `runScan()` → scan URL;  
  `summarizeGemini()` → POST `/ai/summarize-axe` and show JSON in a modal;  
  `downloadJSON()` / `downloadReport()`;  
  `addNote()` / `clearNotes()` (Socket.io).
- **UI**: accessible buttons, data table with `<caption>`/`<thead>`, “Details” toggle to show **Node(s)** selector and HTML snippet, Chart.js summary.

### `pages/vpat.tsx`
- **Actions**: paste JSON and score, or upload/URL a PDF for `/ai/vpat-extract`.  
- **Output**: risk band + counts, raw criteria table, exportable vendor asklist (TXT).

---

## 11) Security, Privacy, Compliance

- **No PII storage**: the app does not persist page content; scan results are in memory for demos.
- **Prompt redaction**: AI prompts pass through `util/redact.js`.
- **CORS allowlist**: restrict to your web host(s).
- **Rate limiting**: applied to `/scan`, `/report`, `/ai/*`.
- **SSRF guard**: resolves target host & blocks private IPs.
- **UMN-only**: optional production guard (`UMN_ONLY=true`).
- **Auth**: open by default for a public portfolio demo; enable `ADMIN_API_KEY` later without code changes.

---

## 12) Accessibility of This Tool

- Keyboard-accessible controls (native `<button>`, clear focus, dialog has `role="dialog"` + `aria-modal="true"`).
- Data tables with `<caption>` and proper headers.
- Color contrast intended to meet AA.  
*(Tip: run axe DevTools on the app itself during your demo.)*

---

## 13) Troubleshooting

- **`client.getGenerativeModel is not a function`** → you installed `@google/genai`; replace with `@google/generative-ai` and:
  ```js
  import { GoogleGenerativeAI } from '@google/generative-ai';
  ```
- **Gemini 400: “Unknown name response_schema/additionalProperties”** → put `responseSchema` under `generationConfig` and **remove** `additionalProperties` keys.
- **Gemini 400: safety enum invalid** → use SDK enums: `HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT`, etc.
- **429/quota exceeded** → handled by Pro → Flash → local fallback.
- **WebSocket closes immediately** → set:
  ```
  NEXT_PUBLIC_SOCKET_URL=https://<your-api-host>
  ```
  and create the socket with `io(SOCKET_URL, { path: '/socket.io' })`.
- **“Cannot GET /ai/summarize-axe”** → that route is **POST-only** (the UI calls it correctly).

---

## 14) Quick Tests

```bash
# Health
curl http://localhost:4002/health

# Scan
curl -G "http://localhost:4002/scan" \
  --data-urlencode "url=https://twin-cities.umn.edu/"

# Report
curl -X POST http://localhost:4002/report \
  -H "Content-Type: application/json" \
  -d '{"url":"https://twin-cities.umn.edu/","results":{"violations":[]},"score":95}' \
  -o scan-report.html

# AI Summary
curl -X POST http://localhost:4002/ai/summarize-axe \
  -H "Content-Type: application/json" \
  -d '{"results":{"violations":[{"id":"color-contrast","impact":"serious","tags":["wcag143"]}]}}'

# VPAT Extract (PDF URL)
curl -X POST http://localhost:4002/ai/vpat-extract \
  -H "Content-Type: application/json" \
  -d '{"pdfUrl":"https://example.com/vendor-acr.pdf"}'

# VPAT Score
curl -X POST http://localhost:4002/ai/vpat-score \
  -H "Content-Type: application/json" \
  -d '{"vpatJson":{"criteria":[{"criterion":"WCAG 1.4.3","result":"partially supports"}]}}'
```

---

## 15) Roadmap Ideas

- Manual assistive-tech test log (NVDA/JAWS/VoiceOver/TalkBack matrix).
- Multi-page **crawl** (queue + concurrency + sitewide heatmap).
- **Remediation workflow** (owners, due dates, export to CSV/Jira).
- S3 storage for reports w/ signed links.
- UMN SSO / OIDC auth and roles.
- ePub/UAAG/ATAG checks for instructional content.

---

## 16) License & Acknowledgments

- Uses **axe-core** (Deque Systems) via `@axe-core/puppeteer`.
- Gemini via `@google/generative-ai`.
- This project is for educational/demo purposes; automated findings should be validated with human testing and AT.
