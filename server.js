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
              displayName: p.displayName,
              x: p.x, y: p.y,
              directionX: p.directionX, directionY: p.directionY
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
            ws
          });

          ws.send(JSON.stringify({ type: 'joinAck', id: finalId, displayName: ws._displayName }));

          ws.send(JSON.stringify({
            type: 'currentPlayers',
            players: Array.from(players.values()).map(p => ({
              id: p.id,
              displayName: p.displayName,
              x: p.x,
              y: p.y,
              directionX: p.directionX,
              directionY: p.directionY
            }))
          }));

          broadcast({
            type: 'playerJoined',
            player: {
              id: finalId,
              displayName: ws._displayName,
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

            // 計算速度倍率
            const speedMult = computeSpeedMultiplierById(data.playerId);

            // 伺服器端直接調整位置（防止外掛把倍率亂改）
            player.x += data.directionX * speedMult;
            player.y += data.directionY * speedMult;
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
          const radius = computeBulletRadiusById(shooterId);

          const projectile = {
            id: Math.random().toString(36).substr(2, 9),
            x: data.x,
            y: data.y,
            directionX: data.directionX,
            directionY: data.directionY,
            playerId: shooterId,
            speed: 10,
            radius
          };

          projectiles.push(projectile);

          broadcast({
            type: 'projectileCreated',
            projectile
          });
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  log(`伺服器運行在 http://0.0.0.0:${PORT}`);
});
