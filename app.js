// =====================================================================
// ĐÈN CHIẾU — xưởng dựng video mini, chạy hoàn toàn trong trình duyệt.
// Thiết kế & Lập trình: Nguyễn Thanh Tùng
// =====================================================================

(function () {
'use strict';

// ---------------------------------------------------------------------
// 0. Tiện ích chung
// ---------------------------------------------------------------------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
};

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------
// 1. Lưu trữ — IndexedDB (project + tất cả media nằm gọn trong 1 record)
// ---------------------------------------------------------------------
const DB_NAME = 'den-chieu-db';
const DB_VERSION = 1;
const STORE = 'projects';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function dbGetAllMeta() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result || []).map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }));
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------
// 2. Trạng thái ứng dụng
// ---------------------------------------------------------------------
// scene = { id, type:'image'|'video', mediaBlob, mediaURL, naturalDuration,
//           duration, effect:'kenburns'|'none', caption,
//           narrationMode:'none'|'record'|'upload'|'tts',
//           narrationBlob, narrationURL, narrationDuration, ttsText }
// libraryItem = { id, type, blob, url, name, naturalDuration }

let project = {
  id: uid(),
  name: 'Dự án chưa đặt tên',
  scenes: [],
  musicBlob: null,
  musicURL: null,
  musicName: '',
  musicVolume: 0.8,
  updatedAt: Date.now(),
};
let library = []; // các media đã thêm, có thể dùng lại cho nhiều cảnh
let selectedSceneId = null;
let dirty = false;
let saveTimer = null;

function markDirty() {
  dirty = true;
  setSaveIndicator('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 900);
}

async function doSave() {
  try {
    project.updatedAt = Date.now();
    // Lưu bản plain (không kèm các thuộc tính runtime *URL, chỉ blob)
    const record = {
      id: project.id,
      name: project.name,
      musicBlob: project.musicBlob || null,
      musicName: project.musicName || '',
      musicVolume: project.musicVolume,
      updatedAt: project.updatedAt,
      scenes: project.scenes.map(s => ({
        id: s.id, type: s.type, mediaBlob: s.mediaBlob,
        naturalDuration: s.naturalDuration, duration: s.duration,
        effect: s.effect, caption: s.caption,
        narrationMode: s.narrationMode, narrationBlob: s.narrationBlob || null,
        narrationDuration: s.narrationDuration || 0, ttsText: s.ttsText || '',
      })),
    };
    await dbPut(record);
    dirty = false;
    setSaveIndicator('saved');
  } catch (e) {
    console.error('Lỗi lưu dự án', e);
    setSaveIndicator('error');
  }
}

function setSaveIndicator(state) {
  const dot = document.getElementById('saveDot');
  const label = document.getElementById('saveLabel');
  if (state === 'saving') { dot.classList.add('saving'); label.textContent = 'Đang lưu…'; }
  else if (state === 'error') { dot.classList.remove('saving'); dot.style.background = 'var(--danger)'; label.textContent = 'Lỗi lưu'; }
  else { dot.classList.remove('saving'); dot.style.background = 'var(--success)'; label.textContent = 'Đã lưu'; }
}

// ---------------------------------------------------------------------
// 3. Nạp media -> thư viện
// ---------------------------------------------------------------------
function fileToLibraryItem(file) {
  return new Promise((resolve) => {
    const type = file.type.startsWith('video') ? 'video' : 'image';
    const url = URL.createObjectURL(file);
    const item = { id: uid(), type, blob: file, url, name: file.name, naturalDuration: 4 };
    if (type === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      v.onloadedmetadata = () => { item.naturalDuration = v.duration || 4; resolve(item); };
      v.onerror = () => resolve(item);
    } else {
      resolve(item);
    }
  });
}

async function addFilesToLibrary(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (!f.type.startsWith('image') && !f.type.startsWith('video')) continue;
    const item = await fileToLibraryItem(f);
    library.push(item);
  }
  renderLibrary();
}

