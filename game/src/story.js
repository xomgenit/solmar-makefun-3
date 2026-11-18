// Story missions for Vera + hidden cash stashes.
//
// Registered on the MissionSystem by defineStoryMissions(system); every
// fresh MissionSystem (each newGame) gets them. Missions unlock one at a
// time in STORY_ORDER: returning to Vera at the Hideout starts the next
// one (the freeroam hook in missions.js handles that). Rewards pay exactly
// once — MissionSystem.complete() clears state before paying.
import { dist } from './rng.js';
import { makeCar } from './vehicles.js';
import { BEACH_X, WORLD_H } from './city.js';

export const STORY_ORDER = ['first-wheels', 'the-pickup', 'hot-delivery', 'payback-pier', 'solmar-score'];
export const STASH_REWARD = 300;

export function nextStoryId(missions) {
  return STORY_ORDER.find((id) => !missions.completedIds.includes(id)) || null;
}

// Three hidden stashes, anchored to landmarks so they exist on any seed.
// resolveCircle pushes each out of any building it landed inside.
export function makeStashes(game) {
  const spots = [
    ['diner', 150, 70],
    ['pier', -150, 110],
    ['docks', 150, -90],
  ];
  return spots.map(([lm, dx, dy]) => {
    const p = game.city.landmark(lm);
    const x = Math.min(Math.max(p.x + dx, 60), BEACH_X - 60);
    const y = Math.min(Math.max(p.y + dy, 60), WORLD_H - 60);
    const f = game.city.resolveCircle(x, y, 12);
    return { x: f.x, y: f.y, taken: false };
  });
}

