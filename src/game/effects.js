import * as THREE from 'three';

// Particules simples avec pool de meshes (performant, low-poly)
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false; scene.add(m);
      this.pool.push(m);
    }
  }
  burst(pos, color = 0xFFD93D, n = 12, speed = 5, life = 0.7, gravity = -9) {
    for (let i = 0; i < n; i++) {
      const m = this.pool.pop(); if (!m) return;
      m.visible = true; m.material.color.setHex(color);
      m.position.copy(pos);
      m.scale.setScalar(0.7 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2, up = Math.random() * speed;
      this.active.push({ m, vx: Math.cos(a) * speed * 0.6, vy: up, vz: Math.sin(a) * speed * 0.6, life: life * (0.6 + Math.random() * 0.6), max: life, gravity });
    }
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 5; p.m.rotation.y += dt * 4;
      if (p.life <= 0) { p.m.visible = false; this.scene.remove(p.m); this.scene.add(p.m); this.pool.push(p.m); this.active.splice(i, 1); }
    }
  }
}
