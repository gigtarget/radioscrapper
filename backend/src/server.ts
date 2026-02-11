import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cron from 'node-cron';
import { z } from 'zod';
import { config, redactConnectionString } from './config.js';
import { createDb } from './db.js';
import { InProcessQueue } from './jobQueue.js';
import { executeRun } from './runner.js';
import { generateRunId, withToronto } from './utils.js';
import { RECORDING_SETTINGS } from './recording_settings.js';

const app = express();
const db = createDb();
const queue = new InProcessQueue();
const PORT = Number(process.env.PORT || 3000);
const DB_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];
const frontendDir = path.resolve(process.cwd(), '..', 'frontend');
const frontendIndexPath = path.join(frontendDir, 'index.html');


let dbReady = false;
let dbError: string | undefined;

function getStorageInfo(): {
  mode: 'postgres';
  persistence_note: string;
} {
  return {
    mode: 'postgres',
    persistence_note: 'Postgres is persistent as long as your Railway Postgres service/database remains attached.'
  };
}

function renderPublicPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GIANT FM Decoder - Public History</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; }
      .muted { color: #666; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f6f6f6; }
      .pill { border-radius: 999px; padding: 2px 10px; display: inline-block; font-size: 12px; }
      .pill.pending { background: #f2f2f2; }
      .pill.done { background: #d8f6dd; }
      .pill.failed { background: #f9dddd; }
      .long-text { min-width: 220px; max-width: 420px; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; max-height: 260px; overflow-y: auto; }
    </style>
  </head>
  <body>
    <h1>GIANT FM AC/DC Decoder - Public History</h1>
    <p class="muted">This page is read-only.</p>
    <table>
      <thead>
        <tr>
          <th>Time (Toronto)</th>
          <th>Status</th>
          <th>Duration (s)</th>
          <th>Transcript</th>
          <th>Decoded Summary</th>
          <th>Likely AC/DC Ref</th>
          <th>Confidence</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody id="runs-body"></tbody>
    </table>
    <script>
      const runsBody = document.getElementById('runs-body');

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function renderStatus(status) {
        const normalized = (status || '').toLowerCase();
        let cls = 'pending';
        if (normalized === 'done') cls = 'done';
        else if (normalized === 'failed') cls = 'failed';
        return '<span class="pill ' + cls + '">' + escapeHtml(status || 'pending') + '</span>';
      }

      function runRow(run) {
        return '<tr>' +
          '<td>' + escapeHtml(run.created_at_toronto || '') + '</td>' +
          '<td>' + renderStatus(run.status) + '</td>' +
          '<td>' + (run.duration_seconds ?? '') + '</td>' +
          '<td class="long-text">' + escapeHtml(run.transcript || '') + '</td>' +
          '<td class="long-text">' + escapeHtml(run.decoded_summary || '') + '</td>' +
          '<td>' + escapeHtml(run.likely_acdc_reference || '') + '</td>' +
          '<td>' + (run.confidence ?? '') + '</td>' +
          '<td class="long-text">' + escapeHtml(run.error || '') + '</td>' +
        '</tr>';
      }

      async function fetchRuns() {
        const response = await fetch('/runs');
        if (!response.ok) throw new Error(await response.text());
        const runs = await response.json();
        runsBody.innerHTML = runs.map(runRow).join('');
      }

      async function refreshLoop() {
        try {
          await fetchRuns();
        } catch (error) {
          console.error('Failed to fetch runs', error);
        }
      }

      refreshLoop();
      setInterval(refreshLoop, 10000);
    </script>
  </body>
</html>`;
}

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.header('Origin');
  const isAllowedOrigin = Boolean(origin && config.corsOrigin && origin === config.corsOrigin);

  if (isAllowedOrigin) {
    res.header('Access-Control-Allow-Origin', origin as string);
    res.header('Vary', 'Origin');
  } else if (req.method === 'GET') {
    res.header('Access-Control-Allow-Origin', '*');
  }

  if (req.method === 'POST' || req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = req.header('X-API-KEY');
  if (!config.backendApiKey || key !== config.backendApiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function maybeRequireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!config.requireApiKey) {
    next();
    return;
  }
  requireApiKey(req, res, next);
}

async function enqueueRun(source: 'manual' | 'scheduled'): Promise<string> {
  if (!dbReady) {
    throw new Error('DB_NOT_READY');
  }

  const id = generateRunId();
  await db.createRun(id);
  queue.enqueue(async () => executeRun(db, id));
  console.log(`[run:${id}] queued from ${source}`);
  return id;
}

async function initDbWithRetry(): Promise<void> {
  let retryCount = 0;

  while (!dbReady) {
    try {
      await db.init();
      dbReady = true;
      dbError = undefined;
      console.log('[storage] Using Postgres.');
      return;
    } catch (error) {
      dbError = error instanceof Error ? error.message : 'Unknown DB initialization error';
      const delay = DB_RETRY_DELAYS_MS[retryCount] ?? 30000;
      retryCount += 1;
      console.error(`[db] init failed, retrying in ${Math.round(delay / 1000)}s`, error);
      console.error('[db] Verify one DB URL var is set and resolved: DATABASE_URL, DATABASE_PUBLIC_URL, or POSTGRES_URL.');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

app.get('/', (_req, res) => {
  res.redirect('/public');
});

app.use('/admin', express.static(frontendDir));

app.get('/admin', (_req, res) => {
  res.sendFile(frontendIndexPath);
});

app.get('/admin/*', (req, res, next) => {
  if (req.path.includes('.')) return next();
  res.sendFile(frontendIndexPath);
});

app.get('/public', (_req, res) => {
  res.type('html').send(renderPublicPage());
});

app.get('/public-config', (_req, res) => {
  res.json({
    stream_url: config.streamUrl,
    duration_seconds: config.durationSeconds,
    require_api_key: config.requireApiKey
  });
});

app.get('/storage-info', (_req, res) => {
  res.json(getStorageInfo());
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, port: PORT, dbReady, dbError: dbError || null, storage: getStorageInfo() });
});

app.post('/run', maybeRequireApiKey, async (_req, res) => {
  try {
    const id = await enqueueRun('manual');
    res.status(202).json({ id, status: 'queued' });
  } catch (error) {
    if (error instanceof Error && error.message === 'DB_NOT_READY') {
      res.status(503).json({ error: 'Database is still initializing. Please retry shortly.' });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to queue run' });
  }
});

app.post('/run/secure', requireApiKey, async (_req, res) => {
  try {
    const id = await enqueueRun('manual');
    res.status(202).json({ id, status: 'queued' });
  } catch (error) {
    if (error instanceof Error && error.message === 'DB_NOT_READY') {
      res.status(503).json({ error: 'Database is still initializing. Please retry shortly.' });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to queue run' });
  }
});

app.get('/runs', async (_req, res) => {
  const rows = await db.listRuns(100);
  res.json(rows.map(withToronto));
});

app.get('/runs/:id', async (req, res) => {
  const id = z.string().parse(req.params.id);
  const run = await db.getRun(id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json(withToronto(run));
});

async function main(): Promise<void> {
  fs.mkdirSync(config.audioDir, { recursive: true });

  console.log(`[config] DB URL source: ${config.databaseUrlSource} (${redactConnectionString(config.databaseUrl)})`);
  console.log(`[config] CORS_ORIGIN: ${config.corsOrigin || '(not set)'}`);

  for (const runTime of RECORDING_SETTINGS.runTimes) {
    const [hourPart, minutePart] = runTime.split(':');
    const hour = Number(hourPart);
    const minute = Number(minutePart);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      console.warn(`[cron] skipping invalid run time: ${runTime}`);
      continue;
    }

    const cronExpression = `0 ${minute} ${hour} * * *`;

    cron.schedule(
      cronExpression,
      () => {
        void enqueueRun('scheduled').catch((error) => {
          if (error instanceof Error && error.message === 'DB_NOT_READY') {
            console.warn('[cron] skipped scheduled run because database is not ready yet.');
            return;
          }

          console.error('[cron] failed to enqueue scheduled run', error);
        });
      },
      { timezone: RECORDING_SETTINGS.timezone }
    );
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend listening on ${PORT}`);
    void initDbWithRetry();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
