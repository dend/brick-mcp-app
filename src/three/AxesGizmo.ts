import * as THREE from 'three';

const AXIS_X = '#e74c3c';
const AXIS_Y = '#2ecc71';
const AXIS_Z = '#3498db';
const SIZE = 150;
const MARGIN = 8;

function makeLabel(primary: string, secondary: string | null, color: string): THREE.Sprite {
  const compass = secondary !== null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  if (compass) { ctx.fillStyle = color; ctx.fill(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.stroke(); }
  ctx.fillStyle = compass ? '#fff' : color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText(primary, 64, compass ? 48 : 64);
  if (secondary) { ctx.font = '30px sans-serif'; ctx.fillText(secondary, 64, 92); }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
  sprite.scale.set(0.55, 0.55, 1);
  return sprite;
}

function makeArm(axis: 'x' | 'y' | 'z', color: string): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
  if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  geo.translate(axis === 'x' ? 0.4 : 0, axis === 'y' ? 0.4 : 0, axis === 'z' ? 0.4 : 0);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
}

function makeGlobeGrid(): THREE.LineSegments {
  const pts: number[] = [];
  const N = 48;
  const ring = (fn: (t: number) => [number, number, number]) => {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2;
      pts.push(...fn(a), ...fn(b));
    }
  };
  for (const y of [-0.5, 0, 0.5]) {
    const r = Math.sqrt(1 - y * y);
    ring(t => [r * Math.cos(t), y, r * Math.sin(t)]);
  }
  for (let k = 0; k < 4; k++) {
    const p = (k * Math.PI) / 4;
    ring(t => [Math.cos(t) * Math.cos(p), Math.sin(t), Math.cos(t) * Math.sin(p)]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.25, depthWrite: false }));
}

export class AxesGizmo {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10);
  private tmpPos = new THREE.Vector3();

  constructor() {
    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.25, side: THREE.BackSide, depthWrite: false }),
    );
    backdrop.renderOrder = -1;
    const grid = makeGlobeGrid();
    grid.renderOrder = -1;
    this.scene.add(backdrop, grid);
    this.scene.add(makeArm('x', AXIS_X), makeArm('y', AXIS_Y), makeArm('z', AXIS_Z));
    const labels: [string, string | null, string, [number, number, number]][] = [
      ['W', '+X', AXIS_X, [ 1, 0, 0]],
      ['E', '-X', AXIS_X, [-1, 0, 0]],
      ['Y', null, AXIS_Y, [0,  1, 0]],
      ['N', '+Z', AXIS_Z, [0, 0,  1]],
      ['S', '-Z', AXIS_Z, [0, 0, -1]],
    ];
    for (const [p, s, c, [x, y, z]] of labels) {
      const sprite = makeLabel(p, s, c);
      sprite.position.set(x, y, z);
      this.scene.add(sprite);
    }
  }

  render(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera, w: number, _h: number) {
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.tmpPos.set(0, 0, 2).applyQuaternion(mainCamera.quaternion);
    this.camera.position.copy(this.tmpPos);
    renderer.clearDepth();
    renderer.setViewport(w - SIZE - MARGIN, MARGIN, SIZE, SIZE);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse(obj => {
      if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose(); }
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) { obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); }
    });
  }
}
