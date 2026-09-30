// =========================================================================
// KONFIGURASI UTAMA - GANTI DENGAN URL DEPLOYMENT APPS SCRIPT ANDA
// =========================================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxvGT_viSBSI2dwb2YVck6Xi8Mwi2qYyc3ca7cLPFddH2rnRO8kTxE4jMQqfCWNxVOC/exec";

// --- STATE ---
let clientId = "";
let adminMode = false;
let adminCode = "mpk2026";
let currentTab = "beranda";
let aspOffset = 0;
let eventOffsets = {};
let isEventLocked = false;
let eventListCache = [];

// --- INIT ---
window.onload = () => {
  initClientId();
  initParallax();
  initIdCard();
  setupGlassHighlights();
  
  // Hash routing
  window.addEventListener("hashchange", handleHash);
  if(window.location.hash) {
    // Jika hash bukan #beranda dan event terkunci, handle spesial
    handleHash();
  } else {
    updateNavIndicator('beranda');
  }

  // Check events untuk unlock dock
  loadEventsDataOnly();
  loadStats();

  // Scroll progress
  window.addEventListener('scroll', () => {
    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    document.getElementById('scroll-progress').style.width = (winScroll / height * 100) + "%";
  }, {passive:true});
  
  // Hilangkan inert saat intro
  document.body.style.overflow = 'hidden';
};

document.getElementById('intro').addEventListener('click', function() {
  this.classList.add('hidden');
  document.body.style.overflow = '';
  setTimeout(() => this.remove(), 600);
  startLoops();
  animateStats();
});

function initClientId() {
  try {
    clientId = localStorage.getItem('mpk_client_id');
    if(!clientId) {
      clientId = 'id-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now();
      localStorage.setItem('mpk_client_id', clientId);
    }
  } catch(e) {
    clientId = 'id-temp-' + Date.now();
  }
}

// --- API UTILS ---
function getApiUrl() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === "ISI_DI_SINI") {
    throw new Error("URL deployment Apps Script belum diisi. Ganti APPS_SCRIPT_URL di script.js.");
  }

  try {
    return new URL(APPS_SCRIPT_URL);
  } catch(e) {
    throw new Error("URL deployment Apps Script tidak valid.");
  }
}

async function readApiResponse(res) {
  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch(e) {
    if (!res.ok) throw new Error(`Server mengembalikan HTTP ${res.status}. Periksa URL deployment Apps Script.`);
    throw new Error("Respons server bukan JSON. Pastikan URL deployment Apps Script benar dan dapat diakses.");
  }

  if (!res.ok) throw new Error(data.error || `Server mengembalikan HTTP ${res.status}`);
  if (!data.success) throw new Error(data.error || "Permintaan API gagal");
  return data;
}

async function apiGet(action, params = {}) {
  const url = getApiUrl();
  url.searchParams.append('action', action);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    return await readApiResponse(res);
  } catch(err) {
    if(err.name === 'AbortError') throw new Error("Koneksi timeout");
    throw err;
  }
}

async function apiPost(action, payload) {
  const url = getApiUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action, ...payload}),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return await readApiResponse(res);
  } catch(err) {
    if(adminMode && err.message === "Kode salah") {
      logoutAdmin();
    }
    throw err;
  }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast glass';
  if(type === 'error') toast.style.background = 'rgba(128,0,0,0.85)';
  if(type === 'success') toast.style.background = 'rgba(31,100,61,0.85)';
  toast.textContent = msg;
  container.appendChild(toast);
  
  // Remove extra toasts
  while(container.children.length > 3) {
    container.removeChild(container.firstChild);
  }
  
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { if(toast.parentNode) toast.remove(); }, 400);
  }, 3000);
}

// --- ROUTING & NAV ---
function handleHash() {
  let hash = window.location.hash.substring(1) || 'beranda';
  const validTabs = ['beranda', 'aspirasi', 'event', 'tentang'];
  if(!validTabs.includes(hash)) hash = 'beranda';
  
  if(hash === 'event' && isEventLocked && !adminMode) {
    showToast('Belum ada event yang dibuka', 'error');
    history.replaceState(null, null, '#beranda');
    hash = 'beranda';
  }
  
  navTo(hash, true);
}

