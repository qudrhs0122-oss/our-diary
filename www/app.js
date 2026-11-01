'use strict';

/* ================= 공통 ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const prettyDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const hm = (iso) => { const d = new Date(iso); const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad(d.getMinutes())}`; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16);
}));

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}
function busy(on) { $('#busy').classList.toggle('hidden', !on); }

/* ================= Supabase (fetch로 직접 호출) ================= */
const SB = window.SB_URL, KEY = window.SB_KEY;
let session = store.get('session');

async function authCall(grant, body) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || '로그인 실패');
  session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Date.now() / 1000 + j.expires_in), email: j.user?.email };
  store.set('session', session);
  return session;
}
const login = (email, password) => authCall('password', { email, password });

async function token() {
  if (!session) throw new Error('NOAUTH');
  if (session.expires_at - 60 < Date.now() / 1000) {
    try { await authCall('refresh_token', { refresh_token: session.refresh_token }); }
    catch (e) { logout(); throw new Error('NOAUTH'); }
  }
  return session.access_token;
}

async function sb(path, opts = {}) {
  const tk = await token();
  const headers = { apikey: KEY, Authorization: `Bearer ${tk}`, ...(opts.headers || {}) };
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const r = await fetch(`${SB}${path}`, { method: opts.method || 'GET', headers, body: opts.body });
  if (r.status === 401) { logout(); throw new Error('NOAUTH'); }
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error((data && (data.message || data.error)) || `오류 ${r.status}`);
  return data;
}
const db = {
  select: (table, query) => sb(`/rest/v1/${table}?${query}`),
  insert: (table, row) => sb(`/rest/v1/${table}`, { method: 'POST', json: row, headers: { Prefer: 'return=representation' } }),
  remove: (table, id) => sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
const storage = {
  upload: (path, blob) => sb(`/storage/v1/object/photos/${path}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } }),
  remove: (paths) => sb(`/storage/v1/object/photos`, { method: 'DELETE', json: { prefixes: paths } }),
};

// 사진 주소 캐시 (비공개 저장소라 서명된 주소 사용)
const urlCache = new Map();
async function signUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !urlCache.has(p)))];
  if (need.length) {
    for (let i = 0; i < need.length; i += 100) {
      const res = await sb(`/storage/v1/object/sign/photos`, { method: 'POST', json: { expiresIn: 60 * 60 * 24 * 7, paths: need.slice(i, i + 100) } });
      for (const it of res || []) if (it.signedURL) urlCache.set(it.path, `${SB}/storage/v1${it.signedURL}`);
    }
  }
}
const photoUrl = (p) => urlCache.get(p) || '';

// 사진 줄이기 (최대 1600px, JPEG)
function shrink(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(u);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('사진 변환 실패'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('사진을 읽을 수 없어요')); };
    img.src = u;
  });
}
async function uploadPhoto(file) {
  const blob = await shrink(file);
  const now = new Date();
  const path = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${uuid()}.jpg`;
  await storage.upload(path, blob);
  urlCache.set(path, URL.createObjectURL(blob));
  return path;
}

/* ================= 상태 ================= */
let me = store.get('me', '');
const mine = (author) => author === me;
const today = ymd(new Date());
let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
let selDate = today;
let monthEvents = [];
let monthPhotos = [];
let curTab = 'cal';

/* ================= 화면 전환 ================= */
let unlocked = false;
const GATE_CODE = '1204';
function show(id) {
  ['#gate', '#login', '#whoami', '#main'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}
function start() {
  if (!unlocked) { show('#gate'); return; }
  if (!session) { show('#login'); return; }
  if (!me) { show('#whoami'); return; }
  show('#main');
  switchTab(curTab);
}
function logout() {
  session = null; store.del('session'); stopPoll(); show('#login');
}

function switchTab(t) {
  curTab = t;
  $$('.bottom button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  ['cal', 'notes', 'photos'].forEach((x) => $(`#tab-${x}`).classList.toggle('hidden', x !== t));
  $('#title').textContent = { cal: '캘린더', notes: '노트', photos: '사진' }[t];
  stopPoll();
  if (t === 'cal') loadMonth();
  if (t === 'notes') { loadNotes(true); poll = setInterval(() => loadNotes(false), 4000); }
  if (t === 'photos') loadAlbum();
}
let poll = null;
function stopPoll() { if (poll) clearInterval(poll); poll = null; }

function handleErr(e) {
  if (e.message === 'NOAUTH') { toast('다시 로그인해 주세요'); return; }
  console.error(e);
  toast(navigator.onLine === false ? '인터넷 연결을 확인해 주세요' : `문제가 생겼어요: ${e.message}`);
}

/* ================= 시트 ================= */
let openSheetId = null;
function openSheet(id) {
  closeSheet();
  openSheetId = id; $('#sheet-bg').classList.remove('hidden'); $(id).classList.remove('hidden');
}
function closeSheet() {
  if (!openSheetId) return;
  $(openSheetId).classList.add('hidden'); $('#sheet-bg').classList.add('hidden'); openSheetId = null;
}

/* ================= 캘린더 ================= */
async function loadMonth() {
  renderCal();
  const first = `${view.y}-${pad(view.m + 1)}-01`;
  const lastD = new Date(view.y, view.m + 1, 0).getDate();
  const last = `${view.y}-${pad(view.m + 1)}-${pad(lastD)}`;
  try {
    const [ev, ph] = await Promise.all([
      db.select('events', `select=*&date=gte.${first}&date=lte.${last}&order=date.asc,time.asc.nullsfirst,created_at.asc`),
      db.select('photos', `select=*&date=gte.${first}&date=lte.${last}&order=created_at.asc`),
    ]);
    monthEvents = ev || []; monthPhotos = ph || [];
    renderCal();
  } catch (e) { handleErr(e); }
}

function renderCal() {
  $('#cal-month').textContent = `${view.y}년 ${view.m + 1}월`;
  const start = new Date(view.y, view.m, 1);
  start.setDate(1 - start.getDay());
  const byDate = {};
  for (const e of monthEvents) (byDate[e.date] ||= []).push(e);
  const photoDates = new Set(monthPhotos.map((p) => p.date));
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const s = ymd(d);
    const other = d.getMonth() !== view.m;
    if (i === 35 && other) break; // 5주로 충분하면 6번째 줄 생략
    const evs = other ? [] : (byDate[s] || []);
    const cls = ['cal-day', other && 'other', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat', s === today && 'today', s === selDate && 'sel'].filter(Boolean).join(' ');
    html += `<button class="${cls}" data-date="${s}"><span class="num">${d.getDate()}</span>
      <span class="dots">${evs.slice(0, 4).map((e) => `<i class="dot ${mine(e.author) ? 'me' : 'you'}"></i>`).join('')}</span>
      ${!other && photoDates.has(s) ? '<span class="cam">📷</span>' : ''}</button>`;
  }
  $('#cal-grid').innerHTML = html;
  renderDay();
}

function renderDay() {
  $('#day-title').textContent = prettyDate(selDate);
  const evs = monthEvents.filter((e) => e.date === selDate);
  const phs = monthPhotos.filter((p) => p.date === selDate);
  $('#day-events').innerHTML = evs.length ? evs.map((e) => `
    <div class="ev ${mine(e.author) ? 'me' : 'you'}" data-id="${e.id}">
      <div class="t">${e.time ? esc(e.time.slice(0, 5)) : '하루종일'}</div>
      <div><div class="ti">${esc(e.title)}</div><div class="who">${esc(e.author)}</div></div>
    </div>`).join('') : (phs.length ? '' : '<div class="empty">일정이 없어요</div>');
  renderThumbs($('#day-photos'), phs);
}

async function renderThumbs(el, phs) {
  el.innerHTML = phs.map((p) => `<img data-pid="${p.id}" src="${photoUrl(p.path)}" loading="lazy" alt="">`).join('');
  if (!phs.length) return;
  try {
    await signUrls(phs.map((p) => p.path));
    el.querySelectorAll('img[data-pid]').forEach((img) => {
      const p = phs.find((x) => x.id === img.dataset.pid);
      if (p && !img.getAttribute('src')) img.src = photoUrl(p.path);
    });
  } catch (e) { handleErr(e); }
}

$('#cal-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.cal-day'); if (!b) return;
  const d = b.dataset.date;
  const [y, m] = d.split('-').map(Number);
  selDate = d;
  if (y !== view.y || m - 1 !== view.m) { view = { y, m: m - 1 }; loadMonth(); } else renderCal();
});
$('#cal-prev').onclick = () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } selDate = `${view.y}-${pad(view.m + 1)}-01`; loadMonth(); };
$('#cal-next').onclick = () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } selDate = `${view.y}-${pad(view.m + 1)}-01`; loadMonth(); };

