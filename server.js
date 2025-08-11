
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

function computeBulletRadiusById(netId) {
  const p = players.get(netId);
  const name = p?.displayName || '';
  return (name.startsWith('    ') && name.endsWith('    ')) ? 10 : 5;
}

wss.on('connection', (ws) => {
  console.log('新玩家連接');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type){
        case 'spectateHello':
          ws.send(JSON.stringify({
            type: 'currentPlayers',
            players: Array.from(players.values()).map(p => ({
              id: p.id,
              displayName : p.displayName,
              x: p.x, y: p.y,
              directionX: p.directionX, directionY: p.directionY
            }))
          }));
          break;
        case 'playerJoin': {
          // 如果已經有人用這個名字，給他加一個隨機尾碼
          const baseName = String(data.displayName ?? '').slice(0, 32); // 防爆字串
          let finalId = baseName;
          while ([...players.keys()].includes(finalId)) {
            finalId = baseName + '_' + Math.floor(Math.random() * 1000);
          }

          ws._internalId = finalId; // 記錄在連線上  
          ws._displayName = baseName; // 玩家真正輸入的名字（顯示用）

          players.set(finalId, {
            id: finalId,
            displayName: baseName,
            x: data.x,
            y: data.y,
            directionX: 0,
            directionY: 0,
            ws
          });
          
          ws.send(JSON.stringify({ type: 'joinAck', id: finalId, displayName: ws._displayName }));
          // 發送當前所有玩家給新玩家
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

          // 通知其他玩家
          broadcast({    
            type: 'playerJoined',
            player: {
              id: finalId,
              displayName: baseName,
              x: data.x,
              y: data.y,
              directionX: 0,
              directionY: 0
            }
          }, finalId);
          break;
        case 'playerUpdate':
          // 更新玩家位置
          if (players.has(data.playerId)) {
            const player = players.get(data.playerId);
            player.x = data.x;
            player.y = data.y;
            player.directionX = data.directionX;
            player.directionY = data.directionY;
            
            // 廣播玩家位置更新
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
          // 處理射擊
          const shooterId = data.playerId;
          if (!players.has(shooterId)) break; // 非法或過期
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
          
          // 廣播新的圓球
          broadcast({
            type: 'projectileCreated',
            projectile: projectile
          });
          break;
          
        case 'playerHit': {
          const victimId = data.playerId;
          const killerId = data.killerId || null;  // ✅ 接住 killerId

          // 廣播給所有人（包含擊殺者與旁觀者）
          broadcast({
            type: 'playerHit',
            playerId: victimId,
            killerId: killerId                  // ✅ 廣播 killerId
          });

          players.delete(victimId);
          break;
        }
      }     
    } catch (error) {
      console.error('處理訊息錯誤:', error);
    }
  });
  
  ws.on('close', () => {
    // 玩家斷線，移除玩家
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

// 廣播訊息給所有玩家（除了發送者）
function broadcast(message, excludePlayerId = null) {
  if (message.type !== 'projectilesUpdate'&&message.type !== 'playerUpdate') {
    console.log('[Server] 廣播訊息：', message);
  }
  const messageStr = JSON.stringify(message);
  players.forEach((player, playerId) => {
    if (playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(messageStr);
    }
  });
}

// 更新圓球位置
setInterval(() => {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.directionX * proj.speed;
    proj.y += proj.directionY * proj.speed;
    
    // 移除超出邊界的圓球（假設地圖大小為 2000x2000）
    if (proj.x < 0 || proj.x > 2000 || proj.y < 0 || proj.y > 2000) {
      projectiles.splice(i, 1);
      broadcast({
        type: 'projectileDestroyed',
        projectileId: proj.id
      });
    }
  }
  
  // 廣播圓球位置更新
  if (projectiles.length > 0) {
    broadcast({
      type: 'projectilesUpdate',
      projectiles: projectiles
    });
  }
}, 50); // 每 50ms 更新一次

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`伺服器運行在 http://0.0.0.0:${PORT}`);
});
