// Интерфейс: HUD, инвентарь с перетаскиванием, крафт, контейнеры, карта, чат, пауза.
import * as C from './config.js';
import { ITEMS, RECIPES, CAT_NAMES, STATION_NAMES, QUESTS, SLOT_NAMES, xpNeed } from './items.js';
import { HOTBAR, INV_SIZE, ARMOR_AT, TOTAL } from './inventory.js';
import { BLOCK_TYPES } from './blocks.js';
import { ZTYPES } from './zombies.js';
import { runCommand, complete, describe } from './console.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');

export function buildSettings(el, s, onChange) {
  const rows = [
    ['view', 'Дальность прорисовки', 2, 6, 1, v => v * 100 + ' м'],
    ['fov', 'Поле зрения', 60, 100, 1, v => v + '°'],
    ['sens', 'Чувствительность мыши', 0.2, 3, 0.05, v => v.toFixed(2)],
    ['volume', 'Громкость', 0, 1, 0.05, v => Math.round(v * 100) + '%'],
    ['scale', 'Качество рендера', 0.5, 1.5, 0.05, v => Math.round(v * 100) + '%'],
  ];
  el.innerHTML = '';
  for (const [k, label, mn, mx, st, fmt] of rows) {
    const l = document.createElement('label'); l.textContent = label;
    const r = document.createElement('input'); r.type = 'range'; r.min = mn; r.max = mx; r.step = st; r.value = s[k];
    const v = document.createElement('span'); v.className = 'val'; v.textContent = fmt(+s[k]);
    r.oninput = () => { s[k] = +r.value; v.textContent = fmt(+r.value); onChange(k); };
    el.append(l, r, v);
  }
  const l = document.createElement('label'); l.textContent = 'Тени';
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = s.shadows;
  c.onchange = () => { s.shadows = c.checked; onChange('shadows'); };
  const sp = document.createElement('span');
  el.append(l, c, sp);
}

