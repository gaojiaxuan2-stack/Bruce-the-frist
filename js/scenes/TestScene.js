// Minimal hidden scene for automated tests (?scene=test): a grid of dots plus
// a marker that follows the input pointer, so input can be checked without
// depending on any real scene.
import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';

export default class TestScene extends BaseScene {
  static meta = { id: 'test', title: 'Test', subtitle: 'Input test bench', icon: '·', hints: [], bloom: { strength: 0 } };

  async init() {
    const pts = [];
    for (let x = -10; x <= 10; x++) for (let y = -6; y <= 6; y++) pts.push(x * 0.5, y * 0.5, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, color: 0x666666 })));
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 32), new THREE.MeshBasicMaterial({ color: 0x7cf6c8 }));
    this.scene.add(this.marker);
  }

  update(dt, time, input) {
    this.ndcToWorld(input.pointer, 0, this.marker.position);
    this.marker.visible = input.active;
    this.marker.scale.setScalar(input.pinching ? 0.6 : input.fist ? 1.6 : 1);
    this.marker.material.color.set(input.fist ? 0xff7b7b : input.pinching ? 0x8aa8ff : 0x7cf6c8);
  }
}