function renderLibrary() {
  const list = document.getElementById('libraryList');
  list.innerHTML = '';
  if (library.length === 0) {
    list.innerHTML = '<div class="lib-empty">Chưa có tư liệu nào.<br>Bấm nút bên trên để thêm ảnh hoặc video.</div>';
    return;
  }
  library.forEach(item => {
    const row = document.createElement('div');
    row.className = 'lib-item';
    row.draggable = true;
    row.dataset.libId = item.id;
    const thumb = document.createElement('div');
    thumb.className = 'lib-thumb';
    if (item.type === 'image') {
      const img = document.createElement('img'); img.src = item.url; thumb.appendChild(img);
    } else {
      const v = document.createElement('video'); v.src = item.url; v.muted = true; thumb.appendChild(v);
    }
    const name = document.createElement('div');
    name.className = 'lib-name';
    name.textContent = item.name;
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-icon btn-sm';
    addBtn.style.flexShrink = '0';
    addBtn.title = 'Thêm vào dải phim';
    addBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    addBtn.onclick = () => addSceneFromLibrary(item);
    row.appendChild(thumb); row.appendChild(name); row.appendChild(addBtn);

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/lib-id', item.id);
    });
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// 4. Quản lý cảnh (scenes)
// ---------------------------------------------------------------------
function addSceneFromLibrary(item, atIndex) {
  const scene = {
    id: uid(),
    type: item.type,
    mediaBlob: item.blob,
    mediaURL: item.url,
    naturalDuration: item.naturalDuration,
    duration: item.type === 'video' ? Math.min(item.naturalDuration, 20) : 4,
    effect: 'kenburns',
    caption: '',
    narrationMode: 'none',
    narrationBlob: null,
    narrationURL: null,
    narrationDuration: 0,
    ttsText: '',
  };
  if (atIndex == null || atIndex < 0 || atIndex > project.scenes.length) {
    project.scenes.push(scene);
  } else {
    project.scenes.splice(atIndex, 0, scene);
  }
  markDirty();
  renderFilmstrip();
  recomputeTotalDuration();
  selectScene(scene.id);
  renderPreviewStatic();
  toast('Đã thêm cảnh mới');
}

function removeScene(sceneId) {
  const idx = project.scenes.findIndex(s => s.id === sceneId);
  if (idx === -1) return;
  const scene = project.scenes[idx];
  if (scene.narrationURL) URL.revokeObjectURL(scene.narrationURL);
  project.scenes.splice(idx, 1);
  if (selectedSceneId === sceneId) selectScene(project.scenes[0] ? project.scenes[0].id : null);
  markDirty();
  renderFilmstrip();
  recomputeTotalDuration();
  renderPreviewStatic();
}

function selectScene(sceneId) {
  selectedSceneId = sceneId;
  renderFilmstrip();
  renderInspector();
  if (sceneId) openInspectorMobile();
}

function getScene(id) { return project.scenes.find(s => s.id === id); }

function recomputeTotalDuration() {
  player.totalDuration = project.scenes.reduce((sum, s) => sum + s.duration, 0);
  updateTimeReadout();
  document.getElementById('btnPlay').disabled = project.scenes.length === 0;
}

// ---------------------------------------------------------------------
// 5. Dải phim (filmstrip) — kéo thả sắp xếp lại
// ---------------------------------------------------------------------
let dragFromIndex = null;

function renderFilmstrip() {
  const row = document.getElementById('filmstripRow');
  const emptyMsg = document.getElementById('timelineEmptyMsg');
  row.innerHTML = '';
  if (project.scenes.length === 0) {
    row.appendChild(emptyMsg);
  }
  project.scenes.forEach((scene, i) => {
    const frame = document.createElement('div');
    frame.className = 'scene-frame' + (scene.id === selectedSceneId ? ' selected' : '');
    frame.draggable = true;
    frame.dataset.index = i;

    let thumbEl;
    if (scene.type === 'image') {
      thumbEl = document.createElement('img');
      thumbEl.className = 'scene-frame-thumb';
      thumbEl.src = scene.mediaURL;
    } else {
      thumbEl = document.createElement('video');
      thumbEl.className = 'scene-frame-thumb';
      thumbEl.src = scene.mediaURL;
      thumbEl.muted = true;
    }
    const num = document.createElement('div');
    num.className = 'scene-frame-num';
    num.textContent = '#' + (i + 1);

    const info = document.createElement('div');
    info.className = 'scene-frame-info';
    info.innerHTML = `<span>${scene.duration.toFixed(1)}s</span>`;

    const del = document.createElement('div');
    del.className = 'scene-frame-del';
    del.innerHTML = '✕';
    del.onclick = (e) => { e.stopPropagation(); removeScene(scene.id); };

    frame.appendChild(thumbEl);
    frame.appendChild(num);
    frame.appendChild(info);
    frame.appendChild(del);

    if (scene.narrationMode === 'record' || scene.narrationMode === 'upload') {
      const mic = document.createElement('div');
      mic.className = 'scene-frame-narr';
      mic.innerHTML = '🎤';
      frame.appendChild(mic);
    }

    frame.onclick = () => selectScene(scene.id);

    frame.addEventListener('dragstart', (e) => {
      dragFromIndex = i;
      frame.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    frame.addEventListener('dragend', () => frame.classList.remove('dragging'));
    frame.addEventListener('dragover', (e) => e.preventDefault());
    frame.addEventListener('drop', (e) => {
      e.preventDefault();
      const libId = e.dataTransfer.getData('text/lib-id');
      if (libId) {
        const item = library.find(l => l.id === libId);
        if (item) addSceneFromLibrary(item, i);
        return;
      }
      if (dragFromIndex !== null && dragFromIndex !== i) {
        const [moved] = project.scenes.splice(dragFromIndex, 1);
        project.scenes.splice(i, 0, moved);
        markDirty();
        renderFilmstrip();
      }
      dragFromIndex = null;
    });

    row.appendChild(frame);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-scene-btn';
  addBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Thêm cảnh</span>';
  addBtn.onclick = () => {
    if (library.length === 0) { toast('Hãy thêm ảnh/video vào Kho tư liệu trước'); return; }
    addSceneFromLibrary(library[library.length - 1]);
  };
  addBtn.addEventListener('dragover', (e) => e.preventDefault());
  addBtn.addEventListener('drop', (e) => {
    e.preventDefault();
    const libId = e.dataTransfer.getData('text/lib-id');
    const item = library.find(l => l.id === libId);
    if (item) addSceneFromLibrary(item);
  });
  row.appendChild(addBtn);
}

// ---------------------------------------------------------------------
// 6. Bảng điều chỉnh cảnh (inspector)
// ---------------------------------------------------------------------
function openInspectorMobile() {
  if (window.innerWidth > 860) return;
  document.getElementById('inspector').classList.add('open');
  document.getElementById('inspectorBackdrop').classList.add('open');
}
function closeInspectorMobile() {
  document.getElementById('inspector').classList.remove('open');
  document.getElementById('inspectorBackdrop').classList.remove('open');
}

let micStream = null, micRecorder = null, micChunks = [];

function renderInspector() {
  const empty = document.getElementById('inspectorEmpty');
  const content = document.getElementById('inspectorContent');
  const scene = getScene(selectedSceneId);
  document.getElementById('btnInspectorToggle').style.display = scene ? 'inline-flex' : 'none';

  if (!scene) { empty.style.display = 'block'; content.style.display = 'none'; return; }
  empty.style.display = 'none';
  content.style.display = 'block';

  content.innerHTML = `
    <div class="field-group">
      <span class="field-label">Thời lượng cảnh</span>
      <div class="field-row">
        <input type="range" id="fDuration" min="0.5" max="30" step="0.1" value="${scene.duration}">
        <span class="range-value" id="fDurationLabel">${scene.duration.toFixed(1)}s</span>
      </div>
      ${scene.type === 'video' ? `<div class="hint-text">Video gốc dài ${fmtTime(scene.naturalDuration)}.</div>` : ''}
    </div>

    <div class="field-group">
      <span class="field-label">Hiệu ứng hình ảnh</span>
      <div class="segmented" id="fEffect">
        <button data-v="kenburns" class="${scene.effect === 'kenburns' ? 'active' : ''}">Lia máy (Ken Burns)</button>
        <button data-v="none" class="${scene.effect === 'none' ? 'active' : ''}">Đứng yên</button>
      </div>
    </div>

    <div class="field-group">
      <span class="field-label">Phụ đề cảnh này</span>
      <textarea class="field-input" id="fCaption" placeholder="Nhập phụ đề hiện trên video…">${scene.caption || ''}</textarea>
    </div>

    <div class="field-group">
      <span class="field-label">Giọng đọc / lồng tiếng</span>
      <div class="segmented" id="fNarrMode">
        <button data-v="none" class="${scene.narrationMode === 'none' ? 'active' : ''}">Không</button>
        <button data-v="record" class="${scene.narrationMode === 'record' ? 'active' : ''}">Ghi âm</button>
        <button data-v="upload" class="${scene.narrationMode === 'upload' ? 'active' : ''}">Tải lên</button>
        <button data-v="tts" class="${scene.narrationMode === 'tts' ? 'active' : ''}">Đọc thử (máy)</button>
      </div>
      <div id="fNarrBody" style="margin-top:10px;"></div>
    </div>
  `;

  // Thời lượng
  const durInput = document.getElementById('fDuration');
  durInput.addEventListener('input', () => {
    scene.duration = parseFloat(durInput.value);
    document.getElementById('fDurationLabel').textContent = scene.duration.toFixed(1) + 's';
    markDirty(); recomputeTotalDuration(); renderFilmstripDurationOnly();
  });

  // Hiệu ứng
  document.getElementById('fEffect').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      scene.effect = btn.dataset.v;
      markDirty();
      document.querySelectorAll('#fEffect button').forEach(b => b.classList.toggle('active', b === btn));
      renderPreviewStatic();
    };
  });

  // Phụ đề
  const capInput = document.getElementById('fCaption');
  capInput.addEventListener('input', () => { scene.caption = capInput.value; markDirty(); renderPreviewStatic(); });

  // Giọng đọc
  document.getElementById('fNarrMode').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      scene.narrationMode = btn.dataset.v;
      markDirty();
      document.querySelectorAll('#fNarrMode button').forEach(b => b.classList.toggle('active', b === btn));
      renderNarrationBody(scene);
    };
  });
  renderNarrationBody(scene);
}

