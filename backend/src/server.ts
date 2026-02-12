import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cron from 'node-cron';
import { z } from 'zod';
import { config, redactConnectionString } from './config.js';
import { createDb } from './db.js';
import { InProcessQueue } from './jobQueue.js';
import { analyzeExistingTranscript, executeRun } from './runner.js';
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
    <title>GIANT FM Decoder — Public History</title>
    <meta name="description" content="Read-only public run history for GIANT FM AC/DC Decoder." />
    <style>
      :root{
        color-scheme: dark;
        --bgTop:#0B1030;
        --bgBottom:#050713;

        --card:#0E1636;
        --border: rgba(140,160,255,.18);
        --text: #EAF0FF;
        --muted:#A7B3D6;
        --muted2:#7F8BB4;

        --brand:#7C5CFF;
        --brand2:#35D0FF;

        --ok:#35E08A;
        --warn:#FFD34D;
        --bad:#FF5C7A;

        --shadow: 0 22px 55px rgba(0,0,0,.45);
        --shadow2: 0 12px 30px rgba(0,0,0,.35);
        --radius: 18px;
        --radius2: 14px;

        --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
        --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
      }

      *{ box-sizing:border-box; }
      html,body{ height:100%; }
      body{
        margin:0;
        font-family: var(--sans);
        color: var(--text);

        /* Single, clean, non-repeating background */
        background: linear-gradient(180deg, var(--bgTop) 0%, var(--bgBottom) 70%);
        background-repeat: no-repeat;
        background-attachment: fixed;
        overflow-x:hidden;
      }

      .wrap{
        width:min(1200px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 26px 0 48px;
      }

      .top{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:16px;
        padding: 18px 18px 0;
      }

      .brandline{
        display:flex;
        align-items:center;
        gap:12px;
      }

      .logo{
        width:42px;height:42px;
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(124,92,255,.95), rgba(53,208,255,.95));
        box-shadow: var(--shadow2);
        position:relative;
      }
      .logo:after{
        content:"";
        position:absolute; inset: 10px 12px 12px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.24);
        background: rgba(0,0,0,.08);
      }

      h1{
        margin:0;
        font-size: clamp(20px, 3.2vw, 30px);
        letter-spacing:.2px;
        line-height:1.15;
      }
      .subtitle{
        margin:6px 0 0;
        color: var(--muted);
        max-width: 72ch;
        font-size: 14px;
      }

      .chip{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.03);
        color: var(--muted);
        font-size: 12px;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }

      .card{
        margin-top: 16px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        background: rgba(255,255,255,.03);
        box-shadow: var(--shadow);
        overflow:hidden;
      }

      .toolbar{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding: 16px 16px 12px;
        border-bottom: 1px solid rgba(140,160,255,.14);
        background: rgba(0,0,0,.10);
        flex-wrap:wrap;
      }

      .lefttools{
        display:flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
      }

      .btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:8px;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(255,255,255,.04);
        color: var(--text);
        cursor:pointer;
        transition: transform .08s ease, background .16s ease, border-color .16s ease;
        user-select:none;
        min-height: 40px;
      }
      .btn:hover{ transform: translateY(-1px); background: rgba(255,255,255,.06); border-color: rgba(140,160,255,.26); }
      .btn:active{ transform: translateY(0px); }

      .toggle{
        display:flex;
        align-items:center;
        gap:10px;
        padding: 9px 11px;
        border-radius: 12px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(10,16,48,.35);
        min-height: 40px;
      }
      .toggle small{ color: var(--muted2); }

      .switch{
        width: 46px; height: 26px;
        border-radius: 999px;
        border: 1px solid rgba(140,160,255,.20);
        background: rgba(255,255,255,.06);
        position:relative;
        cursor:pointer;
        flex: 0 0 auto;
      }
      .knob{
        position:absolute; top: 3px; left: 3px;
        width: 20px; height: 20px; border-radius: 999px;
        background: rgba(255,255,255,.85);
        box-shadow: 0 8px 16px rgba(0,0,0,.35);
        transition: transform .16s ease, background .16s ease;
      }
      .switch.on{
        background: rgba(53,208,255,.18);
        border-color: rgba(53,208,255,.35);
      }
      .switch.on .knob{ transform: translateX(20px); background: #EAF0FF; }

      .rightmeta{
        display:flex;
        align-items:center;
        gap:10px;
        color: var(--muted2);
        font-size: 12px;
      }
      .pill{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(255,255,255,.03);
        font-size: 12px;
        color: var(--muted);
      }

      .tablewrap{
        overflow:auto;
        background: rgba(0,0,0,.08);
      }

      table{
        width:100%;
        min-width: 980px;
        border-collapse: collapse;
        font-size: 13px;
      }
      thead th{
        position: sticky;
        top: 0;
        z-index: 2;
        text-align:left;
        font-weight: 650;
        color: rgba(167,179,214,.92);
        background: rgba(11,18,48,.92);
        border-bottom: 1px solid rgba(140,160,255,.16);
        padding: 12px 12px;
        white-space: nowrap;
      }
      tbody td{
        border-bottom: 1px solid rgba(140,160,255,.10);
        padding: 12px 12px;
        vertical-align: top;
        color: rgba(234,240,255,.92);
      }
      tbody tr:hover td{ background: rgba(255,255,255,.02); }

      .statusPill{
        display:inline-flex;
        align-items:center;
        gap:8px;
        border-radius: 999px;
        padding: 4px 9px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(255,255,255,.03);
        text-transform: uppercase;
        letter-spacing: .06em;
        font-size: 11px;
      }
      .statusPill .sDot{ width:8px;height:8px;border-radius:999px; }
      .statusPill.done .sDot{ background: var(--ok); }
      .statusPill.failed .sDot{ background: var(--bad); }
      .statusPill.pending .sDot{ background: var(--warn); }

      .mono{ font-family: var(--mono); font-size: 12px; color: rgba(234,240,255,.86); }
      .muted{ color: var(--muted2); }

      details{
        border-radius: 12px;
        border: 1px solid rgba(140,160,255,.14);
        background: rgba(255,255,255,.02);
        padding: 8px 10px;
      }
      summary{
        cursor:pointer;
        color: rgba(167,179,214,.95);
        list-style:none;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }
      summary::-webkit-details-marker{ display:none; }
      .snippet{
        max-width: 480px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: rgba(234,240,255,.88);
      }
      .full{
        margin-top: 10px;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
        color: rgba(234,240,255,.92);
        max-height: 280px;
        overflow:auto;
        padding-right: 6px;
      }
      .copy{
        border-radius: 10px;
        padding: 7px 9px;
        border: 1px solid rgba(140,160,255,.16);
        background: rgba(255,255,255,.03);
        color: var(--text);
        cursor:pointer;
        font-size: 12px;
        flex: 0 0 auto;
      }
      .copy:hover{ background: rgba(255,255,255,.06); }

      .smsBtn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius: 10px;
        padding: 6px 10px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(255,255,255,.04);
        color: var(--text);
        text-decoration:none;
        font-size: 12px;
        font-weight: 650;
        white-space: nowrap;
      }
      .smsBtn:hover{ background: rgba(255,255,255,.08); }
      .smsBtn.ready{
        border-color: rgba(53,224,138,.45);
        background: rgba(53,224,138,.18);
        color: #D9FFE9;
      }
      .smsBtn.missing{
        border-color: rgba(255,92,122,.45);
        background: rgba(255,92,122,.16);
        color: #FFD9E1;
      }

      .retryBtn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius: 10px;
        padding: 6px 10px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(255,255,255,.04);
        color: var(--text);
        text-decoration:none;
        font-size: 12px;
        font-weight: 650;
        white-space: nowrap;
        margin-left: 8px;
      }
      .retryBtn.ready{
        border-color: rgba(255,211,77,.45);
        background: rgba(255,211,77,.16);
        color: #FFF4C7;
      }
      .retryBtn[disabled]{
        opacity: .6;
        cursor: not-allowed;
      }

      /* Mobile cards */
      .cards{
        display:none;
        padding: 12px 12px 16px;
        background: rgba(0,0,0,.08);
      }
      .runCard{
        border-radius: var(--radius2);
        border: 1px solid rgba(140,160,255,.14);
        background: rgba(255,255,255,.03);
        padding: 12px;
        box-shadow: 0 10px 22px rgba(0,0,0,.25);
      }
      .runCard + .runCard{ margin-top: 10px; }
      .runHead{
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:10px;
      }
      .runHead .time{ font-weight: 700; }
      .grid2{
        margin-top: 10px;
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .kv{
        border-radius: 12px;
        border: 1px solid rgba(140,160,255,.12);
        background: rgba(0,0,0,.12);
        padding: 10px;
      }
      .kv span{ display:block; color: var(--muted2); font-size: 12px; }
      .kv b{ display:block; margin-top: 4px; font-size: 13px; }

      .foot{
        padding: 14px 16px 16px;
        color: rgba(167,179,214,.75);
        font-size: 12px;
        border-top: 1px solid rgba(140,160,255,.12);
        background: rgba(0,0,0,.10);
      }

      @media (max-width: 720px){
        .wrap{ width: min(1200px, calc(100% - 1.2rem)); }
        .top{ padding: 14px 12px 0; }
        table{ display:none; }
        .cards{ display:block; }
        .grid2{ grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div>
          <div class="brandline">
            <div class="logo" aria-hidden="true"></div>
            <div>
              <h1>GIANT FM AC/DC Decoder — Public History</h1>
              <p class="subtitle">Read-only history. Tap to expand transcripts, decoded summaries, and errors.</p>
            </div>
          </div>
        </div>

      </div>

      <section class="card" aria-label="Public history">
        <div class="toolbar">
          <div class="lefttools">
            <div class="toggle" title="Auto-refresh runs list">
              <div>
                <div style="font-weight:650; font-size:13px;">Auto-refresh</div>
                <small id="autotxt">Off</small>
              </div>
              <div id="autoswitch" class="switch" role="switch" aria-checked="false" tabindex="0">
                <div class="knob"></div>
              </div>
            </div>

            <button id="refresh" class="btn">Refresh now</button>
          </div>

          <div class="rightmeta">
            <span class="pill">Updated: <span id="updated" class="mono" style="margin-left:8px">—</span></span>
            <span id="msg" class="muted">—</span>
          </div>
        </div>

        <div class="tablewrap">
          <table aria-label="Run history table">
            <thead>
              <tr>
                <th>Time (Toronto)</th>
                <th>Status</th>
                <th>Duration (s)</th>
                <th>Transcript</th>
                <th>Decoded Summary</th>
                <th>Likely AC/DC Ref</th>
                <th>SMS</th>
                <th>Error</th>
                <th>Logs</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>

          <div id="cards" class="cards" aria-label="Run history cards (mobile)"></div>
        </div>

        <div class="foot">
          Tip: tap any long cell to expand. Errors and logs include full details for debugging.
        </div>
      </section>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);

      const state = {
        runs: [],
        auto: false,
        timer: null,
      };
      const SMS_TARGET_NUMBER = '9057326917';
      const retryingRuns = new Set();

      const rowsEl = $("rows");
      const cardsEl = $("cards");
      const msgEl = $("msg");
      const updatedEl = $("updated");
      const refreshBtn = $("refresh");

      const autoSwitch = $("autoswitch");
      const autoTxt = $("autotxt");

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function normalizeStatus(s){
        const v = (s || '').toLowerCase();
        if (v === 'done') return 'done';
        if (v === 'failed') return 'failed';
        return 'pending';
      }

      function statusPill(status){
        const cls = normalizeStatus(status);
        const label = (status || 'pending');
        return '<span class="statusPill ' + cls + '"><span class="sDot"></span>' + escapeHtml(label) + '</span>';
      }

      function detailsCell(title, value, emptyLabel){
        const text = String(value || '');
        if (!text.trim()) return '<span class="muted">' + escapeHtml(emptyLabel || '') + '</span>';

        const snippet = text.replace(/\\s+/g, ' ').trim().slice(0, 160);
        const safe = escapeHtml(text);
        const safeSnippet = escapeHtml(snippet);

        const id = 'c_' + Math.random().toString(16).slice(2);

        return '<details>' +
          '<summary>' +
            '<span class="snippet" title="' + escapeHtml(title) + '">' + safeSnippet + (text.length > snippet.length ? '…' : '') + '</span>' +
            '<button class="copy" type="button" data-copy="' + id + '">Copy</button>' +
          '</summary>' +
          '<div id="' + id + '" class="full">' + safe + '</div>' +
        '</details>';
      }

      function isUnknown(value){
        return String(value || '').trim().toUpperCase() === 'UNKNOWN';
      }

      function shouldHighlightRetry(run){
        return String(run.status || '').toLowerCase() === 'done' && isUnknown(run.likely_acdc_reference);
      }

      function smsAction(run){
        const sourceText = String(run.likely_acdc_reference || '').trim();
        if (!sourceText || isUnknown(sourceText)) {
          return '<span class="smsBtn missing" aria-disabled="true">SMS Result</span>';
        }

        const href = 'sms:' + SMS_TARGET_NUMBER + '?body=' + encodeURIComponent(sourceText);
        return '<a class="smsBtn ready" href="' + escapeHtml(href) + '">SMS Result</a>';
      }

      function retryAction(run){
        const id = String(run.id || '');
        if (!id) return '';

        const active = shouldHighlightRetry(run) && !retryingRuns.has(id);
        if (!active) {
          return '<button class="retryBtn" type="button" disabled>Retry OTC</button>';
        }

        return '<button class="retryBtn ready" type="button" data-retry="' + escapeHtml(id) + '">Retry OTC</button>';
      }

      function row(run){
        return '<tr>' +
          '<td class="mono">' + escapeHtml(run.created_at_toronto || '') + '</td>' +
          '<td>' + statusPill(run.status) + '</td>' +
          '<td class="mono">' + escapeHtml(run.duration_seconds ?? '') + '</td>' +
          '<td>' + detailsCell('Transcript', run.transcript, '—') + '</td>' +
          '<td>' + detailsCell('Decoded Summary', run.decoded_summary, '—') + '</td>' +
          '<td>' + escapeHtml(run.likely_acdc_reference || '') + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + smsAction(run) + retryAction(run) + '</div></td>' +
          '<td>' + detailsCell('Error', run.error, '—') + '</td>' +
          '<td>' + detailsCell('Logs', run.run_logs, '—') + '</td>' +
        '</tr>';
      }

      function card(run){
        const ref = (run.likely_acdc_reference || '').trim() || '—';
        const dur = (run.duration_seconds ?? '') === '' ? '—' : String(run.duration_seconds);

        return '<div class="runCard">' +
          '<div class="runHead">' +
            '<div>' +
              '<div class="time mono">' + escapeHtml(run.created_at_toronto || '') + '</div>' +
              '<div style="margin-top:8px;">' + statusPill(run.status) + '</div>' +
            '</div>' +
          '</div>' +

          '<div class="grid2">' +
            '<div class="kv"><span>Duration (s)</span><b class="mono">' + escapeHtml(dur) + '</b></div>' +
            '<div class="kv"><span>Likely AC/DC Ref</span><b>' + escapeHtml(ref) + '</b></div>' +
          '</div>' +

          '<div style="margin-top:10px;">' + detailsCell('Transcript', run.transcript, 'Transcript: —') + '</div>' +
          '<div style="margin-top:10px;">' + detailsCell('Decoded Summary', run.decoded_summary, 'Decoded: —') + '</div>' +
          '<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + smsAction(run) + retryAction(run) + '</div>' +
          '<div style="margin-top:10px;">' + detailsCell('Error', run.error, 'Error: —') + '</div>' +
          '<div style="margin-top:10px;">' + detailsCell('Logs', run.run_logs, 'Logs: —') + '</div>' +
        '</div>';
      }

      function render(){
        const runs = state.runs.slice().sort((a,b) => {
          const ta = String(a.created_at_toronto || '');
          const tb = String(b.created_at_toronto || '');
          return tb.localeCompare(ta);
        });

        rowsEl.innerHTML = runs.map(row).join('');
        cardsEl.innerHTML = runs.map(card).join('');

        // attach copy handlers
        document.querySelectorAll('[data-copy]').forEach(btn => {
          if (btn.__wired) return;
          btn.__wired = true;
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-copy');
            const el = document.getElementById(id);
            if (!el) return;
            try{
              await navigator.clipboard.writeText(el.textContent || '');
              btn.textContent = 'Copied';
              setTimeout(() => btn.textContent = 'Copy', 900);
            }catch{
              btn.textContent = 'No clipboard';
              setTimeout(() => btn.textContent = 'Copy', 900);
            }
          });
        });

        document.querySelectorAll('[data-retry]').forEach(btn => {
          if (btn.__wiredRetry) return;
          btn.__wiredRetry = true;
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const id = btn.getAttribute('data-retry');
            if (!id || retryingRuns.has(id)) return;

            retryingRuns.add(id);
            btn.setAttribute('disabled', 'disabled');
            const originalText = btn.textContent;
            btn.textContent = 'Retrying...';

            try {
              const res = await fetch('/runs/' + encodeURIComponent(id) + '/retry', { method: 'POST' });
              if (!res.ok) {
                throw new Error(await res.text());
              }
              await fetchRuns();
            } catch (err) {
              console.error(err);
              msgEl.textContent = 'Retry failed';
              retryingRuns.delete(id);
              btn.removeAttribute('disabled');
              btn.textContent = originalText || 'Retry OTC';
            }
          });
        });

        msgEl.textContent = runs.length ? (runs.length + ' runs') : 'No runs';
      }

      function nowStamp(){
        const d = new Date();
        return d.toLocaleString(undefined, { hour12: true });
      }

      async function fetchRuns(){
        try{
          msgEl.textContent = 'Loading…';
          const res = await fetch('/runs', { cache: 'no-store' });
          if (!res.ok) throw new Error(await res.text());
          const runs = await res.json();
          state.runs = Array.isArray(runs) ? runs : [];
          updatedEl.textContent = nowStamp();
          render();
        }catch(err){
          console.error(err);
          updatedEl.textContent = nowStamp();
          msgEl.textContent = 'Fetch failed';
        }
      }

      function setAuto(on){
        state.auto = on;
        autoSwitch.classList.toggle('on', on);
        autoSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
        autoTxt.textContent = on ? 'Every 10s' : 'Off';

        if (state.timer) clearInterval(state.timer);
        state.timer = null;

        if (on){
          state.timer = setInterval(fetchRuns, 10000);
        }
      }

      refreshBtn.addEventListener('click', fetchRuns);

      function toggleAuto(){ setAuto(!state.auto); }
      autoSwitch.addEventListener('click', toggleAuto);
      autoSwitch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAuto(); }
      });

      fetchRuns();
      setAuto(false);
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