function navTo(tabId, fromHash = false) {
  if(tabId === currentTab) return;
  if(tabId === 'event' && isEventLocked && !adminMode) {
    handleEventNav(); return;
  }
  
  if(!fromHash) {
    window.history.pushState(null, null, '#' + tabId);
  }

  updateNavIndicator(tabId);
  
  const oldPanel = document.getElementById('tab-' + currentTab);
  const newPanel = document.getElementById('tab-' + tabId);
  
  // Animate out
  oldPanel.style.opacity = '0';
  oldPanel.style.transform = 'translateY(-10px) scale(0.98)';
  document.body.style.pointerEvents = 'none'; // Lock clicks
  
  setTimeout(() => {
    oldPanel.classList.remove('active');
    oldPanel.style = '';
    newPanel.classList.add('active');
    
    if(tabId === 'aspirasi' && aspOffset === 0) loadAspirasi(true);
    if(tabId === 'event') loadEvents();
    
    window.scrollTo({top:0, behavior:'smooth'});
    
    setTimeout(() => document.body.style.pointerEvents = '', 400);
  }, 250);
  
  currentTab = tabId;
}

function handleEventNav() {
  const navItem = document.getElementById('nav-event');
  if(isEventLocked && !adminMode) {
    navItem.classList.remove('shake');
    void navItem.offsetWidth; // trigger reflow
    navItem.classList.add('shake');
    showToast("Belum ada event yang dibuka pengurus MPK", "error");
  } else {
    navTo('event');
  }
}

function updateNavIndicator(tabId) {
  const items = document.querySelectorAll('nav .nav-item');
  items.forEach(i => i.classList.remove('active'));
  const activeItem = document.querySelector(`nav .nav-item[data-target="${tabId}"]`);
  if(activeItem) {
    activeItem.classList.add('active');
    const indicator = document.getElementById('nav-indicator');
    indicator.classList.add('squish');
    indicator.style.left = activeItem.offsetLeft + 'px';
    indicator.style.width = activeItem.offsetWidth + 'px';
    setTimeout(() => indicator.classList.remove('squish'), 400);
  }
}

// --- DATA FETCHING & RENDERING ---
async function loadStats() {
  try {
    const data = await apiGet('stats');
    document.getElementById('stat-total').innerText = data.total;
    document.getElementById('stat-selesai').innerText = data.selesai;
  } catch(e) {}
}

function animateStats() {
  ['stat-total', 'stat-selesai'].forEach(id => {
    const el = document.getElementById(id);
    const target = parseInt(el.innerText) || 0;
    let start = 0;
    const duration = 1500;
    const step = (timestamp) => {
      if(!el.startTime) el.startTime = timestamp;
      const progress = Math.min((timestamp - el.startTime)/duration, 1);
      el.innerText = Math.floor(progress * target);
      if(progress < 1) requestAnimationFrame(step);
      else el.innerText = target;
    };
    requestAnimationFrame(step);
  });
}

async function loadEventsDataOnly() {
  try {
    const data = await apiGet('listEvents');
    eventListCache = data.items;
    checkEventLock();
  } catch(e) {}
}

function checkEventLock() {
  isEventLocked = !eventListCache.some(e => !e.locked);
  const navItem = document.getElementById('nav-event');
  if(isEventLocked && !adminMode) {
    navItem.classList.add('locked');
  } else {
    navItem.classList.remove('locked');
  }
}

// ASPIRASI UMUM
function switchAspTab(view) {
  const ind = document.getElementById('asp-indicator');
  const btns = document.querySelectorAll('.segment-btn');
  btns.forEach(b => b.classList.remove('active'));
  
  if(view === 'form') {
    ind.style.transform = 'translateX(0)';
    btns[0].classList.add('active');
    document.getElementById('asp-form-view').classList.remove('hidden-force');
    document.getElementById('asp-list-view').classList.add('hidden-force');
  } else {
    ind.style.transform = 'translateX(100%)';
    btns[1].classList.add('active');
    document.getElementById('asp-form-view').classList.add('hidden-force');
    document.getElementById('asp-list-view').classList.remove('hidden-force');
    if(document.getElementById('asp-list-container').innerHTML === '') loadAspirasi(true);
  }
}

