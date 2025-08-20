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

import { router as aiSummary } from './routes/ai-summary.js';
import { router as aiVpat } from './routes/ai-vpat.js';
import { router as aiVpatPdf } from './routes/ai-vpat-pdf.js';

// __dirname resolution in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------------------------------------------------------------------------
 * Security & Hardening
 * ------------------------------------------------------------------------- */
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

/* ---------------------------------------------------------------------------
 * CORS Configuration
 *
 * - In development (NODE_ENV !== 'production'), all origins are permitted to simplify testing.
 * - In production, set ALLOWED_ORIGINS to a comma-separated list of allowed
 *   front-end domains (e.g. Vercel domain). Example:
 *     ALLOWED_ORIGINS=https://gophera11y-tc-pro.vercel.app,https://gophera11y-tc-pro.onrender.com
 *
 * - Credentials (cookies, auth) are enabled so that Socket.IO can share session data.
 * ------------------------------------------------------------------------- */
// Add near top:
const isDev = process.env.NODE_ENV !== 'production';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://gophera11y-tc-pro.vercel.app')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Replace CORS use:
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server and curl
    if (isDev) return callback(null, true);
    return allowedOrigins.includes(origin)
      ? callback(null, true)
      : callback(new Error('CORS origin denied'));
  },
  credentials: true,
}));

// Create HTTP + Socket.IO server:
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: isDev ? '*' : allowedOrigins, methods: ['GET','POST'], credentials: true },
  path: '/socket.io', // ensure client uses same path
});


/* ---------------------------------------------------------------------------
 * API Key Middleware
 *
 * - In development or if ALLOW_UNSECURED=true, requests are accepted without a key.
 * - In production, define ADMIN_API_KEY (or API_KEY) to protect /scan, /report, /ai endpoints.
 * ------------------------------------------------------------------------- */
function requireApiKey(req, res, next) {
  if (isDev || process.env.ALLOW_UNSECURED === 'true') return next();
  const secret = (process.env.ADMIN_API_KEY || process.env.API_KEY || '').trim();
  if (!secret) return next();
  const provided = (req.get('x-api-key') || req.query.api_key || req.body?.api_key || '').trim();
  if (!provided || provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

/* ---------------------------------------------------------------------------
 * HTTP + Socket.IO Setup
 *
 * - The Socket.IO server reuses the Express server so that HTTP and WS share
 *   the same process.
 * - In production, the CORS configuration MUST mirror the Express CORS settings.
 * - The path option must match the client connection path (`/socket.io`).
 * ------------------------------------------------------------------------- */
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: isDev ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
});

/* Shared notes state */
let notes = [];
io.on('connection', (socket) => {
  // send current notes on connect
  socket.emit('notes:init', notes);
  // add a note
  socket.on('notes:add', (note) => {
    const n = { id: Date.now(), ...note };
    notes.push(n);
    io.emit('notes:updated', notes);
  });
  // clear notes
  socket.on('notes:clear', () => {
    notes = [];
    io.emit('notes:updated', notes);
  });
});

/* ---------------------------------------------------------------------------
 * Health Endpoint
 * ------------------------------------------------------------------------- */
app.get('/health', (_, res) => res.json({ ok: true }));

/* ---------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */
function weightImpact(impact) {
  switch ((impact || '').toLowerCase()) {
    case 'critical':
      return 5;
    case 'serious':
      return 3;
    case 'moderate':
      return 1;
    case 'minor':
      return 0.5;
    default:
      return 1;
  }
}

/**
 * Validates a URL before scanning (prevents SSRF / local network scans).
 * Optionally uses SCAN_HOST_WHITELIST to restrict scanning to known hosts.
 */
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
    .map((s) => s.trim())
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
    if (addrs.some((a) => isPrivate(a.address))) throw new Error('hostname resolves to disallowed IP');
  } catch {
    throw new Error('unable to resolve hostname');
  }
  return parsed.href;
}

async function runPuppeteerScan(url) {
  let browser;
  try {
    // Try to load Sparticuz chromium at runtime; if not installed, we just use system Chrome.
    let chromium = null;
    try {
      const mod = await import('@sparticuz/chromium'); // optional
      chromium = mod?.default ?? null;
    } catch {
      chromium = null;
    }

    // Launch options (work on Render/Docker and locally)
    const launchOpts = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-crash-reporter',
        '--disable-extensions',
        '--disable-dev-profile',
      ],
    };

    // If Sparticuz is available, add its flags and executablePath.
    if (chromium) {
      // NOTE: modern @sparticuz/chromium exposes .args (array), not a function.
      launchOpts.args = [...launchOpts.args, ...chromium.args];
      launchOpts.executablePath = await chromium.executablePath();
      process.env.LD_LIBRARY_PATH = `${process.env.LD_LIBRARY_PATH || ''}:${await chromium.libc()}`;
      process.env.TMPDIR = process.env.TMPDIR || '/tmp';
    }
    // else: puppeteer will use system Chrome/Chromium per PUPPETEER_* env or its bundled browser.

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


