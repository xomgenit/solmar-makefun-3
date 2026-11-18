// The wanted system: stars 0-5, foot officers on foot, cruiser pursuit in
// a car, heat that cools when the player stays unseen, busted/wasted hooks.
import { makeCop } from './people.js';
import { makeCar, driveCar, steerToward } from './vehicles.js';
import { dist, clamp } from './rng.js';

export class Police {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.stars = 0;
    this.cops = [];      // foot officers
    this.cruisers = [];  // police cars
    this.coolT = 0;      // time unseen
    this.spawnT = 0;
    this.seen = false;
  }
  raise(n, reason) {
    if (n <= 0) return;
    this.stars = clamp(this.stars + n, 0, 5);
    this.coolT = 0;
  }
  clear() { this.stars = 0; this.cops = []; this.cruisers = []; this.coolT = 0; }
  // Is any officer close enough to see the player?
  updateSeen(px, py) {
    this.seen = false;
    for (const c of this.cops) if (c.alive && dist(c.x, c.y, px, py) < 480) this.seen = true;
    for (const c of this.cruisers) if (!c.wrecked && dist(c.x, c.y, px, py) < 520) this.seen = true;
  }
  wantedCount() {
    // How many units the current wanted level calls for.
    return this.stars === 0 ? 0 : this.stars + 1;
  }
  update(dt, game) {
    const p = game.player;
    this.updateSeen(p.x, p.y);
    if (this.stars > 0) {
      if (!this.seen) {
        this.coolT += dt;
        if (this.coolT > 8) { this.stars = Math.max(0, this.stars - 1); this.coolT = 0; game.hud.flashHint('Heat is cooling off…'); }
      } else this.coolT = 0;
    }
    // Spawn units up to the wanted count, near the player but off-screen.
    this.spawnT -= dt;
    const want = this.wantedCount();
    const have = this.cops.filter((c) => c.alive).length + this.cruisers.filter((c) => !c.wrecked).length;
    if (this.stars > 0 && have < want && this.spawnT <= 0) {
      this.spawnT = 1.2;
      const spot = this.city.randomRoadPoint(this.rng, p.x, p.y, 550, 850);
      if (game.inCar) {
        const cruiser = makeCar('cruiser', spot.x, spot.y, 0);
        cruiser.driver = 'police';
        this.cruisers.push(cruiser);
      } else {
        this.cops.push(makeCop(spot.x, spot.y));
      }
    }
    // Foot cops: run at the player, shoot in range, arrest up close.
    for (const cop of this.cops) {
      if (!cop.alive) continue;
      const d = dist(cop.x, cop.y, p.x, p.y);
      cop.angle = Math.atan2(p.y - cop.y, p.x - cop.x);
      if (d > 34) {
        const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
        const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
        const f = this.city.resolveCircle(nx, ny, 10);
        cop.x = f.x; cop.y = f.y;
        cop.walkPhase += dt * 10;
        cop.arrestT = 0;
      } else if (!game.inCar) {
        cop.arrestT += dt;
        if (cop.arrestT > 1.2) game.busted();
      }
      cop.shootT -= dt;
      if (cop.shootT <= 0 && d < 300 && d > 30 && !game.inCar) {
        cop.shootT = 0.9 + this.rng.next() * 0.5;
        game.combat.enemyShot(cop, p.x, p.y, 8 + this.stars * 2);
      } else if (cop.shootT <= 0 && d < 300 && game.inCar) {
        cop.shootT = 1.4;
        game.combat.enemyShot(cop, p.x, p.y, 5);
      }
    }
    // Cruisers: pursue on roads, ram the player's car, give up when wrecked.
    for (const cr of this.cruisers) {
      if (cr.wrecked) { driveCar(cr, dt, 0, 0, 0, false, this.city); continue; }
      // If the player is on foot, cruisers park nearby and their officer gets out.
      if (!game.inCar && dist(cr.x, cr.y, p.x, p.y) < 160) {
        const cop = makeCop(cr.x + 20, cr.y);
        this.cops.push(cop);
        cr.wrecked = true; cr.health = 0; // parked, out of the chase
        continue;
      }
      const d = dist(cr.x, cr.y, p.x, p.y);
      let cmd;
      if (cr.reverseT > 0) {
        cr.reverseT -= dt;
        cmd = { steer: -0.6, throttle: 0, brake: 1 };
      } else if (cr.stuckT > 1.4) {
        cr.reverseT = 0.9; cr.stuckT = 0;
        cmd = { steer: 0.6, throttle: 0, brake: 1 };
      } else {
        // Aim slightly ahead of the player to intercept.
        const lead = clamp(d / 300, 0, 1) * 0.6;
        const tx = p.x + (game.playerCar ? game.playerCar.vx * lead : 0);
        const ty = p.y + (game.playerCar ? game.playerCar.vy * lead : 0);
        cmd = steerToward(cr, tx, ty);
      }
      driveCar(cr, dt, cmd.steer, cmd.throttle, cmd.brake, false, this.city);
      // Ram: contact damage to the player's car.
      if (game.playerCar && dist(cr.x, cr.y, game.playerCar.x, game.playerCar.y) < 46) {
        const rel = Math.abs(cr.speed - game.playerCar.speed);
        if (rel > 60) game.damagePlayerCar(rel * 0.05);
      }
    }
    // Cull the dead and the far-away.
    this.cops = this.cops.filter((c) => c.alive || c.downT < 8);
    this.cruisers = this.cruisers.filter((c) => dist(c.x, c.y, p.x, p.y) < 1800);
    if (this.stars === 0) { this.cops = this.cops.filter((c) => !c.alive); this.cruisers = []; }
  }
}