export class UI {
  constructor(icons, sfx, canvas) {
    this.icons = icons; this.sfx = sfx; this.canvas = canvas;
    this.g = null;
    this.captured = false; this.typing = false; this.panel = null;
    this.dirtyHud = true;
    this.contCid = null; this.contItems = []; this.contName = '';
    this.drag = null; this.lastClick = { i: -1, t: 0 };
    this.hudT = 0;
    this.mapView = { zoom: 1, cx: 0, cz: 0 };
    this.picked = null; this.hover = null; this.craftTab = 'all';
    this.lockAt = 0; this.relockPending = false;
    // после закрытия панели по Esc захватываем мышь только когда клавишу отпустили:
    // иначе браузер тут же снимает захват и открывается меню паузы
    window.addEventListener('keyup', e => {
      if (e.code === 'Escape' && this.relockPending) { this.relockPending = false; setTimeout(() => this.lock(), 60); }
    });
    this.buildHotbar();
    this.buildInvGrid();
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    canvas.addEventListener('click', () => { if (this.g && !this.panel) this.lock(); });
    $('click-to-play').addEventListener('click', () => this.lock());
    const ci = $('chat-input');
    ci.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Enter') { const t = ci.value.trim(); if (t && this.g) this.g.sendChat(t); this.closeChat(); }
      else if (e.code === 'Escape') this.closeChat();
    });
    this.bindConsole();
    window.addEventListener('pointermove', e => this.onDragMove(e));
    window.addEventListener('pointerup', e => this.onDragEnd(e));
    $('cont-takeall').onclick = () => { if (this.g && this.contCid) this.g.takeAll(this.contCid, this.contItems); };
    $('inv').addEventListener('pointerdown', e => {
      if (e.target !== $('inv')) return;
      if (this.picked != null && this.g) { const i = this.picked; this.setPicked(null); this.g.dropFromInv(i); return; }
      this.closePanel();
    });
    this.bindMap();
  }

  attach(g) {
    this.g = g;
    this.panel = null;
    this.dirtyHud = true;
    $('hud').classList.remove('hidden');
    $('chat-log').innerHTML = '';
    $('feed').innerHTML = '';
    g.inv.onChange = () => { this.dirtyHud = true; if (this.panel === 'inv') this.renderInv(); };
    $('p-resume').onclick = () => this.closePanel();
    $('p-quit').onclick = () => g.quit();
    $('p-save').onclick = () => g.saveAll(true);
    $('p-settings-btn').onclick = () => {
      const el = $('pause-settings');
      el.classList.toggle('hidden');
      buildSettings(el, g.settings, k => g.applySettings(k));
    };
    $('d-respawn').onclick = () => { g.respawn(false); this.closePanel(); };
    $('d-bed').onclick = () => { g.respawn(true); this.closePanel(); };
    $('v-continue').onclick = () => this.closePanel();
    $('v-menu').onclick = () => g.quit();
  }

  detach() {
    this.g = null;
    this.hideAll();
    $('hud').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hideAll() {
    for (const id of ['inv', 'map', 'pause', 'death', 'victory', 'console']) $(id).classList.add('hidden');
    this.panel = null;
  }

  // ---------- захват мыши ----------
  lock() {
    if (!this.g || this.panel) return;
    this.sfx.init();
    // unadjustedMovement поддерживается не везде — тогда пробуем обычный захват
    const req = opts => {
      try { return Promise.resolve(this.canvas.requestPointerLock(opts)); } catch (e) { return Promise.reject(e); }
    };
    req({ unadjustedMovement: true }).catch(() => req().catch(() => {}));
  }

  onLockChange() {
    this.captured = document.pointerLockElement === this.canvas;
    if (this.captured) this.lockAt = performance.now();
    $('click-to-play').classList.toggle('hidden', this.captured || !!this.panel || !this.g);
    if (!this.captured && this.g && !this.panel) {
      if (this.typing) this.closeChat();
      // захват сорвался сразу после закрытия панели — это не просьба о паузе
      if (performance.now() - this.lockAt < 700 || this.relockPending) { $('click-to-play').classList.remove('hidden'); return; }
      this.showPause();
    }
  }

  openPanel(name) {
    this.hideAll();
    this.panel = name;
    $(name).classList.remove('hidden');
    $('click-to-play').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.g) this.g.blocks.hideGhost();
  }

  closePanel(viaEsc = false) {
    if (this.panel === 'inv' && this.contCid && this.g) { this.g.closeContainer(this.contCid); }
    if (this.panel === 'death') return;
    this.contCid = null;
    this.setPicked(null);
    this.hover = null;
    $('cont-box').classList.add('hidden');
    $('tooltip').classList.add('hidden');
    this.hideAll();
    // Esc ещё зажат — ждём, пока отпустят; уже отпущен — захватываем чуть позже
    if (viaEsc && this.g && this.g.input.keys.has('Escape')) this.relockPending = true;
    else if (viaEsc) setTimeout(() => this.lock(), 150);
    else this.lock();
    $('click-to-play').classList.toggle('hidden', this.captured || viaEsc);
  }

  // клавиши, когда открыта панель или для открытия панелей
  handleKeys(pressed) {
    const g = this.g;
    if (!g || this.typing) return;
    if (pressed.has('Escape') && this.panel && this.panel !== 'death' && this.panel !== 'pause') { this.closePanel(true); return; }
    if (this.panel === 'inv') this.invKeys(pressed);
    if (pressed.has('KeyE') && this.panel === 'inv' && !this.typingInField()) { this.closePanel(); return; }
    if (pressed.has('Tab') || pressed.has('KeyI')) {
      if (this.panel === 'inv') this.closePanel();
      else if (!this.panel && g.player.alive) this.openInv();
    }
    if (pressed.has('KeyM')) {
      if (this.panel === 'map') this.closePanel();
      else if (!this.panel) this.openMap();
    }
    if (pressed.has('Enter') && !this.panel && this.captured) this.openChat();
    if (pressed.has('Backquote') && !this.panel) this.openConsole();
  }

  // ---------- консоль тестового мира ----------
  bindConsole() {
    const ci = $('con-input');
    this.conLines = null; this.conHist = []; this.conHistI = 0;
    ci.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const t = ci.value.trim();
        ci.value = ''; $('con-hint').textContent = '';
        if (!t || !this.g) return;
        if (this.conHist[this.conHist.length - 1] !== t) this.conHist.push(t);
        this.conHistI = this.conHist.length;
        this.conOut('› ' + t, 'cmd');
        runCommand(this.g, t, (s, c) => this.conOut(s, c));
      } else if (e.code === 'Escape') { e.preventDefault(); this.closeConsole(true); }
      else if (e.code === 'Backquote') { e.preventDefault(); this.closeConsole(false); }
      else if (e.code === 'Tab') { e.preventDefault(); this.conComplete(); }
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const n = this.conHist.length;
        this.conHistI = Math.max(0, Math.min(n, this.conHistI + (e.code === 'ArrowUp' ? -1 : 1)));
        ci.value = this.conHist[this.conHistI] || '';
      }
    });
    ci.addEventListener('input', () => {
      const v = ci.value;
      $('con-hint').textContent = v && this.g ? complete(this.g, v).map(s => describe(v, s)).join('   ') : '';
    });
  }

  openConsole() {
    const g = this.g;
    if (!g) return;
    if (!g.level.test) { this.toast('Консоль есть только в тестовом мире'); return; }
    this.openPanel('console');
    this.typing = true;
    if (!this.conLines) {
      this.conLines = [];
      this.conOut('Консоль тестового мира. help — команды, Tab — дополнить, ↑↓ — история, Ё или Esc — закрыть.', 'head');
    } else this.renderConsole();
    const ci = $('con-input');
    ci.value = ''; $('con-hint').textContent = '';
    setTimeout(() => ci.focus(), 0);
  }

  closeConsole(viaEsc) {
    this.typing = false;
    $('con-input').blur();
    // по Esc захватываем мышь, только когда клавишу отпустят, — иначе браузер откроет паузу
    if (viaEsc) { this.relockPending = true; this.hideAll(); } else this.closePanel();
  }

  conOut(text, cls = '') {
    if (!this.conLines) this.conLines = [];
    for (const t of String(text).split('\n')) this.conLines.push({ t, cls });
    if (this.conLines.length > 400) this.conLines.splice(0, this.conLines.length - 400);
    if (this.panel === 'console') this.renderConsole();
  }

  conClear() { this.conLines = []; this.renderConsole(); }

  renderConsole() {
    const log = $('con-log');
    log.innerHTML = (this.conLines || []).map(l => `<div class="${l.cls}">${esc(l.t)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  // Tab: один вариант — подставить, несколько — показать списком
  conComplete() {
    const ci = $('con-input'), v = ci.value;
    const list = complete(this.g, v);
    if (list.length === 1) {
      const parts = v.replace(/^\s+/, '').split(/\s+/);
      ci.value = (parts.length <= 1 ? list[0] : parts[0] + ' ' + list[0]) + ' ';
      $('con-hint').textContent = '';
    } else $('con-hint').textContent = list.map(s => describe(v, s)).join('   ');
  }

  // ---------- чат ----------
  openChat() {
    this.typing = true;
    $('chat').classList.add('open');
    const ci = $('chat-input');
    ci.value = '';
    setTimeout(() => ci.focus(), 0);
  }

  closeChat() {
    this.typing = false;
    $('chat').classList.remove('open');
    $('chat-input').blur();
  }

  chat(name, text, color) {
    const d = document.createElement('div');
    d.innerHTML = name ? `<b style="color:${hex(color || 0xffffff)}">${esc(name)}:</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
    const log = $('chat-log');
    log.appendChild(d);
    while (log.children.length > 9) log.firstChild.remove();
  }

  // ---------- сообщения ----------
  toast(text, big = false) {
    const t = $('toast');
    if (t.lastChild && t.lastChild.textContent === text) return;
    const d = document.createElement('div');
    if (big) d.className = 'big';
    d.textContent = text;
    t.appendChild(d);
    setTimeout(() => d.remove(), big ? 6000 : 3500);
    while (t.children.length > 4) t.firstChild.remove();
  }

  feed(html) {
    const f = $('feed');
    const d = document.createElement('div');
    d.innerHTML = html;
    f.appendChild(d);
    setTimeout(() => d.remove(), 7000);
    while (f.children.length > 6) f.firstChild.remove();
  }

  savedNote(text) {
    const el = $('saved');
    el.textContent = '✓ ' + text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  pickupNote(id, n) {
    this.feed(`<span class="pickup">+${n} ${esc(ITEMS[id].name)}</span>`);
  }

  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.toggle('head', !!head);
    h.style.transition = 'none'; h.style.opacity = 1;
    requestAnimationFrame(() => { h.style.transition = 'opacity 0.25s'; h.style.opacity = 0; });
  }

  setScope(on) {
    if (this._scope === on) return;
    this._scope = on;
    $('scope').style.display = on ? 'block' : 'none';
    $('crosshair').style.display = on ? 'none' : '';
  }

  // ---------- HUD ----------
  buildHotbar() {
    const hb = $('hotbar');
    hb.innerHTML = '';
    this.hotSlots = [];
    for (let i = 0; i < HOTBAR; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      hb.appendChild(s);
      this.hotSlots.push(s);
    }
  }

  slotHTML(it, key) {
    if (!it) return key ? `<span class="k">${key}</span>` : '';
    const def = ITEMS[it.id];
    let h = `<img src="${this.icons[it.id] || ''}">`;
    if (key) h += `<span class="k">${key}</span>`;
    if (def.cat === 'gun') h += `<span class="n">${it.ammo}</span><span class="am"><i style="width:${Math.round(it.ammo / def.mag * 100)}%"></i></span>`;
    else if (def.cat === 'armor') h += `<span class="am dur"><i style="width:${Math.round(Math.max(0, (it.dur ?? def.dur) / def.dur) * 100)}%"></i></span>`;
    else if (it.n > 1) h += `<span class="n">${it.n}</span>`;
    return h;
  }

  update(dt) {
    const g = this.g;
    if (!g) return;
    const P = g.player;
    if (this.dirtyHud) {
      this.dirtyHud = false;
      for (let i = 0; i < HOTBAR; i++) {
        const s = this.hotSlots[i];
        s.innerHTML = this.slotHTML(g.inv.slots[i], i + 1);
        s.classList.toggle('sel', i === P.sel);
      }
      const it = g.inv.slots[P.sel];
      const def = it ? ITEMS[it.id] : null;
      const am = $('ammo');
      if (def && def.cat === 'gun') am.innerHTML = g.level.infAmmo
        ? `<div class="a">∞</div><div class="w">${esc(def.name)}</div>`
        : `<div class="a">${it.ammo} <small>/ ${g.inv.count(def.ammo)}</small></div><div class="w">${esc(def.name)}</div>`;
      else if (def) am.innerHTML = `<div class="w">${esc(def.name)}${it.n > 1 ? ' ×' + it.n : ''}</div>`;
      else am.innerHTML = `<div class="w">Кулаки</div>`;
    }
    this.hudT -= dt;
    const fpsEl = $('fps');
    if (this.showFps) {
      this.fpsS = this.fpsS ? this.fpsS * 0.93 + 0.07 / Math.max(dt, 1e-3) : 1 / Math.max(dt, 1e-3);
      this.fpsT = (this.fpsT || 0) - dt;
      if (this.fpsT <= 0) { this.fpsT = 0.25; fpsEl.textContent = Math.round(this.fpsS) + ' FPS'; }
      fpsEl.style.display = 'block';
    } else fpsEl.style.display = 'none';
    // полосы — каждый кадр
    const bars = $('stats').querySelectorAll('.sb i');
    const arm = g.inv.armorBar();
    const vals = [P.hp / P.maxHp, P.stamina / P.perks.stamina, P.food / 100, P.water / 100, arm];
    bars.forEach((b, i) => { b.style.width = Math.max(0, Math.min(100, vals[i] * 100)) + '%'; });
    const st = $('stats').children;
    st[4].style.display = arm > 0 ? '' : 'none';
    for (let i = 0; i < 4; i++) st[i].classList.toggle('low', vals[i] < 0.2);
    const W = g.weapons;
    const ub = $('usebar');
    if (W.useT > 0 || W.reloadT > 0) {
      ub.style.display = 'block';
      const p = W.useT > 0 ? 1 - W.useT / W.useMax : 1 - W.reloadT / W.reloadMax;
      ub.firstChild.style.width = Math.round(p * 100) + '%';
    } else ub.style.display = 'none';
    $('vignette').style.opacity = Math.min(1, P.dmgFlash * 0.9 + (P.hp / P.maxHp < 0.3 ? 0.35 : 0));
    // прицел расходится при движении
    const sp = Math.min(16, 4 + Math.hypot(P.vel.x, P.vel.z) * 1.6 + (P.grounded ? 0 : 6)) * (1 - W.ads * 0.8);
    const ch = $('crosshair').children;
    ch[0].style.top = (-sp - 8) + 'px'; ch[1].style.top = sp + 'px';
    ch[2].style.left = (-sp - 8) + 'px'; ch[3].style.left = sp + 'px';
    this.drawCompass();
    if (this.hudT <= 0) {
      this.hudT = 0.25;
      const hh = Math.floor(g.dayTime * 24), mm = Math.floor((g.dayTime * 24 - hh) * 60);
      let ct = `День ${g.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      const B = C.BIOMES[g.biomeHere()];
      ct += `<br><span class="bio">${B.name} · опасность ${'●'.repeat(B.danger)}${'○'.repeat(3 - B.danger)}</span>`;
      if (g.hordeActive) ct += `<br><span class="horde">КРОВАВАЯ ЛУНА</span>`;
      else if (g.day % C.HORDE_EVERY === 0) ct += `<br><span class="horde">орда этой ночью</span>`;
      $('clock').innerHTML = ct;
      const n = g.roster.size;
      $('room').innerHTML = g.solo ? `${esc(g.level.name)} · ${esc(g.level.diff.name.toLowerCase())} · одиночная игра`
        : (g.isHost ? `Комната <b>${esc(g.code)}</b> · игроков ${n}/${C.MAX_PLAYERS}` : `Комната <b>${esc(g.code)}</b> · игроков ${n}`);
      const xpN = xpNeed(P.level);
      $('xp').querySelector('i').style.width = Math.min(100, P.xp / xpN * 100) + '%';
      $('xp-lvl').textContent = 'УР ' + P.level;
      $('objective').innerHTML = g.objectiveHTML();
    }
    const boss = g.nearestBoss();
    const bb = $('bossbar');
    if (boss) {
      bb.style.display = 'block';
      bb.querySelector('b').textContent = '☠ ' + boss.T.name;
      bb.querySelector('i').style.width = Math.max(0, boss.hpf * 100) + '%';
    } else bb.style.display = 'none';
  }

  drawCompass() {
    const g = this.g;
    const cv = $('compass'), x = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(12,14,16,0.55)';
    x.fillRect(0, 0, W, H);
    const heading = ((-g.player.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const ppd = W / 150;
    x.textAlign = 'center';
    for (let d = -80; d <= 80; d += 5) {
      const a = Math.round(heading + d);
      const deg = ((Math.floor(a / 5) * 5) % 360 + 360) % 360;
      const px = W / 2 + (Math.floor(a / 5) * 5 - heading) * ppd;
      if (px < 0 || px > W) continue;
      const lbl = { 0: 'С', 90: 'В', 180: 'Ю', 270: 'З', 45: 'СВ', 135: 'ЮВ', 225: 'ЮЗ', 315: 'СЗ' }[deg];
      x.fillStyle = lbl ? '#e8e4da' : 'rgba(232,228,218,0.5)';
      if (lbl) { x.font = (lbl.length === 1 ? '700 15px' : '500 11px') + ' Rubik'; x.fillText(lbl, px, 21); }
      else if (deg % 15 === 0) x.fillRect(px - 0.5, 22, 1, 8);
      else x.fillRect(px - 0.5, 26, 1, 4);
    }
    for (const m of g.compassMarkers()) {
      const dx = m.x - g.player.pos.x, dz = m.z - g.player.pos.z;
      const b = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      let rel = b - heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      if (Math.abs(rel) > 75) continue;
      const px = W / 2 + rel * ppd;
      x.fillStyle = m.color;
      x.beginPath(); x.moveTo(px, 2); x.lineTo(px - 5, 9); x.lineTo(px + 5, 9); x.fill();
    }
    x.fillStyle = '#d9b44a';
    x.fillRect(W / 2 - 1, 0, 2, 6);
  }

  // ---------- инвентарь ----------
  buildInvGrid() {
    const gr = $('inv-grid');
    gr.innerHTML = '';
    this.invSlots = [];
    for (let i = 0; i < INV_SIZE; i++) {
      if (i === HOTBAR) { const gap = document.createElement('div'); gap.className = 'row-gap'; gap.textContent = 'рюкзак'; gr.appendChild(gap); }
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.src = 'inv'; s.dataset.i = i;
      gr.appendChild(s);
      this.invSlots.push(s);
    }
    // слоты брони — в колонке выжившего
    const ag = $('inv-armor');
    ag.innerHTML = '';
    for (const k of ['head', 'body', 'legs']) {
      const s = document.createElement('div');
      s.className = 'slot arm';
      s.dataset.src = 'inv'; s.dataset.i = ARMOR_AT[k]; s.dataset.label = SLOT_NAMES[k];
      ag.appendChild(s);
      this.invSlots[ARMOR_AT[k]] = s;
    }
    for (const el of [$('inv-grid'), $('cont-grid'), ag]) {
      el.addEventListener('pointerdown', e => this.onDragStart(e));
      el.addEventListener('pointermove', e => this.onHover(e));
      el.addEventListener('pointerleave', () => { this.hover = null; $('tooltip').classList.add('hidden'); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.onRightClick(e); });
    }
    $('inv-sort').onclick = () => { if (this.g) { this.setPicked(null); this.g.inv.sort(); this.sfx.click(); } };
    $('cont-putall').onclick = () => { if (this.g && this.contCid) { this.setPicked(null); this.g.putAll(this.contCid); } };
    const search = $('craft-search');
    search.addEventListener('input', () => this.renderCraft());
    search.addEventListener('keydown', e => { e.stopPropagation(); if (e.code === 'Escape') search.blur(); });
    $('craft-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) { this.craftTab = b.dataset.tab; this.sfx.click(); this.renderCraft(); }
    });
  }

  typingInField() {
    const a = document.activeElement;
    return a && a.tagName === 'INPUT';
  }

  openInv() {
    this.openPanel('inv');
    if (!this.contCid) $('cont-box').classList.add('hidden');
    this.renderInv();
  }

  openContainer(cid, name, items) {
    this.contCid = cid; this.contName = name; this.contItems = items;
    if (this.panel !== 'inv') this.openPanel('inv');
    $('cont-box').classList.remove('hidden');
    $('cont-title').textContent = name;
    this.renderInv();
  }

  updateContainer(cid, items) {
    if (cid !== this.contCid) return;
    this.contItems = items;
    if (this.panel === 'inv') this.renderCont();
  }

  renderInv() {
    const g = this.g;
    if (!g) return;
    if (this.picked != null && !g.inv.slots[this.picked]) this.setPicked(null);
    for (let i = 0; i < TOTAL; i++) {
      const s = this.invSlots[i];
      s.innerHTML = this.slotHTML(g.inv.slots[i], i < HOTBAR ? i + 1 : '');
      s.classList.toggle('sel', i === g.player.sel);
      s.classList.toggle('picked', i === this.picked);
    }
    this.renderCont();
    this.renderCraft();
    this.renderChar();
  }

  renderCont() {
    if (!this.contCid) return;
    const cg = $('cont-grid');
    const cap = Math.max(10, Math.ceil((this.contItems.length + 1) / 5) * 5);
    let h = '';
    for (let i = 0; i < Math.min(cap, 30); i++) h += `<div class="slot" data-src="cont" data-i="${i}">${this.slotHTML(this.contItems[i] || null)}</div>`;
    cg.innerHTML = h;
  }

  renderCraft() {
    const g = this.g, P = g.player;
    const TABS = [['all', 'Все'], ['can', 'Можно создать'], ['tools', 'Инструменты'], ['weap', 'Оружие'], ['armor', 'Броня'], ['build', 'Постройки'], ['food', 'Еда'], ['mat', 'Материалы']];
    const tabOf = id => {
      const c = ITEMS[id].cat;
      return c === 'melee' ? 'tools' : c === 'gun' || c === 'ammo' ? 'weap' : c === 'armor' ? 'armor' : c === 'block' ? 'build' : c === 'food' || c === 'med' ? 'food' : 'mat';
    };
    $('craft-tabs').innerHTML = TABS.map(([k, n]) => `<button class="btn small${this.craftTab === k ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('');
    const q = $('craft-search').value.trim().toLowerCase();
    const st = { bench: g.stationOK('bench'), forge: g.stationOK('forge'), fire: g.stationOK('fire') };
    const near = Object.keys(st).filter(k => st[k]).map(k => STATION_NAMES[k]);
    let h = `<div class="hint" style="margin:0 0 8px">${near.length ? 'Рядом: ' + near.join(', ') : 'Рядом нет станций — поставь верстак, кузницу или костёр.'} Shift+клик по «Создать» — сразу ×5.</div>`;
    const rows = [];
    RECIPES.forEach((r, i) => {
      const def = ITEMS[r.out];
      const free = g.freeCraft;
      const locked = !free && P.level < r.lvl;
      const stOk = free || !r.station || st[r.station];
      const can = free || (!locked && stOk && g.inv.hasAll(r.cost));
      if (q && !def.name.toLowerCase().includes(q)) return;
      if (this.craftTab === 'can' && !can) return;
      if (this.craftTab !== 'all' && this.craftTab !== 'can' && tabOf(r.out) !== this.craftTab) return;
      rows.push({ r, i, def, locked, stOk, can });
    });
    // сначала то, что можно сделать прямо сейчас, закрытые уровнем — в конце
    rows.sort((a, b) => (b.can - a.can) || (a.locked - b.locked));
    for (const { r, i, def, locked, stOk, can } of rows) {
      const cost = Object.entries(r.cost).map(([id, n]) => {
        const have = g.inv.count(id);
        return `<span class="${have < n ? 'miss' : ''}">${esc(ITEMS[id].name)} ${have}/${n}</span>`;
      }).join(' · ');
      const need = r.station ? `<span class="${stOk ? 'ok' : 'miss'}">⚒ ${STATION_NAMES[r.station]}</span> · ` : '';
      h += `<div class="recipe ${locked ? 'locked' : ''} ${can ? 'can' : ''}"><img src="${this.icons[r.out] || ''}"><div class="ri"><div class="rn">${esc(def.name)}${r.n > 1 ? ' ×' + r.n : ''}</div><div class="rc">${locked ? 'Нужен уровень ' + r.lvl : need + cost}</div></div><button class="btn small" data-r="${i}" ${can ? '' : 'disabled'} title="Shift+клик — создать 5 раз">Создать</button></div>`;
    }
    if (!rows.length) h += `<div class="hint">Ничего не найдено.</div>`;
    const list = $('craft-list');
    list.innerHTML = h;
    list.querySelectorAll('button[data-r]').forEach(b => {
      b.onclick = e => {
        const r = RECIPES[+b.dataset.r];
        const times = e.shiftKey ? 5 : 1;
        for (let k = 0; k < times; k++) if (!g.craft(r)) break;
      };
    });
  }

  renderChar() {
    const g = this.g, P = g.player, pk = P.perks;
    const need = xpNeed(P.level);
    $('inv-char').innerHTML = `
      <div class="lv">Уровень ${P.level}</div>
      <div class="xpbar" style="margin:6px 0 12px"><i style="width:${Math.min(100, P.xp / need * 100)}%"></i></div>
      <div class="kv">Опыт <b>${Math.floor(P.xp)} / ${need}</b></div>
      <div class="kv">Здоровье <b>${Math.ceil(P.hp)} / ${pk.maxHp}</b></div>
      <div class="kv">Защита брони <b>${Math.round(g.inv.armor() * 100)}%</b></div>
      <div class="kv">Сытость <b>${Math.ceil(P.food)}%</b></div>
      <div class="kv">Вода <b>${Math.ceil(P.water)}%</b></div>
      <div class="kv">Урон в ближнем бою <b>+${Math.round((pk.melee - 1) * 100)}%</b></div>
      <div class="kv">Урон оружия <b>+${Math.round((pk.gun - 1) * 100)}%</b></div>
      <div class="kv">Убито зомби <b>${P.kills}</b></div>
      <div class="kv">Убито боссов <b>${P.stats.boss || 0}</b></div>
      <div class="kv">Биом <b>${esc(C.BIOMES[g.biomeHere()].name)}</b></div>
      <div class="kv">Сложность <b>${esc(g.level.diff.name)}</b></div>
      <div class="kv">День <b>${g.day}</b></div>
      <h3 style="margin-top:12px">Задания</h3>
      ${QUESTS.map((q, i) => `<div class="kv" style="${i < P.quest ? 'opacity:.45;text-decoration:line-through' : i === P.quest ? 'color:#e8e4da' : 'opacity:.6'}">${esc(q.text)}</div>`).slice(0, Math.min(QUESTS.length, P.quest + 4)).join('')}
      <p class="hint">Каждый уровень даёт +3 к здоровью, усиливает урон и открывает рецепты.</p>`;
  }

  itemAt(src, i) { return src === 'inv' ? this.g.inv.slots[i] : this.contItems[i]; }

  // «взятый» предмет едет за курсором, следующий клик кладёт его
  setPicked(i) {
    this.picked = i;
    if (this.invSlots) this.invSlots.forEach((s, k) => s.classList.toggle('picked', k === i));
    const gh = $('drag-ghost');
    const it = i != null && this.g ? this.g.inv.slots[i] : null;
    if (it) { gh.innerHTML = `<img src="${this.icons[it.id] || ''}">`; gh.classList.remove('hidden'); }
    else if (!this.drag || !this.drag.moved) gh.classList.add('hidden');
  }

  onDragStart(e) {
    if (e.button !== 0) return;
    const s = e.target.closest('.slot');
    if (!s || !this.g) return;
    const src = s.dataset.src, i = +s.dataset.i;
    const it = this.itemAt(src, i);
    this.drag = { src, i, x0: e.clientX, y0: e.clientY, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, has: !!it };
    if (it && this.picked == null) $('drag-ghost').innerHTML = `<img src="${this.icons[it.id] || ''}">`;
    e.preventDefault();
  }

  onDragMove(e) {
    const d = this.drag;
    const tip = $('tooltip'), gh = $('drag-ghost');
    if (!tip.classList.contains('hidden')) { tip.style.left = (e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
    if (this.picked != null) { gh.style.left = (e.clientX - 28) + 'px'; gh.style.top = (e.clientY - 28) + 'px'; }
    if (!d || !d.has || this.picked != null) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) { d.moved = true; gh.classList.remove('hidden'); tip.classList.add('hidden'); }
    if (d.moved) { gh.style.left = (e.clientX - 28) + 'px'; gh.style.top = (e.clientY - 28) + 'px'; }
  }

  onDragEnd(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const g = this.g;
    if (!g) return;
    if (!d.moved) { this.onSlotClick(d.src, d.i, d.shift, d.ctrl); return; }
    $('drag-ghost').classList.add('hidden');
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const s = el && el.closest('.slot');
    const inCont = el && el.closest('#cont-box');
    const inPanel = el && el.closest('.inv-col');
    if (d.src === 'inv') {
      if (s && s.dataset.src === 'inv') this.moveInv(d.i, +s.dataset.i);
      else if (inCont && this.contCid) g.putToContainer(this.contCid, d.i);
      else if (!inPanel) g.dropFromInv(d.i);
    } else if (d.src === 'cont') {
      if ((s && s.dataset.src === 'inv') || (inPanel && !inCont)) g.takeFromContainer(this.contCid, d.i, this.contItems[d.i]);
    }
  }

  onSlotClick(src, i, shift, ctrl) {
    const g = this.g, inv = g.inv;
    if (src === 'cont') {
      if (this.picked != null) { g.putToContainer(this.contCid, this.picked); this.setPicked(null); return; }
      if (this.contItems[i]) g.takeFromContainer(this.contCid, i, this.contItems[i]);
      return;
    }
    const it = inv.slots[i];
    const now = performance.now();
    const dbl = this.lastClick.i === i && now - this.lastClick.t < 330;
    this.lastClick = { i, t: now };
    if (dbl && it && !shift && !ctrl) { this.lastClick.i = -1; this.setPicked(null); g.quickUse(i); return; }
    if (this.picked != null) {
      if (this.picked !== i) this.moveInv(this.picked, i);
      this.setPicked(null);
      return;
    }
    if (!it) return;
    if (shift) { this.quickTransfer(i); return; }
    if (ctrl) { if (inv.split(i)) this.sfx.click(); return; }
    this.setPicked(i);
  }

  // перемещение в инвентаре; в слот брони подходит только броня для этого места
  moveInv(a, b) {
    if (this.g.inv.move(a, b)) { this.sfx.click(); return true; }
    this.toast('Сюда надевается только подходящая броня');
    return false;
  }

  // Shift+клик: в контейнер, а без контейнера — между хотбаром и рюкзаком (броню — надеть или снять)
  quickTransfer(i) {
    const g = this.g, inv = g.inv;
    if (this.contCid) { g.putToContainer(this.contCid, i); return; }
    if (ITEMS[inv.slots[i].id].cat === 'armor') { g.quickUse(i); return; }
    const t = i < HOTBAR ? inv.target(inv.slots[i].id, HOTBAR, INV_SIZE) : inv.target(inv.slots[i].id, 0, HOTBAR);
    if (t < 0) { this.toast(i < HOTBAR ? 'Рюкзак полон' : 'Хотбар полон'); return; }
    inv.move(i, t);
    this.sfx.click();
  }

  // наведи на предмет: 1–8 — в слот хотбара, Q — выбросить
  invKeys(pressed) {
    const g = this.g, h = this.hover;
    if (!h || this.typingInField()) return;
    for (let k = 0; k < HOTBAR; k++) {
      if (!pressed.has('Digit' + (k + 1))) continue;
      if (h.src === 'inv') { if (g.inv.slots[h.i] && h.i !== k) this.moveInv(h.i, k); }
      else if (this.contItems[h.i]) g.takeFromContainer(this.contCid, h.i, this.contItems[h.i]);
    }
    if (pressed.has('KeyQ') && h.src === 'inv' && g.inv.slots[h.i]) { if (this.picked === h.i) this.setPicked(null); g.dropFromInv(h.i); }
  }

  onRightClick(e) {
    const s = e.target.closest('.slot');
    if (!s || !this.g) return;
    const src = s.dataset.src, i = +s.dataset.i;
    if (src === 'cont') { if (this.contItems[i]) this.g.takeFromContainer(this.contCid, i, this.contItems[i]); }
    else if (this.contCid) this.g.putToContainer(this.contCid, i);
    else this.g.quickUse(i);
  }

  onHover(e) {
    const s = e.target.closest('.slot');
    const tip = $('tooltip');
    this.hover = s ? { src: s.dataset.src, i: +s.dataset.i } : null;
    if (!s || (this.drag && this.drag.moved) || !this.g || this.picked != null) { tip.classList.add('hidden'); return; }
    const it = this.itemAt(s.dataset.src, +s.dataset.i);
    if (!it) { tip.classList.add('hidden'); return; }
    if (!tip.classList.contains('hidden') && tip.dataset.key === s.dataset.src + s.dataset.i + it.id + it.n) {
      tip.style.left = (e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px';
      return;
    }
    const def = ITEMS[it.id];
    let h = `<b>${esc(def.name)}${it.n > 1 ? ' ×' + it.n : ''}</b><div class="c">${CAT_NAMES[def.cat] || ''}</div>`;
    if (def.cat === 'gun') h += `Урон ${def.dmg}${def.pellets ? '×' + def.pellets : ''} · магазин ${def.mag}<br>Патроны: ${esc(ITEMS[def.ammo].name)}<br>В магазине: ${it.ammo}`;
    else if (def.cat === 'melee') h += `Урон ${def.dmg}`;
    else if (def.cat === 'armor') h += `${SLOT_NAMES[def.slot]} · защита ${Math.round(def.armor * 100)}%<br>Прочность ${Math.ceil(Math.max(0, it.dur ?? def.dur))} / ${def.dur}`;
    else if (def.cat === 'food') h += [def.food ? `Сытость ${def.food > 0 ? '+' : ''}${def.food}` : '', def.water ? `Вода ${def.water > 0 ? '+' : ''}${def.water}` : '', def.heal ? `Здоровье +${def.heal}` : ''].filter(Boolean).join(' · ');
    else if (def.cat === 'med') h += `Лечит ${def.heal}`;
    else if (def.cat === 'block') h += `Прочность ${BLOCK_TYPES[def.block].hp}. Возьми в руки, ЛКМ — поставить, R — повернуть.`;
    if (def.desc) h += `<br>${esc(def.desc)}`;
    const keys = s.dataset.src === 'cont'
      ? 'клик или 1–8 — забрать'
      : (def.cat === 'food' || def.cat === 'med' ? 'ПКМ или двойной клик — использовать · ' : def.cat === 'armor' ? (+s.dataset.i >= INV_SIZE ? 'ПКМ, двойной клик или Shift+клик — снять · ' : 'ПКМ, двойной клик или Shift+клик — надеть · ') : '') + '1–8 — в хотбар · Q — выбросить · Shift+клик — переложить' + (it.n > 1 ? ' · Ctrl+клик — разделить' : '');
    h += `<div class="keys">${keys}</div>`;
    tip.innerHTML = h;
    tip.dataset.key = s.dataset.src + s.dataset.i + it.id + it.n;
    tip.classList.remove('hidden');
    tip.style.left = (e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 16) + 'px';
  }

  // ---------- пауза / смерть / победа ----------
  showPause() {
    const g = this.g;
    if (!g) return;
    this.openPanel('pause');
    $('pause-settings').classList.add('hidden');
    $('pause-room').innerHTML = g.solo ? 'Одиночная игра — мир сохраняется в браузере.'
      : `Код комнаты: <b>${esc(g.code)}</b><div class="hint">Друзья вводят этот код в «Подключиться к другу». ${g.isHost ? 'Пока ты в игре, мир открыт.' : ''}</div>`;
    let h = '';
    for (const [pid, r] of g.roster) h += `<div><i style="background:${hex(r.color)}"></i>${esc(r.name)}${pid === g.myId ? ' (ты)' : ''}${pid === 1 ? ' — хост' : ''}</div>`;
    $('pause-players').innerHTML = g.solo ? '' : `<h3 style="margin-top:12px">Игроки</h3>${h}`;
  }

  showDeath(text, hasBed) {
    this.openPanel('death');
    $('death-text').textContent = text;
    $('d-bed').classList.toggle('hidden', !hasBed);
  }

  showVictory(text) {
    this.openPanel('victory');
    $('victory-text').innerHTML = text;
  }

  // ---------- карта ----------
  openMap() {
    this.openPanel('map');
    const P = this.g.player;
    this.mapView = { zoom: 1, cx: 0, cz: 0 };
    if (this._mapZoomed) this.mapView = { zoom: 2.5, cx: P.pos.x, cz: P.pos.z };
    this.drawMap();
  }

  bindMap() {
    const cv = $('map-canvas');
    let drag = null;
    cv.addEventListener('wheel', e => {
      const v = this.mapView;
      v.zoom = Math.max(1, Math.min(8, v.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      if (v.zoom === 1) { v.cx = 0; v.cz = 0; }
      this.drawMap();
    }, { passive: true });
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.mapView.cx, cz: this.mapView.cz }; });
    window.addEventListener('pointermove', e => {
      if (!drag || this.panel !== 'map') return;
      const r = cv.getBoundingClientRect();
      const k = C.WORLD_SIZE / this.mapView.zoom / r.width;
      this.mapView.cx = drag.cx - (e.clientX - drag.x) * k;
      this.mapView.cz = drag.cz - (e.clientY - drag.y) * k;
      this.drawMap();
    });
    window.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('dblclick', e => {
      const g = this.g;
      if (!g || !g.level.test) return;
      const r = cv.getBoundingClientRect(), v = this.mapView;
      const x = ((e.clientX - r.left) / r.width - 0.5) * C.WORLD_SIZE / v.zoom + v.cx;
      const z = ((e.clientY - r.top) / r.height - 0.5) * C.WORLD_SIZE / v.zoom + v.cz;
      runCommand(g, `tp ${Math.round(x)} ${Math.round(z)}`, (s, c) => this.conOut(s, c));
      this.toast('Телепорт');
      this.closePanel();
    });
  }

  drawMap() {
    const g = this.g;
    if (!g) return;
    const cv = $('map-canvas');
    const r = cv.getBoundingClientRect();
    const S = Math.round(r.width * Math.min(2, devicePixelRatio || 1));
    if (cv.width !== S) { cv.width = S; cv.height = S; }
    const x = cv.getContext('2d');
    const v = this.mapView;
    const k = S / C.WORLD_SIZE * v.zoom;
    const tx = wx => (wx - v.cx) * k + S / 2, tz = wz => (wz - v.cz) * k + S / 2;
    x.fillStyle = '#21486a';
    x.fillRect(0, 0, S, S);
    x.imageSmoothingEnabled = true;
    if (g.mapImage) x.drawImage(g.mapImage, tx(-C.HALF), tz(-C.HALF), C.WORLD_SIZE * k, C.WORLD_SIZE * k);
    // дороги
    x.strokeStyle = 'rgba(60,58,56,0.9)';
    x.lineWidth = Math.max(1.5, 7 * k);
    x.lineCap = 'round';
    x.beginPath();
    for (const s of g.world.roads) { x.moveTo(tx(s.ax), tz(s.az)); x.lineTo(tx(s.bx), tz(s.bz)); }
    x.stroke();
    // сетка
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.lineWidth = 1;
    x.font = `600 ${Math.round(S / 70)}px Rubik`;
    x.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i <= 6; i++) {
      const p = -C.HALF + i * 500;
      x.beginPath(); x.moveTo(tx(p), tz(-C.HALF)); x.lineTo(tx(p), tz(C.HALF)); x.stroke();
      x.beginPath(); x.moveTo(tx(-C.HALF), tz(p)); x.lineTo(tx(C.HALF), tz(p)); x.stroke();
      if (i < 6) { x.fillText('АБВГДЕ'[i], tx(p + 250) - 4, tz(-C.HALF) + S / 50); x.fillText(String(i + 1), tx(-C.HALF) + 6, tz(p + 250)); }
    }
    const label = (wx, wz, text, color, size = 1) => {
      x.font = `700 ${Math.round(S / 62 * size)}px Rubik`;
      x.textAlign = 'center';
      x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.75)';
      x.strokeText(text, tx(wx), tz(wz));
      x.fillStyle = color; x.fillText(text, tx(wx), tz(wz));
      x.textAlign = 'left';
    };
    for (const t of g.world.towns) {
      x.fillStyle = 'rgba(200,196,186,0.35)';
      x.beginPath(); x.arc(tx(t.x), tz(t.z), t.r * k, 0, 7); x.fill();
      label(t.x, t.z - t.r - 12, t.name, '#ffffff', t.city ? 1.2 : 0.95);
    }
    const m = g.world.military;
    if (m) {
      x.strokeStyle = '#c8c070'; x.lineWidth = 2;
      x.strokeRect(tx(m.x - 62), tz(m.z - 62), 124 * k, 124 * k);
      label(m.x, m.z - 72, '★ Военная база', '#e8d870');
    }
    g.world.crashSites.forEach(c => {
      x.fillStyle = '#d0a040';
      x.beginPath(); x.arc(tx(c.x), tz(c.z), Math.max(4, 8 * k), 0, 7); x.fill();
      label(c.x, c.z - 20, 'Крушение (лут)', '#f0c070', 0.8);
    });
    const BN = { butcher: 'Мясник', screamer: 'Крикунья', leaper: 'Прыгун' };
    g.world.lairs.forEach(l => {
      x.fillStyle = '#b02018';
      x.beginPath(); x.moveTo(tx(l.x), tz(l.z) - 9); x.lineTo(tx(l.x) + 8, tz(l.z) + 6); x.lineTo(tx(l.x) - 8, tz(l.z) + 6); x.closePath(); x.fill();
      label(l.x, l.z + 26 / Math.max(1, k * 0.6), '☠ Логово: ' + BN[l.type], '#ff7060', 0.85);
    });
    const bed = g.bedPos();
    if (bed) { x.fillStyle = '#6ab0ff'; x.fillRect(tx(bed.x) - 5, tz(bed.z) - 5, 10, 10); label(bed.x, bed.z - 14, 'Спальник', '#9ad0ff', 0.8); }
    for (const p of g.mapPlayers()) {
      if (p.me) continue;
      x.fillStyle = hex(p.color);
      x.beginPath(); x.arc(tx(p.x), tz(p.z), 6, 0, 7); x.fill();
      x.strokeStyle = '#000'; x.lineWidth = 1.5; x.stroke();
      label(p.x, p.z - 14, p.name, '#ffffff', 0.8);
    }
    // я
    const P = g.player;
    const px = tx(P.pos.x), pz = tz(P.pos.z);
    const a = -P.yaw;
    x.save(); x.translate(px, pz); x.rotate(a);
    x.fillStyle = '#ffd040'; x.strokeStyle = '#000'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath(); x.fill(); x.stroke();
    x.restore();
  }
}
