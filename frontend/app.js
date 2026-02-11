const CONFIG_STORAGE_KEY = 'radio-scrapper-ui-config';

const runBtn = document.getElementById('run-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const refreshBtn = document.getElementById('refresh-btn');
const runsBody = document.getElementById('runs-body');
const statusLine = document.getElementById('status-line');
const apiBaseInput = document.getElementById('api-base');
const apiKeyInput = document.getElementById('api-key');
const publicLink = document.getElementById('public-link');
const SMS_TARGET_NUMBER = '9050505056';

function loadConfig() {
  const defaults = { apiBase: '', apiKey: '' };
  const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!saved) return defaults;

  try {
    return { ...defaults, ...JSON.parse(saved) };
  } catch {
    return defaults;
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function normalizeApiBase(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function getConfig() {
  return {
    apiBase: normalizeApiBase(apiBaseInput.value),
    apiKey: apiKeyInput.value.trim()
  };
}

function updatePublicLink(apiBase) {
  if (!publicLink) return;
  if (apiBase) {
    publicLink.href = `${apiBase}/public`;
    publicLink.textContent = 'Public history page (no run button)';
    publicLink.style.display = 'inline';
  } else {
    publicLink.removeAttribute('href');
    publicLink.textContent = 'Public history page (no run button)';
    publicLink.style.display = 'none';
  }
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('error', isError);
}

function ensureConfigured() {
  const { apiBase, apiKey } = getConfig();
  if (!apiBase) throw new Error('Set Railway API URL first.');
  if (!/^https?:\/\//i.test(apiBase)) {
    throw new Error(
      'Railway API URL must start with https:// (example: https://radioscrapper-production.up.railway.app)'
    );
  }
  if (!apiKey) throw new Error('Set API key first.');
  return { apiBase, apiKey };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function buildSmsLink(run) {
  const sourceText = (run.decoded_summary || run.transcript || '').trim();
  if (!sourceText) return '';

  const message = `AI Result: ${sourceText}`;
  return `sms:${SMS_TARGET_NUMBER}?&body=${encodeURIComponent(message)}`;
}

function renderSmsAction(run) {
  const smsLink = buildSmsLink(run);
  if (!smsLink) return '<span class="muted-cell">No result</span>';

  return `<a class="btn ghost sms-btn" href="${escapeHtml(smsLink)}">SMS Result</a>`;
}

function renderStatus(status) {
  const normalized = (status || '').toLowerCase();
  let cls = 'pending';

  if (normalized === 'done') cls = 'done';
  else if (normalized === 'failed') cls = 'failed';

  return `<span class="pill ${cls}">${escapeHtml(status || 'pending')}</span>`;
}

function runRow(run) {
  return `
    <tr data-id="${escapeHtml(run.id)}">
      <td>${escapeHtml(run.created_at_toronto || '')}</td>
      <td>${renderStatus(run.status)}</td>
      <td>${run.duration_seconds ?? ''}</td>
      <td class="long-text">${escapeHtml(run.transcript || '')}</td>
      <td class="long-text">${escapeHtml(run.decoded_summary || '')}</td>
      <td>${escapeHtml(run.likely_acdc_reference || '')}</td>
      <td>${run.confidence ?? ''}</td>
      <td>${renderSmsAction(run)}</td>
      <td class="long-text">${escapeHtml(run.error || '')}</td>
    </tr>
  `;
}

async function apiFetch(path, init) {
  const { apiBase } = ensureConfigured();
  const res = await fetch(`${apiBase}${path}`, init);
  if (!res.ok) throw new Error(await res.text());
  return res;
}

async function fetchRuns() {
  try {
    const res = await apiFetch('/runs');
    const runs = await res.json();
    runsBody.innerHTML = runs.map(runRow).join('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('<!DOCTYPE html') || message.includes('<html')) {
      throw new Error('Looks like you hit GitHub Pages (HTML 404). Check Railway API URL includes https://');
    }
    throw error;
  }
}

async function fetchRun(id) {
  const res = await apiFetch(`/runs/${id}`);
  return res.json();
}

async function pollUntilDone(id) {
  for (;;) {
    const run = await fetchRun(id);
    await fetchRuns();
    if (run.status === 'done' || run.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

const pollWithDynamicStatus = pollUntilDone;

saveConfigBtn.addEventListener('click', () => {
  const config = getConfig();
  saveConfig(config);
  apiBaseInput.value = config.apiBase;
  updatePublicLink(config.apiBase);
  setStatus('Settings saved.');
});

refreshBtn.addEventListener('click', async () => {
  try {
    await fetchRuns();
    setStatus('History refreshed.');
  } catch (error) {
    setStatus(`Failed to refresh: ${error.message}`, true);
  }
});

runBtn.addEventListener('click', async () => {
  try {
    runBtn.disabled = true;
    const { apiKey } = ensureConfigured();
    const currentConfig = getConfig();
    saveConfig(currentConfig);
    updatePublicLink(currentConfig.apiBase);

    setStatus('Submitting run...');
    const res = await apiFetch('/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({})
    });

    const payload = await res.json();
    setStatus(`Run ${payload.id} queued. Polling...`);
    const finalRun = await pollWithDynamicStatus(payload.id);
    await fetchRuns();
    setStatus(`Run ${payload.id} finished with status: ${finalRun.status}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    runBtn.disabled = false;
  }
});

(function bootstrap() {
  const config = loadConfig();
  const normalizedApiBase = normalizeApiBase(config.apiBase);
  apiBaseInput.value = normalizedApiBase;
  apiKeyInput.value = config.apiKey;
  updatePublicLink(normalizedApiBase);

  if (normalizedApiBase) {
    fetchRuns()
      .then(() => setStatus('Ready.'))
      .catch((error) => setStatus(`Failed to load runs: ${error.message}`, true));
  } else {
    setStatus('Enter Railway API URL and API key, then click Save settings.');
  }
})();
