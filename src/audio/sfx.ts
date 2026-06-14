import type { SimEvent } from '../sim/types';
import { CARDS } from '../sim/cards';

/**
 * FRONTLINE audio. Every effect is synthesized at load (WebAudio, zero assets,
 * zero licensing risk) — and any file dropped at public/sfx/<id>.ogg replaces
 * the synth version automatically (CC0 packs from kenney.nl / sonniss.com GDC
 * bundles slot straight in).
 */

export type SfxId =
  | 'shot_smallarms' | 'shot_mg' | 'shot_at' | 'shot_cannon' | 'shot_artillery' | 'shot_hq'
  | 'impact' | 'explosion_small' | 'explosion_big' | 'explosion_huge'
  | 'strike_incoming' | 'alarm' | 'nuke_siren' | 'nuke_blast'
  | 'card_draw' | 'card_play' | 'card_expire' | 'card_arm' | 'invalid'
  | 'collect' | 'build_place' | 'upgrade'
  | 'victory' | 'defeat' | 'ui_click';

const BASE_VOL: Record<SfxId, number> = {
  shot_smallarms: 0.32, shot_mg: 0.26, shot_at: 0.5, shot_cannon: 0.6, shot_artillery: 0.6,
  shot_hq: 0.55,
  impact: 0.18, explosion_small: 0.55, explosion_big: 0.7, explosion_huge: 0.85,
  strike_incoming: 0.5, alarm: 0.5, nuke_siren: 0.65, nuke_blast: 1.0,
  card_draw: 0.35, card_play: 0.5, card_expire: 0.4, card_arm: 0.3, invalid: 0.4,
  collect: 0.5, build_place: 0.55, upgrade: 0.5,
  victory: 0.7, defeat: 0.7, ui_click: 0.25
};

const THROTTLE_MS: Partial<Record<SfxId, number>> = {
  shot_smallarms: 55, shot_mg: 45, shot_at: 90, shot_cannon: 90, shot_artillery: 120,
  shot_hq: 110,
  impact: 80, explosion_small: 90, explosion_big: 120, explosion_huge: 160,
  card_draw: 60, ui_click: 40, collect: 90, build_place: 100
};

// ── synthesis helpers (pure PCM math) ───────────────────────────────────────

interface NoiseOpts {
  at?: number; dur: number; lpFrom: number; lpTo: number; gain: number;
  decay?: number; attack?: number;
}
interface ToneOpts {
  at?: number; dur: number; f0: number; f1?: number; type?: 'sine' | 'saw' | 'square' | 'tri';
  gain: number; decay?: number; attack?: number; vibHz?: number; vibAmt?: number;
}

function env(t: number, dur: number, attack: number, decay: number): number {
  if (t < 0 || t > dur) return 0;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  return a * Math.exp(-t * decay);
}

function addNoise(d: Float32Array, sr: number, o: NoiseOpts): void {
  const start = Math.floor((o.at ?? 0) * sr);
  const n = Math.min(d.length - start, Math.floor(o.dur * sr));
  const decay = o.decay ?? 4 / o.dur;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = i / n;
    const fc = o.lpFrom * Math.pow(o.lpTo / o.lpFrom, k);
    const alpha = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    y += alpha * ((Math.random() * 2 - 1) - y);
    d[start + i] += y * o.gain * env(t, o.dur, o.attack ?? 0.001, decay) * 2.2;
  }
}

function addTone(d: Float32Array, sr: number, o: ToneOpts): void {
  const start = Math.floor((o.at ?? 0) * sr);
  const n = Math.min(d.length - start, Math.floor(o.dur * sr));
  const decay = o.decay ?? 4 / o.dur;
  const f1 = o.f1 ?? o.f0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = i / n;
    let f = o.f0 * Math.pow(f1 / o.f0, k);
    if (o.vibHz) f += Math.sin(t * o.vibHz * 2 * Math.PI) * (o.vibAmt ?? 10);
    phase += (f / sr) * 2 * Math.PI;
    const p = phase % (2 * Math.PI);
    let s: number;
    switch (o.type ?? 'sine') {
      case 'saw': s = (p / Math.PI) - 1; break;
      case 'square': s = p < Math.PI ? 1 : -1; break;
      case 'tri': s = p < Math.PI ? (2 * p) / Math.PI - 1 : 3 - (2 * p) / Math.PI; break;
      default: s = Math.sin(p);
    }
    d[start + i] += s * o.gain * env(t, o.dur, o.attack ?? 0.002, decay);
  }
}

