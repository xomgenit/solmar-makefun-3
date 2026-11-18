// Vehicles: five civilian models plus the SBPD cruiser, arcade physics,
// car-vs-car and car-vs-building collision, smoke when wrecked.
import { clamp, angleDiff } from './rng.js';
import { SEA_X } from './city.js';

export const MODELS = {
  sedan:   { name: 'Sedan',   w: 46, h: 22, top: 420, accel: 260, brake: 420, grip: 2.6, colors: ['#c0392b', '#2c3e50', '#bdc3c7', '#7f8c8d'] },
  sports:  { name: 'Sports',  w: 48, h: 22, top: 560, accel: 340, brake: 460, grip: 3.1, colors: ['#e74c3c', '#f1c40f', '#2980b9', '#e67e22'] },
  taxi:    { name: 'Taxi',    w: 46, h: 22, top: 400, accel: 250, brake: 420, grip: 2.6, colors: ['#f7dc6f'] },
  van:     { name: 'Van',     w: 52, h: 24, top: 340, accel: 200, brake: 380, grip: 2.2, colors: ['#ecf0f1', '#95a5a6', '#5d6d7e'] },
  pickup:  { name: 'Pickup',  w: 50, h: 23, top: 380, accel: 230, brake: 400, grip: 2.4, colors: ['#1e8449', '#6e2c00', '#2e4053'] },
  cruiser: { name: 'Cruiser', w: 48, h: 22, top: 500, accel: 320, brake: 480, grip: 3.0, colors: ['#1a5276'] },
};

let nextId = 1;
export function makeCar(model, x, y, angle = 0, color = null) {
  const m = MODELS[model];
  return {
    id: nextId++, model, name: m.name, x, y, angle,
    w: m.w, h: m.h, top: m.top, accel: m.accel, brake: m.brake, grip: m.grip,
    color: color || m.colors[Math.floor(Math.random() * m.colors.length)],
    speed: 0, health: 100, wrecked: false, smoke: 0,
    driver: null, // 'player' | 'traffic' | 'police' | null (parked)
    siren: model === 'cruiser',
    flash: 0, stuckT: 0, reverseT: 0,
    vx: 0, vy: 0,
  };
}

// Arcade drive step. steer in [-1, 1], throttle 0..1, brake 0..1, handbrake bool.
export function driveCar(car, dt, steer, throttle, brake, handbrake, city) {
  if (car.wrecked) { car.speed *= Math.max(0, 1 - 2 * dt); }
  else if (throttle > 0) car.speed += car.accel * throttle * dt;
  else if (brake > 0) {
    if (car.speed > 5) car.speed -= car.brake * brake * dt;
    else car.speed = Math.max(-120, car.speed - car.accel * 0.6 * brake * dt);
  } else {
    car.speed -= car.speed * 0.6 * dt;
    if (Math.abs(car.speed) < 2) car.speed = 0;
  }
  car.speed = clamp(car.speed, -140, car.top);
  const grip = handbrake ? car.grip * 0.45 : car.grip;
  const spdF = clamp(Math.abs(car.speed) / 220, 0, 1);
  car.angle += steer * grip * spdF * dt * (car.speed < 0 ? -1 : 1);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  // Building collision: slide along walls, lose speed and health on hard hits.
  const before = { x: car.x, y: car.y };
  const r = Math.max(car.w, car.h) * 0.42;
  const fixed = city.resolveCircle(nx, ny, r);
  let hit = Math.abs(fixed.x - nx) > 0.5 || Math.abs(fixed.y - ny) > 0.5;
  car.x = fixed.x; car.y = fixed.y;
  // Cars cannot drive into the sea.
  if (car.x > SEA_X - r) { car.x = SEA_X - r; hit = true; car.speed *= 0.5; }
  if (hit) {
    const impact = Math.abs(car.speed);
    car.speed *= 0.35;
    if (impact > 180) { damageCar(car, (impact - 180) * 0.06); car.crashed = true; }
  } else car.crashed = false;
  car.vx = (car.x - before.x) / Math.max(dt, 0.001);
  car.vy = (car.y - before.y) / Math.max(dt, 0.001);
  // Stuck detection (used by police AI to reverse out).
  if (Math.abs(car.speed) < 20 && throttle > 0) car.stuckT += dt; else car.stuckT = 0;
  if (car.health < 35) car.smoke = Math.min(1, car.smoke + dt * 0.5);
}

