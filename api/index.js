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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------------- Security / hardening ------------------------- */
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

// Set trust proxy BEFORE rate limiting
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1); // Trust first proxy (Render's load balancer)
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  // Fix the trust proxy issue by being more specific
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Add skip successful requests for better UX
  skipSuccessfulRequests: false,
  // Custom key generator for better IP detection
  keyGenerator: (req) => {
    if (process.env.TRUST_PROXY === 'true') {
      return req.ip || req.connection.remoteAddress;
    }
    return req.connection.remoteAddress;
  },
});

app.use(limiter);

/* ------------------------- CORS ------------------------- */
const isDev = process.env.NODE_ENV !== 'production';

const rawAllowed = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Allow exact origins or wildcard subdomains:
 * - exact: "https://example.com"
 * - host-only: "example.com"
 * - wildcard: "*.vercel.app"
 */
function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin / curl / server-to-server
  if (isDev) return true;

  let host;
  try {
    const u = new URL(origin);
    host = u.hostname; // e.g. "foo.vercel.app"
  } catch {
    return false;
  }

  for (const entry of rawAllowed) {
    if (!entry) continue;

    // Accept both full origin form and host-only form in env.
    if (entry.startsWith('http://') || entry.startsWith('https://')) {
      if (origin === entry) return true;
      try {
        const eu = new URL(entry);
        if (eu.hostname && eu.hostname === host) return true;
      } catch {
        /* ignore */
      }
    } else if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".vercel.app"
      if (host === entry.slice(2) || host.endsWith(suffix)) return true;
    } else {
      // plain host exact match
      if (host === entry) return true;
    }
  }
  return false;
}

const corsOrigin = (origin, callback) => {
  try {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('CORS origin denied'));
  } catch {
    return callback(new Error('CORS origin parse error'));
  }
};

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

/* ------------------------- Auth (permissive by default) ------------------------- */
/**
 * In dev or when ALLOW_UNSECURED=true: allow all.
 * In production: only enforce if ADMIN_API_KEY (or legacy API_KEY) is set.
 * We do NOT use GEMINI_API_KEY for auth.
 */
function requireApiKey(req, res, next) {
  if (isDev || process.env.ALLOW_UNSECURED === 'true') {
    return next();
  }
  const secret = (process.env.ADMIN_API_KEY || process.env.API_KEY || '').trim();
  if (!secret) return next(); // open in prod if no admin key configured

  const provided = (req.get('x-api-key') || req.query.api_key || req.body?.api_key || '').trim();
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

/* ------------------------- HTTP + Socket.io ------------------------- */
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
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
    .map((s) => s.trim())
    .filter(Boolean);
  if (hostWhitelist.length && !hostWhitelist.includes(parsed.hostname)) {
    throw new Error('hostname not allowed');
  }

  try {
    const addrs = await dns.lookup(parsed.hostname, { all: true });
    const isPrivate = (ip) => {
      // IPv4 RFC1918 + loopback
      if (/^10\./.test(ip)) return true;
      if (/^192\.168\./.test(ip)) return true;
      if (/^127\./.test(ip)) return true;
      if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
      // IPv6 loopback + unique local (fc00::/7)
      if (/^::1$/.test(ip)) return true;
      if (/^(fc|fd)/i.test(ip)) return true;
      return false;
    };
    if (addrs.some((a) => isPrivate(a.address))) throw new Error('hostname resolves to disallowed IP');
  } catch {
    throw new Error('unable to resolve hostname');
  }
  return parsed.href;
}

// Replace the runPuppeteerScan function in your index.js with this:

async function runPuppeteerScan(url) {
  let browser;
  try {
    // Create unique temp directories for each scan to avoid conflicts
    const timestamp = Date.now();
    const userDataDir = `/tmp/chrome-user-data-${timestamp}`;
    const cacheDir = `/tmp/chrome-cache-${timestamp}`;
    const dataDir = `/tmp/chrome-data-${timestamp}`;

    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // This helps with crashpad issues
        '--disable-gpu',
        '--disable-crash-reporter',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-features=TranslateUI',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-networking',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--no-pings',
        '--password-store=basic',
        '--use-mock-keychain',
        '--window-size=1280,800',
        `--user-data-dir=${userDataDir}`,
        `--data-path=${dataDir}`,
        `--disk-cache-dir=${cacheDir}`,
        // Additional flags to prevent profile corruption
        '--disable-background-mode',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-session-crashed-bubble',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-crash-upload',
        '--safebrowsing-disable-auto-update',
        '--force-color-profile=srgb',
        '--disable-ipc-flooding-protection',
      ],
      timeout: 60000,
    };

    console.log('Launching browser with timestamp:', timestamp);
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Navigating to:', url);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Running axe analysis...');
    const results = await new AxePuppeteer(page).analyze();

    await browser.close();
    console.log('Scan completed successfully');

    // Clean up temp directories after successful scan
    try {
      const fs = await import('fs');
      const rmSync = fs.rmSync || fs.rmdirSync;
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Warning: Could not clean up temp directories:', cleanupError.message);
    }

    return { url, timestamp: new Date().toISOString(), results };
  } catch (e) {
    console.error('Puppeteer scan error:', e.message, e.stack);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
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
  processQueue().catch((err) => console.error('Queue worker error:', err));
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

/* ------------------------- Scan endpoints ------------------------- */
/**
 * Synchronous by default (matches your current UI).
 * Pass ?async=1 to enqueue and return a job id instead.
 */
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

try {
  app.use(aiVpatPdf);
} catch (_) {}
try {
  app.use(aiSummary);
} catch (_) {}
try {
  app.use(aiVpat);
} catch (_) {}

/* Crawl (placeholder) */
app.get('/crawl', async (req, res) => {
  res.status(501).json({
    error: 'Crawl via job queue not implemented in demo. Use /scan to analyze individual pages.',
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
      .map(
        (v) =>
          `<tr><td>${v.id}</td><td>${v.impact || ''}</td><td>${(v.tags || []).join(
            ', '
          )}</td><td>${v.help || ''}</td></tr>`
      )
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
  if (!isDev) {
    console.log('Allowed origins:', rawAllowed.join(', ') || '(none)');
  }
});
