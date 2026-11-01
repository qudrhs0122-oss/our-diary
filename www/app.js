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
  update: (table, id, row) => sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', json: row, headers: { Prefer: 'return=representation' } }),
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
  beat();
}
function logout() {
  session = null; store.del('session'); stopPoll(); show('#login');
}

function switchTab(t) {
  curTab = t;
  $$('.bottom button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  ['cal', 'notes', 'chat', 'photos', 'map', 'bucket', 'heart'].forEach((x) => $(`#tab-${x}`).classList.toggle('hidden', x !== t));
  $('#title').textContent = { cal: '캘린더', notes: '노트', chat: '채팅', photos: '사진', map: '지도', bucket: '버킷리스트', heart: '하트' }[t];
  stopPoll();
  if (t === 'cal') { loadMonth(); tickDday(); renderDdayNext(); }
  if (t === 'notes') { loadNotes(true); poll = setInterval(() => loadNotes(false), 4000); }
  if (t === 'chat') { loadTalk(true).then(beat); poll = setInterval(() => { loadTalk(false); beat(); }, 3000); }
  if (t === 'photos') loadAlbum();
  if (t === 'map') { initMap(); setTimeout(() => map && map.invalidateSize(), 50); loadPlaces(); }
  if (t === 'heart') { openHeart(); poll = setInterval(loadHearts, 3000); }
  if (t === 'bucket') { loadBucket(); poll = setInterval(loadBucket, 8000); }
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
    const an = other ? null : anniv(s);
    html += `<button class="${cls}" data-date="${s}"><span class="num">${d.getDate()}</span>
      ${an ? `<span class="anniv">${an}</span>` : ''}
      <span class="dots">${evs.slice(0, 4).map((e) => `<i class="dot ${mine(e.author) ? 'me' : 'you'}"></i>`).join('')}</span>
      ${!other && photoDates.has(s) ? '<span class="cam">📷</span>' : ''}</button>`;
  }
  $('#cal-grid').innerHTML = html;
  renderDay();
}