function renderFilmstripDurationOnly() {
  // cập nhật nhanh số giây hiển thị trên khung phim đang chọn, khỏi vẽ lại toàn bộ
  const idx = project.scenes.findIndex(s => s.id === selectedSceneId);
  if (idx === -1) return;
  const frames = document.querySelectorAll('.scene-frame');
  const el = frames[idx];
  if (el) {
    const info = el.querySelector('.scene-frame-info span');
    if (info) info.textContent = project.scenes[idx].duration.toFixed(1) + 's';
  }
}

function renderNarrationBody(scene) {
  const body = document.getElementById('fNarrBody');
  if (!body) return;
  body.innerHTML = '';

  if (scene.narrationMode === 'none') {
    body.innerHTML = '<div class="hint-text">Cảnh này sẽ dùng nguyên âm thanh của video (nếu có) hoặc im lặng.</div>';
    return;
  }

  if (scene.narrationMode === 'record') {
    const row = document.createElement('div');
    row.className = 'mic-record-row';
    row.innerHTML = `
      <button class="mic-btn" id="btnMic">🎙️</button>
      <span class="narration-status" id="micStatus">${scene.narrationBlob ? 'Đã có bản ghi (' + fmtTime(scene.narrationDuration) + ')' : 'Bấm để bắt đầu ghi âm'}</span>
    `;
    body.appendChild(row);
    if (scene.narrationURL) {
      const audio = document.createElement('audio');
      audio.className = 'mini-audio'; audio.controls = true; audio.src = scene.narrationURL;
      body.appendChild(audio);
    }
    document.getElementById('btnMic').onclick = () => toggleMicRecording(scene);
    return;
  }

  if (scene.narrationMode === 'upload') {
    const row = document.createElement('div');
    row.innerHTML = `<button class="btn btn-sm" id="btnUploadNarr">Chọn file âm thanh</button> <span class="narration-status">${scene.narrationBlob ? fmtTime(scene.narrationDuration) : 'Chưa chọn file'}</span>`;
    body.appendChild(row);
    if (scene.narrationURL) {
      const audio = document.createElement('audio');
      audio.className = 'mini-audio'; audio.controls = true; audio.src = scene.narrationURL;
      body.appendChild(audio);
    }
    document.getElementById('btnUploadNarr').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'audio/*';
      input.onchange = () => {
        if (!input.files[0]) return;
        setSceneNarrationFromBlob(scene, input.files[0]);
      };
      input.click();
    };
    return;
  }

  if (scene.narrationMode === 'tts') {
    body.innerHTML = `
      <textarea class="field-input" id="fTtsText" placeholder="Nhập nội dung để nghe thử…">${scene.ttsText || ''}</textarea>
      <div class="field-row" style="margin-top:8px;">
        <button class="btn btn-sm" id="btnTtsPlay">▶ Nghe thử</button>
      </div>
      <div class="warn-text">⚠️ Chỉ để nghe thử tốc độ đọc. Trình duyệt KHÔNG cho phép ghi giọng đọc máy vào video xuất ra — muốn có tiếng trong video, hãy chuyển sang "Ghi âm" hoặc "Tải lên".</div>
    `;
    document.getElementById('fTtsText').addEventListener('input', (e) => { scene.ttsText = e.target.value; markDirty(); });
    document.getElementById('btnTtsPlay').onclick = () => {
      if (!('speechSynthesis' in window)) { toast('Trình duyệt này không hỗ trợ đọc chữ thành giọng nói'); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(scene.ttsText || '');
      u.lang = 'vi-VN';
      speechSynthesis.speak(u);
    };
  }
}

