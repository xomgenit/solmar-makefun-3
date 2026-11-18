// Solmar Bay: a seeded procedural city. Grid roads, blocks of buildings,
// named landmarks, a beach and sea on the east edge, and zone names.
import { makeRng, clamp } from './rng.js';

export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const ROAD_W = 72;
export const V_ROADS = [200, 600, 1000, 1400, 1800, 2200, 2600];
export const H_ROADS = [150, 450, 750, 1050, 1350, 1650, 1950, 2250];
export const BEACH_X = 2900;
export const SEA_X = 3080;

// Landmark spots, placed on the grid so each sits inside its own block.
export const LANDMARKS = [
  { id: 'hideout', name: "Dice's Hideout", short: 'HIDEOUT', x: 420, y: 300, w: 150, h: 110, color: '#e8b04b', kind: 'hideout' },
  { id: 'hospital', name: 'Solmar General', short: 'HOSPITAL', x: 1200, y: 300, w: 170, h: 120, color: '#e8e8e8', kind: 'hospital' },
  { id: 'diner', name: 'Sunset Diner', short: 'DINER', x: 800, y: 600, w: 140, h: 100, color: '#ff8fa3', kind: 'diner' },
  { id: 'sbpd', name: 'SBPD Headquarters', short: 'SBPD HQ', x: 1600, y: 600, w: 180, h: 130, color: '#7fb3e8', kind: 'police' },
  { id: 'bank', name: 'Solmar National Bank', short: 'BANK', x: 1600, y: 900, w: 170, h: 120, color: '#d9c27a', kind: 'bank' },
  { id: 'pier', name: 'Solmar Pier', short: 'PIER', x: 3020, y: 1200, w: 150, h: 60, color: '#b08968', kind: 'pier' },
  { id: 'garage', name: "Vera's Garage", short: 'GARAGE', x: 800, y: 1500, w: 160, h: 110, color: '#9b8de0', kind: 'garage' },
  { id: 'spa', name: 'Sunset Auto Spa', short: 'AUTO SPA', x: 2000, y: 1800, w: 170, h: 110, color: '#6fd3c7', kind: 'spa' },
  { id: 'docks', name: 'Solmar Docks', short: 'DOCKS', x: 2700, y: 1950, w: 180, h: 120, color: '#8d99ae', kind: 'docks' },
];

const ROOF_COLORS = ['#c98f5f', '#b07a4e', '#8fa3b8', '#a8b5a0', '#c4a265', '#9d7ba8', '#7d9b76', '#b8b0a0'];

export function zoneAt(x, y) {
  if (x >= BEACH_X) return 'PALMA BEACH';
  if (y >= 1800) return 'SOUTHSIDE';
  if (x >= 2200) return 'EAST HARBOUR';
  if (y < 450) return 'NORTHSIDE';
  if (x < 1000) return 'OLD TOWN';
  return 'DOWNTOWN';
}

