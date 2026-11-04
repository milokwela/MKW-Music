// Фото перед отправкой, как в мессенджерах: несколько сразу, обрезка рамкой, поворот и рисование пальцем.
import { h, toast } from './ui.js?v=0.35.5';
import { mi } from './icons2.js?v=0.35.5';

const MAX_FILES = 10;
const COLORS = ['#ffffff', '#111111', '#ff3b5c', '#ffcc00', '#34d17a', '#3b8cff', '#ff7ad9'];
const SRC_MAX = 2048;

function loadFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, SRC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}
const newItem = (base) => ({ base, crop: { x: 0, y: 0, w: 1, h: 1 }, strokes: [] });

function drawStrokes(ctx, strokes, ox, oy, sw, sh) {
  const m = Math.min(sw, sh);
  for (const s of strokes) {
    if (!s.pts.length) continue;
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = s.s * m; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const P = s.pts.map(([x, y]) => [ox + x * sw, oy + y * sh]);
    if (P.length === 1) { ctx.beginPath(); ctx.arc(P[0][0], P[0][1], (s.s * m) / 2, 0, Math.PI * 2); ctx.fill(); continue; }
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length - 1; i += 1) { const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2; ctx.quadraticCurveTo(P[i][0], P[i][1], mx, my); }
    ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]); ctx.stroke();
  }
}

// готовое фото: обрезка + рисунок, JPEG до ~380 КБ (как и раньше — влезает в одно сообщение)
export function exportItem(it) {
  const bw = it.base.width, bh = it.base.height;
  const sx = it.crop.x * bw, sy = it.crop.y * bh, sw = it.crop.w * bw, sh = it.crop.h * bh;
  let scale = Math.min(1, 1280 / Math.max(sw, sh));
  for (let tries = 0; tries < 6; tries += 1) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    const x = c.getContext('2d');
    x.drawImage(it.base, sx, sy, sw, sh, 0, 0, c.width, c.height);
    // штрихи хранятся в долях всего фото — переводим в координаты обрезанного кадра
    x.save(); x.scale(c.width / sw, c.height / sh); x.translate(-sx, -sy);
    drawStrokes(x, it.strokes, 0, 0, bw, bh);
    x.restore();
    for (const q of [0.82, 0.7, 0.58]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 380000) return d; }
    scale *= 0.75;
  }
  return '';
}

function rotateItem(it) {
  // поворот по часовой: «запекаем» рисунок в фото, рамку поворачиваем вместе
  const b = it.base, c = document.createElement('canvas'); c.width = b.height; c.height = b.width;
  const x = c.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = b.width; tmp.height = b.height;
  const t = tmp.getContext('2d'); t.drawImage(b, 0, 0); drawStrokes(t, it.strokes, 0, 0, b.width, b.height);
  x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(tmp, 0, 0);
  const { x: cx, y: cy, w, h: ch } = it.crop;
  it.base = c; it.strokes = []; it.crop = { x: 1 - (cy + ch), y: cx, w: ch, h: w };
}