function addCrackle(d: Float32Array, sr: number, at: number, dur: number, density: number, gain: number): void {
  const start = Math.floor(at * sr);
  const n = Math.min(d.length - start, Math.floor(dur * sr));
  for (let i = 0; i < n; i++) {
    const e = Math.exp((-3 * i) / n);
    if (Math.random() < (density / sr) * e * 60) {
      const len = 30 + Math.floor(Math.random() * 90);
      const amp = (Math.random() * 2 - 1) * gain * e;
      for (let j = 0; j < len && start + i + j < d.length; j++) {
        d[start + i + j] += amp * (1 - j / len);
      }
    }
  }
}

function drive(d: Float32Array, amount: number): void {
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * amount);
}

function normalize(d: Float32Array, peak = 0.92): void {
  let max = 0;
  for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
  if (max > 1e-5) {
    const s = peak / max;
    for (let i = 0; i < d.length; i++) d[i] *= s;
  }
}

// ── the recipes ──────────────────────────────────────────────────────────────

type Recipe = { dur: number; build: (d: Float32Array, sr: number) => void };

const RECIPES: Record<SfxId, Recipe> = {
  shot_smallarms: {
    dur: 0.1,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.09, lpFrom: 5200, lpTo: 1000, gain: 0.9, decay: 42 });
      addTone(d, sr, { dur: 0.012, f0: 1900, f1: 900, gain: 0.4, decay: 160 });
      drive(d, 1.7);
    }
  },
  shot_mg: {
    dur: 0.075,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.07, lpFrom: 6200, lpTo: 1700, gain: 0.95, decay: 55 });
      drive(d, 2.1);
    }
  },
  shot_cannon: {
    dur: 0.34,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.3, f0: 100, f1: 46, gain: 0.95, decay: 12 });
      addNoise(d, sr, { dur: 0.22, lpFrom: 1500, lpTo: 200, gain: 0.75, decay: 16 });
      addCrackle(d, sr, 0.02, 0.25, 220, 0.3);
      drive(d, 2.2);
    }
  },
  shot_at: {
    dur: 0.42,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.05, f0: 160, f1: 90, gain: 0.5, decay: 30 });
      addNoise(d, sr, { dur: 0.36, lpFrom: 450, lpTo: 3400, gain: 0.55, decay: 6, attack: 0.02 });
      addNoise(d, sr, { at: 0.18, dur: 0.22, lpFrom: 4200, lpTo: 1500, gain: 0.3, decay: 12 });
    }
  },
  shot_artillery: {
    dur: 0.42,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.4, f0: 78, f1: 36, gain: 1.0, decay: 8.5 });
      addNoise(d, sr, { dur: 0.3, lpFrom: 650, lpTo: 110, gain: 0.65, decay: 10 });
      drive(d, 1.9);
    }
  },
  // the HQ's medium gun: a flak-style double bark — authority without the
  // cannon's floor-shaking low end, so base defense reads at a glance by ear
  shot_hq: {
    dur: 0.26,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.14, f0: 230, f1: 95, gain: 0.8, decay: 22 });
      addNoise(d, sr, { dur: 0.16, lpFrom: 2900, lpTo: 480, gain: 0.7, decay: 24 });
      addTone(d, sr, { at: 0.09, dur: 0.1, f0: 195, f1: 88, gain: 0.5, decay: 30 });
      addNoise(d, sr, { at: 0.09, dur: 0.12, lpFrom: 2300, lpTo: 420, gain: 0.4, decay: 30 });
      drive(d, 2.0);
    }
  },
  impact: {
    dur: 0.06,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.055, lpFrom: 3200, lpTo: 700, gain: 0.6, decay: 70 });
      addTone(d, sr, { dur: 0.02, f0: 700, f1: 320, gain: 0.3, decay: 110 });
    }
  },
  explosion_small: {
    dur: 0.55,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.5, lpFrom: 2300, lpTo: 170, gain: 0.95, decay: 8 });
      addTone(d, sr, { dur: 0.4, f0: 115, f1: 42, gain: 0.7, decay: 9 });
      addCrackle(d, sr, 0.04, 0.4, 260, 0.35);
      drive(d, 2.1);
    }
  },
  explosion_big: {
    dur: 0.95,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.85, lpFrom: 1900, lpTo: 120, gain: 1.0, decay: 5 });
      addTone(d, sr, { dur: 0.7, f0: 92, f1: 30, gain: 0.95, decay: 5.5 });
      addCrackle(d, sr, 0.05, 0.7, 320, 0.45);
      drive(d, 2.4);
    }
  },
  explosion_huge: {
    dur: 1.5,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 1.3, lpFrom: 1600, lpTo: 75, gain: 1.0, decay: 3.4 });
      addTone(d, sr, { dur: 1.1, f0: 70, f1: 24, gain: 1.0, decay: 3.6 });
      addCrackle(d, sr, 0.06, 1.1, 380, 0.5);
      addNoise(d, sr, { at: 0.5, dur: 0.9, lpFrom: 220, lpTo: 60, gain: 0.4, decay: 3.5 });
      drive(d, 2.6);
    }
  },
  strike_incoming: {
    dur: 1.45,
    build: (d, sr) => {
      addTone(d, sr, { dur: 1.4, f0: 1150, f1: 380, type: 'saw', gain: 0.22, decay: 0.9, attack: 0.12, vibHz: 7, vibAmt: 26 });
      addNoise(d, sr, { dur: 1.4, lpFrom: 350, lpTo: 1100, gain: 0.16, decay: 0.8, attack: 0.3 });
    }
  },
  alarm: {
    dur: 0.85,
    build: (d, sr) => {
      addTone(d, sr, { at: 0.0, dur: 0.18, f0: 700, type: 'square', gain: 0.3, decay: 4 });
      addTone(d, sr, { at: 0.21, dur: 0.18, f0: 480, type: 'square', gain: 0.3, decay: 4 });
      addTone(d, sr, { at: 0.42, dur: 0.18, f0: 700, type: 'square', gain: 0.3, decay: 4 });
      addTone(d, sr, { at: 0.63, dur: 0.18, f0: 480, type: 'square', gain: 0.3, decay: 4 });
    }
  },
  // air-raid siren riding under a falling whistle — three seconds of dread
  nuke_siren: {
    dur: 2.9,
    build: (d, sr) => {
      addTone(d, sr, { dur: 2.7, f0: 420, f1: 560, type: 'saw', gain: 0.2, decay: 0.55, attack: 0.5, vibHz: 0.9, vibAmt: 90 });
      addTone(d, sr, { dur: 2.7, f0: 210, f1: 280, type: 'saw', gain: 0.12, decay: 0.55, attack: 0.5, vibHz: 0.9, vibAmt: 45 });
      addTone(d, sr, { at: 0.7, dur: 2.1, f0: 2400, f1: 320, type: 'sine', gain: 0.16, decay: 1.1, attack: 0.25 });
    }
  },
  nuke_blast: {
    dur: 2.6,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 2.3, lpFrom: 1400, lpTo: 45, gain: 1.0, decay: 1.9 });
      addTone(d, sr, { dur: 2.0, f0: 54, f1: 18, gain: 1.0, decay: 2.0 });
      addCrackle(d, sr, 0.08, 1.9, 420, 0.5);
      addNoise(d, sr, { at: 0.9, dur: 1.6, lpFrom: 180, lpTo: 40, gain: 0.5, decay: 1.8 });
      drive(d, 2.8);
    }
  },
  card_draw: {
    dur: 0.1,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.06, lpFrom: 3800, lpTo: 1400, gain: 0.35, decay: 45 });
      addTone(d, sr, { at: 0.02, dur: 0.07, f0: 660, f1: 990, gain: 0.3, decay: 30 });
    }
  },
  card_play: {
    dur: 0.18,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.14, f0: 250, f1: 165, gain: 0.65, decay: 22 });
      addNoise(d, sr, { dur: 0.07, lpFrom: 2100, lpTo: 500, gain: 0.3, decay: 40 });
    }
  },
  card_expire: {
    dur: 0.32,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.28, f0: 720, f1: 240, type: 'tri', gain: 0.32, decay: 9 });
      addNoise(d, sr, { at: 0.05, dur: 0.22, lpFrom: 2600, lpTo: 350, gain: 0.18, decay: 11 });
    }
  },
  card_arm: {
    dur: 0.06,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.05, f0: 920, f1: 740, gain: 0.32, decay: 60 });
    }
  },
  invalid: {
    dur: 0.2,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.07, f0: 215, type: 'square', gain: 0.32, decay: 18 });
      addTone(d, sr, { at: 0.1, dur: 0.08, f0: 185, type: 'square', gain: 0.32, decay: 18 });
    }
  },
  collect: {
    dur: 0.38,
    build: (d, sr) => {
      addNoise(d, sr, { dur: 0.03, lpFrom: 6000, lpTo: 3000, gain: 0.2, decay: 90 });
      addTone(d, sr, { at: 0.0, dur: 0.12, f0: 1320, gain: 0.32, decay: 26 });
      addTone(d, sr, { at: 0.07, dur: 0.12, f0: 1660, gain: 0.3, decay: 26 });
      addTone(d, sr, { at: 0.14, dur: 0.16, f0: 2090, gain: 0.28, decay: 22 });
    }
  },
  build_place: {
    dur: 0.32,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.2, f0: 135, f1: 68, gain: 0.75, decay: 16 });
      addNoise(d, sr, { dur: 0.18, lpFrom: 1300, lpTo: 280, gain: 0.4, decay: 14 });
      addNoise(d, sr, { at: 0.12, dur: 0.15, lpFrom: 2600, lpTo: 800, gain: 0.18, decay: 22 });
    }
  },
  upgrade: {
    dur: 0.5,
    build: (d, sr) => {
      addTone(d, sr, { at: 0.0, dur: 0.16, f0: 520, type: 'tri', gain: 0.3, decay: 12 });
      addTone(d, sr, { at: 0.11, dur: 0.16, f0: 780, type: 'tri', gain: 0.3, decay: 12 });
      addTone(d, sr, { at: 0.22, dur: 0.24, f0: 1040, type: 'tri', gain: 0.32, decay: 9 });
    }
  },
  victory: {
    dur: 1.0,
    build: (d, sr) => {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => {
        addTone(d, sr, { at: i * 0.16, dur: i === 3 ? 0.5 : 0.22, f0: f, type: 'saw', gain: 0.22, decay: i === 3 ? 4 : 9 });
        addTone(d, sr, { at: i * 0.16, dur: i === 3 ? 0.5 : 0.22, f0: f / 2, type: 'tri', gain: 0.16, decay: i === 3 ? 4 : 9 });
      });
    }
  },
  defeat: {
    dur: 1.2,
    build: (d, sr) => {
      addTone(d, sr, { at: 0.0, dur: 0.5, f0: 220, f1: 208, gain: 0.35, decay: 3.5 });
      addTone(d, sr, { at: 0.45, dur: 0.7, f0: 174, f1: 160, gain: 0.38, decay: 2.6 });
      addNoise(d, sr, { at: 0.45, dur: 0.7, lpFrom: 300, lpTo: 90, gain: 0.16, decay: 3 });
    }
  },
  ui_click: {
    dur: 0.035,
    build: (d, sr) => {
      addTone(d, sr, { dur: 0.03, f0: 1350, f1: 950, gain: 0.3, decay: 110 });
    }
  }
};

