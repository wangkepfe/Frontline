import { Sim } from './sim/sim';
import { AiController, AiProfile } from './sim/ai';
import { CARDS, HandCategory } from './sim/cards';
import { COLLECT_STEP, ESCALATE_DRAW_T, NUKE_UNLOCK_T, STORE_CAP_GOLD, STORE_CAP_OIL, TICK_DT } from './sim/stats';
import { isValidPlacement, validPlacementTiles } from './sim/placement';
import { createScene, SceneCtx } from './render/scene';
import { GameView } from './render/view';
import { Hud } from './ui/hud';
import { icon } from './ui/icons';
import { sfx, sfxForSimEvent } from './audio/sfx';
import { LockstepNet } from './net/lockstep';
import type { NetCommand } from './net/protocol';
import type { Transport } from './net/transport';
import type { CardRef, SimOptions, TeamId } from './sim/types';

/** Tutorial hint: shows while `show` is true, retires permanently once `done`. */
export interface Hint {
  id: string;
  text: string;
  show: (sim: Sim, game: Game) => boolean;
  done: (sim: Sim, game: Game) => boolean;
}

export interface GameOptions {
  seed: number;
  playerLoadout: Array<string | CardRef>;
  /** omit for scripted (wave-driven) scenarios */
  aiLoadout?: Array<string | CardRef>;
  aiProfile?: AiProfile;
  simOptions?: SimOptions;
  hints?: Hint[];
  onEnd: (winner: TeamId, sim: Sim) => void;
  /** Esc with nothing armed — open/close the pause menu (main.ts overlay) */
  onEscape?: () => void;
  /** D — toggle the read-only deck inspector */
  onToggleDeck?: () => void;
  /** the side this client commands (multiplayer joiner = 1). Default 0. */
  localTeam?: TeamId;
  /** present ⇒ networked multiplayer: input becomes lockstep commands over this
   *  pipe instead of mutating the sim directly. The two peers must build the sim
   *  from an identical seed/loadout/simOptions (the lobby guarantees this). */
  transport?: Transport;
  /** the two sims diverged mid-match (a bug or tampering) — unrecoverable. */
  onDesync?: () => void;
  /** the networked opponent disconnected. */
  onPeerLeft?: () => void;
}

/** One match: owns the sim, the AI, the 3D view, input, and the frame loop. */
export class Game {
  readonly sim: Sim;
  readonly localTeam: TeamId;
  private ai: AiController | null;
  /** lockstep driver in multiplayer; null in single-player */
  private net: LockstepNet | null = null;
  private netWaiting = false;
  private sceneCtx: SceneCtx;
  private view: GameView;
  private hud: Hud;
  private raf = 0;
  private watchdog = 0;
  private lastT = 0;
  private acc = 0;
  private armedSlot = -1;
  private dragging = false;
  private pressInfo = { x: 0, y: 0, t: 0 };
  private ended = false;
  private paused = false;
  private disposed = false;
  private prevSimTime = 0;
  private listeners: Array<() => void> = [];
  private hintsDone = new Set<string>();
  private hintsSeen = new Set<string>();
  /** world-space collection badges keyed by building id */
  private badges = new Map<number, { root: HTMLElement; num: HTMLElement }>();
  /** out-of-power markers keyed by building id */
  private powerBadges = new Map<number, HTMLElement>();
  private worldUi: HTMLElement;
  /** counters for hint predicates */
  stats = { cardsPlayed: 0, collects: 0 };