// 일정 추가
$('#add-event').onclick = () => {
  $('#ev-title').value = ''; $('#ev-time').value = ''; $('#ev-memo').value = ''; $('#ev-date').value = selDate;
  openSheet('#sheet-event'); setTimeout(() => $('#ev-title').focus(), 150);
};
$('#ev-save').onclick = async () => {
  const title = $('#ev-title').value.trim();
  const date = $('#ev-date').value;
  if (!title) { toast('일정 내용을 적어주세요'); return; }
  if (!date) { toast('날짜를 골라주세요'); return; }
  busy(true);
  try {
    await db.insert('events', { title, date, time: $('#ev-time').value || null, memo: $('#ev-memo').value.trim() || null, author: me });
    closeSheet(); selDate = date;
    const [y, m] = date.split('-').map(Number); view = { y, m: m - 1 };
    await loadMonth(); toast('저장했어요');
  } catch (e) { handleErr(e); } finally { busy(false); }
};

// 일정 보기/삭제
let viewingEvent = null;
$('#day-events').addEventListener('click', (e) => {
  const el = e.target.closest('.ev'); if (!el) return;
  const ev = monthEvents.find((x) => x.id === el.dataset.id); if (!ev) return;
  viewingEvent = ev;
  $('#evv-title').textContent = ev.title;
  $('#evv-when').textContent = `${prettyDate(ev.date)} ${ev.time ? ev.time.slice(0, 5) : '하루종일'}`;
  $('#evv-memo').textContent = ev.memo || '';
  $('#evv-author').textContent = `${ev.author}님이 적었어요`;
  openSheet('#sheet-event-view');
});
$('#evv-del').onclick = async () => {
  if (!viewingEvent || !confirm('이 일정을 삭제할까요?')) return;
  busy(true);
  try { await db.remove('events', viewingEvent.id); closeSheet(); await loadMonth(); toast('삭제했어요'); }
  catch (e) { handleErr(e); } finally { busy(false); }
};

