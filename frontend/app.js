const CONFIG_STORAGE_KEY = 'radio-scrapper-ui-config';

const runBtn = document.getElementById('run-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const refreshBtn = document.getElementById('refresh-btn');
const runsBody = document.getElementById('runs-body');
const statusLine = document.getElementById('status-line');
const apiBaseInput = document.getElementById('api-base');
const apiKeyInput = document.getElementById('api-key');

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

function getConfig() {
  return {
    apiBase: apiBaseInput.value.trim().replace(/\/$/, ''),
    apiKey: apiKeyInput.value.trim()
  };
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('error', isError);
}

function ensureConfigured() {
  const { apiBase, apiKey } = getConfig();
  if (!apiBase) throw new Error('Set Railway API URL first.');
  if (!apiKey) throw new Error('Set API key first.');
  return { apiBase, apiKey };
}

function truncateWithToggle(text, max = 180) {
  if (!text) return '';
  if (text.length <= max) return text;

  const short = text.slice(0, max) + '…';
  return `<span class="truncated" data-full="${encodeURIComponent(text)}">${short}</span><button class="expand">expand</button>`;
}

function renderStatus(status) {
  const cls = ['done', 'failed'].includes(status) ? status : '';
  return `<span class="pill ${cls}">${status}</span>`;
}

function runRow(run) {
  return `
    <tr data-id="${run.id}">
      <td>${run.created_at_toronto || ''}</td>
      <td>${renderStatus(run.status)}</td>
      <td>${run.duration_seconds ?? ''}</td>
      <td class="long-text">${truncateWithToggle(run.transcript || '')}</td>
      <td class="long-text">${truncateWithToggle(run.decoded_summary || '')}</td>
      <td>${run.likely_acdc_reference || ''}</td>
      <td>${run.confidence ?? ''}</td>
      <td>${run.error || ''}</td>
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
  const res = await apiFetch('/runs');
  const runs = await res.json();
  runsBody.innerHTML = runs.map(runRow).join('');
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

saveConfigBtn.addEventListener('click', () => {
  const config = getConfig();
  saveConfig(config);
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
    saveConfig(getConfig());

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
    const finalRun = await pollUntilDone(payload.id);
    setStatus(`Run ${payload.id} finished with status: ${finalRun.status}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    runBtn.disabled = false;
  }
});

runsBody.addEventListener('click', (event) => {
  const btn = event.target.closest('.expand');
  if (!btn) return;

  const span = btn.previousElementSibling;
  if (!span || !span.classList.contains('truncated')) return;

  const full = decodeURIComponent(span.dataset.full || '');
  if (btn.textContent === 'expand') {
    span.textContent = full;
    btn.textContent = 'collapse';
  } else {
    span.textContent = full.slice(0, 180) + '…';
    btn.textContent = 'expand';
  }
});

(function bootstrap() {
  const config = loadConfig();
  apiBaseInput.value = config.apiBase;
  apiKeyInput.value = config.apiKey;

  if (config.apiBase) {
    fetchRuns()
      .then(() => setStatus('Ready.'))
      .catch((error) => setStatus(`Failed to load runs: ${error.message}`, true));
  } else {
    setStatus('Enter Railway API URL and API key, then click Save settings.');
  }
})();
