// Format de niveau JSON partagé : World.loadLevel(data) <-> World.serialize() <-> Editor.
// data = { spawn:{x,y,z}, platforms:[{x,y,z,sx,sy,sz,opts:{color,type,move,speed}}],
//   coins:[{x,y,z}], spikes:[{x,y,z}], checkpoints:[{x,y,z}], goal:{x,y,z}|null }

const PALETTE = [0x4ADE80, 0x60A5FA, 0xFBBF24, 0xF472B6, 0xA78BFA, 0xFB923C];
export const STORAGE_KEY = 'cubejump-levels-v1';
export const CUSTOM_SLOTS = 3;

export function blankLevel() {
  return {
    spawn: { x: 0, y: 3, z: 8 },
    platforms: [{ x: 0, y: 0, z: 8, sx: 6, sy: 1, sz: 6, opts: { color: 0x4ADE80 } }],
    coins: [],
    spikes: [],
    checkpoints: [],
    goal: { x: 0, y: 1.5, z: -6 },
  };
}

// --- Niveaux officiels (miroirs de World._level1/2/3) ---
function level1() {
  const d = blankLevel();
  d.platforms = [{ x: 0, y: 0, z: 8, sx: 6, sy: 1, sz: 6, opts: { color: 0x4ADE80 } }];
  d.coins = []; d.spikes = []; d.checkpoints = [];
  for (let i = 0; i < 5; i++) {
    d.platforms.push({ x: 0, y: 0.5, z: 4 - i * 3.4, sx: 2.6, sy: 0.8, sz: 2.6, opts: { color: PALETTE[i % PALETTE.length] } });
    if (i % 2 === 0) d.coins.push({ x: 0, y: 2.1, z: 4 - i * 3.4 });
  }
  d.platforms.push({ x: 0, y: 1.5, z: -14, sx: 3, sy: 0.8, sz: 3, opts: { color: 0x60A5FA, type: 'bouncy' } });
  d.platforms.push({ x: 4, y: 2.2, z: -19, sx: 2.6, sy: 0.8, sz: 2.6, opts: { color: 0xA78BFA } });
  d.platforms.push({ x: -2, y: 2.2, z: -24, sx: 8, sy: 0.8, sz: 4, opts: { color: 0x4ADE80 } });
  d.spikes.push({ x: -2, y: 3.1, z: -24 });
  d.coins.push({ x: 1, y: 3.6, z: -24 }, { x: 2.2, y: 3.6, z: -24 });
  d.checkpoints.push({ x: -2, y: 2.6, z: -26.5 });
  d.platforms.push({ x: -2, y: 2.6, z: -32, sx: 2.6, sy: 0.8, sz: 2.6, opts: { color: 0x60A5FA, move: 'x', speed: 1.4 } });
  d.platforms.push({ x: -2, y: 3, z: -37, sx: 3, sy: 0.8, sz: 3, opts: { color: 0xFBBF24 } });
  d.goal = { x: -2, y: 3.5, z: -42 };
  return d;
}

function level2() {
  const d = blankLevel();
  d.platforms = [
    { x: 0, y: 0, z: 8, sx: 6, sy: 1, sz: 6, opts: { color: 0x60A5FA } },
    { x: 0, y: 0.6, z: 2, sx: 2.4, sy: 0.8, sz: 2.4, opts: { color: 0xFBBF24 } },
    { x: 3.5, y: 1.4, z: -2, sx: 2.4, sy: 0.8, sz: 2.4, opts: { color: 0xF472B6 } },
    { x: 0, y: 2, z: -6, sx: 2.4, sy: 0.8, sz: 2.4, opts: { color: 0xA78BFA, move: 'z', speed: 1.6 } },
    { x: -3.5, y: 2.6, z: -10, sx: 4, sy: 0.8, sz: 4, opts: { color: 0x4ADE80 } },
  ];
  d.spikes = [{ x: -4.2, y: 3.5, z: -10 }, { x: -2.8, y: 3.5, z: -10 }];
  d.coins = [{ x: -3.5, y: 4.2, z: -10 }];
  d.checkpoints = [{ x: -3.5, y: 3, z: -12.5 }];
  d.platforms.push({ x: 0, y: 3.2, z: -17, sx: 2.4, sy: 0.8, sz: 2.4, opts: { color: 0xFB923C, type: 'bouncy' } });
  d.platforms.push({ x: 0, y: 4.5, z: -22, sx: 3, sy: 0.8, sz: 3, opts: { color: 0x60A5FA } });
  for (let i = 0; i < 3; i++) d.coins.push({ x: i - 1, y: 5.8, z: -22 });
  d.platforms.push({ x: 0, y: 4.5, z: -28, sx: 2.2, sy: 0.8, sz: 2.2, opts: { color: 0xF472B6, move: 'x', speed: 2 } });
  d.goal = { x: 0, y: 5, z: -33 };
  return d;
}

function level3() {
  const d = blankLevel();
  d.platforms = [{ x: 0, y: 0, z: 8, sx: 6, sy: 1, sz: 6, opts: { color: 0xF472B6 } }];
  d.coins = []; d.spikes = []; d.checkpoints = [];
  let x = 0, z = 4, y = 0.6;
  for (let i = 0; i < 10; i++) {
    x += (i % 2 === 0 ? 3 : -3);
    y += 0.55; z -= 4;
    const moving = i === 4 || i === 7;
    d.platforms.push({ x, y, z, sx: 2.4, sy: 0.7, sz: 2.4,
      opts: { color: PALETTE[i % PALETTE.length], ...(moving ? { move: 'x', speed: 1.8 } : {}) } });
    d.coins.push({ x, y: y + 1.5, z });
    if (i === 2 || i === 6) d.spikes.push({ x, y: y + 1, z: z + 0.6 });
  }
  d.checkpoints.push({ x, y: y + 0.4, z: z - 2 });
  d.platforms.push({ x, y: y + 0.8, z: z - 8, sx: 3, sy: 0.8, sz: 3, opts: { color: 0x4ADE80 } });
  d.goal = { x, y: y + 1.3, z: z - 13 };
  return d;
}

export function getDefaultLevel(idx) {
  if (idx === 1) return level2();
  if (idx === 2) return level3();
  return level1();
}

export function validate(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['JSON invalide'] };
  if (!data.spawn) errors.push('spawn manquant');
  if (!Array.isArray(data.platforms)) errors.push('platforms doit être un tableau');
  if (data.platforms?.length === 0) errors.push('au moins 1 plateforme requise');
  if (!data.goal) errors.push('drapeau (goal) manquant');
  for (const [i, p] of (data.platforms || []).entries()) {
    if (![p.x, p.y, p.z, p.sx, p.sy, p.sz].every(Number.isFinite)) errors.push(`plateforme #${i} : coords/tailles invalides`);
    if (p.sx <= 0 || p.sy <= 0 || p.sz <= 0) errors.push(`plateforme #${i} : taille > 0 requise`);
  }
  return { ok: errors.length === 0, errors };
}

// --- Persistance LocalStorage ---
export function loadCustomSlots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [null, null, null];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [null, null, null];
    while (arr.length < CUSTOM_SLOTS) arr.push(null);
    return arr.slice(0, CUSTOM_SLOTS);
  } catch { return [null, null, null]; }
}

export function saveCustomSlot(slot, data) {
  const arr = loadCustomSlots();
  arr[slot] = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

export function clearCustomSlot(slot) {
  const arr = loadCustomSlots();
  arr[slot] = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

export function downloadJson(data, filename = 'niveau.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
