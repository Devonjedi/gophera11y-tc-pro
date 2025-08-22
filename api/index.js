import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import { AxePuppeteer } from '@axe-core/puppeteer';
import puppeteer from 'puppeteer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dns from 'dns/promises';
import { router as aiSummary } from './routes/ai-summary.js';
import { router as aiVpat } from './routes/ai-vpat.js';
import { router as aiVpatPdf } from './routes/ai-vpat-pdf.js';

const isDev = process.env.NODE_ENV !== 'production';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
}));

// CORS config – allow any origin in dev; otherwise use allowedOrigins or default '*'
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isDev) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

// Create HTTP server and socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: isDev ? '*' : (allowedOrigins.length ? allowedOrigins : '*'),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
});

// Simple notes feature
let notes = [];
io.on('connection', socket => {
  socket.emit('notes:init', notes);
  socket.on('notes:add', note => {
    const n = { id: Date.now(), ...note };
    notes.push(n);
    io.emit('notes:updated', notes);
  });
  socket.on('notes:clear', () => {
    notes = [];
    io.emit('notes:updated', notes);
  });
});

// Helper for scanning pages
async function validateAndRejectPrivateHosts(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch {
    throw new Error('invalid url');
  }
  const hostWhitelist = (process.env.SCAN_HOST_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean);
  if (hostWhitelist.length && !hostWhitelist.includes(parsed.hostname)) throw new Error('hostname not allowed');
  try {
    const addrs = await dns.lookup(parsed.hostname, { all: true });
    const isPrivate = ip =>
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^127\./.test(ip) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
      /^::1$/.test(ip) ||
      /^fc|^fd/.test(ip);
    if (addrs.some(a => isPrivate(a.address))) throw new Error('hostname resolves to disallowed IP');
  } catch {
    throw new Error('unable to resolve hostname');
  }
  return parsed.href;
}

async function runPuppeteerScan(url) {
  let browser;
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-crashpad',
      '--disable-extensions',
      '--disable-dev-profile',
    ],
  };
  try {
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

// Basic health route
app.get('/health', (_, res) => res.json({ ok: true }));

// Scan endpoints (GET /scan?url=... or POST /scan with JSON {url}).
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
  processQueue().catch(err => console.error('Queue error:', err));
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

async function handleScan(req, res) {
  const { url, async: asyncFlag } = req.method === 'GET' ? req.query : req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
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
}

app.get('/scan', handleScan);
app.post('/scan', handleScan);
app.get('/scan/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// Mount other routes
app.use(aiSummary);
app.use(aiVpat);
app.use(aiVpatPdf);

// Start the server
const port = process.env.PORT || 4002;
server.listen(port, () => {
  console.log(`GopherA11y API listening on :${port}`);
});
