import * as THREE from 'three';
import { World } from './World.js';
import { Player } from './Player.js';
import { CameraRig } from './CameraRig.js';
import { Input } from './Input.js';
import { GameAudio } from './Audio.js';
import { Effects } from './Effects.js';
import { resolveCollisions } from './Physics.js';
import { AdminPanel } from './Admin.js';
import { Editor } from './Editor.js';
import { EditorPanel } from './EditorPanel.js';
import { validate, loadCustomSlots, saveCustomSlot, blankLevel } from './LevelData.js';
import { Netplay } from './Netplay.js';

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

    this.state = 'menu'; // menu | playing | paused | over | win
    this.score = 0; this.coinsTaken = 0; this.totalCoins = 0;
    this.lives = 3; this.level = 0; this.maxLevels = 3;
    this.time = 0; this.spawn = new THREE.Vector3(0, 3, 8);
    this.shake = 0;
    this.godMode = false;
    this.levelSource = { type: 'official', idx: 0, label: 'Niveau 1/3' };
    this.playtesting = false;
    this._playtestData = null;
    this._preEditorState = 'menu';
    this._autosaveT = null;
    // ----- MULTIJOUEUR (P2P, coop) -----
    this.net = new Netplay(this);
    this.multi = null; // {role:'host'|'guest', code}
    this.remotePlayer = null;
    this._snapReceived = false;
    this._joinTimeout = null;
    this._helloTimer = null;
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
    click('btn-multi-host', () => this.hostMulti());
    click('btn-multi-join', () => this.joinMulti());
    click('btn-multi-leave', () => this.leaveMulti());
    click('btn-net-leave', () => this.leaveMulti());
    click('btn-manual-toggle', () => document.getElementById('multi-manual')?.classList.toggle('hidden'));
    click('btn-manual-offer', () => this.manualOffer());
    click('btn-manual-answer', () => this.manualAnswer());
    click('btn-manual-connect', () => this.manualConnect());
    const copyText = (id, okMsg) => {
      const el = document.getElementById(id);
      if (!el?.value) { this.toast('Rien à copier pour l\'instant'); return; }
      el.select();
      navigator.clipboard?.writeText(el.value).then(() => this.toast(okMsg)).catch(() => this.toast('Sélectionné — fais Ctrl+C'));
    };
    $('btn-manual-copy1')?.addEventListener('click', () => copyText('manual-offer-out', '📋 Code hôte copié !'));
    $('btn-manual-copy2')?.addEventListener('click', () => copyText('manual-answer-out', '📋 Réponse copiée !'));
    $('btn-multi-copy')?.addEventListener('click', () => {
      const code = this.multi?.code || '';
      if (!code) return;
      navigator.clipboard?.writeText(code).then(() => this.toast('📋 Code copié !')).catch(() => this.toast('Code : ' + code));
    });
    $('multi-code')?.addEventListener('keydown', e => {
      if (e.code === 'Enter') { e.preventDefault(); this.joinMulti(); }
      e.stopPropagation();
    });
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

  _show(id) { ['menu', 'pause', 'gameover', 'win'].forEach(m => document.getElementById(m)?.classList.add('hidden')); if (id) document.getElementById(id)?.classList.remove('hidden'); }
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
    document.getElementById('hud-level').textContent = `Niveau ${Math.min(this.level + 1, 3)}/3`;
  }

  toMenu() { this.state = 'menu'; this.playtesting = false; if (this.multi) this.leaveMulti(true); this._show('menu'); document.getElementById('hud')?.classList.add('hidden'); }
  start() {
    // Rejouer en multi (game over / victoire) = restart synchronisé
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
    this.score = 0; this.lives = 3; this.level = 0; this.time = 0; this.coinsTaken = 0;
    this._loadLevel(0);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this.toast('🪙 Ramasse les pièces, atteins le drapeau !');
  }
  _loadLevel(i) {
    this.level = i;
    this._goalReady = { host: false, guest: false };
    this._goalToastDone = false;
    this._sentCoins = new Set();
    const { spawn, totalCoins } = this.world.buildLevel(i);
    this.levelSource = { type: 'official', idx: i, label: `Niveau ${i + 1}/3` };
    this.spawn.copy(spawn);
    this.totalCoins = totalCoins; this.coinsTaken = 0;
    this.player.reset(spawn);
    this._hud(); this.editorPanel?.sync();
  }
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
    net.on('hello', (_d, peerId) => { // hôte : envoie le snapshot complet
      if (this.multi?.role === 'host') this.sendSnap(peerId);
    });
    net.on('snap', (d) => { // invité : applique le snapshot
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
    net.on('restart', () => { // invité : restart synchronisé
      if (this.multi?.role !== 'guest') return;
      this.score = 0; this.lives = 3; this.time = 0;
      this._loadLevel(0);
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
      this._hud();
      this.toast('↻ Partie relancée par l\'hôte');
    });
    net.on('win', (d) => { // invité : victoire partagée
      if (this.multi?.role !== 'guest') return;
      this.state = 'win';
      document.getElementById('win-score').textContent = `Score : ${d?.score ?? this.score} (coop)`;
      document.getElementById('win-time').textContent = `Temps : ${d?.timeStr ?? ''} • 🪙 ${this.coinsTaken}/${this.totalCoins}`;
      this._show('win');
      this.audio.win();
    });
    net.on('bye', (_d, peerId) => this.onPeerLeft(peerId));
    net.on('peerJoin', (_d, peerId) => this.onPeerJoined(peerId));
    net.on('peerLeave', (_d, peerId) => this.onPeerLeft(peerId));
  }

  onPeerJoined(peerId) {
    if (!this.multi) return;
    this.ensureRemotePlayer();
    if (this.multi.role === 'host') {
      this.sendSnap(peerId);
      this.toast('🟢 J2 connecté !');
    } else {
      this.net.send('hello', {});
      this.toast('🟢 Connecté à l\'hôte !');
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

  async hostMulti() {
    if (this.multi) { this.toast('Déjà en partie (🚪 pour quitter)'); return; }
    if (this.state === 'editing' || this.playtesting) { this.toast('Quitte l\'éditeur d\'abord'); return; }
    this.setNetStatus('⏳ Création du salon...');
    try {
      const code = await this.net.host();
      this.multi = { role: 'host', code };
      this._goalReady = { host: false, guest: false };
      this.score = 0; this.lives = 3; this.time = 0;
      this._loadLevel(0);
      this.state = 'playing'; this._show(null);
      document.getElementById('hud')?.classList.remove('hidden');
      this.refreshNetUI();
      this.toast(`🌐 Salon ${code} — partage le code !`);
    } catch (e) {
      console.warn('[net] host', e);
      this.setNetStatus('❌ Échec réseau (CDN WebRTC injoignable ?)');
      this.toast('❌ Multi indisponible hors-ligne');
    }
  }
  async joinMulti() {
    if (this.multi) { this.toast('Déjà en partie (🚪 pour quitter)'); return; }
    if (this.state === 'editing' || this.playtesting) { this.toast('Quitte l\'éditeur d\'abord'); return; }
    const input = document.getElementById('multi-code');
    const code = (input?.value || '').trim().toUpperCase();
    if (!code) { this.toast('⌨️ Entre le code du salon'); return; }
    this.setNetStatus('⏳ Connexion à ' + code + '...');
    try {
      await this.net.join(code);
    } catch (e) {
      this.setNetStatus('❌ ' + (e.message || 'Échec réseau'));
      this.toast('❌ ' + (e.message || 'Connexion impossible'));
      return;
    }
    this.multi = { role: 'guest', code };
    this._snapReceived = false;
    this.ensureRemotePlayer();
    this.net.send('hello', {});
    this.startHelloRetry();
    this.refreshNetUI();
    clearTimeout(this._joinTimeout);
    this._joinTimeout = setTimeout(() => {
      if (this.multi?.role === 'guest' && !this._snapReceived) {
        this.toast('❌ Hôte introuvable — vérifie le code et la connexion');
        this.setNetStatus('❌ Pas de réponse de l\'hôte. Vérifie : 1) le code exact, 2) que l\'hôte a cliqué « Créer un salon » et attend, 3) internet des 2 côtés. Si ton réseau bloque les relais publics, utilise la 🛠️ connexion manuelle ci-dessous.');
        this.leaveMulti(true);
      }
    }, 30000);
  }
  startHelloRetry() { // renvoie hello tant que l'hôte ne répond pas
    clearInterval(this._helloTimer);
    this._helloTimer = setInterval(() => {
      if (this.multi?.role === 'guest' && !this._snapReceived) this.net.send('hello', {});
      else clearInterval(this._helloTimer);
    }, 3000);
  }
  // ----- CONNEXION MANUELLE (copier-coller, aucun relais réseau) -----
  _manualGuard() {
    if (this.multi) { this.toast('Déjà en partie (🚪 pour quitter)'); return true; }
    if (this.state === 'editing' || this.playtesting) { this.toast('Quitte l\'éditeur d\'abord'); return true; }
    return false;
  }
  _startManualGame() {
    this._goalReady = { host: false, guest: false };
    this.score = 0; this.lives = 3; this.time = 0;
    this._loadLevel(0);
    this.state = 'playing'; this._show(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this.refreshNetUI();
    this.last = performance.now();
  }
  async manualOffer() { // HÔTE 1️⃣ : génère le code à partager
    if (this._manualGuard()) return;
    this.setNetStatus('⏳ Génération du code (rassemblement réseau local)...');
    try {
      const code = await this.net.manualHost();
      document.getElementById('manual-offer-out').value = code;
      this.multi = { role: 'host', code: 'MANUEL' };
      this._startManualGame();
      this.setNetStatus('📋 Envoie ce code à l\'autre joueur, puis colle sa réponse ci-dessous et clique 3️⃣ Connecter.');
      this.toast('📋 Code généré — partage-le !');
    } catch (e) {
      console.warn('[net] manual offer', e);
      this.setNetStatus('❌ Échec WebRTC dans ce navigateur');
      this.toast('❌ WebRTC indisponible ici');
    }
  }
  async manualAnswer() { // INVITÉ 2️⃣ : colle le code hôte -> génère sa réponse
    if (this._manualGuard()) return;
    const offer = document.getElementById('manual-offer-in')?.value || '';
    if (!offer.trim()) { this.toast('⌨️ Colle d\'abord le code de l\'hôte'); return; }
    this.setNetStatus('⏳ Génération de ta réponse...');
    try {
      const answer = await this.net.manualAnswer(offer);
      document.getElementById('manual-answer-out').value = answer;
      this.multi = { role: 'guest', code: 'MANUEL' };
      this._snapReceived = false;
      this.ensureRemotePlayer();
      this._startManualGame();
      this.startHelloRetry();
      this.setNetStatus('📋 Renvoie ce code-réponse à l\'hôte. La partie démarre dès qu\'il clique Connecter.');
      this.toast('📋 Réponse générée — renvoie-la à l\'hôte !');
    } catch (e) {
      this.setNetStatus('❌ ' + (e.message || 'Code invalide'));
      this.toast('❌ ' + (e.message || 'Code invalide'));
    }
  }
  async manualConnect() { // HÔTE 3️⃣ : colle la réponse -> connecté
    if (!this.multi || this.multi.role !== 'host' || !this.net.manual) {
      this.toast('Génère d\'abord ton code avec 1️⃣');
      return;
    }
    const ans = document.getElementById('manual-answer-in')?.value || '';
    if (!ans.trim()) { this.toast('⌨️ Colle la réponse de l\'invité'); return; }
    try {
      await this.net.manualConnect(ans);
      this.setNetStatus('⏳ Connexion directe en cours...');
      this.toast('⏳ Connexion...');
    } catch (e) {
      this.setNetStatus('❌ ' + (e.message || 'Code invalide'));
      this.toast('❌ ' + (e.message || 'Code invalide'));
    }
  }
  leaveMulti(silent = false) {
    if (!this.multi) return;
    this.net.leave();
    clearTimeout(this._joinTimeout);
    clearInterval(this._helloTimer);
    this.removeRemotePlayer();
    this.multi = null;
    this._goalReady = { host: false, guest: false };
    this.player.body.material.color.setHex(0xFF6B6B);
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
    this._snapReceived = true;
    clearTimeout(this._joinTimeout);
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
    document.getElementById('multi-offline')?.classList.toggle('hidden', inMulti);
    document.getElementById('multi-online')?.classList.toggle('hidden', !inMulti);
    document.getElementById('btn-net-leave')?.classList.toggle('hidden', !inMulti);
    const pill = document.getElementById('hud-net');
    if (pill) {
      pill.classList.toggle('hidden', !inMulti);
      if (inMulti) {
        const peer = this.net.hasPeer ? '🟢' : '🟡';
        const who = this.multi.role === 'host' ? 'Hôte' : 'Invité';
        pill.textContent = `🌐 ${this.multi.code} • ${who} ${peer}`;
      }
    }
    if (inMulti) {
      const el = document.getElementById('multi-code-show');
      if (el) el.textContent = this.multi.code;
      const role = document.getElementById('multi-role');
      if (role) role.textContent = this.multi.role === 'host' ? '👑 Tu es l\'hôte' : '🤝 Tu es invité(e)';
      this.setNetStatus(this.net.hasPeer
        ? '🟢 Partenaire connecté — coop !'
        : (this.multi.role === 'host'
          ? '🟡 Salon ouvert — reste sur cette page, ton partenaire arrive tout seul (aucune acceptation à faire, il entre juste le code).'
          : '🟡 Connexion à l\'hôte... (aucune acceptation requise côté hôte, ça se fait tout seul)'));
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
    if (this.state === 'editing') this.exitEditor();
    else if (this.playtesting) this.stopPlaytest();
    else this.enterEditor();
  }
  enterEditor() {
    if (this.multi) { this.toast('🧱 Éditeur désactivé en multi (quitte d\'abord)'); return; }
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
      document.getElementById('gameover-score').textContent = `Score : ${this.score} • Niveau ${this.level + 1}`;
      this._show('gameover');
    } else {
      this.toast(cause === 'fall' ? '💥 Ouille ! Retour au checkpoint' : '🌵 Aïe ! Pic !');
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
    if (this.level + 1 >= this.maxLevels) {
      this.state = 'win';
      const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
      const timeStr = `${m}:${String(s).padStart(2, '0')}`;
      document.getElementById('win-score').textContent = `Score : ${this.score}${this.multi ? ' (coop)' : ''}`;
      document.getElementById('win-time').textContent = `Temps : ${timeStr} • 🪙 ${this.coinsTaken}/${this.totalCoins}`;
      this._show('win');
      if (this.multi?.role === 'host') this.net.send('win', { score: this.score, timeStr });
    } else {
      this.toast(`✅ Niveau ${this.level + 1} terminé ! +100`);
      this._loadLevel(this.level + 1);
      if (this.multi?.role === 'host') this.net.send('level', { idx: this.level });
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = Math.min(0.033, (now - this.last) / 1000); this.last = now;
    if (this.state === 'playing') {
      this.time += dt;
      this.world.update(dt);
      const move = this.input.getMoveVector(0);
      const jump = this.input.consumeJump();
      const flyUp = this.admin?._flyUpBtn;
      const flyDown = this.admin?.flyDownHeld;
      this.player.update(dt, move, jump, this.audio, flyUp, flyDown);
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
          }
        }
      }
      // pics
      for (const s of this.world.spikes) {
        const d = new THREE.Vector3(s.position.x, this.player.position.y, s.position.z).distanceTo(this.player.position);
        if (d < 0.75 && Math.abs(s.position.y - this.player.position.y) < 1.1) { this.die('spike'); break; }
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
