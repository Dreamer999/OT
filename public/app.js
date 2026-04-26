const LS_API = 'ot.api';
const LS_TOKEN = 'ot.token';
const LS_DONE = 'ot.done';

const state = {
  apiBase: localStorage.getItem(LS_API) || location.origin,
  token: localStorage.getItem(LS_TOKEN) || '',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch((state.apiBase || '') + path, { ...opts, headers });
}

function fmtDate(ms) { return new Date(ms).toLocaleString(); }
function fmtDateShort(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n > 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const doneSet = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(LS_DONE) || '[]')); } catch { return new Set(); }
})();
function persistDone() { localStorage.setItem(LS_DONE, JSON.stringify([...doneSet])); }
function actionKey(a) { return `${a.recording_id}:${a.index}`; }

function mount(tplId) {
  const app = $('#app');
  app.innerHTML = '';
  const tpl = document.getElementById(tplId);
  app.appendChild(tpl.content.cloneNode(true));
}

function setActiveNav(name) {
  $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

/* ---------- Dashboard ---------- */

async function routeDashboard() {
  setActiveNav('home');
  mount('tpl-home');

  wireRecorder(() => loadDashboard());
  await maybeHandleShare();

  if (!state.token) {
    $('#hero-sub').innerHTML = `Add your token in <a href="#/settings">Settings</a> to get started.`;
    return;
  }
  await loadDashboard();
  if (window._otPoll) clearInterval(window._otPoll);
  window._otPoll = setInterval(loadDashboard, 4000);
}

async function loadDashboard() {
  const res = await api('/api/dashboard');
  if (!res.ok) {
    $('#hero-sub').textContent = `Error ${res.status}: check your token in Settings.`;
    return;
  }
  const data = await res.json();
  renderStats(data);
  renderSparkline(data.daily);
  renderTopics(data.top_topics);
  renderSentiment(data.sentiment);
  renderActions(data.action_items);
  renderRecent(data.recent);
  $('#hero-sub').textContent = `Synced ${new Date(data.server_time).toLocaleTimeString()}`;
}

function renderStats(d) {
  const t = d.totals || {};
  $('#st-today').textContent = t.today ?? 0;
  $('#st-week').textContent = t.this_week ?? 0;
  $('#st-month').textContent = t.this_month ?? 0;
  $('#st-total').textContent = t.recordings ?? 0;
  $('#st-bytes').textContent = fmtBytes(t.bytes || 0);
  const open = (d.action_items || []).filter((a) => !doneSet.has(actionKey(a))).length;
  $('#st-actions').textContent = open;
}

function renderSparkline(daily) {
  const el = $('#sparkline');
  if (!daily?.length) { el.innerHTML = ''; return; }
  const w = 600, h = 120, pad = 18;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const bw = (w - pad * 2) / daily.length - 4;
  const bars = daily.map((d, i) => {
    const x = pad + i * ((w - pad * 2) / daily.length);
    const bh = (d.count / max) * (h - pad * 2);
    const y = h - pad - bh;
    return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2">
              <title>${fmtDateShort(d.date)}: ${d.count}</title></rect>`;
  }).join('');
  const labels = [0, 6, 13].map((i) => {
    const x = pad + i * ((w - pad * 2) / daily.length) + bw / 2;
    return `<text class="axis" x="${x.toFixed(1)}" y="${h - 4}" text-anchor="middle">${fmtDateShort(daily[i].date)}</text>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}${labels}</svg>`;
  const total = daily.reduce((s, d) => s + d.count, 0);
  $('#trend-sub').textContent = `${total} recording${total === 1 ? '' : 's'}`;
}

function renderTopics(topics) {
  const el = $('#topics');
  if (!topics?.length) { el.innerHTML = `<span class="hint">No topics yet.</span>`; return; }
  el.innerHTML = topics.map((t) =>
    `<span class="chip">${escapeHtml(t.topic)}<span class="n">${t.count}</span></span>`).join('');
}

function renderSentiment(s) {
  const total = (s.positive || 0) + (s.neutral || 0) + (s.negative || 0);
  const pct = (n) => total ? `${(n / total * 100).toFixed(0)}%` : '0%';
  $('#sentiment-bar').innerHTML = `
    <span class="pos" style="width:${pct(s.positive)}"></span>
    <span class="neu" style="width:${pct(s.neutral)}"></span>
    <span class="neg" style="width:${pct(s.negative)}"></span>`;
  $('#se-pos').textContent = s.positive || 0;
  $('#se-neu').textContent = s.neutral || 0;
  $('#se-neg').textContent = s.negative || 0;
}

function renderActions(items) {
  const ul = $('#actions-list');
  if (!items?.length) {
    ul.innerHTML = `<li class="empty" style="display:block">No action items yet — record something and they'll show up here.</li>`;
    return;
  }
  ul.innerHTML = '';
  for (const a of items) {
    const key = actionKey(a);
    const isDone = doneSet.has(key);
    const li = document.createElement('li');
    if (isDone) li.classList.add('done');
    li.innerHTML = `
      <input type="checkbox" ${isDone ? 'checked' : ''} aria-label="Mark done" />
      <div class="text">${escapeHtml(a.text)}</div>
      <div class="src"><a href="#/r/${encodeURIComponent(a.recording_id)}">${escapeHtml(a.recording_filename || a.recording_id)}</a> · ${fmtDateShort(a.recording_created_at)}</div>`;
    li.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) doneSet.add(key); else doneSet.delete(key);
      persistDone();
      li.classList.toggle('done', e.target.checked);
      const open = items.filter((x) => !doneSet.has(actionKey(x))).length;
      $('#st-actions').textContent = open;
    });
    ul.appendChild(li);
  }
}

