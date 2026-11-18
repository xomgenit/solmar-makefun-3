// Ambient traffic: cars that follow road lanes, turn at intersections,
// slow for the car ahead, and respawn near the player when they drift off.
import { makeCar, driveCar, MODELS, collideCars } from './vehicles.js';
import { V_ROADS, H_ROADS, WORLD_W, WORLD_H } from './city.js';
import { makeRng, dist } from './rng.js';

const CIV_MODELS = ['sedan', 'sports', 'taxi', 'van', 'pickup'];

export class Traffic {
  constructor(city, seed) {
    this.city = city;
    this.rng = makeRng(seed ^ 0x9e3779b9);
    this.cars = [];
    this.parked = [];
  }
  // Seed the world: parked cars along roads + moving traffic.
  populate(px, py) {
    for (let i = 0; i < 26; i++) {
      const p = this.city.randomRoadPoint(this.rng, px, py, 120, 2200);
      const angle = p.vertical ? (this.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2)
        : (this.rng.chance(0.5) ? 0 : Math.PI);
      const car = makeCar(this.rng.pick(CIV_MODELS), p.x + (p.vertical ? 46 : 0), p.y + (p.vertical ? 0 : 46), angle);
      car.driver = null; // parked
      this.parked.push(car);
    }
    for (let i = 0; i < 14; i++) this.spawnTraffic(px, py, 200, 1400);
  }
  spawnTraffic(px, py, minD, maxD) {
    const p = this.city.randomRoadPoint(this.rng, px, py, minD, maxD);
    const vertical = p.vertical;
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const angle = vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    // Right-hand lane offset.
    const lx = vertical ? p.x + (dir > 0 ? -18 : 18) : p.x;
    const ly = vertical ? p.y : p.y + (dir > 0 ? 18 : -18);
    const car = makeCar(this.rng.pick(CIV_MODELS), lx, ly, angle);
    car.driver = 'traffic';
    car.cruise = this.rng.range(120, 190);
    car.vertical = vertical;
    car.dir = dir;
    car.road = vertical ? p.x : p.y;
    this.cars.push(car);
    return car;
  }
  allCars() { return [...this.cars, ...this.parked]; }
  update(dt, player, others) {
    const px = player.x, py = player.y;
    for (const car of this.cars) {
      if (car.wrecked) { driveCar(car, dt, 0, 0, 0, false, this.city); continue; }
      // Follow the lane: steer gently back to the road line.
      const lane = car.vertical ? car.road + (car.dir > 0 ? -18 : 18) : car.road + (car.dir > 0 ? 18 : -18);
      const off = car.vertical ? car.x - lane : car.y - lane;
      const wantAngle = car.vertical ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
      let steer = -off * 0.004;
      // At an intersection, sometimes turn onto the crossing road.
      const nearCross = car.vertical
        ? H_ROADS.some((ry) => Math.abs(car.y - ry) < 14)
        : V_ROADS.some((rx) => Math.abs(car.x - rx) < 14);
      if (nearCross && this.rng.chance(0.02)) {
        car.vertical = !car.vertical;
        car.dir = this.rng.chance(0.5) ? 1 : -1;
        car.road = car.vertical ? V_ROADS.reduce((a, b) => Math.abs(b - car.x) < Math.abs(a - car.x) ? b : a)
          : H_ROADS.reduce((a, b) => Math.abs(b - car.y) < Math.abs(a - car.y) ? b : a);
      }
      // Slow for the car ahead.
      let throttle = 0.7;
      const aheadX = car.x + Math.cos(car.angle) * 70, aheadY = car.y + Math.sin(car.angle) * 70;
      for (const o of others) {
        if (o === car) continue;
        if (dist(aheadX, aheadY, o.x, o.y) < 42) { throttle = 0; break; }
      }
      if (car.speed > car.cruise) throttle = 0;
      // Steer toward the desired heading plus lane correction.
      let dA = wantAngle - car.angle;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      steer += dA * 1.5;
      steer = Math.max(-1, Math.min(1, steer));
      driveCar(car, dt, steer, throttle, 0, false, this.city);
      // Respawn far-away cars near the player.
      if (dist(car.x, car.y, px, py) > 1600) {
        const p = this.city.randomRoadPoint(this.rng, px, py, 700, 1300);
        const v = p.vertical, d = this.rng.chance(0.5) ? 1 : -1;
        car.x = v ? p.x + (d > 0 ? -18 : 18) : p.x;
        car.y = v ? p.y : p.y + (d > 0 ? 18 : -18);
        car.vertical = v; car.dir = d; car.road = v ? p.x : p.y;
        car.angle = v ? (d > 0 ? Math.PI / 2 : -Math.PI / 2) : (d > 0 ? 0 : Math.PI);
        car.speed = car.cruise * 0.6;
        car.health = 100; car.wrecked = false;
      }
    }
    // Car-car collisions among traffic + others.
    const all = [...this.cars, ...others];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].driver === null && all[j].driver === null) continue;
        collideCars(all[i], all[j]);
      }
    }
  }
}
