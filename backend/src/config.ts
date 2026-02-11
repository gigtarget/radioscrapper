import dotenv from 'dotenv';

dotenv.config();

type DbUrlSource = 'DATABASE_URL' | 'DATABASE_PUBLIC_URL' | 'POSTGRES_URL';

function looksResolved(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes('${{') || trimmed.startsWith('${')) return false;
  return true;
}

function pickDatabaseUrl(): { source: DbUrlSource; value: string } {
  const candidates: Array<{ source: DbUrlSource; value: string | undefined }> = [
    { source: 'DATABASE_URL', value: process.env.DATABASE_URL },
    { source: 'DATABASE_PUBLIC_URL', value: process.env.DATABASE_PUBLIC_URL },
    { source: 'POSTGRES_URL', value: process.env.POSTGRES_URL }
  ];

  for (const candidate of candidates) {
    if (looksResolved(candidate.value)) {
      return { source: candidate.source, value: candidate.value.trim() };
    }
  }

  const unresolvedSources = candidates
    .filter(({ value }) => {
      if (!value) return false;
      const trimmed = value.trim();
      return trimmed.includes('${{') || trimmed.startsWith('${');
    })
    .map(({ source }) => source);

  if (unresolvedSources.length) {
    throw new Error(
      `Missing required DB URL: ${unresolvedSources.join(', ')} contains unresolved variable references. Accepted vars: DATABASE_URL, DATABASE_PUBLIC_URL, POSTGRES_URL.`
    );
  }

  throw new Error(
    'Missing required DB URL. Set one of: DATABASE_URL, DATABASE_PUBLIC_URL, POSTGRES_URL.'
  );
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function redactConnectionString(url: string): string {
  return url.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}

const dbUrl = pickDatabaseUrl();

export const config = {
  port: Number(process.env.PORT || 3000),
  backendApiKey: process.env.BACKEND_API_KEY || '',
  requireApiKey: process.env.REQUIRE_API_KEY === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '',
  durationSeconds: parseNumber(process.env.RECORD_SECONDS ?? process.env.DURATION_SECONDS, 120),
  streamUrl: process.env.STREAM_URL || 'https://mybroadcasting.streamb.live/SB00329?_=252731',
  streamUserAgent: process.env.STREAM_USER_AGENT || '',
  streamReferer: process.env.STREAM_REFERER || '',
  streamAccept: process.env.STREAM_ACCEPT || '',
  databaseUrl: dbUrl.value,
  databaseUrlSource: dbUrl.source,
  audioDir: process.env.AUDIO_DIR || '/data/audio',
  cookiePath: process.env.COOKIE_JAR_PATH || process.env.COOKIE_PATH || '/data/cookies.txt',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.DECODE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  decodeMaxTokens: parseOptionalNumber(process.env.DECODE_MAX_TOKENS),
  transcribeMode: process.env.TRANSCRIBE_MODE || '',
  whisperModel: process.env.WHISPER_MODEL || '',
  whisperLanguage: process.env.WHISPER_LANGUAGE || '',
  pythonBin: process.env.PYTHON_BIN || 'python3'
};
