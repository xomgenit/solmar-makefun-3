// SOLMAR — Streets of the Sun: the game itself. Owns the state machine
// (title / playing / paused / wasted / busted), the player, the camera,
// stealing, respray, damage, rendering, menus and saving.
import { buildCity, zoneAt, WORLD_W, WORLD_H, V_ROADS, H_ROADS, ROAD_W, BEACH_X, SEA_X } from './city.js';
import { makeRng, clamp, dist, angleDiff } from './rng.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { MissionSystem } from './missions.js';
import { Hud } from './hud.js';
import { makePed, makeGang, updatePed, drawPerson } from './people.js';
import { makeCar, driveCar, drawCar, collideCars, damageCar } from './vehicles.js';
import { hasSave, writeSave, readSave, clearSave } from './save.js';

export const RESPAWN_COST = 150; // respray price at Sunset Auto Spa

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.hud = new Hud();
    this.state = 'title'; // title | howto | playing | paused | wasted | busted
    this.prevState = 'title';
    this.time = 0;
    this.camX = 0; this.camY = 0;
    this.menuButtons = [];
    this.titlePan = 0;
    this.stats = { playTime: 0, carsStolen: 0, missionsDone: 0, cashEarned: 0, copsDown: 0 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // A throwaway city so the title screen has something to pan over.
    this.city = buildCity(7);
    this.rng = makeRng(7);
    this.player = { x: 420, y: 300, angle: 0 };
    this.health = 100; this.cash = 50;
    this.inCar = false; this.playerCar = null;
    this.peds = []; this.gang = [];
    this.traffic = new Traffic(this.city, 7);
    this.police = new Police(this.city, this.rng);
    this.combat = new Combat(this);
    this.missions = new MissionSystem(this);
    this.lastDamageT = -99;
    this.seed = 7;
  }
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.W = this.canvas.width; this.H = this.canvas.height;
  }
  get W2() { return this.W; }

  // ---------- lifecycle ----------
  newGame(seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.city = buildCity(seed);
    this.traffic = new Traffic(this.city, seed);
    this.police = new Police(this.city, this.rng);
    this.combat = new Combat(this);
    this.missions = new MissionSystem(this);
    this.hud = new Hud();
    const hide = this.city.landmark('hideout');
    this.player = { x: hide.x, y: hide.y + 90, angle: -Math.PI / 2 };
    this.health = 100; this.cash = 50;
    this.inCar = false; this.playerCar = null;
    this.peds = []; this.gang = [];
    this.stats = { playTime: 0, carsStolen: 0, missionsDone: 0, cashEarned: 0, copsDown: 0 };
    this.traffic.populate(this.player.x, this.player.y);
    for (let i = 0; i < 26; i++) {
      const p = this.city.randomRoadPoint(this.rng, this.player.x, this.player.y, 150, 1800);
      this.peds.push(makePed(p.x, p.y, this.rng));
    }
    this.state = 'playing';
    this.missions.start('freeroam');
    this.sfx.ensure();
  }
  loadGame() {
    const s = readSave();
    if (!s) return false;
    this.newGame(s.seed);
    this.cash = s.cash ?? 50;
    this.health = s.health ?? 100;
    this.player.x = s.px ?? 420; this.player.y = s.py ?? 390;
    if (s.missions) this.missions.completedIds = [...s.missions];
    if (s.stats) this.stats = { ...this.stats, ...s.stats };
    if (s.missionId && s.missionId !== 'freeroam' && this.missions.defs.has(s.missionId)) {
      this.missions.start(s.missionId);
    }
    this.hud.flashHint('Welcome back to Solmar Bay');
    return true;
  }
  saveGame() {
    const ok = writeSave({
      seed: this.seed, cash: this.cash, health: this.health,
      px: this.player.x, py: this.player.y,
      missionId: this.missions.current ? this.missions.current.id : 'freeroam',
      missions: this.missions.completedIds, stats: this.stats,
    });
    this.hud.flashHint(ok ? 'Game saved' : 'Save failed');
    return ok;
  }
  autosave() { this.saveGame(); }

  addCash(n) { this.cash += n; if (n > 0) this.stats.cashEarned += n; }

  // ---------- player state ----------
  allCars() {
    const list = [...this.traffic.cars, ...this.traffic.parked, ...this.police.cruisers];
    if (this.playerCar) list.push(this.playerCar);
    return list;
  }
  damagePlayer(amount) {
    if (this.state !== 'playing') return;
    this.health -= amount;
    this.lastDamageT = this.time;
    if (this.health <= 0) { this.health = 0; this.wasted(); }
  }
  damagePlayerCar(amount) {
    if (!this.playerCar) return;
    damageCar(this.playerCar, amount);
    this.sfx.crash();
    if (this.playerCar.wrecked) {
      // Wrecked under the player: bail out, singed.
      this.exitCar();
      this.damagePlayer(12);
      this.hud.flashHint('Your car is wrecked!');
    }
  }
  wasted() {
    this.state = 'wasted';
    this.sfx.fail();
    const lost = Math.floor(this.cash * 0.1);
    this.cash -= lost;
    this.police.clear();
  }
  busted() {
    if (this.state !== 'playing') return;
    this.state = 'busted';
    this.sfx.fail();
    const lost = Math.floor(this.cash * 0.1);
    this.cash -= lost;
    if (this.inCar) this.exitCar();
    this.police.clear();
  }
  respawn(kind) {
    const lm = this.city.landmark(kind === 'wasted' ? 'hospital' : 'sbpd');
    this.player.x = lm.x; this.player.y = lm.y + 100;
    this.health = 100;
    this.state = 'playing';
    this.hud.banner(kind === 'wasted' ? 'PATCHED UP' : 'RELEASED', kind === 'wasted' ? 'Solmar General put you back together' : 'SBPD let you walk — this time');
  }
  onPersonKilled(victim) {
    if (victim.kind === 'cop') {
      this.stats.copsDown++;
      this.police.raise(1, 'killed officer');
      this.hud.flashHint('You killed an officer — heat is up!');
    } else if (victim.kind === 'ped') {
      if (this.police.seen) this.police.raise(2, 'killed civilian');
      this.scarePeds(victim.x, victim.y, 320);
    }
    // Gang kills are counted by the mission that spawned them.
  }
  scarePeds(x, y, r) {
    for (const p of this.peds) {
      if (p.alive && dist(p.x, p.y, x, y) < r) p.fleeT = 4;
    }
  }
  spawnGangSquad(x, y, n) {
    // Builder 2 helper: Harbor Kings who hunt the player.
    const squad = [];
    for (let i = 0; i < n; i++) {
      const g = makeGang(x + (i - n / 2) * 36, y + (i % 2) * 30, this.rng);
      this.gang.push(g);
      squad.push(g);
    }
    return squad;
  }

  // ---------- stealing / respray ----------
  nearestStealable() {
    let best = null, bestD = 64;
    for (const c of this.allCars()) {
      if (c === this.playerCar || c.wrecked) continue;
      if (c.driver === 'police') continue;
      const d = dist(this.player.x, this.player.y, c.x, c.y);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }
  stealCar(car) {
    // Pull it out of whatever list holds it.
    const pull = (arr) => { const i = arr.indexOf(car); if (i >= 0) arr.splice(i, 1); };
    pull(this.traffic.cars); pull(this.traffic.parked);
    car.driver = 'player';
    this.playerCar = car;
    this.inCar = true;
    this.player.x = car.x; this.player.y = car.y;
    this.stats.carsStolen++;
    this.sfx.horn();
    if (this.police.seen) {
      this.police.raise(1, 'stolen in view');
      this.hud.flashHint('Seen stealing that car — 1 star!');
    } else {
      this.hud.flashHint(`Stole a ${car.name} — nice ride`);
    }
  }
  exitCar() {
    if (!this.playerCar) return;
    const car = this.playerCar;
    car.driver = null;
    car.speed = 0;
    this.player.x = car.x - Math.sin(car.angle) * 30;
    this.player.y = car.y + Math.cos(car.angle) * 30;
    const f = this.city.resolveCircle(this.player.x, this.player.y, 10);
    this.player.x = f.x; this.player.y = f.y;
    this.player.angle = car.angle;
    this.traffic.parked.push(car);
    this.playerCar = null;
    this.inCar = false;
  }
  atSpa() {
    if (!this.inCar) return false;
    const spa = this.city.landmark('spa');
    return dist(this.player.x, this.player.y, spa.x, spa.y) < 130;
  }
  respray() {
    if (this.cash < RESPAWN_COST) { this.hud.flashHint(`Respray costs $${RESPAWN_COST} — not enough cash`); return; }
    this.cash -= RESPAWN_COST;
    this.playerCar.health = 100;
    this.playerCar.smoke = 0;
    this.police.clear();
    this.sfx.pickup();
    this.combat.floater(this.player.x, this.player.y - 30, 'RESPRAYED', '#6fd3c7');
    this.hud.flashHint('Wanted level cleared — fresh paint, fresh start');
  }
  contextHint() {
    if (this.state !== 'playing') return null;
    if (this.atSpa()) return 'E — Respray $150 (clears wanted + repairs)';
    if (!this.inCar) {
      const car = this.nearestStealable();
      if (car) return `E — Steal ${car.name}`;
      return null;
    }
    return 'E — Exit car';
  }

  // ---------- update ----------
  update(dt) {
    this.time += dt;
    this.hud.update(dt, this);
    if (this.state === 'title' || this.state === 'howto') {
      this.titlePan += dt * 14;
      return;
    }
    if (this.state !== 'playing') return;
    this.stats.playTime += dt;
    const inp = this.input;
    const p = this.player;

    if (inp.wasPressed('escape', 'p')) {
      this.state = 'paused';
      this.sfx.click();
      // Consume the key: handleMenuKeys runs later in the same frame and
      // would otherwise see the same press and resume immediately.
      inp.pressed.delete('escape'); inp.pressed.delete('p');
      return;
    }
    if (inp.wasPressed('m')) this.sfx.toggleMute();

    // --- movement ---
    if (this.inCar && this.playerCar) {
      const car = this.playerCar;
      const throttle = inp.down('w', 'arrowup') ? 1 : 0;
      const brake = inp.down('s', 'arrowdown') ? 1 : 0;
      const steer = (inp.down('a', 'arrowleft') ? -1 : 0) + (inp.down('d', 'arrowright') ? 1 : 0);
      const hand = inp.down(' ');
      driveCar(car, dt, steer, throttle, brake, hand, this.city);
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      if (car.crashed) this.sfx.crash();
      if (inp.wasPressed('e')) {
        if (this.atSpa()) this.respray();
        else this.exitCar();
      }
      this.sfx.engine(true, Math.abs(car.speed) / car.top);
    } else {
      const mx = (inp.down('d', 'arrowright') ? 1 : 0) - (inp.down('a', 'arrowleft') ? 1 : 0);
      const my = (inp.down('s', 'arrowdown') ? 1 : 0) - (inp.down('w', 'arrowup') ? 1 : 0);
      const sprint = inp.down('shift');
      const spd = sprint ? 235 : 145;
      if (mx || my) {
        const len = Math.hypot(mx, my);
        const nx = p.x + (mx / len) * spd * dt;
        const ny = p.y + (my / len) * spd * dt;
        const f = this.city.resolveCircle(nx, ny, 10);
        p.x = f.x; p.y = f.y;
      }
      // Aim at the mouse.
      const mw = this.screenToWorld(inp.mouseX, inp.mouseY);
      p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
      if (inp.mouseDown) this.combat.playerShot(mw.x, mw.y);
      if (inp.wasPressed('e')) {
        const car = this.nearestStealable();
        if (car) this.stealCar(car);
      }
      this.sfx.engine(false);
    }

    // --- health regen after 6s calm ---
    if (this.time - this.lastDamageT > 6 && this.health > 0 && this.health < 100) {
      this.health = Math.min(100, this.health + 2.5 * dt);
    }

    // --- world systems ---
    this.missions.update(dt);
    this.police.update(dt, this);
    this.traffic.update(dt, p, this.allCars());
    this.combat.update(dt);
    for (const ped of this.peds) updatePed(ped, dt, this.city, this.rng, p);
    // Respawn far-away peds near the player.
    for (const ped of this.peds) {
      if (dist(ped.x, ped.y, p.x, p.y) > 1700) {
        const np = this.city.randomRoadPoint(this.rng, p.x, p.y, 500, 1200);
        ped.x = np.x; ped.y = np.y; ped.alive = true; ped.health = 100; ped.target = null;
      }
    }
    // Gang AI: hunt the player, shoot in range.
    for (const g of this.gang) {
      if (!g.alive) { g.downT += dt; continue; }
      const d = dist(g.x, g.y, p.x, p.y);
      g.angle = Math.atan2(p.y - g.y, p.x - g.x);
      if (d > 220) {
        const nx = g.x + Math.cos(g.angle) * g.speed * dt;
        const ny = g.y + Math.sin(g.angle) * g.speed * dt;
        const f = this.city.resolveCircle(nx, ny, 10);
        g.x = f.x; g.y = f.y;
        g.walkPhase += dt * 9;
      }
      g.shootT -= dt;
      if (g.shootT <= 0 && d < 320) {
        g.shootT = 1.0 + this.rng.next() * 0.7;
        this.combat.enemyShot(g, p.x, p.y, 7);
      }
    }
    this.gang = this.gang.filter((g) => g.alive || g.downT < 8);
    // Cars vs peds: running someone over.
    for (const car of this.allCars()) {
      if (Math.abs(car.speed) < 90) continue;
      for (const ped of this.peds) {
        if (!ped.alive) continue;
        if (dist(car.x, car.y, ped.x, ped.y) < 30) {
          ped.alive = false; ped.downT = 0;
          this.combat.burst(ped.x, ped.y, '#e74c3c', 8, 140);
          if (car.driver === 'player') {
            if (this.police.seen) { this.police.raise(2, 'ran over a ped'); this.hud.flashHint('You ran someone over — seen!'); }
            else this.hud.flashHint('You ran someone over…');
            this.scarePeds(ped.x, ped.y, 300);
          }
        }
      }
      // Player car vs other cars.
      if (this.playerCar && car !== this.playerCar) {
        const rel = collideCars(this.playerCar, car);
        if (rel > 150) { this.sfx.crash(); this.damagePlayerCar(0); }
      }
    }
    // Siren when any cruiser is near.
    const sirenNear = this.police.cruisers.some((c) => !c.wrecked && dist(c.x, c.y, p.x, p.y) < 700);
    this.sfx.siren(sirenNear && this.police.stars > 0);

    // Camera follows the player.
    this.camX = clamp(p.x - this.W / 2, 0, Math.max(0, WORLD_W - this.W));
    this.camY = clamp(p.y - this.H / 2, 0, Math.max(0, WORLD_H - this.H));
  }
  screenToWorld(sx, sy) { return { x: sx + this.camX, y: sy + this.camY }; }

  // ---------- menus ----------
  clickMenu(id) {
    this.sfx.ensure(); this.sfx.click();
    if (id === 'new') this.newGame();
    else if (id === 'continue') { if (!this.loadGame()) this.newGame(); }
    else if (id === 'howto') { this.prevState = this.state; this.state = 'howto'; }
    else if (id === 'back') this.state = this.prevState === 'howto' ? 'title' : this.prevState;
    else if (id === 'resume') this.state = 'playing';
    else if (id === 'save') this.saveGame();
    else if (id === 'quit') { this.state = 'title'; this.sfx.siren(false); this.sfx.engine(false); }
    else if (id === 'respawn-wasted') this.respawn('wasted');
    else if (id === 'respawn-busted') this.respawn('busted');
  }
  handleMenuClick() {
    if (!this.input.mouseClicked) return;
    for (const b of this.menuButtons) {
      if (this.input.mouseX >= b.x && this.input.mouseX <= b.x + b.w &&
        this.input.mouseY >= b.y && this.input.mouseY <= b.y + b.h) {
        this.clickMenu(b.id);
        return;
      }
    }
  }
  handleMenuKeys() {
    const inp = this.input;
    if (this.state === 'title') {
      if (inp.wasPressed('enter')) this.clickMenu(hasSave() ? 'continue' : 'new');
      if (inp.wasPressed('n')) this.clickMenu('new');
      if (inp.wasPressed('h')) this.clickMenu('howto');
    } else if (this.state === 'howto') {
      if (inp.wasPressed('escape', 'enter', 'h')) this.clickMenu('back');
    } else if (this.state === 'paused') {
      if (inp.wasPressed('escape', 'p', 'enter')) this.clickMenu('resume');
      if (inp.wasPressed('s')) this.clickMenu('save');
      if (inp.wasPressed('q')) this.clickMenu('quit');
    } else if (this.state === 'wasted') {
      if (inp.wasPressed('enter')) this.clickMenu('respawn-wasted');
    } else if (this.state === 'busted') {
      if (inp.wasPressed('enter')) this.clickMenu('respawn-busted');
    }
  }

  // ---------- render ----------
  frame() {
    const ctx = this.ctx;
    if (this.state === 'title' || this.state === 'howto') {
      this.renderWorld(true);
      this.renderTitle();
    } else {
      this.renderWorld(false);
      if (this.state === 'paused') this.renderPause();
      else if (this.state === 'wasted') this.renderEndScreen('WASTED', 'Solmar General patched you up. 10% of your cash went to the bill.', 'respawn-wasted');
      else if (this.state === 'busted') this.renderEndScreen('BUSTED', 'SBPD took 10% of your cash as a fine. Watch your stars.', 'respawn-busted');
      else this.hud.draw(ctx, this, this.W, this.H);
    }
    this.handleMenuClick();
    this.handleMenuKeys();
    this.input.endFrame();
  }
  renderWorld(titleMode) {
    const ctx = this.ctx;
    if (titleMode) {
      // Slow pan across downtown for the title backdrop.
      this.camX = (Math.sin(this.titlePan * 0.05) * 0.5 + 0.5) * Math.max(0, WORLD_W - this.W);
      this.camY = 600 + Math.sin(this.titlePan * 0.03) * 200;
    }
    const vx0 = this.camX, vy0 = this.camY, vx1 = this.camX + this.W, vy1 = this.camY + this.H;
    // Ground.
    ctx.fillStyle = '#7fae5a';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(-this.camX, -this.camY);
    // Beach + sea.
    ctx.fillStyle = '#f0dca0';
    ctx.fillRect(BEACH_X, 0, SEA_X - BEACH_X, WORLD_H);
    ctx.fillStyle = '#2e86c1';
    ctx.fillRect(SEA_X, 0, WORLD_W - SEA_X, WORLD_H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 40; y < WORLD_H; y += 130) {
      ctx.fillRect(SEA_X + 8 + Math.sin(y * 0.05 + this.time) * 6, y, 26, 3);
    }
    // Roads.
    ctx.fillStyle = '#3d3d3d';
    for (const rx of V_ROADS) ctx.fillRect(rx - ROAD_W / 2, 0, ROAD_W, WORLD_H);
    for (const ry of H_ROADS) ctx.fillRect(0, ry - ROAD_W / 2, WORLD_W, ROAD_W);
    // Sidewalk edges.
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 4;
    for (const rx of V_ROADS) {
      ctx.beginPath(); ctx.moveTo(rx - ROAD_W / 2, 0); ctx.lineTo(rx - ROAD_W / 2, WORLD_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx + ROAD_W / 2, 0); ctx.lineTo(rx + ROAD_W / 2, WORLD_H); ctx.stroke();
    }
    for (const ry of H_ROADS) {
      ctx.beginPath(); ctx.moveTo(0, ry - ROAD_W / 2); ctx.lineTo(WORLD_W, ry - ROAD_W / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, ry + ROAD_W / 2); ctx.lineTo(WORLD_W, ry + ROAD_W / 2); ctx.stroke();
    }
    // Center dashes.
    ctx.strokeStyle = '#f7dc6f'; ctx.lineWidth = 2;
    ctx.setLineDash([18, 22]);
    for (const rx of V_ROADS) { ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, WORLD_H); ctx.stroke(); }
    for (const ry of H_ROADS) { ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(WORLD_W, ry); ctx.stroke(); }
    ctx.setLineDash([]);
    // Crosswalks at intersections.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const rx of V_ROADS) for (const ry of H_ROADS) {
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(rx - ROAD_W / 2 + 6, ry + i * 12 - 3, ROAD_W - 12, 6);
      }
    }
    // Buildings.
    for (const b of this.city.buildings) {
      if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // Rooftop detail.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(b.x + b.w / 2 - 8, b.y + b.h / 2 - 8, 16, 16);
      if (b.landmark) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(b.landmark.short, b.x + b.w / 2, b.y - 8);
        ctx.textAlign = 'left';
      }
    }
    // Palms + props.
    for (const pl of this.city.palms) {
      if (pl.x < vx0 - 20 || pl.x > vx1 + 20 || pl.y < vy0 - 20 || pl.y > vy1 + 20) continue;
      const s = pl.s;
      ctx.strokeStyle = '#6e4a2f'; ctx.lineWidth = 4 * s;
      ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(pl.x + 3 * s, pl.y - 8 * s); ctx.stroke();
      ctx.fillStyle = '#2e8b57';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(pl.x + Math.cos(a) * 9 * s, pl.y - 8 * s + Math.sin(a) * 9 * s, 9 * s, 3.5 * s, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Mission marker beacon.
    const marker = this.missions.marker();
    if (marker && this.state === 'playing') {
      const pulse = 1 + Math.sin(this.time * 4) * 0.15;
      ctx.fillStyle = 'rgba(255,215,0,0.25)';
      ctx.beginPath(); ctx.ellipse(marker.x, marker.y, 34 * pulse, 20 * pulse, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(marker.x, marker.y, 26 * pulse, 15 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd700';
      ctx.save(); ctx.translate(marker.x, marker.y - 26 - Math.sin(this.time * 4) * 6); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-8, -8, 16, 16); ctx.restore();
      if (marker.label) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(marker.label, marker.x, marker.y - 44);
        ctx.textAlign = 'left';
      }
    }
    // Cars.
    for (const car of this.allCars()) {
      if (car.x < vx0 - 80 || car.x > vx1 + 80 || car.y < vy0 - 80 || car.y > vy1 + 80) continue;
      drawCar(ctx, car, this.time);
    }
    // People.
    for (const ped of this.peds) {
      if (ped.x < vx0 - 30 || ped.x > vx1 + 30 || ped.y < vy0 - 30 || ped.y > vy1 + 30) continue;
      drawPerson(ctx, ped, this.time);
    }
    for (const g of this.gang) drawPerson(ctx, g, this.time);
    for (const cop of this.police.cops) drawPerson(ctx, cop, this.time);
    // Player (on foot).
    if (!this.inCar && this.state !== 'title' && this.state !== 'howto') {
      drawPerson(ctx, { ...this.player, kind: 'player', skin: '#e0ac69', shirt: '#f5f5f5', alive: true, health: 100, walkPhase: this.time * 8 }, this.time);
      // Aim line (subtle).
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.player.x, this.player.y);
      ctx.lineTo(this.player.x + Math.cos(this.player.angle) * 46, this.player.y + Math.sin(this.player.angle) * 46);
      ctx.stroke();
    }
    this.combat.draw(ctx);
    ctx.restore();
    // Zone label strip in title mode is skipped; HUD covers it in play.
    if (titleMode) {
      ctx.fillStyle = 'rgba(5,8,16,0.55)';
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }
  button(ctx, id, label, cx, cy, w, h, accent = false) {
    const hover = this.input.mouseX >= cx - w / 2 && this.input.mouseX <= cx + w / 2 &&
      this.input.mouseY >= cy - h / 2 && this.input.mouseY <= cy + h / 2;
    ctx.fillStyle = hover ? (accent ? '#e8b04b' : '#3a4a63') : (accent ? '#c98f2e' : 'rgba(20,28,42,0.9)');
    ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 8); ctx.fill();
    ctx.strokeStyle = accent ? '#ffd166' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + 7);
    ctx.textAlign = 'left';
    this.menuButtons.push({ id, x: cx - w / 2, y: cy - h / 2, w, h });
  }
  renderTitle() {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.menuButtons = [];
    if (this.state === 'howto') { this.renderHowTo(); return; }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 84px sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 10;
    ctx.strokeText('SOLMAR', W / 2, H * 0.3);
    ctx.fillText('SOLMAR', W / 2, H * 0.3);
    ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif';
    ctx.fillText('— Streets of the Sun —', W / 2, H * 0.3 + 44);
    ctx.font = '16px sans-serif'; ctx.fillStyle = '#ffd166';
    ctx.fillText('An open-world crime game set in Solmar Bay. Danny "Dice" Marlow is back — and Vera has work.', W / 2, H * 0.3 + 78);
    ctx.textAlign = 'left';
    const cy = H * 0.52;
    if (hasSave()) this.button(ctx, 'continue', 'CONTINUE', W / 2, cy, 300, 52, true);
    this.button(ctx, 'new', hasSave() ? 'NEW GAME' : 'NEW GAME', W / 2, cy + (hasSave() ? 66 : 0), 300, 52, !hasSave());
    this.button(ctx, 'howto', 'HOW TO PLAY', W / 2, cy + (hasSave() ? 132 : 66), 300, 52);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('WASD move · Mouse aim · Click shoot · E steal / exit car · Shift sprint · Space handbrake · Esc pause · M mute', W / 2, H - 30);
    ctx.textAlign = 'left';
  }
  renderHowTo() {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.menuButtons = [];
    ctx.fillStyle = 'rgba(5,8,16,0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('HOW TO PLAY', W / 2, 90);
    const lines = [
      ['Move / drive', 'WASD or arrow keys — W accelerates, S brakes/reverses'],
      ['Sprint / handbrake', 'Shift on foot · Space while driving'],
      ['Steal a car', 'Walk up to any car and press E (cops watching = +1 star)'],
      ['Shoot', 'Aim with the mouse, hold left click — hitscan, infinite ammo'],
      ['Wanted level', 'Stars 0–5. Foot cops chase on foot, cruisers chase in a car'],
      ['Lose the heat', 'Stay unseen and stars cool down — or respray at Sunset Auto Spa ($150)'],
      ['Missions', 'Follow the yellow marker. Vera pays cash for every job'],
      ['Save', 'Pause (Esc) → Save Game. Your city seed is saved too'],
      ['Busted / Wasted', 'Caught by a cop up close = busted. Health at 0 = wasted. Both cost 10% cash'],
    ];
    ctx.textAlign = 'left';
    let y = 150;
    for (const [k, v] of lines) {
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 16px sans-serif';
      ctx.fillText(k, W / 2 - 340, y);
      ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif';
      ctx.fillText(v, W / 2 - 140, y);
      y += 38;
    }
    this.button(ctx, 'back', 'BACK', W / 2, H - 90, 220, 48, true);
  }
  renderPause() {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.menuButtons = [];
    ctx.fillStyle = 'rgba(5,8,16,0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, 110);
    ctx.font = '16px sans-serif'; ctx.fillStyle = '#ffd166';
    const mins = Math.floor(this.stats.playTime / 60);
    ctx.fillText(`Cash $${this.cash.toLocaleString()} · Missions ${this.missions.completedIds.length} · Cars stolen ${this.stats.carsStolen} · Time ${mins}m · Zone ${zoneAt(this.player.x, this.player.y)}`, W / 2, 150);
    ctx.textAlign = 'left';
    this.button(ctx, 'resume', 'RESUME', W / 2, 220, 260, 50, true);
    this.button(ctx, 'save', 'SAVE GAME', W / 2, 284, 260, 50);
    this.button(ctx, 'howto', 'HOW TO PLAY', W / 2, 348, 260, 50);
    this.button(ctx, 'quit', 'QUIT TO TITLE', W / 2, 412, 260, 50);
  }
  renderEndScreen(title, sub, btnId) {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.menuButtons = [];
    ctx.fillStyle = title === 'WASTED' ? 'rgba(120,10,10,0.72)' : 'rgba(10,30,80,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 72px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, H * 0.4);
    ctx.font = '17px sans-serif'; ctx.fillStyle = '#ffd166';
    ctx.fillText(sub, W / 2, H * 0.4 + 40);
    ctx.textAlign = 'left';
    this.button(ctx, btnId, 'RESPAWN  (Enter)', W / 2, H * 0.55, 300, 52, true);
  }
  debugState() {
    return {
      state: this.state, seed: this.seed, cash: this.cash,
      health: Math.round(this.health), stars: this.police.stars,
      x: Math.round(this.player.x), y: Math.round(this.player.y),
      zone: zoneAt(this.player.x, this.player.y),
      inCar: this.inCar, carSpeed: this.playerCar ? Math.round(this.playerCar.speed) : 0,
      carHealth: this.playerCar ? Math.round(this.playerCar.health) : null,
      mission: this.missions.missionName(),
      objective: this.missions.objectiveText(),
      cops: this.police.cops.filter((c) => c.alive).length,
      cruisers: this.police.cruisers.filter((c) => !c.wrecked).length,
      peds: this.peds.filter((p) => p.alive).length,
      cars: this.allCars().length,
    };
  }
}
