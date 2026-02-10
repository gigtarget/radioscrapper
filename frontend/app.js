const API_BASE = 'https://radioscrapper-production.up.railway.app';

const runBtn = document.getElementById('run-btn');
const refreshBtn = document.getElementById('refresh-btn');
const runsBody = document.getElementById('runs-body');
const statusLine = document.getElementById('status-line');
const statusEvents = document.getElementById('status-events');
const liveAudio = document.getElementById('live-audio');

let streamUrl = 'https://mybroadcasting.streamb.live/SB00329?_=252731';
let durationSeconds = 240;

function addStatusEvent(message, isError = false) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  if (isError) li.classList.add('error');

  for (const node of statusEvents.querySelectorAll('.latest')) {
    node.classList.remove('latest');
  }

  li.classList.add('latest');
  statusEvents.prepend(li);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function truncateWithToggle(text, max = 180) {
  if (!text) return '';
  if (text.length <= max) return text;

  const short = text.slice(0, max) + '…';
  return `<span class="truncated" data-full="${encodeURIComponent(text)}">${short}</span><button class="expand">expand</button>`;
}

function runRow(run) {
  return `
    <tr data-id="${run.id}">
      <td>${run.created_at_toronto || ''}</td>
      <td>${run.status}</td>
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
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(await res.text());
  return res;
}

async function fetchPublicConfig() {
  try {
    const res = await apiFetch('/public-config');
    const config = await res.json();
    streamUrl = config.stream_url || streamUrl;
    durationSeconds = Number(config.duration_seconds || durationSeconds);
    addStatusEvent('Connected to backend config.');
  } catch (error) {
    addStatusEvent(`Failed to load backend config: ${error.message}`, true);
  }
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

function setLiveAudioPlaying() {
  liveAudio.src = streamUrl;
  liveAudio
    .play()
    .then(() => addStatusEvent('Live stream playback started.'))
    .catch(() => addStatusEvent('Autoplay blocked by browser. Click play on the audio control.'));
}

function stopLiveAudio() {
  liveAudio.pause();
  liveAudio.removeAttribute('src');
  liveAudio.load();
}

async function pollWithDynamicStatus(id) {
  const startedAt = Date.now();
  let lastSeen = '';

  for (;;) {
    const run = await fetchRun(id);
    await fetchRuns();

    if (run.status !== lastSeen) {
      lastSeen = run.status;
      if (run.status === 'queued') addStatusEvent('Run is queued. Waiting for worker...');
      if (run.status === 'running') addStatusEvent('Recording in progress...');
      if (run.status === 'done') addStatusEvent('Run finished successfully.');
      if (run.status === 'failed') addStatusEvent(`Run failed: ${run.error || 'Unknown error'}`, true);
    }

    if (run.status === 'running') {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remaining = Math.max(0, durationSeconds - elapsed);
      setStatus(`Recording... ${remaining}s remaining`);

      if (remaining === 0) {
        addStatusEvent('Recording window finished. Waiting for transcription/decoding...');
        setStatus('Transcribing and decoding...');
      }
    }

    if (run.status === 'done' || run.status === 'failed') {
      stopLiveAudio();
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

refreshBtn.addEventListener('click', async () => {
  try {
    await fetchRuns();
    addStatusEvent('History refreshed.');
  } catch (error) {
    addStatusEvent(`Failed to refresh history: ${error.message}`, true);
  }
});

runBtn.addEventListener('click', async () => {
  try {
    runBtn.disabled = true;
    setStatus('Submitting run...');
    addStatusEvent('Submitting run request...');

    setLiveAudioPlaying();

    const res = await apiFetch('/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const payload = await res.json();
    addStatusEvent(`Run ${payload.id} queued.`);
    const finalRun = await pollWithDynamicStatus(payload.id);
    setStatus(`Run ${payload.id}: ${finalRun.status}`);
  } catch (error) {
    stopLiveAudio();
    setStatus('Run failed.');
    addStatusEvent(error instanceof Error ? error.message : String(error), true);
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

(async function bootstrap() {
  setStatus('Connecting...');
  await fetchPublicConfig();

  try {
    await fetchRuns();
    setStatus('Ready. Click Run to start.');
  } catch (error) {
    setStatus('Could not load run history.');
    addStatusEvent(`Failed to load history: ${error.message}`, true);
  }
})();