  constructor(private stage: HTMLElement, hud: Hud, private opts: GameOptions) {
    this.localTeam = opts.localTeam ?? 0;
    this.sim = new Sim(opts.seed, [opts.playerLoadout, opts.aiLoadout ?? []], opts.simOptions);
    // no AI in multiplayer — both sides are human, the net carries their orders
    this.ai = opts.aiProfile && !opts.transport ? new AiController(1, opts.seed * 31 + 7, opts.aiProfile) : null;
    this.sceneCtx = createScene(stage, this.localTeam);
    this.view = new GameView(this.sceneCtx, this.sim);
    this.hud = hud;
    this.hud.localTeam = this.localTeam;
    this.hud.onCardClick = (slot, ev) => this.onCardPress(slot, ev);
    this.hud.onRefresh = (cat) => this.refreshRegion(cat);

    if (opts.transport) {
      this.net = new LockstepNet(this.sim, this.localTeam, opts.transport, {
        onApplyLocal: (cmd, result) => this.onNetApplied(cmd, result),
        onDesync: () => {
          this.hud.netStatus('CONNECTION DESYNCED');
          this.opts.onDesync?.();
        },
        onClose: () => this.onPeerLeft()
      });
    }
    this.worldUi = document.getElementById('world-ui')!;
    this.worldUi.innerHTML = '';

    const canvas = this.sceneCtx.renderer.domElement;
    const onDown = (ev: PointerEvent) => this.onCanvasDown(ev);
    const onWinMove = (ev: PointerEvent) => this.onWindowMove(ev);
    const onWinUp = (ev: PointerEvent) => this.onWindowUp(ev);
    const onKey = (ev: KeyboardEvent) => this.onKey(ev);
    const onCtx = (ev: Event) => {
      ev.preventDefault();
      this.disarm();
    };
    // right-click anywhere cancels a held card (hand, HUD, off-board — not just the canvas)
    const onWinCtx = (ev: Event) => {
      if (this.armedSlot >= 0) {
        ev.preventDefault();
        this.disarm();
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('contextmenu', onCtx);
    window.addEventListener('contextmenu', onWinCtx);
    this.listeners.push(
      () => canvas.removeEventListener('pointerdown', onDown),
      () => window.removeEventListener('pointermove', onWinMove),
      () => window.removeEventListener('pointerup', onWinUp),
      () => window.removeEventListener('keydown', onKey),
      () => canvas.removeEventListener('contextmenu', onCtx),
      () => window.removeEventListener('contextmenu', onWinCtx)
    );

    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    // rAF stalls in background/hidden tabs; keep the war (and the renderer) running
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastT > 200) this.frame(performance.now(), false);
    }, 100);
    (window as unknown as { __game?: Game }).__game = this; // dev/debug handle
  }

  // ── input ────────────────────────────────────────────────────────────────

  private onCardPress(slot: number, ev?: PointerEvent): void {
    if (this.ended) return;
    if (this.armedSlot === slot && !ev) {
      this.disarm();
      return;
    }
    if (this.armedSlot === slot && ev) {
      // pressing the armed card again disarms (toggle)
      this.disarm();
      return;
    }
    const p = this.sim.players[this.localTeam];
    const hand = p.hand[slot];
    if (!hand) return;
    const card = CARDS[hand.card.id];

    // locked/unaffordable cards refuse to arm — say why instead of dangling a ghost
    const pre = this.sim.canPlay(this.localTeam, slot);
    if (!pre.ok && pre.reason !== 'needs target') {
      this.hud.toast(reasonText(pre.reason));
      sfx.play('invalid');
      return;
    }

    // untargeted and auto-placing cards play instantly — one click, no aiming
    if (card.place === 'none' || card.auto) {
      this.commitPlay(slot);
      this.disarm();
      return;
    }
    this.armedSlot = slot;
    this.hud.setArmed(slot);
    sfx.play('card_arm');
    const tiles = validPlacementTiles(this.sim, this.localTeam, card);
    this.view.setPlacementTiles(card.place === 'anywhere' ? null : tiles);
    this.view.setGhost(card);
    if (ev) {
      this.dragging = true;
      this.pressInfo = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    }
    if (tiles.length === 0 && card.place !== 'anywhere') {
      this.hud.toast(card.place === 'gold' ? 'No free gold mine in your territory' : card.place === 'oil' ? 'No free oil field in your territory' : 'No valid tile in your territory');
    }
  }

  private disarm(): void {
    this.armedSlot = -1;
    this.dragging = false;
    this.hud.setArmed(-1);
    this.view.setPlacementTiles(null);
    this.view.setGhost(null);
    this.view.setHover(null, false);
  }

  private armedCard() {
    if (this.armedSlot < 0) return null;
    const hand = this.sim.players[this.localTeam].hand[this.armedSlot];
    return hand ? CARDS[hand.card.id] : null;
  }

  private onWindowMove(ev: PointerEvent): void {
    if (this.armedSlot < 0) return;
    const card = this.armedCard();
    if (!card) return;
    const tile = this.view.pickTile(ev.clientX, ev.clientY);
    if (!tile) {
      this.view.setHover(null, false);
      return;
    }
    this.view.setHover(tile, isValidPlacement(this.sim, this.localTeam, card, tile.c, tile.r));
  }

  private onWindowUp(ev: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.armedSlot < 0 || this.ended) return;
    if ((ev.target as HTMLElement | null)?.closest?.('.wbadge')) return; // released on a collect badge
    const moved = Math.hypot(ev.clientX - this.pressInfo.x, ev.clientY - this.pressInfo.y) > 14;
    const held = performance.now() - this.pressInfo.t > 300;
    if (!moved && !held) return; // it was a click: stay armed, place with a second click
    const tile = this.view.pickTile(ev.clientX, ev.clientY);
    if (!tile) return; // released off-board: stay armed
    this.tryPlace(tile);
  }

  private onCanvasDown(ev: PointerEvent): void {
    if (ev.button !== 0 || this.armedSlot < 0 || this.ended || this.dragging) return;
    const tile = this.view.pickTile(ev.clientX, ev.clientY);
    if (!tile) return;
    this.tryPlace(tile);
  }

  private tryPlace(tile: { c: number; r: number }): void {
    if (this.commitPlay(this.armedSlot, tile)) this.disarm();
  }

  /**
   * Play a card for the local team. Single-player mutates the sim directly;
   * multiplayer pre-validates for instant UI feedback, then submits a lockstep
   * command that executes (on BOTH peers) a few ticks later. Returns whether the
   * action was accepted (so the caller can disarm).
   */
  private commitPlay(slot: number, tile?: { c: number; r: number }): boolean {
    const check = this.sim.canPlay(this.localTeam, slot, tile);
    if (!check.ok) {
      this.hud.toast(reasonText(check.reason));
      sfx.play('invalid');
      return false;
    }
    const cmd: NetCommand = { k: 'play', team: this.localTeam, slot, ...(tile ? { tile } : {}) };
    if (this.net) {
      this.net.submitLocal(cmd);
    } else {
      this.sim.playCard(this.localTeam, slot, tile);
      this.stats.cardsPlayed++;
    }
    return true;
  }

  /** local-team command just executed in the sim (multiplayer) — fire UI cues */
  private onNetApplied(cmd: NetCommand, result: unknown): void {
    if (cmd.k === 'play') {
      if ((result as { ok?: boolean } | null)?.ok) this.stats.cardsPlayed++;
      return;
    }
    if (cmd.k === 'collect') {
      const claim = result as { kind: 'gold' | 'oil'; amount: number } | null;
      if (!claim) return;
      this.stats.collects++;
      const b = this.sim.buildings.find((x) => x.id === cmd.id);
      const rect = b ? (() => { const px = this.view.projectTile(b.tile); return new DOMRect(px.x - 20, px.y - 30, 40, 20); })() : null;
      this.hud.flyResources(claim.kind, claim.amount, rect);
      sfx.play('collect');
    }
  }

  private onPeerLeft(): void {
    if (this.ended || this.disposed) return;
    this.hud.netStatus(null);
    this.opts.onPeerLeft?.();
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      // Esc backs out one layer: armed card first, then the pause menu
      if (this.armedSlot >= 0) this.disarm();
      else this.opts.onEscape?.();
      return;
    }
    if (ev.key === 'd' || ev.key === 'D') {
      this.opts.onToggleDeck?.();
      return;
    }
    if (this.paused) return; // card hotkeys sleep while a menu is up
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= 6) this.onCardPress(n - 1);
  }

  /** paid desk refresh (the corner buttons): discard + redeal that desk */
  refreshRegion(cat: HandCategory): void {
    if (this.ended) return;
    if (this.net) {
      // pre-check affordability for instant feedback; the discard + redeal lands
      // on both peers when the command executes
      const p = this.sim.players[this.localTeam];
      if (p.gold < this.sim.refreshCost(this.localTeam, cat)) {
        this.hud.toast(reasonText('resources'));
        sfx.play('invalid');
        return;
      }
      this.net.submitLocal({ k: 'refresh', team: this.localTeam, cat });
      this.disarm();
      sfx.play('card_arm');
      return;
    }
    const res = this.sim.refreshRegion(this.localTeam, cat);
    if (res.ok) {
      this.disarm();
      sfx.play('card_arm');
    } else {
      this.hud.toast(reasonText(res.reason));
      sfx.play('invalid');
    }
  }

  // ── pause & surrender ─────────────────────────────────────────────────────

  get isEnded(): boolean {
    return this.ended;
  }

  /** Freeze the war while a menu is up; rendering keeps running. */
  setPaused(v: boolean): void {
    if (v) this.disarm();
    this.paused = v;
  }

  /** Concede the battle: runs the mode's normal defeat flow. */
  surrender(): void {
    if (this.ended || this.disposed) return;
    this.ended = true;
    this.disarm();
    this.net?.close('surrender'); // tell the opponent so their match resolves too
    this.opts.onEnd(this.localTeam === 0 ? 1 : 0, this.sim);
  }

  private collectBuilding(buildingId: number): void {
    if (this.net) {
      // the bank + fly-chips happen when the command executes (onNetApplied)
      this.net.submitLocal({ k: 'collect', team: this.localTeam, id: buildingId });
      return;
    }
    const badge = this.badges.get(buildingId);
    const fromRect = badge?.root.getBoundingClientRect() ?? null;
    const claim = this.sim.collectBuilding(this.localTeam, buildingId);
    if (claim) {
      this.stats.collects++;
      this.hud.flyResources(claim.kind, claim.amount, fromRect);
      sfx.play('collect');
    }
  }

  /** badges that pop over extractors/derricks once a package is ready */
  private updateBadges(): void {
    const live = new Set<number>();
    if (this.sim.rules.manualCollect && !this.ended) {
      for (const b of this.sim.buildings) {
        if (b.team !== this.localTeam || b.hp <= 0) continue;
        if (b.kind !== 'extractor' && b.kind !== 'derrick') continue;
        const isGold = b.kind === 'extractor';
        const cap = isGold ? STORE_CAP_GOLD : STORE_CAP_OIL;
        const packaged = Math.floor(b.stored / COLLECT_STEP) * COLLECT_STEP;
        if (packaged < COLLECT_STEP) continue;
        live.add(b.id);
        let badge = this.badges.get(b.id);
        if (!badge) {
          const root = document.createElement('button');
          root.className = `wbadge ${isGold ? 'gold' : 'oil'}`;
          root.innerHTML = `${icon(isGold ? 'gold' : 'oil')}<b></b><i>MAX</i>`;
          root.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
            this.collectBuilding(b.id);
          });
          this.worldUi.appendChild(root);
          badge = { root, num: root.querySelector('b')! };
          this.badges.set(b.id, badge);
        }
        const full = b.stored >= cap - 0.01;
        badge.root.classList.toggle('full', full);
        const label = String(packaged);
        if (badge.num.textContent !== label) badge.num.textContent = label;
        const px = this.view.projectTile({ c: b.tile.c, r: b.tile.r });
        badge.root.style.left = `${px.x}px`;
        badge.root.style.top = `${px.y - 46}px`;
      }
    }
    for (const [id, badge] of this.badges) {
      if (!live.has(id)) {
        badge.root.remove();
        this.badges.delete(id);
      }
    }

    // out-of-power markers: a dark building is inert until the grid catches up
    const dark = new Set<number>();
    if (this.sim.rules.tech && !this.ended) {
      for (const b of this.sim.buildings) {
        if (b.team !== this.localTeam || b.hp <= 0 || b.powered) continue;
        dark.add(b.id);
        let badge = this.powerBadges.get(b.id);
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'pwrbadge';
          badge.innerHTML = icon('boltOff');
          badge.title = 'Out of power — build a Power Plant';
          this.worldUi.appendChild(badge);
          this.powerBadges.set(b.id, badge);
        }
        const px = this.view.projectTile({ c: b.tile.c, r: b.tile.r });
        badge.style.left = `${px.x}px`;
        badge.style.top = `${px.y - 72}px`;
      }
    }
    for (const [id, badge] of this.powerBadges) {
      if (!dark.has(id)) {
        badge.remove();
        this.powerBadges.delete(id);
      }
    }
  }

  // ── frame loop ───────────────────────────────────────────────────────────

  private updateHints(): void {
    const hints = this.opts.hints;
    if (!hints) return;
    for (const h of hints) {
      if (this.hintsDone.has(h.id)) continue;
      if (this.hintsSeen.has(h.id) && h.done(this.sim, this)) {
        this.hintsDone.add(h.id);
        continue;
      }
      if (h.show(this.sim, this)) {
        this.hintsSeen.add(h.id);
        this.hud.showHint(h.text);
        return;
      }
    }
    this.hud.showHint(null);
  }

  private frame(t: number, scheduleNext = true): void {
    if (this.disposed) return;
    // rAF frames clamp hard (hiccup protection); throttled watchdog frames may
    // need to catch up a full second of background time
    const dtFrame = Math.min(scheduleNext ? 0.1 : 1.2, (t - this.lastT) / 1000);
    this.lastT = t;
    this.acc += dtFrame;

    if (this.paused) {
      this.acc = 0; // drop time spent in the menu — no catch-up burst on resume
    } else if (this.net) {
      // lockstep: only advance ticks we hold both peers' commands for. If the
      // peer falls behind we stall here (and say so) rather than racing ahead.
      while (this.acc >= TICK_DT && this.net.canStep()) {
        this.net.step();
        this.acc -= TICK_DT;
      }
      const waiting = this.acc >= TICK_DT && !this.net.canStep() && !this.sim.result && !this.net.isClosed;
      if (waiting !== this.netWaiting) {
        this.netWaiting = waiting;
        this.hud.netStatus(waiting ? 'WAITING FOR OPPONENT…' : null);
      }
      if (this.acc > 1) this.acc = 1; // bound the catch-up burst after a stall
    } else {
      while (this.acc >= TICK_DT) {
        this.ai?.update(this.sim, TICK_DT);
        this.sim.step();
        this.acc -= TICK_DT;
      }
    }

    const events = this.sim.drainEvents();
    this.view.handleEvents(events);
    for (const e of events) {
      sfxForSimEvent(e);
      // supply truck banked a silo: same fly-chips as a manual collect
      if (e.t === 'truckCollect' && e.team === this.localTeam) {
        const b = this.sim.buildings.find((x) => x.id === e.id);
        if (b) {
          const px = this.view.projectTile(b.tile);
          this.hud.flyResources(e.kind, e.amount, new DOMRect(px.x - 20, px.y - 30, 40, 20));
        }
      }
    }
    // escalation alarms (once each, when the clock crosses the thresholds)
    if (this.sim.rules.escalation) {
      for (const threshold of [ESCALATE_DRAW_T, NUKE_UNLOCK_T]) {
        if (this.prevSimTime < threshold && this.sim.time >= threshold) sfx.play('alarm');
      }
    }
    this.prevSimTime = this.sim.time;

    // armed card may have expired or been consumed
    if (this.armedSlot >= 0 && !this.sim.players[this.localTeam].hand[this.armedSlot]) {
      this.disarm();
    }

    this.updateHints();
    this.updateBadges();
    this.view.update(this.acc / TICK_DT, dtFrame);
    this.hud.update(this.sim, dtFrame);
    this.view.render();

    if (this.sim.result && !this.ended) {
      this.ended = true;
      this.disarm();
      const winner = this.sim.result.winner;
      setTimeout(() => {
        if (!this.disposed) this.opts.onEnd(winner, this.sim);
      }, 1400); // let the final explosion play out
    }

    if (scheduleNext) this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  // ── debug/testing aids ───────────────────────────────────────────────────

  /** client pixel position of a tile center */
  tileToClient(c: number, r: number): { x: number; y: number } {
    return this.view.projectTile({ c, r });
  }

  /** advance the match without rendering each tick */
  fastForward(seconds: number): void {
    const steps = Math.round(seconds / TICK_DT);
    for (let i = 0; i < steps && !this.sim.result; i++) {
      this.ai?.update(this.sim, TICK_DT);
      this.sim.step();
    }
    this.sim.drainEvents();
    this.view.resyncAll();
  }

  dispose(): void {
    this.disposed = true;
    this.net?.close(); // notify the opponent we're leaving, then drop the pipe
    this.hud.netStatus(null);
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    for (const off of this.listeners) off();
    for (const [, badge] of this.badges) badge.root.remove();
    this.badges.clear();
    for (const [, badge] of this.powerBadges) badge.remove();
    this.powerBadges.clear();
    this.view.dispose();
    this.stage.innerHTML = '';
  }
}

function reasonText(reason?: string): string {
  switch (reason) {
    case 'resources': return 'Not enough resources';
    case 'invalid tile': return 'Invalid placement';
    case 'no site': return 'No free site in your territory';
    case 'owned': return 'Already researched';
    case 'needs target': return 'Pick a tile';
    case 'requires powerplant': return 'Requires a Power Plant ⚡';
    case 'requires extractor': return 'Requires a Gold Extractor (tier 1)';
    case 'requires derrick': return 'Requires an Oil Derrick (tier 2)';
    default: return 'Cannot play that';
  }
}
