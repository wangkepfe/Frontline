import * as THREE from 'three';
import { MAP_H, MAP_W } from '../sim/map';
import { studio } from './art/stage';
import { biomeById, type BiomeId } from './art/biomes';

/**
 * Fixed isometric-style camera over the whole battlefield. Orthographic, 45° yaw,
 * ~36° pitch (low, classic-iso tilt: tiles read as wide diamonds, the view feels
 * grounded rather than top-down), no scrolling, no zoom — ever.
 * Lighting comes from the shared studio rig (art/stage.ts) so the game and the
 * atelier always agree.
 */

export const CENTER = new THREE.Vector3((MAP_W - 1) / 2, 0, (MAP_H - 1) / 2);

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  resize: () => void;
}

export function createScene(container: HTMLElement, viewTeam: 0 | 1 = 0, biome?: BiomeId): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  studio(renderer, scene, CENTER, 13, biomeById(biome).studio);

  // camera southwest of center, looking northeast: the local commander's HQ reads
  // at the bottom. The joiner (team 1) flips to the northeast corner so the board
  // is oriented from THEIR side — the diamond is symmetric, so the fit is unchanged.
  const flip = viewTeam === 1 ? -1 : 1;
  const pitch = THREE.MathUtils.degToRad(36);
  const dist = 26;
  const dir = new THREE.Vector3(flip * -Math.cos(pitch) * Math.SQRT1_2, Math.sin(pitch), flip * Math.cos(pitch) * Math.SQRT1_2);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.copy(CENTER).addScaledVector(dir, dist);
  camera.lookAt(CENTER);
  camera.updateMatrixWorld();

  // The HUD lives in the four screen CORNERS (the staff posts) — empty by
  // construction, because the projected map is a diamond whose vertices touch
  // the edge midpoints. Only thin bands stay reserved: a top sliver for the
  // warning ticker and a bottom band for hint/toast slips + the player HQ.
  // (must agree with style.css post insets — DESIGN_GUIDEBOOK.md §5.1)
  const TOP_BAND_PX = 30;
  const BOTTOM_BAND_PX = 56;
  const SIDE_BAND_PX = 14;

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);

    // project map corners onto the camera's screen axes to get content extents
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let maxX = 0;
    let maxY = 0;
    const corners = [
      new THREE.Vector3(-0.65, 0, -0.65),
      new THREE.Vector3(MAP_W - 0.35, 0, -0.65),
      new THREE.Vector3(-0.65, 0, MAP_H - 0.35),
      new THREE.Vector3(MAP_W - 0.35, 0, MAP_H - 0.35),
      new THREE.Vector3(CENTER.x, 1.25, CENTER.z) // headroom for crags/masts
    ];
    for (const c of corners) {
      const rel = c.sub(CENTER);
      maxX = Math.max(maxX, Math.abs(rel.dot(right)));
      maxY = Math.max(maxY, Math.abs(rel.dot(up)));
    }

    // fit the content into the viewport minus the HUD bands, at any resolution
    const availW = Math.max(120, w - SIDE_BAND_PX * 2);
    const availH = Math.max(120, h - TOP_BAND_PX - BOTTOM_BAND_PX);
    const k = Math.min(availW / (2 * maxX), availH / (2 * maxY)); // px per world unit
    // when height-bound (every 16:9 window), stretch x up to 12% to spend the
    // leftover width — tiles read wider, the board fills more of the frame
    const kx = Math.min(availW / (2 * maxX), k * 1.12);
    const contentCenterY = TOP_BAND_PX + availH / 2; // px where the map center should sit
    camera.top = contentCenterY / k;
    camera.bottom = camera.top - h / k;
    camera.right = w / (2 * kx);
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, resize };
}
