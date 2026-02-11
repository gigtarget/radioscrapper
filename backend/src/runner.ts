import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import type { Db } from './db.js';
import type { DecodeResult } from './types.js';

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
    const child = spawn(config.pythonBin, [scriptPath, audioPath], { cwd: path.join(process.cwd()) });
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

async function decodeTranscript(transcript: string): Promise<DecodeResult> {
  if (!config.openAiApiKey) {
    return {
      decoded_summary: 'OPENAI_API_KEY not set; decode skipped.',
      likely_acdc_reference: 'Unknown',
      confidence_0_to_1: 0
    };
  }

  const payload = {
    model: config.openAiModel,
    ...(config.decodeMaxTokens ? { max_tokens: config.decodeMaxTokens } : {}),
    messages: [
      {
        role: 'system',
        content:
          'You decode scrambled words from radio speech-to-text input. Do not summarize. Use the transcript directly, find scrambled words, decode them, and infer the AC/DC band-related answer. Return strict JSON with keys decoded_summary, likely_acdc_reference, confidence_0_to_1 (0..1).'
      },
      {
        role: 'user',
        content: `Get the scrambled words from this input, try to decode them, and provide the AC/DC band-related answer. Input: ${transcript}`
      }
    ],
    response_format: {
      type: 'json_object'
    }
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
  if (!content) throw new Error('OpenAI decode empty response');

  const parsed = JSON.parse(content) as DecodeResult;
  return {
    decoded_summary: parsed.decoded_summary || '',
    likely_acdc_reference: parsed.likely_acdc_reference || 'Unknown',
    confidence_0_to_1: Number(parsed.confidence_0_to_1 ?? 0)
  };
}

export async function executeRun(db: Db, runId: string): Promise<void> {
  const audioPath = path.join(config.audioDir, `${runId}.m4a`);

  try {
    await db.updateRun(runId, { status: 'running' });
    await recordAudio(audioPath);
    const transcript = await transcribe(audioPath);
    const decoded = await decodeTranscript(transcript);

    await db.updateRun(runId, {
      status: 'done',
      transcript,
      decoded_summary: decoded.decoded_summary,
      likely_acdc_reference: decoded.likely_acdc_reference,
      confidence: decoded.confidence_0_to_1,
      error: null
    });
  } catch (error) {
    await db.updateRun(runId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