function renderDay() {
  const an = anniv(selDate);
  $('#day-title').textContent = prettyDate(selDate) + (an ? ` 💗 ${an}` : '');
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

/* ================= D-Day ================= */
const START = new Date(2024, 11, 4, 0, 0, 0); // 2024년 12월 4일 0시 (처음 만난 날)
const DAY = 86400000;
const dayNo = (s) => Math.round((new Date(s + 'T00:00:00') - START) / DAY) + 1; // 시작일 = 1일
function anniv(s) {
  const n = dayNo(s);
  if (n < 2) return n === 1 ? '시작' : null;
  if (n % 100 === 0) return `${n}일`;
  if (s.slice(5) === ymd(START).slice(5)) return `${Number(s.slice(0, 4)) - START.getFullYear()}주년`;
  return null;
}
function upcoming(count) {
  const out = []; const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(now);
  for (let i = 0; i < 3650 && out.length < count; i++, d.setDate(d.getDate() + 1)) {
    const s = ymd(d); const a = anniv(s);
    if (a && a !== '시작') out.push({ s, a, left: Math.round((d - now) / DAY) });
  }
  return out;
}
function tickDday() {
  if (curTab !== 'cal' || $('#main').classList.contains('hidden')) return;
  let ms = Date.now() - START.getTime();
  const days = Math.floor(ms / DAY); ms -= days * DAY;
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const sec = Math.floor(ms / 1000);
  $('#dday-count').textContent = `D+${dayNo(ymd(new Date()))}`;
  $('#dday-time').innerHTML = `<b>${days.toLocaleString()}</b>일 <b>${pad(h)}</b>시간 <b>${pad(m)}</b>분 <b>${pad(sec)}</b>초`;
}
function renderDdayNext() {
  const up = upcoming(8);
  if (!up.length) return;
  const n = up[0];
  $('#dday-next').textContent = `다음 기념일 · ${n.a} (${prettyDate(n.s)}) ${n.left === 0 ? '오늘! 🎉' : `D-${n.left}`}`;
  $('#dday-list').innerHTML = `<div class="dday-start">시작한 날 · 2024년 12월 4일</div>` +
    up.map((u) => `<div class="dday-row"><span>${u.a}</span><span>${u.s.replace(/-/g, '.')}</span><span>${u.left === 0 ? '오늘' : `D-${u.left}`}</span></div>`).join('');
}
setInterval(tickDday, 1000);
$('#dday').onclick = () => $('#dday-list').classList.toggle('hidden');

/* ================= 버킷리스트 ================= */
let buckets = [];
let bkFilter = 'todo';
async function loadBucket() {
  try {
    buckets = (await db.select('buckets', 'select=*&order=created_at.asc&limit=1000')) || [];
    renderBucket();
  } catch (e) { handleErr(e); stopPoll(); }
}
function renderBucket() {
  const done = buckets.filter((b) => b.done).length;
  $('#bk-progress').textContent = `${done}/${buckets.length} 완료`;
  const list = buckets.filter((b) => bkFilter === 'all' || (bkFilter === 'done' ? b.done : !b.done));
  if (bkFilter === 'done') list.sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
  $('#bucket').innerHTML = list.map((b) => `
    <div class="bk ${b.done ? 'done' : ''} ${mine(b.author) ? 'me' : 'you'}" data-id="${b.id}">
      <button class="bk-check" aria-label="체크">${b.done ? '✓' : ''}</button>
      <div class="bk-body">
        <div class="bk-title">${esc(b.title)}</div>
        <div class="bk-meta">${esc(b.author)}의 버킷${b.done ? ` · ✅ ${esc(b.done_by)}가 체크 (${b.done_at ? b.done_at.slice(0, 10).replace(/-/g, '.') : ''})` : ''}</div>
      </div>
      ${mine(b.author) ? '<button class="bk-del" aria-label="삭제">✕</button>' : ''}
    </div>`).join('') || `<div class="empty" style="padding-top:40px">${bkFilter === 'done' ? '아직 이룬 게 없어요. 하나씩 해봐요!' : '함께 하고 싶은 걸 적어보세요 ✨'}</div>`;
}
$('#bk-add').onclick = async () => {
  const title = $('#bk-text').value.trim(); if (!title) return;
  const btn = $('#bk-add'); btn.disabled = true;
  try { await db.insert('buckets', { title, author: me }); $('#bk-text').value = ''; if (bkFilter === 'done') setBkFilter('todo'); await loadBucket(); }
  catch (e) { handleErr(e); } finally { btn.disabled = false; }
};
$('#bk-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#bk-add').click(); });
function setBkFilter(f) { bkFilter = f; $$('.bucket-filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === f)); renderBucket(); }
$$('.bucket-filter button').forEach((b) => (b.onclick = () => setBkFilter(b.dataset.f)));
$('#bucket').addEventListener('click', async (e) => {
  const row = e.target.closest('.bk'); if (!row) return;
  const b = buckets.find((x) => x.id === row.dataset.id); if (!b) return;
  try {
    if (e.target.closest('.bk-del')) {
      if (!confirm('이 버킷을 지울까요?')) return;
      await db.remove('buckets', b.id);
    } else if (e.target.closest('.bk-check')) {
      if (b.done && !confirm('체크를 풀까요?')) return;
      Object.assign(b, b.done ? { done: false, done_by: null, done_at: null } : { done: true, done_by: me, done_at: new Date().toISOString() });
      renderBucket();
      await db.update('buckets', b.id, { done: b.done, done_by: b.done_by, done_at: b.done_at });
      if (b.done) toast('🎉 버킷 하나 달성!');
    } else return;
    await loadBucket();
  } catch (err) { handleErr(err); loadBucket(); }
});

/* ================= 지도 ================= */
let map = null;
let placeLayer = null;
let places = [];
let picking = false;
let draft = null;        // 새로 기록할 장소 { lat, lng, addr }
let draftFiles = [];
let viewingPlace = null;

// 키가 필요 없는 지도들 (앞에서부터 시도, 안 되면 다음 것으로 자동 전환)
const TILE_SOURCES = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '© OpenStreetMap' } },
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opt: { maxZoom: 19, attribution: '© Esri' } },
  { url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', opt: { maxZoom: 19, subdomains: 'abc', attribution: '© OpenStreetMap France' } },
];
let tileLayer = null;
function useTiles(idx, tries = 0) {
  idx = ((idx % TILE_SOURCES.length) + TILE_SOURCES.length) % TILE_SOURCES.length;
  if (tileLayer) map.removeLayer(tileLayer);
  const src = TILE_SOURCES[idx];
  let ok = 0, bad = 0, switched = false;
  tileLayer = L.tileLayer(src.url, src.opt).addTo(map);
  store.set('tileIdx', idx);
  tileLayer.on('tileload', () => { ok++; });
  tileLayer.on('tileerror', () => {
    bad++;
    if (!switched && ok === 0 && bad >= 3 && tries < TILE_SOURCES.length - 1) { switched = true; useTiles(idx + 1, tries + 1); }
  });
}
function initMap() {
  if (map || !window.L) return;
  const last = store.get('mapView', { lat: 37.5446, lng: 127.0560, z: 12 });
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([last.lat, last.lng], last.z);
  useTiles(store.get('tileIdx', 0));
  placeLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => { const c = map.getCenter(); store.set('mapView', { lat: c.lat, lng: c.lng, z: map.getZoom() }); });
  map.on('contextmenu', (e) => { if (!picking) startDraft(e.latlng.lat, e.latlng.lng); }); // 길게 누르기
  map.on('click', () => { $('#map-results').classList.add('hidden'); $('#place-list').classList.add('hidden'); });
}

