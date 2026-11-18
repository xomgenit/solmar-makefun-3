// localStorage save: the city seed is stored so CONTINUE rebuilds the
// exact same city the player left.
const KEY = 'solmar-save-v1';

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, ...data })); return true; }
  catch { return false; }
}

export function readSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.v !== 1 || typeof d.seed !== 'number') return null;
    return d;
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
