// Multijoueur P2P sans serveur via Trystero (WebRTC).
// Chargé en import dynamique : si les CDN sont injoignables, le solo n'est pas impacté.
// Double stratégie de signaling en parallèle (Nostr + MQTT) : la première qui
// connecte les pairs gagne, l'autre est fermée. Aucune acceptation manuelle :
// les deux appareils qui entrent le même code se retrouvent automatiquement.
const loaders = {
  nostr: () => import('trystero'),
  mqtt: () => import('@trystero-p2p/mqtt'),
};

const APP_ID = 'cube-jump-3d-v1';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans ambiguïtés
export function genCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

const ACTION_TYPES = ['pos', 'coinGet', 'coinTaken', 'hurt', 'state', 'hello', 'snap', 'goal', 'level', 'restart', 'win', 'bye'];

// STUN publics (Google) : aident à traverser les box internet.
// En WiFi local, les candidats "host" suffisent même si STUN est bloqué.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export class Netplay {
  constructor(game) {
    this.game = game;
    this.rooms = [];       // [{strategy, room, chan}]
    this.winner = null;    // la room dont le pair est arrivé en premier
    this.role = null;      // 'host' | 'guest'
    this.code = null;
    this.peerId = null;
    this.handlers = {};    // type -> fn(data, peerId)
    this.manual = null;    // {pc, dc} quand le transport copier-coller est actif
  }
  get inRoom() { return this.rooms.length > 0 || !!this.manual; }
  get hasPeer() { return !!this.peerId; }
  get strategies() { return this.rooms.map(r => r.strategy).join('+'); }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data, peerId, room) {
    if (this.winner && room !== this.winner) return; // ignore le relais perdant
    try { this.handlers[type]?.(data, peerId); } catch (e) { console.warn('[net]', type, e); }
  }

  async host() {
    const code = genCode();
    await this._join(code, 'host');
    return code;
  }
  async join(code) {
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error('Code invalide (4-8 lettres/chiffres)');
    await this._join(code, 'guest');
  }

  async _join(code, role) {
    this.leave(); // sécurité
    this.code = code; this.role = role;
    // Les deux stratégies en parallèle ; si l'une échoue au chargement, l'autre suffit
    const results = await Promise.allSettled([
      loaders.nostr().then(m => ({ strategy: 'nostr', joinRoom: m.joinRoom })),
      loaders.mqtt().then(m => ({ strategy: 'mqtt', joinRoom: m.joinRoom })),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (ok.length === 0) throw new Error('Réseau P2P injoignable (vérifie ta connexion internet)');
    for (const { strategy, joinRoom } of ok) {
      const room = joinRoom({ appId: APP_ID }, 'cubejump-' + code);
      const entry = { strategy, room, chan: {} };
      for (const t of ACTION_TYPES) {
        const action = room.makeAction('cj-' + t);
        entry.chan[t] = action;
        action.onMessage = (data, meta) => this._emit(t, data, meta?.peerId, entry);
      }
      room.onPeerJoin = (peerId) => this._onPeerJoin(peerId, entry);
      room.onPeerLeave = (peerId) => {
        if (peerId !== this.peerId) return;
        this.peerId = null;
        this._emit('peerLeave', {}, peerId, entry);
      };
      this.rooms.push(entry);
    }
  }

  _onPeerJoin(peerId, entry) {
    if (this.peerId && this.peerId !== peerId) return; // V1 : 2 joueurs max
    this.peerId = peerId;
    if (!this.winner) {
      this.winner = entry;
      // ferme le relais perdant
      for (const r of this.rooms) {
        if (r !== entry) { try { r.room?.leave?.(); } catch { /* ignore */ } }
      }
      this.rooms = [entry];
    }
    this._emit('peerJoin', {}, peerId, entry);
  }

  send(type, data, target) {
    // Transport manuel prioritaire s'il est actif
    if (this.manual) {
      const dc = this.manual.dc;
      if (dc && dc.readyState === 'open') {
        try { dc.send(JSON.stringify({ t: type, d: data })); } catch { /* ignore */ }
      }
      return;
    }
    const entry = this.winner || this.rooms[0];
    if (!entry) return;
    try {
      // envoi aux deux relais tant qu'aucun gagnant (le pair est peut-être sur l'autre)
      const targets = this.winner ? [this.winner] : this.rooms;
      for (const e of targets) void e.chan[type]?.send(data, target ? { target } : undefined);
    } catch { /* pair parti */ }
  }

  // ---------- TRANSPORT MANUEL (copier-coller, 100% sans relais) ----------
  // Hôte : manualHost() -> code à partager. Invité : manualAnswer(codeHote) ->
  // code réponse à renvoyer. Hôte : manualConnect(codeReponse) -> connecté.
  _newPC() {
    return new RTCPeerConnection({ iceServers: ICE_SERVERS });
  }
  _waitGathering(pc, ms = 8000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((res) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; res(); } }, ms);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete' && !done) { done = true; clearTimeout(to); res(); }
      };
    });
  }
  _wireManual(dc) {
    dc.onopen = () => { this.peerId = 'manual'; this._emit('peerJoin', {}, 'manual', null); };
    dc.onmessage = (e) => {
      try {
        const { t, d } = JSON.parse(e.data);
        this._emit(t, d, 'manual', null);
      } catch { /* ignore */ }
    };
    dc.onclose = () => {
      if (this.peerId) { this.peerId = null; this._emit('peerLeave', {}, 'manual', null); }
    };
  }
  async manualHost() {
    this.leave();
    this.code = 'MANUEL'; this.role = 'host';
    const pc = this._newPC();
    const dc = pc.createDataChannel('cj');
    this.manual = { pc, dc };
    this._wireManual(dc);
    await pc.setLocalDescription(await pc.createOffer());
    await this._waitGathering(pc);
    return btoa(JSON.stringify(pc.localDescription));
  }
  async manualAnswer(offerCode) {
    this.leave();
    let offer;
    try { offer = JSON.parse(atob(offerCode.trim())); } catch { throw new Error('Code hôte invalide'); }
    if (!offer || !offer.sdp) throw new Error('Code hôte invalide');
    this.code = 'MANUEL'; this.role = 'guest';
    const pc = this._newPC();
    this.manual = { pc, dc: null };
    pc.ondatachannel = (e) => { this.manual.dc = e.channel; this._wireManual(e.channel); };
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await this._waitGathering(pc);
    return btoa(JSON.stringify(pc.localDescription));
  }
  async manualConnect(answerCode) {
    if (!this.manual) throw new Error('Génère d\'abord ton code (1️⃣)');
    let answer;
    try { answer = JSON.parse(atob(answerCode.trim())); } catch { throw new Error('Code réponse invalide'); }
    if (!answer || !answer.sdp) throw new Error('Code réponse invalide');
    await this.manual.pc.setRemoteDescription(answer);
  }

  leave() {
    try {
      const entry = this.winner || this.rooms[0];
      if (entry && this.peerId && this.peerId !== 'manual') void entry.chan.bye?.send({});
    } catch { /* ignore */ }
    for (const r of this.rooms) { try { r.room?.leave?.(); } catch { /* ignore */ } }
    try { this.manual?.dc?.close(); } catch { /* ignore */ }
    try { this.manual?.pc?.close(); } catch { /* ignore */ }
    this.manual = null;
    this.rooms = []; this.winner = null;
    this.role = null; this.code = null; this.peerId = null;
  }
}