async function loadPlaces() {
  try {
    places = (await db.select('places', 'select=*&order=date.desc,created_at.desc&limit=1000')) || [];
    renderPlaces();
  } catch (e) { handleErr(e); }
}
function pinIcon(p) {
  const cls = mine(p.author) ? 'me' : 'you';
  const n = (p.photos || []).length;
  return L.divIcon({ className: '', iconSize: [34, 42], iconAnchor: [17, 40],
    html: `<div class="pin ${cls}"><span>${n ? '📷' : '💗'}</span></div>` });
}
function renderPlaces() {
  if (map) {
    placeLayer.clearLayers();
    for (const p of places) {
      L.marker([p.lat, p.lng], { icon: pinIcon(p) }).addTo(placeLayer)
        .bindTooltip(esc(p.name), { direction: 'top', offset: [0, -38] })
        .on('click', () => openPlace(p.id));
    }
  }
  $('#place-list').innerHTML = places.length
    ? `<div class="pl-head">우리가 간 곳 ${places.length}곳</div>` + places.map((p) => `
      <div class="pl-row" data-id="${p.id}">
        <i class="dot ${mine(p.author) ? 'me' : 'you'}"></i>
        <div class="pl-txt"><b>${esc(p.name)}</b><span>${p.date.replace(/-/g, '.')}${p.memo ? ' · ' + esc(p.memo.slice(0, 30)) : ''}</span></div>
        <span>${(p.photos || []).length ? '📷 ' + p.photos.length : ''}</span>
      </div>`).join('')
    : '<div class="empty">아직 기록한 곳이 없어요.<br>＋ 버튼이나 지도를 길게 눌러 추가해요</div>';
}
$('#map-style-btn').onclick = (e) => { e.stopPropagation(); useTiles(store.get('tileIdx', 0) + 1); toast(`지도 ${store.get('tileIdx', 0) + 1}번으로 바꿨어요`); };
$('#map-list-btn').onclick = (e) => { e.stopPropagation(); $('#map-results').classList.add('hidden'); $('#place-list').classList.toggle('hidden'); };
$('#place-list').addEventListener('click', (e) => {
  const r = e.target.closest('.pl-row'); if (!r) return;
  const p = places.find((x) => x.id === r.dataset.id); if (!p) return;
  $('#place-list').classList.add('hidden');
  map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16));
  openPlace(p.id);
});

