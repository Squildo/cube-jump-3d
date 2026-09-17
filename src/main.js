import { Game } from './game/game.js';
import { APP_VERSION } from './version.js';

const canvas = document.getElementById('game-canvas');
new Game(canvas);

const badge = document.getElementById('app-version');
if (badge) badge.textContent = APP_VERSION;
