import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const dataDir = process.env.DATA_DIR || '/data';

export const config = {
  port: Number(process.env.PORT || 3000),
  backendApiKey: process.env.BACKEND_API_KEY || '',
  requireApiKey: process.env.REQUIRE_API_KEY === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '',
  durationSeconds: Number(process.env.DURATION_SECONDS || 240),
  streamUrl: process.env.STREAM_URL || 'https://mybroadcasting.streamb.live/SB00329?_=252731',
  databaseUrl: process.env.DATABASE_URL,
  sqlitePath: process.env.SQLITE_PATH || path.join(dataDir, 'db.sqlite'),
  audioDir: process.env.AUDIO_DIR || path.join(dataDir, 'audio'),
  cookiePath: process.env.COOKIE_PATH || path.join(dataDir, 'cookies.txt'),
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  pythonBin: process.env.PYTHON_BIN || 'python3'
};