/* ================= 노트(대화) ================= */
let notes = [];
let notesSig = '';
let chatFile = null;

async function loadNotes(scroll) {
  try {
    const rows = await db.select('notes', 'select=*&order=created_at.desc&limit=300');
    const list = (rows || []).reverse();
    const sig = list.map((n) => n.id).join(',');
    if (sig === notesSig && !scroll) return;
    const chat = $('#chat');
    const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
    notes = list; notesSig = sig;
    await signUrls(notes.map((n) => n.photo_path)).catch(() => {});
    renderNotes();
    if (scroll || atBottom) chat.scrollTop = chat.scrollHeight;
  } catch (e) { if (scroll) handleErr(e); }
}

function renderNotes() {
  let html = ''; let lastDay = '';
  for (const n of notes) {
    const day = ymd(new Date(n.created_at));
    if (day !== lastDay) { html += `<div class="date-sep">${prettyDate(day)}</div>`; lastDay = day; }
    const who = mine(n.author) ? 'me' : 'you';
    html += `<div class="msg ${who}" data-id="${n.id}">
      ${who === 'you' ? `<div class="name">${esc(n.author)}</div>` : ''}
      ${n.photo_path ? `<img src="${photoUrl(n.photo_path)}" data-path="${esc(n.photo_path)}" alt="">` : ''}
      ${n.body ? `<div class="bubble">${esc(n.body)}</div>` : ''}
      <div class="time">${hm(n.created_at)}</div></div>`;
  }
  $('#chat').innerHTML = html || '<div class="empty">첫 기록을 남겨보세요 ✍️</div>';
  $$('#chat img').forEach((img) => img.addEventListener('load', () => {
    const chat = $('#chat'); if (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 400) chat.scrollTop = chat.scrollHeight;
  }, { once: true }));
}

const chatText = $('#chat-text');
chatText.addEventListener('input', () => { chatText.style.height = 'auto'; chatText.style.height = Math.min(chatText.scrollHeight, 120) + 'px'; });
$('#chat-file').onchange = $('#chat-camera').onchange = (e) => {
  chatFile = e.target.files[0] || null; e.target.value = '';
  if (chatFile) { $('#chat-preview-img').src = URL.createObjectURL(chatFile); $('#chat-preview').classList.remove('hidden'); }
};
$('#chat-preview-x').onclick = () => { chatFile = null; $('#chat-preview').classList.add('hidden'); };
$('#chat-send').onclick = async () => {
  const body = chatText.value.trim();
  if (!body && !chatFile) return;
  const btn = $('#chat-send'); btn.disabled = true;
  if (chatFile) busy(true);
  try {
    const photo_path = chatFile ? await uploadPhoto(chatFile) : null;
    await db.insert('notes', { body: body || null, photo_path, author: me });
    chatText.value = ''; chatText.style.height = 'auto';
    chatFile = null; $('#chat-preview').classList.add('hidden');
    await loadNotes(true);
  } catch (e) { handleErr(e); } finally { btn.disabled = false; busy(false); }
};