function setSceneNarrationFromBlob(scene, blob) {
  if (scene.narrationURL) URL.revokeObjectURL(scene.narrationURL);
  scene.narrationBlob = blob;
  scene.narrationURL = URL.createObjectURL(blob);
  const a = document.createElement('audio');
  a.preload = 'metadata'; a.src = scene.narrationURL;
  a.onloadedmetadata = () => {
    scene.narrationDuration = a.duration || 0;
    markDirty();
    renderNarrationBody(scene);
    renderFilmstrip();
  };
}

async function toggleMicRecording(scene) {
  const btn = document.getElementById('btnMic');
  const status = document.getElementById('micStatus');
  if (micRecorder && micRecorder.state === 'recording') {
    micRecorder.stop();
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('Không thể truy cập micro. Hãy cho phép quyền micro cho trình duyệt.');
    return;
  }
  micChunks = [];
  const mime = ['audio/webm', 'audio/mp4', ''].find(m => !m || MediaRecorder.isTypeSupported(m));
  micRecorder = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
  micRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
  micRecorder.onstop = () => {
    const blob = new Blob(micChunks, { type: micRecorder.mimeType || 'audio/webm' });
    micStream.getTracks().forEach(t => t.stop());
    setSceneNarrationFromBlob(scene, blob);
    btn.classList.remove('recording');
    if (status) status.textContent = 'Đang xử lý bản ghi…';
  };
  micRecorder.start();
  btn.classList.add('recording');
  if (status) status.textContent = 'Đang ghi âm… bấm lại để dừng';
}

// ---------------------------------------------------------------------
// 7. Render canvas (khung hình xem trước / lúc xuất)
// ---------------------------------------------------------------------
const canvas = document.getElementById('previewCanvas');
const ctx = canvas.getContext('2d');
const CW = canvas.width, CH = canvas.height;

