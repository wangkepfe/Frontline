/** Deterministic seeded RNG (mulberry32). The sim must never touch Math.random. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Raw internal state — folded into desync checksums and (future) replays. */
  get state(): number {
    return this.s >>> 0;
  }
  /** float in [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /**
   * Low-discrepancy "spread" ordering for the deal queue — FAIR yet VARIED. A
   * plain shuffle happily clumps (three rifles back to back, both power plants
   * late); a purely deterministic stratification is the opposite problem — the
   * exact same deal every single game, which kills replay variety.
   *
   * So: each distinct card (grouped by `key`) keeps its copies stratified evenly
   * across [0,1) — that's the fairness, copies always fan out, no clumps. But
   * which card TYPE lands in which interleaving slot is decided per-seed: the
   * groups are assigned golden-ratio phases (the R1 low-discrepancy sequence, so
   * distinct types stay well-separated) in a SEED-SHUFFLED order, with a global
   * seeded rotation on top. Same seed → same deal (deterministic for lockstep);
   * different seed → a genuinely different, still-fair order.
   */
  spread<T>(items: T[], key: (item: T) => string): T[] {
    const PHI = 0.6180339887498949; // frac(golden ratio) — the R1 step
    const groups = new Map<string, T[]>();
    for (const it of items) {
      const k = key(it);
      let g = groups.get(k);
      if (!g) { g = []; groups.set(k, g); }
      g.push(it);
    }
    // seed-shuffled phase assignment + global rotation = per-game variety while
    // the golden-ratio spacing keeps distinct card types low-discrepancy
    const order = this.shuffle([...groups.values()]);
    const rot = this.next();
    const scored: Array<{ pos: number; it: T }> = [];
    let gi = 0;
    for (const arr of order) {
      const phase = (gi * PHI + rot) % 1;
      const n = arr.length;
      for (let j = 0; j < n; j++) {
        // a hair of seeded jitter only to break exact ties between stratified
        // positions; the shuffled phase assignment is what varies the order
        const jitter = this.next() * 1e-4;
        const pos = ((j + 0.5) / n + phase + jitter) % 1;
        scored.push({ pos, it: arr[j] });
      }
      gi++;
    }
    scored.sort((a, b) => a.pos - b.pos);
    return scored.map((s) => s.it);
  }
}
