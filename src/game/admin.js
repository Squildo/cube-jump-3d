import * as THREE from 'three';

// Panneau admin : vies, vol, pièces, niveaux, perso, score.
// Utilisation : new AdminPanel(game) — lit/écrit directement game + game.player.
export class AdminPanel {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('admin-panel');
    this.flyDownHeld = false; // bouton tactile ▼
    this._bind();
    this.sync();
  }
  get p() { return this.game.player; }
  _val(id) { return document.getElementById(id); }

  _bind() {
    const g = this.game;
    const on = (id, evt, fn) => this._val(id)?.addEventListener(evt, fn);

    on('btn-admin', 'click', () => this.toggle());
    on('btn-admin-close', 'click', () => this.hide());
    window.addEventListener('keydown', e => {
      if (e.code === 'F2') { e.preventDefault(); this.toggle(); }
    });

    // --- Vies ---
    on('admin-lives-minus', 'click', () => { g.setLives(g.lives - 1); this.sync(); });
    on('admin-lives-plus', 'click', () => { g.setLives(g.lives + 1); this.sync(); });
    on('admin-lives', 'change', e => { g.setLives(parseInt(e.target.value) || 0); this.sync(); });
    on('admin-heal', 'click', () => { g.setLives(Math.max(g.lives, 3)); g.toast('💚 Soigné !'); this.sync(); });
    on('admin-god', 'change', e => { g.godMode = e.target.checked; g.toast(g.godMode ? '😇 God mode ON' : '😇 God mode OFF'); });

    // --- Vol ---
    on('admin-fly', 'change', e => {
      g.setFly(e.target.checked);
      // petit feedback visuel joueur
      this.p.body.material.color.setHex(e.target.checked ? 0x60A5FA : 0xFF6B6B);
      this.sync();
    });
    on('admin-fly-speed', 'input', e => { this.p.flySpeed = parseFloat(e.target.value); this._val('admin-fly-speed-val').textContent = this.p.flySpeed; });
    // boutons tactiles monter/descendre en mode vol
    const up = this._val('admin-fly-up'), down = this._val('admin-fly-down');
    up?.addEventListener('pointerdown', () => { this._flyUpBtn = true; });
    up?.addEventListener('pointerup', () => { this._flyUpBtn = false; });
    up?.addEventListener('pointerleave', () => { this._flyUpBtn = false; });
    down?.addEventListener('pointerdown', () => { this.flyDownHeld = true; });
    down?.addEventListener('pointerup', () => { this.flyDownHeld = false; });
    down?.addEventListener('pointerleave', () => { this.flyDownHeld = false; });

    // --- Pièces ---
    on('admin-coin-plus1', 'click', () => { g.addCoins(1); this.sync(); });
    on('admin-coin-plus10', 'click', () => { g.addCoins(10); this.sync(); });
    on('admin-coin-all', 'click', () => { g.collectAllCoins(); this.sync(); });
    on('admin-coin-reset', 'click', () => { g.resetCoins(); this.sync(); });

    // --- Niveaux ---
    [0, 1, 2].forEach(i => on(`admin-lvl-${i + 1}`, 'click', () => { g.goToLevel(i); this.sync(); }));
    on('admin-lvl-prev', 'click', () => { g.goToLevel((g.level + 2) % 3); this.sync(); });
    on('admin-lvl-next', 'click', () => { g.goToLevel((g.level + 1) % 3); this.sync(); });
    on('admin-tp-spawn', 'click', () => g.teleportToSpawn());
    on('admin-tp-goal', 'click', () => g.teleportToGoal());
    on('admin-tp-check', 'click', () => g.teleportToCheckpoint());

    // --- Perso ---
    on('admin-speed', 'input', e => { this.p.speed = parseFloat(e.target.value); this._val('admin-speed-val').textContent = this.p.speed.toFixed(1); });
    on('admin-jump', 'input', e => { this.p.jumpForce = parseFloat(e.target.value); this._val('admin-jump-val').textContent = this.p.jumpForce.toFixed(1); });

    // --- Score ---
    on('admin-score-plus', 'click', () => { g.score += 100; g._hud(); this.sync(); });
    on('admin-score-minus', 'click', () => { g.score = Math.max(0, g.score - 100); g._hud(); this.sync(); });
    on('admin-score-reset', 'click', () => { g.score = 0; g._hud(); this.sync(); });
    on('admin-respawn', 'click', () => g.teleportToSpawn());
    on('admin-kill', 'click', () => { g.godMode = false; this._val('admin-god').checked = false; g.die('spike'); this.sync(); });
  }

  toggle() { this.el?.classList.toggle('hidden'); this.sync(); }
  hide() { this.el?.classList.add('hidden'); }

  sync() {
    const g = this.game, p = this.p;
    if (!this.el) return;
    const set = (id, v) => { const e = this._val(id); if (e) e.value = v; };
    const setText = (id, v) => { const e = this._val(id); if (e) e.textContent = v; };
    set('admin-lives', g.lives);
    this._val('admin-god').checked = !!g.godMode;
    this._val('admin-fly').checked = !!p.fly;
    set('admin-fly-speed', p.flySpeed); setText('admin-fly-speed-val', p.flySpeed);
    set('admin-speed', p.speed); setText('admin-speed-val', Number(p.speed).toFixed(1));
    set('admin-jump', p.jumpForce); setText('admin-jump-val', Number(p.jumpForce).toFixed(1));
    setText('admin-coins-info', `🪙 ${g.coinsTaken}/${g.totalCoins} • ⭐ ${g.score} • 🚩 Niv ${g.level + 1}/3`);
    // highlight niveau actif
    [1, 2, 3].forEach(n => this._val(`admin-lvl-${n}`)?.classList.toggle('active', g.level === n - 1));
  }
}
