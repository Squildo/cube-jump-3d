import * as THREE from 'three';
import { resolveCollisions } from './physics.js';

export class Player {
  constructor(scene, color = 0xFF6B6B, label = null) {
    this.scene = scene;
    this.group = new THREE.Group();
    // corps low-poly : cube + yeux
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.7), bodyMat);
    this.body.position.y = 0.1; this.body.castShadow = true;
    const eyeGeo = new THREE.BoxGeometry(0.12, 0.16, 0.05);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.15, 0.2, 0.36);
    const eR = eL.clone(); eR.position.x = 0.15;
    const pL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), pupMat); pL.position.set(-0.15, 0.2, 0.39);
    const pR = pL.clone(); pR.position.x = 0.15;
    const feet = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.18, 0.74),
      new THREE.MeshStandardMaterial({ color: 0x333344 }));
    feet.position.y = -0.38;
    this.group.add(this.body, eL, eR, pL, pR, feet);
    this.feet = feet;
    if (label) this.group.add(makeLabel(label));
    scene.add(this.group);

    this.position = this.group.position;
    this.vel = new THREE.Vector3();
    this.halfW = 0.35; this.halfH = 0.5;
    this.speed = 8; this.jumpForce = 9.2;
    this.grounded = false; this.groundPlatform = null;
    this.jumps = 0; this.coyote = 0; this.jumpBuffer = 0;
    this.doubleDelay = 2.0; this.doubleCooldown = 0; this.doubleReady = true;
    this.didBounce = false;
    this.spawn = new THREE.Vector3(0, 3, 0);
    this.faceAngle = 0;
    this.fly = false;
    this.flySpeed = 10;
    this.remote = false;      // true pour le joueur piloté par le réseau
    this.netPos = null;       // dernier snapshot {x,y,z,vx,vy,vz,t}
  }
  reset(spawn) {
    this.spawn.copy(spawn);
    this.position.copy(spawn);
    this.vel.set(0, 0, 0); this.jumps = 0; this.doubleCooldown = 0; this.doubleReady = true;
  }
  getStaminaRatio() { return this.doubleReady ? 1 : Math.max(0, 1 - this.doubleCooldown / this.doubleDelay); }
  update(dt, move, wantJump, jumpHeld, audio, flyUp = false, flyDown = false) {
    // plateforme mobile : être emporté
    if (this.groundPlatform?.userData.delta) {
      this.position.x += this.groundPlatform.userData.delta.x;
      this.position.z += this.groundPlatform.userData.delta.z;
      this.position.y += this.groundPlatform.userData.delta.y;
    }
    // ---- MODE VOL ----
    if (this.fly) {
      // en vol, la vitesse horizontale utilise flySpeed (curseur Vol), pas la vitesse perso
      this.vel.x = THREE.MathUtils.damp(this.vel.x, move.x * this.flySpeed, 8, dt);
      this.vel.z = THREE.MathUtils.damp(this.vel.z, move.z * this.flySpeed, 8, dt);
      const targetY = (flyUp ? this.flySpeed : 0) + (flyDown ? -this.flySpeed : 0);
      this.vel.y = THREE.MathUtils.damp(this.vel.y, targetY, 8, dt);
      this.position.x += this.vel.x * dt;
      this.position.y += this.vel.y * dt;
      this.position.z += this.vel.z * dt;
      this.grounded = false; this.jumps = 0;
      this.didBounce = false;
      this._animate(dt);
      return;
    }
    const isIce = !!this.groundPlatform?.userData?.ice;
    const accel = this.grounded ? 40 : 18;
    this.vel.x += (move.x * this.speed - this.vel.x) * Math.min(1, accel * dt / this.speed * 8);
    this.vel.z += (move.z * this.speed - this.vel.z) * Math.min(1, accel * dt / this.speed * 8);
    // version simple + stable : glace = moins de friction
    const groundDamp = isIce ? 1.2 : 12;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, move.x * this.speed, this.grounded ? groundDamp : 4, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, move.z * this.speed, this.grounded ? groundDamp : 4, dt);
    if (isIce && this.grounded) {
      // glissade continue
      this.vel.x *= 0.995; this.vel.z *= 0.995;
    }

    this.vel.y -= 24 * dt; // gravité
    if (this.vel.y < -22) this.vel.y = -22;

    if (this.grounded) { this.jumps = 0; this.coyote = 0.12; } else this.coyote -= dt;
    if (wantJump) this.jumpBuffer = 0.12; else this.jumpBuffer -= dt;
    // stamina double-saut
    if (this.doubleCooldown > 0) { this.doubleCooldown -= dt; if (this.doubleCooldown <= 0) { this.doubleCooldown = 0; this.doubleReady = true; } }

    // Geometry Dash: maintien de Space/A = saut auto à l'atterrissage (infini), double-saut reste sur edge uniquement + stamina
    const canGroundJump = this.grounded || this.coyote > 0;
    const wantsGroundJump = this.jumpBuffer > 0 || !!jumpHeld;
    const canDoubleJump = !canGroundJump && this.jumps < 2 && this.jumps >= 0 && this.jumpBuffer > 0 && this.doubleReady;

    if ((canGroundJump && wantsGroundJump) || canDoubleJump) {
      // saut (double-saut autorisé : 2 sauts, mais double uniquement sur edge + stamina)
      const isDouble = !canGroundJump && this.jumps >= 1;
      this.vel.y = this.jumpForce;
      this.jumps++; this.jumpBuffer = 0; this.coyote = 0; this.grounded = false;
      if (isDouble) { this.doubleCooldown = this.doubleDelay; this.doubleReady = false; audio?.doubleJump(); } else audio?.jump();
      this.squash = -0.25;
    }
    this.didBounce = false;
    this.position.x += this.vel.x * dt;
    this.position.z += this.vel.z * dt;
    this.position.y += this.vel.y * dt;

    this._animate(dt);
  }
  _animate(dt) {
    if (Math.hypot(this.vel.x, this.vel.z) > 0.5) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      this.faceAngle = THREE.MathUtils.damp(this.faceAngle, target, 12, dt);
      // gérer le wrap d'angle
      let d = target - this.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.group.rotation.y += d * Math.min(1, 12 * dt);
    }
    // squash & stretch
    this.squash = THREE.MathUtils.damp(this.squash || 0, 0, 8, dt);
    const s = this.squash;
    this.body.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
  }
  /** Rendu du joueur distant : extrapolation + lissage vers le snapshot réseau */
  updateRemote(dt) {
    if (!this.netPos) return;
    const age = Math.min(0.5, (performance.now() - this.netPos.t) / 1000);
    const tx = this.netPos.x + this.netPos.vx * age;
    const ty = this.netPos.y + this.netPos.vy * age;
    const tz = this.netPos.z + this.netPos.vz * age;
    const k = 1 - Math.exp(-12 * dt);
    this.position.x += (tx - this.position.x) * k;
    this.position.y += (ty - this.position.y) * k;
    this.position.z += (tz - this.position.z) * k;
    this.vel.set(this.netPos.vx, this.netPos.vy, this.netPos.vz);
    this._animate(dt);
  }
  dispose() {
    this.scene.remove(this.group);
  }
}

/** Étiquette flottante (J1 / J2) au-dessus du joueur distant */
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(15,20,35,0.8)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(14, 6, 100, 44, 12); ctx.fill(); }
  else ctx.fillRect(14, 6, 100, 44);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 29);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.5, 0.75, 1);
  sp.position.y = 1.5;
  return sp;
}
