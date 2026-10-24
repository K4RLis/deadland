// Клавиатура и мышь. pressed — клавиши, нажатые в этом кадре.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.lmb = false; this.rmb = false;
    this.lmbPressed = false; this.rmbPressed = false;
    this.wheel = 0;
    this.enabled = true;
    window.addEventListener('keydown', e => {
      if (e.code === 'Tab' || (e.code === 'Space' && document.activeElement === document.body)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    window.addEventListener('mousedown', e => {
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    window.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', e => e.preventDefault());
  }

  endFrame() {
    this.pressed.clear();
    this.lmbPressed = false; this.rmbPressed = false;
    this.wheel = 0;
  }
}
