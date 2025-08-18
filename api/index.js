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
app.disable('x-powered-by');

const isDev = process.env.NODE_ENV !== 'production';
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true);

/* ------------------------- CORS (GLOBAL, FIRST) ------------------------- */
/**
 * Allow:
 *  - any origin in ALLOWED_ORIGINS (comma-separated exact origins)
 *  - any *.vercel.app host (useful for Vercel previews + prod)
 *  - localhost/127.0.0.1 defaults
 *  - no Origin header (server-to-server, curl)
 */
const allowlistFromEnv = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // allow same-origin / server-to-server
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith('.vercel.app')) return true;
    if (allowlistFromEnv.includes(origin)) return true;
    if (isDev) return true; // be permissive in dev
    return false;
  } catch {
    return false;
  }
};

const corsOptionsDelegate = (req, cb) => {
  const origin = req.header('Origin');
  const allowed = isAllowedOrigin(origin);
  cb(null, {
    origin: allowed ? origin : false, // reflect the origin if allowed
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With','X-API-Key','x-api-key'],
    optionsSuccessStatus: 204,
  });
};

// Ensure caches differentiate by Origin (important for CDNs)
app.use((req, res, next) => { res.setHeader('Vary', 'Origin'); next(); });
app.use(cors(corsOptionsDelegate));
app.options('*', cors(corsOptionsDelegate));

/* ------------------------- Security / parsing ------------------------- */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

/* ------------------------- Rate limit AFTER CORS ------------------------- */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

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
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin) ? origin : false),
    credentials: true,
    methods: ['GET','POST'],
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io',
  allowEIO3: true,
});

let notes = [];
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
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

  socket.on('disconnect', (reason) => {
    console.log('socket disconnected', socket.id, reason);
  });
});

/* ------------------------- Health ------------------------- */
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/healthz', (_, res) => res.json({ ok: true })); // extra health alias

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
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
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

    const safeUrl = await validateAndRejectPriv