// 검색 (OpenStreetMap)
async function geo(url) {
  const r = await fetch(url, { headers: { 'Accept-Language': 'ko' } });
  if (!r.ok) throw new Error('검색 실패');
  return r.json();
}
$('#map-q').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = $('#map-q').value.trim(); if (!q) return;
  $('#map-q').blur();
  const box = $('#map-results'); box.classList.remove('hidden'); box.innerHTML = '<div class="empty">찾는 중…</div>';
  $('#place-list').classList.add('hidden');
  try {
    const c = map.getCenter();
    const res = await geo(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=ko&countrycodes=kr&q=${encodeURIComponent(q)}&viewbox=${c.lng - 1},${c.lat + 1},${c.lng + 1},${c.lat - 1}`);
    box.innerHTML = res.length ? res.map((r, i) => `<div class="res" data-i="${i}"><b>${esc(r.name || r.display_name.split(',')[0])}</b><span>${esc(r.display_name)}</span></div>`).join('')
      : '<div class="empty">검색 결과가 없어요. 지도를 직접 움직여 핀을 꽂아도 돼요.</div>';
    box.onclick = (ev) => {
      const el = ev.target.closest('.res'); if (!el) return;
      const r = res[+el.dataset.i];
      box.classList.add('hidden');
      map.setView([+r.lat, +r.lon], 17);
      startDraft(+r.lat, +r.lon, r.name || r.display_name.split(',')[0], r.display_name);
    };
  } catch (err) { box.innerHTML = '<div class="empty">검색이 안 돼요. 인터넷 연결을 확인해 주세요.</div>'; }
});

// 내 위치
$('#map-locate').onclick = () => {
  if (!navigator.geolocation) { toast('위치를 사용할 수 없어요'); return; }
  toast('내 위치 찾는 중…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      map.setView(ll, 17);
      L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#3c8cf0', fillOpacity: 1 }).addTo(map);
    },
    () => toast('위치 권한을 허용해 주세요'),
    { enableHighAccuracy: true, timeout: 15000 },
  );
};

// 장소 추가: ＋ 누르면 가운데 핀으로 위치 고르기
$('#map-add').onclick = () => {
  picking = true;
  ['#map-cross', '#map-pickbar'].forEach((x) => $(x).classList.remove('hidden'));
  ['#map-add', '#map-locate'].forEach((x) => $(x).classList.add('hidden'));
  $('#place-list').classList.add('hidden'); $('#map-results').classList.add('hidden');
};
function endPick() {
  picking = false;
  ['#map-cross', '#map-pickbar'].forEach((x) => $(x).classList.add('hidden'));
  ['#map-add', '#map-locate'].forEach((x) => $(x).classList.remove('hidden'));
}
$('#pick-cancel').onclick = endPick;
$('#pick-ok').onclick = () => { const c = map.getCenter(); endPick(); startDraft(c.lat, c.lng); };

async function startDraft(lat, lng, name = '', addr = '') {
  draft = { lat, lng }; draftFiles = [];
  $('#pl-name').value = name; $('#pl-addr').textContent = addr;
  $('#pl-date').value = today; $('#pl-memo').value = ''; $('#pl-previews').innerHTML = '';
  openSheet('#sheet-place');
  if (!name) {
    try {
      const r = await geo(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=18&lat=${lat}&lon=${lng}`);
      if (draft && draft.lat === lat) {
        if (!$('#pl-name').value) $('#pl-name').value = r.name || (r.address && (r.address.amenity || r.address.shop || r.address.building || r.address.road || r.address.suburb)) || '';
        $('#pl-addr').textContent = r.display_name || '';
      }
    } catch {}
  }
}
function addDraftFiles(files) {
  for (const f of files) draftFiles.push(f);
  $('#pl-previews').innerHTML = draftFiles.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
}
$('#pl-files').onchange = $('#pl-camera').onchange = (e) => { addDraftFiles(Array.from(e.target.files || [])); e.target.value = ''; };
$('#pl-save').onclick = async () => {
  const name = $('#pl-name').value.trim();
  if (!name) { toast('장소 이름을 적어주세요'); return; }
  busy(true);
  try {
    const photos = [];
    for (const f of draftFiles) photos.push(await uploadPhoto(f));
    await db.insert('places', { name, lat: draft.lat, lng: draft.lng, date: $('#pl-date').value || today, memo: $('#pl-memo').value.trim() || null, photos, author: me });
    closeSheet(); draft = null; draftFiles = [];
    toast('기록했어요 📍');
    await loadPlaces();
  } catch (e) { handleErr(e); } finally { busy(false); }
};