function drawCover(mediaEl, naturalW, naturalH, extraScale, panX) {
  if (!naturalW || !naturalH) return;
  const mediaRatio = naturalW / naturalH;
  const canvasRatio = CW / CH;
  let drawW, drawH;
  if (mediaRatio > canvasRatio) { drawH = CH * extraScale; drawW = drawH * mediaRatio; }
  else { drawW = CW * extraScale; drawH = drawW / mediaRatio; }
  const baseX = (CW - drawW) / 2;
  const baseY = (CH - drawH) / 2;
  const maxPanX = Math.max(0, (drawW - CW) / 2);
  const x = baseX - maxPanX * panX;
  const y = baseY;
  ctx.drawImage(mediaEl, x, y, drawW, drawH);
}

function wrapText(text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawVignette() {
  const g = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.35, CW / 2, CH / 2, CH * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, CH);
}

function drawCaption(text) {
  if (!text) return;
  ctx.font = '600 34px "Be Vietnam Pro", sans-serif';
  const maxWidth = CW - 160;
  const lines = wrapText(text, maxWidth);
  const lineH = 44;
  const boxH = lines.length * lineH + 30;
  const boxY = CH - boxH - 36;
  ctx.fillStyle = 'rgba(10,8,5,0.62)';
  ctx.fillRect(0, boxY, CW, boxH);
  ctx.fillStyle = '#F5EFE3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillText(line, CW / 2, boxY + 22 + i * lineH + lineH / 2 - 6);
  });
  ctx.textAlign = 'left';
}

function drawEmptyFrame(msg) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#5b5142';
  ctx.font = '500 28px "Be Vietnam Pro", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg || '', CW / 2, CH / 2);
  ctx.textAlign = 'left';
}

// vẽ 1 khung hình cho scene tại progress 0..1 (dùng ảnh sẵn có, không phải video đang play)
const previewImgCache = new Map();
function getCachedImg(url) {
  if (previewImgCache.has(url)) return previewImgCache.get(url);
  const img = new Image();
  img.src = url;
  previewImgCache.set(url, img);
  return img;
}

function renderPreviewStatic() {
  const scene = getScene(selectedSceneId) || project.scenes[0];
  document.getElementById('stageEmptyHint').style.display = project.scenes.length === 0 ? 'flex' : 'none';
  if (!scene) { drawEmptyFrame(); return; }
  if (scene.type === 'image') {
    const img = getCachedImg(scene.mediaURL);
    const draw = () => {
      ctx.clearRect(0, 0, CW, CH);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
      const extraScale = scene.effect === 'kenburns' ? 1.04 : 1;
      drawCover(img, img.naturalWidth, img.naturalHeight, extraScale, -0.5);
      drawVignette();
      drawCaption(scene.caption);
    };
    if (img.complete) draw(); else img.onload = draw;
  } else {
    // video: hiển thị khung đầu tiên
    const v = document.createElement('video');
    v.src = scene.mediaURL; v.muted = true; v.currentTime = 0.01;
    v.onloadeddata = () => {
      ctx.clearRect(0, 0, CW, CH);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
      drawCover(v, v.videoWidth, v.videoHeight, 1, 0);
      drawVignette();
      drawCaption(scene.caption);
    };
  }
}

// ---------------------------------------------------------------------
// 8. Trình phát (player) — dùng chung cho xem trước và xuất video
// ---------------------------------------------------------------------
const player = {
  playing: false,
  exporting: false,
  currentIndex: -1,
  sceneStartMs: 0,
  pausedElapsed: 0,
  totalDuration: 0,
  rafId: null,
  audioCtx: null,
  musicGain: null,
  narrGain: null,
  destNode: null,
  musicSourceNode: null,
  narrSourceNode: null,
  videoSourceNode: null,
};

const hiddenVideo = document.createElement('video');
hiddenVideo.playsInline = true;
hiddenVideo.muted = false;
const narrAudio = document.createElement('audio');
const musicAudio = document.createElement('audio');
musicAudio.loop = true;

