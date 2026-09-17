// Multijoueur P2P 100% sans serveur : WebRTC + QR codes.
// Aucun relais (Nostr/MQTT) : l'hôte affiche son offre en QR, l'invité la
// scanne et affiche sa réponse en QR, l'hôte la scanne à son tour.
// Le canal de données transporte ensuite le protocole de jeu (pos, pièces...).
const ACTION_TYPES = ['pos', 'coinGet', 'coinTaken', 'hurt', 'state', 'hello', 'snap', 'goal', 'level', 'restart', 'win', 'bye'];

// STUN publics (Google) : aident à traverser les box internet.
// En WiFi local, les candidats "host" suffisent même si STUN est bloqué.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// Préfixes des payloads QR (auto-détection au scan)
import { QR_OFFER_PREFIX, QR_ANSWER_PREFIX } from './qr.js';
export { QR_OFFER_PREFIX, QR_ANSWER_PREFIX };

export class Netplay {
  constructor(game) {
    this.game = game;
    this.role = null;      // 'host' | 'guest'
    this.peerId = null;
    this.handlers = {};    // type -> fn(data, peerId)
    this.manual = null;    // {pc, dc}
  }
  get inRoom() { return !!this.manual; }
  get hasPeer() { return !!this.peerId; }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, data, peerId) {
    try { this.handlers[type]?.(data, peerId); } catch (e) { console.warn('[net]', type, e); }
  }

  send(type, data) {
    const dc = this.manual?.dc;
    if (!dc || dc.readyState !== 'open') return;
    try { dc.send(JSON.stringify({ t: type, d: data })); } catch { /* ignore */ }
  }

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
    dc.onopen = () => { this.peerId = 'qr'; this._emit('peerJoin', {}, 'qr'); };
    dc.onmessage = (e) => {
      try {
        const { t, d } = JSON.parse(e.data);
        this._emit(t, d, 'qr');
      } catch { /* ignore */ }
    };
    dc.onclose = () => {
      if (this.peerId) { this.peerId = null; this._emit('peerLeave', {}, 'qr'); }
    };
  }
  // Hôte : génère l'offre à encoder en QR (retourne le payload, sans préfixe)
  async manualHost() {
    this.leave();
    this.role = 'host';
    const pc = this._newPC();
    const dc = pc.createDataChannel('cj');
    this.manual = { pc, dc };
    this._wireManual(dc);
    await pc.setLocalDescription(await pc.createOffer());
    await this._waitGathering(pc);
    return btoa(JSON.stringify(pc.localDescription));
  }
  // Invité : consomme le payload scanné (avec ou sans préfixe), retourne sa réponse
  async manualAnswer(payload) {
    this.leave();
    const raw = String(payload || '').trim().replace(/^CJ1:/, '');
    let offer;
    try { offer = JSON.parse(atob(raw)); } catch { throw new Error('QR invalide'); }
    if (!offer || !offer.sdp) throw new Error('QR invalide');
    this.role = 'guest';
    const pc = this._newPC();
    this.manual = { pc, dc: null };
    pc.ondatachannel = (e) => { this.manual.dc = e.channel; this._wireManual(e.channel); };
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await this._waitGathering(pc);
    return btoa(JSON.stringify(pc.localDescription));
  }
  // Hôte : consomme la réponse scannée (avec ou sans préfixe)
  async manualConnect(payload) {
    if (!this.manual) throw new Error('Génère d\'abord ton QR (1️⃣)');
    const raw = String(payload || '').trim().replace(/^CJ2:/, '');
    let answer;
    try { answer = JSON.parse(atob(raw)); } catch { throw new Error('QR réponse invalide'); }
    if (!answer || !answer.sdp) throw new Error('QR réponse invalide');
    await this.manual.pc.setRemoteDescription(answer);
  }

  leave() {
    try { this.manual?.dc?.close(); } catch { /* ignore */ }
    try { this.manual?.pc?.close(); } catch { /* ignore */ }
    this.manual = null;
    this.role = null; this.peerId = null;
  }
}