// 장소 보기
function openPlace(id) {
  const p = places.find((x) => x.id === id); if (!p) return;
  viewingPlace = p;
  $('#pv-name').textContent = p.name;
  $('#pv-when').textContent = `${prettyDate(p.date)} · ${p.author}님이 기록`;
  $('#pv-memo').textContent = p.memo || '';
  $('#pv-del').classList.toggle('hidden', !mine(p.author));
  renderThumbs($('#pv-photos'), (p.photos || []).map((path, i) => ({ id: `${p.id}-${i}`, path })));
  openSheet('#sheet-place-view');
}
$('#pv-photos').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-pid]'); if (!img || !viewingPlace) return;
  const i = +img.dataset.pid.split('-').pop();
  openViewer({ path: viewingPlace.photos[i], caption: viewingPlace.name, author: viewingPlace.author, when: prettyDate(viewingPlace.date), canDelete: false });
});
$('#pv-files').onchange = $('#pv-camera').onchange = async (e) => {
  const files = Array.from(e.target.files || []); e.target.value = '';
  if (!files.length || !viewingPlace) return;
  busy(true);
  try {
    const add = [];
    for (const f of files) add.push(await uploadPhoto(f));
    const photos = [...(viewingPlace.photos || []), ...add];
    await db.update('places', viewingPlace.id, { photos });
    const id = viewingPlace.id;
    await loadPlaces(); openPlace(id); toast(`사진 ${add.length}장 추가`);
  } catch (err) { handleErr(err); } finally { busy(false); }
};
$('#pv-del').onclick = async () => {
  if (!viewingPlace || !confirm('이 장소 기록을 삭제할까요?')) return;
  busy(true);
  try {
    await db.remove('places', viewingPlace.id);
    if ((viewingPlace.photos || []).length) await storage.remove(viewingPlace.photos).catch(() => {});
    closeSheet(); await loadPlaces(); toast('삭제했어요');
  } catch (e) { handleErr(e); } finally { busy(false); }
};

/* ================= 하트 ================= */
// 왼쪽(m)·오른쪽(f) 하트를 누른 횟수가 각각 쌓임. 누구든 둘 다 누를 수 있음
let hearts = [];      // [{ name: 'm'|'f', count }]
const pending = { m: 0, f: 0 };
let flushing = false;

function openHeart() { loadHearts(); }
async function loadHearts() {
  try { hearts = (await db.select('hearts', 'select=*&name=in.(m,f)')) || []; renderHearts(); } catch (e) { handleErr(e); stopPoll(); }
}
function renderHearts() {
  let total = 0;
  for (const side of ['m', 'f']) {
    const h = hearts.find((x) => x.name === side);
    const n = (h ? Number(h.count) || 0 : 0) + pending[side];
    total += n;
    $(`#ht-${side}`).textContent = n.toLocaleString();
  }
  $('#ht-total').textContent = total.toLocaleString();
}
function buzz() {
  const H = window.Capacitor?.Plugins?.Haptics;
  if (H) H.impact({ style: 'HEAVY' }).catch(() => navigator.vibrate && navigator.vibrate(40));
  else if (navigator.vibrate) navigator.vibrate(40);
}
function floatHeart(x, y) {
  const el = document.createElement('div');
  el.className = 'floater'; el.textContent = ['💗', '💖', '💕', '❤️'][Math.floor(Math.random() * 4)];
  el.style.left = `${x + (Math.random() * 40 - 20)}px`; el.style.top = `${y}px`;
  $('#floaters').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}
async function flushTaps() {
  if (flushing || (!pending.m && !pending.f)) return;
  flushing = true;
  try {
    for (const side of ['m', 'f']) {
      const n = pending[side]; if (!n) continue;
      await sb('/rest/v1/rpc/add_hearts', { method: 'POST', json: { p_name: side, p_side: side, p_n: n } });
      pending[side] -= n;
    }
    await loadHearts();
  } catch (e) { handleErr(e); } finally { flushing = false; }
}
setInterval(flushTaps, 1200);
$$('.figure').forEach((fig) => {
  fig.addEventListener('click', () => {
    const side = fig.dataset.side;
    const heart = fig.querySelector('.heart');
    const r = heart.getBoundingClientRect();
    const box = $('#tab-heart').getBoundingClientRect();
    buzz();
    pending[side]++;
    heart.classList.remove('beat'); void heart.getBoundingClientRect(); heart.classList.add('beat');
    floatHeart(r.left - box.left + r.width / 2 - 12, r.top - box.top + $('#tab-heart').scrollTop);
    renderHearts();
  });
});

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

/* ================= 채팅 (매일 자정 리셋) ================= */
let talk = [];
let talkSig = '';
let talkDay = '';
function midnightISO() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }

async function loadTalk(scroll) {
  try {
    // 오늘 0시 이후 메시지만 (서버에서도 매일 자정에 삭제됨)
    const rows = await db.select('chats', `select=*&created_at=gte.${encodeURIComponent(midnightISO())}&order=created_at.asc&limit=500`);
    const list = rows || [];
    const sig = ymd(new Date()) + list.map((n) => n.id).join(',');
    if (sig === talkSig && !scroll) return;
    const box = $('#talk');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    talk = list; talkSig = sig;
    renderTalk();
    if (scroll || atBottom) box.scrollTop = box.scrollHeight;
  } catch (e) { if (scroll) handleErr(e); }
}
function renderTalk() {
  $('#talk').innerHTML = talk.map((n) => {
    const who = mine(n.author) ? 'me' : 'you';
    return `<div class="msg ${who}" data-id="${n.id}">
      ${who === 'you' ? `<div class="name">${esc(n.author)}</div>` : ''}
      <div class="bubble">${esc(n.body)}</div>
      <div class="time">${who === 'me' ? readMark(n.created_at) : ''}${hm(n.created_at)}</div></div>`;
  }).join('') || '<div class="empty">오늘의 대화를 시작해 보세요 💬</div>';
}

/* ================= 접속 상태 · 읽음 표시 ================= */
let peers = [];
const other = () => peers.find((p) => p.name !== me) || null;
function readMark(createdAt) {
  const o = other();
  return o && o.chat_seen_at && new Date(o.chat_seen_at) >= new Date(createdAt) ? '<span class="read">읽음</span> ' : '<span class="unread">1</span> ';
}
const inApp = () => document.visibilityState === 'visible' && unlocked && !!session && !!me && !$('#main').classList.contains('hidden');
let beating = false;
async function beat(leaving) {
  if (!session || !me || beating) return;
  const now = new Date().toISOString();
  const row = { name: me, last_seen: now, active: !leaving && inApp() };
  if (row.active && curTab === 'chat') row.chat_seen_at = now;
  beating = true;
  try {
    await sb('/rest/v1/presence?on_conflict=name', { method: 'POST', json: row, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    if (leaving) return;
    const prevSeen = other()?.chat_seen_at;
    peers = (await db.select('presence', 'select=*&order=last_seen.desc')) || [];
    renderPresence();
    if (curTab === 'chat' && other()?.chat_seen_at !== prevSeen) renderTalk();
  } catch (e) { /* 접속 표시는 실패해도 조용히 넘어감 */ } finally { beating = false; }
}
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
function renderPresence() {
  const o = other(); const el = $('#presence');
  if (!o) { el.innerHTML = ''; return; }
  const online = o.active && Date.now() - new Date(o.last_seen) < 30000;
  el.innerHTML = online
    ? `<i class="on"></i>${esc(o.name)} 접속 중`
    : `<i class="off"></i>${esc(o.name)} · ${ago(o.last_seen)}`;
}
setInterval(() => { if (inApp() && curTab !== 'chat') beat(); }, 10000);
const talkText = $('#talk-text');
talkText.addEventListener('input', () => { talkText.style.height = 'auto'; talkText.style.height = Math.min(talkText.scrollHeight, 120) + 'px'; });
$('#talk-send').onclick = async () => {
  const body = talkText.value.trim(); if (!body) return;
  const btn = $('#talk-send'); btn.disabled = true;
  try {
    await db.insert('chats', { body, author: me });
    talkText.value = ''; talkText.style.height = 'auto';
    await loadTalk(true);
  } catch (e) { handleErr(e); } finally { btn.disabled = false; }
};

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
  const old = me;
  me = n; store.set('me', me); closeSheet(); toast('이름을 바꿨어요'); switchTab(curTab);
  if (old && old !== n) sb(`/rest/v1/presence?name=eq.${encodeURIComponent(old)}`, { method: 'DELETE' }).catch(() => {});
  beat();
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
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); stopPoll(); beat(true); return; }
  if (unlocked && hiddenAt && Date.now() - hiddenAt > 60 * 1000) {
    unlocked = false; closeSheet(); closeViewer(); start(); return;
  }
  if (session && me && !$('#main').classList.contains('hidden')) { switchTab(curTab); beat(); }
});

// 안드로이드 뒤로가기 버튼
(function setupBack() {
  const App = window.Capacitor?.Plugins?.App;
  if (!App) return;
  App.addListener('backButton', () => {
    if (!$('#light').classList.contains('hidden')) $('#light').classList.add('hidden');
    else if (!$('#viewer').classList.contains('hidden')) closeViewer();
    else if (openSheetId) closeSheet();
    else if (picking) endPick();
    else if (curTab === 'map' && !$('#place-list').classList.contains('hidden')) $('#place-list').classList.add('hidden');
    else if (!$('#main').classList.contains('hidden') && curTab !== 'cal') switchTab('cal');
    else App.exitApp();
  });
})();

start();