function ensureAudioGraph() {
  if (player.audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  player.audioCtx = new Ctx();
  player.musicGain = player.audioCtx.createGain();
  player.narrGain = player.audioCtx.createGain();
  player.destNode = player.audioCtx.createMediaStreamDestination();

  player.musicGain.gain.value = project.musicVolume;
  player.narrGain.gain.value = 1;

  player.musicGain.connect(player.audioCtx.destination);
  player.musicGain.connect(player.destNode);
  player.narrGain.connect(player.audioCtx.destination);
  player.narrGain.connect(player.destNode);

  player.musicSourceNode = player.audioCtx.createMediaElementSource(musicAudio);
  player.musicSourceNode.connect(player.musicGain);

  player.narrSourceNode = player.audioCtx.createMediaElementSource(narrAudio);
  player.narrSourceNode.connect(player.narrGain);

  player.videoSourceNode = player.audioCtx.createMediaElementSource(hiddenVideo);
  player.videoSourceNode.connect(player.narrGain);
}

function updateTimeReadout(currentOverride) {
  const cur = currentOverride != null ? currentOverride : getGlobalElapsed();
  document.getElementById('timeReadout').textContent = fmtTime(cur) + ' / ' + fmtTime(player.totalDuration);
}

function getGlobalElapsed() {
  let sum = 0;
  for (let i = 0; i < player.currentIndex; i++) sum += project.scenes[i].duration;
  if (player.currentIndex >= 0 && project.scenes[player.currentIndex]) {
    if (player.playing) sum += Math.min((performance.now() - player.sceneStartMs) / 1000, project.scenes[player.currentIndex].duration);
    else sum += player.pausedElapsed;
  }
  return sum;
}

function stopSceneMedia(scene) {
  if (!scene) return;
  if (scene.type === 'video') { hiddenVideo.pause(); }
  narrAudio.pause();
}

function startSceneMedia(scene, offsetSec) {
  if (scene.type === 'video') {
    hiddenVideo.src = scene.mediaURL;
    hiddenVideo.currentTime = offsetSec || 0;
    hiddenVideo.muted = !!(scene.narrationMode === 'record' || scene.narrationMode === 'upload');
    hiddenVideo.play().catch(() => {});
  }
  if (scene.narrationMode === 'record' || scene.narrationMode === 'upload') {
    if (scene.narrationURL) {
      narrAudio.src = scene.narrationURL;
      narrAudio.currentTime = offsetSec || 0;
      narrAudio.play().catch(() => {});
    }
  }
}

function goToScene(index, offsetSec) {
  if (player.currentIndex >= 0) stopSceneMedia(project.scenes[player.currentIndex]);
  player.currentIndex = index;
  player.sceneStartMs = performance.now() - (offsetSec || 0) * 1000;
  player.pausedElapsed = offsetSec || 0;
  const scene = project.scenes[index];
  if (scene) startSceneMedia(scene, offsetSec || 0);
}

function playFrom(globalTime) {
  ensureAudioGraph();
  if (player.audioCtx.state === 'suspended') player.audioCtx.resume();
  if (project.musicBlob && !musicAudio.src) { musicAudio.src = project.musicURL; }
  if (project.musicBlob) { musicAudio.currentTime = 0; musicAudio.play().catch(() => {}); }

  let sum = 0, idx = 0, local = 0;
  for (idx = 0; idx < project.scenes.length; idx++) {
    if (globalTime < sum + project.scenes[idx].duration) { local = globalTime - sum; break; }
    sum += project.scenes[idx].duration;
  }
  if (idx >= project.scenes.length) idx = 0, local = 0;
  goToScene(idx, local);
  player.playing = true;
  document.getElementById('iconPlay').style.display = 'none';
  document.getElementById('iconPause').style.display = 'block';
  tick();
}

function pausePlayback() {
  player.playing = false;
  player.pausedElapsed = getGlobalElapsedLocalOnly();
  if (player.currentIndex >= 0) stopSceneMedia(project.scenes[player.currentIndex]);
  musicAudio.pause();
  document.getElementById('iconPlay').style.display = 'block';
  document.getElementById('iconPause').style.display = 'none';
  cancelAnimationFrame(player.rafId);
}

function getGlobalElapsedLocalOnly() {
  const scene = project.scenes[player.currentIndex];
  if (!scene) return 0;
  return clamp((performance.now() - player.sceneStartMs) / 1000, 0, scene.duration);
}

function updateDucking() {
  const narrActive = (!narrAudio.paused && !narrAudio.ended) || (!hiddenVideo.paused && !hiddenVideo.muted);
  const target = narrActive ? project.musicVolume * 0.28 : project.musicVolume;
  if (player.musicGain) {
    player.musicGain.gain.setTargetAtTime(target, player.audioCtx.currentTime, 0.25);
  }
}

function tick() {
  if (!player.playing) return;
  const scene = project.scenes[player.currentIndex];
  if (!scene) { finishPlayback(); return; }
  const elapsed = (performance.now() - player.sceneStartMs) / 1000;

  if (elapsed >= scene.duration) {
    const nextIdx = player.currentIndex + 1;
    if (nextIdx >= project.scenes.length) { finishPlayback(); return; }
    goToScene(nextIdx, 0);
    player.rafId = requestAnimationFrame(tick);
    return;
  }

  const progress = clamp(elapsed / scene.duration, 0, 1);
  drawSceneFrame(scene, progress);
  updateDucking();
  updateTimeReadout();
  player.rafId = requestAnimationFrame(tick);
}

function drawSceneFrame(scene, progress) {
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  const extraScale = scene.effect === 'kenburns' ? 1 + 0.08 * progress : 1;
  const panX = scene.effect === 'kenburns' ? (-1 + 2 * progress) : 0;
  if (scene.type === 'image') {
    const img = getCachedImg(scene.mediaURL);
    if (img.complete && img.naturalWidth) drawCover(img, img.naturalWidth, img.naturalHeight, extraScale, panX);
  } else {
    if (hiddenVideo.readyState >= 2) drawCover(hiddenVideo, hiddenVideo.videoWidth, hiddenVideo.videoHeight, 1, 0);
  }
  drawVignette();
  drawCaption(scene.caption);
}

function finishPlayback() {
  player.playing = false;
  player.currentIndex = -1;
  player.pausedElapsed = 0;
  musicAudio.pause();
  narrAudio.pause();
  hiddenVideo.pause();
  document.getElementById('iconPlay').style.display = 'block';
  document.getElementById('iconPause').style.display = 'none';
  updateTimeReadout(player.totalDuration);
  if (player.exporting) finishExport();
  else renderPreviewStatic();
}

document.getElementById('btnPlay').addEventListener('click', () => {
  if (project.scenes.length === 0) return;
  if (player.playing) pausePlayback();
  else {
    const startAt = player.currentIndex === -1 ? 0 : getGlobalElapsed();
    playFrom(startAt >= player.totalDuration ? 0 : startAt);
  }
});

// ---------------------------------------------------------------------
// 9. Xuất video
// ---------------------------------------------------------------------
let mediaRecorder = null;
let recordedChunks = [];

function pickSupportedMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || null;
}

