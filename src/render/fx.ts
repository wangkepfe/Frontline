import * as THREE from 'three';

/**
 * Pooled battlefield FX, styled to the war-table bible: quad tracers (ortho
 * sprites aligned in screen space), fire→smoke explosions with tumbling debris
 * and slow-fading scorch rings on the table, work dust, strike markers.
 * Per-instance materials are tracked and disposed; shared kit geometry never is.
 */

function makeRadialTexture(inner: string, outer: string): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** horizontal streak: hot core, soft tapered ends — the tracer round */
function makeStreakTexture(): THREE.Texture {
  const W = 128, H = 16;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(255,200,120,0)');
  grad.addColorStop(0.25, 'rgba(255,220,150,0.55)');
  grad.addColorStop(0.8, 'rgba(255,255,235,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // vertical falloff
  const v = ctx.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(0,0,0,1)');
  v.addColorStop(0.5, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface FxItem {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (item: FxItem, dt: number) => void;
}

const debrisGeo = new THREE.TetrahedronGeometry(0.035, 0);
debrisGeo.userData.shared = true;
const scorchGeo = new THREE.CircleGeometry(0.5, 14);
scorchGeo.userData.shared = true;

export class FxSystem {
  private items: FxItem[] = [];
  private glowTex: THREE.Texture;
  private smokeTex: THREE.Texture;
  private streakTex: THREE.Texture;

  constructor(private scene: THREE.Scene, private camera?: THREE.Camera) {
    this.glowTex = makeRadialTexture('rgba(255,240,200,1)', 'rgba(255,180,60,0)');
    this.smokeTex = makeRadialTexture('rgba(126,120,106,0.9)', 'rgba(96,92,82,0)');
    this.streakTex = makeStreakTexture();
  }

  private add(obj: THREE.Object3D, life: number, update: FxItem['update']): void {
    this.scene.add(obj);
    this.items.push({ obj, t: 0, life, update });
  }

  private sprite(tex: THREE.Texture, color: number, blending: THREE.Blending = THREE.AdditiveBlending): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending, depthWrite: false }));
    s.material.userData.own = true;
    return s;
  }

  /** screen-space angle of the from→to segment (ortho camera, sprite rotation) */
  private screenAngle(from: THREE.Vector3, to: THREE.Vector3): number {
    if (!this.camera) return 0;
    const a = from.clone().project(this.camera);
    const b = to.clone().project(this.camera);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const s = this.sprite(this.streakTex, color);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    s.position.copy(mid);
    const len = Math.min(from.distanceTo(to), 2.4);
    s.scale.set(len, 0.06, 1);
    s.material.rotation = this.screenAngle(from, to);
    this.add(s, 0.11, (item) => {
      s.material.opacity = 1 - (item.t / item.life) * 0.9;
    });
  }

  muzzle(at: THREE.Vector3): void {
    const s = this.sprite(this.glowTex, 0xffd28a);
    s.position.copy(at);
    s.scale.setScalar(0.3);
    this.add(s, 0.07, (item) => {
      s.material.opacity = 1 - item.t / item.life;
      s.scale.setScalar(0.3 - 0.1 * (item.t / item.life));
    });
  }

  impact(at: THREE.Vector3): void {
    const s = this.sprite(this.glowTex, 0xffb066);
    s.position.copy(at);
    s.scale.setScalar(0.17);
    this.add(s, 0.12, (item) => {
      const k = item.t / item.life;
      s.scale.setScalar(0.17 + k * 0.12);
      s.material.opacity = 1 - k;
    });
  }

  explosion(at: THREE.Vector3, scale = 1): void {
    // core flash → fireball cooling to ember red
    const flash = this.sprite(this.glowTex, 0xfff2cc);
    flash.position.copy(at).add(new THREE.Vector3(0, 0.15 * scale, 0));
    const fireFrom = new THREE.Color(0xffc06a);
    const fireTo = new THREE.Color(0xb33d18);
    this.add(flash, 0.32, (item) => {
      const k = item.t / item.life;
      flash.scale.setScalar((0.32 + k * 1.15) * scale);
      flash.material.color.copy(fireFrom).lerp(fireTo, k);
      flash.material.opacity = 1 - k * k;
    });
    // smoke column
    const n = Math.round(4 + scale * 2);
    for (let i = 0; i < n; i++) {
      const smoke = this.sprite(this.smokeTex, 0xffffff, THREE.NormalBlending);
      const ang = (i / n) * Math.PI * 2 + Math.random();
      const vel = new THREE.Vector3(Math.cos(ang) * 0.32, 0.75 + Math.random() * 0.5, Math.sin(ang) * 0.32).multiplyScalar(scale * 0.8);
      smoke.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.1, (Math.random() - 0.5) * 0.2));
      const life = 0.65 + Math.random() * 0.45;
      this.add(smoke, life, (item, dt) => {
        const k = item.t / item.life;
        smoke.position.addScaledVector(vel, dt);
        vel.multiplyScalar(1 - 1.6 * dt);
        smoke.scale.setScalar((0.26 + k * 0.75) * scale);
        smoke.material.opacity = 0.7 * (1 - k);
      });
    }
    // tumbling debris chunks
    const nd = Math.round(3 + scale * 3);
    for (let i = 0; i < nd; i++) {
      const m = new THREE.Mesh(debrisGeo, new THREE.MeshStandardMaterial({ color: 0x2e2b26, roughness: 0.9 }));
      m.material.userData.own = true;
      m.castShadow = true;
      m.scale.setScalar((0.5 + Math.random() * 0.8) * scale);
      m.position.copy(at);
      const ang = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(ang) * (0.8 + Math.random()), 1.6 + Math.random() * 1.2, Math.sin(ang) * (0.8 + Math.random())).multiplyScalar(scale * 0.7);
      const spin = new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9);
      const floorY = at.y;
      this.add(m, 0.55 + Math.random() * 0.3, (item, dt) => {
        vel.y -= 7.5 * dt;
        m.position.addScaledVector(vel, dt);
        if (m.position.y < floorY) {
          m.position.y = floorY;
          vel.y = Math.abs(vel.y) * 0.3;
          vel.x *= 0.6;
          vel.z *= 0.6;
        }
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
        m.rotation.z += spin.z * dt;
      });
    }
    // scorch on the table — battles leave marks
    const scorch = new THREE.Mesh(
      scorchGeo,
      new THREE.MeshBasicMaterial({ color: 0x1c1813, transparent: true, opacity: 0.42, depthWrite: false })
    );
    scorch.material.userData.own = true;
    scorch.rotation.x = -Math.PI / 2;
    scorch.rotation.z = Math.random() * Math.PI;
    scorch.position.set(at.x, 0.115, at.z);
    scorch.scale.setScalar(0.55 * scale);
    this.add(scorch, 7, (item) => {
      const k = item.t / item.life;
      (scorch.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - k * k);
    });
  }

  /** faint dust puff trailing a shell in flight */
  shellPuff(at: THREE.Vector3): void {
    const s = this.sprite(this.smokeTex, 0xd8d2c2, THREE.NormalBlending);
    s.position.copy(at);
    this.add(s, 0.35, (item) => {
      const k = item.t / item.life;
      s.scale.setScalar(0.08 + k * 0.14);
      s.material.opacity = 0.5 * (1 - k);
    });
  }

  /** blinking red target ring during an airstrike's incoming delay */
  strikeMarker(at: THREE.Vector3, duration: number, radius: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.82, radius, 28),
      new THREE.MeshBasicMaterial({ color: 0xe23b2e, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.material.userData.own = true;
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).setY(0.13);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.04, 0.1, 16),
      new THREE.MeshBasicMaterial({ color: 0xe23b2e, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    inner.material.userData.own = true;
    inner.rotation.x = -Math.PI / 2;
    inner.position.copy(at).setY(0.13);
    this.add(ring, duration, (item) => {
      const blink = 0.45 + 0.55 * Math.abs(Math.sin(item.t * 12));
      (ring.material as THREE.MeshBasicMaterial).opacity = blink;
      ring.scale.setScalar(1 - 0.25 * (item.t / item.life));
    });
    this.add(inner, duration, (item) => {
      (inner.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * Math.abs(Math.sin(item.t * 12));
    });
  }

  /** supply-truck service call: a brass flash + sparks rising off the works */
  boostBurst(at: THREE.Vector3): void {
    const flash = this.sprite(this.glowTex, 0xd8a93c);
    flash.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
    this.add(flash, 0.38, (item) => {
      const k = item.t / item.life;
      flash.scale.setScalar(0.45 + k * 0.75);
      flash.material.opacity = 0.85 * (1 - k);
    });
    for (let i = 0; i < 8; i++) {
      const spark = this.sprite(this.glowTex, 0xf2c860);
      const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const r = 0.22 + Math.random() * 0.16;
      spark.position.copy(at).add(new THREE.Vector3(Math.cos(ang) * r, 0.12, Math.sin(ang) * r));
      spark.scale.setScalar(0.08 + Math.random() * 0.05);
      const rise = 0.7 + Math.random() * 0.5;
      this.add(spark, 0.45 + Math.random() * 0.25, (item, dt) => {
        spark.position.y += rise * dt;
        spark.material.opacity = 1 - item.t / item.life;
      });
    }
  }

  placeDust(at: THREE.Vector3): void {
    for (let i = 0; i < 5; i++) {
      const smoke = this.sprite(this.smokeTex, 0xcec6ab, THREE.NormalBlending);
      const ang = (i / 5) * Math.PI * 2;
      smoke.position.copy(at).add(new THREE.Vector3(Math.cos(ang) * 0.3, 0.08, Math.sin(ang) * 0.3));
      this.add(smoke, 0.5, (item) => {
        const k = item.t / item.life;
        smoke.position.x += Math.cos(ang) * 0.012;
        smoke.position.z += Math.sin(ang) * 0.012;
        smoke.scale.setScalar(0.2 + k * 0.35);
        smoke.material.opacity = 0.6 * (1 - k);
      });
    }
  }

  private remove(item: FxItem): void {
    this.scene.remove(item.obj);
    disposeObject(item.obj);
    const m = (item.obj as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
    if (m && m.userData.own) m.dispose();
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.t += dt;
      if (item.t >= item.life) {
        this.remove(item);
        this.items.splice(i, 1);
      } else {
        item.update(item, dt);
      }
    }
  }

  dispose(): void {
    for (const item of this.items) this.remove(item);
    this.items = [];
  }
}

/**
 * Dispose an object's one-off geometry. Kit geometry (geo.userData.shared)
 * and palette materials are cached + shared across every entity — never freed.
 */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
  });
}
