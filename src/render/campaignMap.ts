import * as THREE from 'three';
import type { NodeType } from '../campaign/run';
import { studio } from './art/stage';
import { biomeById, type BiomeId } from './art/biomes';
import { BoardHandle, PropHandle, buildNodeProp, buildRoad, buildTheaterBoard } from './art/campaign';

/**
 * The 3D campaign map. A standalone Three.js diorama rendered INTO #cmap (its
 * own renderer/canvas/loop), surveyed by a fixed ortho camera. Nodes are real
 * miniatures on a biome board joined by dirt roads; transparent DOM hotspots
 * float over each prop (projected every frame) and carry the click target +
 * state ring + label, so the existing onNode flow is unchanged.
 *
 * Disposal is exhaustive (forceContextLoss + canvas removal) because the scene
 * is allocated/freed on every campaign entry/exit — a leaked WebGL context is
 * the top runtime risk.
 */

const TOP = 0.1;
const COL_GAP = 2.75;
const ROW_GAP = 2.35;

export interface MapNodeView {
  id: number;
  col: number;
  row: number;
  type: NodeType;
  next: number[];
}

export interface CampaignMapModel {
  biome: BiomeId;
  nodes: MapNodeView[];
  /** current node id; -1 = staged before column 0 */
  at: number;
  selectable: number[];
  /** run seed — mixes into prop variants so each run looks fresh */
  seed: number;
}

export interface MapUi {
  onNode: (id: number) => void;
  /** inner HTML for a node hotspot (icon + label), provided by the UI layer */
  hotspot: (type: NodeType, state: 'here' | 'open' | 'locked') => string;
}

interface NodeVis {
  id: number;
  type: NodeType;
  pos: THREE.Vector3; // label anchor (above the prop)
  handle: PropHandle;
  hotspot: HTMLButtonElement;
}

