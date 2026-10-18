// Keeps the black hole's shadow pure black under the bloom, without touching
// anything that really sits in front of it.
//
//   RenderPass -> ShadowCopyPass -> UnrealBloomPass -> ShadowMaskPass -> OutputPass
//
// ShadowCopyPass (before bloom) copies the small square of the frame around the
// shadow, as rendered, into its own target. ShadowMaskPass (after bloom) draws a
// camera-facing disc at the hole that blends that un-bloomed copy back over the
// shadow: inside it only the glow is removed, while the near side of the disk,
// streams, dust and jets that pass in front keep exactly their own light. Over
// the bright inner band of the near disk most of the glow is kept, so the band
// looks the same inside and outside the shadow. No negative light, no feedback
// from one frame to the next.
//
// The shadow is always at the centre of the screen (the camera looks at the hole),
// so the copied square is centred too.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { billboardVertex, copyFragment, shadowMaskFragment } from './shaders.js';

const MAX_SIZE = 2048;

class ShadowCopyPass extends Pass {
  constructor(owner) {
    super();
    this.owner = owner;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.owner.copy(renderer, readBuffer);
  }
}

class ShadowMaskPass extends Pass {
  constructor(owner) {
    super();
    this.owner = owner;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.owner.mask(renderer, this.renderToScreen ? null : readBuffer);
  }
}

export class ShadowPasses {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} sceneUniforms the scene's shared uniforms (uRing, uRin)
   */
  constructor(camera, sceneUniforms) {
    this.camera = camera;
    this.size = 256;
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    /** radius of the shadow on screen, as a fraction of half the screen height */
    this.radiusNdc = 0.2;

    this.box = {
      uBoxMin: { value: new THREE.Vector2() },
      uBoxSize: { value: new THREE.Vector2(1, 1) },
    };

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...this.box,
        tDiffuse: { value: null },
        uSrcSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: copyFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.copyMaterial);

    this.maskMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...this.box,
        uRing: sceneUniforms.uRing,
        uRin: sceneUniforms.uRin,
        uPre: { value: this.target.texture },
        uPreSize: { value: this.size },
      },
      vertexShader: billboardVertex,
      fragmentShader: shadowMaskFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // result = copy * w + bloomed * (1 - w); alpha untouched
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    // Big enough for the grown shadow (ring radius 1.5 x mass <= 1.25).
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), this.maskMaterial);
    this.disc.frustumCulled = false;
    this.maskScene = new THREE.Scene();
    this.maskScene.add(this.disc);

    this.copyPass = new ShadowCopyPass(this);
    this.maskPass = new ShadowMaskPass(this);
  }

  set enabled(on) {
    this.copyPass.enabled = on;
    this.maskPass.enabled = on;
  }

  copy(renderer, readBuffer) {
    const W = readBuffer.width;
    const H = readBuffer.height;
    // +3 px so the soft edge of the mask never reads outside the copy
    let side = Math.ceil(2 * (this.radiusNdc * H * 0.5 + 3));
    side = Math.min(side, W, H, MAX_SIZE);
    if (side > this.size) {
      // grow only (in steps), so zooming does not reallocate every frame
      this.size = Math.min(MAX_SIZE, Math.ceil(side / 128) * 128);
      this.target.setSize(this.size, this.size);
      this.maskMaterial.uniforms.uPreSize.value = this.size;
    }
    const x0 = Math.floor(W * 0.5 - side * 0.5);
    const y0 = Math.floor(H * 0.5 - side * 0.5);
    this.box.uBoxMin.value.set(x0, y0);
    this.box.uBoxSize.value.set(side, side);
    this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.copyMaterial.uniforms.uSrcSize.value.set(W, H);
    // copy 1:1 into the bottom-left corner of the target
    this.target.viewport.set(0, 0, side, side);
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  mask(renderer, target) {
    this.disc.position.set(0, 0, 0);
    this.disc.quaternion.copy(this.camera.quaternion);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.maskScene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** The mask must run right after the bloom pass (the App only offers passes before it). */
  attach(composer, bloomPass) {
    if (!composer || composer.passes.includes(this.maskPass)) return;
    const i = composer.passes.indexOf(bloomPass);
    if (i >= 0) composer.insertPass(this.maskPass, i + 1);
  }

  detach(composer) {
    composer?.removePass(this.maskPass);
    composer?.removePass(this.copyPass);
  }

  dispose() {
    this.target.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
    this.maskMaterial.dispose();
    this.disc.geometry.dispose();
  }
}
