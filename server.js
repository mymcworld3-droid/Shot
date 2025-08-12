const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEBUG = false; // 改成 true 才會輸出訊息

function log(...args) {
  if (DEBUG) console.log(...args);
}
function logError(...args) {
  if (DEBUG) console.error(...args);
}
function computeSpeedMultiplierById(netId) {
  const p = players.get(netId);
  const name = p?.displayName || '';
  return (name.startsWith('    ') && name.endsWith('    ')) ? 1.5 : 1.0;
}


// 創建 HTTP 伺服器來提供靜態文件
const server = http.createServer((req, res) => {
  let filePath = '.' + req.url;
  if (filePath === './') filePath = './index.html';

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });
const players = new Map();
const projectiles = [];

function computeBulletRadiusById(netId) {
  const p = players.get(netId);
  const name = p?.displayName || '';
  return (name.startsWith('    ') && name.endsWith('    ')) ? 10 : 5;
}
function isSpaced(name) {
  return name.startsWith('    ') && name.endsWith('    ');
}
function isExName(name) {
  return /^ex/i.test(name);  // 不分大小寫
}
function hasDefInName(name) {
  return typeof name === 'string' && name.toLowerCase().includes('def');
}
function hideDefInName(name) {
  return typeof name === 'string'
    ? name.replace(/def/gi, '')
    : name;
}

function computeDamageByShooter(id) {
  const p = players.get(id);
  const name = p?.displayName || '';
  if (isSpaced(name)) return 9; // 前後四個空白
  if (isExName(name)) return 4; // Ex 前綴
  return 5;                     // 一般
}

function getFanDirections(baseDx, baseDy, totalDeg = 80, count = 4) {
  // 正規化
  const len = Math.hypot(baseDx, baseDy) || 1;
  const ux = baseDx / len;
  const uy = baseDy / len;
  const baseAngle = Math.atan2(uy, ux);
  const half = (totalDeg * Math.PI / 180) / 2;         // 22.5°
  const step = (count === 1) ? 0 : (totalDeg * Math.PI / 180) / (count - 1); // 15°
  const start = baseAngle - half;
  const dirs = [];
  for (let i = 0; i < count; i++) {
    const a = start + i * step;
    dirs.push({ dx: Math.cos(a), dy: Math.sin(a) });
  }
  return dirs
}