export class CampaignMapScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private content = new THREE.Group();
  private board: BoardHandle | null = null;
  private nodes: NodeVis[] = [];
  private hotLayer: HTMLDivElement;
  private ui: MapUi | null = null;
  private raf = 0;
  private watchdog = 0;
  private last = performance.now();
  private elapsed = 0;
  private ro: ResizeObserver;
  private extent = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  private builtBiome: BiomeId | null = null;
  private disposed = false;

  // ── click/hover via raycast (markers above are visual-only) ──
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  /** invisible hit volumes (one sphere per node), rebuilt each render */
  private hitProxies: THREE.Mesh[] = [];
  /** one shared invisible material for every proxy (disposed in dispose) */
  private hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private nodeMap = new Map<number, NodeVis>();
  private selectableSet = new Set<number>();
  private hovered = -1;
  private onMove = (e: PointerEvent) => this.setHover(this.pick(e));
  private onClick = (e: MouseEvent) => this.handleClick(e);
  private onLeave = () => this.setHover(-1);

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = this.renderer.domElement;
    // the canvas is the click surface now — markers above it are pointer-events:none,
    // so pointer events fall through to here and are resolved by raycasting
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:auto;cursor:default';
    host.appendChild(canvas);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointerleave', this.onLeave);

    this.scene.add(this.content);

    // surveying ortho camera: due-south-ish, tilted down so cols (+X) read
    // left→right and rows (±Z) read near/far. Slight west bias for the 3/4 feel.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    this.hotLayer = document.createElement('div');
    this.hotLayer.className = 'cmap-hotspots';
    host.appendChild(this.hotLayer);

    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(host);

    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    // background-tab watchdog (same trick as Game/atelier — rAF stalls when hidden)
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.last > 200) this.frame(performance.now(), false);
    }, 120);
  }

  /** node id → world position of the prop base */
  private nodePos(n: MapNodeView, rows: number, seed: number): THREE.Vector3 {
    const xJit = (hash2(seed, n.id, 1) - 0.5) * 0.5;
    const zJit = (hash2(seed, n.id, 2) - 0.5) * 0.7;
    const x = n.col * COL_GAP + xJit;
    const z = (n.row - (rows - 1) / 2) * ROW_GAP + zJit;
    return new THREE.Vector3(x, TOP, z);
  }

  /** (re)build the board + props + roads + hotspots for a run state */
  render(model: CampaignMapModel, ui: MapUi): void {
    this.ui = ui;
    const biome = biomeById(model.biome);

    // studio light/felt/env only change when the biome does (acts); rebuilding
    // it every in-act re-render would leak the PMREM env + felt each visit
    if (this.builtBiome !== model.biome) {
      this.setupStudio(biome);
      this.builtBiome = model.biome;
    }
    this.clearContent();

    const rows = Math.max(1, ...model.nodes.map((n) => n.row + 1));
    const posOf = new Map<number, THREE.Vector3>();
    for (const n of model.nodes) posOf.set(n.id, this.nodePos(n, rows, model.seed));

    // board extent from node spread
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of posOf.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.extent = { minX, maxX, minZ, maxZ };

    // ── theater board ──
    const avoid = [...posOf.values()].map((p) => ({ x: p.x, z: p.z, r: 0.7 }));
    this.board = buildTheaterBoard(biome, { minX, maxX, minZ, maxZ, avoid });
    this.content.add(this.board.group);

    // ── roads (edges) ──
    const selectable = new Set(model.selectable);
    for (const n of model.nodes) {
      const a = posOf.get(n.id)!;
      for (const m of n.next) {
        const b = posOf.get(m);
        if (!b) continue;
        const active = n.id === model.at && selectable.has(m);
        this.content.add(buildRoad(a.x, a.z, b.x, b.z, biome, active));
      }
      // the staging edges into column 0 (from off the west edge)
      if (model.at === -1 && n.col === 0) {
        this.content.add(buildRoad(a.x - COL_GAP, a.z, a.x, a.z, biome, true));
      }
    }

    // ── node props + visual markers + hit proxies ──
    this.hotLayer.innerHTML = '';
    this.nodes = [];
    this.hitProxies = [];
    this.nodeMap.clear();
    this.selectableSet = selectable;
    this.setHover(-1);
    for (const n of model.nodes) {
      const base = posOf.get(n.id)!;
      const prop = buildNodeProp(n.type, model.seed * 131 + n.id, biome);
      prop.root.position.copy(base);
      this.content.add(prop.root);

      const state: 'here' | 'open' | 'locked' = n.id === model.at ? 'here' : selectable.has(n.id) ? 'open' : 'locked';
      // marker = visual only (icon + ring + label). Kept as a <button> so keyboard
      // users can still Tab to an open node and Enter to select; pointer-events:none
      // (CSS) means the mouse never touches it — clicks are raycast on the canvas.
      const hot = document.createElement('button');
      hot.className = `cnode ${n.type} ${state}`;
      hot.dataset.node = String(n.id);
      hot.innerHTML = ui.hotspot(n.type, state);
      if (state === 'open') { hot.addEventListener('click', () => ui.onNode(n.id)); hot.tabIndex = 0; }
      else hot.tabIndex = -1;
      this.hotLayer.appendChild(hot);

      // invisible hit volume: a sphere wrapping the prop AND its floating icon, so
      // a click anywhere on the node illustration selects it. Nearest sphere wins.
      const r = n.type === 'boss' ? 1.3 : n.type === 'elite' ? 1.0 : 0.85;
      const proxy = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), this.hitMat);
      proxy.position.set(base.x, base.y + 0.5, base.z);
      proxy.userData.nodeId = n.id;
      this.content.add(proxy);
      this.hitProxies.push(proxy);

      const labelY = n.type === 'boss' ? 1.5 : n.type === 'elite' ? 0.9 : 0.7;
      const vis: NodeVis = { id: n.id, type: n.type, pos: base.clone().setY(TOP + labelY), handle: prop, hotspot: hot };
      this.nodes.push(vis);
      this.nodeMap.set(n.id, vis);
    }

    this.fit();
    this.content.updateMatrixWorld(true); // proxies must be raycastable before the first frame renders
    this.projectHotspots();
  }

  /** (re)build the biome lighting rig, disposing the previous env/felt/lamps */
  private setupStudio(biome: ReturnType<typeof biomeById>): void {
    if (this.scene.environment) {
      this.scene.environment.dispose();
      this.scene.environment = null;
    }
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const c = this.scene.children[i];
      if (c === this.content) continue;
      this.scene.remove(c);
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    }
    studio(this.renderer, this.scene, new THREE.Vector3(0, 0, 0), 18, biome.studio);
  }

  private clearContent(): void {
    disposeGroup(this.content);
    this.board = null;
  }

  // ── ortho fit: frame the board into the host box ──
  private fit(): void {
    const w = this.host.clientWidth || 960;
    const h = this.host.clientHeight || 460;
    this.renderer.setSize(w, h);

    const cx = (this.extent.minX + this.extent.maxX) / 2;
    const cz = (this.extent.minZ + this.extent.maxZ) / 2;
    const center = new THREE.Vector3(cx, 0, cz);
    const pitch = THREE.MathUtils.degToRad(43);
    const az = THREE.MathUtils.degToRad(-16);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), Math.cos(az) * Math.cos(pitch));
    this.camera.position.copy(center).addScaledVector(dir, 60);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld();

    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    let maxRX = 0, maxRY = 0;
    const ex = this.extent;
    const corners = [
      new THREE.Vector3(ex.minX - 1.4, 0, ex.minZ - 1.4), new THREE.Vector3(ex.maxX + 1.4, 0, ex.minZ - 1.4),
      new THREE.Vector3(ex.minX - 1.4, 0, ex.maxZ + 1.4), new THREE.Vector3(ex.maxX + 1.4, 0, ex.maxZ + 1.4),
      new THREE.Vector3(cx, 1.8, cz) // headroom for boss towers/backdrop
    ];
    for (const c of corners) {
      const rel = c.sub(center);
      maxRX = Math.max(maxRX, Math.abs(rel.dot(right)));
      maxRY = Math.max(maxRY, Math.abs(rel.dot(up)));
    }
    const margin = 1.06;
    const aspect = w / Math.max(1, h);
    let halfW = maxRX * margin;
    let halfH = maxRY * margin;
    if (halfW / halfH < aspect) halfW = halfH * aspect;
    else halfH = halfW / aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private projectHotspots(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    for (const n of this.nodes) {
      const v = n.pos.clone().project(this.camera);
      n.hotspot.style.left = `${((v.x + 1) / 2) * w}px`;
      n.hotspot.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }

  /** raycast the pointer against the node hit-spheres; returns node id or -1 */
  private pick(e: { clientX: number; clientY: number }): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return -1;
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitProxies, false);
    return hits.length ? (hits[0].object.userData.nodeId as number) : -1;
  }

  /** push hover state onto the visual marker + set the canvas cursor */
  private setHover(id: number): void {
    if (id === this.hovered) return;
    this.nodeMap.get(this.hovered)?.hotspot.classList.remove('hover');
    this.hovered = id;
    this.nodeMap.get(id)?.hotspot.classList.add('hover');
    this.renderer.domElement.style.cursor = id >= 0 && this.selectableSet.has(id) ? 'pointer' : 'default';
  }

  private handleClick(e: MouseEvent): void {
    const id = this.pick(e);
    if (id >= 0 && this.selectableSet.has(id)) this.ui?.onNode(id);
  }

  private frame(t: number, scheduleNext = true): void {
    if (this.disposed) return;
    const dt = Math.min(scheduleNext ? 0.05 : 0.5, (t - this.last) / 1000);
    this.last = t;
    this.elapsed += dt;
    for (const n of this.nodes) n.handle.update(this.elapsed);
    this.board?.update(dt);
    this.projectHotspots();
    this.renderer.render(this.scene, this.camera);
    if (scheduleNext) this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  /** dump the current frame to /__shot for headless review */
  shot(): Promise<string> {
    return fetch('/__shot', { method: 'POST', body: this.renderer.domElement.toDataURL('image/jpeg', 0.92) }).then(() => 'ok');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    this.ro.disconnect();
    const c = this.renderer.domElement;
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('click', this.onClick);
    c.removeEventListener('pointerleave', this.onLeave);
    disposeGroup(this.content);
    this.hitMat.dispose();
    if (this.scene.environment) this.scene.environment.dispose();
    this.hotLayer.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function hash2(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/** dispose only non-shared geometry/materials (kit geometry is userData.shared) */
function disposeGroup(group: THREE.Group): void {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const obj = group.children[i];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => maybeDisposeMat(x));
        else if (mat) maybeDisposeMat(mat);
      }
    });
    group.remove(obj);
  }
}

