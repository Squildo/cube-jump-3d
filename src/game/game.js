import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { CameraRig } from './camerarig.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Effects } from './effects.js';
import { resolveCollisions } from './physics.js';
import { AdminPanel } from './admin.js';
import { Editor } from './editor.js';
import { EditorPanel } from './editorpanel.js';
import { validate, loadCustomSlots, saveCustomSlot, blankLevel, loadProgressSlots, saveProgressSlot, clearProgressSlot, isAdminUnlocked, setAdminUnlocked, checkAdminCode, isEditorUnlocked, setEditorUnlocked, WORLDS, getWorldLevel, getWorldTheme } from './leveldata.js';
import { Netplay } from './netplay.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 40, 110);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    this.rig = new CameraRig(this.camera);

    const hemi = new THREE.HemisphereLight(0xbfe9ff, 0x7fbf7f, 0.9);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 20, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    this.scene.add(hemi, sun);
    this.sun = sun;

    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.input = new Input();
    this.audio = new GameAudio();
    this.fx = new Effects(this.scene);

    this.state = 'mode-select'; // mode-select | saves | menu | playing | paused | over | win | world-select | level-select | multi-lobby
    this.gameMode = null; // 'solo' | 'multi'
    this.score = 0; this.coinsTaken = 0; this.totalCoins = 0;
    this.lives = 3; this.level = 0; this.maxLevels = 6; this.levelsPerWorld = 3; this.worldCount = 2;
    this.worldIdx = 1; this.levelIdx = 0;
    this.time = 0; this.spawn = new THREE.Vector3(0, 3, 8);
    this.shake = 0;
    this.godMode = false;
    this.levelSource = { type: 'official', idx: 0, label: 'Niveau 1/3' };
    this.playtesting = false;
    this._playtestData = null;
    this._preEditorState = 'menu';
    this._autosaveT = null;
    // ----- SAUVEGARDES PROGRESSION (3 sessions Mario Galaxy) -----
    this.activeSlot = null; // 0..2
    this._progressSaveT = null;
    this._progressT = 0;
    // ----- MULTIJOUEUR (P2P PeerJS, coop) -----
    this.net = new Netplay(this);
    this.multi = null; // {role:'host'|'guest', code}
    this.remotePlayer = null;
    this._posT = 0; this._stateT = 0; this._goalSendT = 0;
    this._goalReady = { host: false, guest: false };
    this._goalToastDone = false;
    this._sentCoins = new Set();

    this._bindUI();
    this.admin = new AdminPanel(this);
    this.editor = new Editor(this);
    this.editorPanel = new EditorPanel(this, this.editor);
    this.editor.onChange = () => this.syncAfterEdit('editor');
    this._wireNet();
    this.refreshNetUI();
    window.game = this; // console : game.setLives(10), game.setFly(true)...
    this._resize(); window.addEventListener('resize', () => this._resize());
    this.refreshAdminGateUI();
    this._checkUrlJoin();
    // premier écran : choix du mode Solo / Multi
    setTimeout(() => { this.refreshAdminGateUI(); this.showModeSelect(); }, 100);
    this._loop = this._loop.bind(this);
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }

  _bindUI() {
    const $ = id => document.getElementById(id);
    const click = (id, fn) => $(id)?.addEventListener('click', () => { this.audio.click(); fn(); });
    click('btn-play', () => this.start());
    click('btn-resume', () => this.resume());
    click('btn-restart-pause', () => this.start());
    click('btn-quit-pause', () => this.toMenu());
    click('btn-retry', () => this.start());
    click('btn-quit-over', () => this.toMenu());
    click('btn-replay', () => this.start());
    click('btn-quit-win', () => this.toMenu());
    click('btn-pause', () => this.pause());
    click('btn-editor', () => this.toggleEditor());
    click('btn-host-create', () => this.hostCreate());
    click('btn-join', () => this.joinWithCode());
    click('btn-copy-code', () => this.copyHostCode());
    click('btn-copy-link', () => this.copyHostLink());
    click('btn-multi-start', () => this.hostStartGame());
    click('btn-multi-leave', () => this.leaveMulti());
    click('btn-net-leave', () => this.leaveMulti());
    $('join-code-input')?.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') { e.preventDefault(); this.joinWithCode(); }
      // auto-uppercase
      setTimeout(() => { const el = $('join-code-input'); if (el) el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }, 0);
    });
    $('join-code-input')?.addEventListener('input', () => {
      const el = $('join-code-input');
      if (el) el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
    click('btn-change-save', () => this.showSaveSelectFromMenu());
    click('btn-menu-back', () => this.showModeSelect());
    click('btn-save-back', () => this.showModeSelect());
    click('btn-multi-back', () => this.showModeSelect());
    click('btn-mode-solo', () => this.selectSolo());
    click('btn-mode-multi', () => this.selectMulti());
    click('btn-world-back', () => { if(this.gameMode==='solo'){ this.state='menu'; this._show('menu'); } else this.showModeSelect(); });
    click('btn-level-back', () => this.showWorldSelect());
    // admin gate (solo + mode-select)
    const bindAdminGate = (inputId, btnId) => {
      $(btnId)?.addEventListener('click', () => this.unlockAdmin(inputId));
      $(inputId)?.addEventListener('keydown', e => {
        if (e.code === 'Enter') { e.preventDefault(); this.unlockAdmin(inputId); }
        e.stopPropagation();
      });
    };
    bindAdminGate('admin-code-input', 'btn-admin-unlock');
    bindAdminGate('admin-code-input-mode', 'btn-admin-unlock-mode');
    $('btn-admin-lock')?.addEventListener('click', () => this.lockAdmin());
    // bloque F2/F3 si verrouillé (sera aussi géré dans AdminPanel/Editor)
    $('btn-editor-close')?.addEventListener('click', () => this.exitEditor());
    $('btn-sound')?.addEventListener('click', e => {
      const on = this.audio.toggle();
      e.target.textContent = on ? '🔊' : '🔇';
    });
    window.addEventListener('keydown', e => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleEditor();
        return;
      }
    });
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (e.code === 'Enter' && (this.state === 'menu' || this.state === 'over' || this.state === 'win')) this.start();
    });
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  _show(id) { ['menu', 'pause', 'gameover', 'win', 'save-select', 'world-select', 'level-select', 'mode-select', 'multi-lobby'].forEach(m => document.getElementById(m)?.classList.add('hidden')); if (id) document.getElementById(id)?.classList.remove('hidden'); }
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }
  _hud() {
    document.getElementById('hud-score').textContent = this.score;
    document.getElementById('hud-coins').textContent = `${this.coinsTaken}/${this.totalCoins}`;
    document.getElementById('hud-lives').textContent = this.lives;
    const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
    document.getElementById('hud-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
    document.getElementById('hud-level').textContent = `Monde ${this.worldIdx || 1} Niveau ${Math.min((this.levelIdx ?? this.level) + 1, 3)}/3`;
    this._refreshStaminaHUD();
  }
  _refreshStaminaHUD() {
    const bar = document.getElementById('hud-stamina');
    const fill = document.getElementById('stamina-fill');
    const txt = document.getElementById('stamina-text');
    if (!bar || !fill || !txt) return;
    const show = this.state === 'playing' && !this.player.fly;
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const ratio = this.player.getStaminaRatio ? this.player.getStaminaRatio() : 1;
    fill.style.width = (ratio * 100).toFixed(0) + '%';
    fill.classList.toggle('cooldown', ratio < 1);
    txt.textContent = ratio >= 1 ? 'PRÊT ⚡' : `RECHARGE ${(this.player.doubleCooldown).toFixed(1)}s`;
    txt.style.color = ratio >= 1 ? '#4ade80' : '#f87171';
  }

  // ----- MODES -----
  showModeSelect() {
    if (this.multi) this.leaveMulti(true);
    this.gameMode = null;
    this.state = 'mode-select';
    this._show('mode-select');
    document.getElementById('hud')?.classList.add('hidden');
    this.refreshAdminGateUI();
  }
  selectSolo() {
    this.gameMode = 'solo';
    this.showSaveSelect();
  }
  selectMulti() {
    this.gameMode = 'multi';
    this.state = 'multi-lobby';
    this._show('multi-lobby');
    document.getElementById('hud')?.classList.add('hidden');
    this.refreshNetUI();
    this.refreshAdminGateUI();
  }
  showSaveSelectFromMenu() {
    // Depuis le menu solo : retour aux sessions sans repasser par mode-select
    this.showSaveSelect();
  }
  // ----- SAUVEGARDES (Mario Galaxy) — uniquement Solo -----
  showSaveSelect() {
    this.gameMode = 'solo';
    this.state = 'saves';
    this._show('save-select');
    document.getElementById('hud')?.classList.add('hidden');
    this.renderSaveSlots();
  }
  hideSaveSelect() {
    document.getElementById('save-select')?.classList.add('hidden');
  }
  showWorldSelect() {
    if (this.gameMode !== 'solo' && this.gameMode !== null) {
      this.toast('🌐 Monde solo uniquement — repasse en Solo');
      this.showModeSelect();
      return;
    }
    if (this.activeSlot == null) { this.showSaveSelect(); return; }
    this.gameMode = 'solo';
    this.state = 'world-select';
    this._show('world-select');
    this.renderWorldSelect();
  }
  renderWorldSelect() {
    const container = document.getElementById('world-cards');
    if (!container) return;
    container.innerHTML = '';
    const w1Unlocked = true;
    const w2Unlocked = this.isWorld2Unlocked();
    const worlds = [
      { id: 1, name: 'Monde 1', subtitle: 'Forêt • Niveaux 1-3', icon: '🌲', cls: 'forest', locked: !w1Unlocked },
      { id: 2, name: 'Monde 2', subtitle: 'Neige • Niveaux 4-6', icon: '❄️', cls: 'snow', locked: !w2Unlocked },
    ];
    worlds.forEach(w => {
      const el = document.createElement('div');
      el.className = `world-card ${w.cls} ${w.locked ? 'locked' : ''}`;
      el.innerHTML = `${w.locked ? '<div class="lock-badge">🔒</div>' : ''}<div class="world-card-icon">${w.icon}</div><h3>${w.name}</h3><p>${w.subtitle}</p><p class="hint">${w.locked ? 'Termine Monde 1 pour débloquer' : '3 niveaux'}</p>`;
      el.addEventListener('click', () => {
        if (w.locked) { this.toast('🔒 Termine le Monde 1 d\'abord !'); return; }
        this.showLevelSelect(w.id);
      });
      container.appendChild(el);
    });
  }
  showLevelSelect(worldIdx) {
    this._pendingWorld = worldIdx;
    this.state = 'level-select';
    this._show('level-select');
    const title = document.getElementById('level-select-title');
    const sub = document.getElementById('level-select-subtitle');
    if (title) title.textContent = `🌍 Monde ${worldIdx} — ${worldIdx===1 ? 'Forêt' : 'Neige'}`;
    if (sub) sub.textContent = worldIdx===1 ? '3 niveaux forêt' : '3 niveaux neige • glace/vent/laser';
    this.renderLevelSelect(worldIdx);
  }
  renderLevelSelect(worldIdx) {
    const container = document.getElementById('level-cards');
    if (!container) return;
    container.innerHTML = '';
    for (let li=0; li<3; li++) {
      const globalIdx = (worldIdx-1)*3 + li;
      const isLocked = worldIdx===2 && !this.isWorld2Unlocked();
      const el = document.createElement('div');
      el.className = `level-card ${isLocked ? 'locked' : ''}`;
      const lvlName = worldIdx===1 ? ['Clairière','Ponts','Falaises'][li] : ['Piste Verglacée','Tempête','Laser Neige'][li];
      el.innerHTML = `<div class="lvl-num">${li+1}</div><div class="lvl-name">${lvlName}</div><div class="hint" style="font-size:11px;">${isLocked ? '🔒' : '▶ Jouer'}</div>`;
      el.addEventListener('click', () => {
        if (isLocked) { this.toast('🔒 Monde 2 verrouillé'); return; }
        this._loadLevel(globalIdx);
        // pour session, on met à jour progression si on joue un niveau plus avancé ?
        this.player.reset(this.spawn);
        this.state = 'playing'; this._show(null);
        document.getElementById('hud')?.classList.remove('hidden');
        this.toast(`▶ ${this.levelSource.label}`);
      });
      container.appendChild(el);
    }
  }
  renderSaveSlots() {
    const container = document.getElementById('save-slots');
    if (!container) return;
    const slots = loadProgressSlots();
    container.innerHTML = '';
    slots.forEach((data, i) => {
      const isEmpty = !data;
      const el = document.createElement('div');
      el.className = `save-slot ${isEmpty ? 'empty' : ''} ${this.activeSlot === i ? 'active' : ''}`;
      const lvl = data ? `Niveau ${Math.min((data.level ?? 0) + 1, 3)}/3` : 'Vide';
      const meta = isEmpty ? 'Aucune progression — Nouvelle partie' : `⭐ ${data.score ?? 0} • 🪙 ${data.coinsTaken ?? 0}/${data.totalCoins ?? 0} • ⏱️ ${Math.floor((data.time ?? 0)/60)}:${String(Math.floor((data.time ?? 0)%60)).padStart(2,'0')} • ❤️ ${data.lives ?? 3}`;
      const date = data?.updatedAt ? new Date(data.updatedAt).toLocaleDateString('fr-FR') : '';
      el.innerHTML = `<div class="save-slot-num">${i+1}</div><div class="save-slot-info"><div class="save-slot-title">${isEmpty ? `Session ${i+1} — Vide` : `Session ${i+1} — ${lvl}`}</div><div class="save-slot-meta">${meta}${date?` • ${date}`:''}</div></div><div class="save-slot-actions">${isEmpty ? `<button class="btn-continue" data-act="play">▶ Nouvelle partie</button>` : `<button class="btn-continue" data-act="play">▶ Continuer</button><button data-act="delete">🗑</button>`}</div>`;
      el.querySelector('[data-act="play"]')?.addEventListener('click', (e) => { e.stopPropagation(); this.selectSlot(i); });
      el.querySelector('[data-act="delete"]')?.addEventListener('click', (e) => { e.stopPropagation(); this.deleteSlot(i); });
      el.addEventListener('click', () => this.selectSlot(i));
      container.appendChild(el);
    });
  }
  selectSlot(i) {
    const slots = loadProgressSlots();
    const data = slots[i];
    this.activeSlot = i;
    this.hideSaveSelect();
    if (data) {
      this.score = data.score ?? 0;
      this.lives = data.lives ?? 3;
      this.time = data.time ?? 0;
      // migration ancien slot avec level plat
      let lvl = data.level;
      if (data.worldIdx && data.levelIdx != null) lvl = (data.worldIdx-1)*3 + data.levelIdx;
      else if (data.world && data.level != null && data.world === 2) lvl = 3 + (data.levelIdx ?? 0);
      lvl = Math.max(0, Math.min(this.maxLevels - 1, lvl ?? 0));
      this._loadLevel(lvl);
      this.coinsTaken = 0;
      this.toast(`💾 Session ${i+1} chargée — ${this.levelSource.label}`);
    } else {
      this.score = 0; this.lives = 3; this.time = 0; this.worldIdx = 1; this.levelIdx = 0;
      this._loadLevel(0);
      this.saveProgress();
      this.toast(`💾 Session ${i+1} créée`);
    }
    this.state = 'menu'; this._show('menu');
    this._hud(); this.refreshAdminGateUI();
  }
  deleteSlot(i) {
    if (!confirm(`Effacer la Session ${i+1} ?`)) return;
    clearProgressSlot(i);
    if (this.activeSlot === i) this.activeSlot = null;
    this.renderSaveSlots();
    this.toast(`🗑 Session ${i+1} effacée`);
  }
  getProgressData() {
    const slotData = loadProgressSlots()[this.activeSlot] || {};
    return { world: this.worldIdx, level: this.level, levelIdx: this.levelIdx, worldIdx: this.worldIdx, score: this.score, lives: this.lives, time: Math.floor(this.time), coinsTaken: this.coinsTaken, totalCoins: this.totalCoins, world2Unlocked: slotData.world2Unlocked || this.isWorld2Unlocked() || false };
  }
  isWorld2Unlocked() {
    if (isAdminUnlocked()) return true;
    if (this.activeSlot == null) return false;
    const d = loadProgressSlots()[this.activeSlot];
    if (d?.world2Unlocked) return true;
    // débloqué si Monde 1 terminé (niveau 2 du monde 1 validé)
    if (d && d.world === 1 && d.level >= 2) return true; // global level 2 = Monde1 Niv3
    if (d && d.worldIdx === 1 && d.levelIdx === 2) return true;
    try { return localStorage.getItem('cubejump-world2-unlocked') === '1'; } catch { return false; }
  }
  isWorld2UnlockedForSlot(slot) {
    const d = loadProgressSlots()[slot];
    if (!d) return false;
    if (d.world2Unlocked) return true;
    if (d.world === 2) return true;
    if (d.worldIdx === 2) return true;
    // check global level
    if (d.level >= 5) return true;
    if (d.world === 1 && d.level >= 2) return true;
    return false;
  }
  unlockWorld2ForActiveSlot() {
    if (this.activeSlot == null) return;
    const arr = loadProgressSlots();
    const cur = arr[this.activeSlot] || {};
    cur.world2Unlocked = true;
    try { localStorage.setItem('cubejump-world2-unlocked', '1'); } catch {}
    saveProgressSlot(this.activeSlot, { ...this.getProgressData(), world2Unlocked: true });
    this.toast('🌟 Monde 2 Neige débloqué !');
  }
  saveProgress() {
    if (this.activeSlot == null || this.multi || this.playtesting || this.state === 'saves') return;
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'menu' && this.state !== 'world-select' && this.state !== 'level-select') return;
    try { saveProgressSlot(this.activeSlot, this.getProgressData()); } catch {}
  }
  // debounce sauvegarde
  scheduleSaveProgress() {
    clearTimeout(this._progressSaveT);
    this._progressSaveT = setTimeout(() => this.saveProgress(), 400);
  }
  // ----- ADMIN / ÉDITEUR (verrouillage pro) -----
  refreshAdminGateUI() {
    const adminUnlocked = isAdminUnlocked();
    const editorUnlocked = isEditorUnlocked();
    // gate dans menu solo
    document.getElementById('admin-gate-locked')?.classList.toggle('hidden', adminUnlocked);
    document.getElementById('admin-gate-unlocked')?.classList.toggle('hidden', !adminUnlocked);
    // gate dans mode-select
    document.getElementById('admin-gate-locked-mode')?.classList.toggle('hidden', adminUnlocked);
    document.getElementById('admin-gate-unlocked-mode')?.classList.toggle('hidden', !adminUnlocked);
    document.getElementById('btn-admin')?.classList.toggle('locked', !adminUnlocked);
    // éditeur : en multi, seulement si admin
    const editorEffectiveUnlocked = this.multi ? adminUnlocked : editorUnlocked;
    document.getElementById('btn-editor')?.classList.toggle('locked', !editorEffectiveUnlocked);
    const hint = document.getElementById('editor-lock-hint');
    if (hint) {
      if (this.multi) {
        hint.textContent = adminUnlocked ? '✅ Éditeur disponible (admin en multi)' : '🔒 Éditeur en multi : uniquement en mode admin';
      } else {
        if (editorUnlocked) hint.textContent = adminUnlocked ? '✅ Éditeur disponible (admin)' : '✅ Éditeur débloqué — 3 niveaux terminés !';
        else hint.textContent = '🔒 Éditeur verrouillé — termine les 3 niveaux pour le débloquer (ou déverrouille l\'admin)';
      }
    }
    const hintMulti = document.getElementById('editor-lock-hint-multi');
    if (hintMulti) {
      hintMulti.textContent = adminUnlocked ? '✅ Éditeur disponible (admin)' : '🔒 Éditeur en multi : déverrouille l\'admin pour y accéder';
    }
    const adminBtn = document.getElementById('btn-admin');
    if (adminBtn) adminBtn.title = adminUnlocked ? 'Panneau admin (F2)' : '🔒 Admin verrouillé — entre le code';
    const editorBtn = document.getElementById('btn-editor');
    if (editorBtn) editorBtn.title = editorEffectiveUnlocked ? 'Éditeur de niveau (F3)' : (this.multi ? '🔒 Éditeur en multi : admin requis' : '🔒 Éditeur verrouillé — finis les 3 niveaux');
    const status = document.getElementById('admin-unlock-status');
    if (status && !adminUnlocked) status.textContent = '';
    const statusMode = document.getElementById('admin-unlock-status-mode');
    if (statusMode && !adminUnlocked) statusMode.textContent = '';
  }
  unlockAdmin(inputId = 'admin-code-input') {
    const input = document.getElementById(inputId);
    const code = (input?.value || '').trim();
    const isModeInput = inputId.includes('mode');
    const status = document.getElementById(isModeInput ? 'admin-unlock-status-mode' : 'admin-unlock-status');
    const otherStatus = document.getElementById(isModeInput ? 'admin-unlock-status' : 'admin-unlock-status-mode');
    if (!code) { if (status) status.textContent = '⌨️ Entre un code'; return; }
    if (checkAdminCode(code)) {
      setAdminUnlocked(true);
      setEditorUnlocked(true);
      this.refreshAdminGateUI();
      if (status) status.textContent = '✅ Code correct — admin déverrouillé !';
      if (otherStatus) otherStatus.textContent = '✅ Code correct — admin déverrouillé !';
      this.toast('🔓 Admin déverrouillé !');
      // clear both inputs
      const a = document.getElementById('admin-code-input');
      const b = document.getElementById('admin-code-input-mode');
      if (a) a.value = '';
      if (b) b.value = '';
    } else {
      if (status) status.textContent = '❌ Code incorrect';
      this.toast('❌ Code admin incorrect');
    }
  }
  lockAdmin() {
    setAdminUnlocked(false);
    // l'éditeur reste débloqué si déjà gagné les 3 niveaux, sinon se reverrouille
    const progUnlocked = (() => { try { return localStorage.getItem('cubejump-editor-won') === '1'; } catch { return false; } })();
    if (!progUnlocked) setEditorUnlocked(false);
    this.refreshAdminGateUI();
    this.admin?.hide?.();
    this.editor?.disable?.();
    document.getElementById('editor-panel')?.classList.add('hidden');
    this.toast('🔒 Admin reverrouillé');
  }
  isEditorAvailable() {
    if (this.multi) return isAdminUnlocked(); // en multi, seulement admin
    return isEditorUnlocked();
  }
  tryUnlockEditorByProgress() {
    if (isEditorUnlocked()) return;
    // débloque après victoire complète (3 niveaux)
    setEditorUnlocked(true);
    try { localStorage.setItem('cubejump-editor-won', '1'); } catch {}
    this.refreshAdminGateUI();
    this.toast('🧱 Éditeur débloqué ! Tu as terminé les 3 niveaux !');
  }

  toMenu() {
    this.playtesting = false;
    const wasMulti = !!this.multi;
    if (this.multi) this.leaveMulti(true);
    document.getElementById('hud')?.classList.add('hidden');
    this.hideSaveSelect();
    this.saveProgress();
    if (wasMulti || this.gameMode === 'multi') {
      this.showModeSelect();
    } else {
      this.state = 'menu';
      this._show('menu');
    }
  }
  start() {
    // En multi, le bouton JOUER solo n'est pas affiché : redirige vers le lobby
    if (this.gameMode === 'multi' || this.multi) {
      if (this.multi) { this.multiRestart(); return; }
      this.toast('🌐 Passe par le lobby multijoueur');
      this.selectMulti();
      return;
    }
    if (this.activeSlot == null) { this.showSaveSelect(); this.toast('💾 Choisis une session d\'abord'); return; }
    // Rejouer en multi (game over / victoire) = restart synchronisé — ne devrait pas arriver en solo
    if (this.multi) { this.multiRestart(); return; }
    // Rejouer pendant un playtest = relance le niveau édité, pas le niveau 1 officiel
    if (this.playtesting && this._playtestData) {
      this.score = 0; this.lives = 3; this.time = 0; this.coinsTaken = 0;
      const { spawn, totalCoins } = this.world.loadLevel(this._playtestData);
      this.spawn.copy(spawn); this.totalCoins = totalCoins;
      this.player.reset(spawn);
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
      return;
    }
    if (this.state === 'menu') { this.showWorldSelect(); return; }
    // Cas game over / victoire : on propose rejouer depuis le début (reset)
    if (this.state === 'over' || this.state === 'win') {
      this.showWorldSelect(); return;
    }
    // relance depuis pause
    this.player.reset(this.spawn);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this.toast('▶ Reprise !');
  }
  _loadLevel(i) {
    // i peut être global 0-5 ou objet {world, level}
    let lvl = i, w = 1, li = 0;
    if (typeof i === 'object' && i.world) { w = i.world; li = i.level; lvl = (w-1)*3 + li; }
    else { lvl = Math.max(0, Math.min(5, i)); w = Math.floor(lvl/3)+1; li = lvl%3; }
    this.level = lvl; this.worldIdx = w; this.levelIdx = li;
    this._goalReady = { host: false, guest: false };
    this._goalToastDone = false;
    this._sentCoins = new Set();
    const data = getWorldLevel(w, li);
    const { spawn, totalCoins } = this.world.loadLevel(data);
    // double delay par niveau
    if (data.doubleDelay != null) { this.player.doubleDelay = data.doubleDelay; this.admin?.sync(); }
    this.levelSource = { type: 'official', idx: lvl, world: w, level: li, label: `Monde ${w} Niveau ${li+1}/3` };
    this.spawn.copy(spawn);
    this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.player.reset(spawn);
    this._hud(); this.editorPanel?.sync();
    this.scheduleSaveProgress();
  }
  _loadWorldLevel(worldIdx, levelIdx) { this._loadLevel((worldIdx-1)*3 + levelIdx); }
  pause() { if (this.multi) { this.toast('⏸ Pause désactivée en multi'); return; } if (this.state !== 'playing') return; this.state = 'paused'; this._show('pause'); }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this._show(null); this.last = performance.now(); }

  // ---------- API ADMIN ----------
  _guestBlocked() {
    if (this.multi && this.multi.role === 'guest') { this.toast('🔒 Réservé à l\'hôte'); return true; }
    return false;
  }
  setLives(n) {
    if (this._guestBlocked()) return;
    this.lives = Math.max(0, Math.min(99, Math.round(n)));
    if (this.lives <= 0 && this.state === 'playing' && !this.godMode) {
      this.state = 'over'; this.audio.lose();
      document.getElementById('gameover-score').textContent = `Score : ${this.score} • Niveau ${this.level + 1}`;
      this._show('gameover');
    }
    this._hud(); this.admin?.sync();
    this.netSyncState();
  }
  setFly(on) {
    this.player.fly = !!on;
    this.player.vel.set(0, 0, 0);
    this.toast(on ? '🕊️ Mode vol ON (Espace/Shift)' : '🕊️ Mode vol OFF');
    this._hud(); this.admin?.sync();
  }
  addCoins(n) {
    if (this._guestBlocked()) return;
    let added = 0;
    for (const c of this.world.coins) {
      if (added >= n) break;
      if (c.userData.taken) continue;
      c.userData.taken = true; c.visible = false;
      this.coinsTaken++; this.score += 10; added++;
      this.fx.burst(c.position, 0xFFD93D, 8, 4);
    }
    // si plus de pièces restantes, bonus direct
    if (added < n) { this.score += (n - added) * 10; this.coinsTaken = Math.min(this.totalCoins, this.coinsTaken + (n - added)); }
    this.audio.coin(); this._hud(); this.admin?.sync();
    this.netSyncState();
  }
  collectAllCoins() {
    if (this._guestBlocked()) return;
    for (const c of this.world.coins) {
      if (c.userData.taken) continue;
      c.userData.taken = true; c.visible = false;
      this.coinsTaken++; this.score += 10;
    }
    this.score += 50; this.toast('🌟 Toutes les pièces ! +50');
    this.audio.coin(); this._hud(); this.admin?.sync();
    this.netSyncState();
  }
  resetCoins() {
    if (this._guestBlocked()) return;
    for (const c of this.world.coins) { c.userData.taken = false; c.visible = true; }
    this.coinsTaken = 0; this._hud(); this.admin?.sync();
    this.netSyncState();
  }
  goToLevel(i) {
    if (this._guestBlocked()) return;
    const idx = Math.max(0, Math.min(this.maxLevels - 1, i));
    this._loadLevel(idx);
    if (this.state !== 'playing') {
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
    }
    this.toast(`🚩 Niveau ${idx + 1}`);
    this.admin?.sync();
    if (this.multi?.role === 'host') this.net.send('level', { idx });
  }
  teleportToSpawn() { this.player.reset(this.spawn); this.toast('📍 Téléporté au spawn'); }
  teleportToCheckpoint() { this.player.reset(this.spawn); this.toast('🚩 Téléporté au checkpoint'); }
  teleportToGoal() {
    if (this.world.goal) {
      const g = this.world.goal.position;
      this.player.position.set(g.x, g.y + 1.5, g.z + 1);
      this.player.vel.set(0, 0, 0);
      this.toast('🏁 Téléporté au drapeau');
    }
  }

  // ---------- MULTIJOUEUR P2P (coop, sans serveur) ----------
  _wireNet() {
    const net = this.net;
    net.on('pos', (d) => {
      if (!this.multi || !this.remotePlayer || !d?.p) return;
      this.remotePlayer.netPos = { x: d.p[0], y: d.p[1], z: d.p[2], vx: d.v[0], vy: d.v[1], vz: d.v[2], t: performance.now() };
    });
    net.on('coinGet', (d) => { // hôte : valide la pièce ramassée par l'invité
      if (this.multi?.role === 'host' && Number.isInteger(d?.i)) this.hostCoin(d.i);
    });
    net.on('coinTaken', (d) => { // invité : applique la pièce validée
      if (this.multi?.role !== 'guest' || !Number.isInteger(d?.i)) return;
      const c = this.world.coins[d.i];
      if (c && !c.userData.taken) {
        c.userData.taken = true; c.visible = false;
        this.audio.coin(); this.fx.burst(c.position, 0xFFD93D, 12, 4);
      }
      this.score = d.score ?? this.score;
      this.coinsTaken = d.coins ?? this.coinsTaken;
      if (d.bonus) this.toast('🌟 Toutes les pièces ! +50');
      this._hud();
    });
    net.on('hurt', (d) => { // hôte : l'invité a pris un dégât
      if (this.multi?.role === 'host') this.hostHurt('guest', d?.cause || 'spike');
    });
    net.on('state', (d) => { // invité : état partagé (hôte autoritaire)
      if (this.multi?.role !== 'guest' || !d) return;
      if (Number.isFinite(d.lives)) this.lives = d.lives;
      if (Number.isFinite(d.score)) this.score = d.score;
      if (Number.isFinite(d.coins)) this.coinsTaken = d.coins;
      if (Number.isFinite(d.time)) this.time = d.time;
      this._hud();
      if (d.over && this.state === 'playing') {
        this.state = 'over'; this.audio.lose();
        document.getElementById('gameover-score').textContent = `Score : ${this.score} • Niveau ${this.level + 1} (coop)`;
        this._show('gameover');
      }
    });
    net.on('hello', (_d, peerId) => { // hôte : envoie le snapshot seulement s'il est déjà en jeu
      if (this.multi?.role === 'host' && this.state === 'playing') this.sendSnap(peerId);
    });
    net.on('snap', (d) => { // invité : applique le snapshot (démarrage si en salon)
      if (this.multi?.role !== 'guest' || !d) return;
      this.applySnap(d);
    });
    net.on('goal', () => { // hôte : l'invité est au drapeau
      if (this.multi?.role !== 'host') return;
      this._goalReady.guest = true;
      this.toast('🏁 J2 au drapeau !');
      this.checkCoopGoal();
    });
    net.on('level', (d) => { // invité : changement de niveau
      if (this.multi?.role !== 'guest' || !Number.isInteger(d?.idx)) return;
      this._loadLevel(Math.max(0, Math.min(this.maxLevels - 1, d.idx)));
      this.toast(`🚩 Niveau ${this.level + 1} (coop)`);
    });
    net.on('restart', () => { // invité : (re)démarrage synchronisé par l'hôte
      if (this.multi?.role !== 'guest') return;
      this.ensureRemotePlayer();
      this.score = 0; this.lives = 3; this.time = 0;
      this._loadLevel(0);
      this.player.reset(this.spawn);
      this.remotePlayer?.reset(this.spawn);
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
      this._hud(); this.refreshNetUI();
      this.toast('▶ Partie démarrée par l\'hôte !');
      this.last = performance.now();
    });
    net.on('win', (d) => { // invité : victoire partagée
      if (this.multi?.role !== 'guest') return;
      this.state = 'win';
      document.getElementById('win-score').textContent = `Score : ${d?.score ?? this.score} (coop)`;
      document.getElementById('win-time').textContent = `Temps : ${d?.timeStr ?? ''} • 🪙 ${this.coinsTaken}/${this.totalCoins}`;
      this._show('win');
      this.audio.win();
      this.tryUnlockEditorByProgress();
    });
    net.on('full', () => { this.toast('🔒 Salon complet (2/2)'); this.setNetStatus('🔒 Salon complet (2/2) — l\'hôte a déjà un partenaire'); });
    net.on('bye', (_d, peerId) => this.onPeerLeft(peerId));
    net.on('peerJoin', (_d, peerId) => this.onPeerJoined(peerId));
    net.on('peerLeave', (_d, peerId) => this.onPeerLeft(peerId));
  }

  onPeerJoined(peerId) {
    if (!this.multi) return;
    if (this.multi.role === 'host') {
      if (this.state === 'playing') {
        this.ensureRemotePlayer();
        this.sendSnap(peerId);
        this.toast('🟢 J2 connecté !');
      } else {
        // hôte en salon : ne démarre pas auto, prévient seulement
        this.toast('🟢 J2 a rejoint ! Clique ▶ Démarrer la partie');
        this.setNetStatus(`🟢 J2 prêt — clique ▶ Démarrer la partie`);
        // ne crée pas le joueur distant tant que la partie n'a pas démarré
      }
    } else {
      // invité : prévient l'hôte et reste en attente si hôte pas encore en jeu
      this.net.send('hello', {});
      if (this.state !== 'playing') {
        this.toast('🟢 Connecté à l\'hôte ! En attente du démarrage...');
      } else {
        this.toast('🟢 Connecté à l\'hôte !');
      }
    }
    this.refreshNetUI();
  }
  onPeerLeft(peerId) {
    if (!this.multi) return;
    if (this.multi.role === 'host') {
      this.removeRemotePlayer();
      this._goalReady.guest = false;
      this.toast('🔴 J2 déconnecté — finissable en solo');
    } else {
      // promotion : l'invité devient hôte
      this.multi.role = 'host';
      this.removeRemotePlayer();
      this._goalReady.guest = false;
      this.toast('👑 Hôte parti — tu es maintenant hôte');
    }
    this.refreshNetUI();
  }

  ensureRemotePlayer() {
    if (this.remotePlayer) return;
    const label = this.multi?.role === 'host' ? 'J2' : 'J1';
    const color = this.multi?.role === 'host' ? 0x60A5FA : 0xFF6B6B;
    // le local garde sa couleur ; le distant prend l'autre
    this.player.body.material.color.setHex(this.multi?.role === 'host' ? 0xFF6B6B : 0x60A5FA);
    this.remotePlayer = new Player(this.scene, color, label);
    this.remotePlayer.remote = true;
    this.remotePlayer.reset(this.spawn);
  }
  removeRemotePlayer() {
    this.remotePlayer?.dispose();
    this.remotePlayer = null;
  }

  // ----- SALON CODE PeerJS (P2P, 2 joueurs max) -----
  _lobbyGuard() {
    if (this.multi) { this.toast('Déjà en partie (🚪 pour quitter)'); return true; }
    if (this.state === 'editing' || this.playtesting) { this.toast('Quitte l\'éditeur d\'abord'); return true; }
    return false;
  }
  _startCoopGame() {
    this._goalReady = { host: false, guest: false };
    this._goalToastDone = false;
    this._sentCoins = new Set();
    this.score = 0; this.lives = 3; this.time = 0;
    this._loadLevel(0);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this.refreshNetUI();
    this.last = performance.now();
  }
  _checkUrlJoin() {
    try {
      const code = new URLSearchParams(location.search).get('join');
      if (code) {
        const el = document.getElementById('join-code-input');
        if (el) el.value = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        this.setNetStatus('🔗 Lien d\'invitation détecté — clique 🚀 Rejoindre');
        // auto-passe en mode multi si lien détecté au boot
        if (!this.gameMode) {
          setTimeout(() => {
            if (!this.multi) {
              this.gameMode = 'multi';
              this.state = 'multi-lobby';
              this._show('multi-lobby');
              this.refreshNetUI();
              this.setNetStatus('🔗 Code pré-rempli — clique 🚀 Rejoindre');
            }
          }, 250);
        }
      }
    } catch {}
  }
  _updateHostLinkUI(code) {
    const link = `${location.origin}${location.pathname}?join=${code}`;
    const preview = document.getElementById('host-link-preview');
    if (preview) preview.textContent = link;
    try { history.replaceState(null, '', `?join=${code}`); } catch {}
  }
  async hostCreate() {
    if (this._lobbyGuard()) return;
    this.gameMode = 'multi';
    this.setNetStatus('⏳ Création du salon (signalisation PeerJS)...');
    try {
      const code = await this.net.hostCreate();
      this.multi = { role: 'host', code };
      document.getElementById('host-code').textContent = code;
      document.getElementById('guest-target')?.textContent !== undefined && (document.getElementById('guest-target').textContent = code);
      this._updateHostLinkUI(code);
      // reste au lobby multi pour partager le code
      this.state = 'multi-lobby'; this._show('multi-lobby');
      document.getElementById('hud')?.classList.add('hidden');
      this.refreshNetUI();
      const turnHint = new URLSearchParams(location.search).has('turn') ? ' (TURN actif)' : '';
      this.setNetStatus(`✅ Code créé : ${code}${turnHint} — partage-le à J2 ! En attente...`);
      this.toast(`🎮 Code : ${code} — partage-le !`);
    } catch (e) {
      console.warn('[net] hostCreate', e);
      this.setNetStatus('❌ ' + (e.message || 'Échec signalisation'));
      this.toast('❌ ' + (e.message || 'Impossible de créer le salon'));
    }
  }
  async joinWithCode() {
    if (this._lobbyGuard()) return;
    const input = document.getElementById('join-code-input');
    const raw = (input?.value || '').trim();
    if (!raw) { this.toast('⌨️ Entre le code 6 caractères'); input?.focus(); return; }
    this.setNetStatus('⏳ Connexion à ' + raw.toUpperCase() + '...');
    const badge = document.getElementById('guest-target');
    if (badge) badge.textContent = raw.toUpperCase();
    try {
      await this.net.join(raw);
      const code = this.net.code || raw.toUpperCase().replace(/^CJ-/, '');
      this.multi = { role: 'guest', code };
      this.gameMode = 'multi';
      // Reste au lobby multi, ne démarre pas la partie : seul l'hôte peut démarrer
      // Si l'hôte est déjà en jeu, il enverra un snap et on rejoindra direct
      this.state = 'multi-lobby'; this._show('multi-lobby');
      document.getElementById('hud')?.classList.add('hidden');
      this.refreshNetUI();
      this.setNetStatus('🟢 Connecté au salon ' + code + ' — en attente que l\'hôte démarre...');
      this.toast('🟢 Connecté à ' + code + ' — attente hôte');
      this.net.send('hello', {});
    } catch (e) {
      console.warn('[net] join', e);
      const msg = e.message || 'Connexion échouée';
      if (msg.includes('complet')) {
        this.setNetStatus('🔒 ' + msg);
        this.toast('🔒 Salon complet (2/2)');
      } else {
        this.setNetStatus('❌ ' + msg);
        this.toast('❌ ' + msg);
      }
    }
  }
  copyHostCode() {
    const code = this.multi?.code || document.getElementById('host-code')?.textContent || '';
    if (!code || code === '—') { this.toast('Aucun code à copier'); return; }
    navigator.clipboard?.writeText(code).then(() => this.toast('📋 Code copié : ' + code)).catch(() => {
      const el = document.getElementById('host-code'); if (el) { const r=document.createRange(); r.selectNodeContents(el); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); } this.toast('Sélectionné — fais Ctrl+C');
    });
  }
  copyHostLink() {
    const code = this.multi?.code || document.getElementById('host-code')?.textContent || '';
    if (!code || code === '—') { this.toast('Aucun lien à copier'); return; }
    const link = `${location.origin}${location.pathname}?join=${code}`;
    navigator.clipboard?.writeText(link).then(() => this.toast('🔗 Lien copié !')).catch(() => this.toast(link + ' — copie manuelle'));
  }
  hostStartGame() { // l'hôte lance (ou relance) la partie coop, l'invité est resynchronisé
    if (!this.multi || this.multi.role !== 'host') return;
    this.score = 0; this.lives = 3; this.time = 0;
    this._loadLevel(0);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    if (this.net.hasPeer) this.ensureRemotePlayer();
    else this.removeRemotePlayer(); // pas de fantôme J2 si personne n'a rejoint
    this.player.reset(this.spawn);
    this._hud(); this.refreshNetUI();
    this.net.send('restart', {});
    this.sendSnap();
    this.netSyncState();
    this.toast(this.net.hasPeer ? '▶ C\'est parti (coop) !' : '▶ Partie lancée — en attente de J2...');
    this.last = performance.now();
  }
  leaveMulti(silent = false) {
    if (!this.multi) return;
    this.net.leave();
    this.removeRemotePlayer();
    const wasHost = this.multi.role === 'host';
    this.multi = null;
    this._goalReady = { host: false, guest: false };
    this._goalToastDone = false;
    this.player.body.material.color.setHex(0xFF6B6B);
    try { history.replaceState(null, '', location.pathname); } catch {}
    this.refreshNetUI();
    if (!silent) {
      this.toast('🚪 Salon quitté');
      this.toMenu();
    }
  }

  multiRestart() {
    if (this.multi.role === 'guest') { this.toast('⏳ L\'hôte relance la partie'); return; }
    this.score = 0; this.lives = 3; this.time = 0;
    this._loadLevel(0);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this._hud();
    this.net.send('restart', {});
    this.toast('↻ Partie relancée (coop)');
  }

  // ----- logique coop (hôte autoritaire) -----
  netSyncState(extra = {}) {
    if (this.multi?.role !== 'host' || !this.net.hasPeer) return;
    this.net.send('state', { lives: this.lives, score: this.score, coins: this.coinsTaken, time: Math.floor(this.time), ...extra });
  }
  takeCoin(i, silentScore = false) {
    const c = this.world.coins[i];
    if (!c || c.userData.taken) return false;
    c.userData.taken = true; c.visible = false;
    this.coinsTaken++; this.score += 10;
    this.audio.coin(); this.fx.burst(c.position, 0xFFD93D, 12, 4);
    let bonus = false;
    if (this.coinsTaken === this.totalCoins) { this.score += 50; bonus = true; if (!silentScore) this.toast('🌟 Toutes les pièces ! +50'); }
    return bonus;
  }
  hostCoin(i) { // pièce validée par l'hôte (locale ou invité)
    const c = this.world.coins[i];
    if (!c || c.userData.taken) return;
    const bonus = this.takeCoin(i);
    this.net.send('coinTaken', { i, score: this.score, coins: this.coinsTaken, bonus });
    this._hud(); this.netSyncState();
  }
  hostHurt(who, cause) {
    if (this.godMode && who === 'host') { this.toast('😇 God mode : dégâts ignorés'); this.player.reset(this.spawn); return; }
    this.audio.hurt();
    this.shake = 0.5; this.lives--;
    if (this.lives <= 0) {
      this.state = 'over'; this.audio.lose();
      document.getElementById('gameover-score').textContent = `Score : ${this.score} • Niveau ${this.level + 1} (coop)`;
      this._show('gameover');
      this.netSyncState({ over: true });
    } else {
      if (who === 'host') {
        this.fx.burst(this.player.position, 0xef4444, 18, 6);
        this.toast(cause === 'fall' ? '💥 Ouille ! Retour au checkpoint' : '🌵 Aïe ! Pic !');
        this.player.reset(this.spawn);
      }
      this.netSyncState();
    }
    this._hud();
  }
  multiDie(cause) { // mort du joueur LOCAL en multi
    if (this.godMode) { this.toast('😇 God mode : dégâts ignorés'); this.player.reset(this.spawn); return; }
    this.fx.burst(this.player.position, 0xef4444, 18, 6);
    if (this.multi.role === 'host') {
      this.hostHurt('host', cause);
    } else {
      this.net.send('hurt', { cause });
      this.toast(cause === 'fall' ? '💥 Ouille ! Retour au checkpoint' : '🌵 Aïe ! Pic !');
      this.player.reset(this.spawn);
    }
  }
  checkCoopGoal() {
    if (this.multi?.role !== 'host' || this.state !== 'playing') return;
    if (this._goalReady.host && (!this.net.hasPeer || this._goalReady.guest)) {
      this._goalReady = { host: false, guest: false };
      this.nextLevel();
    }
  }
  sendSnap(target) {
    this.net.send('snap', {
      levelIdx: this.level,
      lives: this.lives, score: this.score, coins: this.coinsTaken, time: Math.floor(this.time),
      taken: this.world.coins.map(c => c.userData.taken ? 1 : 0),
      pos: [+this.player.position.x, +this.player.position.y, +this.player.position.z],
    }, target);
  }
  applySnap(d) {
    // Invité : rejoint la partie en cours de l'hôte
    this.ensureRemotePlayer();
    if (Number.isInteger(d.levelIdx) && d.levelIdx !== this.level) this._loadLevel(Math.max(0, Math.min(this.maxLevels - 1, d.levelIdx)));
    if (Array.isArray(d.taken)) {
      d.taken.forEach((t, i) => {
        const c = this.world.coins[i];
        if (c && t) { c.userData.taken = true; c.visible = false; }
      });
    }
    this.lives = d.lives ?? this.lives;
    this.score = d.score ?? this.score;
    this.coinsTaken = d.coins ?? this.coinsTaken;
    this.time = d.time ?? 0;
    if (Array.isArray(d.pos) && this.remotePlayer) {
      this.remotePlayer.position.set(d.pos[0], d.pos[1], d.pos[2]);
      this.remotePlayer.netPos = { x: d.pos[0], y: d.pos[1], z: d.pos[2], vx: 0, vy: 0, vz: 0, t: performance.now() };
    }
    this.player.reset(this.spawn);
    this.remotePlayer?.reset(this.spawn);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this._hud(); this.refreshNetUI();
    this.toast('🟢 Partie rejointe — coop !');
    this.last = performance.now();
  }

  setNetStatus(msg) {
    const el = document.getElementById('multi-status');
    if (el) el.textContent = msg;
  }
  refreshNetUI() {
    const inMulti = !!this.multi;
    const isHost = inMulti && this.multi.role === 'host';
    const isGuest = inMulti && this.multi.role === 'guest';
    document.getElementById('multi-offline')?.classList.toggle('hidden', inMulti);
    document.getElementById('multi-host-panel')?.classList.toggle('hidden', !isHost);
    document.getElementById('multi-guest-panel')?.classList.toggle('hidden', !isGuest);
    document.getElementById('multi-online')?.classList.toggle('hidden', !inMulti);
    document.getElementById('btn-net-leave')?.classList.toggle('hidden', !inMulti);
    document.getElementById('btn-multi-start')?.classList.toggle('hidden', !isHost);
    const pill = document.getElementById('hud-net');
    if (pill) {
      pill.classList.toggle('hidden', !inMulti);
      if (inMulti) {
        const peer = this.net.hasPeer ? '🟢' : '🟡';
        const who = this.multi.role === 'host' ? 'Hôte' : 'Invité';
        const code = this.multi.code || this.net.code || '?';
        pill.textContent = `🌐 ${code} • ${who} ${peer}`;
      }
    }
    if (inMulti) {
      const role = document.getElementById('multi-role');
      if (role) role.textContent = isHost ? `👑 Tu es l'hôte — Code ${this.multi.code}` : `🤝 Invité — Salon ${this.multi.code}`;
      const codeDisp = document.getElementById('multi-code-display');
      if (codeDisp) codeDisp.textContent = `Code : ${this.multi.code}`;
      // maj host-code si besoin
      const hc = document.getElementById('host-code');
      if (hc && isHost && this.multi.code) hc.textContent = this.multi.code;
      const gt = document.getElementById('guest-target');
      if (gt && isGuest) gt.textContent = this.multi.code;
      if (this.net.hasPeer) {
        if (this.state === 'playing') this.setNetStatus('🟢 Partenaire connecté — coop !');
        else if (isHost) this.setNetStatus(`🟢 J2 prêt — clique ▶ Démarrer la partie`);
        else this.setNetStatus('🟡 Connecté — en attente que l\'hôte démarre la partie...');
      } else if (isHost) {
        const turnHint = new URLSearchParams(location.search).has('turn') ? ' (TURN actif)' : '';
        this.setNetStatus(`🟡 En attente de J2... Partage le code ${this.multi.code}${turnHint} ou le lien ?join=${this.multi.code}`);
      } else {
        this.setNetStatus('🟡 Connecté au salon — synchronisation...');
      }
    } else {
      // pré-remplir join input si ?join= présent
      try {
        const j = new URLSearchParams(location.search).get('join');
        if (j) { const el=document.getElementById('join-code-input'); if(el && !el.value) el.value=j.toUpperCase().slice(0,6); }
      } catch {}
    }
  }

  refreshNetPill() { // statut live 🟡/🟢 sans reconstruire l'UI
    if (!this.multi) return;
    const pill = document.getElementById('hud-net');
    if (pill) {
      const txt = `🌐 ${this.multi.code} • ${this.multi.role === 'host' ? 'Hôte' : 'Invité'} ${this.net.hasPeer ? '🟢' : '🟡'}`;
      if (pill.textContent !== txt) pill.textContent = txt;
    }
  }

  // ---------- ÉDITEUR ----------
  toggleEditor() {
    if (!this.isEditorAvailable()) {
      if (this.multi) { this.toast('🔒 Éditeur en multi : uniquement en mode admin'); return; }
      this.toast('🔒 Éditeur verrouillé — termine les 3 niveaux ou entre le code admin (🔑 dans le menu)');
      this.showSaveSelect();
      return;
    }
    if (this.state === 'editing') this.exitEditor();
    else if (this.playtesting) this.stopPlaytest();
    else this.enterEditor();
  }
  enterEditor() {
    if (!this.isEditorAvailable()) {
      if (this.multi) { this.toast('🔒 Éditeur en multi : admin requis'); return; }
      this.toast('🔒 Éditeur verrouillé — termine les 3 niveaux ou unlock admin');
      return;
    }
    if (this.multi && !isAdminUnlocked()) { this.toast('🧱 Éditeur en multi : admin requis (déverrouille via 🔑)'); return; }
    if (this.state === 'editing') return;
    if (!this.world.platforms.length) this.world.buildLevel(0);
    this._preEditorState = this.state;
    this.playtesting = false;
    this.state = 'editing';
    this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    document.getElementById('editor-panel')?.classList.remove('hidden');
    this.admin?.hide?.() || document.getElementById('admin-panel')?.classList.add('hidden');
    this.player.vel.set(0, 0, 0);
    this.editor.enable();
    this.editorPanel?.sync();
    this.toast('🧱 Mode édition (F3 pour sortir)');
  }
  exitEditor() {
    if (this.state !== 'editing') return;
    this.editor.disable();
    document.getElementById('editor-panel')?.classList.add('hidden');
    // recharge le niveau édité pour reset pièces/effets, puis retour état précédent
    const data = this.world.serialize();
    const { spawn, totalCoins } = this.world.loadLevel(data);
    this.spawn.copy(spawn); this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.player.reset(spawn);
    this.levelSource = { type: 'custom', idx: -1, label: '✏️ Niveau édité' };
    this._hud(); this.editorPanel?.sync();
    if (this._preEditorState === 'playing' || this._preEditorState === 'paused') {
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
    } else {
      this.toMenu();
    }
    this.last = performance.now();
  }
  playtest() {
    if (this.state !== 'editing') { this.enterEditor(); return; }
    const data = this.world.serialize();
    const v = validate(data);
    if (!v.ok) { this.toast('❌ ' + v.errors[0]); return; }
    this._playtestData = data;
    this.playtesting = true;
    const { spawn, totalCoins } = this.world.loadLevel(data);
    this.spawn.copy(spawn); this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.score = 0; this.lives = 3; this.time = 0;
    this.player.reset(spawn);
    this.editor.disable();
    document.getElementById('editor-panel')?.classList.add('hidden');
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this._hud();
    this.toast('▶ TEST — atteins le drapeau ! (F3 = retour)');
    this.last = performance.now();
  }
  stopPlaytest() {
    if (!this._playtestData) { this.playtesting = false; return; }
    const { spawn, totalCoins } = this.world.loadLevel(this._playtestData);
    this.spawn.copy(spawn); this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.player.reset(spawn);
    this.playtesting = false;
    this.state = 'editing'; this._show(null);
    document.getElementById('editor-panel')?.classList.remove('hidden');
    this.editor.enable();
    this.editorPanel?.sync();
    this._hud();
    this.toast('⏹ Retour édition');
    this.last = performance.now();
  }
  /** Appelé après chaque mutation de l'éditeur : HUD + autosave */
  syncAfterEdit(_src, silent = false) {
    this.spawn.copy(this.world.spawnPos);
    this.totalCoins = this.world.coins.length;
    this.coinsTaken = Math.min(this.coinsTaken, this.totalCoins);
    this._hud(); this.admin?.sync();
    if (!silent) this.editorPanel?.sync();
    else {
      const d = this.world.serialize();
      const el = document.getElementById('editor-counts');
      if (el) el.textContent = `🧱 ${d.platforms.length} • 🪙 ${d.coins.length} • 🌵 ${d.spikes.length} • 🚩 ${d.checkpoints.length} • 🏁 ${d.goal ? 1 : 0}`;
    }
    // autosave si on édite un slot custom
    if (this.levelSource?.type === 'custom' && this.levelSource?.slot != null) {
      clearTimeout(this._autosaveT);
      const slot = this.levelSource.slot;
      this._autosaveT = setTimeout(() => {
        try { saveCustomSlot(slot, this.world.serialize()); this.editorPanel?.sync(); } catch { /* quota */ }
      }, 600);
    }
  }
  loadCustom(slot) {
    const data = loadCustomSlots()[slot];
    if (!data) { this.toast(`📭 Slot Custom ${slot + 1} vide`); return; }
    const v = validate(data);
    if (!v.ok) { this.toast('❌ Slot corrompu : ' + v.errors[0]); return; }
    this.editor.pushUndo();
    const { spawn, totalCoins } = this.world.loadLevel(data);
    this.spawn.copy(spawn); this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.player.reset(spawn);
    this.levelSource = { type: 'custom', slot, label: `💾 Custom ${slot + 1}` };
    if (this.state !== 'editing') {
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
    }
    this._hud(); this.editorPanel?.sync();
    this.toast(`💾 Custom ${slot + 1} chargé`);
  }
  saveCustom(slot) {
    try {
      saveCustomSlot(slot, this.world.serialize());
      this.levelSource = { type: 'custom', slot, label: `💾 Custom ${slot + 1}` };
      this.editorPanel?.sync();
      this.toast(`💾 Sauvé dans Custom ${slot + 1}`);
    } catch { this.toast('❌ Sauvegarde impossible (quota ?)'); }
  }
  newCustomLevel() {
    this.editor.pushUndo();
    const { spawn, totalCoins } = this.world.loadLevel(blankLevel());
    this.spawn.copy(spawn); this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.player.reset(spawn);
    const slots = loadCustomSlots();
    const free = slots.findIndex(s => !s);
    this.levelSource = { type: 'custom', slot: free >= 0 ? free : 0, label: '📄 Nouveau (non sauvé)' };
    this._hud(); this.editorPanel?.sync();
    this.toast('📄 Niveau vierge — pense à Sauver');
  }
  die(cause) {
    if (this.multi) { this.multiDie(cause); return; }
    if (this.godMode) { this.toast('😇 God mode : dégâts ignorés'); this.player.reset(this.spawn); return; }
    this.audio.hurt();
    this.fx.burst(this.player.position, 0xef4444, 18, 6);
    this.shake = 0.5; this.lives--;
    this._hud();
    if (this.lives <= 0) {
      this.state = 'over'; this.audio.lose();
      document.getElementById('gameover-score').textContent = `Score : ${this.score} • Monde ${this.worldIdx} Niveau ${this.levelIdx+1}`;
      this._show('gameover');
    } else {
      const msg = cause === 'fall' ? '💥 Ouille ! Retour au checkpoint' : cause === 'laser' ? '🔴 Touché par laser !' : '🌵 Aïe ! Pic !';
      this.toast(msg);
      this.player.reset(this.spawn);
    }
  }
  nextLevel() {
    // En playtest : le drapeau valide le niveau et retourne à l'édition
    if (this.playtesting) {
      this.audio.win();
      this.fx.burst(this.player.position, 0xfbbf24, 30, 7, 1.2);
      this.toast('🏁 Niveau valide ! Retour édition');
      setTimeout(() => this.stopPlaytest(), 900);
      return;
    }
    this.audio.win(); this.score += 100;
    this.fx.burst(this.player.position, 0xfbbf24, 30, 7, 1.2);
    // Monde 1 -> Monde 2 transition
    if (this.worldIdx === 1 && this.levelIdx === 2) {
      // fin Monde 1
      this.unlockWorld2ForActiveSlot();
      this.tryUnlockEditorByProgress();
      this.toast('🌟 Monde 1 terminé ! Monde 2 Neige débloqué !');
      // passe au Monde 2 Niveau 1 si on veut enchaîner, sinon win intermédiaire
      this._loadLevel(3);
      if (this.multi?.role === 'host') this.net.send('level', { idx: this.level });
      this.saveProgress();
      return;
    }
    if (this.level + 1 >= this.maxLevels) {
      this.state = 'win';
      const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
      const timeStr = `${m}:${String(s).padStart(2, '0')}`;
      document.getElementById('win-score').textContent = `Score : ${this.score}${this.multi ? ' (coop)' : ''}`;
      document.getElementById('win-time').textContent = `Temps : ${timeStr} • 🪙 ${this.coinsTaken}/${this.totalCoins} • Monde ${this.worldIdx}`;
      this._show('win');
      this.tryUnlockEditorByProgress();
      this.saveProgress();
      if (this.multi?.role === 'host') this.net.send('win', { score: this.score, timeStr });
    } else {
      this.toast(`✅ ${this.levelSource.label} terminé ! +100`);
      this._loadLevel(this.level + 1);
      if (this.multi?.role === 'host') this.net.send('level', { idx: this.level });
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = Math.min(0.033, (now - this.last) / 1000); this.last = now;
    if (this.state === 'playing') {
      this.time += dt;
      this._progressT += dt;
      if (this._progressT > 2) { this._progressT = 0; this.saveProgress(); }
      this.world.update(dt);
      const move = this.input.getMoveVector(0);
      const jump = this.input.consumeJump();
      const jumpHeld = this.input.jumpHeld;
      const k = this.input.keys;
      const flyUp = !!(this.admin?._flyUpBtn || k['Space']);
      const flyDown = !!(this.admin?.flyDownHeld || k['ShiftLeft'] || k['ShiftRight'] || k['KeyC'] || k['ControlLeft'] || k['ControlRight']);
      this.player.update(dt, move, jump, jumpHeld, this.audio, flyUp, flyDown);
      resolveCollisions(this.player, this.world.platforms, dt);
      if (this.player.didBounce) { this.audio.bounce(); this.fx.burst(this.player.position, 0xfb923c, 10, 4); }

      // pièces
      for (let i = 0; i < this.world.coins.length; i++) {
        const c = this.world.coins[i];
        if (c.userData.taken) continue;
        if (c.position.distanceTo(this.player.position) < 1.1) {
          if (this.multi) {
            if (this.multi.role === 'host') this.hostCoin(i);
            else if (!this._sentCoins.has(i)) { this._sentCoins.add(i); this.net.send('coinGet', { i }); }
          } else {
            c.userData.taken = true; c.visible = false;
            this.coinsTaken++; this.score += 10;
            this.audio.coin(); this.fx.burst(c.position, 0xFFD93D, 12, 4);
            if (this.coinsTaken === this.totalCoins) { this.score += 50; this.toast('🌟 Toutes les pièces ! +50'); }
            this.scheduleSaveProgress();
          }
        }
      }
      // pics
      for (const s of this.world.spikes) {
        const d = new THREE.Vector3(s.position.x, this.player.position.y, s.position.z).distanceTo(this.player.position);
        if (d < 0.75 && Math.abs(s.position.y - this.player.position.y) < 1.1) { this.die('spike'); break; }
      }
      // vent (Monde 2)
      for (const w of this.world.windZones) {
        const wd = w.userData.wind;
        const sx = wd.sx/2, sy = wd.sy/2, sz = wd.sz/2;
        if (Math.abs(this.player.position.x - w.position.x) < sx + 0.35 &&
            Math.abs(this.player.position.y - w.position.y) < sy + 0.5 &&
            Math.abs(this.player.position.z - w.position.z) < sz + 0.35) {
          this.player.vel.x += wd.dir.x * wd.force * dt * 6;
          this.player.vel.z += wd.dir.z * wd.force * dt * 6;
          if (Math.random()<0.08) this.fx.burst(this.player.position, 0x88ccff, 1, 1.2, 0.3);
        }
      }
      // lasers (Monde 2)
      for (const l of this.world.lasers) {
        const ld = l.userData.laser;
        let hit = false;
        const p = this.player.position;
        if (ld.mode === 'static' || ld.mode === 'slide') {
          const len = ld.length; const half = len/2;
          if (ld.dir === 'x' || ld.axis === 'x') {
            if (Math.abs(p.z - l.position.z) < 0.7 && Math.abs(p.y - l.position.y) < 0.9 && Math.abs(p.x - l.position.x) < half + 0.35) hit = true;
          } else {
            if (Math.abs(p.x - l.position.x) < 0.7 && Math.abs(p.y - l.position.y) < 0.9 && Math.abs(p.z - l.position.z) < half + 0.35) hit = true;
          }
        } else if (ld.mode === 'spin') {
          const len = ld.length/2;
          // beam tourne autour Y, on teste distance au segment
          const angle = l.rotation.y;
          const dx = Math.cos(angle) * len, dz = Math.sin(angle) * len;
          // distance point à segment
          const x1 = l.position.x - dx, z1 = l.position.z - dz;
          const x2 = l.position.x + dx, z2 = l.position.z + dz;
          const A = p.x - x1, B = p.z - z1, C = x2 - x1, D = z2 - z1;
          const dot = A*C + B*D; const len2 = C*C + D*D; const t = Math.max(0, Math.min(1, dot/len2));
          const cx = x1 + C*t, cz = z1 + D*t;
          const dist = Math.hypot(p.x - cx, p.z - cz);
          if (dist < 0.7 && Math.abs(p.y - l.position.y) < 0.9) hit = true;
        }
        if (hit) { this.die('laser'); break; }
      }
      // checkpoints
      for (const cp of this.world.checkpoints) {
        if (!cp.userData.activated && cp.position.distanceTo(this.player.position) < 2.2) {
          cp.userData.activated = true;
          cp.children[1].material.color.setHex(0xfbbf24);
          this.spawn.copy(cp.userData.spawn);
          this.audio.checkpoint(); this.toast('🚩 Checkpoint !');
          this.fx.burst(cp.position, 0x22c55e, 14, 5);
        }
      }
      // chute
      if (this.player.position.y < -8) this.die('fall');
      // goal : en coop les DEUX doivent toucher le drapeau
      if (this.world.goal && this.world.goal.position.distanceTo(this.player.position) < 2.4) {
        if (this.multi) {
          if (this.multi.role === 'host') {
            this._goalReady.host = true;
            this.checkCoopGoal();
          } else if (now - this._goalSendT > 2000) {
            this._goalSendT = now;
            this.net.send('goal', {});
            if (!this._goalToastDone) { this._goalToastDone = true; this.toast('🏁 En attente de l\'hôte...'); }
          }
        } else this.nextLevel();
      }

      // poussière quand on court au sol
      if (this.player.grounded && Math.hypot(this.player.vel.x, this.player.vel.z) > 6 && Math.random() < 0.15)
        this.fx.burst(this.player.position, 0xffffff, 1, 1.5, 0.4, -2);

      this.fx.update(dt);
      this.rig.update(dt, this.player.position);
      // ----- MULTI : positions + état -----
      if (this.multi) {
        this._posT += dt;
        if (this._posT > 1 / 15) {
          this._posT = 0;
          const p = this.player.position, v = this.player.vel;
          this.net.send('pos', {
            p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
            v: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)],
          });
        }
        if (this.multi.role === 'host') {
          this._stateT += dt;
          if (this._stateT > 1) { this._stateT = 0; this.netSyncState(); }
        }
        this.remotePlayer?.updateRemote(dt);
        this.refreshNetPill();
      }
      // soleil suit le joueur pour ombres stables
      this.sun.position.set(this.player.position.x + 12, 20, this.player.position.z + 8);
      this.sun.target.position.copy(this.player.position);
      this.sun.target.updateMatrixWorld();
      // screen shake
      if (this.shake > 0) {
        this.shake -= dt;
        this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
        this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      }
      this._hud();
    } else if (this.state === 'editing') {
      this.world.update(dt);
      this.editor.update(dt);
      this.fx.update(dt);
      // soleil suit la cible d'édition pour des ombres stables
      const t = this.editor.orbit.target;
      this.sun.position.set(t.x + 12, 20, t.z + 8);
      this.sun.target.position.copy(t);
      this.sun.target.updateMatrixWorld();
      this._hud();
    } else if (this.state === 'menu') {
      // joli fond animé derrière le menu
      const t = now / 1000;
      this.camera.position.set(Math.sin(t * 0.2) * 14, 9, 6 + Math.cos(t * 0.15) * 6);
      this.camera.lookAt(0, 1, -10);
      this.world.update(dt);
      if (!this.world.platforms.length) this.world.buildLevel(0);
      this.fx.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
