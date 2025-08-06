const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

// 創建 WebSocket 伺服器
const wss = new WebSocket.Server({ server });

// 儲存所有連接的玩家
const players = new Map();
const projectiles = [];

wss.on('connection', (ws) => {
  console.log('新玩家連接');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'playerJoin':
          players.set(data.playerId, {
            id: data.playerId,
            x: data.x,
            y: data.y,
            directionX: 0,
            directionY: 0,
            ws: ws
          });
          ws.send(JSON.stringify({
            type: 'currentPlayers',
            players: Array.from(players.values()).map(p => ({
              id: p.id,
              x: p.x,
              y: p.y,
              directionX: p.directionX,
              directionY: p.directionY
            }))
          }));
          broadcast({
            type: 'playerJoined',
            player: {
              id: data.playerId,
              x: data.x,
              y: data.y,
              directionX: 0,
              directionY: 0
            }
          }, data.playerId);
          break;

        case 'playerUpdate':
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
                x: data.x,
                y: data.y,
                directionX: data.directionX,
                directionY: data.directionY
              }
            }, data.playerId);
          }
          break;

        case 'shoot':
          const projectile = {
            id: Math.random().toString(36).substr(2, 9),
            x: data.x,
            y: data.y,
            directionX: data.directionX,
            directionY: data.directionY,
            playerId: data.playerId,
            speed: 10
          };
          projectiles.push(projectile);
          broadcast({
            type: 'projectileCreated',
            projectile: projectile
          });
          break;

        case 'playerHit':
          broadcast({
            type: 'playerHit',
            playerId: data.playerId
          });
          players.delete(data.playerId);
          break;
      }
    } catch (error) {
      console.error('處理訊息錯誤:', error);
    }
  });

  ws.on('close', () => {
    for (let [playerId, player] of players) {
      if (player.ws === ws) {
        players.delete(playerId);
        broadcast({
          type: 'playerLeft',
          playerId: playerId
        });
        console.log('玩家離開:', playerId);
        break;
      }
    }
  });
});

function broadcast(message, excludePlayerId = null) {
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
      projectiles: projectiles
    });
  }
}, 50);

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器運行在 http://0.0.0.0:${PORT}`);
});
