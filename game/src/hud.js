// Canvas HUD: health bar, cash, wanted stars, objective panel, speedometer,
// round minimap with blips, zone name, contextual hints, center banners.
import { zoneAt, WORLD_W, WORLD_H } from './city.js';
import { clamp } from './rng.js';

export class Hud {
  constructor() {
    this.bannerText = null; this.bannerSub = null; this.bannerT = 0;
    this.hintText = null; this.hintT = 0;
    this.zoneText = ''; this.zoneT = 0;
    this.lastZone = '';
  }
  banner(text, sub = '') { this.bannerText = text; this.bannerSub = sub; this.bannerT = 3.2; }
  flashHint(text) { this.hintText = text; this.hintT = 2.5; }
  update(dt, game) {
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.hintT > 0) this.hintT -= dt;
    const z = zoneAt(game.player.x, game.player.y);
    if (z !== this.lastZone) {
      this.lastZone = z; this.zoneText = z; this.zoneT = 2.6;
    }
    if (this.zoneT > 0) this.zoneT -= dt;
  }
  draw(ctx, game, W, H) {
    const p = game.player;
    ctx.textAlign = 'left';
    // --- Top right: health, cash, wanted stars.
    const hx = W - 232, hy = 18;
    ctx.fillStyle = 'rgba(8,12,20,0.62)';
    ctx.beginPath(); ctx.roundRect(hx - 12, hy - 8, 232, 92, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`$${game.cash.toLocaleString()}`, hx, hy + 20);
    ctx.font = 'bold 22px sans-serif';
    const stars = game.police.stars;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < stars ? '#ffd700' : 'rgba(255,255,255,0.25)';
      ctx.fillText('★', hx + i * 26, hy + 50);
    }
    // Health bar.
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(hx, hy + 60, 200, 12);
    ctx.fillStyle = game.health > 50 ? '#2ecc71' : game.health > 25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(hx, hy + 60, 200 * clamp(game.health / 100, 0, 1), 12);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`HP ${Math.ceil(game.health)}`, hx + 4, hy + 70);
    // --- Top left: objective panel.
    const obj = game.missions.objectiveText();
    const name = game.missions.missionName();
    ctx.fillStyle = 'rgba(8,12,20,0.62)';
    ctx.beginPath(); ctx.roundRect(12, 12, 340, 64, 10); ctx.fill();
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText(name.toUpperCase(), 26, 34);
    ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif';
    ctx.fillText(obj.length > 52 ? obj.slice(0, 52) + '…' : obj, 26, 56);
    // Mission countdown if the current mission sets one.
    if (game.missions.current && game.missions.current.data.timeLeft != null) {
      const tl = Math.max(0, game.missions.current.data.timeLeft);
      ctx.fillStyle = tl < 10 ? '#ff6b6b' : '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(`${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`, 26, 76);
    }
    // --- Bottom left: round minimap.
    this.drawMinimap(ctx, game, 108, H - 108, 88);
    // --- Bottom right: speedometer (in car) or controls hint.
    if (game.inCar && game.playerCar) {
      const kmh = Math.abs(Math.round(game.playerCar.speed * 0.42));
      ctx.fillStyle = 'rgba(8,12,20,0.62)';
      ctx.beginPath(); ctx.roundRect(W - 150, H - 92, 132, 74, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`${kmh}`, W - 52, H - 42);
      ctx.font = '12px sans-serif'; ctx.fillStyle = '#ffd166';
      ctx.fillText('km/h', W - 24, H - 42);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
      ctx.fillText(game.playerCar.name, W - 138, H - 72);
      // Car health.
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(W - 138, H - 34, 108, 6);
      ctx.fillStyle = game.playerCar.health > 40 ? '#2ecc71' : '#e74c3c';
      ctx.fillRect(W - 138, H - 34, 108 * clamp(game.playerCar.health / 100, 0, 1), 6);
    }
    // --- Zone name (fades).
    if (this.zoneT > 0) {
      ctx.globalAlpha = clamp(this.zoneT / 1.2, 0, 1);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.zoneText, W / 2, H - 26);
      ctx.globalAlpha = 1;
    }
    // --- Contextual hint.
    const hint = game.contextHint() || (this.hintT > 0 ? this.hintText : null);
    if (hint) {
      ctx.fillStyle = 'rgba(8,12,20,0.72)';
      const wdt = ctx.measureText(hint).width + 36;
      ctx.beginPath(); ctx.roundRect(W / 2 - wdt / 2, H - 78, wdt, 30, 8); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(hint, W / 2, H - 58);
      ctx.textAlign = 'left';
    }
    // --- Center banner.
    if (this.bannerT > 0 && this.bannerText) {
      ctx.globalAlpha = clamp(this.bannerT / 0.8, 0, 1);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6;
      ctx.strokeText(this.bannerText, W / 2, 150);
      ctx.fillText(this.bannerText, W / 2, 150);
      if (this.bannerSub) {
        ctx.font = '17px sans-serif'; ctx.fillStyle = '#ffd166';
        ctx.fillText(this.bannerSub, W / 2, 180);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
    // --- Low-health vignette.
    if (game.health < 30 && game.state === 'playing') {
      const a = 0.25 + 0.15 * Math.sin(performance.now() / 180);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(231,76,60,0)');
      g.addColorStop(1, `rgba(231,76,60,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }
  drawMinimap(ctx, game, cx, cy, r) {
    const p = game.player;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1d2b1f';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const scale = (r * 2) / 1100; // ~1100 world px across the map
    const toMap = (wx, wy) => [cx + (wx - p.x) * scale, cy + (wy - p.y) * scale];
    // Roads.
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 5;
    for (const rx of [200, 600, 1000, 1400, 1800, 2200, 2600]) {
      const [mx] = toMap(rx, 0);
      ctx.beginPath(); ctx.moveTo(mx, cy - r); ctx.lineTo(mx, cy + r); ctx.stroke();
    }
    for (const ry of [150, 450, 750, 1050, 1350, 1650, 1950, 2250]) {
      const [, my] = toMap(0, ry);
      ctx.beginPath(); ctx.moveTo(cx - r, my); ctx.lineTo(cx + r, my); ctx.stroke();
    }
    // Sea edge.
    const [seaX] = toMap(3080, 0);
    ctx.fillStyle = '#2e86c1';
    ctx.fillRect(Math.max(seaX, cx - r), cy - r, r * 2, r * 2);
    // Mission marker.
    const m = game.missions.marker();
    if (m) {
      const [mx, my] = toMap(m.x, m.y);
      ctx.fillStyle = '#ffd700';
      ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10); ctx.restore();
    }
    // Landmarks (hideout + spa).
    for (const id of ['hideout', 'spa']) {
      const lm = game.city.landmark(id);
      const [mx, my] = toMap(lm.x, lm.y);
      if (Math.hypot(mx - cx, my - cy) < r - 4) {
        ctx.fillStyle = id === 'hideout' ? '#2ecc71' : '#6fd3c7';
        ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Cops (blue) and gang (red).
    for (const c of game.police.cops) {
      if (!c.alive) continue;
      const [mx, my] = toMap(c.x, c.y);
      ctx.fillStyle = '#2e7bff';
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of game.police.cruisers) {
      const [mx, my] = toMap(c.x, c.y);
      ctx.fillStyle = '#2e7bff';
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
    }
    for (const g of game.gang) {
      if (!g.alive) continue;
      const [mx, my] = toMap(g.x, g.y);
      ctx.fillStyle = '#ff2e2e';
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // Player: white arrow.
    ctx.fillStyle = '#fff';
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(game.player.angle);
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
    // Ring.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
}