function renderRecent(recent) {
  const el = $('#recent');
  if (!recent?.length) { el.innerHTML = `<div class="empty">No recordings yet.</div>`; return; }
  el.innerHTML = '';
  for (const r of recent) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div>
        <div class="title">${escapeHtml(r.filename || r.id)}</div>
        <div class="sub">${fmtDate(r.created_at)} · ${fmtBytes(r.bytes)}</div>
      </div>
      <span class="badge ${r.status}">${r.status}</span>
      <div>›</div>`;
    item.addEventListener('click', () => { location.hash = `#/r/${r.id}`; });
    el.appendChild(item);
  }
}

/* ---------- Recordings list (full) ---------- */

async function routeRecordings() {
  setActiveNav('recordings');
  mount('tpl-recordings');

  wireRecorder(() => refresh($('#search').value.trim()));

  const listEl = $('#list');
  const search = $('#search');

  async function refresh(q = '') {
    if (!state.token) {
      listEl.innerHTML = `<div class="empty">Add your token in <a href="#/settings">Settings</a>.</div>`;
      return;
    }
    const res = await api(`/api/recordings${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (!res.ok) {
      listEl.innerHTML = `<div class="empty">Error ${res.status}.</div>`;
      return;
    }
    const { recordings } = await res.json();
    if (!recordings.length) {
      listEl.innerHTML = `<div class="empty">No recordings yet.</div>`;
      return;
    }
    listEl.innerHTML = '';
    for (const r of recordings) {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div>
          <div class="title">${escapeHtml(r.filename || r.id)}</div>
          <div class="sub">${fmtDate(r.created_at)} · ${fmtBytes(r.bytes)} · ${escapeHtml(r.mime || '')}</div>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
        <div>›</div>`;
      el.addEventListener('click', () => { location.hash = `#/r/${r.id}`; });
      listEl.appendChild(el);
    }
  }

  search.addEventListener('input', () => refresh(search.value.trim()));
  refresh();
  if (window._otPoll) clearInterval(window._otPoll);
  window._otPoll = setInterval(() => refresh(search.value.trim()), 4000);
}

/* ---------- Recorder controls (shared) ---------- */

let mediaRecorder = null;
let recordChunks = [];
let recordTimer = null;
let recordStart = 0;
let onUploadDone = null;

function wireRecorder(onDone) {
  onUploadDone = onDone;
  $('#btn-record')?.addEventListener('click', () => startRecording().catch((e) => alert(e.message)));
  $('#btn-stop')?.addEventListener('click', () => stopRecording());
  $('#btn-cancel')?.addEventListener('click', () => cancelRecording());
  $('#file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadBlob(file, file.name);
    e.target.value = '';
    onUploadDone?.();
  });
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
  recordChunks = [];
  recordStart = Date.now();
  mediaRecorder.addEventListener('dataavailable', (e) => { if (e.data.size) recordChunks.push(e.data); });
  mediaRecorder.addEventListener('stop', async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(recordTimer);
    const blob = new Blob(recordChunks, { type: mime });
    $('#rec-status').textContent = 'Uploading…';
    await uploadBlob(blob, `rec-${new Date().toISOString()}.webm`);
    $('#recorder-panel').classList.add('hidden');
    $('#btn-record').disabled = false;
    onUploadDone?.();
  });
  mediaRecorder.start();
  $('#recorder-panel').classList.remove('hidden');
  $('#btn-stop').disabled = false;
  $('#btn-record').disabled = true;
  $('#rec-status').textContent = 'Recording…';
  recordTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recordStart) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    $('#rec-time').textContent = `${mm}:${ss}`;
  }, 250);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  $('#btn-stop').disabled = true;
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    mediaRecorder.stream?.getTracks().forEach((t) => t.stop());
  }
  clearInterval(recordTimer);
  $('#recorder-panel').classList.add('hidden');
  $('#btn-record').disabled = false;
}

