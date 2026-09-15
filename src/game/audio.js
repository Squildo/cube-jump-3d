import * as THREE from 'three';

// Petit synthétiseur WebAudio : aucun asset externe
export class GameAudio {
  constructor() {
    this.ctx = null; this.enabled = true;
  }
  _ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  toggle() { this.enabled = !this.enabled; return this.enabled; }
  _tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
    if (!this.enabled) return;
    const ctx = this._ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  jump() { this._tone(300, 0.18, 'square', 0.12, 350); }
  doubleJump() { this._tone(450, 0.2, 'square', 0.12, 450); }
  coin() { this._tone(900, 0.12, 'sine', 0.18, 600); setTimeout(() => this._tone(1350, 0.18, 'sine', 0.15), 70); }
  hurt() { this._tone(220, 0.3, 'sawtooth', 0.2, -150); }
  checkpoint() { this._tone(600, 0.25, 'triangle', 0.18, 300); }
  bounce() { this._tone(200, 0.25, 'sine', 0.2, 500); }
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'triangle', 0.18), i * 140)); }
  lose() { [400, 300, 200, 120].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'sawtooth', 0.15), i * 160)); }
  click() { this._tone(700, 0.07, 'square', 0.1); }
}