export function buildCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const palms = [];
  const props = [];

  // Landmark buildings first (they own their block).
  for (const lm of LANDMARKS) {
    buildings.push({ x: lm.x - lm.w / 2, y: lm.y - lm.h / 2, w: lm.w, h: lm.h, roof: lm.color, landmark: lm, h: lm.h });
  }
  const landmarkRect = (x, y, w, h) =>
    LANDMARKS.some((lm) => x < lm.x + lm.w / 2 + 30 && x + w > lm.x - lm.w / 2 - 30 &&
      y < lm.y + lm.h / 2 + 30 && y + h > lm.y - lm.h / 2 - 30);

  // Fill every block between roads with 1-3 buildings.
  const vEdges = [0, ...V_ROADS.map((x) => x - ROAD_W / 2), WORLD_W];
  const vEdgesR = [...V_ROADS.map((x) => x + ROAD_W / 2), WORLD_W];
  const hEdges = [0, ...H_ROADS.map((y) => y - ROAD_W / 2), WORLD_H];
  const hEdgesR = [...H_ROADS.map((y) => y + ROAD_W / 2), WORLD_H];
  for (let i = 0; i < vEdges.length - 1; i++) {
    for (let j = 0; j < hEdges.length - 1; j++) {
      const bx0 = vEdgesR[i] + 14, bx1 = (vEdges[i + 1] ?? WORLD_W) - 14;
      const by0 = hEdgesR[j] + 14, by1 = (hEdges[j + 1] ?? WORLD_H) - 14;
      if (bx1 - bx0 < 90 || by1 - by0 < 70) continue;
      if (bx0 > BEACH_X - 40) continue; // beach blocks stay open
      const count = rng.int(1, 3);
      for (let k = 0; k < count; k++) {
        const w = rng.range(70, Math.min(150, bx1 - bx0 - 20));
        const h = rng.range(60, Math.min(120, by1 - by0 - 20));
        const x = rng.range(bx0, bx1 - w);
        const y = rng.range(by0, by1 - h);
        if (landmarkRect(x, y, w, h)) continue;
        if (buildings.some((b) => x < b.x + b.w + 12 && x + w > b.x - 12 && y < b.y + b.h + 12 && y + h > b.y - 12)) continue;
        buildings.push({ x, y, w, h, roof: rng.pick(ROOF_COLORS), landmark: null });
      }
      // Palms and props scattered in the block.
      const nProps = rng.int(1, 4);
      for (let k = 0; k < nProps; k++) {
        const x = rng.range(bx0, bx1), y = rng.range(by0, by1);
        if (buildings.some((b) => x > b.x - 8 && x < b.x + b.w + 8 && y > b.y - 8 && y < b.y + b.h + 8)) continue;
        if (rng.chance(0.6)) palms.push({ x, y, s: rng.range(0.8, 1.3) });
        else props.push({ x, y, kind: rng.pick(['bench', 'hydrant', 'crate']) });
      }
    }
  }
  // Palm-lined promenade along the beach.
  for (let y = 120; y < WORLD_H; y += rng.range(90, 150)) {
    palms.push({ x: rng.range(BEACH_X - 60, BEACH_X - 10), y, s: rng.range(0.9, 1.4) });
  }

  const city = { seed, buildings, palms, props, landmarks: LANDMARKS };

  city.isRoadAt = (x, y) => {
    if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) return false;
    for (const rx of V_ROADS) if (Math.abs(x - rx) <= ROAD_W / 2) return true;
    for (const ry of H_ROADS) if (Math.abs(y - ry) <= ROAD_W / 2) return true;
    return false;
  };
  city.buildingAt = (x, y) => {
    for (const b of buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    return null;
  };
  // Push a circle out of buildings and world bounds; returns corrected {x, y}.
  city.resolveCircle = (x, y, r) => {
    for (const b of buildings) {
      const cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h);
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r; y = cy + (dy / d) * r;
        } else {
          // Center inside the building: push out along the smallest penetration.
          const pl = x - b.x, pr = b.x + b.w - x, pt = y - b.y, pb = b.y + b.h - y;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) x = b.x - r; else if (m === pr) x = b.x + b.w + r;
          else if (m === pt) y = b.y - r; else y = b.y + b.h + r;
        }
      }
    }
    x = clamp(x, r, WORLD_W - r); y = clamp(y, r, WORLD_H - r);
    return { x, y };
  };
  city.nearestRoadPoint = (x, y) => {
    let best = null, bestD = Infinity;
    for (const rx of V_ROADS) { const d = Math.abs(x - rx); if (d < bestD) { bestD = d; best = { x: rx, y }; } }
    for (const ry of H_ROADS) { const d = Math.abs(y - ry); if (d < bestD) { bestD = d; best = { x, y: ry }; } }
    return best;
  };
  city.randomRoadPoint = (rng2, cx, cy, minD, maxD) => {
    for (let tries = 0; tries < 24; tries++) {
      const vertical = rng2.chance(0.5);
      let x, y;
      if (vertical) { x = rng2.pick(V_ROADS); y = rng2.range(100, WORLD_H - 100); }
      else { x = rng2.range(100, BEACH_X - 60); y = rng2.pick(H_ROADS); }
      const d = Math.hypot(x - cx, y - cy);
      if (d >= minD && d <= maxD) return { x, y, vertical };
    }
    return { x: 1400, y: 1050, vertical: true };
  };
  city.landmark = (id) => LANDMARKS.find((lm) => lm.id === id);
  return city;
}