/* ---------------------------------------------------------------------------
 * Optional In-Memory Queue (demo) for asynchronous scans
 * ------------------------------------------------------------------------- */
const jobs = new Map();
const queue = [];
let processing = 0;
const CONCURRENCY = Math.max(1, parseInt(process.env.JOB_CONCURRENCY || '2', 10));

function makeJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function enqueueJob(url) {
  const id = makeJobId();
  const job = {
    id,
    status: 'queued',
    url,
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);
  queue.push(id);
  processQueue().catch((err) => console.error('Queue error:', err));
  return job;
}

async function processQueue() {
  while (processing < CONCURRENCY && queue.length) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job) continue;
    processing++;
    job.status = 'running';
    job.updatedAt = Date.now();
    try {
      const safeUrl = await validateAndRejectPrivateHosts(job.url);
      const out = await runPuppeteerScan(safeUrl);
      job.result = out;
      job.status = 'completed';
      job.updatedAt = Date.now();
      io.emit('scan:done', { jobId, url: safeUrl, timestamp: job.updatedAt });
    } catch (err) {
      job.error = String(err?.message || err);
      job.status = 'failed';
      job.updatedAt = Date.now();
    } finally {
      processing--;
    }
  }
}

/* ---------------------------------------------------------------------------
 * Scan Endpoints
 *
 * - /scan can be synchronous or asynchronous. Use ?async=1 to queue a job.
 * ------------------------------------------------------------------------- */
app.get('/scan', requireApiKey, async (req, res) => {
  try {
    const { url, async: asyncFlag } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // queue job if async=1
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

/* ---------------------------------------------------------------------------
 * Protect /crawl, /report, and /ai endpoints
 * ------------------------------------------------------------------------- */
app.use(['/crawl', '/report', '/ai'], requireApiKey);

/* AI routes mounted */
try {
  app.use(aiVpatPdf);
} catch {}
try {
  app.use(aiSummary);
} catch {}
try {
  app.use(aiVpat);
} catch {}

/* Crawl placeholder (not implemented) */
app.get('/crawl', (_, res) => {
  res.status(501).json({ error: 'Crawl via job queue not implemented. Use /scan.' });
});

/* HTML Report */
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
      .map((v) => `<tr><td>${v.id}</td><td>${v.impact || ''}</td><td>${(v.tags || []).join(', ')}</td><td>${v.help || ''}</td></tr>`)
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Scan Report</title><style>body{font:14px/1.5 system-ui;margin:2rem}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #eee;padding:.5rem;text-align:left}.badge{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 8px;margin-right:6px}</style></head><body>
<h1>Scan Report</h1><p><span class="badge">${url || ''}</span><span class="badge">${now}</span><span class="badge">WCAG 2.2</span></p>
<h2>Summary</h2><ul><li>Total violations: ${violations.length}</li><li>Critical: ${impacts.critical} • Serious: ${impacts.serious} • Moderate: ${impacts.moderate} • Minor: ${impacts.minor}</li><li>Estimated site score: ${typeof score === 'number' ? score + '/100' : 'n/a'}</li></ul>
<h2>Findings</h2><table><thead><tr><th>Rule</th><th>Impact</th><th>WCAG tags</th><th>Help</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'report error' });
  }
});

/* ---------------------------------------------------------------------------
 * Sample Files
 * ------------------------------------------------------------------------- */
app.get('/samples/:name', (req, res) => {
  const p = path.join(__dirname, '..', 'samples', req.params.name);
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send('Not found');
});

/* ---------------------------------------------------------------------------
 * Global Error Handler
 * ------------------------------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && (err.stack || err.message || err));
  if (res.headersSent) return next(err);
  res.status(err?.status || 500).json({ error: 'internal server error' });
});

/* ---------------------------------------------------------------------------
 * Boot the server
 * ------------------------------------------------------------------------- */
const port = process.env.PORT || 4002;
server.listen(port, () => {
  console.log(`GopherA11y-TC Pro API listening on :${port}`);
});
