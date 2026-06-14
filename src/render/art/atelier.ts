import * as THREE from 'three';
import type { BuildingKind, TeamId, UnitKind } from '../../sim/types';
import { UNIT_STATS } from '../../sim/stats';
import { C, pm } from './palette';
import { cbox, put } from './kit';
import { studio } from './stage';
import type { BuildingPose, UnitPose } from './rig';
import { BUILDING_KINDS, UNIT_KINDS, buildBuildingRig, buildUnitRig } from './catalog';

/**
 * The atelier: dev-only asset review stage (?atelier=<kind>|all[&spin][&hp=0.5]).
 * Assets are judged at the exact game camera angle under the final studio
 * light, driven through a scripted pose loop: idle → march → halt-aim → fire.
 * Screenshot via the /__shot middleware (canvas has preserveDrawingBuffer).
 */

interface Subject {
  group: THREE.Group;
  kind: string;
  update: (t: number, dt: number) => void;
}

const FIRE_PERIOD = 0.85;

/** scripted pose timeline for units — exercises every animation driver */
function unitScript(kind: UnitKind, hp: number): { pose: (t: number, dt: number, bodyYaw: number) => UnitPose } {
  const topSpeed = UNIT_STATS[kind].speed;
  let prevSpeed = 0;
  return {
    pose: (t: number, dt: number, bodyYaw: number): UnitPose => {
      const loop = t % 9;
      let speed = 0;
      let aimYaw: number | null = null;
      let sinceShot = Infinity;
      let working = false;
      if (loop < 1.2) {
        // idle — miniature stillness
      } else if (loop < 3.8) {
        const k = Math.min(1, (loop - 1.2) / 0.5, (3.8 - loop) / 0.45);
        speed = topSpeed * Math.max(0, k);
      } else if (loop < 8.2) {
        aimYaw = bodyYaw + 0.5 + Math.sin(t * 0.4) * 0.35;
        if (loop > 4.6) sinceShot = (loop - 4.6) % FIRE_PERIOD;
        working = kind === 'harvester';
      }
      const accel = (speed - prevSpeed) / Math.max(dt, 1e-4);
      prevSpeed = speed;
      return {
        dt,
        time: t,
        speed,
        accel,
        bodyYaw,
        aimYaw,
        sinceShot,
        hpFrac: hp,
        load: kind === 'harvester' ? (Math.floor(t / 9) % 2 === 0 ? 1 : 0.33) : 0,
        working
      };
    }
  };
}

function buildingScript(): { pose: (t: number, dt: number, bodyYaw: number) => BuildingPose } {
  return {
    pose: (t: number, dt: number, bodyYaw: number): BuildingPose => {
      const loop = t % 8;
      const producing = loop < 4.6;
      return {
        dt,
        time: t,
        producing,
        rate: Math.floor(t / 8) % 2 === 0 ? 1 : 2.2,
        aimYaw: loop > 2 ? bodyYaw - 0.4 + Math.sin(t * 0.5) * 0.5 : null,
        sinceShot: loop > 3 ? loop % 1.5 : Infinity,
        bodyYaw
      };
    }
  };
}

