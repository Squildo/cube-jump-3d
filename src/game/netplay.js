// Multijoueur P2P via PeerJS — code d'invitation 6 caractères.
// 2 joueurs max, cloud public 0.peerjs.com (signalisation).
// Double config NAT à tester : ?turn=1 active un TURN public (openrelay) en plus du STUN Google.
// Lien partageable : ?join=CODE pré-remplit le champ invité.

const ACTION_TYPES = ['pos', 'coinGet', 'coinTaken', 'hurt', 'state', 'hello', 'snap', 'goal', 'level', 'restart', 'win', 'bye', 'full', 'editorSync'];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I/O/0/1 ambigus
const CODE_LEN = 6;
const PEER_PREFIX = 'cj-';

// Config A : défaut PeerJS Cloud (STUN implicite)
// Config B : STUN Google + TURN OpenRelay (test via ?turn=1)
const ICE_TURN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
];

function genCode() {
  const a = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
  return s;
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/^CJ-/, '').replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

function useTurnConfig() {
  try { return new URLSearchParams(location.search).has('turn'); } catch { return false; }
}

// Chargement PeerJS à la demande (évite 404 si CDN down au boot)
let PeerCtor = null;
async function loadPeer() {
  if (PeerCtor) return PeerCtor;
  try {
    const m = await import('peerjs');
    PeerCtor = m.Peer || m.default?.Peer || m.default;
    if (!PeerCtor) throw new Error('Peer introuvable');
    return PeerCtor;
  } catch (e) {
    // fallback CDN global si importmap échoue (chargement script)
    if (window.Peer) { PeerCtor = window.Peer; return PeerCtor; }
    throw new Error('PeerJS indisponible (CDN)');
  }
}

export class Netplay {
  constructor(game) {
    this.game = game;
    this.role = null;      // 'host' | 'guest'
    this.peerId = null;    // id distant connecté
    this.handlers = {};    // type -> fn(data, peerId)
    this.peer = null;
    this.conn = null;
    this._code = null;     // code 6c de l'hôte
    this._useTurn = useTurnConfig();
  }

