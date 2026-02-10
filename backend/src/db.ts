import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { config } from './config.js';
import type { RunRecord } from './types.js';

export interface Db {
  init(): Promise<void>;
  createRun(id: string): Promise<void>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  listRuns(limit: number): Promise<RunRecord[]>;
}

class SqliteDb implements Db {
  private db: Database.Database;

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at_utc TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        transcript TEXT,
        decoded_summary TEXT,
        likely_acdc_reference TEXT,
        confidence REAL,
        error TEXT
      );
    `);
  }

  async createRun(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, created_at_utc, status, duration_seconds)
      VALUES (@id, @created_at_utc, @status, @duration_seconds)
    `);
    stmt.run({
      id,
      created_at_utc: new Date().toISOString(),
      status: 'queued',
      duration_seconds: config.durationSeconds
    });
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<void> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!entries.length) return;

    const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    this.db.prepare(`UPDATE runs SET ${setSql} WHERE id = ?`).run(...values, id);
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRecord | undefined;
    return row ?? null;
  }

  async listRuns(limit: number): Promise<RunRecord[]> {
    return this.db
      .prepare('SELECT * FROM runs ORDER BY created_at_utc DESC LIMIT ?')
      .all(limit) as RunRecord[];
  }
}

class PostgresDb implements Db {
  private pool: Pool;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at_utc TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        transcript TEXT,
        decoded_summary TEXT,
        likely_acdc_reference TEXT,
        confidence DOUBLE PRECISION,
        error TEXT
      );
    `);
  }

  async createRun(id: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO runs (id, created_at_utc, status, duration_seconds) VALUES ($1, NOW(), $2, $3)`,
      [id, 'queued', config.durationSeconds]
    );
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<void> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!entries.length) return;

    const sets = entries.map(([key], idx) => `${key} = $${idx + 1}`).join(', ');
    const values = entries.map(([, value]) => value);
    values.push(id);
    await this.pool.query(`UPDATE runs SET ${sets} WHERE id = $${entries.length + 1}`, values);
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const result = await this.pool.query('SELECT * FROM runs WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      created_at_utc: new Date(row.created_at_utc).toISOString()
    };
  }

  async listRuns(limit: number): Promise<RunRecord[]> {
    const result = await this.pool.query('SELECT * FROM runs ORDER BY created_at_utc DESC LIMIT $1', [limit]);
    return result.rows.map((row) => ({
      ...row,
      created_at_utc: new Date(row.created_at_utc).toISOString()
    }));
  }
}

export function createDb(): Db {
  if (config.databaseUrl) return new PostgresDb(config.databaseUrl);
  return new SqliteDb(config.sqlitePath);
}
