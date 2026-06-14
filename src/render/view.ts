import * as THREE from 'three';
import type { Sim } from '../sim/sim';
import type { SimEvent, Unit, Building, Vec2 } from '../sim/types';
import type { CardDef } from '../sim/cards';
import { TilePos } from '../sim/map';
import { AIRSTRIKE, NUKE, STORE_CAP_GOLD, STORE_CAP_OIL, TICK_DT } from '../sim/stats';
import { SceneCtx } from './scene';
import { FxSystem, disposeObject } from './fx';
import {
  BuildingRigHandle, TEAM_COLORS, TILE_TOP, TerrainHandle, UnitRigHandle,
  buildBuildingMesh, buildBuildingRig, buildTerrain, buildUnitMesh, buildUnitRig
} from './meshes';
import type { BuildingPose, UnitPose } from './art/rig';

interface Bar {
  sprite: THREE.Sprite;
  set: (frac: number) => void;
  dispose: () => void;
}

interface UnitVis {
  rig: UnitRigHandle;
  bar: Bar;
  unit: Unit;
  lastShotAt: number;
  prevSpeed: number;
}

interface BuildingVis {
  rig: BuildingRigHandle;
  bar: Bar;
  building: Building;
  lastShotAt: number;
  /** brass halo shown while a supply-truck boost is running */
  boostRing: THREE.Mesh | null;
}

const WEAPON_TRACER: Record<string, number> = {
  smallarms: 0xffe9a0,
  mg: 0xffd27a,
  at: 0xff9a5e,
  cannon: 0xfff0c8,
  hqgun: 0xffb24d
};