export function runAtelier(spec: string): void {
  const stage = document.getElementById('stage')!;
  const params = new URLSearchParams(location.search);
  const spin = params.has('spin');
  const hp = Math.min(1, Math.max(0.05, parseFloat(params.get('hp') ?? '1')));

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();

  // ── subjects ──
  const subjects: Subject[] = [];
  const wanted = spec === 'all' || spec === ''
    ? [...UNIT_KINDS, ...BUILDING_KINDS]
    : [spec as UnitKind | BuildingKind];

  const isUnit = (k: string): k is UnitKind => (UNIT_KINDS as string[]).includes(k);
  const isBuilding = (k: string): k is BuildingKind => (BUILDING_KINDS as string[]).includes(k);

  const cols = wanted.length;
  const spacingX = 1.55;
  const x0 = -((cols - 1) * spacingX) / 2;
  // ¾ front-left view: units face the camera side instead of marching away
  const FACE_CAMERA = -2.1;
  wanted.forEach((k, i) => {
    for (const team of [0, 1] as TeamId[]) {
      const group = new THREE.Group();
      const z = team === 0 ? 0.62 : -0.62;
      group.position.set(x0 + i * spacingX, 0, z);
      group.rotation.y = FACE_CAMERA;
      scene.add(group);
      if (isUnit(k)) {
        const rig = buildUnitRig(k, team);
        group.add(rig.root);
        const script = unitScript(k, hp);
        subjects.push({
          group,
          kind: k,
          update: (t, dt) => rig.update(script.pose(t, dt, group.rotation.y))
        });
      } else if (isBuilding(k)) {
        const rig = buildBuildingRig(k, team);
        group.add(rig.root);
        const script = buildingScript();
        subjects.push({
          group,
          kind: k,
          update: (t, dt) => rig.update(script.pose(t, dt, group.rotation.y))
        });
      }
    }
  });

  // ── workbench ──
  const spanX = Math.max(3.2, cols * spacingX + 1.0);
  const bench = put(scene, cbox(spanX, 0.12, 3.0, 0.04), pm(C.sand.base, 'matte'), 0, -0.06, 0, { noCast: true });
  bench.receiveShadow = true;
  // one etched tile outline per subject column — scale reference
  for (let i = 0; i < cols; i++) {
    for (const z of [0.62, -0.62]) {
      const tile = put(scene, cbox(0.98, 0.012, 0.98, 0.005), pm(C.sand.shade, 'matte'), x0 + i * spacingX, 0.002, z, { noCast: true });
      tile.receiveShadow = true;
    }
  }

  studio(renderer, scene, new THREE.Vector3(0, 0, 0), Math.max(4, spanX * 0.7));

  // ── camera: the game's exact angle ──
  const pitch = THREE.MathUtils.degToRad(50);
  const dir = new THREE.Vector3(-Math.cos(pitch) * Math.SQRT1_2, Math.sin(pitch), Math.cos(pitch) * Math.SQRT1_2);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.copy(dir.multiplyScalar(20));
  camera.lookAt(0, 0.12, 0);

  const resize = (): void => {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / Math.max(1, h);
    // single asset: tight close-up; gallery: fit the whole bench diagonal
    const viewH = cols === 1 ? 2.0 : Math.max(2.4, (spanX * 0.92) / aspect + 1.2);
    camera.top = viewH / 2 + 0.3;
    camera.bottom = -viewH / 2 + 0.3;
    camera.right = (viewH * aspect) / 2;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // ── caption ──
  const cap = document.createElement('div');
  cap.style.cssText =
    'position:fixed;left:12px;bottom:10px;color:#cdbf9d;font:12px/1.4 monospace;z-index:50;pointer-events:none;text-shadow:0 1px 2px #000';
  document.body.appendChild(cap);

  // ── loop (with background-tab watchdog, same trick as the game) ──
  let last = performance.now();
  let elapsed = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    if (spin) for (const s of subjects) s.group.rotation.y = elapsed * 0.45;
    for (const s of subjects) s.update(elapsed, dt);
    const loop = elapsed % 9;
    cap.textContent = `atelier · ${spec || 'all'} · t=${loop.toFixed(1)} ${loop < 1.2 ? 'idle' : loop < 3.8 ? 'march' : loop < 4.6 ? 'halt+aim' : loop < 8.2 ? 'FIRE' : 'idle'}`;
    renderer.render(scene, camera);
  };
  const tick = (now: number): void => {
    frame(now);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.setInterval(() => {
    if (performance.now() - last > 200) frame(performance.now());
  }, 100);

  (window as unknown as { __atelier?: object }).__atelier = {
    scene,
    renderer,
    camera,
    shot: () =>
      fetch('/__shot', { method: 'POST', body: renderer.domElement.toDataURL('image/jpeg', 0.92) }).then(() => 'ok')
  };
}
