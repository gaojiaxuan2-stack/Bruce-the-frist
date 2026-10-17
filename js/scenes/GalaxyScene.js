// Placeholder - replaced by the real scene.
import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';

export default class GalaxyScene extends BaseScene {
  static meta = { id: 'galaxy', title: 'Galaxy', subtitle: 'Coming soon', icon: '*', hints: [], bloom: { strength: 0.6, radius: 0.4, threshold: 0 } };

  async init() {
    const g = new THREE.BufferGeometry();
    const n = 20000;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) p[i] = (Math.random() - 0.5) * 8;
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.03, color: 0xffffff }));
    this.scene.add(this.points);
  }

  update(dt, time, input) {
    this.points.rotation.y += dt * 0.2 + input.dragDelta.x;
  }
}
