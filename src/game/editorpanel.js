import { validate, loadCustomSlots, saveCustomSlot, clearCustomSlot, downloadJson, blankLevel } from './LevelData.js';
import { updateBox } from './Physics.js';

// Panneau latéral de l'éditeur : toolbar, propriétés, slots, export/import, playtest.
// Pattern identique à AdminPanel : new EditorPanel(game, editor).
export class EditorPanel {
  constructor(game, editor) {
    this.game = game;
    this.editor = editor;
    this.el = document.getElementById('editor-panel');
    this._armedUndo = false;
    editor.onSelect = (mesh) => this.showSelection(mesh);
    this._bind();
    this.sync();
  }
  _val(id) { return document.getElementById(id); }

  _bind() {
    const ed = this.editor, g = this.game;
    const on = (id, evt, fn) => this._val(id)?.addEventListener(evt, fn);

    // --- toolbar outils ---
    document.querySelectorAll('#editor-panel [data-tool]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        ed.setTool(btn.dataset.tool);
        document.querySelectorAll('#editor-panel [data-tool]').forEach(b => b.classList.toggle('active', b === btn));
        this._val('editor-hint').textContent = this._hintFor(btn.dataset.tool);
      });
    });

    // --- snap + hauteur ---
    on('editor-snap', 'input', e => {
      ed.snap = parseFloat(e.target.value);
      this._val('editor-snap-val').textContent = ed.snap === 0 ? 'libre' : ed.snap;
      if (ed.transformControls) ed.transformControls.setTranslationSnap(ed.snap > 0 ? ed.snap : null);
    });
    on('editor-edity-minus', 'click', () => { ed.editY = Math.max(-4, ed.editY - 0.5); this.sync(); });
    on('editor-edity-plus', 'click', () => { ed.editY = Math.min(20, ed.editY + 0.5); this.sync(); });
    on('editor-theme', 'change', e => {
      const th = e.target.value;
      g.world.applyTheme(th);
      g.world.theme = th;
      g.syncAfterEdit('theme');
      g.toast(`🎨 Thème ${th === 'snow' ? 'Neige' : 'Forêt'} appliqué`);
    });

    // --- actions ---
    on('editor-undo', 'click', () => ed.undo());
    on('editor-redo', 'click', () => ed.redo());
    on('editor-delete', 'click', () => ed.deleteSelected());
    on('editor-clear', 'click', () => { if (confirm('Tout effacer ?')) ed.clearAll(); });
    on('editor-playtest', 'click', () => g.playtest());
    on('editor-focus', 'click', () => { if (ed.selected) ed.focusOn(ed.selected.position); });

    // --- propriétés : arm undo une fois avant mutation ---
    const arm = () => { ed.pushUndo(); };
    ['ed-px', 'ed-py', 'ed-pz', 'ed-sx', 'ed-sy', 'ed-sz', 'ed-color', 'ed-move', 'ed-speed', 'ed-ptype'].forEach(id => {
      this._val(id)?.addEventListener('focus', arm);
      this._val(id)?.addEventListener('pointerdown', arm);
    });
    ['ed-px', 'ed-py', 'ed-pz'].forEach(id =>
      this._val(id)?.addEventListener('input', () => this._applyPos()));
    ['ed-sx', 'ed-sy', 'ed-sz'].forEach(id =>
      this._val(id)?.addEventListener('input', () => this._applySize()));
    on('ed-color', 'input', e => this._applyColor(e.target.value));
    on('ed-move', 'change', e => this._applyMove(e.target.value));
    on('ed-speed', 'input', e => this._applySpeed(parseFloat(e.target.value)));
    on('ed-ptype', 'change', e => this._applyPtype(e.target.value));

    // --- slots customs ---
    [0, 1, 2].forEach(i => {
      on(`editor-load-${i}`, 'click', () => g.loadCustom(i));
      on(`editor-save-${i}`, 'click', () => g.saveCustom(i));
      on(`editor-del-${i}`, 'click', () => {
        clearCustomSlot(i); g.toast(`🗑️ Slot Custom ${i + 1} effacé`); this.sync();
      });
    });
    on('editor-new', 'click', () => g.newCustomLevel());

    // --- export / import ---
    on('editor-export', 'click', () => {
      const data = g.world.serialize();
      downloadJson(data, `niveau-custom-${Date.now()}.json`);
      g.toast('⬇ Niveau exporté en JSON');
    });
    on('editor-import', 'click', () => this._val('editor-import-file')?.click());
    on('editor-import-file', 'change', e => {
      const f = e.target.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const v = validate(data);
          if (!v.ok) { g.toast('❌ JSON invalide : ' + v.errors[0]); return; }
          ed.pushUndo();
          g.world.loadLevel(data);
          ed.select(null);
          g.syncAfterEdit('import');
          g.toast('⬆ Niveau importé !');
        } catch { g.toast('❌ Fichier illisible'); }
      };
      reader.readAsText(f);
      e.target.value = '';
    });
  }

  _hintFor(tool) {
    const H = {
      select: 'Roblox : clic droit = regarder • WASD+Shift = voler • Molette = zoom • Clic = sélectionner',
      move: 'Gizmo Déplacer : flèches XYZ • Précision via grille',
      rotate: 'Gizmo Pivoter : anneaux • Snap 15°',
      scale: 'Gizmo Agrandir : cubes • Snap 0.25',
      platform: 'Clic = poser une plateforme (sur sol editY ou sur une plateforme)',
      'platform-move-x': 'Plateforme mobile axe X (violet)',
      'platform-move-z': 'Plateforme mobile axe Z (rose)',
      bouncy: 'Plateforme rebondissante orange',
      coin: 'Clic = poser une pièce',
      spike: 'Clic = poser un pic',
      checkpoint: 'Clic = poser un checkpoint (+ socle vert auto)',
      goal: 'Clic = poser le drapeau (remplace l’ancien)',
      spawn: 'Clic = déplacer le spawn du joueur',
      eraser: 'Clic = supprimer (socles auto protégés)',
    };
    return H[tool] || '';
  }

  _sel() { return this.editor.selected; }
  _num(id) { return parseFloat(this._val(id)?.value); }

  _applyPos() {
    const m = this._sel(); if (!m) return;
    const [x, y, z] = [this._num('ed-px'), this._num('ed-py'), this._num('ed-pz')];
    if ([x, y, z].every(Number.isFinite)) {
      m.position.set(x, y, z);
      if (m.userData.size) { m.userData.base?.copy(m.position); updateBox(m); }
      if (m.userData.editorKind === 'checkpoint') m.userData.spawn.set(x, y + 1.5, z);
      this.game.syncAfterEdit('props', true); // silent (pas de resync panneau pendant la frappe)
    }
  }
  _applySize() {
    const m = this._sel(); if (!m?.userData.size) return;
    const [sx, sy, sz] = [this._num('ed-sx'), this._num('ed-sy'), this._num('ed-sz')];
    if ([sx, sy, sz].every(v => Number.isFinite && v > 0)) {
      m.geometry.dispose();
      m.geometry = new (Object.getPrototypeOf(m.geometry).constructor)(sx, sy, sz);
      m.userData.size.set(sx, sy, sz);
      m.userData.base?.copy(m.position);
      updateBox(m);
      this.game.syncAfterEdit('props', true);
    }
  }
  _applyColor(hex) {
    const m = this._sel(); if (!m?.material?.color) return;
    m.material.color.set(hex);
    this.game.syncAfterEdit('props', true);
  }
  _applyMove(move) {
    const m = this._sel(); if (!m?.userData.size) return;
    m.userData.move = move === 'none' ? null : move;
    m.userData.base?.copy(m.position);
    this.game.syncAfterEdit('props', true);
  }
  _applySpeed(v) {
    const m = this._sel(); if (!m?.userData.size) return;
    if (Number.isFinite(v)) { m.userData.speed = v; this.game.syncAfterEdit('props', true); }
  }
  _applyPtype(t) {
    const m = this._sel(); if (!m?.userData.size) return;
    m.userData.type = t;
    m.material.color.setHex(t === 'bouncy' ? 0xFB923C : (m.material.color.getHex() || 0x60A5FA));
    this.game.syncAfterEdit('props', true);
  }

  showSelection(mesh) {
    const box = this._val('editor-selection');
    if (!box) return;
    if (!mesh) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const kind = mesh.userData.editorKind || '?';
    this._val('editor-sel-kind').textContent = { platform: '🧱 Plateforme', coin: '🪙 Pièce', spike: '🌵 Pic', checkpoint: '🚩 Checkpoint', goal: '🏁 Drapeau' }[kind] || kind;
    this._val('ed-px').value = mesh.position.x.toFixed(2);
    this._val('ed-py').value = mesh.position.y.toFixed(2);
    this._val('ed-pz').value = mesh.position.z.toFixed(2);
    const isPlat = !!mesh.userData.size;
    this._val('editor-size-row')?.classList.toggle('hidden', !isPlat);
    this._val('editor-plat-row')?.classList.toggle('hidden', !isPlat);
    if (isPlat) {
      this._val('ed-sx').value = mesh.userData.size.x.toFixed(2);
      this._val('ed-sy').value = mesh.userData.size.y.toFixed(2);
      this._val('ed-sz').value = mesh.userData.size.z.toFixed(2);
      this._val('ed-color').value = '#' + mesh.material.color.getHexString();
      this._val('ed-move').value = mesh.userData.move || 'none';
      this._val('ed-speed').value = mesh.userData.speed || 1.5;
      this._val('ed-ptype').value = mesh.userData.type || 'static';
    }
  }

  sync() {
    if (!this.el) return;
    const ed = this.editor, g = this.game;
    this._val('editor-snap').value = ed.snap;
    this._val('editor-snap-val').textContent = ed.snap === 0 ? 'libre' : ed.snap;
    this._val('editor-edity-val').textContent = ed.editY.toFixed(1);
    const d = g.world.serialize();
    this._val('editor-counts').textContent =
      `🧱 ${d.platforms.length} • 🪙 ${d.coins.length} • 🌵 ${d.spikes.length} • 🚩 ${d.checkpoints.length} • 🏁 ${d.goal ? 1 : 0}`;
    this._val('editor-source').textContent = g.levelSource?.label || '';
    // slots customs : occupé / vide
    const slots = loadCustomSlots();
    slots.forEach((s, i) => {
      const dot = this._val(`editor-dot-${i}`);
      if (dot) { dot.textContent = s ? '●' : '○'; dot.classList.toggle('filled', !!s); }
    });
    if (ed.selected) this.showSelection(ed.selected);
  }
}
