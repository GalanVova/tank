"use strict";

// Исправления поверх Retro Preview без замены визуального слоя.
(() => {
  const originalStartGame = startGame;
  const originalMakeMap = makeMap;
  const originalDrawTile = drawTile;

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

  // Более классический темп: быстрым остаётся только Комар.
  enemySpec = function (type) {
    if (type === "snow") return {speed:56,hp:1,fire:1.55,color:"#eee",name:"Снежок"};
    if (type === "mosquito") return {speed:108,hp:1,fire:1.0,color:"#ffd23f",name:"Комар"};
    if (type === "assault") return {speed:68,hp:2,fire:0.82,color:"#8fb359",name:"Штурмовик"};
    return {speed:48,hp:4,fire:0.7,color:"#5f6d45",name:"Толстяк"};
  };

  // Отдельная физическая зона базы: танки не могут визуально залезать на орла,
  // даже когда кирпичная защита уже разрушена.
  function collidesBaseCore(o, nx, ny) {
    const baseLeft = 13 * TILE - 4;
    const baseTop = 23 * TILE - 4;
    const baseRight = 14 * TILE + 4;
    const baseBottom = 24 * TILE + 4;
    return nx + o.w / 2 > baseLeft && nx - o.w / 2 < baseRight &&
           ny + o.h / 2 > baseTop && ny - o.h / 2 < baseBottom;
  }

  // Проверяем перемещение короткими шагами и отдельно блокируем орла.
  // Это не даёт ни игрокам, ни врагам проскакивать внутрь кирпича или базы.
  tryMove = function (o, dx, dy, dt) {
    let speed = o.speed;
    if (tileAt(o.x, o.y) === ICE) speed *= 1.25;

    const distance = speed * dt;
    const steps = Math.max(1, Math.ceil(distance / 3));
    const step = distance / steps;
    let moved = false;

    for (let i = 0; i < steps; i++) {
      const nx = o.x + dx * step;
      const ny = o.y + dy * step;
      if (collidesBaseCore(o, nx, ny) || collidesMap(o, nx, ny) || collidesTanks(o, nx, ny)) break;
      o.x = nx;
      o.y = ny;
      moved = true;
    }
    return moved;
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

  // Кирпич разрушается цельным квадратным блоком 2x2 клетки.
  // Блок выравнивается по чётной сетке, поэтому половинок и тонких остатков нет.
  destroyTile = function (tx, ty, bullet) {
    const tile = game.map[ty] && game.map[ty][tx];

    if (tile === BRICK) {
      const bx = Math.floor(tx / 2) * 2;
      const by = Math.floor(ty / 2) * 2;
      for (let y = by; y < by + 2; y++) {
        for (let x = bx; x < bx + 2; x++) {
          if (game.map[y] && game.map[y][x] === BRICK) game.map[y][x] = EMPTY;
        }
      }
      bullet.alive = false;
      return;
    }

    if (tile === STEEL && bullet.steel) {
      game.map[ty][tx] = EMPTY;
      bullet.alive = false;
      return;
    }

    if (tile === BASE) {
      game.baseAlive = false;
      bullet.alive = false;
      return;
    }

    if (tile !== EMPTY && tile !== BUSH && tile !== ICE && tile !== WATER) {
      bullet.alive = false;
    }
  };

  // Более цельный вид кирпичного блока без визуальных "полукирпичей" по краям.
  drawTile = function (tile, x, y) {
    if (tile !== BRICK) {
      originalDrawTile(tile, x, y);
      return;
    }

    const px = x * TILE;
    const py = y * TILE;
    ctx.fillStyle = "#7f2418";
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#d95532";
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = "#6b1d14";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.beginPath();
    ctx.moveTo(px + TILE / 2, py + 2);
    ctx.lineTo(px + TILE / 2, py + TILE - 2);
    ctx.moveTo(px + 2, py + TILE / 2);
    ctx.lineTo(px + TILE - 2, py + TILE / 2);
    ctx.stroke();
  };

  // Снаряды идут через воду, лес и лёд, но не перескакивают кирпич/сталь/базу.
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

        const projectilePasses = tile === EMPTY || tile === BUSH || tile === ICE || tile === WATER;
        if (tile !== undefined && !projectilePasses) {
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