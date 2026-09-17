// QR codes : génération (qrcode-generator, chargé à la demande) et
// lecture caméra (BarcodeDetector natif, sinon jsQR en repli).
const QRGEN_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
// Préfixes des payloads QR (auto-détection au scan) — même valeurs que netplay.js
export const QR_OFFER_PREFIX = 'CJ1:';
export const QR_ANSWER_PREFIX = 'CJ2:';
export const QR_MAX_CHARS = 2600; // garde-fou capacité (ECC bas)

function loadScriptOnce(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (loadScriptOnce.cache[url]) return loadScriptOnce.cache[url];
  loadScriptOnce.cache[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error('lib introuvable')));
    s.onerror = () => reject(new Error('CDN injoignable'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('CDN trop lent')), 20000);
  }).catch((e) => { delete loadScriptOnce.cache[url]; throw e; });
  return loadScriptOnce.cache[url];
}
loadScriptOnce.cache = {};

// Dessine un QR net (modules carrés, sans flou) dans le canvas fourni
export async function drawQR(canvas, text) {
  if (text.length > QR_MAX_CHARS) throw new Error('Données trop grosses pour un QR, réessaie');
  const qrcode = await loadScriptOnce(QRGEN_URL, 'qrcode');
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = 520, scale = size / n;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) ctx.fillRect(Math.floor(c * scale), Math.floor(r * scale), Math.ceil(scale), Math.ceil(scale));
  }
}

// Ouvre la caméra et résout avec le contenu du premier QR détecté.
// onFrame({active}) : optionnel, pour afficher/masquer l'aperçu.
// Retourne {value, stop()} — stop() coupe proprement caméra + boucle.
export async function scanQR(video, onFrame) {
  if (!window.isSecureContext) throw new Error('Caméra exige HTTPS ou localhost');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    throw new Error('Caméra refusée ou indisponible');
  }
  video.srcObject = stream;
  video.hidden = false;
  await video.play().catch(() => {});
  onFrame?.({ active: true });

  let stopped = false;
  const stop = () => {
    stopped = true;
    try { stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    video.srcObject = null;
    video.hidden = true;
    onFrame?.({ active: false });
  };

  const useNative = 'BarcodeDetector' in window;
  let detector = null, jsQR = null, canvas = null, ctx = null;
  if (useNative) {
    try { detector = new BarcodeDetector({ formats: ['qr_code'] }); }
    catch { detector = null; }
  }
  if (!detector) {
    jsQR = await loadScriptOnce(JSQR_URL, 'jsQR');
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  return new Promise((resolve, reject) => {
    let last = 0;
    const loop = async (t) => {
      if (stopped) return;
      try {
        if (t - last > 300 && video.readyState >= 2 && video.videoWidth > 0) {
          last = t;
          let value = null;
          if (detector) {
            const found = await detector.detect(video).catch(() => null);
            if (found?.length) value = found[0].rawValue;
          } else {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const out = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (out?.data) value = out.data;
          }
          if (value) { stop(); resolve(value); return; }
        }
      } catch { /* ignore et continue */ }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Sécurité : abandon au bout de 3 minutes
    setTimeout(() => { if (!stopped) { stop(); reject(new Error('Scan abandonné (3 min)')); } }, 180000);
  }).then(
    (value) => ({ value, stop }),
    (e) => { stop(); throw e; }
  );
}
