// Hitscan combat: player shooting with tracers and muzzle particles,
// enemy shots, damage to people and cars, floating damage numbers.
import { dist, clamp } from './rng.js';
import { damageCar } from './vehicles.js';

export class Combat {
  constructor(game) {
    this.game = game;
    this.tracers = [];   // {x1,y1,x2,y2,t,enemy}
    this.particles = []; // {x,y,vx,vy,t,life,color,size}
    this.floaters = [];  // {x,y,text,t,color}
    this.fireT = 0;
  }
  update(dt) {
    this.fireT -= dt;
    for (const tr of this.tracers) tr.t -= dt;
    this.tracers = this.tracers.filter((t) => t.t > 0);
    for (const pt of this.particles) {
      pt.t += dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.92; pt.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const f of this.floaters) { f.t += dt; f.y -= 22 * dt; }
    this.floaters = this.floaters.filter((f) => f.t < 1.1);
  }
  burst(x, y, color, n = 8, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.35 + Math.random() * 0.3, color, size: 2 + Math.random() * 2 });
    }
  }
  floater(x, y, text, color = '#ffd166') {
    this.floaters.push({ x, y, text, t: 0, color });
  }
  // Player fires toward a world point. Returns true if a shot went off.
  playerShot(tx, ty) {
    if (this.fireT > 0) return false;
    this.fireT = 0.13;
    const g = this.game, p = g.player;
    const ang = Math.atan2(ty - p.y, tx - p.x);
    const range = 520;
    const ex = p.x + Math.cos(ang) * range, ey = p.y + Math.sin(ang) * range;
    let hitX = ex, hitY = ey, hitD = range;
    // Buildings block the shot.
    const b = g.city.buildingAt(ex, ey);
    // March along the ray for the first building or person.
    const steps = 26;
    for (let i = 1; i <= steps; i++) {
      const mx = p.x + Math.cos(ang) * (range * i / steps);
      const my = p.y + Math.sin(ang) * (range * i / steps);
      if (g.city.buildingAt(mx, my)) { hitX = mx; hitY = my; hitD = range * i / steps; break; }
    }
    // Hit the nearest person within 14px of the ray.
    let victim = null, victimD = hitD;
    const targets = [...g.peds, ...g.police.cops, ...g.gang];
    for (const t of targets) {
      if (!t.alive) continue;
      const dx = t.x - p.x, dy = t.y - p.y;
      const along = dx * Math.cos(ang) + dy * Math.sin(ang);
      if (along < 0 || along > hitD) continue;
      const perp = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang));
      if (perp < 15 && along < victimD) { victim = t; victimD = along; }
    }
    // Or the nearest car.
    let carHit = null;
    for (const c of g.allCars()) {
      if (c === g.playerCar) continue;
      const dx = c.x - p.x, dy = c.y - p.y;
      const along = dx * Math.cos(ang) + dy * Math.sin(ang);
      if (along < 0 || along > hitD) continue;
      const perp = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang));
      if (perp < 20 && along < victimD) { carHit = c; victimD = along; victim = null; }
    }
    hitX = p.x + Math.cos(ang) * victimD;
    hitY = p.y + Math.sin(ang) * victimD;
    this.tracers.push({ x1: p.x, y1: p.y, x2: hitX, y2: hitY, t: 0.09, enemy: false });
    g.sfx.shot();
    this.burst(hitX, hitY, victim ? '#e74c3c' : '#f9e79f', victim ? 10 : 5, 140);
    if (victim) {
      victim.health -= 25;
      this.floater(victim.x, victim.y - 18, '-25', '#ff6b6b');
      if (victim.health <= 0 && victim.alive) {
        victim.alive = false; victim.downT = 0;
        g.onPersonKilled(victim);
      } else if (victim.kind === 'ped') {
        victim.fleeT = 4;
        g.scarePeds(victim.x, victim.y, 260);
      }
    } else if (carHit) {
      damageCar(carHit, 18);
      if (carHit.driver === 'police') g.police.raise(1, 'shot cruiser');
    } else if (b) {
      // Shot a wall: nothing more.
    }
    // Firing in public draws attention.
    if (g.police.seen) g.police.raise(0, '');
    return true;
  }
  // An enemy shoots at the player. Damage applies unless the player dodges by range.
  enemyShot(shooter, tx, ty, damage) {
    const g = this.game;
    this.tracers.push({ x1: shooter.x, y1: shooter.y, x2: tx, y2: ty, t: 0.09, enemy: true });
    g.sfx.shot();
    const d = dist(shooter.x, shooter.y, tx, ty);
    const hitChance = clamp(0.75 - d / 600, 0.25, 0.75);
    if (Math.random() < hitChance) {
      if (g.inCar && g.playerCar) g.damagePlayerCar(damage * 0.6);
      else g.damagePlayer(damage);
      this.burst(tx, ty, '#ff6b6b', 6, 120);
    } else {
      this.burst(tx + (Math.random() - 0.5) * 30, ty + (Math.random() - 0.5) * 30, '#f9e79f', 4, 100);
    }
  }
  draw(ctx) {
    for (const tr of this.tracers) {
      ctx.strokeStyle = tr.enemy ? 'rgba(255,80,80,0.85)' : 'rgba(255,240,150,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tr.x1, tr.y1); ctx.lineTo(tr.x2, tr.y2); ctx.stroke();
    }
    for (const pt of this.particles) {
      ctx.globalAlpha = 1 - pt.t / pt.life;
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      ctx.globalAlpha = 1 - f.t / 1.1;
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }
}