async function startExport() {
  if (project.scenes.length === 0) { toast('Chưa có cảnh nào để xuất'); return; }
  if (!window.MediaRecorder || typeof canvas.captureStream !== 'function') {
    toast('Trình duyệt này chưa hỗ trợ xuất video. Hãy dùng Chrome hoặc Edge trên máy tính.');
    return;
  }
  const mime = pickSupportedMime();
  if (!mime) {
    toast('Trình duyệt này chưa hỗ trợ định dạng xuất video nào. Hãy thử Chrome/Edge trên máy tính.');
    return;
  }

  ensureAudioGraph();
  if (player.audioCtx.state === 'suspended') await player.audioCtx.resume();

  const videoStream = canvas.captureStream(30);
  const audioTracks = player.destNode.stream.getAudioTracks();
  const combined = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(combined, { mimeType: mime });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mime.split(';')[0] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    a.href = url;
    a.download = (project.name || 'video') + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Đã xuất xong video!');
  };

  player.exporting = true;
  document.getElementById('exportOverlay').classList.remove('hidden');
  document.getElementById('exportStatus').textContent = 'Đang dựng: 0:00 / ' + fmtTime(player.totalDuration);
  document.getElementById('exportBarFill').style.width = '0%';

  mediaRecorder.start();
  playFrom(0);
  exportProgressLoop();
}

function exportProgressLoop() {
  if (!player.exporting) return;
  const elapsed = getGlobalElapsed();
  const pct = clamp((elapsed / player.totalDuration) * 100, 0, 100);
  document.getElementById('exportBarFill').style.width = pct + '%';
  document.getElementById('exportStatus').textContent = 'Đang dựng: ' + fmtTime(elapsed) + ' / ' + fmtTime(player.totalDuration);
  if (player.exporting) requestAnimationFrame(exportProgressLoop);
}

function finishExport() {
  player.exporting = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  document.getElementById('exportOverlay').classList.add('hidden');
}

function cancelExport() {
  player.exporting = false;
  pausePlayback();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.onstop = null; mediaRecorder.stop(); }
  document.getElementById('exportOverlay').classList.add('hidden');
  toast('Đã huỷ xuất video');
}

document.getElementById('btnExport').addEventListener('click', startExport);
document.getElementById('btnCancelExport').addEventListener('click', cancelExport);

// ---------------------------------------------------------------------
// 10. Nhạc nền
// ---------------------------------------------------------------------
document.getElementById('btnAddMusic').addEventListener('click', () => document.getElementById('musicFileInput').click());
document.getElementById('musicFileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (project.musicURL) URL.revokeObjectURL(project.musicURL);
  project.musicBlob = f;
  project.musicURL = URL.createObjectURL(f);
  project.musicName = f.name;
  musicAudio.src = project.musicURL;
  renderMusicBar();
  markDirty();
});
document.getElementById('btnRemoveMusic').addEventListener('click', () => {
  project.musicBlob = null; project.musicURL = null; project.musicName = '';
  musicAudio.src = '';
  renderMusicBar();
  markDirty();
});
document.getElementById('musicVolume').addEventListener('input', (e) => {
  project.musicVolume = parseInt(e.target.value, 10) / 100;
  document.getElementById('musicVolumeLabel').textContent = e.target.value + '%';
  if (player.musicGain) player.musicGain.gain.value = project.musicVolume;
  markDirty();
});
function renderMusicBar() {
  document.getElementById('musicName').textContent = project.musicName || 'Chưa có nhạc nền';
  document.getElementById('btnRemoveMusic').style.display = project.musicBlob ? 'inline-flex' : 'none';
  document.getElementById('musicVolume').value = Math.round(project.musicVolume * 100);
  document.getElementById('musicVolumeLabel').textContent = Math.round(project.musicVolume * 100) + '%';
}

