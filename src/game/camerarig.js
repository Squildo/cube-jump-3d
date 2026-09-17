import * as THREE from 'three';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0; // pas de rotation libre V1 : caméra derrière joueur, suit X/Z
    this.pos = new THREE.Vector3(0, 8, 14);
  }
  update(dt, target) {
    const desired = new THREE.Vector3(target.x, target.y + 4.2, target.z + 8.5);
    this.pos.lerp(desired, 1 - Math.exp(-4 * dt));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(target.x, target.y + 1, target.z - 2);
  }
}
