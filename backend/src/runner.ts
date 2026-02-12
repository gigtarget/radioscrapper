import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import type { Db } from './db.js';
import type { DecodeResult } from './types.js';

interface DecodeContext {
  snippet: string;
  found: boolean;
}

interface RunLogger {
  info(message: string): void;
  error(message: string): void;
  flushToDb(): Promise<void>;
}

const UNKNOWN = 'UNKNOWN';

const DEFAULT_ANALYSIS: DecodeResult = {
  decoded_summary: UNKNOWN,
  likely_acdc_reference: UNKNOWN,
  confidence_0_to_1: 0
};

const DEFAULT_STREAM_HEADERS = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  referer: 'https://www.niagaradailynews.ca/',
  accept: '*/*'
};

function getStreamHeaders(): Record<string, string> {
  return {
    'User-Agent': config.streamUserAgent || DEFAULT_STREAM_HEADERS.userAgent,
    Referer: config.streamReferer || DEFAULT_STREAM_HEADERS.referer,
    Accept: config.streamAccept || DEFAULT_STREAM_HEADERS.accept
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

function createRunLogger(db: Db, runId: string): RunLogger {
  let logs: string[] = [];

  const append = (level: 'INFO' | 'ERROR', message: string): void => {
    const line = `[${timestamp()}] [${level}] ${message}`;
    logs.push(line);
    if (logs.length > 400) logs = logs.slice(-400);
    if (level === 'ERROR') console.error(`[run:${runId}] ${message}`);
    else console.log(`[run:${runId}] ${message}`);
  };

  return {
    info(message: string) { append('INFO', message); },
    error(message: string) { append('ERROR', message); },
    async flushToDb() {
      await db.updateRun(runId, { run_logs: logs.join('\n') });
    }
  };
}

function extractScrambleContext(transcript: string): DecodeContext {
  const words = transcript.trim() ? transcript.trim().split(/\s+/) : [];

  if (!words.length) return { snippet: '', found: false };

  const cluePatterns = [
    /\bscrambl(?:e|ed|ing)\b/i,
    /\bde[- ]?scrambl(?:e|ed|ing)?\b/i,
    /\bunscrambl(?:e|ed|ing)?\b/i,
    /\bkeyword\b/i,
    /\b(?:[a-zA-Z]-){2,}[a-zA-Z]\b/
  ];

  const scrambleIndex = words.findIndex((word) => cluePatterns.some((pattern) => pattern.test(word)));

  if (scrambleIndex === -1) return { snippet: '', found: false };

  const start = Math.max(0, scrambleIndex - 20);
  const end = Math.min(words.length, scrambleIndex + 21);

  return {
    snippet: words.slice(start, end).join(' '),
    found: true
  };
}

function extractHyphenLetters(text: string): string | null {
  // Matches "S-O-I-E-R" or "S O I E R" or "S-O-I-E-R," etc.
  const m = text.match(/\b([A-Za-z](?:[-\s][A-Za-z]){2,})\b/);
  if (!m) return null;
  const letters = m[1].replace(/[^A-Za-z]/g, '').toUpperCase();
  return letters.length >= 3 ? letters : null;
}

function sortLetters(s: string): string {
  return s.split('').sort().join('');
}

function localDecodeFromLetters(letters: string): string {
  // Small AC/DC-related candidate list (expand anytime)
  const candidates = [
    'ROSIE', 'ANGUS', 'ACDC', 'HIGHWAY', 'HELLS', 'BELLS', 'THUNDER',
    'BACK', 'BLACK', 'SHOOK', 'TNT'
  ];
  const key = sortLetters(letters);
  const hit = candidates.find((w) => sortLetters(w) === key);
  return hit ? hit.toUpperCase() : UNKNOWN;
}

function toSingleWordUpper(value: string): string {
  const single =
    value
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase() || '';

  return single || UNKNOWN;
}

function loadCookieString(): string {
  try {
    return fs.readFileSync(config.cookiePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function saveCookieString(cookie: string): void {
  fs.mkdirSync(path.dirname(config.cookiePath), { recursive: true });
  fs.writeFileSync(config.cookiePath, cookie, 'utf8');
}

async function refreshCookieJar(): Promise<string> {
  const existing = loadCookieString();
  const response = await fetch(config.streamUrl, {
    method: 'GET',
    headers: {
      ...getStreamHeaders(),
      ...(existing ? { Cookie: existing } : {})
    }
  });

  const setCookie = response.headers.get('set-cookie') || '';
  const sessionPair = setCookie
    .split(',')
    .map((chunk) => chunk.trim().split(';')[0])
    .filter(Boolean)
    .find((pair) => pair.startsWith('AISSessionId='));

  const cookie = sessionPair || existing;
  if (cookie) saveCookieString(cookie);
  return cookie;
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (buf) => {
      stderr += String(buf);
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr}`));
    });
  });
}

async function recordAudio(audioPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  const cookie = await refreshCookieJar();
  const headers = getStreamHeaders();

  const headerLines = [
    `User-Agent: ${headers['User-Agent']}`,
    `Referer: ${headers.Referer}`,
    `Accept: ${headers.Accept}`,
    ...(cookie ? [`Cookie: ${cookie}`] : [])
  ];

  await runCommand('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-headers',
    `${headerLines.join('\r\n')}\r\n`,
    '-i',
    config.streamUrl,
    '-t',
    String(config.durationSeconds),
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    audioPath
  ]);
}

async function transcribe(audioPath: string): Promise<string> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'transcribe.py');

  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, [scriptPath, audioPath], {
      cwd: path.join(process.cwd())
    });

    let out = '';
    let err = '';

    child.stdout.on('data', (buf) => {
      out += String(buf);
    });
    child.stderr.on('data', (buf) => {
      err += String(buf);
    });

    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`Transcription failed (${code}): ${err}`));
    });
  });
}

async function decodeSnippet(snippet: string): Promise<string> {
  const payload = {
    model: config.openAiModel,
    ...(config.decodeMaxTokens ? { max_completion_tokens: config.decodeMaxTokens } : {}),
    messages: [
      {
        role: 'user',
        content:
          'Decode the scrambled keyword in this paragraph related to an AC/DC contest. Return ONLY one uppercase word: the decoded keyword. No punctuation or extra text.\n\n' +
          snippet
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`OpenAI decode failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) return UNKNOWN;

  return toSingleWordUpper(content);
}

async function analyzeTranscript(transcript: string): Promise<DecodeResult> {
  const payload = {
    model: config.openAiModel,
    ...(config.decodeMaxTokens ? { max_completion_tokens: config.decodeMaxTokens } : {}),
    messages: [
      {
        role: 'system',
        content:
          'You decode scrambled words from radio speech-to-text input. Do not summarize. Use the transcript directly, find scrambled words, decode them, and infer the AC/DC band-related answer. Return strict JSON with keys decoded_summary, likely_acdc_reference, confidence_0_to_1 (0..1). decoded_summary must be exactly one uppercase word. likely_acdc_reference must be exactly one uppercase word.'
      },
      {
        role: 'user',
        content: `Get the scrambled words from this input, try to decode them, and provide the AC/DC band-related answer. Input: ${transcript}`
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`OpenAI decode failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) return { ...DEFAULT_ANALYSIS };

  // Hardening: if JSON parse fails, return defaults (prevents run from failing)
  let parsed: DecodeResult | null = null;
  try {
    parsed = JSON.parse(content) as DecodeResult;
  } catch {
    parsed = null;
  }

  return {
    decoded_summary: toSingleWordUpper(parsed?.decoded_summary || UNKNOWN),
    likely_acdc_reference: toSingleWordUpper(parsed?.likely_acdc_reference || UNKNOWN),
    confidence_0_to_1: Number(parsed?.confidence_0_to_1 ?? 0)
  };
}

export async function executeRun(db: Db, runId: string): Promise<void> {
  const audioPath = path.join(config.audioDir, `${runId}.m4a`);
  const logger = createRunLogger(db, runId);

  try {
    logger.info('Run started.');
    await db.updateRun(runId, { status: 'running', run_logs: '' });

    logger.info(`Recording audio from stream for ${config.durationSeconds}s.`);
    await recordAudio(audioPath);
    logger.info(`Recording completed: ${audioPath}`);

    logger.info('Starting transcription.');
    const transcript = await transcribe(audioPath);
    logger.info(`Transcription completed. Characters=${transcript.length}`);

    logger.info('Starting transcript analysis.');
    const { decodedSummary, likely, confidence, errorNote, analysisLogs } = await analyzeExistingTranscript(transcript);
    for (const line of analysisLogs) logger.info(line);

    await db.updateRun(runId, {
      status: 'done',
      transcript,
      decoded_summary: decodedSummary,
      likely_acdc_reference: likely,
      confidence,
      error: errorNote
    });

    if (!likely || likely === UNKNOWN) {
      logger.error('Final likely AC/DC reference is UNKNOWN. Retry may help if transcript quality is poor.');
    }

    logger.info(`Run finished with decoded_summary=${decodedSummary}, likely_acdc_reference=${likely}, confidence=${confidence}.`);
    await logger.flushToDb();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Run failed: ${message}`);
    await db.updateRun(runId, {
      status: 'failed',
      error: message
    });
    await logger.flushToDb();
  }
}

export async function analyzeExistingTranscript(transcript: string): Promise<{
  decodedSummary: string;
  likely: string;
  confidence: number;
  errorNote: string | null;
  analysisLogs: string[];
}> {
  const context = extractScrambleContext(transcript);

  let decodedSummary: string = UNKNOWN;
  let analysis: DecodeResult = { ...DEFAULT_ANALYSIS };
  let errorNote: string | null = null;
  const analysisLogs: string[] = [];

  analysisLogs.push(`Scramble context found: ${context.found}`);

  if (context.found) {
    const letters = extractHyphenLetters(context.snippet);
    if (letters) {
      decodedSummary = localDecodeFromLetters(letters);
      analysisLogs.push(`Local letter decode candidate=${decodedSummary} from letters=${letters}`);
    } else {
      analysisLogs.push('No hyphen-letter pattern found for local decode.');
    }
  }

  if (context.found && !config.openAiApiKey) {
    errorNote = 'Scramble detected but OPENAI_API_KEY is not set (or empty after trim); OpenAI decode skipped.';
    analysisLogs.push('OpenAI decode skipped because OPENAI_API_KEY is missing.');
  }

  if (context.found && config.openAiApiKey) {
    try {
      const openAiDecoded = await decodeSnippet(context.snippet);
      decodedSummary = openAiDecoded || decodedSummary;
      analysisLogs.push(`OpenAI snippet decode returned ${decodedSummary}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errorNote = `OpenAI decode failed; using local fallback if available. ${msg}`;
      analysisLogs.push(`OpenAI snippet decode failed: ${msg}`);
    }

    try {
      analysis = await analyzeTranscript(transcript);
      analysisLogs.push(`OpenAI full analysis likely=${analysis.likely_acdc_reference} confidence=${analysis.confidence_0_to_1}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errorNote = (errorNote ? `${errorNote} | ` : '') + `OpenAI analysis failed. ${msg}`;
      analysisLogs.push(`OpenAI full analysis failed: ${msg}`);
    }
  }

  decodedSummary = toSingleWordUpper(decodedSummary);
  const likely = toSingleWordUpper(analysis.likely_acdc_reference || UNKNOWN);

  const conf = Number(analysis.confidence_0_to_1 ?? 0);
  const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;

  analysisLogs.push(`Final normalized values decoded_summary=${decodedSummary}, likely=${likely}, confidence=${confidence}`);

  return {
    decodedSummary,
    likely,
    confidence,
    errorNote,
    analysisLogs
  };
}
