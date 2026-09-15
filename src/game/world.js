import * as THREE from 'three';
import { updateBox } from './Physics.js';
import { getDefaultLevel } from './LevelData.js';

const PALETTE = [0x4ADE80, 0x60A5FA, 0xFBBF24, 0xF472B6, 0xA78BFA, 0xFB923C];

const THEMES = {
  forest: { bg: 0x87ceeb, fog: 0x87ceeb, ground: 0x86efac },
  snow: { bg: 0xe0f2f1, fog: 0xe0f2f1, ground: 0xffffff },
  space: { bg: 0x0f172a, fog: 0x0f172a, ground: 0x334155 },
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.platforms = [];
    this.coins = [];
    this.spikes = [];
    this.decor = new THREE.Group();
    scene.add(this.decor);
    this.goal = null; this.checkpoints = [];
    this.time = 0;
    this.theme = 'forest';
    this.selected = null;
    this.spawnPos = new THREE.Vector3(0, 3, 8);
  }
  /** Arrondi grille */
  static snap(v, step = 1) { return Math.round(v / step) * step; }
  /** Surbrillance de l'objet sélectionné */
  setSelected(mesh) {
    if (this.selected && this.selected.material?.emissive)
      this.selected.material.emissive.setHex(this.selected.userData._emissive ?? 0x000000);
    this.selected = mesh || null;
    if (mesh?.material?.emissive) {
      mesh.userData._emissive = mesh.material.emissive.getHex();
      mesh.material.emissive.setHex(0x555500);
    }
  }
  /** Sérialise le niveau courant au format LevelData */
  serialize() {
    const serPlat = this.platforms
      .filter(p => !['checkpoint', 'goal-base'].includes(p.userData.type))
      .map(p => ({
        x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2),
        sx: +p.userData.size.x.toFixed(2), sy: +p.userData.size.y.toFixed(2), sz: +p.userData.size.z.toFixed(2),
        opts: { color: p.material.color.getHex(), ...(p.userData.type !== 'static' ? { type: p.userData.type } : {}),
          ...(p.userData.move ? { move: p.userData.move, speed: p.userData.speed } : {}) },
      }));
    return {
      spawn: { x: +this.spawnPos.x.toFixed(2), y: +this.spawnPos.y.toFixed(2), z: +this.spawnPos.z.toFixed(2) },
      platforms: serPlat,
      coins: this.coins.map(c => ({ x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) })),
      spikes: this.spikes.map(s => ({ x: +s.position.x.toFixed(2), y: +s.position.y.toFixed(2), z: +s.position.z.toFixed(2) })),
      checkpoints: this.checkpoints.map(c => ({ x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) })),
      goal: this.goal ? { x: +this.goal.position.x.toFixed(2), y: +this.goal.position.y.toFixed(2), z: +this.goal.position.z.toFixed(2) } : null,
    };
  }
  /** Supprime un mesh du monde (appelée par l'éditeur, avec undo géré côté Editor) */
  removeObject(mesh) {
    if (!mesh) return;
    if (mesh === this.selected) this.selected = null;
    const drop = (arr) => { const i = arr.indexOf(mesh); if (i >= 0) arr.splice(i, 1); };
    if (mesh.userData.editorKind === 'platform') drop(this.platforms);
    else if (mesh.userData.editorKind === 'coin') drop(this.coins);
    else if (mesh.userData.editorKind === 'spike') drop(this.spikes);
    else if (mesh.userData.editorKind === 'checkpoint') {
      drop(this.checkpoints);
      // supprime aussi la plateforme verte associée (même x/z, type checkpoint)
      const base = this.platforms.find(p => p.userData.type === 'checkpoint' &&
        Math.abs(p.position.x - mesh.position.x) < 0.01 && Math.abs(p.position.z - mesh.position.z) < 0.01);
      if (base) this.removeObject(base);
    } else if (mesh.userData.editorKind === 'goal') {
      this.goal = null;
      const base = this.platforms.find(p => p.userData.type === 'goal-base' &&
        Math.abs(p.position.x - mesh.position.x) < 0.01 && Math.abs(p.position.z - mesh.position.z) < 0.01);
      if (base) this.removeObject(base);
    }
    this.scene.remove(mesh);
  }

  applyTheme(themeKey) {
    this.theme = themeKey;
    const t = THEMES[themeKey];
    this.scene.background = new THREE.Color(t.bg);
    this.scene.fog.color.setHex(t.fog);
    if(this.groundDecor) this.groundDecor.material.color.setHex(t.ground);
  }
  clearLevel() {
    for (const p of this.platforms) this.scene.remove(p);
    for (const c of this.coins) this.scene.remove(c);
    for (const s of this.spikes) this.scene.remove(s);
    for (const c of this.checkpoints) this.scene.remove(c);
    if (this.goal) this.scene.remove(this.goal);
    this.platforms = []; this.coins = []; this.spikes = []; this.checkpoints = []; this.goal = null;
  }
  
  loadLevel(data, theme = 'forest') {
    this.clearLevel();
    this.applyTheme(theme);
    data.platforms.forEach(p => this.addPlatform(p.x, p.y, p.z, p.sx, p.sy, p.sz, p.opts));
    data.coins.forEach(c => this.addCoin(c.x, c.y, c.z));
    data.spikes.forEach(s => this.addSpike(s.x, s.y, s.z));
    data.checkpoints.forEach(c => this.addCheckpoint(c.x, c.y, c.z));
    if(data.goal) this.addGoal(data.goal.x, data.goal.y, data.goal.z);
    this.spawnPos = new THREE.Vector3(data.spawn.x, data.spawn.y, data.spawn.z);
    this._decor();
    return { spawn: this.spawnPos.clone(), totalCoins: this.coins.length };
  }
  addPlatform(x, y, z, sx, sy, sz, opts = {}) {
    const color = opts.color ?? 0x7dd3fc;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    m.userData = { size: new THREE.Vector3(sx, sy, sz), type: opts.type || 'static',
      base: new THREE.Vector3(x, y, z), move: opts.move || null, phase: Math.random() * 6.28,
      speed: opts.speed || 1, delta: new THREE.Vector3() };
    if (opts.type === 'checkpoint') m.material.color.setHex(0x22c55e);
    if (opts.type === 'bouncy') m.material.color.setHex(0xfb923c);
    if (opts.type === 'goal-base') m.material.color.setHex(0x22c55e);
    m.userData.editorKind = 'platform'; m.userData.editorBase = (opts.type === 'checkpoint' || opts.type === 'goal-base');
    this.scene.add(m); this.platforms.push(m); updateBox(m);
    return m;
  }
  addCoin(x, y, z) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35),
      new THREE.MeshStandardMaterial({ color: 0xFFD93D, emissive: 0xaa7700, roughness: 0.3, metalness: 0.6 }));
    m.position.set(x, y, z); m.userData.taken = false;
    m.userData.editorKind = 'coin';
    this.scene.add(m); this.coins.push(m);
  }
  addSpike(x, y, z) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }));
    m.position.set(x, y, z); m.rotation.y = Math.PI / 4; m.castShadow = true;
    m.userData.editorKind = 'spike';
    this.scene.add(m); this.spikes.push(m);
  }
  addCheckpoint(x, y, z) {
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    pole.position.y = 1.2;
    const f = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x22c55e }));
    f.position.set(0.5, 1.9, 0);
    flag.add(pole, f); flag.position.set(x, y, z);
    flag.userData = { activated: false, spawn: new THREE.Vector3(x, y + 1.5, z), editorKind: 'checkpoint' };
    this.scene.add(flag); this.checkpoints.push(flag);
    this.addPlatform(x, y - 0.5, z, 3, 1, 3, { type: 'checkpoint' });
  }
  addGoal(x, y, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    pole.position.y = 1.7;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.1), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x664400 }));
    flag.position.set(0.75, 2.7, 0);
    g.add(pole, flag); g.position.set(x, y, z);
    g.userData.editorKind = 'goal';
    this.scene.add(g); this.goal = g;
    this.addPlatform(x, y - 0.5, z, 4, 1, 4, { type: 'goal-base' });
  }
  buildLevel(idx) {
    return this.loadLevel(getDefaultLevel(idx));
  }
  _line(x0, z0, n, gap = 3.2, y = 0) {
    for (let i = 0; i < n; i++) {
      const c = PALETTE[i % PALETTE.length];
      this.addPlatform(x0, y, z0 - i * gap, 2.6, 0.8, 2.6, { color: c });
      if (i % 2 === 0) this.addCoin(x0, y + 1.6, z0 - i * gap);
    }
  }
  _level1() {
    this.addPlatform(0, 0, 8, 6, 1, 6, { color: 0x4ade80 });
    this._line(0, 4, 5, 3.4, 0.5);
    this.addPlatform(0, 1.5, -14, 3, 0.8, 3, { color: 0x60a5fa, type: 'bouncy' });
    this.addPlatform(4, 2.2, -19, 2.6, 0.8, 2.6, { color: 0xa78bfa });
    this.addPlatform(-2, 2.2, -24, 8, 0.8, 4, { color: 0x4ade80 });
    this.addSpike(-2, 3.1, -24);
    this.addCoin(1, 3.6, -24); this.addCoin(2.2, 3.6, -24);
    this.addCheckpoint(-2, 2.6, -26.5);
    this.addPlatform(-2, 2.6, -32, 2.6, 0.8, 2.6, { color: 0x60a5fa, move: 'x', speed: 1.4 });
    this.addPlatform(-2, 3, -37, 3, 0.8, 3, { color: 0xfbbf24 });
    this.addGoal(-2, 3.5, -42);
  }
  _level2() {
    this.addPlatform(0, 0, 8, 6, 1, 6, { color: 0x60a5fa });
    this.addPlatform(0, 0.6, 2, 2.4, 0.8, 2.4, { color: 0xfbbf24 });
    this.addPlatform(3.5, 1.4, -2, 2.4, 0.8, 2.4, { color: 0xf472b6 });
    this.addPlatform(0, 2, -6, 2.4, 0.8, 2.4, { color: 0xa78bfa, move: 'z', speed: 1.6 });
    this.addPlatform(-3.5, 2.6, -10, 4, 0.8, 4, { color: 0x4ade80 });
    this.addSpike(-4.2, 3.5, -10); this.addSpike(-2.8, 3.5, -10);
    this.addCoin(-3.5, 4.2, -10);
    this.addCheckpoint(-3.5, 3, -12.5);
    this.addPlatform(0, 3.2, -17, 2.4, 0.8, 2.4, { color: 0xfb923c, type: 'bouncy' });
    this.addPlatform(0, 4.5, -22, 3, 0.8, 3, { color: 0x60a5fa });
    for (let i = 0; i < 3; i++) this.addCoin(i * 1 - 1, 5.8, -22);
    this.addPlatform(0, 4.5, -28, 2.2, 0.8, 2.2, { color: 0xf472b6, move: 'x', speed: 2 });
    this.addGoal(0, 5, -33);
  }
  _level3() {
    this.addPlatform(0, 0, 8, 6, 1, 6, { color: 0xf472b6 });
    let x = 0, z = 4, y = 0.6;
    for (let i = 0; i < 10; i++) {
      x += (i % 2 === 0 ? 3 : -3);
      y += 0.55; z -= 4;
      const moving = i === 4 || i === 7;
      this.addPlatform(x, y, z, 2.4, 0.7, 2.4,
        { color: PALETTE[i % PALETTE.length], ...(moving ? { move: 'x', speed: 1.8 } : {}) });
      this.addCoin(x, y + 1.5, z);
      if (i === 2 || i === 6) this.addSpike(x, y + 1, z + 0.6);
    }
    this.addCheckpoint(x, y + 0.4, z - 2);
    this.addPlatform(x, y + 0.8, z - 8, 3, 0.8, 3, { color: 0x4ade80 });
    this.addGoal(x, y + 1.3, z - 13);
  }
  _decor() {
    // sol lointain + arbres + nuages (une seule fois)
    if (this.decorBuilt) return; this.decorBuilt = true;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 24),
      new THREE.MeshStandardMaterial({ color: 0x86efac }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -6; ground.receiveShadow = true;
    this.decor.add(ground);
    for (let i = 0; i < 24; i++) {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.4),
        new THREE.MeshStandardMaterial({ color: 0x92400e }));
      trunk.position.y = 0.7;
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.4, 6),
        new THREE.MeshStandardMaterial({ color: [0x22c55e, 0x16a34a, 0x4ade80][i % 3], flatShading: true }));
      top.position.y = 2.4;
      t.add(trunk, top);
      const a = (i / 24) * Math.PI * 2;
      t.position.set(Math.cos(a) * (18 + Math.random() * 25), -5.4, -15 + Math.sin(a) * 30);
      t.scale.setScalar(1 + Math.random());
      this.decor.add(t);
    }
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
      for (let j = 0; j < 3; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random(), 7, 6), mat);
        s.position.set(j * 1.4 - 1.4, Math.random() * 0.5, 0); c.add(s);
      }
      c.position.set((Math.random() - 0.5) * 70, 14 + Math.random() * 8, -10 - Math.random() * 50);
      this.decor.add(c); c.userData.cloud = true;
    }
  }
  update(dt) {
    this.time += dt;
    // plateformes mobiles
    for (const p of this.platforms) {
      if (!p.userData.move) { p.userData.delta.set(0, 0, 0); continue; }
      const range = 3.2;
      const off = Math.sin(this.time * p.userData.speed + p.userData.phase) * range;
      const prev = p.position.clone();
      if (p.userData.move === 'x') p.position.x = p.userData.base.x + off;
      else p.position.z = p.userData.base.z + off;
      p.userData.delta.copy(p.position).sub(prev);
      updateBox(p);
    }
    for (const c of this.coins) if (!c.userData.taken) { c.rotation.y += dt * 3; c.position.y += Math.sin(this.time * 3 + c.position.x) * dt * 0.4; }
    if (this.goal) this.goal.rotation.y += dt * 0.6;
    for (const d of this.decor.children) if (d.userData.cloud) d.position.x += dt * 0.4;
  }
}
