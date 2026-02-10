import fs from 'node:fs';
import express from 'express';
import cron from 'node-cron';
import { z } from 'zod';
import { config } from './config.js';
import { createDb } from './db.js';
import { InProcessQueue } from './jobQueue.js';
import { executeRun } from './runner.js';
import { generateRunId, withToronto } from './utils.js';

const app = express();
const db = createDb();
const queue = new InProcessQueue();
const PORT = Number(process.env.PORT || 3000);
const DB_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

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
      console.log('[storage] Using Postgres (DATABASE_URL is required).');
      return;
    } catch (error) {
      dbError = error instanceof Error ? error.message : 'Unknown DB initialization error';
      const delay = DB_RETRY_DELAYS_MS[retryCount] ?? 30000;
      retryCount += 1;
      console.error(`[db] init failed, retrying in ${Math.round(delay / 1000)}s`, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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

  cron.schedule(
    '59 7,10,15 * * *',
    () => {
      void enqueueRun('scheduled').catch((error) => {
        if (error instanceof Error && error.message === 'DB_NOT_READY') {
          console.warn('[cron] skipped scheduled run because database is not ready yet.');
          return;
        }

        console.error('[cron] failed to enqueue scheduled run', error);
      });
    },
    { timezone: 'America/Toronto' }
  );

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend listening on ${PORT}`);
    void initDbWithRetry();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
