import * as THREE from 'three';
import { World } from './World.js';
import { updateBox } from './Physics.js';

// Outils : select | platform | platform-move-x | platform-move-z | bouncy | coin | spike | checkpoint | goal | spawn | eraser
const TOOL_SIZES = {
  'platform': [2.6, 0.8, 2.6],
  'platform-move-x': [2.6, 0.8, 2.6],
  'platform-move-z': [2.6, 0.8, 2.6],
  'bouncy': [3, 0.8, 3],
};

export class Editor {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.scene = game.scene;
    this.camera = game.camera;
    this.canvas = game.canvas;
    this.enabled = false;
    this.tool = 'select';
    this.snap = 1;
    this.editY = 1;
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null; // (source) => autosave + panel
    this.onSelect = null; // (mesh) => panel propriétés
    this._orbiting = false; this._dragging = false; this._panning = false;
    this._lastPX = 0; this._lastPY = 0;
    this.orbit = { target: new THREE.Vector3(0, 2, -12), yaw: 0, pitch: 0.55, dist: 26 };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.grid = new THREE.GridHelper(120, 60, 0xfbbf24, 0xffffff);
    this.grid.position.y = 0.02;
    this.grid.visible = false;
    this.scene.add(this.grid);

    // fantôme de prévisualisation
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.8, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this._onMove = this._onMove.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onCtx = (e) => e.preventDefault();
  }

  get isPlacementTool() { return !['select', 'eraser'].includes(this.tool); }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.grid.visible = true;
    this.pushUndo(); // état de départ pour Ctrl+Z
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKey);
    this.canvas.addEventListener('contextmenu', this._onCtx);
    this._applyCamera();
  }
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.grid.visible = false;
    this.ghost.visible = false;
    this.select(null);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKey);
    this.canvas.removeEventListener('contextmenu', this._onCtx);
  }

  setTool(t) {
    this.tool = t;
    this.select(null);
    this._updateGhostGeo();
  }
  _updateGhostGeo() {
    this.ghost.geometry.dispose();
    if (this.tool === 'coin') this.ghost.geometry = new THREE.OctahedronGeometry(0.35);
    else if (this.tool === 'spike') this.ghost.geometry = new THREE.ConeGeometry(0.45, 1, 4);
    else if (this.tool === 'spawn') this.ghost.geometry = new THREE.SphereGeometry(0.4, 10, 8);
    else if (this.tool === 'checkpoint' || this.tool === 'goal') this.ghost.geometry = new THREE.BoxGeometry(1, 2.4, 1);
    else if (TOOL_SIZES[this.tool]) { const [x, y, z] = TOOL_SIZES[this.tool]; this.ghost.geometry = new THREE.BoxGeometry(x, y, z); }
    else this.ghost.geometry = new THREE.BoxGeometry(2.6, 0.8, 2.6);
    this.ghost.material.color.setHex(this.tool === 'eraser' ? 0xef4444 : 0x22c55e);
    this.ghost.visible = this.enabled && this.isPlacementTool;
  }

  // ---------- Undo / Redo (snapshots JSON) ----------
  pushUndo() {
    try {
      this.undoStack.push(JSON.stringify(this.world.serialize()));
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    } catch { /* ignore */ }
  }
  _restore(json) {
    try {
      const data = JSON.parse(json);
      this.world.loadLevel(data);
      this.world.setSelected(null);
      this.selected = null;
      this.onSelect?.(null);
      this._emitChange('restore');
    } catch { /* ignore */ }
  }
  undo() {
    if (this.undoStack.length === 0) return;
    try { this.redoStack.push(JSON.stringify(this.world.serialize())); } catch { /* ignore */ }
    this._restore(this.undoStack.pop());
  }
  redo() {
    if (this.redoStack.length === 0) return;
    try { this.undoStack.push(JSON.stringify(this.world.serialize())); } catch { /* ignore */ }
    this._restore(this.redoStack.pop());
  }
  _emitChange(src) { this.onChange?.(src); }

  // ---------- Sélection ----------
  pickables() {
    const w = this.world;
    // exclut les socles auto (checkpoint/goal-base) : on sélectionne le drapeau parent
    const plats = w.platforms.filter(p => !p.userData.editorBase);
    return [...plats, ...w.coins, ...w.spikes, ...w.checkpoints, ...(w.goal ? [w.goal] : [])];
  }
  _castAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables(), true);
    if (hits.length === 0) return null;
    let o = hits[0].object;
    while (o && !o.userData.editorKind && o.parent) o = o.parent;
    return { object: o, point: hits[0].point };
  }
  /** Point de pose : dessus d'une plateforme touchée, sinon plan horizontal editY */
  _placementPoint(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plats = this.world.platforms;
    const hits = this.raycaster.intersectObjects(plats, false);
    const halfH = this._ghostHalfHeight();
    if (hits.length > 0) {
      const h = hits[0];
      // dessus approximatif : point + petite marge
      return new THREE.Vector3(h.point.x, h.object.position.y + h.object.userData.size.y / 2 + halfH + 0.05, h.point.z);
    }
    this.groundPlane.constant = -this.editY;
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, pt)) return pt;
    return null;
  }
  _ghostHalfHeight() {
    if (this.tool === 'coin') return 0.35;
    if (this.tool === 'spike') return 0.5;
    if (this.tool === 'spawn') return 0.4;
    if (this.tool === 'checkpoint' || this.tool === 'goal') return 1.2;
    const s = TOOL_SIZES[this.tool]; return s ? s[1] / 2 : 0.4;
  }
  _snapped(v) { return this.snap > 0 ? World.snap(v, this.snap) : v; }

  select(mesh) {
    this.selected = mesh;
    this.world.setSelected(mesh);
    this.onSelect?.(mesh);
  }

  placeAt(raw) {
    const w = this.world;
    const x = this._snapped(raw.x), y = +raw.y.toFixed(2), z = this._snapped(raw.z);
    this.pushUndo();
    if (this.tool === 'platform') w.addPlatform(x, y, z, 2.6, 0.8, 2.6, { color: 0x60A5FA });
    else if (this.tool === 'platform-move-x') w.addPlatform(x, y, z, 2.6, 0.8, 2.6, { color: 0xA78BFA, move: 'x', speed: 1.5 });
    else if (this.tool === 'platform-move-z') w.addPlatform(x, y, z, 2.6, 0.8, 2.6, { color: 0xF472B6, move: 'z', speed: 1.5 });
    else if (this.tool === 'bouncy') w.addPlatform(x, y, z, 3, 0.8, 3, { color: 0xFB923C, type: 'bouncy' });
    else if (this.tool === 'coin') w.addCoin(x, y, z);
    else if (this.tool === 'spike') w.addSpike(x, y, z);
    else if (this.tool === 'checkpoint') {
      w.checkpoints.filter(c => Math.hypot(c.position.x - x, c.position.z - z) < 0.5).forEach(c => w.removeObject(c));
      w.addCheckpoint(x, y, z);
    } else if (this.tool === 'goal') {
      if (w.goal) w.removeObject(w.goal);
      w.addGoal(x, y, z);
    } else if (this.tool === 'spawn') {
      w.spawnPos.set(x, y, z);
    }
    this.game.audio.click();
    this._emitChange('place');
  }

  deleteSelected() {
    if (!this.selected) return;
    this.pushUndo();
    this.world.removeObject(this.selected);
    this.select(null);
    this._emitChange('delete');
  }
  clearAll() {
    this.pushUndo();
    this.world.clearLevel();
    this.world.spawnPos.set(0, 3, 8);
    this.select(null);
    this._emitChange('clear');
  }
  nudge(dx, dy, dz) {
    const m = this.selected; if (!m) return;
    this.pushUndo();
    const s = this.snap > 0 ? this.snap : 0.25;
    m.position.x += dx * s; m.position.y += dy * s; m.position.z += dz * s;
    if (m.userData.size) { m.userData.base?.copy(m.position); updateBox(m); }
    this._emitChange('nudge');
    this.onSelect?.(m); // refresh panneau
  }
  setSizeSelected(sx, sy, sz) {
    const m = this.selected;
    if (!m || !m.userData.size) return;
    this.pushUndo();
    m.scale.set(sx / m.geometry.parameters.width, sy / m.geometry.parameters.height, sz / m.geometry.parameters.depth);
    // reconstruit proprement : remplace la géométrie (évite l'accumulation de scale)
    m.geometry.dispose();
    m.geometry = new THREE.BoxGeometry(sx, sy, sz);
    m.scale.set(1, 1, 1);
    m.userData.size.set(sx, sy, sz);
    m.userData.base?.copy(m.position);
    updateBox(m);
    this._emitChange('resize');
  }

  // ---------- Événements souris ----------
  _onMove(e) {
    if (!this.enabled) return;
    if (this._orbiting) {
      const dx = e.clientX - this._lastPX, dy = e.clientY - this._lastPY;
      this._lastPX = e.clientX; this._lastPY = e.clientY;
      if (this._panning) {
        const s = this.orbit.dist / 600;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
        const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
        this.orbit.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      } else {
        this.orbit.yaw -= dx * 0.005;
        this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.005, 0.1, 1.45);
      }
      this._applyCamera();
      return;
    }
    if (this._dragging && this.selected) {
      const pt = this._placementPoint(e.clientX, e.clientY);
      if (pt) {
        // drag sur le plan horizontal, garde le Y d'origine (sauf Q/E via panneau)
        this.selected.position.x = this._snapped(pt.x);
        this.selected.position.z = this._snapped(pt.z);
        if (this.selected.userData.size) {
          this.selected.userData.base?.copy(this.selected.position);
          updateBox(this.selected);
        }
      }
      return;
    }
    // fantôme
    if (this.isPlacementTool) {
      const pt = this._placementPoint(e.clientX, e.clientY);
      if (pt) {
        this.ghost.visible = true;
        this.ghost.position.set(this._snapped(pt.x), pt.y, this._snapped(pt.z));
      } else this.ghost.visible = false;
    } else this.ghost.visible = false;
  }
  _onDown(e) {
    if (!this.enabled) return;
    if (e.button === 2 || e.button === 1) {
      this._orbiting = true; this._panning = (e.button === 1 || e.shiftKey);
      this._lastPX = e.clientX; this._lastPY = e.clientY;
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    // outil sélection/gomme : clic = pick
    if (this.tool === 'select') {
      const hit = this._castAt(e.clientX, e.clientY);
      if (hit?.object) {
        this.select(hit.object);
        this.pushUndo(); // pour le drag qui suit
        this._dragging = true;
      } else {
        // drag vide = orbite
        this.select(null);
        this._orbiting = true; this._panning = false;
        this._lastPX = e.clientX; this._lastPY = e.clientY;
      }
      return;
    }
    if (this.tool === 'eraser') {
      const hit = this._castAt(e.clientX, e.clientY);
      if (hit?.object && !hit.object.userData.editorBase) {
        this.pushUndo();
        this.world.removeObject(hit.object);
        this.select(null);
        this._emitChange('erase');
      } else if (hit?.object?.userData.editorBase) {
        this.game.toast('⚠️ Socle auto : supprime le drapeau parent');
      }
      return;
    }
    // placement
    const pt = this._placementPoint(e.clientX, e.clientY);
    if (pt) this.placeAt(pt);
  }
  _onUp() {
    if (this._dragging) { this._dragging = false; this._emitChange('drag'); this.onSelect?.(this.selected); }
    this._orbiting = false; this._panning = false;
  }
  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.shiftKey) {
      this.editY = THREE.MathUtils.clamp(this.editY + (e.deltaY < 0 ? 0.5 : -0.5), -4, 20);
      this.onChange?.('edity');
    } else {
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 6, 80);
      this._applyCamera();
    }
  }
  _onKey(e) {
    if (!this.enabled) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { this.deleteSelected(); return; }
    if (e.code === 'KeyQ') { this.editY = Math.max(-4, this.editY - 0.5); this.onChange?.('edity'); }
    if (e.code === 'KeyE') { this.editY = Math.min(20, this.editY + 0.5); this.onChange?.('edity'); }
    if (e.code.startsWith('Arrow') && this.selected) {
      e.preventDefault();
      const s = 1;
      if (e.code === 'ArrowLeft') this.nudge(-s, 0, 0);
      if (e.code === 'ArrowRight') this.nudge(s, 0, 0);
      if (e.code === 'ArrowUp') this.nudge(0, 0, -s);
      if (e.code === 'ArrowDown') this.nudge(0, 0, s);
      if (e.code === 'ArrowUp' && e.shiftKey) this.nudge(0, s, 0);
    }
  }

  _applyCamera() {
    const o = this.orbit;
    this.camera.position.set(
      o.target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
      o.target.y + Math.sin(o.pitch) * o.dist,
      o.target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist
    );
    this.camera.lookAt(o.target);
  }
  focusOn(pos) { if (pos) { this.orbit.target.copy(pos); this._applyCamera(); } }

  update(dt) {
    if (!this.enabled) return;
    if (this.ghost.visible && this.tool === 'coin') this.ghost.rotation.y += dt * 3;
  }
}