// 길게 누르면 삭제
let pressTimer = null;
$('#chat').addEventListener('touchstart', (e) => {
  const m = e.target.closest('.msg.me'); if (!m) return;
  pressTimer = setTimeout(() => deleteNote(m.dataset.id), 600);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((ev) => $('#chat').addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));
$('#chat').addEventListener('contextmenu', (e) => { const m = e.target.closest('.msg.me'); if (m) { e.preventDefault(); deleteNote(m.dataset.id); } });
async function deleteNote(id) {
  const n = notes.find((x) => x.id === id); if (!n || !confirm('이 메시지를 삭제할까요?')) return;
  try { await db.remove('notes', id); if (n.photo_path) await storage.remove([n.photo_path]).catch(() => {}); notesSig = ''; await loadNotes(false); }
  catch (e) { handleErr(e); }
}
$('#chat').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-path]'); if (!img) return;
  const n = notes.find((x) => x.photo_path === img.dataset.path);
  openViewer({ path: n.photo_path, caption: n.body, author: n.author, when: `${prettyDate(ymd(new Date(n.created_at)))} ${hm(n.created_at)}`, canDelete: false });
});

/* ================= 사진 앨범 ================= */
let album = [];
async function loadAlbum() {
  try {
    album = (await db.select('photos', 'select=*&order=date.desc,created_at.desc&limit=1000')) || [];
    renderAlbum();
  } catch (e) { handleErr(e); }
}
function renderAlbum() {
  if (!album.length) { $('#album').innerHTML = '<div class="empty" style="padding-top:60px">📷 버튼으로 찍거나 ＋ 버튼으로 골라서 올려보세요</div>'; return; }
  let html = ''; let lastM = ''; let lastD = ''; let open = false;
  for (const p of album) {
    const mth = p.date.slice(0, 7);
    if (mth !== lastM) { if (open) html += '</div>'; open = false; html += `<div class="album-month">${Number(mth.slice(0, 4))}년 ${Number(mth.slice(5))}월</div>`; lastM = mth; lastD = ''; }
    if (p.date !== lastD) { if (open) html += '</div>'; html += `<div class="album-day">${prettyDate(p.date)}</div><div class="thumbs">`; open = true; lastD = p.date; }
    html += `<img data-pid="${p.id}" src="${photoUrl(p.path)}" loading="lazy" alt="">`;
  }
  if (open) html += '</div>';
  $('#album').innerHTML = html;
  signUrls(album.map((p) => p.path)).then(() => {
    $$('#album img[data-pid]').forEach((img) => {
      const p = album.find((x) => x.id === img.dataset.pid); if (p && !img.getAttribute('src')) img.src = photoUrl(p.path);
    });
  }).catch(handleErr);
}

let pendingFiles = [];
$('#photo-file').onchange = $('#day-photo-file').onchange = $('#photo-camera').onchange = $('#day-camera').onchange = (e) => {
  pendingFiles = Array.from(e.target.files || []); e.target.value = '';
  if (!pendingFiles.length) return;
  $('#ph-previews').innerHTML = pendingFiles.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
  $('#ph-date').value = curTab === 'cal' ? selDate : today;
  $('#ph-caption').value = '';
  openSheet('#sheet-photo');
};
$('#ph-save').onclick = async () => {
  const date = $('#ph-date').value || today;
  const caption = $('#ph-caption').value.trim() || null;
  busy(true);
  let ok = 0;
  try {
    for (const f of pendingFiles) {
      const path = await uploadPhoto(f);
      await db.insert('photos', { path, caption, date, author: me });
      ok++;
    }
    closeSheet(); toast(`사진 ${ok}장을 올렸어요`);
    pendingFiles = [];
    if (curTab === 'photos') await loadAlbum(); else await loadMonth();
  } catch (e) { handleErr(e); if (ok) toast(`${ok}장만 올라갔어요`); } finally { busy(false); }
};

