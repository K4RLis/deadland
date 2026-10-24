// Инвентарь: 8 слотов хотбара + 24 рюкзака.
import { ITEMS, makeItem, ARMOR_CAP } from './items.js';

export const HOTBAR = 8;
export const INV_SIZE = 32;
// слоты брони идут сразу после рюкзака
export const ARMOR_AT = { head: 32, body: 33, legs: 34 };
export const TOTAL = 35;

export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL).fill(null);
    this.onChange = null;
  }

  changed() { if (this.onChange) this.onChange(); }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  // сколько поместится
  room(id) {
    const st = ITEMS[id].stack;
    let r = 0;
    for (const s of this.slots) {
      if (!s) r += st;
      else if (s.id === id && st > 1) r += st - s.n;
    }
    return r;
  }

  // добавить предмет-объект (с патронами и т.п.). Возвращает остаток (null если всё влезло)
  addItem(item, preferHotbar = true) {
    const def = ITEMS[item.id];
    if (!def) return null;
    let n = item.n;
    if (def.stack > 1) {
      for (const s of this.slots) {
        if (n <= 0) break;
        if (s && s.id === item.id && s.n < def.stack) {
          const k = Math.min(n, def.stack - s.n);
          s.n += k; n -= k;
        }
      }
    }
    const order = [];
    if (preferHotbar && (def.cat === 'gun' || def.cat === 'melee' || def.cat === 'block' || def.cat === 'food' || def.cat === 'med')) {
      for (let i = 0; i < HOTBAR; i++) order.push(i);
      for (let i = HOTBAR; i < INV_SIZE; i++) order.push(i);
    } else {
      for (let i = HOTBAR; i < INV_SIZE; i++) order.push(i);
      for (let i = 0; i < HOTBAR; i++) order.push(i);
    }
    for (const i of order) {
      if (n <= 0) break;
      if (!this.slots[i]) {
        const k = Math.min(n, def.stack);
        this.slots[i] = { ...item, n: k };
        n -= k;
      }
    }
    this.changed();
    return n > 0 ? { ...item, n } : null;
  }

  add(id, n = 1) { return this.addItem(makeItem(id, n)); }

  remove(id, n) {
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.n);
        s.n -= k; n -= k;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return n <= 0;
  }

  takeSlot(i, n) {
    const s = this.slots[i];
    if (!s) return null;
    const k = n == null ? s.n : Math.min(n, s.n);
    const out = { ...s, n: k };
    s.n -= k;
    if (s.n <= 0) this.slots[i] = null;
    this.changed();
    return out;
  }

  // можно ли положить предмет в слот i: в слот брони — только броню для этого места
  fits(i, it) {
    if (i < INV_SIZE || !it) return true;
    const def = ITEMS[it.id];
    return def.cat === 'armor' && ARMOR_AT[def.slot] === i;
  }

  // перемещение/объединение/обмен слотов; false — предмет туда не подходит
  move(a, b) {
    if (a === b) return true;
    const A = this.slots[a], B = this.slots[b];
    if (!A) return true;
    if (!this.fits(b, A) || !this.fits(a, B)) return false;
    if (B && B.id === A.id && ITEMS[A.id].stack > 1) {
      const st = ITEMS[A.id].stack;
      const k = Math.min(A.n, st - B.n);
      B.n += k; A.n -= k;
      if (A.n <= 0) this.slots[a] = null;
    } else {
      this.slots[a] = B; this.slots[b] = A;
    }
    this.changed();
    return true;
  }

  // надеть броню из слота i (снятая встаёт на её место) или снять надетую в рюкзак
  toggleArmor(i) {
    const s = this.slots[i];
    if (!s || ITEMS[s.id].cat !== 'armor') return false;
    if (i < INV_SIZE) return this.move(i, ARMOR_AT[ITEMS[s.id].slot]);
    let t = this.target(s.id, HOTBAR, INV_SIZE);
    if (t < 0) t = this.target(s.id, 0, HOTBAR);
    return t >= 0 && this.move(i, t);
  }

  // защита надетой брони: доля урона, которую она забирает
  armor() {
    let a = 0;
    for (const k in ARMOR_AT) { const s = this.slots[ARMOR_AT[k]]; if (s) a += ITEMS[s.id].armor; }
    return Math.min(ARMOR_CAP, a);
  }

  // то же с учётом износа — для полоски в HUD (0..1)
  armorBar() {
    let a = 0;
    for (const k in ARMOR_AT) {
      const s = this.slots[ARMOR_AT[k]];
      if (s) { const d = ITEMS[s.id]; a += d.armor * Math.max(0, (s.dur ?? d.dur) / d.dur); }
    }
    return Math.min(1, a / ARMOR_CAP);
  }

  // броня принимает свою долю урона и изнашивается на столько же; возвращает урон, дошедший до игрока
  absorb(n) {
    let sum = 0;
    for (const k in ARMOR_AT) { const s = this.slots[ARMOR_AT[k]]; if (s) sum += ITEMS[s.id].armor; }
    if (sum <= 0) return { n, broke: [] };
    const scale = Math.min(1, ARMOR_CAP / sum), broke = [];
    let taken = 0;
    for (const k in ARMOR_AT) {
      const i = ARMOR_AT[k], s = this.slots[i];
      if (!s) continue;
      const def = ITEMS[s.id], part = n * def.armor * scale;
      taken += part;
      s.dur = (s.dur ?? def.dur) - part;
      if (s.dur <= 0) { broke.push(def.name); this.slots[i] = null; }
    }
    this.changed();
    return { n: n - taken, broke };
  }

  hasAll(cost) {
    for (const id in cost) if (this.count(id) < cost[id]) return false;
    return true;
  }

  // слот в диапазоне [from, to): сначала неполная стопка того же предмета, потом пустой
  target(id, from, to) {
    if (ITEMS[id].stack > 1) for (let i = from; i < to; i++) { const s = this.slots[i]; if (s && s.id === id && s.n < ITEMS[id].stack) return i; }
    for (let i = from; i < to; i++) if (!this.slots[i]) return i;
    return -1;
  }

  // разделить стопку пополам в первый пустой слот рюкзака (или хотбара)
  split(i) {
    const s = this.slots[i];
    if (!s || s.n < 2) return false;
    let t = -1;
    for (let k = HOTBAR; k < INV_SIZE && t < 0; k++) if (!this.slots[k]) t = k;
    for (let k = 0; k < HOTBAR && t < 0; k++) if (!this.slots[k]) t = k;
    if (t < 0) return false;
    const half = Math.floor(s.n / 2);
    s.n -= half;
    this.slots[t] = { ...s, n: half };
    this.changed();
    return true;
  }

  // сортировка рюкзака: склеить стопки и упорядочить по категориям
  sort() {
    const ORDER = ['gun', 'melee', 'ammo', 'med', 'food', 'block', 'mat'];
    const items = [];
    for (let i = HOTBAR; i < INV_SIZE; i++) if (this.slots[i]) { items.push(this.slots[i]); this.slots[i] = null; }
    const merged = [];
    for (const it of items) {
      const st = ITEMS[it.id].stack;
      let n = it.n;
      if (st > 1) for (const m of merged) { if (n <= 0) break; if (m.id === it.id && m.n < st) { const k = Math.min(n, st - m.n); m.n += k; n -= k; } }
      if (n > 0) merged.push({ ...it, n });
    }
    merged.sort((a, b) => ORDER.indexOf(ITEMS[a.id].cat) - ORDER.indexOf(ITEMS[b.id].cat) || ITEMS[a.id].name.localeCompare(ITEMS[b.id].name, 'ru') || b.n - a.n);
    merged.forEach((it, k) => { this.slots[HOTBAR + k] = it; });
    this.changed();
  }

  serialize() { return this.slots.map(s => (s ? { ...s } : null)); }
  load(arr) {
    this.slots = new Array(TOTAL).fill(null);
    if (Array.isArray(arr)) arr.forEach((s, i) => { if (s && ITEMS[s.id] && i < TOTAL && this.fits(i, s)) this.slots[i] = { ...s }; });
    this.changed();
  }
  clear() { this.slots.fill(null); this.changed(); }
  all() { return this.slots.filter(Boolean).map(s => ({ ...s })); }
}