wss.on('connection', (ws) => {
  log('新玩家連接');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'spectateHello':
          ws.send(JSON.stringify({
            type: 'currentPlayers',
            players: Array.from(players.values()).map(p => ({
              id: p.id,
              displayName: hideDefInName(ws._displayName),
              x: p.x, y: p.y,
              directionX: p.directionX, directionY: p.directionY,
              hp: p.hp
            }))
          }));
          break;

        case 'playerJoin': {
          const baseName = String(data.displayName ?? '').slice(0, 32);
          let finalId = baseName || Math.random().toString(36).slice(2, 9);
          while (players.has(finalId)) {
            finalId = (baseName || 'p') + '_' + Math.floor(Math.random() * 1000);
          }

          ws._internalId = finalId;
          ws._displayName = baseName || finalId;

          players.set(finalId, {
            id: finalId,
            displayName: ws._displayName,
            x: data.x,
            y: data.y,
            directionX: 0,
            directionY: 0,
            ws,
            hp: 10,
            lastHitAt: Date.now(),
          });

          ws.send(JSON.stringify({ type: 'joinAck', id: finalId, displayName: hideDefInName(ws._displayName) }));

          ws.send(JSON.stringify({
            type: 'currentPlayers',
            players: Array.from(players.values()).map(p => ({
              id: p.id,
              displayName: hideDefInName(ws._displayName),
              x: p.x,
              y: p.y,
              directionX: p.directionX,
              directionY: p.directionY,
              hp: p.hp             
            }))
          }));

          broadcast({
            type: 'playerJoined',
            player: {
              id: finalId,
              displayName: hideDefInName(ws._displayName),
              x: data.x,
              y: data.y,
              directionX: 0,
              directionY: 0
            }
          }, finalId);
          break;
        }

        case 'playerUpdate': {
          if (players.has(data.playerId)) {
            const player = players.get(data.playerId);

            player.x = data.x;
            player.y = data.y;
            player.directionX = data.directionX;
            player.directionY = data.directionY;


            broadcast({
              type: 'playerUpdate',
              player: {
                id: data.playerId,
                x: player.x,
                y: player.y,
                directionX: player.directionX,
                directionY: player.directionY
              }
            }, data.playerId);
          }
          break;
        }


        case 'shoot': {
          const shooterId = data.playerId;
          if (!players.has(shooterId)) break;
          const shooter = players.get(shooterId);
          const name = shooter.displayName || '';

          const radius = isSpaced(name) ? 10 : 5;          // 空白玩家子彈大
          const dmg    = computeDamageByShooter(shooterId);
          const speed  = isExName(name) ? 6 : 10;          // Ex 降速

          if (isExName(name)) {
            const dirs = getFanDirections(data.directionX, data.directionY, 45, 4); // 45°、4顆
            for (const d of dirs) {
              const proj = {
                id: Math.random().toString(36).substr(2, 9),
                x: data.x, y: data.y,
                directionX: d.dx, directionY: d.dy,
                playerId: shooterId,
                speed, radius,
                damage: dmg
              };
              projectiles.push(proj);
              broadcast({ type: 'projectileCreated', projectile: proj });
            }
          } else {
            const proj = {
              id: Math.random().toString(36).substr(2, 9),
              x: data.x, y: data.y,
              directionX: data.directionX, directionY: data.directionY,
              playerId: shooterId,
              speed, radius,
              damage: dmg
            };
            projectiles.push(proj);
            broadcast({ type: 'projectileCreated', projectile: proj });
          }
          break;
        }
        case 'playerDamaged': {
          const victimId  = data.victimId;
          const shooterId = data.shooterId;
          const projectileId = data.projectileId; // 可選

          if (!players.has(victimId) || !players.has(shooterId)) break;

          const victim = players.get(victimId);
          const dmg = computeDamageByShooter(shooterId);

          if (projectileId) {
            const proj = projectiles.find(p => p.id === projectileId);
            if (proj && typeof proj.damage === 'number') {
              dmg = proj.damage;
            }
          }

          // ✅ 受擊者名字含 def → 傷害減半（無條件進位）
          if (hasDefInName(victim.displayName)) {
            dmg = Math.ceil(dmg / 2);
          }
          victim.hp = Math.max(0, victim.hp - dmg);
          victim.lastHitAt = Date.now();

          // 命中後把該子彈移除（如果有帶 id）
          if (projectileId) {
            const idx = projectiles.findIndex(p => p.id === projectileId);
            if (idx !== -1) {
              const [removed] = projectiles.splice(idx, 1);
              broadcast({ type: 'projectileDestroyed', projectileId: removed.id });
            }
          }

          if (victim.hp <= 0) {
            broadcast({ type: 'playerHit', playerId: victimId, killerId: shooterId });
            players.delete(victimId);
          } else {
            // 同步血量
            broadcast({ type: 'hpUpdate', playerId: victimId, hp: victim.hp });
          }
          break;
        }

        case 'playerHit': {
          const victimId = data.playerId;
          const killerId = data.killerId || null;

          broadcast({
            type: 'playerHit',
            playerId: victimId,
            killerId: killerId
          });

          players.delete(victimId);
          break;
        }
      }
    } catch (error) {
      logError('處理訊息錯誤:', error);
    }
  });

  ws.on('close', () => {
    for (let [playerId, player] of players) {
      if (player.ws === ws) {
        players.delete(playerId);
        broadcast({
          type: 'playerLeft',
          playerId
        });
        log('玩家離開:', playerId);
        break;
      }
    }
  });
});

function broadcast(message, excludePlayerId = null) {
  if (DEBUG && message.type !== 'projectilesUpdate' && message.type !== 'playerUpdate') {
    console.log('[Server] 廣播訊息：', message);
  }
  const messageStr = JSON.stringify(message);
  players.forEach((player, playerId) => {
    if (playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(messageStr);
    }
  });
}

setInterval(() => {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.directionX * proj.speed;
    proj.y += proj.directionY * proj.speed;

    if (proj.x < 0 || proj.x > 2000 || proj.y < 0 || proj.y > 2000) {
      projectiles.splice(i, 1);
      broadcast({
        type: 'projectileDestroyed',
        projectileId: proj.id
      });
    }
  }

  if (projectiles.length > 0) {
    broadcast({
      type: 'projectilesUpdate',
      projectiles
    });
  }
}, 50);

setInterval(() => {
  const now = Date.now();
  players.forEach((p) => {
    if (p.hp < 10 && now - p.lastHitAt >= 3000) {
      p.hp += 1;
      if (p.hp > 10) p.hp = 10;
      broadcast({ type: 'hpUpdate', playerId: p.id, hp: p.hp });
    }
  });
}, 500);


const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  log(`伺服器運行在 http://0.0.0.0:${PORT}`);
});
