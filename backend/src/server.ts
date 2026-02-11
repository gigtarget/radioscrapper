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
    <title>GIANT FM Decoder — Public History</title>
    <meta name="description" content="Read-only public run history for GIANT FM AC/DC Decoder." />
    <style>
      :root{
        color-scheme: dark;
        --bg0:#070A12;
        --bg1:#0A1030;
        --card:#0E1636;
        --card2:#0B1230;
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
        background:
          radial-gradient(900px 450px at 15% -10%, rgba(124,92,255,.35) 0%, transparent 60%),
          radial-gradient(900px 450px at 85% 10%, rgba(53,208,255,.22) 0%, transparent 65%),
          linear-gradient(180deg, var(--bg1), var(--bg0) 55%);
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
        background:
          radial-gradient(14px 14px at 30% 30%, rgba(255,255,255,.22) 0%, transparent 55%),
          linear-gradient(135deg, rgba(124,92,255,.95), rgba(53,208,255,.95));
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

      .chiprow{
        display:flex;
        flex-wrap:wrap;
        gap:10px;
        margin-top: 12px;
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
      .dot{
        width:8px;height:8px;border-radius:999px;
        background: rgba(255,255,255,.25);
      }
      .dot.ok{ background: var(--ok); }
      .dot.bad{ background: var(--bad); }
      .dot.warn{ background: var(--warn); }

      .card{
        margin-top: 16px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        background:
          radial-gradient(700px 220px at 10% 0%, rgba(124,92,255,.16) 0%, transparent 60%),
          linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
        box-shadow: var(--shadow);
        overflow:hidden;
      }

      .toolbar{
        display:grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        padding: 16px 16px 12px;
        border-bottom: 1px solid rgba(140,160,255,.14);
        background: rgba(0,0,0,.10);
      }

      .controls{
        display:grid;
        grid-template-columns: 1.4fr .7fr .7fr;
        gap: 10px;
      }

      .field{
        display:grid;
        gap: 6px;
      }
      .label{
        color: var(--muted2);
        font-size: 12px;
      }
      input, select, button{
        font: inherit;
      }
      input, select{
        width:100%;
        border-radius: 12px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(10,16,48,.55);
        color: var(--text);
        padding: 10px 11px;
        outline: none;
      }
      input::placeholder{ color: rgba(167,179,214,.6); }
      input:focus, select:focus{ border-color: rgba(124,92,255,.55); box-shadow: 0 0 0 3px rgba(124,92,255,.15); }

      .actions{
        display:flex;
        gap:10px;
        align-items:end;
        justify-content:flex-end;
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
      .btn.primary{
        background: linear-gradient(135deg, rgba(124,92,255,.95), rgba(53,208,255,.85));
        border-color: rgba(255,255,255,.18);
      }

      .toggle{
        display:flex;
        align-items:center;
        gap:10px;
        padding: 9px 11px;
        border-radius: 12px;
        border: 1px solid rgba(140,160,255,.18);
        background: rgba(10,16,48,.55);
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

      .meta{
        display:flex;
        justify-content:space-between;
        gap:12px;
        flex-wrap:wrap;
        padding: 12px 16px 14px;
        background: rgba(0,0,0,.08);
        border-bottom: 1px solid rgba(140,160,255,.14);
      }
      .stats{
        display:flex;
        gap:10px;
        flex-wrap:wrap;
      }
      .stat{
        padding: 8px 10px;
        border-radius: 14px;
        border: 1px solid rgba(140,160,255,.14);
        background: rgba(255,255,255,.03);
        min-width: 120px;
      }
      .stat b{ display:block; font-size: 14px; }
      .stat span{ display:block; color: var(--muted2); font-size: 12px; margin-top: 2px; }

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

      /* Desktop table */
      .tablewrap{
        overflow:auto;
        background: rgba(8,12,30,.55);
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
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
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
      tbody tr:hover td{
        background: rgba(255,255,255,.02);
      }

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

      .conf{
        display:grid;
        gap:6px;
        min-width: 120px;
      }
      .bar{
        height: 8px;
        border-radius: 999px;
        background: rgba(255,255,255,.06);
        overflow:hidden;
        border: 1px solid rgba(140,160,255,.14);
      }
      .bar > i{
        display:block;
        height:100%;
        width:0%;
        background: linear-gradient(90deg, rgba(124,92,255,.95), rgba(53,208,255,.95));
      }
      .conf small{ color: rgba(167,179,214,.92); }

      /* Mobile cards */
      .cards{
        display:none;
        padding: 12px 12px 16px;
        background: rgba(8,12,30,.55);
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

      @media (max-width: 980px){
        .toolbar{ grid-template-columns: 1fr; }
        .actions{ justify-content:flex-start; }
      }

      @media (max-width: 720px){
        .wrap{ width: min(1200px, calc(100% - 1.2rem)); }
        .top{ padding: 14px 12px 0; }
        .controls{ grid-template-columns: 1fr; }
        table{ display:none; }
        .cards{ display:block; }
        .meta{ padding: 12px; }
        .stat{ min-width: 46%; }
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
              <p class="subtitle">Read-only history. Auto-refresh available. Search, filter, and export runs.</p>
              <div class="chiprow">
                <div class="chip"><span class="dot ok"></span> Live from /runs</div>
                <div class="chip"><span class="dot warn"></span> Refreshable</div>
                <div class="chip"><span class="dot bad"></span> Errors shown with full detail</div>
              </div>
            </div>
          </div>
        </div>

        <div class="chip" title="This page cannot trigger runs.">
          <span class="dot"></span>
          Read-only
        </div>
      </div>

      <section class="card" aria-label="Public history">
        <div class="toolbar">
          <div class="controls">
            <div class="field">
              <div class="label">Search (transcript / decoded / error / ref)</div>
              <input id="q" type="search" placeholder="e.g. ACDC, keyword, error 400, Toronto, etc." />
            </div>
            <div class="field">
              <div class="label">Status</div>
              <select id="status">
                <option value="">All</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div class="field">
              <div class="label">Sort</div>
              <select id="sort">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          <div class="actions">
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
            <button id="csv" class="btn">Export CSV</button>
            <button id="clear" class="btn">Clear filters</button>
            <button id="topbtn" class="btn primary" title="Jump to top">Top</button>
          </div>
        </div>

        <div class="meta">
          <div class="stats">
            <div class="stat"><b id="st_total">0</b><span>Total runs</span></div>
            <div class="stat"><b id="st_done">0</b><span>Done</span></div>
            <div class="stat"><b id="st_failed">0</b><span>Failed</span></div>
            <div class="stat"><b id="st_pending">0</b><span>Pending</span></div>
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
                <th>Confidence</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>

          <div id="cards" class="cards" aria-label="Run history cards (mobile)"></div>
        </div>

        <div class="foot">
          Tips: tap any long cell to expand. Use search + status filter to quickly spot failures (example: “Unsupported parameter”).
        </div>
      </section>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);

      const state = {
        runs: [],
        filtered: [],
        auto: false,
        timer: null,
      };

      const rowsEl = $("rows");
      const cardsEl = $("cards");
      const msgEl = $("msg");
      const updatedEl = $("updated");
      const qEl = $("q");
      const statusEl = $("status");
      const sortEl = $("sort");
      const refreshBtn = $("refresh");
      const csvBtn = $("csv");
      const clearBtn = $("clear");
      const topBtn = $("topbtn");

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

      function confCell(c){
        const n = Number(c);
        const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100))) : null;
        const label = pct === null ? '—' : (pct + '%');
        const w = pct === null ? 0 : pct;
        return '<div class="conf">' +
          '<div class="bar" aria-label="Confidence"><i style="width:' + w + '%"></i></div>' +
          '<small>' + escapeHtml(label) + '</small>' +
        '</div>';
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

      function row(run){
        return '<tr>' +
          '<td class="mono">' + escapeHtml(run.created_at_toronto || '') + '</td>' +
          '<td>' + statusPill(run.status) + '</td>' +
          '<td class="mono">' + escapeHtml(run.duration_seconds ?? '') + '</td>' +
          '<td>' + detailsCell('Transcript', run.transcript, '—') + '</td>' +
          '<td>' + detailsCell('Decoded Summary', run.decoded_summary, '—') + '</td>' +
          '<td>' + escapeHtml(run.likely_acdc_reference || '') + '</td>' +
          '<td>' + confCell(run.confidence) + '</td>' +
          '<td>' + detailsCell('Error', run.error, '—') + '</td>' +
        '</tr>';
      }

      function card(run){
        const cls = normalizeStatus(run.status);
        const ref = (run.likely_acdc_reference || '').trim() || '—';
        const dur = (run.duration_seconds ?? '') === '' ? '—' : String(run.duration_seconds);
        const conf = Number(run.confidence);
        const pct = Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf * 100))) : null;

        return '<div class="runCard">' +
          '<div class="runHead">' +
            '<div>' +
              '<div class="time mono">' + escapeHtml(run.created_at_toronto || '') + '</div>' +
              '<div style="margin-top:8px;">' + statusPill(run.status) + '</div>' +
            '</div>' +
            '<div style="min-width:120px;">' + confCell(run.confidence) + '</div>' +
          '</div>' +

          '<div class="grid2">' +
            '<div class="kv"><span>Duration (s)</span><b class="mono">' + escapeHtml(dur) + '</b></div>' +
            '<div class="kv"><span>Likely AC/DC Ref</span><b>' + escapeHtml(ref) + '</b></div>' +
          '</div>' +

          '<div style="margin-top:10px;">' + detailsCell('Transcript', run.transcript, 'Transcript: —') + '</div>' +
          '<div style="margin-top:10px;">' + detailsCell('Decoded Summary', run.decoded_summary, 'Decoded: —') + '</div>' +
          '<div style="margin-top:10px;">' + detailsCell('Error', run.error, 'Error: —') + '</div>' +
        '</div>';
      }

      function applyFilters(){
        const q = (qEl.value || '').trim().toLowerCase();
        const st = (statusEl.value || '').trim().toLowerCase();
        const sort = sortEl.value || 'newest';

        let list = state.runs.slice();

        if (st){
          list = list.filter(r => normalizeStatus(r.status) === st);
        }

        if (q){
          list = list.filter(r => {
            const blob = [
              r.created_at_toronto,
              r.status,
              r.transcript,
              r.decoded_summary,
              r.likely_acdc_reference,
              r.error
            ].join(' ').toLowerCase();
            return blob.includes(q);
          });
        }

        list.sort((a,b) => {
          const ta = String(a.created_at_toronto || '');
          const tb = String(b.created_at_toronto || '');
          if (sort === 'oldest') return ta.localeCompare(tb);
          return tb.localeCompare(ta);
        });

        state.filtered = list;
      }

      function render(){
        applyFilters();

        const runs = state.filtered;

        rowsEl.innerHTML = runs.map(row).join('');
        cardsEl.innerHTML = runs.map(card).join('');

        // stats from full dataset (not filtered)
        const all = state.runs;
        const done = all.filter(r => normalizeStatus(r.status) === 'done').length;
        const failed = all.filter(r => normalizeStatus(r.status) === 'failed').length;
        const pending = all.length - done - failed;

        $("st_total").textContent = String(all.length);
        $("st_done").textContent = String(done);
        $("st_failed").textContent = String(failed);
        $("st_pending").textContent = String(pending);

        // attach copy handlers (event delegation)
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

        msgEl.textContent = runs.length ? (runs.length + ' shown') : 'No matches';
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

      // UI events
      qEl.addEventListener('input', () => render());
      statusEl.addEventListener('change', () => render());
      sortEl.addEventListener('change', () => render());

      refreshBtn.addEventListener('click', fetchRuns);
      clearBtn.addEventListener('click', () => {
        qEl.value = '';
        statusEl.value = '';
        sortEl.value = 'newest';
        render();
      });

      csvBtn.addEventListener('click', () => {
        const rows = state.filtered.length ? state.filtered : state.runs;
        const cols = [
          'created_at_toronto','status','duration_seconds','transcript','decoded_summary',
          'likely_acdc_reference','confidence','error'
        ];
        const esc = (v) => {
          const s = String(v ?? '');
          if (/["\\n,]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
          return s;
        };
        const csv = [cols.join(',')].concat(
          rows.map(r => cols.map(c => esc(r[c])).join(','))
        ).join('\\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'giantfm_runs.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });

      topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

      function toggleAuto(){
        setAuto(!state.auto);
      }
      autoSwitch.addEventListener('click', toggleAuto);
      autoSwitch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAuto(); }
      });

      // boot
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