function updateCharCount(prefix) {
  const input = document.getElementById(`${prefix}-input`);
  const count = document.getElementById(`${prefix}-count`);
  if(input && count) count.innerText = `${input.value.length}/1000`;
}

async function submitAspirasi() {
  const input = document.getElementById('asp-input');
  const btn = document.getElementById('btn-submit-asp');
  const isi = input.value.trim();
  
  if(!isi) return showToast("Aspirasi tidak boleh kosong", "error");
  
  btn.disabled = true;
  btn.innerHTML = 'Mengirim...';
  
  try {
    await apiPost('submit', { clientId, isi });
    showToast("Aspirasi berhasil dikirim!", "success");
    triggerConfetti();
    input.value = '';
    updateCharCount('asp');
    switchAspTab('list');
    loadAspirasi(true);
  } catch(e) {
    showToast(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Kirim Aspirasi';
  }
}

function getSkeletonHTML() {
  return `<div class="card skeleton" style="height:120px;"></div>`.repeat(3);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderCard(item, type, eventId = null) {
  const dateStr = new Date(item.waktu).toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'});
  const voteKey = `vote_${type}_${item.id}`;
  let voted = false;
  try { voted = localStorage.getItem(voteKey) === '1'; } catch(e){}
  
  let adminHtml = '';
  if (adminMode) {
    const statuses = ['Hold', 'Diproses', 'Selesai', 'Ditolak'];
    const options = statuses.map(s => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('');
    adminHtml = `
      <div class="admin-actions">
        <select class="admin-select" onchange="updateStatus('${item.id}', this.value, '${type}')">
          ${options}
        </select>
      </div>
    `;
  }
  
  return `
    <div class="card" style="animation: fadeUp 0.4s ease backwards;">
      <div class="card-head">
        <span class="status-pill status-${item.status}">${item.status}</span>
        <span class="card-date">${dateStr}</span>
      </div>
      <div class="card-body">${escapeHTML(item.isi)}</div>
      <div class="card-foot">
        <button class="vote-btn ${voted ? 'voted' : ''}" onclick="vote('${item.id}', '${type}', this)">
          ▲ <span class="vote-count">${item.votes}</span>
        </button>
        ${adminHtml}
      </div>
    </div>
  `;
}

async function loadAspirasi(reset = false) {
  const container = document.getElementById('asp-list-container');
  const btnMore = document.getElementById('btn-load-more-asp');
  
  if(reset) {
    aspOffset = 0;
    container.innerHTML = getSkeletonHTML();
    btnMore.style.display = 'none';
  }
  
  try {
    const action = adminMode ? 'listAdmin' : 'list';
    const params = adminMode ? { action: action, kodeAkses: adminCode, offset: aspOffset } : { action: action, offset: aspOffset };
    
    let data;
    if(adminMode) {
      data = await apiPost('listAdmin', {kodeAkses: adminCode, offset: aspOffset, limit: 20});
    } else {
      data = await apiGet('list', { offset: aspOffset, limit: 20 });
    }
    
    if(reset) container.innerHTML = '';
    
    if(data.items.length === 0 && reset) {
      container.innerHTML = `<div class="empty-state">Belum ada aspirasi. Jadilah yang pertama!</div>`;
    } else {
      let html = '';
      data.items.forEach((item, i) => {
        html += renderCard(item, 'asp');
      });
      container.insertAdjacentHTML('beforeend', html);
      
      // Stagger animation
      const cards = container.querySelectorAll('.card');
      for(let i = aspOffset; i < cards.length; i++) {
        if(cards[i]) cards[i].style.animationDelay = `${(i - aspOffset) * 0.05}s`;
      }
    }
    
    if(data.hasMore) {
      btnMore.style.display = 'inline-block';
      btnMore.innerText = 'Muat Lebih Banyak';
      aspOffset += 20;
    } else {
      btnMore.style.display = 'none';
    }
  } catch(e) {
    if(reset) container.innerHTML = `<div class="empty-state">Gagal memuat. <button onclick="loadAspirasi(true)">Coba lagi</button></div>`;
    showToast(e.message, "error");
  }
}

// EVENTS
async function loadEvents() {
  const container = document.getElementById('event-list-container');
  container.innerHTML = getSkeletonHTML();
  try {
    const data = await apiGet('listEvents');
    eventListCache = data.items;
    checkEventLock();
    
    if(data.items.length === 0) {
      container.innerHTML = `<div class="empty-state">Belum ada event yang aktif.</div>`;
      return;
    }
    
    let html = '';
    data.items.forEach(ev => {
      // Hanya tampilkan event terbuka jika bukan admin
      if (ev.locked && !adminMode) return;
      
      let adminTools = '';
      if(adminMode) {
        adminTools = `
          <div class="admin-event-tools">
            <input type="text" value="${escapeHTML(ev.nama)}" style="padding:4px 8px; border-radius:4px; border:1px solid #ddd; font-size:12px;" onchange="renameEvent('${ev.id}', this.value)">
            <button onclick="toggleEventLock('${ev.id}', ${!ev.locked})" style="padding:4px 8px; font-size:12px; border-radius:4px; cursor:pointer; border:none;">
              ${ev.locked ? 'Buka Kunci' : 'Kunci Event'}
            </button>
          </div>
        `;
      }
      
      html += `
        <div class="event-card" id="ev-card-${ev.id}">
          <div class="event-head" onclick="toggleEvent('${ev.id}')">
            <div>
              <h3 id="ev-title-${ev.id}">${escapeHTML(ev.nama)}</h3>
              <span class="event-badge ${ev.locked ? 'locked' : 'open'}">${ev.locked ? 'Terkunci' : 'Terbuka'}</span>
            </div>
            <div style="font-size:20px; transition:transform 0.3s;" class="ev-caret">▼</div>
          </div>
          ${adminTools}
          <div class="event-body">
            ${!ev.locked ? `
              <div class="form-group" style="margin-top:8px;">
                <textarea id="ev-input-${ev.id}" placeholder="Suarakan aspirasimu untuk event ini..." maxlength="1000" oninput="updateCharCount('ev-${ev.id}')"></textarea>
                <div class="form-meta"><span>🔒 Anonim</span><span id="ev-${ev.id}-count">0/1000</span></div>
              </div>
              <button class="btn-main glass-btn" style="padding:12px; font-size:14px; margin-bottom:24px;" id="btn-ev-${ev.id}" onclick="submitEventAspirasi('${ev.id}')">Kirim Aspirasi Event</button>
            ` : `<p style="font-size:13px; opacity:0.7; margin-bottom:16px;">Event ditutup. Tidak menerima aspirasi baru.</p>`}
            
            <h4 style="font-size:14px; margin-bottom:12px; opacity:0.8;">Aspirasi Masuk</h4>
            <div id="ev-list-${ev.id}" class="list-container"></div>
            <div style="text-align:center; margin-top:12px;">
              <button id="btn-more-ev-${ev.id}" onclick="loadEventAspirasi('${ev.id}')" style="display:none; background:rgba(0,0,0,0.05); padding:6px 12px; font-size:12px; border-radius:12px; cursor:pointer; border:none;">Muat Lebih Banyak</button>
            </div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html || `<div class="empty-state">Belum ada event.</div>`;
  } catch(e) {
    container.innerHTML = `<div class="empty-state">Gagal memuat.</div>`;
    showToast(e.message, "error");
  }
}

function toggleEvent(id) {
  const card = document.getElementById(`ev-card-${id}`);
  const caret = card.querySelector('.ev-caret');
  const isExpanded = card.classList.contains('expanded');
  
  document.querySelectorAll('.event-card').forEach(c => {
    c.classList.remove('expanded');
    c.querySelector('.ev-caret').style.transform = 'rotate(0deg)';
  });
  
  if(!isExpanded) {
    card.classList.add('expanded');
    caret.style.transform = 'rotate(180deg)';
    if(document.getElementById(`ev-list-${id}`).innerHTML === '') {
      eventOffsets[id] = 0;
      loadEventAspirasi(id, true);
    }
  }
}

async function loadEventAspirasi(eventId, reset = false) {
  const container = document.getElementById(`ev-list-${eventId}`);
  const btnMore = document.getElementById(`btn-more-ev-${eventId}`);
  
  if(reset) {
    eventOffsets[eventId] = 0;
    container.innerHTML = getSkeletonHTML();
    btnMore.style.display = 'none';
  }
  
  try {
    const offset = eventOffsets[eventId];
    let data;
    if(adminMode) {
      data = await apiPost('listEventAspirasiAdmin', {kodeAkses: adminCode, eventId: eventId, offset, limit: 10});
    } else {
      data = await apiGet('listEventAspirasi', { eventId, offset, limit: 10 });
    }
    
    if(reset) container.innerHTML = '';
    
    if(data.items.length === 0 && reset) {
      container.innerHTML = `<div class="empty-state" style="padding:16px;">Belum ada aspirasi untuk event ini.</div>`;
    } else {
      let html = '';
      data.items.forEach(item => { html += renderCard(item, 'event', eventId); });
      container.insertAdjacentHTML('beforeend', html);
    }
    
    if(data.hasMore) {
      btnMore.style.display = 'inline-block';
      eventOffsets[eventId] += 10;
    } else {
      btnMore.style.display = 'none';
    }
  } catch(e) {
    if(reset) container.innerHTML = `<div class="empty-state">Gagal memuat data.</div>`;
  }
}

async function submitEventAspirasi(eventId) {
  const input = document.getElementById(`ev-input-${eventId}`);
  const btn = document.getElementById(`btn-ev-${eventId}`);
  const isi = input.value.trim();
  
  if(!isi) return showToast("Aspirasi tidak boleh kosong", "error");
  
  btn.disabled = true;
  btn.innerHTML = 'Mengirim...';
  
  try {
    await apiPost('submitEvent', { clientId, eventId, isi });
    showToast("Aspirasi event berhasil dikirim!", "success");
    input.value = '';
    updateCharCount(`ev-${eventId}`);
    loadEventAspirasi(eventId, true);
  } catch(e) {
    showToast(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Kirim Aspirasi Event';
  }
}

// VOTING
async function vote(id, type, btnEl) {
  const voteKey = `vote_${type}_${id}`;
  let voted = false;
  try { voted = localStorage.getItem(voteKey) === '1'; } catch(e){}
  
  if(voted) return showToast("Kamu sudah vote ini", "info");
  
  // Optimistic Update
  const countEl = btnEl.querySelector('.vote-count');
  const originalCount = parseInt(countEl.innerText);
  countEl.innerText = originalCount + 1;
  btnEl.classList.add('voted');
  
  // Micro-bounce
  btnEl.style.transform = 'scale(1.1)';
  setTimeout(() => btnEl.style.transform = '', 200);

  try {
    const action = type === 'asp' ? 'vote' : 'voteEvent';
    await apiPost(action, { clientId, id });
    try { localStorage.setItem(voteKey, '1'); } catch(e){}
  } catch(e) {
    // Rollback
    countEl.innerText = originalCount;
    btnEl.classList.remove('voted');
    showToast(e.message, "error");
  }
}

// ADMIN FUNCTIONS
function toggleAdmin() {
  if(adminMode) {
    logoutAdmin();
  } else {
    document.getElementById('admin-modal').classList.add('show');
    document.getElementById('admin-code-input').value = '';
    document.getElementById('admin-code-input').focus();
  }
}

function closeAdminModal() {
  document.getElementById('admin-modal').classList.remove('show');
}

async function verifyAdmin() {
  const code = document.getElementById('admin-code-input').value;
  if(!code) return showToast("Kode kosong", "error");
  
  const btn = document.querySelector('#admin-modal button:nth-child(2)');
  btn.innerText = "Cek...";
  btn.disabled = true;
  
  try {
    // Panggil endpoint admin untuk verifikasi kode
    await apiPost('listAdmin', {kodeAkses: code, limit: 1, offset: 0});
    
    adminCode = code;
    adminMode = true;
    document.body.classList.add('is-admin');
    document.getElementById('btn-admin-toggle').innerText = "Keluar Admin";
    closeAdminModal();
    showToast("Mode Admin Aktif", "success");
    
    // Refresh views
    if(currentTab === 'aspirasi') loadAspirasi(true);
    if(currentTab === 'event') loadEvents();
    checkEventLock(); // unlock event tab if locked
  } catch(e) {
    showToast(e.message, "error");
  } finally {
    btn.innerText = "Masuk";
    btn.disabled = false;
  }
}

function logoutAdmin() {
  adminMode = false;
  adminCode = "";
  document.body.classList.remove('is-admin');
  document.getElementById('btn-admin-toggle').innerText = "🔒";
  showToast("Keluar Mode Admin");
  if(currentTab === 'aspirasi') loadAspirasi(true);
  if(currentTab === 'event') loadEvents();
  loadEventsDataOnly(); // to lock tab again if needed
}

async function updateStatus(id, status, type) {
  if(!adminMode) return;
  try {
    const action = type === 'asp' ? 'updateStatus' : 'updateEventStatus';
    await apiPost(action, {kodeAkses: adminCode, id, status});
    showToast("Status diupdate", "success");
    // Update pill color dynamically
    const select = event.target;
    const card = select.closest('.card');
    const pill = card.querySelector('.status-pill');
    pill.className = `status-pill status-${status}`;
    pill.innerText = status;
  } catch(e) {
    showToast(e.message, "error");
  }
}

async function adminCreateEvent() {
  try {
    await apiPost('createEvent', {kodeAkses: adminCode});
    showToast("Event dibuat", "success");
    loadEvents();
  } catch(e) {
    showToast(e.message, "error");
  }
}

async function renameEvent(id, nama) {
  try {
    await apiPost('renameEvent', {kodeAkses: adminCode, id, nama});
    showToast("Nama disimpan", "success");
    document.getElementById(`ev-title-${id}`).innerText = nama;
  } catch(e) {
    showToast(e.message, "error");
  }
}

async function toggleEventLock(id, lockStatus) {
  try {
    await apiPost('toggleEventLock', {kodeAkses: adminCode, id, locked: lockStatus});
    showToast(`Event ${lockStatus ? 'dikunci' : 'dibuka'}`, "success");
    loadEvents();
  } catch(e) {
    showToast(e.message, "error");
  }
}

// --- VISUAL EFFECTS & ANIMATIONS ---
function setupGlassHighlights() {
  // Hanya jalan jika device support hover atau pointer move
  const glasses = document.querySelectorAll('.glass');
  let activeGlass = null;
  let highlightTimeout;

  const setLit = (e, el) => {
    if(activeGlass && activeGlass !== el) activeGlass.classList.remove('lit');
    activeGlass = el;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty('--x', `${x}px`);
    el.style.setProperty('--y', `${y}px`);
    el.classList.add('lit');
    
    clearTimeout(highlightTimeout);
    highlightTimeout = setTimeout(() => {
      el.classList.remove('lit');
    }, 1200);
  };

  const removeLit = (el) => {
    setTimeout(() => el.classList.remove('lit'), 350);
  };

  glasses.forEach(el => {
    el.addEventListener('pointerdown', (e) => setLit(e, el));
    el.addEventListener('pointermove', (e) => {
      if(e.pointerType === 'mouse' || el.classList.contains('lit')) setLit(e, el);
    });
    el.addEventListener('pointerup', () => removeLit(el));
    el.addEventListener('pointercancel', () => removeLit(el));
    el.addEventListener('pointerleave', () => removeLit(el));
  });
}

function initIdCard() {
  const card = document.getElementById('id-card');
  if(!card) return;
  let isDragging = false;
  let startX = 0;
  let currentAngle = 0;

  const updateTransform = (angle) => {
    card.style.transform = `rotate(${angle}deg)`;
  };

  // Swing awal
  card.style.transition = 'transform 2s cubic-bezier(0.25, 1, 0.5, 1)';
  setTimeout(() => updateTransform(15), 100);
  setTimeout(() => updateTransform(-10), 1000);
  setTimeout(() => updateTransform(0), 2000);

  card.addEventListener('pointerdown', (e) => {
    isDragging = true;
    startX = e.clientX;
    card.style.transition = 'none';
    card.setPointerCapture(e.pointerId);
  });

  card.addEventListener('pointermove', (e) => {
    if(!isDragging) return;
    const deltaX = e.clientX - startX;
    currentAngle = Math.max(-45, Math.min(45, deltaX * 0.5));
    updateTransform(currentAngle);
  });

  const endDrag = () => {
    if(!isDragging) return;
    isDragging = false;
    card.style.transition = 'transform 1.5s cubic-bezier(0.25, 1, 0.5, 1)';
    updateTransform(0);
  };

  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
}

// Parallax & Doodles
const DOODLES_SVG = [
  'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', // Books
  'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-1.5M14.5 16.5L16 18', // Pencil
  'M12 2v20M2 12h20M5 5l14 14M19 5L5 19', // Asterisk/Atom
  'M9 21h6v2H9v-2zm3-19c-3.31 0-6 2.69-6 6 0 2.38 1.39 4.43 3.44 5.43.37.18.56.57.56.98v1.59c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1.59c0-.41.19-.8.56-.98C16.61 12.43 18 10.38 18 8c0-3.31-2.69-6-6-6z', // Lightbulb
  'M12 2L1 7v10c0 4 5 7 11 9 6-2 11-5 11-9V7L12 2z' // Shield/Emblem
];

let targetScroll = 0;
let currentScroll = 0;

function initParallax() {
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  
  const container = document.getElementById('doodle-container');
  const isMobile = window.innerWidth < 768;
  const totalDoodles = isMobile ? 8 : 15;
  const layers = container.querySelectorAll('.parallax-layer');
  
  layers.forEach((layer, layerIndex) => {
    for(let i=0; i<Math.floor(totalDoodles/3); i++) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'doodle');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', Math.random() * 30 + 20 + 'px');
      svg.setAttribute('height', svg.getAttribute('width'));
      
      svg.style.left = (Math.random() * 90) + '%';
      svg.style.top = (Math.random() * 90) + '%';
      svg.style.transform = `rotate(${Math.random() * 360}deg)`;
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', DOODLES_SVG[Math.floor(Math.random() * DOODLES_SVG.length)]);
      svg.appendChild(path);
      layer.appendChild(svg);
    }
  });
}

function startLoops() {
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  
  const layers = document.querySelectorAll('.parallax-layer');
  let rafId;

  const loop = () => {
    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    targetScroll = winScroll;
    
    // Lerp
    currentScroll += (targetScroll - currentScroll) * 0.1;
    
    layers.forEach((layer, i) => {
      const speed = parseFloat(layer.getAttribute('data-speed'));
      const yPos = -(currentScroll * speed);
      const float = Math.sin(Date.now() * 0.001 + i) * 10; // Idle float
      layer.style.transform = `translate3d(0, calc(${yPos}px + ${float}px), 0)`;
    });
    
    rafId = requestAnimationFrame(loop);
  };
  
  loop();
  
  // Pause loop if tab hidden
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) cancelAnimationFrame(rafId);
    else loop();
  });
}

function kirimData() {
    google.script.run
      .withSuccessHandler(function(result) {
        console.log(result);
      })
      .simpanData({
        id: "001",
        nama: "Acara 1",
        locked: false
      });
  }

function triggerConfetti() {
  const colors = ['#2F9BF4', '#FFD23F', '#3FB871'];
  for(let i=0; i<30; i++) {
    const conf = document.createElement('div');
    conf.style.position = 'fixed';
    conf.style.width = '8px'; conf.style.height = '8px';
    conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    conf.style.left = '50%'; conf.style.top = '50%';
    conf.style.zIndex = '9999';
    conf.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    document.body.appendChild(conf);
    
    const angle = Math.random() * Math.PI * 2;
    const velocity = 50 + Math.random() * 100;
    const tx = Math.cos(angle) * velocity;
    const ty = Math.sin(angle) * velocity - 50;
    
    conf.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${tx}px, ${ty}px) rotate(${Math.random()*360}deg)`, opacity: 0 }
    ], { duration: 800 + Math.random()*400, easing: 'cubic-bezier(.25,.8,.25,1)' });
    
    setTimeout(() => conf.remove(), 1200);
  }
}

kirimData()