  get inRoom() { return !!this.peer; }
  get hasPeer() { return !!this.conn && this.conn.open; }
  get code() { return this._code; }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data, peerId) {
    try { this.handlers[type]?.(data, peerId); } catch (e) { console.warn('[net]', type, e); }
  }

  send(type, data) {
    if (!this.conn || !this.conn.open) return;
    try { this.conn.send(JSON.stringify({ t: type, d: data })); } catch { /* ignore */ }
  }

  _peerOptions() {
    if (!this._useTurn) return {}; // Config A : défaut cloud
    return { config: { iceServers: ICE_TURN } }; // Config B : TURN explicite
  }

  _wireConn(c) {
    c.on('open', () => {
      this.peerId = c.peer;
      this.conn = c;
      console.log('[net] conn open', c.peer, this._useTurn ? '(TURN)' : '(cloud)');
      this._emit('peerJoin', {}, c.peer);
    });
    c.on('data', (raw) => {
      try {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const { t, d } = msg;
        if (!ACTION_TYPES.includes(t)) return;
        if (t === 'full') {
          // salon complet reçu par invité
          this._emit('full', d, c.peer);
          return;
        }
        this._emit(t, d, c.peer);
      } catch { /* ignore */ }
    });
    c.on('close', () => {
      if (this.conn === c) {
        this.conn = null;
        const pid = this.peerId;
        this.peerId = null;
        this._emit('peerLeave', {}, pid || c.peer);
      } else {
        // connexion refusée (full) déjà fermée
      }
    });
    c.on('error', (e) => console.warn('[net] conn error', e));
  }

  async hostCreate() {
    this.leave();
    this.role = 'host';
    const Peer = await loadPeer();
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = genCode();
      const id = PEER_PREFIX + code;
      const opts = this._peerOptions();
      console.log('[net] host try', id, opts);
      const peer = new Peer(id, opts);
      this.peer = peer;
      this._code = code;

      const result = await new Promise((resolve, reject) => {
        let done = false;
        const to = setTimeout(() => { if (!done) { done = true; reject(new Error('Timeout signalisation')); } }, 12000);
        peer.on('open', (pid) => {
          if (done) return;
          done = true; clearTimeout(to);
          console.log('[net] peer open', pid);
          resolve(code);
        });
        peer.on('error', (err) => {
          if (done) return;
          const type = err?.type || '';
          console.warn('[net] peer error', type, err);
          if (type === 'unavailable-id') { done = true; clearTimeout(to); resolve(null); }
          else if (type === 'peer-unavailable') { /* ignore for host */ }
          else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
            // laisser timeout gérer, ou retry si besoin
          }
        });
        peer.on('disconnected', () => {
          console.warn('[net] peer disconnected, reconnecting');
          try { peer.reconnect(); } catch {}
        });
        peer.on('connection', (c) => {
          // 2 joueurs max
          if (this.conn && this.conn.open) {
            console.warn('[net] lobby full, rejecting', c.peer);
            c.on('open', () => {
              try { c.send(JSON.stringify({ t: 'full', d: { msg: 'Salon complet (2/2)' } })); } catch {}
              setTimeout(() => { try { c.close(); } catch {} }, 400);
            });
            // fallback si open jamais déclenché
            setTimeout(() => { try { if (!c.open) c.close(); } catch {} }, 2000);
            return;
          }
          this._wireConn(c);
        });
      });

      if (result === null) {
        // ID pris, retry
        try { peer.destroy(); } catch {}
        this.peer = null;
        this._code = null;
        continue;
      }
      if (result) return result; // succès

      // timeout -> nettoie et retry
      try { peer.destroy(); } catch {}
      this.peer = null;
      this._code = null;
      if (attempt === maxRetries - 1) throw new Error('Signalisation indisponible (réessaie)');
    }
    throw new Error('Impossible de créer le salon');
  }

  async join(rawCode) {
    this.leave();
    const code = normalizeCode(rawCode);
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Code invalide (6 lettres/chiffres, ex: X7K9PQ)');
    this.role = 'guest';
    this._code = code;
    const Peer = await loadPeer();
    const opts = this._peerOptions();
    const peer = new Peer(undefined, opts);
    this.peer = peer;

    await new Promise((resolve, reject) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error('Timeout signalisation')); } }, 10000);
      peer.on('open', () => {
        if (done) return;
        done = true; clearTimeout(to);
        resolve();
      });
      peer.on('error', (err) => {
        if (done) return;
        console.warn('[net] guest peer error', err?.type, err);
        if (err?.type === 'peer-unavailable') {
          // sera géré dans connect error
        }
      });
    });

    const targetId = PEER_PREFIX + code;
    console.log('[net] guest connecting to', targetId, opts);

    const c = peer.connect(targetId, { reliable: true });

    await new Promise((resolve, reject) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; try { c.close(); } catch {} reject(new Error('Hôte injoignable (code invalide ou salon fermé)')); } }, 12000);
      c.on('open', () => {
        if (done) return;
        done = true; clearTimeout(to);
        this._wireConn(c);
        // _wireConn va émettre peerJoin sur open, mais on l'a déjà branché après open
        // donc on force l'état
        this.conn = c;
        this.peerId = c.peer;
        this._emit('peerJoin', {}, c.peer);
        resolve();
      });
      c.on('error', (e) => {
        if (done) return;
        console.warn('[net] guest conn error', e);
        done = true; clearTimeout(to);
        reject(new Error('Connexion échouée (code invalide ?)'));
      });
      c.on('close', () => {
        if (!done) { done = true; clearTimeout(to); reject(new Error('Salon complet (2/2) ou hôte parti')); }
      });
      // écoute précoce d'un message 'full' avant open (fallback)
      const origOnData = c.on.bind(c);
      // on branche aussi un handler data temporaire pour 'full' avant wire
      c.on('data', (raw) => {
        try {
          const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (msg?.t === 'full' && !done) {
            done = true; clearTimeout(to);
            try { c.close(); } catch {}
            reject(new Error('🔒 Salon complet (2/2) — réessaie plus tard'));
          }
        } catch {}
      });
    });

    // écoute globale full après connexion (si host envoie juste après)
    this.on('full', () => {}); // assure handler existe, game.js va le gérer
  }

  leave() {
    try { this.conn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    try { this.peer?.disconnect(); } catch {}
    this.conn = null;
    this.peer = null;
    this.peerId = null;
    this.role = null;
    this._code = null;
  }
}
