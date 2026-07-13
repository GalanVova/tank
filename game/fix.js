"use strict";

// Исправления поверх Retro Preview без замены визуального слоя.
(() => {
  const originalStartGame = startGame;
  const originalMakeMap = makeMap;
  const originalEnemySpec = enemySpec;

  function clearSpawnArea(map, cx, cy) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (y > 0 && y < ROWS - 1 && x > 0 && x < COLS - 1 && map[y][x] !== BASE) {
          map[y][x] = EMPTY;
        }
      }
    }
  }

  makeMap = function () {
    const map = originalMakeMap();
    clearSpawnArea(map, 9, 23);
    clearSpawnArea(map, 17, 23);
    map[23][13] = BASE;
    [[12,22],[13,22],[14,22],[12,23],[14,23],[12,24],[13,24],[14,24]]
      .forEach(([x,y]) => map[y][x] = BRICK);
    return map;
  };

  function placePlayersSafely() {
    if (!game || !game.players || game.players.length < 2) return;
    const p1 = game.players[0];
    const p2 = game.players[1];
    p1.x = 9.5 * TILE;
    p1.y = 23.5 * TILE;
    p1.dir = "up";
    p2.x = 17.5 * TILE;
    p2.y = 23.5 * TILE;
    p2.dir = "up";
  }

  startGame = function () {
    originalStartGame();
    placePlayersSafely();
  };

  respawnPlayer = function (p) {
    p.x = (p.id === 1 ? 9.5 : 17.5) * TILE;
    p.y = 23.5 * TILE;
    p.dir = "up";
    p.alive = true;
    p.invuln = 2;
  };

  enemySpec = function (type) {
    const spec = originalEnemySpec(type);
    if (type === "snow") spec.speed = 56;
    else if (type === "mosquito") spec.speed = 108;
    else if (type === "assault") spec.speed = 68;
    else spec.speed = 48;
    return spec;
  };

  playerInput = function (p, dt) {
    if (!p.alive) return;
    let dx = 0, dy = 0, fire = false;

    if (p.id === 1) {
      if (keys.KeyW) { dy = -1; p.dir = "up"; }
      else if (keys.KeyS) { dy = 1; p.dir = "down"; }
      else if (keys.KeyA) { dx = -1; p.dir = "left"; }
      else if (keys.KeyD) { dx = 1; p.dir = "right"; }
      fire = !!keys.Space;
    } else {
      if (keys.ArrowUp || keys.KeyI) { dy = -1; p.dir = "up"; }
      else if (keys.ArrowDown || keys.KeyK) { dy = 1; p.dir = "down"; }
      else if (keys.ArrowLeft || keys.KeyJ) { dx = -1; p.dir = "left"; }
      else if (keys.ArrowRight || keys.KeyL) { dx = 1; p.dir = "right"; }
      fire = !!(keys.Enter || keys.Numpad0 || keys.Slash);
    }

    if (dx || dy) tryMove(p, dx, dy, dt);
    if (fire) shoot(p);
  };

  // Движение танков небольшими шагами. Это исключает прохождение врагов
  // через кирпич, сталь, воду, базу и другие танки даже при просадке FPS.
  tryMove = function (o, dx, dy, dt) {
    let speed = o.speed;
    if (tileAt(o.x, o.y) === ICE) speed *= 1.25;

    const totalDistance = speed * dt;
    const steps = Math.max(1, Math.ceil(totalDistance / 2));
    const stepDistance = totalDistance / steps;
    let moved = false;

    for (let i = 0; i < steps; i++) {
      const nx = o.x + dx * stepDistance;
      const ny = o.y + dy * stepDistance;

      if (collidesMap(o, nx, ny) || collidesTanks(o, nx, ny)) {
        break;
      }

      o.x = nx;
      o.y = ny;
      moved = true;
    }

    return moved;
  };

  // Если враг по старому состоянию оказался внутри твёрдой клетки,
  // возвращаем его в ближайшую свободную позицию по сетке.
  function rescueEnemyFromSolid(enemy) {
    if (!collidesMap(enemy, enemy.x, enemy.y)) return;

    const cx = Math.floor(enemy.x / TILE);
    const cy = Math.floor(enemy.y / TILE);
    const candidates = [];
    for (let radius = 1; radius <= 3; radius++) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (x <= 0 || y <= 0 || x >= COLS - 1 || y >= ROWS - 1) continue;
          candidates.push({x:(x + 0.5) * TILE, y:(y + 0.5) * TILE});
        }
      }
      const free = candidates.find(pos => !collidesMap(enemy, pos.x, pos.y) && !collidesTanks(enemy, pos.x, pos.y));
      if (free) {
        enemy.x = free.x;
        enemy.y = free.y;
        enemy.dir = "down";
        return;
      }
    }
  }

  const originalUpdateEnemy = updateEnemy;
  updateEnemy = function (enemy, dt) {
    rescueEnemyFromSolid(enemy);
    originalUpdateEnemy(enemy, dt);
    rescueEnemyFromSolid(enemy);
  };

  // Проверка траектории небольшими шагами: снаряд не перескакивает кирпич.
  // Вода, лес и лёд не блокируют выстрел.
  updateBullets = function (dt) {
    for (const b of game.bullets) {
      if (!b.alive) continue;

      const distance = b.speed * dt;
      const steps = Math.max(1, Math.ceil(distance / 4));
      const stepDistance = distance / steps;

      for (let i = 0; i < steps && b.alive; i++) {
        b.x += b.dx * stepDistance;
        b.y += b.dy * stepDistance;

        if (b.x < 0 || b.y < 0 || b.x >= W || b.y >= H) {
          b.alive = false;
          break;
        }

        const tx = Math.floor(b.x / TILE);
        const ty = Math.floor(b.y / TILE);
        const tile = game.map[ty] && game.map[ty][tx];

        if (tile !== undefined && tile !== EMPTY && tile !== BUSH && tile !== ICE && tile !== WATER) {
          destroyTile(tx, ty, b);
          break;
        }

        const targets = b.owner.kind === "player" ? game.enemies : game.players;
        for (const target of targets) {
          if (target.alive && rectsOverlap(b, target)) {
            hitTank(target, b);
            break;
          }
        }
      }
    }
    game.bullets = game.bullets.filter(b => b.alive);
  };

  window.addEventListener("keydown", event => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Enter","Numpad0","Space"].includes(event.code)) {
      event.preventDefault();
    }
  }, { capture: true });

  startGame();
})();