async function uploadBlob(blob, filename) {
  if (!state.token) { alert('Set a token in Settings first.'); return; }
  const fd = new FormData();
  fd.append('audio', blob, filename);
  const res = await api('/api/recordings', { method: 'POST', body: fd });
  if (!res.ok) {
    const msg = await res.text();
    alert(`Upload failed: ${res.status} ${msg}`);
  }
}

async function maybeHandleShare() {
  const m = location.hash.match(/share=([a-z0-9]+)/i);
  if (!m) return;
  try {
    const resp = await fetch(`/share/${m[1]}`);
    if (resp.ok) {
      const filename = resp.headers.get('X-Filename') || 'shared-recording';
      const blob = await resp.blob();
      await uploadBlob(blob, filename);
    }
  } catch (err) { console.error(err); }
  history.replaceState(null, '', '#/');
}

/* ---------- Detail ---------- */

async function routeDetail(id) {
  setActiveNav('home');
  mount('tpl-detail');
  const res = await api(`/api/recordings/${id}`);
  if (!res.ok) {
    $('#app').innerHTML = `<div class="empty">Not found.</div>`;
    return;
  }
  const { recording, transcript, analysis } = await res.json();
  $('#d-title').textContent = recording.filename || recording.id;
  $('#d-meta').textContent = `${fmtDate(recording.created_at)} · ${fmtBytes(recording.bytes)} · status: ${recording.status}`;
  const audio = $('#d-audio');
  const aRes = await api(`/api/recordings/${id}/audio`);
  if (aRes.ok) {
    const blob = await aRes.blob();
    audio.src = URL.createObjectURL(blob);
  }

  $('#d-summary').textContent = analysis?.summary || '—';
  const fill = (el, arr) => {
    el.innerHTML = '';
    (arr || []).forEach((x) => { const li = document.createElement('li'); li.textContent = x; el.appendChild(li); });
    if (!arr?.length) el.innerHTML = '<li style="color:var(--muted)">—</li>';
  };
  fill($('#d-actions'), analysis?.action_items);
  fill($('#d-decisions'), analysis?.decisions);
  $('#d-topics').textContent = analysis?.topics?.join(', ') || '—';
  $('#d-sentiment').textContent = analysis?.sentiment || '—';
  $('#d-transcript').textContent = transcript?.text || 'Transcript not ready yet.';
  $('#d-raw').textContent = JSON.stringify({ recording, transcript, analysis }, null, 2);

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $$('.tab').forEach((t) => t.classList.add('hidden'));
    $(`#tab-${b.dataset.tab}`).classList.remove('hidden');
  }));
}

/* ---------- Settings ---------- */

function routeSettings() {
  setActiveNav('settings');
  mount('tpl-settings');
  $('#s-api').value = state.apiBase;
  $('#s-token').value = state.token;
  $('#s-save').addEventListener('click', () => {
    state.apiBase = $('#s-api').value.trim().replace(/\/$/, '');
    state.token = $('#s-token').value.trim();
    localStorage.setItem(LS_API, state.apiBase);
    localStorage.setItem(LS_TOKEN, state.token);
    alert('Saved.');
    location.hash = '#/';
  });
}

/* ---------- Router ---------- */

function router() {
  if (window._otPoll) { clearInterval(window._otPoll); window._otPoll = null; }
  const h = location.hash.replace(/^#\/?/, '') || '';
  if (h.startsWith('r/')) return routeDetail(h.slice(2));
  if (h.startsWith('settings')) return routeSettings();
  if (h.startsWith('recordings')) return routeRecordings();
  return routeDashboard();
}

window.addEventListener('hashchange', router);
router();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
