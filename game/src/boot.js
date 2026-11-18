// Entry point: creates the game, runs the fixed-step loop, and exposes a
// small debug handle (window.__solmar) the play-tests use.
import { Game } from './game.js';
import { makeCar } from './vehicles.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Debug/test handle. Follows the reassigned game if the page ever rebuilds it.
window.__solmar = {
  game,
  state: () => game.debugState(),
  newGame: (seed) => game.newGame(seed),
  teleport: (x, y) => { game.player.x = x; game.player.y = y; if (game.playerCar) { game.playerCar.x = x; game.playerCar.y = y; } },
  setWanted: (n) => { game.police.stars = n; },
  giveCash: (n) => game.addCash(n),
  spawnCarNear: (model = 'sedan') => {
    const car = makeCar(model, game.player.x + 60, game.player.y, 0);
    game.traffic.parked.push(car);
    return car.id;
  },
};
window.__solmarVersion = 1;