function nearestCar(game) {
  let best = null, bestD = Infinity;
  for (const c of game.allCars()) {
    if (c === game.playerCar || c.wrecked || c.driver === 'police') continue;
    const d = dist(game.player.x, game.player.y, c.x, c.y);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}

function at(game, lm, r) {
  const p = game.city.landmark(lm);
  return dist(game.player.x, game.player.y, p.x, p.y) < r;
}
function markerAt(game, lm, label) {
  const p = game.city.landmark(lm);
  return { x: p.x, y: p.y, label };
}

export function defineStoryMissions(sys) {
  // 1 — Steal any car, bring it to Vera's Garage.
  sys.define('first-wheels', {
    name: 'First Wheels',
    briefing: 'Vera needs wheels. Steal any car and bring it to the Garage.',
    reward: 250,
    start(ctx) {
      const { game, mission, data } = ctx;
      if (game.inCar) {
        data.stage = 2;
        mission.setObjective('Bring the car to the Garage', markerAt(game, 'garage', 'Garage'));
      } else {
        data.stage = 1;
        mission.setObjective('Steal a car for Vera');
      }
    },
    update(dt, ctx) {
      const { game, mission, data } = ctx;
      if (data.stage === 1) {
        if (game.inCar) {
          data.stage = 2;
          game.hud.flashHint('Nice ride — now bring it to the Garage');
          mission.setObjective('Bring the car to the Garage', markerAt(game, 'garage', 'Garage'));
          return;
        }
        const car = nearestCar(game);
        mission.setObjective('Steal a car for Vera', car ? { x: car.x, y: car.y, label: car.name } : null);
      } else {
        if (!game.inCar) {
          data.stage = 1;
          mission.setObjective('Steal a car for Vera');
          return;
        }
        if (at(game, 'garage', 130)) mission.complete();
      }
    },
  });

  // 2 — Grab Vera's package at the Docks (E), deliver it to the Garage.
  sys.define('the-pickup', {
    name: 'The Pickup',
    briefing: 'A package is waiting at the Docks. Grab it and bring it to the Garage.',
    reward: 400,
    start(ctx) {
      const { mission, data } = ctx;
      data.stage = 1;
      mission.setObjective("Pick up Vera's package at the Docks", markerAt(ctx.game, 'docks', 'Docks'));
    },
    onInteract(ctx) {
      const { game, mission, data } = ctx;
      if (data.stage !== 1 || !at(game, 'docks', 100)) return false;
      data.stage = 2;
      game.sfx.pickup();
      game.combat.floater(game.player.x, game.player.y - 30, 'PACKAGE', '#ffd166');
      game.hud.flashHint('Package secured — deliver it to the Garage');
      mission.setObjective('Deliver the package to the Garage', markerAt(game, 'garage', 'Garage'));
      return true;
    },
    update(dt, ctx) {
      const { game, mission, data } = ctx;
      if (data.stage === 1) {
        if (at(game, 'docks', 100)) {
          mission.setObjective('Press E to grab the package', markerAt(game, 'docks', 'Docks'));
        } else {
          mission.setObjective("Pick up Vera's package at the Docks", markerAt(game, 'docks', 'Docks'));
        }
      } else if (at(game, 'garage', 130)) {
        mission.complete();
      }
    },
  });

  // 3 — Timed delivery to the Diner (90s). Unlocks a sports car on success.
  sys.define('hot-delivery', {
    name: 'Hot Delivery',
    briefing: 'Hot food for the Diner — 90 seconds, or it goes cold.',
    reward: 600,
    start(ctx) {
      const { mission, data } = ctx;
      data.timeLeft = 90;
      mission.setObjective('Deliver to the Diner — fast!', markerAt(ctx.game, 'diner', 'Diner'));
    },
    update(dt, ctx) {
      const { game, mission, data } = ctx;
      data.timeLeft -= dt;
      if (data.timeLeft <= 0) {
        mission.fail('Too slow — the delivery went cold');
        return;
      }
      if (at(game, 'diner', 130)) mission.complete();
    },
    onComplete(ctx) {
      const { game } = ctx;
      // Sports-car unlock: a red Comet waits at the Garage from now on.
      const g = game.city.landmark('garage');
      const car = makeCar('sports', g.x, g.y + 90, 0, '#e74c3c');
      game.traffic.parked.push(car);
      game.sportsUnlocked = true;
      game.hud.flashHint('Sports car unlocked — a Comet is waiting at the Garage');
    },
  });

  // 4 — Clear 4 Harbor Kings off Solmar Pier.
  sys.define('payback-pier', {
    name: 'Payback at the Pier',
    briefing: 'Harbor Kings are holding the Pier. Clear them out.',
    reward: 800,
    start(ctx) {
      const { mission, data } = ctx;
      data.stage = 1;
      mission.setObjective('Head to Solmar Pier', markerAt(ctx.game, 'pier', 'Pier'));
    },
    update(dt, ctx) {
      const { game, mission, data } = ctx;
      if (data.stage === 1) {
        if (at(game, 'pier', 280)) {
          const p = game.city.landmark('pier');
          data.squad = game.spawnGangSquad(p.x - 60, p.y + 60, 4);
          data.stage = 2;
          game.hud.flashHint('Harbor Kings! Take them all down.');
          mission.setObjective('Eliminate the Harbor Kings (4 left)', markerAt(game, 'pier', 'Pier'));
        }
        return;
      }
      const left = data.squad.filter((g) => g.alive).length;
      mission.setObjective(`Eliminate the Harbor Kings (${left} left)`, markerAt(game, 'pier', 'Pier'));
      if (left === 0) mission.complete();
    },
  });

  // 5 — Crack the bank vault (8s channel), then escape to the Hideout.
  sys.define('solmar-score', {
    name: 'The Solmar Score',
    briefing: 'The big one: crack the vault at Solmar National Bank, then vanish.',
    reward: 1500,
    start(ctx) {
      const { mission, data } = ctx;
      data.stage = 1;
      data.channel = 0;
      mission.setObjective('Get to Solmar National Bank', markerAt(ctx.game, 'bank', 'Bank'));
    },
    update(dt, ctx) {
      const { game, mission, data } = ctx;
      if (data.stage === 1) {
        if (at(game, 'bank', 130)) {
          data.stage = 2;
          game.hud.flashHint('Crack the vault — stay by the bank door');
          mission.setObjective('Cracking the vault… 8s', markerAt(game, 'bank', 'Bank'));
        }
        return;
      }
      if (data.stage === 2) {
        if (at(game, 'bank', 130)) data.channel += dt;
        const left = Math.max(0, Math.ceil(8 - data.channel));
        mission.setObjective(`Cracking the vault… ${left}s`, markerAt(game, 'bank', 'Bank'));
        if (data.channel >= 8) {
          data.stage = 3;
          game.police.raise(2, 'bank alarm');
          game.hud.flashHint('The vault is open — the alarm is screaming! Get back to Vera.');
          mission.setObjective('Escape to the Hideout', markerAt(game, 'hideout', 'Hideout'));
        }
        return;
      }
      if (at(game, 'hideout', 130)) mission.complete();
    },
  });
}