export function openPhotoEditor(files, { title = 'Фото', caption = '', onSend }) {
  const items = [];
  let cur = 0, mode = 'crop', color = COLORS[2], size = 0.012;
  const canvas = h('canvas', { class: 'pe2-cv' });
  const stage = h('div', { class: 'pe2-stage' }, canvas);
  const ctx = canvas.getContext('2d');
  const thumbs = h('div', { class: 'pe2-thumbs' });
  const cap = h('input', { class: 'pe2-cap', type: 'text', maxlength: '500', placeholder: 'Подпись', value: caption });
  const sendBtn = h('button', { type: 'button', class: 'pe2-send', 'aria-label': 'Отправить' }, mi('send'), h('b', { class: 'pe2-n' }));
  const more = h('input', { type: 'file', accept: 'image/*', multiple: '', hidden: '' });
  const tool = (id, ic, label) => h('button', { type: 'button', class: 'pe2-tool', 'data-m': id, title: label, onclick: () => setMode(id) }, mi(ic), h('span', { text: label }));
  const undoBtn = h('button', { type: 'button', class: 'pe2-tool', title: 'Отменить', onclick: () => { const it = items[cur]; if (it && it.strokes.length) { it.strokes.pop(); paint(); } } }, mi('reply'), h('span', { text: 'Назад' }));
  const tools = h('div', { class: 'pe2-tools' },
    tool('crop', 'fullscreen', 'Обрезать'), tool('draw', 'edit', 'Рисовать'),
    h('button', { type: 'button', class: 'pe2-tool', title: 'Повернуть', onclick: () => { const it = items[cur]; if (it) { rotateItem(it); fit(); paintThumbs(); } } }, mi('screen'), h('span', { text: 'Повернуть' })),
    h('button', { type: 'button', class: 'pe2-tool', title: 'Сбросить рамку', onclick: () => { const it = items[cur]; if (it) { it.crop = { x: 0, y: 0, w: 1, h: 1 }; paint(); } } }, mi('close'), h('span', { text: 'Сброс' })),
    undoBtn);
  const palette = h('div', { class: 'pe2-pal' }, ...COLORS.map((c) => h('button', { type: 'button', class: 'pe2-col', style: `--c:${c}`, 'data-c': c, onclick: () => { color = c; paintPal(); } })),
    h('input', { type: 'range', class: 'pe2-size', min: '4', max: '40', value: '12', oninput: (e) => { size = Number(e.target.value) / 1000; } }));
  const head = h('div', { class: 'pe2-head' },
    h('button', { type: 'button', class: 'pe2-x', 'aria-label': 'Закрыть', onclick: () => close() }, mi('close')),
    h('b', { class: 'pe2-title', text: title }));
  const box = h('div', { class: 'pe2', role: 'dialog', 'aria-label': 'Отправка фото' }, head, stage, tools, palette,
    h('div', { class: 'pe2-bottom' }, thumbs, h('div', { class: 'pe2-row' }, cap, sendBtn)), more);
  const close = () => { box.classList.remove('show'); window.removeEventListener('resize', fit); setTimeout(() => box.remove(), 250); };

  // ---- рисование кадра ----
  let view = { k: 1, ox: 0, oy: 0, w: 0, h: 0 };
  function fit() {
    const it = items[cur]; if (!it) return;
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const pad = 16, aw = Math.max(50, r.width - pad * 2), ah = Math.max(50, r.height - pad * 2);
    const k = Math.min(aw / it.base.width, ah / it.base.height);
    const w = it.base.width * k, hh = it.base.height * k;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
    view = { k, ox: (r.width - w) / 2, oy: (r.height - hh) / 2, w, h: hh, dpr };
    paint();
  }
  function paint() {
    const it = items[cur]; if (!it) return;
    const { ox, oy, w, h: hh, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(it.base, ox, oy, w, hh);
    drawStrokes(ctx, it.strokes, ox, oy, w, hh);
    const c = it.crop, cx = ox + c.x * w, cy = oy + c.y * hh, cw = c.w * w, ch = c.h * hh;
    // затемняем всё, что не попадёт в фото
    ctx.fillStyle = mode === 'crop' ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.rect(ox, oy, w, hh); ctx.rect(cx, cy, cw, ch); ctx.fill('evenodd');
    if (mode === 'crop') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(cx, cy, cw, ch);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      for (let i = 1; i < 3; i += 1) { ctx.beginPath(); ctx.moveTo(cx + (cw * i) / 3, cy); ctx.lineTo(cx + (cw * i) / 3, cy + ch); ctx.moveTo(cx, cy + (ch * i) / 3); ctx.lineTo(cx + cw, cy + (ch * i) / 3); ctx.stroke(); }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const L = Math.min(22, cw / 3, ch / 3);
      for (const [px, py, dx, dy] of [[cx, cy, 1, 1], [cx + cw, cy, -1, 1], [cx, cy + ch, 1, -1], [cx + cw, cy + ch, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(px + dx * L, py); ctx.lineTo(px, py); ctx.lineTo(px, py + dy * L); ctx.stroke();
      }
    }
  }
  function paintPal() { [...palette.querySelectorAll('.pe2-col')].forEach((b) => b.classList.toggle('on', b.dataset.c === color)); }
  function setMode(m) {
    mode = m; box.dataset.mode = m;
    [...tools.querySelectorAll('[data-m]')].forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    paint();
  }
  function paintThumbs() {
    thumbs.replaceChildren(...items.map((it, i) => {
      const t = document.createElement('canvas'); const k = 56 / Math.max(it.base.width, it.base.height);
      t.width = Math.round(it.base.width * k); t.height = Math.round(it.base.height * k); t.getContext('2d').drawImage(it.base, 0, 0, t.width, t.height);
      return h('div', { class: `pe2-th${i === cur ? ' on' : ''}`, onclick: () => { cur = i; fit(); paintThumbs(); } }, t,
        items.length > 1 ? h('button', { type: 'button', class: 'pe2-th-x', 'aria-label': 'Убрать', onclick: (e) => { e.stopPropagation(); items.splice(i, 1); cur = Math.min(cur, items.length - 1); fit(); paintThumbs(); } }, mi('close')) : null);
    }), items.length < MAX_FILES ? h('button', { type: 'button', class: 'pe2-add', title: 'Добавить фото', onclick: () => more.click() }, mi('add')) : null);
    sendBtn.querySelector('.pe2-n').textContent = items.length > 1 ? String(items.length) : '';
    box.querySelector('.pe2-title').textContent = items.length > 1 ? `${title} · ${cur + 1} из ${items.length}` : title;
  }

  // ---- пальцем / мышью ----
  const toImg = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - view.ox) / view.w, (e.clientY - r.top - view.oy) / view.h]; };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const it = items[cur]; if (!it) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const [x, y] = toImg(e);
    if (mode === 'draw') {
      const s = { c: color, s: size, pts: [[x, y]] }; it.strokes.push(s); drag = { kind: 'draw', s }; paint(); return;
    }
    const c = it.crop, tol = 26 / Math.min(view.w, view.h);
    const corners = { tl: [c.x, c.y], tr: [c.x + c.w, c.y], bl: [c.x, c.y + c.h], br: [c.x + c.w, c.y + c.h] };
    let hit = '';
    for (const [k, [px, py]] of Object.entries(corners)) if (Math.abs(x - px) < tol && Math.abs(y - py) < tol) hit = k;
    if (!hit && x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) hit = 'move';
    if (!hit) {
      // мимо рамки — ближайшая сторона едет к пальцу
      const d = { l: Math.abs(x - c.x), r: Math.abs(x - (c.x + c.w)), t: Math.abs(y - c.y), b: Math.abs(y - (c.y + c.h)) };
      hit = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
    }
    drag = { kind: hit, x, y, c0: { ...c } };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const it = items[cur]; const [x, y] = toImg(e);
    if (drag.kind === 'draw') { drag.s.pts.push([x, y]); paint(); return; }
    const MIN = 0.08, c0 = drag.c0, dx = x - drag.x, dy = y - drag.y;
    let { x: L, y: T } = c0; let R = c0.x + c0.w, B = c0.y + c0.h;
    if (drag.kind === 'move') { L = Math.max(0, Math.min(1 - c0.w, c0.x + dx)); T = Math.max(0, Math.min(1 - c0.h, c0.y + dy)); R = L + c0.w; B = T + c0.h; }
    else {
      if (/l/.test(drag.kind)) L = Math.max(0, Math.min(R - MIN, c0.x + dx));
      if (/r/.test(drag.kind)) R = Math.min(1, Math.max(L + MIN, c0.x + c0.w + dx));
      if (/t/.test(drag.kind)) T = Math.max(0, Math.min(B - MIN, c0.y + dy));
      if (/b/.test(drag.kind)) B = Math.min(1, Math.max(T + MIN, c0.y + c0.h + dy));
    }
    it.crop = { x: L, y: T, w: R - L, h: B - T };
    paint();
  });
  const up = () => { drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  const add = async (list) => {
    const arr = [...list].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name)).slice(0, MAX_FILES - items.length);
    if (!arr.length) return;
    for (const f of arr) { try { items.push(newItem(await loadFile(f))); } catch { toast(`Не получилось открыть ${f.name || 'фото'}`); } }
    if (!items.length) { close(); return; }
    fit(); paintThumbs();
  };
  more.addEventListener('change', () => { const l = more.files; add(l).finally(() => { more.value = ''; }); });
  sendBtn.addEventListener('click', async () => {
    if (!items.length || sendBtn.disabled) return;
    sendBtn.disabled = true; box.classList.add('busy');
    const out = items.map(exportItem).filter(Boolean);
    if (!out.length) { toast('Не получилось подготовить фото'); sendBtn.disabled = false; box.classList.remove('busy'); return; }
    try { await onSend(out, cap.value.trim()); close(); }
    catch { toast('Фото не отправилось. Попробуйте ещё раз'); sendBtn.disabled = false; box.classList.remove('busy'); }
  });
  cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); } });
  document.addEventListener('keydown', function esc(e) { if (!box.isConnected) { document.removeEventListener('keydown', esc); return; } if (e.key === 'Escape') close(); });

  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  setMode('crop'); paintPal();
  window.addEventListener('resize', fit);
  add(files).then(() => { if (items.length) requestAnimationFrame(fit); });
  return { close };
}