function maybeDisposeMat(m: THREE.Material): void {
  // pm()/vertexMat materials are cached and shared across every render — disposing
  // one corrupts the global cache (a later prop reuses a freed GL resource). Only
  // OUR one-off materials (smoke/beam/road-glow), tagged userData.own at creation
  // like fx.ts does, are safe to free.
  if (m.userData.own) m.dispose();
}

// ── standalone review route: ?warmap=<biome> ────────────────────────────────

const DEMO_NODES: MapNodeView[] = [
  { id: 0, col: 0, row: 0, type: 'battle', next: [3, 4] },
  { id: 1, col: 0, row: 1, type: 'battle', next: [4] },
  { id: 2, col: 0, row: 2, type: 'event', next: [4, 5] },
  { id: 3, col: 1, row: 0, type: 'loot', next: [6] },
  { id: 4, col: 1, row: 1, type: 'battle', next: [6, 7] },
  { id: 5, col: 1, row: 2, type: 'shop', next: [7] },
  { id: 6, col: 2, row: 0, type: 'battle', next: [9] },
  { id: 7, col: 2, row: 1, type: 'elite', next: [9, 10] },
  { id: 8, col: 2, row: 2, type: 'forge', next: [10] },
  { id: 9, col: 3, row: 0, type: 'battle', next: [11] },
  { id: 10, col: 3, row: 2, type: 'battle', next: [11] },
  { id: 11, col: 4, row: 1, type: 'boss', next: [] }
];

export function runWarmap(spec: string): void {
  const host = document.getElementById('cmap') ?? (() => {
    const d = document.createElement('div');
    d.id = 'cmap';
    d.style.cssText = 'position:fixed;inset:24px;background:#0c0a07';
    document.body.appendChild(d);
    return d;
  })();
  (host as HTMLElement).style.position = 'relative';
  const biome = (['temperate', 'desert', 'winter'].includes(spec) ? spec : 'temperate') as BiomeId;
  const scene = new CampaignMapScene(host as HTMLElement);
  scene.render(
    { biome, nodes: DEMO_NODES, at: 4, selectable: [6, 7], seed: 7 },
    { onNode: (id) => console.log('node', id), hotspot: (type) => `<span class="cnode-dot"></span><i>${type}</i>` }
  );
  const cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:12px;bottom:10px;color:#cdbf9d;font:12px monospace;z-index:50';
  cap.textContent = `warmap · ${biome}`;
  document.body.appendChild(cap);
  (window as unknown as { __warmap?: object }).__warmap = { scene, shot: () => scene.shot() };
}
