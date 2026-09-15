import * as THREE from 'three';

// Collisions AABB arcade : joueur (box) vs plateformes (box)
export function resolveCollisions(player, platforms, dt) {
  const p = player;
  p.grounded = false;
  p.groundPlatform = null;

  for (const pl of platforms) {
    const box = pl.userData.box; // {min:Vector3, max:Vector3} à jour
    // AABB joueur
    const px = p.position.x, py = p.position.y, pz = p.position.z;
    const hw = p.halfW, hh = p.halfH;
    const minX = px - hw, maxX = px + hw;
    const minY = py - hh, maxY = py + hh;
    const minZ = pz - hw, maxZ = pz + hw;

    if (maxX > box.min.x && minX < box.max.x &&
        maxY > box.min.y && minY < box.max.y &&
        maxZ > box.min.z && minZ < box.max.z) {
      // profondeurs de pénétration
      const dx1 = box.max.x - minX, dx2 = maxX - box.min.x;
      const dy1 = box.max.y - minY, dy2 = maxY - box.min.y;
      const dz1 = box.max.z - minZ, dz2 = maxZ - box.min.z;
      const mdx = Math.min(dx1, dx2), mdy = Math.min(dy1, dy2), mdz = Math.min(dz1, dz2);
      if (mdy <= mdx && mdy <= mdz) {
        if (dy1 < dy2) {
          // joueur au-dessus → posé
          p.position.y = box.max.y + hh;
          if (p.vel.y <= 0) p.vel.y = 0;
          p.grounded = true; p.groundPlatform = pl;
          if (pl.userData.type === 'bouncy' && p.vel.y <= 0.1) { p.vel.y = 13; p.grounded = false; p.didBounce = true; }
        } else {
          p.position.y = box.min.y - hh; if (p.vel.y > 0) p.vel.y = 0;
        }
      } else if (mdx <= mdz) {
        if (dx1 < dx2) p.position.x = box.max.x + hw; else p.position.x = box.min.x - hw;
        p.vel.x = 0;
      } else {
        if (dz1 < dz2) p.position.z = box.max.z + hw; else p.position.z = box.min.z - hw;
        p.vel.z = 0;
      }
    }
  }
}

export function updateBox(mesh) {
  const s = mesh.userData.size;
  const min = new THREE.Vector3(mesh.position.x - s.x / 2, mesh.position.y - s.y / 2, mesh.position.z - s.z / 2);
  const max = new THREE.Vector3(mesh.position.x + s.x / 2, mesh.position.y + s.y / 2, mesh.position.z + s.z / 2);
  mesh.userData.box = { min, max };
}