// ── engine ───────────────────────────────────────────────────────────────────

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SfxId, AudioBuffer>();
  private lastPlay = new Map<SfxId, number>();
  private active = 0;
  private unlocked = false;
  muted = localStorage.getItem('frontline.muted') === '1';
  volume = (() => {
    const v = parseFloat(localStorage.getItem('frontline.volume') ?? '0.8');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  })();

  /** call once at boot: unlocks audio on the first user gesture */
  install(): void {
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        this.renderAll();
        void this.loadOverrides();
        void this.ctx.resume();
      } catch {
        this.ctx = null;
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private renderAll(): void {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    for (const id of Object.keys(RECIPES) as SfxId[]) {
      const r = RECIPES[id];
      const len = Math.ceil(r.dur * sr);
      const buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      r.build(d, sr);
      normalize(d);
      this.buffers.set(id, buf);
    }
  }

  /** any public/sfx/<id>.ogg (or .mp3/.wav) replaces the synth version */
  private async loadOverrides(): Promise<void> {
    if (!this.ctx) return;
    for (const id of Object.keys(RECIPES) as SfxId[]) {
      for (const ext of ['ogg', 'mp3', 'wav']) {
        try {
          const res = await fetch(`sfx/${id}.${ext}`);
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || !type.startsWith('audio')) continue;
          const decoded = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, decoded);
          break;
        } catch {
          /* keep the synth version */
        }
      }
    }
  }

  play(id: SfxId, vol = 1, jitter = 0.07): void {
    if (!this.ctx || !this.master || this.muted) return;
    const now = performance.now();
    const throttle = THROTTLE_MS[id] ?? 0;
    if (throttle > 0 && now - (this.lastPlay.get(id) ?? -1e9) < throttle) return;
    if (this.active > 24 && (id.startsWith('shot_') || id === 'impact')) return;
    this.lastPlay.set(id, now);
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
    const g = this.ctx.createGain();
    const v = BASE_VOL[id] * vol;
    g.gain.value = v;
    src.connect(g).connect(this.master);
    this.active++;
    src.onended = () => this.active--;
    src.start();
    // sample overrides may be much longer than the design length — cap with a fade
    const capDur = Math.max(0.25, RECIPES[id].dur * 2.2);
    if (buf.duration > capDur) {
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(v, t + capDur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + capDur);
      src.stop(t + capDur + 0.01);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('frontline.muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }
}

export const sfx = new SfxEngine();

/** sim event → battlefield audio */
export function sfxForSimEvent(e: SimEvent): void {
  switch (e.t) {
    case 'shot':
      switch (e.weapon) {
        case 'smallarms': sfx.play('shot_smallarms'); break;
        case 'mg': sfx.play('shot_mg'); break;
        case 'at': sfx.play('shot_at'); break;
        case 'cannon': sfx.play('shot_cannon'); break;
        case 'artillery': sfx.play('shot_artillery'); break;
        case 'hqgun': sfx.play('shot_hq'); break;
        default: break;
      }
      break;
    case 'impact': sfx.play('impact', 0.6); break;
    case 'shellLanded': sfx.play('explosion_big', 0.8); break;
    case 'strikeCalled': sfx.play(e.nuke ? 'nuke_siren' : 'strike_incoming'); break;
    case 'strikeHit': sfx.play(e.nuke ? 'nuke_blast' : 'explosion_huge', 0.9); break;
    case 'unitDied':
      sfx.play(e.kind === 'tank' || e.kind === 'howitzer' ? 'explosion_big' : 'explosion_small', 0.7);
      break;
    case 'buildingDestroyed': sfx.play('explosion_huge', e.kind === 'hq' ? 1 : 0.8); break;
    case 'buildingPlaced': sfx.play('build_place', 0.75); break;
    case 'cardDrawn': if (e.team === 0) sfx.play('card_draw'); break;
    case 'cardExpired': if (e.team === 0) sfx.play('card_expire'); break;
    case 'truckCollect': if (e.team === 0) sfx.play('collect', 0.8); break;
    case 'orderIssued': if (e.team === 0) sfx.play('upgrade', 0.7); break;
    case 'cardPlayed':
      if (e.team === 0) sfx.play(CARDS[e.cardId]?.kind === 'upgrade' ? 'upgrade' : 'card_play');
      break;
    case 'matchEnd': sfx.play(e.winner === 0 ? 'victory' : 'defeat'); break;
    default:
      break;
  }
}