function photoClick(list) {
  return (e) => {
    const img = e.target.closest('img[data-pid]'); if (!img) return;
    const p = list().find((x) => x.id === img.dataset.pid); if (!p) return;
    openViewer({ id: p.id, path: p.path, caption: p.caption, author: p.author, when: prettyDate(p.date), canDelete: true });
  };
}
$('#album').addEventListener('click', photoClick(() => album));
$('#day-photos').addEventListener('click', photoClick(() => monthPhotos));

/* ================= 사진 뷰어 ================= */
let viewing = null;
function openViewer(v) {
  viewing = v;
  $('#viewer-img').src = photoUrl(v.path);
  $('#viewer-cap').textContent = v.caption || '';
  $('#viewer-meta').textContent = `${v.when} · ${v.author}`;
  $('#viewer-del').classList.toggle('hidden', !v.canDelete);
  $('#viewer').classList.remove('hidden');
}
function closeViewer() { $('#viewer').classList.add('hidden'); viewing = null; }
$('#viewer-close').onclick = closeViewer;
$('#viewer-del').onclick = async () => {
  if (!viewing || !confirm('이 사진을 삭제할까요?')) return;
  busy(true);
  try {
    await db.remove('photos', viewing.id);
    await storage.remove([viewing.path]).catch(() => {});
    closeViewer(); toast('삭제했어요');
    if (curTab === 'photos') await loadAlbum(); else await loadMonth();
  } catch (e) { handleErr(e); } finally { busy(false); }
};

/* ================= 로그인/이름/설정 ================= */
$('#login-email').value = store.get('lastEmail', '');
$('#login-btn').onclick = async () => {
  const email = $('#login-email').value.trim(), pw = $('#login-pw').value;
  $('#login-err').textContent = '';
  if (!email || !pw) { $('#login-err').textContent = '이메일과 비밀번호를 입력해 주세요'; return; }
  busy(true);
  try {
    await login(email, pw); store.set('lastEmail', email); $('#login-pw').value = ''; start();
  } catch (e) {
    $('#login-err').textContent = /invalid/i.test(e.message) ? '이메일 또는 비밀번호가 맞지 않아요' : e.message;
  } finally { busy(false); }
};
$('#login-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#login-btn').click(); });

$('#me-save').onclick = () => {
  const n = $('#me-name').value.trim(); if (!n) { toast('이름을 적어주세요'); return; }
  me = n; store.set('me', me); start();
};
$('#settings-btn').onclick = () => { $('#set-name').value = me; openSheet('#sheet-settings'); };
$('#set-save').onclick = () => {
  const n = $('#set-name').value.trim(); if (!n) return;
  me = n; store.set('me', me); closeSheet(); toast('이름을 바꿨어요'); switchTab(curTab);
};
$('#set-logout').onclick = () => { if (confirm('로그아웃할까요?')) { closeSheet(); logout(); } };

$$('.bottom button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
$('#sheet-bg').onclick = closeSheet;
$$('[data-close]').forEach((b) => (b.onclick = closeSheet));

// 위장 잠금: '랜턴을 켜시겠습니까?' 에 1204
$('#gate-on').onclick = () => {
  const v = $('#gate-pw').value.trim();
  $('#gate-pw').value = '';
  if (v === GATE_CODE) { unlocked = true; $('#gate-pw').blur(); start(); }
  else $('#light').classList.remove('hidden'); // 틀리면 진짜 손전등처럼 화면만 하얗게
};
$('#gate-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate-on').click(); });
$('#light').onclick = () => $('#light').classList.add('hidden');

// 앱을 1분 넘게 나갔다 오면 다시 잠금, 돌아오면 새로고침
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); stopPoll(); return; }
  if (unlocked && hiddenAt && Date.now() - hiddenAt > 60 * 1000) {
    unlocked = false; closeSheet(); closeViewer(); start(); return;
  }
  if (session && me && !$('#main').classList.contains('hidden')) switchTab(curTab);
});

// 안드로이드 뒤로가기 버튼
(function setupBack() {
  const App = window.Capacitor?.Plugins?.App;
  if (!App) return;
  App.addListener('backButton', () => {
    if (!$('#light').classList.contains('hidden')) $('#light').classList.add('hidden');
    else if (!$('#viewer').classList.contains('hidden')) closeViewer();
    else if (openSheetId) closeSheet();
    else if (!$('#main').classList.contains('hidden') && curTab !== 'cal') switchTab('cal');
    else App.exitApp();
  });
})();

start();
