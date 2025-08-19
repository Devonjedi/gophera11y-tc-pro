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

// Optional Sparticuz chromium (works well in containers/serverless)
let chromium = null;
try { chromium = await import('@sparticuz/chromium'); } catch (_) {}

import { router as aiSummary } from './routes/ai-summary.js';
import { router as aiVpat } from './routes/ai-vpat.js';
import { router as aiVpatPdf } from './routes/ai-vpat-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isDev = process.env.NODE_ENV !== 'production';

/* ------------------------- Security / hardening ------------------------- */
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

/* ------------------------- CORS helpers ------------------------- */
const rawAllowed = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const rawPatterns = (process.env.ALLOWED_ORIGIN_PATTERNS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/** convert simple wildcard like *.vercel.app or localhost to a regex */
function wildcardToRegex(pattern) {
  // if bare word like "localhost", allow any scheme + optional port
  if (!pattern.includes('://')) {
    // allow http(s)://localhost(:port)?
    const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^https?:\\/\\/${esc}(?::\\d+)?$`, 'i');
  }
  // escape dots, then replace * with .*
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const allowedOrigins = new Set(rawAllowed);
const allowedRegexes = rawPatterns.map(wildcardToRegex);

function isOriginAllowed(origin) {
  if (!origin) return true; // server-to-server / curl
  if (allowedOrigins.has(origin)) return true;
  for (const rx of allowedRegexes) {
    if (rx.test(origin)) return true;
  }
  return false;
}

function logCors(msg, origin) {
  if (process.env.DEBUG_CORS === 'true') {
    console.log(`[CORS] ${msg}`, origin || '(no origin)');
  }
}

/* ------------------------- Express CORS ------------------------- */
app.use(cors({
  origin: (origin, callback) => {
    if (isDev) {
      logCors('DEV allow', origin);
      return callback(null, true);
    }
    if (!origin) {
      logCors('no origin (server-to-server) allow', origin);
      return callback(null, true);
    }
    if (isOriginAllowed(origin)) {
      logCors('allow', origin);
      return callback(null, true);
    }
    logCors('DENY', origin);
    return callback(new Error('CORS origin denied'));
  },
  credentials: true,
}));

// Explicit preflight for Socket.IO path (helps some proxies)
app.options('/socket.io/*', (req, res) => {
  const origin = req.headers.origin;
  if (isDev || isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Vary', 'Origin');
    return res.sendStatus(204);
  }
  return res.sendStatus(403);
});

app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

/* ------------------------- Auth (permissive by default) ------------------------- */
function requireApiKey(req, res, next) {
  if (isDev || process.env.ALLOW_UNSECURED === 'true') {
    return next();
  }
  const secret = (process.env.ADMIN_API_KEY || process.env.API_KEY || '').trim();
  if (!secret) return next(); // open if no admin key configured

  const provided = (req.get('x-api-key') || req.query.api_key || req.body?.api_key || '').trim();
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

/* ------------------------- HTTP + Socket.IO ------------------------- */
const server = http.createServer(app);

// Let Engine.IO reflect the request origin in the ACAO header,
// but still actively validate the origin with allowRequest.
const io = new Server(server, {
  // Reflects origin; we’ll still gate with allowRequest below
  cors: { origin: true, credentials: true },
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (isDev || isOriginAllowed(origin)) {
      return cb(null, true);
    }
    logCors('Socket.IO DENY', origin);
    cb('origin not allowed', false);
  },
  path: '/socket.io',
});

// Ensure ACAO/credentials headers are present on handshake & subsequent polling
io.engine.on('initial_headers', (headers, req) => {
  const origin = req.headers.origin;
  if (isDev || isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
});
io.engine.on('headers', (headers, req) => {
  const origin = req.headers.origin;
  if (isDev || isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
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

async function runPuppeteerScan(url) {
  let browser;
  try {
    const launchOpts = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };

    // Prefer system Chromium if Sparticuz is unavailable.
    if (chromium && chromium.default) {
      const chr = chromium.default;
      launchOpts.args = [...(await chr.args()), '--no-sandbox', '--disable-setuid-sandbox'];
      launchOpts.executablePath = await chr.executablePath();
      launchOpts.headless = true;
      process.env.LD_LIBRARY_PATH = `${process.env.LD_LIBRARY_PATH || ''}:${await chr.libc()}`;
      process.env.TMPDIR = process.env.TMPDIR || '/tmp';
    }

    browser = await puppeteer.launch(launchOpts);
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

/* ------------------------- Optional in-memory queue (demo) ------------------------- */
const jobs = new Map(); // id -> { id, status, url, result, error, createdAt, updatedAt }
const queue = [];
let processing = 0;
const CONCURRENCY = Math.max(1, parseInt(process.env.JOB_CONCURRENCY || '2', 10));

function makeJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function enqueueJob(url) {
  const id = makeJobId();
  const job = {
    id, status: 'queued', url,
    result: null, error: null,
    createdAt: Date.now(), updatedAt: Date.now()
  };
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

/* ------------------------- Protect + mount AI & report routes ------------------------- */
app.use(['/crawl', '/report', '/ai'], requireApiKey);

try { app.use(aiVpatPdf); } catch (_) {}
try { app.use(aiSummary); } catch (_) {}
try { app.use(aiVpat); } catch (_) {}

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

/* ------------------------- Global error handler ------------------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && (err.stack || err.message || err));
  if (res.headersSent) return next(err);
  res.status(err?.status || 500).json({ error: 'internal server error' });
});

/* ------------------------- Boot ------------------------- */
const port = process.env.PORT || 4002;
server.listen(port, () => {
  console.log(`GopherA11y-TC Pro API listening on :${port}`);
});
