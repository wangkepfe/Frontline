import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Optional per-biome lighting overrides. Every field defaults to the temperate
 * golden-hour values, so `studio(r, s, c, span)` with no opts is byte-identical
 * to the original rig (the live battle/skirmish/tutorial/MP path must not move).
 * Only color/intensity tone shifts are exposed — the tone-mapping, shadow rig,
 * environment, and the key azimuth (45° off camera) stay fixed by law.
 */
export interface StudioOpts {
  background?: number;
  feltColor?: number;
  sunColor?: number;
  sunIntensity?: number;
  hemiSky?: number;
  hemiGround?: number;
  hemiIntensity?: number;
  rimColor?: number;
  rimIntensity?: number;
  environmentIntensity?: number;
}

/**
 * The ONE lighting rig (ART_DIRECTION.md §2) — used by the game scene and the
 * atelier so art is always judged under final light.
 *
 * Golden-hour key from the south-west (the camera side) so chamfers catch warm
 * edge light; cool hemisphere fill keeps shadows slate-blue; a low cool rim
 * from the north-east separates silhouettes from the ground; ACES + a neutral
 * room environment makes painted metal read as enamel on tin.
 *
 * `opts` retones the lamps/sky per biome (desert = hotter brighter key, winter
 * = cooler lower key + pale sky) without touching the rig geometry.
 */
export function studio(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  center: THREE.Vector3,
  span: number,
  opts: StudioOpts = {}
): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = opts.environmentIntensity ?? 0.45;
  pmrem.dispose();

  scene.background = new THREE.Color(opts.background ?? 0x17130e); // unlit room beyond the table

  // the ops-room table the diorama sits on — the board never floats in void
  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ color: opts.feltColor ?? 0x2b251c, roughness: 0.97, metalness: 0 })
  );
  felt.rotation.x = -Math.PI / 2;
  felt.position.set(center.x, -0.34, center.z);
  felt.receiveShadow = true;
  scene.add(felt);

  const hemi = new THREE.HemisphereLight(opts.hemiSky ?? 0xb9c8de, opts.hemiGround ?? 0x55492f, opts.hemiIntensity ?? 0.65);
  scene.add(hemi);

  // key azimuth ~45° off the camera axis — shadows fall to screen-right where
  // they're visible, instead of hiding directly behind each caster
  const sun = new THREE.DirectionalLight(opts.sunColor ?? 0xffd9a0, opts.sunIntensity ?? 2.1);
  sun.position.copy(center).add(new THREE.Vector3(-span * 0.85, span * 0.95, -span * 0.18));
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = span * 0.85;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = span * 4;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.012;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(opts.rimColor ?? 0x6e8fc4, opts.rimIntensity ?? 0.55);
  rim.position.copy(center).add(new THREE.Vector3(span * 0.7, span * 0.35, -span * 0.6));
  rim.target.position.copy(center);
  scene.add(rim, rim.target);
}
