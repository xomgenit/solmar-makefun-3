// On-foot characters: pedestrians who stroll the sidewalks and flee from
// danger, and SBPD foot officers who chase and shoot.
import { makeRng, clamp, dist } from './rng.js';

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];

let nextId = 1;
export function makePed(x, y, rng) {
  return {
    id: nextId++, kind: 'ped', x, y, angle: rng.range(0, Math.PI * 2),
    speed: rng.range(28, 46), health: 100, alive: true,
    skin: rng.pick(SKINS), shirt: rng.pick(SHIRTS),
    target: null, fleeT: 0, downT: 0, walkPhase: rng.range(0, 6),
  };
}

export function makeCop(x, y) {
  return {
    id: nextId++, kind: 'cop', x, y, angle: 0,
    speed: 165, health: 50, alive: true,
    skin: '#e0ac69', shirt: '#1a5276',
    target: null, fleeT: 0, downT: 0, walkPhase: 0,
    shootT: 0.5, arrestT: 0,
  };
}

export function makeGang(x, y, rng) {
  const g = makePed(x, y, rng);
  g.kind = 'gang'; g.health = 60; g.shirt = '#8e1b1b'; g.speed = 120;
  g.shootT = rng.range(0.4, 1.2);
  return g;
}

function pickStrollTarget(p, city, rng) {
  // Walk along a nearby road, staying on the sidewalk edge.
  const p2 = city.randomRoadPoint(rng, p.x, p.y, 60, 500);
  const off = 52;
  return { x: p2.x + (p2.vertical ? off : 0), y: p2.y + (p2.vertical ? 0 : off) };
}

export function updatePed(p, dt, city, rng, danger) {
  if (!p.alive) { p.downT += dt; return; }
  if (p.fleeT > 0) {
    p.fleeT -= dt;
    const a = Math.atan2(p.y - danger.y, p.x - danger.x);
    p.angle = a;
    const nx = p.x + Math.cos(a) * p.speed * 2.2 * dt;
    const ny = p.y + Math.sin(a) * p.speed * 2.2 * dt;
    const f = city.resolveCircle(nx, ny, 10);
    p.x = f.x; p.y = f.y;
    p.walkPhase += dt * 12;
    return;
  }
  if (!p.target || dist(p.x, p.y, p.target.x, p.target.y) < 12) {
    p.target = pickStrollTarget(p, city, rng);
  }
  const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
  p.angle = a;
  const nx = p.x + Math.cos(a) * p.speed * dt;
  const ny = p.y + Math.sin(a) * p.speed * dt;
  const f = city.resolveCircle(nx, ny, 10);
  p.x = f.x; p.y = f.y;
  p.walkPhase += dt * 6;
}

export function drawPerson(ctx, p, t) {
  if (!p.alive) {
    // Fallen body.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 14, 8, p.angle, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.shirt;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 11, 6, p.angle, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const bob = Math.sin(p.walkPhase) * 1.5;
  ctx.save();
  ctx.translate(p.x, p.y + bob * 0.3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(1, 3, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Body (top-down: shoulders + head).
  ctx.fillStyle = p.shirt;
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(Math.cos(p.angle) * 2, Math.sin(p.angle) * 2, 5.5, 0, Math.PI * 2); ctx.fill();
  // Facing nub (gun for armed kinds).
  if (p.kind === 'cop' || p.kind === 'gang') {
    ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(p.angle) * 6, Math.sin(p.angle) * 6);
    ctx.lineTo(Math.cos(p.angle) * 16, Math.sin(p.angle) * 16);
    ctx.stroke();
  }
  if (p.kind === 'cop') {
    ctx.fillStyle = '#154360';
    ctx.beginPath(); ctx.arc(0, -1, 6.5, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(-1.5, -8, 3, 3);
  }
  ctx.restore();
  // Health bar for armed enemies.
  if ((p.kind === 'cop' || p.kind === 'gang') && p.health < (p.kind === 'cop' ? 50 : 60)) {
    const max = p.kind === 'cop' ? 50 : 60;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(p.x - 14, p.y - 22, 28, 5);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(p.x - 13, p.y - 21, 26 * clamp(p.health / max, 0, 1), 3);
  }
}

export { makeRng };