app.post('/runs/:id/retry', async (req, res) => {
  const id = z.string().parse(req.params.id);
  const run = await db.getRun(id);

  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const transcript = String(run.transcript || '').trim();
  if (!transcript) {
    return res.status(400).json({ error: 'Cannot retry without transcript' });
  }

  const retryLogs: string[] = [];
  const addRetryLog = (message: string): void => {
    const line = `[${new Date().toISOString()}] [RETRY] ${message}`;
    retryLogs.push(line);
    console.log(`[run:${id}] ${message}`);
  };

  try {
    addRetryLog('Manual retry requested.');
    await db.updateRun(id, { status: 'running' });
    const { decodedSummary, likely, confidence, errorNote, analysisLogs } = await analyzeExistingTranscript(transcript);
    for (const line of analysisLogs) {
      addRetryLog(line);
    }

    let finalError = errorNote;
    if (String(likely || '').trim().toUpperCase() === 'UNKNOWN') {
      const unknownMessage =
        'Retry completed but final likely AC/DC reference is still UNKNOWN. Check transcript/logs and consider increasing recording duration or improving source audio quality.';
      finalError = finalError ? `${finalError} | ${unknownMessage}` : unknownMessage;
      addRetryLog(unknownMessage);
    }

    await db.updateRun(id, {
      status: 'done',
      decoded_summary: decodedSummary,
      likely_acdc_reference: likely,
      confidence,
      error: finalError,
      run_logs: [String(run.run_logs || '').trim(), retryLogs.join('\n')].filter(Boolean).join('\n')
    });

    const updated = await db.getRun(id);
    if (!updated) {
      return res.status(500).json({ error: 'Run updated but not found' });
    }

    return res.json(withToronto(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addRetryLog(`Retry failed: ${message}`);
    await db.updateRun(id, {
      status: 'failed',
      error: message,
      run_logs: [String(run.run_logs || '').trim(), retryLogs.join('\n')].filter(Boolean).join('\n')
    });
    return res.status(500).json({ error: message || 'Retry failed' });
  }
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
