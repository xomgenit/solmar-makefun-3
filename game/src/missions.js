// Mission system: a small hook the story missions plug into.
//
// Register each mission with `define(id, def)` where def is:
//   { name, briefing, reward, start(ctx), update(dt, ctx), onComplete(ctx)?,
//     onInteract(ctx)? }
// ctx is { game, mission, data }. Inside update(), call
//   ctx.mission.setObjective(text, marker?)  — marker is {x, y} or null
//   ctx.mission.complete()                   — pays the reward, autosaves
//   ctx.mission.fail(reason)                 — shows the fail banner, back to free roam
// onInteract runs when the player presses E on foot; return true if the
// mission consumed the press (so E does not steal a car instead).
// The system tracks progress (completedIds) and exposes the current
// objective line + map marker for the HUD. Free roam is mission 'freeroam':
// it points at Vera, and walking up to her starts the next story mission.
import { dist } from './rng.js';
import { defineStoryMissions, nextStoryId, makeStashes, STASH_REWARD } from './story.js';

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.defs = new Map();
    this.current = null;   // { id, def, data, objective, marker, startedAt }
    this.completedIds = [];
    this.retriggerAt = 0;  // game.time before which Vera offers no new job (after a fail)
    this.stashes = makeStashes(game);
    this.define('freeroam', {
      name: 'Free Roam',
      briefing: 'Solmar Bay is yours. Find Vera at the Hideout when you are ready for work.',
      reward: 0,
      start(ctx) {
        const hide = ctx.game.city.landmark('hideout');
        ctx.mission.setObjective('Explore Solmar Bay — find Vera at the Hideout', { x: hide.x, y: hide.y, label: 'Vera' });
      },
      update(dt, ctx) {
        const game = ctx.game;
        const next = nextStoryId(ctx.game.missions);
        if (!next) {
          ctx.mission.setObjective('All jobs done — Solmar Bay is yours, Dice.');
          return;
        }
        // Walk up to Vera (within 80 of the Hideout) to start the next job.
        // The player spawns 90 away, so this never fires on its own.
        if (game.time < ctx.game.missions.retriggerAt) return;
        const hide = game.city.landmark('hideout');
        if (dist(game.player.x, game.player.y, hide.x, hide.y) < 80) {
          game.missions.start(next);
        }
      },
    });
    defineStoryMissions(this);
  }
  define(id, def) { this.defs.set(id, def); }
  start(id) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`unknown mission ${id}`);
    const mission = {
      id, def, data: {},
      objective: '', marker: null,
      setObjective: (text, marker = null) => { mission.objective = text; mission.marker = marker; },
      complete: () => this.complete(),
      fail: (reason) => this.fail(reason),
    };
    this.current = mission;
    // Free roam is the default state, not an event: no banner (otherwise
    // it would instantly overwrite the MISSION COMPLETE banner).
    if (id !== 'freeroam') {
      this.game.hud.banner(def.name.toUpperCase(), def.briefing);
      this.game.sfx.jingle();
    }
    def.start({ game: this.game, mission, data: mission.data });
    return mission;
  }
  complete() {
    // Clear state BEFORE any effect runs: a mission must never pay twice.
    const mission = this.current;
    if (!mission) return;
    this.current = null;
    this.completedIds.push(mission.id);
    this.game.stats.missionsDone++;
    const reward = mission.def.reward || 0;
    if (reward > 0) {
      this.game.addCash(reward);
      this.game.hud.banner('MISSION COMPLETE', `+$${reward.toLocaleString()} — ${mission.def.name}`);
      this.game.combat.floater(this.game.player.x, this.game.player.y - 30, `+$${reward}`, '#7CFC9A');
    }
    if (mission.def.onComplete) mission.def.onComplete({ game: this.game, mission, data: mission.data });
    this.game.autosave();
    // Fall back to free roam until the next mission starts.
    this.start('freeroam');
  }
  fail(reason) {
    const mission = this.current;
    if (!mission) return;
    this.current = null;
    // Vera needs a moment before offering the job again — otherwise a
    // failed mission restarts instantly while the player still stands
    // next to her.
    this.retriggerAt = this.game.time + 3;
    this.game.hud.banner('MISSION FAILED', reason || mission.def.name);
    this.game.sfx.fail();
    this.start('freeroam');
  }
  // E pressed on foot: let the current mission consume it first.
  tryInteract() {
    const m = this.current;
    if (!m || !m.def.onInteract) return false;
    return !!m.def.onInteract({ game: this.game, mission: m, data: m.data });
  }
  update(dt) {
    // Hidden cash stashes: walk over one to collect it.
    const p = this.game.player;
    for (const s of this.stashes) {
      if (!s.taken && dist(p.x, p.y, s.x, s.y) < 42) {
        s.taken = true;
        this.game.addCash(STASH_REWARD);
        this.game.sfx.pickup();
        this.game.combat.floater(p.x, p.y - 30, `+$${STASH_REWARD}`, '#7CFC9A');
        this.game.hud.flashHint(`Hidden stash found: +$${STASH_REWARD}`);
      }
    }
    if (!this.current) return;
    const mission = this.current;
    mission.def.update(dt, { game: this.game, mission, data: mission.data });
  }
  objectiveText() { return this.current ? this.current.objective : ''; }
  marker() { return this.current ? this.current.marker : null; }
  missionName() { return this.current ? this.current.def.name : 'Free Roam'; }
}