// ---------------------------------------------------------------------
// 11. Quản lý dự án (mở/tạo mới/xoá)
// ---------------------------------------------------------------------
function reviveProjectRecord(record) {
  const scenes = (record.scenes || []).map(s => {
    const mediaURL = s.mediaBlob ? URL.createObjectURL(s.mediaBlob) : '';
    const narrationURL = s.narrationBlob ? URL.createObjectURL(s.narrationBlob) : null;
    return { ...s, mediaURL, narrationURL };
  });
  const musicURL = record.musicBlob ? URL.createObjectURL(record.musicBlob) : null;
  return {
    id: record.id, name: record.name || 'Dự án chưa đặt tên',
    scenes, musicBlob: record.musicBlob || null, musicURL,
    musicName: record.musicName || '', musicVolume: record.musicVolume != null ? record.musicVolume : 0.8,
    updatedAt: record.updatedAt || Date.now(),
  };
}

async function loadProject(id) {
  const record = await dbGet(id);
  if (!record) { toast('Không tìm thấy dự án'); return; }
  project = reviveProjectRecord(record);
  library = project.scenes.map(s => ({ id: uid(), type: s.type, blob: s.mediaBlob, url: s.mediaURL, name: s.type === 'image' ? 'Ảnh' : 'Video', naturalDuration: s.naturalDuration }));
  selectedSceneId = project.scenes[0] ? project.scenes[0].id : null;
  player.currentIndex = -1; player.pausedElapsed = 0;
  document.getElementById('projectNameInput').value = project.name;
  renderMusicBar();
  renderLibrary();
  renderFilmstrip();
  recomputeTotalDuration();
  renderInspector();
  renderPreviewStatic();
  setSaveIndicator('saved');
  closeProjectsModal();
}

function createNewProject() {
  project = { id: uid(), name: 'Dự án chưa đặt tên', scenes: [], musicBlob: null, musicURL: null, musicName: '', musicVolume: 0.8, updatedAt: Date.now() };
  library = [];
  selectedSceneId = null;
  player.currentIndex = -1; player.pausedElapsed = 0;
  document.getElementById('projectNameInput').value = project.name;
  renderMusicBar();
  renderLibrary();
  renderFilmstrip();
  recomputeTotalDuration();
  renderInspector();
  renderPreviewStatic();
  doSave();
  closeProjectsModal();
}

async function renderProjectsModal() {
  const list = await dbGetAllMeta();
  const el = document.getElementById('projectsList');
  if (list.length === 0) { el.innerHTML = '<div class="hint-text" style="padding:12px 4px;">Chưa có dự án nào được lưu.</div>'; return; }
  el.innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'project-row';
    const date = p.updatedAt ? new Date(p.updatedAt).toLocaleString('vi-VN') : '';
    row.innerHTML = `<span class="project-row-name">${p.name || '(không tên)'}</span><span class="project-row-date">${date}</span>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-icon btn-sm btn-danger';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Xoá dự án';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Xoá dự án "' + (p.name || '') + '"? Không thể hoàn tác.')) return;
      await dbDelete(p.id);
      if (p.id === project.id) createNewProject();
      renderProjectsModal();
    };
    row.appendChild(delBtn);
    row.onclick = () => loadProject(p.id);
    el.appendChild(row);
  });
}

function openProjectsModal() { document.getElementById('projectsModal').classList.remove('hidden'); renderProjectsModal(); }
function closeProjectsModal() { document.getElementById('projectsModal').classList.add('hidden'); }

document.getElementById('btnProjects').addEventListener('click', openProjectsModal);
document.getElementById('btnCloseProjects').addEventListener('click', closeProjectsModal);
document.getElementById('btnNewProject').addEventListener('click', createNewProject);

document.getElementById('projectNameInput').addEventListener('input', (e) => { project.name = e.target.value; markDirty(); });

// ---------------------------------------------------------------------
// 12. Ràng buộc UI khác
// ---------------------------------------------------------------------
document.getElementById('btnAddMedia').addEventListener('click', () => document.getElementById('mediaFileInput').click());
document.getElementById('mediaFileInput').addEventListener('change', (e) => { addFilesToLibrary(e.target.files); e.target.value = ''; });

document.getElementById('btnInspectorToggle').addEventListener('click', () => {
  const insp = document.getElementById('inspector');
  if (insp.classList.contains('open')) closeInspectorMobile(); else openInspectorMobile();
});
document.getElementById('inspectorBackdrop').addEventListener('click', closeInspectorMobile);

// ---------------------------------------------------------------------
// 13. Khởi động
// ---------------------------------------------------------------------
async function init() {
  renderLibrary();
  renderFilmstrip();
  renderMusicBar();
  recomputeTotalDuration();
  renderInspector();
  renderPreviewStatic();

  // Nạp dự án gần nhất nếu có, để Thầy không mất việc giữa các lần vào lại
  try {
    const list = await dbGetAllMeta();
    if (list.length > 0) await loadProject(list[0].id);
  } catch (e) { console.warn('Không nạp được dự án cũ', e); }
}

init();

})();
