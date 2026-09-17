// Connexion manuelle P2P (copier-coller) — Backup pour réutilisation future
// Ce fichier contient le code HTML + JS retiré du menu principal. À réintégrer si besoin.
//
// HTML à réintégrer dans index.html dans .multi-box après #multi-status :
/*
        <button id="btn-manual-toggle" class="ghost-btn">🛠️ Connexion manuelle (si l'auto échoue)</button>
        <div id="multi-manual" class="hidden">
          <p class="hint">Sans aucun relais : Hôte <b>1️⃣</b> génère et envoie son code → Invité <b>2️⃣</b> le colle et renvoie sa réponse → Hôte <b>3️⃣</b> la colle et connecte. Idéal même WiFi.</p>
          <div class="multi-row">
            <button id="btn-manual-offer" class="ghost-btn">1️⃣ Générer mon code (hôte)</button>
            <button id="btn-manual-copy1" class="ghost-btn" title="Copier">📋</button>
          </div>
          <textarea id="manual-offer-out" readonly placeholder="Le code de l'hôte apparaîtra ici..."></textarea>
          <div class="multi-label">Code de l'hôte → à coller chez l'invité :</div>
          <textarea id="manual-offer-in" placeholder="Colle ici le code reçu (invité)..."></textarea>
          <div class="multi-row">
            <button id="btn-manual-answer" class="ghost-btn">2️⃣ Générer ma réponse (invité)</button>
            <button id="btn-manual-copy2" class="ghost-btn" title="Copier">📋</button>
          </div>
          <textarea id="manual-answer-out" readonly placeholder="Ta réponse apparaîtra ici..."></textarea>
          <div class="multi-label">Réponse de l'invité → à coller chez l'hôte :</div>
          <textarea id="manual-answer-in" placeholder="Colle ici la réponse reçue (hôte)..."></textarea>
          <div class="multi-row">
            <button id="btn-manual-connect" class="ghost-btn">3️⃣ Connecter (hôte)</button>
          </div>
        </div>
*/

// JS à réintégrer dans src/game/game.js
// Dans _bindUI() ajouter :
/*
    click('btn-manual-toggle', () => document.getElementById('multi-manual')?.classList.toggle('hidden'));
    click('btn-manual-offer', () => this.manualOffer());
    click('btn-manual-answer', () => this.manualAnswer());
    click('btn-manual-connect', () => this.manualConnect());
    $('btn-manual-copy1')?.addEventListener('click', () => copyText('manual-offer-out', '📋 Code hôte copié !'));
    $('btn-manual-copy2')?.addEventListener('click', () => copyText('manual-answer-out', '📋 Réponse copiée !'));
*/

// Méthodes à réintégrer dans la classe Game :
/*
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
  async manualOffer() {
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
  async manualAnswer() {
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
  async manualConnect() {
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
*/

// Nécessite que Netplay expose manualHost/manualAnswer/manualConnect (déjà présent dans src/game/netplay.js).

export const manualBackupInfo = 'Backup connexion manuelle — voir commentaires ci-dessus';
