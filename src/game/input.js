import * as THREE from 'three';

// État clavier + tactile + joystick
export class Input {
  constructor() {
    this.keys = {};
    this.jumpPressed = false; // edge
    this.jumpHeld = false;
    this.moveX = 0; this.moveZ = 0; // -1..1 (tactile)
    this.isTouch = ('ontouchstart' in window);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this._initTouch();
    if (this.isTouch) document.getElementById('touch-controls')?.classList.remove('hidden');
  }
  _onKeyDown(e) {
    if (e.repeat) return;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if (!this.keys[e.code]) {
      if (e.code === 'Space') { this.jumpPressed = true; this.jumpHeld = true; }
    }
    this.keys[e.code] = true;
  }
  _onKeyUp(e) {
    this.keys[e.code] = false;
    if (e.code === 'Space') this.jumpHeld = false;
  }
  _initTouch() {
    const joy = document.getElementById('joystick');
    const stick = document.getElementById('stick');
    const btnJump = document.getElementById('btn-jump');
    if (!joy || !stick) return;
    let active = false;
    let joyTouchId = null;
    const setStick = (dx, dy) => {
      const max = 38;
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, max);
      const nx = dx / len * cl, ny = dy / len * cl;
      stick.style.left = (37 + nx) + 'px';
      stick.style.top = (37 + ny) + 'px';
      this.moveX = nx / max; this.moveZ = ny / max;
    };
    const reset = () => { stick.style.left = '37px'; stick.style.top = '37px'; this.moveX = 0; this.moveZ = 0; active = false; joyTouchId = null; };
    joy.addEventListener('touchstart', e => {
      if (joyTouchId !== null) return;
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      active = true;
      e.preventDefault();
      const r = joy.getBoundingClientRect();
      setStick(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    }, { passive: false });
    window.addEventListener('touchmove', e => {
      if (joyTouchId === null) return;
      const t = [...e.touches].find(tt => tt.identifier === joyTouchId);
      if (!t) return;
      const r = joy.getBoundingClientRect();
      setStick(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    }, { passive: true });
    const onTouchEnd = e => {
      const t = [...e.changedTouches].find(tt => tt.identifier === joyTouchId);
      if (!t) return;
      reset();
    };
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    // souris aussi pour test desktop
    joy.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; active = true; joy.setPointerCapture(e.pointerId); });
    joy.addEventListener('pointermove', e => {
      if (!active || e.pointerType === 'touch') return;
      const r = joy.getBoundingClientRect();
      setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    });
    joy.addEventListener('pointerup', e => { if (e.pointerType === 'touch') return; reset(); });

    btnJump?.addEventListener('touchstart', e => { e.preventDefault(); this.jumpPressed = true; this.jumpHeld = true; }, { passive: false });
    btnJump?.addEventListener('touchend', () => { this.jumpHeld = false; });
    btnJump?.addEventListener('touchcancel', () => { this.jumpHeld = false; });
    btnJump?.addEventListener('mousedown', () => { this.jumpPressed = true; this.jumpHeld = true; });
    btnJump?.addEventListener('mouseup', () => { this.jumpHeld = false; });
    btnJump?.addEventListener('mouseleave', () => { this.jumpHeld = false; });
  }
  // Vecteur de déplacement dans l'espace caméra (camYaw en radians)
  getMoveVector(camYaw) {
    let x = 0, z = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) z -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) z += 1;
    x += this.moveX; z += this.moveZ;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    // rotation par yaw caméra
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    return { x: x * cos - z * sin, z: x * sin + z * cos };
  }
  consumeJump() { const j = this.jumpPressed; this.jumpPressed = false; return j; }
  dispose() { window.removeEventListener('keydown', this._onKeyDown); window.removeEventListener('keyup', this._onKeyUp); }
}
