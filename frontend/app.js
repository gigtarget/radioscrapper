// Configure before publishing
const API_BASE = 'https://your-railway-app.up.railway.app';

const runBtn = document.getElementById('run-btn');
const runsBody = document.getElementById('runs-body');
const statusLine = document.getElementById('status-line');

function truncateWithToggle(text, max = 180) {
  if (!text) return '';
  if (text.length <= max) return text;

  const short = text.slice(0, max) + '…';
  return `<span class="truncated" data-full="${encodeURIComponent(text)}">${short}</span><button class="expand">expand</button>`;
}

function runRow(run) {
  return `
    <tr data-id="${run.id}">
      <td>${run.created_at_toronto}</td>
      <td>${run.status}</td>
      <td>${run.duration_seconds}</td>
      <td class="long-text">${truncateWithToggle(run.transcript || '')}</td>
      <td class="long-text">${truncateWithToggle(run.decoded_summary || '')}</td>
      <td>${run.likely_acdc_reference || ''}</td>
      <td>${run.confidence ?? ''}</td>
      <td>${run.error || ''}</td>
    </tr>
  `;
}

async function fetchRuns() {
  const res = await fetch(`${API_BASE}/runs`);
  if (!res.ok) throw new Error(await res.text());
  const runs = await res.json();
  runsBody.innerHTML = runs.map(runRow).join('');
}

async function fetchRun(id) {
  const res = await fetch(`${API_BASE}/runs/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function pollUntilDone(id) {
  for (;;) {
    const run = await fetchRun(id);
    await fetchRuns();
    if (run.status === 'done' || run.status === 'failed') return;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

runBtn.addEventListener('click', async () => {
  try {
    runBtn.disabled = true;
    statusLine.textContent = 'Submitting run...';
    const res = await fetch(`${API_BASE}/run`, { method: 'POST' });

    if (!res.ok) throw new Error(await res.text());
    const payload = await res.json();
    statusLine.textContent = `Run ${payload.run_id} queued. Polling...`;
    await pollUntilDone(payload.run_id);
    statusLine.textContent = `Run ${payload.run_id} finished.`;
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : String(error);
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

fetchRuns().catch((error) => {
  statusLine.textContent = `Failed to load runs: ${error.message}`;
});
