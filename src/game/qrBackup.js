// QR Backup — ancien système P2P sans serveur (WebRTC + QR)
// Conservé pour réutilisation future. Ne plus importer dans game.js/netplay.js.
// Contenu archivé le 17/09/2026 lors de la migration PeerJS (code 6c).

// === qr.js original ===
/*
import { QR_OFFER_PREFIX, QR_ANSWER_PREFIX } from './qr.js';
- QR_OFFER_PREFIX = 'CJ1:'
- QR_ANSWER_PREFIX = 'CJ2:'
- QR_MAX_CHARS = 2600
- drawQR(canvas, text) // via qrcode-generator CDN
- scanQR(video, onFrame) // via BarcodeDetector / jsQR
 Voir src/game/qr.js historique git pour code complet.
*/

// === netplay.js QR original (RTCPeerConnection pur) ===
/*
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
export { QR_OFFER_PREFIX, QR_ANSWER_PREFIX };

export class NetplayQRBackup {
  // manualHost() -> btoa(JSON.stringify(pc.localDescription)) -> QR
  // manualAnswer(payload) -> setRemoteDescription(offer) -> btoa(answer)
  // manualConnect(payload) -> setRemoteDescription(answer)
  // _newPC(), _waitGathering(pc, 8000), _wireManual(dc)
  // leave() ferme pc/dc
}
Voir git log avant commit PeerJS pour implémentation complète.
*/

// Ce fichier sert uniquement de documentation. Pour restaurer :
// 1. Restaurer src/game/qr.js et src/game/netplay.js depuis git
// 2. Réintégrer les panneaux QR dans index.html (.qr-canvas, #qr-host, #qr-answer, #qr-video)
// 3. Réintégrer hostQR/guestScan/hostScan/_scanOnce/stopScanUI dans game.js

export const QR_BACKUP_INFO = 'Archive QR P2P — voir commentaires ci-dessus. Date: 17/09/2026';
