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

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.header('Origin');

  if (req.method === 'GET') {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (req.method === 'POST' || req.method === 'OPTIONS') {
    if (origin && config.corsOrigin && origin === config.corsOrigin) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

async function enqueueRun(source: 'manual' | 'scheduled'): Promise<string> {
  const id = generateRunId();
  await db.createRun(id);
  queue.enqueue(async () => executeRun(db, id));
  console.log(`[run:${id}] queued from ${source}`);
  return id;
}

app.post('/run', async (_req, res) => {
  try {
    const id = await enqueueRun('manual');
    res.status(202).json({ run_id: id });
app.post('/run', requireApiKey, async (_req, res) => {
  try {
    const id = await enqueueRun('manual');
    res.status(202).json({ id, status: 'queued' });
  } catch (error) {
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
  await db.init();

  cron.schedule(
    '0 8,12,14 * * *',
    () => {
      void enqueueRun('scheduled');
    },
    { timezone: 'America/Toronto' }
  );

  app.listen(config.port, () => {
    console.log(`Backend listening on ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
