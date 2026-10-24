// Инвентарь: 8 слотов хотбара + 24 рюкзака.
import { ITEMS, makeItem } from './items.js';

export const HOTBAR = 8;
export const INV_SIZE = 32;

export class Inventory {
  constructor() {
    this.slots = new Array(INV_SIZE).fill(null);
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

  // перемещение/объединение/обмен слотов
  move(a, b) {
    if (a === b) return;
    const A = this.slots[a], B = this.slots[b];
    if (!A) return;
    if (B && B.id === A.id && ITEMS[A.id].stack > 1) {
      const st = ITEMS[A.id].stack;
      const k = Math.min(A.n, st - B.n);
      B.n += k; A.n -= k;
      if (A.n <= 0) this.slots[a] = null;
    } else {
      this.slots[a] = B; this.slots[b] = A;
    }
    this.changed();
  }

  hasAll(cost) {
    for (const id in cost) if (this.count(id) < cost[id]) return false;
    return true;
  }

  serialize() { return this.slots.map(s => (s ? { ...s } : null)); }
  load(arr) {
    this.slots = new Array(INV_SIZE).fill(null);
    if (Array.isArray(arr)) arr.forEach((s, i) => { if (s && ITEMS[s.id] && i < INV_SIZE) this.slots[i] = { ...s }; });
    this.changed();
  }
  clear() { this.slots.fill(null); this.changed(); }
  all() { return this.slots.filter(Boolean).map(s => ({ ...s })); }
}
