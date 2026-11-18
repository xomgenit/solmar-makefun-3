// Mission system: a small hook the story missions plug into.
//
// Builder 2: register each mission with `define(id, def)` where def is:
//   { name, briefing, reward, start(ctx), update(dt, ctx), onComplete(ctx)? }
// ctx is { game, mission, data }. Inside update(), call
//   ctx.mission.setObjective(text, marker?)  — marker is {x, y} or null
//   ctx.mission.complete()                   — pays the reward, autosaves
//   ctx.mission.fail(reason)                 — shows the fail banner, restarts the mission
// The system tracks progress (completedIds) and exposes the current
// objective line + map marker for the HUD. Free roam is mission 'freeroam',
// a placeholder objective that runs until the first story mission starts.
export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.defs = new Map();
    this.current = null;   // { id, def, data, objective, marker, startedAt }
    this.completedIds = [];
    this.define('freeroam', {
      name: 'Free Roam',
      briefing: 'Solmar Bay is yours. Find Vera at the Hideout when you are ready for work.',
      reward: 0,
      start(ctx) {
        const hide = ctx.game.city.landmark('hideout');
        ctx.mission.setObjective('Explore Solmar Bay — find Vera at the Hideout', { x: hide.x, y: hide.y, label: 'Vera' });
      },
      update() { /* free roam never completes on its own */ },
    });
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
    this.game.hud.banner(def.name.toUpperCase(), def.briefing);
    this.game.sfx.jingle();
    def.start({ game: this.game, mission, data: mission.data });
    return mission;
  }
  complete() {
    // Clear state BEFORE any effect runs: a mission must never pay twice.
    const mission = this.current;
    if (!mission) return;
    this.current = null;
    this.completedIds.push(mission.id);
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
    this.game.hud.banner('MISSION FAILED', reason || mission.def.name);
    this.game.sfx.fail();
    this.start('freeroam');
  }
  update(dt) {
    if (!this.current) return;
    const mission = this.current;
    mission.def.update(dt, { game: this.game, mission, data: mission.data });
  }
  objectiveText() { return this.current ? this.current.objective : ''; }
  marker() { return this.current ? this.current.marker : null; }
  missionName() { return this.current ? this.current.def.name : 'Free Roam'; }
}
