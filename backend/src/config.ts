import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing required DATABASE_URL environment variable. Configure your Postgres connection string before starting the backend.');
}

export const config = {
  port: Number(process.env.PORT || 3000),
  backendApiKey: process.env.BACKEND_API_KEY || '',
  requireApiKey: process.env.REQUIRE_API_KEY === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '',
  durationSeconds: Number(process.env.DURATION_SECONDS || 120),
  streamUrl: process.env.STREAM_URL || 'https://mybroadcasting.streamb.live/SB00329?_=252731',
  databaseUrl,
  audioDir: process.env.AUDIO_DIR || '/data/audio',
  cookiePath: process.env.COOKIE_PATH || '/data/cookies.txt',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  pythonBin: process.env.PYTHON_BIN || 'python3'
};
