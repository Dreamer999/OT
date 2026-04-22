const LS_API = 'ot.api';
const LS_TOKEN = 'ot.token';

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

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n > 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function mount(tplId) {
  const app = $('#app');
  app.innerHTML = '';
  const tpl = document.getElementById(tplId);
  app.appendChild(tpl.content.cloneNode(true));
}

function setActiveNav(name) {
  $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

async function routeHome() {
  setActiveNav('home');
  mount('tpl-home');

  const listEl = $('#list');
  const search = $('#search');

  async function refresh(q = '') {
    if (!state.token) {
      listEl.innerHTML = `<div class="empty">Add your token in <a href="#/settings">Settings</a> to get started.</div>`;
      return;
    }
    const res = await api(`/api/recordings${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (!res.ok) {
      listEl.innerHTML = `<div class="empty">Error: ${res.status} ${res.statusText}. Check your token in Settings.</div>`;
      return;
    }
    const { recordings } = await res.json();
    if (!recordings.length) {
      listEl.innerHTML = `<div class="empty">No recordings yet. Record here, upload a file, or install the PWA and share from Google Recorder.</div>`;
      return;
    }
    listEl.innerHTML = '';
    for (const r of recordings) {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div>
          <div class="title">${r.filename || r.id}</div>
          <div class="sub">${fmtDate(r.created_at)} · ${fmtBytes(r.bytes)} · ${r.mime || ''}</div>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
        <div>›</div>`;
      el.addEventListener('click', () => { location.hash = `#/r/${r.id}`; });
      listEl.appendChild(el);
    }
  }

  search.addEventListener('input', () => refresh(search.value.trim()));

  $('#btn-record').addEventListener('click', () => startRecording().catch((e) => alert(e.message)));
  $('#btn-stop').addEventListener('click', () => stopRecording());
  $('#btn-cancel').addEventListener('click', () => cancelRecording());

  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadBlob(file, file.name);
    e.target.value = '';
    refresh();
  });

  refresh();
  subscribeEvents(() => refresh(search.value.trim()));

  // Share target handoff (?share=<id> in hash)
  const m = location.hash.match(/share=([a-z0-9]+)/i);
  if (m) {
    try {
      const resp = await fetch(`/share/${m[1]}`);
      if (resp.ok) {
        const filename = resp.headers.get('X-Filename') || 'shared-recording';
        const blob = await resp.blob();
        await uploadBlob(blob, filename);
        refresh();
      }
    } catch (err) { console.error(err); }
    history.replaceState(null, '', '#/');
  }
}

let mediaRecorder = null;
let recordChunks = [];
let recordTimer = null;
let recordStart = 0;

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
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
  if (!state.token) {
    alert('Set a token in Settings first.');
    return;
  }
  const fd = new FormData();
  fd.append('audio', blob, filename);
  const res = await api('/api/recordings', { method: 'POST', body: fd });
  if (!res.ok) {
    const msg = await res.text();
    alert(`Upload failed: ${res.status} ${msg}`);
  }
}

let eventSrc = null;
function subscribeEvents(onUpdate) {
  if (!state.token) return;
  if (eventSrc) eventSrc.close();
  // EventSource can't send custom headers; token-as-query fallback would add auth risk.
  // For the demo we poll every 3s instead — simple and robust.
  if (window._otPoll) clearInterval(window._otPoll);
  window._otPoll = setInterval(onUpdate, 3000);
}

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
  // Audio endpoint requires bearer, so fetch+blob-URL:
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

function router() {
  const h = location.hash.replace(/^#\/?/, '') || '';
  if (h.startsWith('r/')) return routeDetail(h.slice(2));
  if (h.startsWith('settings')) return routeSettings();
  return routeHome();
}

window.addEventListener('hashchange', router);
router();

// Register service worker (for PWA install + share target).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
