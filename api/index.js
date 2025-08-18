// index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import { AxePuppeteer } from '@axe-core/puppeteer';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------------- Security / hardening ------------------------- */
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

const isDev = process.env.NODE_ENV !== 'production';
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true);

/* ------------------------- CORS ------------------------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // same-origin / server-to-server
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith('.vercel.app')) return true; // allow Vercel previews/prod
    if (allowedOrigins.includes(origin)) return true;
    return isDev; // wide open in dev
  } catch {
    return false;
  }
};

// make sure caches/proxies vary on Origin
app.use((req, res, next) => { res.setHeader('Vary', 'Origin'); next(); });

// Express CORS: return boolean (true/false)
app.use(cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: true,
}));
app.options('*', cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: true,
}));

/* ------------------------- JSON body & rate limit ------------------------- */
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

/* ------------------------- Auth ------------------------- */
function requireApiKey(req, res, next) {
  if (isDev || process.env.ALLOW_UNSECURED === 'true') return next();
  const secret = (process.env.ADMIN_API_KEY || process.env.API_KEY || '').trim();
  if (!secret) return next(); // open if no admin key configured
  const provided = (req.get('x-api-key') || req.query.api_key || req.body?.api_key || '').trim();
  if (!provided || provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  next();
}

/* ------------------------- HTTP + Socket.io ------------------------- */
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // Socket.IO expects boolean true/false here
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io',
  allowEIO3: true,
});

let notes = [];
io.on('connection', (socket) => {
  socket.emit('notes:init', notes);
  socket.on('notes:add', (note) => {
    const n = { id: Date.now(), ...note };
    notes.push(n);
    io.emit('notes:updated', notes);
  });
  socket.on('notes:clear', () => {
    notes = [];
    io.emit('notes:updated', notes);
  });
});

/* ------------------------- Health ------------------------- */
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/healthz', (_, res) => res.json({ ok: true }));

/* ------------------------- Helpers ------------------------- */
function weightImpact(impact) {
  switch ((impact || '').toLowerCase()) {
    case 'critical': return 5;
    case 'serious':  return 3;
    case 'moderate': return 1;
    case 'minor':    return 0.5;
    default:         return 1;
  }
}

/** Restrict SSRF / private IPs; optional host allowlist via SCAN_HOST_WHITELIST */
async function validateAndRejectPrivateHosts(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch {
    throw new Error('invalid url');
  }

  const hostWhitelist = (process.env.SCAN_HOST_WHITELIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (hostWhitelist.length && !hostWhitelist.includes(parsed.hostname)) {
    throw new Error('hostname not allowed');
  }

  try {
    const addrs = await dns.lookup(parsed.hostname, { all: true });
    const isPrivate = (ip) => {
      if (/^10\./.test(ip)) return true;
      if (/^192\.168\./.test(ip)) return true;
      if (/^127\./.test(ip)) return true;
      if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
      if (/^::1$/.test(ip) || /^fc|^fd/.test(ip)) return true;
      return false;
    };
    if (addrs.some(a => isPrivate(a.address))) throw new Error('hostname resolves to disallowed IP');
  } catch {
    throw new Error('unable to resolve hostname');
  }
  return parsed.href;
}

/* ------------------------- Puppeteer launcher (Render-safe) ------------------------- */
async function runPuppeteerScan(url) {
  let browser;
  try {
    // ensure Chrome can create its crashpad DB under a writable user-data-dir
    const userDataDir = '/tmp/puppeteer-user-data';
    await fs.promises.mkdir(userDataDir, { recursive: true });

    const execPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROMIUM_PATH ||
      (typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : undefined);

    const launchOptions = {
      headless: 'new',
      userDataDir,
      executablePath: execPath, // undefined is fine; Puppeteer will use bundled Chromium
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--disable-crash-reporter',
      ],
    };

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    const results = await new AxePuppeteer(page).analyze();
    await browser.close();

    return { url, timestamp: new Date().toISOString(), results };
  } catch (e) {
    if (browser) await browser.close();
    throw e;
  }
}

/* ------------------------- Queue ------------------------- */
const jobs = new Map();
const queue = [];
let processing = 0;
const CONCURRENCY = Math.max(1, parseInt(process.env.JOB_CONCURRENCY || '2', 10));

function makeJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function enqueueJob(url) {
  const id = makeJobId();
  const job = { id, status: 'queued', url, result: null, error: null, createdAt: Date.now(), updatedAt: Date.now() };
  jobs.set(id, job);
  queue.push(id);
  processQueue().catch(err => console.error('Queue worker error:', err));
  return job;
}