export function damageCar(car, amount) {
  if (car.wrecked) return;
  car.health -= amount;
  if (car.health <= 0) { car.health = 0; car.wrecked = true; car.speed = 0; }
}

// Soft circle push between two cars; returns impact speed for crash effects.
export function collideCars(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ra = Math.max(a.w, a.h) * 0.42, rb = Math.max(b.w, b.h) * 0.42;
  const d = Math.hypot(dx, dy), min = ra + rb;
  if (d >= min || d < 0.001) return 0;
  const push = (min - d) / 2, ux = dx / d, uy = dy / d;
  a.x -= ux * push; a.y -= uy * push;
  b.x += ux * push; b.y += uy * push;
  const rel = Math.abs(a.speed - b.speed) + Math.abs(a.vx - b.vx) * 0.2;
  const exchange = (a.speed + b.speed) * 0.5;
  a.speed = exchange * 0.6; b.speed = exchange * 0.6;
  if (rel > 150) { damageCar(a, (rel - 150) * 0.05); damageCar(b, (rel - 150) * 0.05); }
  return rel;
}

export function drawCar(ctx, car, t) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const w = car.w, h = car.h;
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
  // Body.
  ctx.fillStyle = car.wrecked ? '#3a3a3a' : car.color;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  // Cabin + windshield.
  ctx.fillStyle = car.wrecked ? '#222' : '#aed6f1';
  ctx.beginPath();
  ctx.roundRect(-w * 0.18, -h * 0.36, w * 0.36, h * 0.72, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,30,40,0.85)';
  ctx.fillRect(w * 0.28, -h * 0.38, 3, h * 0.76);
  // Headlights / taillights.
  ctx.fillStyle = '#fef9e7';
  ctx.fillRect(w / 2 - 3, -h / 2 + 2, 3, 5);
  ctx.fillRect(w / 2 - 3, h / 2 - 7, 3, 5);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(-w / 2, -h / 2 + 2, 3, 5);
  ctx.fillRect(-w / 2, h / 2 - 7, 3, 5);
  if (car.model === 'taxi') {
    ctx.fillStyle = '#f7dc6f';
    ctx.fillRect(-4, -h / 2 - 5, 8, 4);
    ctx.fillStyle = '#222'; ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, -h / 2 - 1);
  }
  if (car.model === 'cruiser') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-w * 0.05, -h / 2 + 1, w * 0.3, h - 2);
    ctx.fillStyle = '#222'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SBPD', w * 0.1, 2.5);
    // Flashing light bar.
    const phase = Math.floor(t * 6) % 2 === 0;
    ctx.fillStyle = phase ? '#ff2e2e' : '#2e7bff';
    ctx.fillRect(-w * 0.28, -h / 2 - 3, 7, 4);
    ctx.fillStyle = phase ? '#2e7bff' : '#ff2e2e';
    ctx.fillRect(-w * 0.28 + 9, -h / 2 - 3, 7, 4);
  }
  ctx.restore();
  // Smoke when damaged.
  if (car.smoke > 0.05) {
    ctx.fillStyle = `rgba(60,60,60,${0.25 + car.smoke * 0.4})`;
    const sx = car.x + Math.cos(car.angle) * car.w * 0.4 + (Math.random() - 0.5) * 8;
    const sy = car.y + Math.sin(car.angle) * car.w * 0.4 + (Math.random() - 0.5) * 8;
    ctx.beginPath(); ctx.arc(sx, sy, 5 + car.smoke * 7, 0, Math.PI * 2); ctx.fill();
  }
}

// Steer a car toward a point (used by police pursuit). Returns {steer, throttle, brake}.
export function steerToward(car, tx, ty) {
  const want = Math.atan2(ty - car.y, tx - car.x);
  const diff = angleDiff(car.angle, want);
  const steer = clamp(diff * 2.2, -1, 1);
  const throttle = Math.abs(diff) > 1.9 ? 0 : 1;
  const brake = Math.abs(diff) > 1.9 ? 1 : 0;
  return { steer, throttle, brake };
}