export class GameView {
  readonly fx: FxSystem;
  private units = new Map<number, UnitVis>();
  private buildings = new Map<number, BuildingVis>();
  private shells = new Map<number, { mesh: THREE.Mesh; start: THREE.Vector3; total: number; puffAt: number }>();
  private terrain: TerrainHandle;
  private placementGroup = new THREE.Group();
  private hoverMarker: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
  private clockTime = 0;
  // drag-to-place hologram
  private ghost: THREE.Group | null = null;
  private ghostMeshes: THREE.Mesh[] = [];
  private ghostMatOk = new THREE.MeshBasicMaterial({ color: 0x8effa8, transparent: true, opacity: 0.55, depthWrite: false });
  private ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xff6a52, transparent: true, opacity: 0.5, depthWrite: false });

  constructor(private ctx: SceneCtx, private sim: Sim) {
    this.fx = new FxSystem(ctx.scene, ctx.camera);
    this.terrain = buildTerrain(sim.map);
    ctx.scene.add(this.terrain.group);
    ctx.scene.add(this.placementGroup);

    this.hoverMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ color: 0x7fff9a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
    );
    this.hoverMarker.rotation.x = -Math.PI / 2;
    this.hoverMarker.visible = false;
    ctx.scene.add(this.hoverMarker);
  }

  /**
   * Health bar as a single canvas-textured sprite: border, empty track, and
   * team-colored fill drawn in one quad so nothing can misalign on screen.
   */
  private makeBar(width: number, team: number): Bar {
    const W = 48, H = 10;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(width, (width * H) / W, 1);
    const color = `#${TEAM_COLORS[team].toString(16).padStart(6, '0')}`;
    let last = -1;
    const set = (frac: number) => {
      const f = Math.max(0, Math.min(1, frac));
      if (Math.abs(f - last) < 0.01) return;
      last = f;
      ctx.fillStyle = '#0b0b06'; // border
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#26261c'; // empty track
      ctx.fillRect(1, 1, W - 2, H - 2);
      ctx.fillStyle = color;
      ctx.fillRect(1, 1, Math.round((W - 2) * f), H - 2);
      tex.needsUpdate = true;
    };
    set(1);
    return {
      sprite,
      set,
      dispose: () => {
        tex.dispose();
        mat.dispose();
      }
    };
  }

  private addUnit(unit: Unit): void {
    if (this.units.has(unit.id)) return;
    const rig = buildUnitRig(unit.kind, unit.team);
    rig.root.position.set(unit.pos.x, TILE_TOP, unit.pos.y);
    rig.root.rotation.y = -unit.facing;
    this.ctx.scene.add(rig.root);
    const bar = this.makeBar(0.55, unit.team);
    this.ctx.scene.add(bar.sprite);
    this.units.set(unit.id, { rig, bar, unit, lastShotAt: -99, prevSpeed: 0 });
  }

  private addBuilding(b: Building): void {
    if (this.buildings.has(b.id)) return;
    const rig = buildBuildingRig(b.kind, b.team);
    rig.root.position.set(b.tile.c, TILE_TOP, b.tile.r);
    // axis-aligned so footprints sit square on the tile diamonds (a 45° yaw
    // renders screen-square and reads misaligned); teams face opposite ways
    rig.root.rotation.y = b.team === 0 ? 0 : Math.PI;
    this.ctx.scene.add(rig.root);
    const bar = this.makeBar(b.kind === 'hq' ? 0.85 : 0.65, b.team);
    bar.sprite.visible = false;
    this.ctx.scene.add(bar.sprite);
    this.buildings.set(b.id, { rig, bar, building: b, lastShotAt: -99, boostRing: null });
  }

  private removeBoostRing(vis: BuildingVis): void {
    if (!vis.boostRing) return;
    this.ctx.scene.remove(vis.boostRing);
    vis.boostRing.geometry.dispose();
    (vis.boostRing.material as THREE.Material).dispose();
    vis.boostRing = null;
  }

  /** Rebuild entity visuals straight from sim state (used after debug fast-forward). */
  resyncAll(): void {
    const liveUnits = new Set(this.sim.units.map((u) => u.id));
    const liveBuildings = new Set(this.sim.buildings.map((b) => b.id));
    for (const [id, vis] of this.units) {
      if (!liveUnits.has(id)) {
        this.ctx.scene.remove(vis.rig.root, vis.bar.sprite);
        disposeObject(vis.rig.root);
        vis.bar.dispose();
        this.units.delete(id);
      }
    }
    for (const [id, vis] of this.buildings) {
      if (!liveBuildings.has(id)) {
        this.ctx.scene.remove(vis.rig.root, vis.bar.sprite);
        disposeObject(vis.rig.root);
        vis.bar.dispose();
        this.removeBoostRing(vis);
        this.buildings.delete(id);
      }
    }
    for (const u of this.sim.units) this.addUnit(u);
    for (const b of this.sim.buildings) this.addBuilding(b);
  }

  handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case 'unitSpawned': {
          const unit = this.sim.units.find((u) => u.id === e.id);
          if (unit) this.addUnit(unit);
          break;
        }
        case 'unitDied': {
          const vis = this.units.get(e.id);
          const at = new THREE.Vector3(e.pos.x, TILE_TOP + 0.1, e.pos.y);
          this.fx.explosion(at, e.kind === 'tank' || e.kind === 'howitzer' ? 1.2 : 0.7);
          if (vis) {
            this.ctx.scene.remove(vis.rig.root, vis.bar.sprite);
            disposeObject(vis.rig.root);
            vis.bar.dispose();
            this.units.delete(e.id);
          }
          break;
        }
        case 'buildingPlaced': {
          const b = this.sim.buildings.find((x) => x.id === e.id);
          if (!b) break;
          this.addBuilding(b);
          if (b.kind !== 'hq') this.fx.placeDust(new THREE.Vector3(b.tile.c, TILE_TOP, b.tile.r));
          break;
        }
        case 'buildingDestroyed': {
          const vis = this.buildings.get(e.id);
          this.fx.explosion(new THREE.Vector3(e.tile.c, TILE_TOP + 0.2, e.tile.r), e.kind === 'hq' ? 2.4 : 1.4);
          if (vis) {
            this.ctx.scene.remove(vis.rig.root, vis.bar.sprite);
            disposeObject(vis.rig.root);
            vis.bar.dispose();
            this.removeBoostRing(vis);
            this.buildings.delete(e.id);
          }
          break;
        }
        case 'buildingBoosted': {
          const b = this.sim.buildings.find((x) => x.id === e.id);
          if (b) this.fx.boostBurst(new THREE.Vector3(b.tile.c, TILE_TOP, b.tile.r));
          break;
        }
        case 'shot': {
          const from = new THREE.Vector3(e.from.x, TILE_TOP + 0.22, e.from.y);
          const to = new THREE.Vector3(e.to.x, TILE_TOP + 0.18, e.to.y);
          this.fx.muzzle(from);
          if (e.weapon !== 'artillery') {
            this.fx.tracer(from, to, WEAPON_TRACER[e.weapon] ?? 0xffe9a0);
          }
          // recoil envelopes key off this timestamp (rigs read sinceShot)
          const uvis = this.units.get(e.sourceId);
          if (uvis) uvis.lastShotAt = this.clockTime;
          else {
            const bvis = this.buildings.get(e.sourceId);
            if (bvis) bvis.lastShotAt = this.clockTime;
          }
          break;
        }
        case 'impact':
          this.fx.impact(new THREE.Vector3(e.pos.x, TILE_TOP + 0.2, e.pos.y));
          break;
        case 'shellLanded':
          this.fx.explosion(new THREE.Vector3(e.pos.x, TILE_TOP + 0.05, e.pos.y), 1.5);
          break;
        case 'strikeCalled':
          this.fx.strikeMarker(
            new THREE.Vector3(e.pos.x, 0, e.pos.y),
            e.nuke ? NUKE.delay : AIRSTRIKE.delay,
            e.nuke ? NUKE.radius : AIRSTRIKE.radius
          );
          break;
        case 'strikeHit': {
          const at = new THREE.Vector3(e.pos.x, TILE_TOP + 0.1, e.pos.y);
          if (e.nuke) {
            // the sun comes down: one core flash, a ring of secondaries
            this.fx.explosion(at, 4.2);
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              this.fx.explosion(at.clone().add(new THREE.Vector3(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1)), 1.6);
            }
          } else {
            this.fx.explosion(at, 2.2);
            this.fx.explosion(at.clone().add(new THREE.Vector3(0.5, 0, 0.3)), 1.2);
            this.fx.explosion(at.clone().add(new THREE.Vector3(-0.4, 0, -0.4)), 1.2);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  update(alpha: number, dt: number): void {
    this.clockTime += dt;

    // entity position index for target-tracking turrets/bodies
    const posIndex = new Map<number, Vec2>();
    for (const u of this.sim.units) posIndex.set(u.id, u.pos);
    for (const b of this.sim.buildings) posIndex.set(b.id, { x: b.tile.c, y: b.tile.r });

    for (const [, vis] of this.units) {
      const u = vis.unit;
      const x = u.prevPos.x + (u.pos.x - u.prevPos.x) * alpha;
      const y = u.prevPos.y + (u.pos.y - u.prevPos.y) * alpha;
      vis.rig.root.position.set(x, TILE_TOP, y);
      const targetYaw = -u.facing;
      let d = targetYaw - vis.rig.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      vis.rig.root.rotation.y += d * Math.min(1, dt * 10);

      vis.bar.sprite.position.set(x, TILE_TOP + 0.84, y);
      const frac = Math.max(0, u.hp / u.maxHp);
      // always visible: the bar's team color is how you tell friend from foe
      vis.bar.set(frac);

      // pose the rig from sim truth — every motion is information
      const speed = Math.hypot(u.pos.x - u.prevPos.x, u.pos.y - u.prevPos.y) / TICK_DT;
      let aimYaw: number | null = null;
      if (u.targetId) {
        const tp = posIndex.get(u.targetId);
        if (tp) aimYaw = -Math.atan2(tp.y - y, tp.x - x);
      }
      const harvest =
        u.kind === 'harvester'
          ? u.harvestState === 'loading' ? 'loading' : u.harvestState === 'unloading' ? 'unloading' : null
          : null;
      const pose: UnitPose = {
        dt,
        time: this.clockTime,
        speed,
        accel: (speed - vis.prevSpeed) / Math.max(dt, 1e-4),
        bodyYaw: vis.rig.root.rotation.y,
        aimYaw,
        sinceShot: this.clockTime - vis.lastShotAt,
        hpFrac: frac,
        load: u.harvestState === 'toHq' || u.harvestState === 'unloading' ? 1 : 0,
        working: harvest !== null,
        harvest
      };
      vis.prevSpeed = speed;
      vis.rig.update(pose);
    }

    for (const [, vis] of this.buildings) {
      const b = vis.building;
      vis.bar.sprite.position.set(b.tile.c, TILE_TOP + (b.kind === 'hq' ? 1.0 : 0.78), b.tile.r);
      const frac = Math.max(0, b.hp / b.maxHp);
      vis.bar.sprite.visible = frac < 0.999;
      vis.bar.set(frac);

      // producing = the motion gate: a full silo, idle line, or DARK building stands still
      let producing = b.prodUnit !== null;
      if (b.kind === 'extractor' || b.kind === 'derrick') {
        const cap = b.kind === 'extractor' ? STORE_CAP_GOLD : STORE_CAP_OIL;
        const siloFull = this.sim.rules.manualCollect && b.team === 0 && b.stored >= cap - 0.01;
        producing = !siloFull;
      }
      if (b.kind === 'powerplant') producing = true; // the grid hums as long as it stands
      if (!b.powered) producing = false;
      let aimYaw: number | null = null;
      if (b.targetId) {
        const tp = posIndex.get(b.targetId);
        if (tp) aimYaw = -Math.atan2(tp.y - b.tile.r, tp.x - b.tile.c);
      }
      const pose: BuildingPose = {
        dt,
        time: this.clockTime,
        producing,
        rate: b.boostTimer > 0 ? 2.2 : 1, // service boost = the works visibly hurry
        aimYaw,
        sinceShot: this.clockTime - vis.lastShotAt,
        bodyYaw: vis.rig.root.rotation.y
      };
      vis.rig.update(pose);

      // brass halo while the truck's boost runs — the visible "serviced" state
      if (b.boostTimer > 0 && b.powered) {
        if (!vis.boostRing) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.48, 0.6, 24),
            new THREE.MeshBasicMaterial({ color: 0xd8a93c, transparent: true, side: THREE.DoubleSide, depthWrite: false })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(b.tile.c, TILE_TOP + 0.045, b.tile.r);
          this.ctx.scene.add(ring);
          vis.boostRing = ring;
        }
        const pulse = Math.sin(this.clockTime * 5);
        (vis.boostRing.material as THREE.MeshBasicMaterial).opacity = 0.42 + 0.2 * pulse;
        vis.boostRing.scale.setScalar(1 + 0.05 * pulse);
      } else {
        this.removeBoostRing(vis);
      }
    }

    this.terrain.update(dt);

    // howitzer shells with a visual arc + smoke trail
    const seen = new Set<number>();
    for (const s of this.sim.shells) {
      seen.add(s.id);
      let vis = this.shells.get(s.id);
      if (!vis) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0x26241f }));
        const start = new THREE.Vector3(s.pos.x, 0, s.pos.y);
        vis = { mesh, start, total: Math.hypot(s.target.x - s.pos.x, s.target.y - s.pos.y), puffAt: 0 };
        this.shells.set(s.id, vis);
        this.ctx.scene.add(mesh);
      }
      const traveled = Math.hypot(s.pos.x - vis.start.x, s.pos.y - vis.start.z);
      const p = vis.total > 0.01 ? Math.min(1, traveled / vis.total) : 1;
      const h = Math.sin(p * Math.PI) * 1.0;
      vis.mesh.position.set(s.pos.x, TILE_TOP + 0.2 + h, s.pos.y);
      vis.puffAt -= dt;
      if (vis.puffAt <= 0) {
        this.fx.shellPuff(vis.mesh.position);
        vis.puffAt = 0.07;
      }
    }
    for (const [id, vis] of this.shells) {
      if (!seen.has(id)) {
        this.ctx.scene.remove(vis.mesh);
        vis.mesh.geometry.dispose();
        this.shells.delete(id);
      }
    }

    this.fx.update(dt);
  }

  setPlacementTiles(tiles: TilePos[] | null): void {
    this.placementGroup.clear();
    if (!tiles) return;
    const geo = new THREE.PlaneGeometry(0.88, 0.88);
    const matl = new THREE.MeshBasicMaterial({ color: 0x5fd882, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    for (const t of tiles) {
      const m = new THREE.Mesh(geo, matl);
      m.rotation.x = -Math.PI / 2;
      m.position.set(t.c, TILE_TOP + 0.015, t.r);
      this.placementGroup.add(m);
    }
  }

  setHover(tile: TilePos | null, valid: boolean): void {
    if (!tile) {
      this.hoverMarker.visible = false;
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.set(tile.c, TILE_TOP + 0.03, tile.r);
    (this.hoverMarker.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x7fff9a : 0xff5e4a);
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(tile.c, TILE_TOP + 0.02, tile.r);
      const mat = valid ? this.ghostMatOk : this.ghostMatBad;
      for (const m of this.ghostMeshes) m.material = mat;
    }
  }

  /** Hologram of the unit/building under the cursor while a card is armed/dragged. */
  setGhost(card: CardDef | null): void {
    if (this.ghost) {
      this.ctx.scene.remove(this.ghost);
      disposeObject(this.ghost); // shared kit geometry survives; one-offs (ring) go
      this.ghost = null;
      this.ghostMeshes = [];
    }
    if (!card) return;
    let obj: THREE.Group | null = null;
    if (card.kind === 'unit') obj = buildUnitMesh(card.unit!, 0);
    else if (card.kind === 'building') obj = buildBuildingMesh(card.building!, 0);
    else if (card.kind === 'tactic') {
      obj = new THREE.Group();
      const radius = card.nuke ? NUKE.radius : AIRSTRIKE.radius;
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 28), this.ghostMatBad);
      ring.rotation.x = -Math.PI / 2;
      obj.add(ring);
    }
    if (!obj) return;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.ghostMatOk;
        m.castShadow = false;
        m.receiveShadow = false;
        this.ghostMeshes.push(m);
      }
    });
    obj.visible = false;
    this.ghost = obj;
    this.ctx.scene.add(obj);
  }

  /** tile center → client pixel coords (debug/testing aid, inverse of pickTile) */
  projectTile(tile: TilePos): { x: number; y: number } {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(tile.c, TILE_TOP, tile.r).project(this.ctx.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height
    };
  }

  pickTile(clientX: number, clientY: number): TilePos | null {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const c = Math.round(hit.x);
    const r = Math.round(hit.z);
    if (!this.sim.map.inBounds(c, r)) return null;
    return { c, r };
  }

  render(): void {
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  }

  dispose(): void {
    this.fx.dispose();
    this.ctx.scene.clear();
    this.ctx.renderer.dispose();
  }
}