async function processQueue() {
  while (processing < CONCURRENCY && queue.length) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job) continue;

    processing++;
    job.status = 'running'; job.updatedAt = Date.now();
    try {
      const safeUrl = await validateAndRejectPrivateHosts(job.url);
      const out = await runPuppeteerScan(safeUrl);
      job.result = out;
      job.status = 'completed'; job.updatedAt = Date.now();
      io.emit('scan:done', { jobId, url: safeUrl, timestamp: job.updatedAt });
    } catch (err) {
      job.error = String(err?.message || err);
      job.status = 'failed'; job.updatedAt = Date.now();
    } finally {
      processing--;
    }
  }
}

/* ------------------------- Scan endpoints ------------------------- */
app.get('/scan', requireApiKey, async (req, res) => {
  try {
    const { url, async: asyncFlag } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    if (String(asyncFlag) === '1') {
      const job = enqueueJob(String(url));
      return res.status(202).json({ jobId: job.id, status: job.status });
    }

    const safeUrl = await validateAndRejectPrivateHosts(String(url));
    const out = await runPuppeteerScan(safeUrl);
    return res.json(out);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'scan error' });
  }
});

app.post('/scan', requireApiKey, async (req, res) => {
  try {
    const { url, async: asyncFlag } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });

    if (String(asyncFlag) === '1') {
      const job = enqueueJob(String(url));
      return res.status(202).json({ jobId: job.id, status: job.status });
    }

    const safeUrl = await validateAndRejectPrivateHosts(String(url));
    const out = await runPuppeteerScan(safeUrl);
    return res.json(out);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'scan error' });
  }
});

app.get('/scan/status/:id', requireApiKey, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

/* ------------------------- Protect + mount optional routes ------------------------- */
app.use(['/crawl', '/report', '/ai'], requireApiKey);

/* Crawl (placeholder) */
app.get('/crawl', async (req, res) => {
  res.status(501).json({
    error: 'Crawl via job queue not implemented in demo. Use /scan to analyze individual pages.'
  });
});

/* HTML report */
app.post('/report', async (req, res) => {
  try {
    const { url, results, score } = req.body || {};
    const now = new Date().toISOString().slice(0, 10);
    const violations = results?.violations || [];
    const impacts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const v of violations) {
      if (v.impact && impacts[v.impact] !== undefined) impacts[v.impact]++;
    }
    const rows = violations
      .map(v => `<tr><td>${v.id}</td><td>${v.impact || ''}</td><td>${(v.tags || []).join(', ')}</td><td>${v.help || ''}</td></tr>`)
      .join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Scan Report</title>
<style>
body{font:14px/1.5 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:2rem}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #eee;padding:.5rem;text-align:left}
.badge{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 8px;margin-right:6px}
h1,h2{margin:0 0 1rem}
</style>
</head><body>
<h1>Scan Report</h1>
<p><span class="badge">${url || ''}</span> <span class="badge">${now}</span> <span class="badge">WCAG 2.2</span></p>
<h2>Summary</h2>
<ul>
  <li>Total violations: ${violations.length}</li>
  <li>Critical: ${impacts.critical} • Serious: ${impacts.serious} • Moderate: ${impacts.moderate} • Minor: ${impacts.minor}</li>
  <li>Estimated site score: ${typeof score === 'number' ? score + '/100' : 'n/a'}</li>
</ul>
<h2>Findings</h2>
<table><thead><tr><th>Rule</th><th>Impact</th><th>WCAG tags</th><th>Help</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'report error' });
  }
});

/* ------------------------- Samples ------------------------- */
app.get('/samples/:name', (req, res) => {
  const p = path.join(__dirname, '..', 'samples', req.params.name);
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send('Not found');
});

/* ------------------------- Optional: dynamically mount AI routes if present ------------------------- */
async function mountOptionalRouters() {
  const modules = [
    './routes/ai-summary.js',
    './routes/ai-vpat.js',
    './routes/ai-vpat-pdf.js',
  ];
  for (const mod of modules) {
    try {
      const m = await import(mod);
      if (m?.router) app.use(m.router);
      console.log('Mounted router from', mod);
    } catch (err) {
      console.log('Skipped optional router', mod, '-', (err && err.message) || err);
    }
  }
}

/* ------------------------- Global error handler ------------------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && (err.stack || err.message || err));
  if (res.headersSent) return next(err);
  res.status(err?.status || 500).json({ error: 'internal server error' });
});

/* ------------------------- Boot ------------------------- */
await mountOptionalRouters();

const port = process.env.PORT || 4002;
server.listen(port, () => {
  console.log(`GopherA11y-TC Pro API listening on :${port}`);
  console.log('CORS allowed:', (allowedOrigins.join(', ') || '(empty)') + ' + *.vercel.app');
});
