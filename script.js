// ✅ 在檔案上方 Game class 前面加這個工具函數
function hideDefInName(name) {
  return typeof name === 'string'
    ? name.replace(/def/gi, '')
    : name;
}

class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.player = null;
    this.otherPlayers = new Map();
    this.playerName = '';     
    this.playerNetId = null;  
    this.projectiles = [];
    
    this.mapWidth = 1200;
    this.mapHeight = 1200;
    
    this.walls = [
      { x: 150, y: 150, w: 200, h: 50 },
      { x: 850, y: 150, w: 200, h: 50 },
      { x: 150, y: 1000, w: 200, h: 50 },
      { x: 850, y: 1000, w: 200, h: 50 },
      { x: 550, y: 400, w: 100, h: 400 },
      { x: 250, y: 500, w: 50,  h: 200 },
      { x: 900, y: 500, w: 50,  h: 200 }
    ];

    this.killFeed = []; 
    this.isRunning = true; //🔥 修改：一開始就設為 true，讓首頁持續渲染戰場
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.socket = null;
    this.gridSize = 50; 
    this.killCounts = new Map();
    this.keys = {};
    this.mousePos = { x: 0, y: 0 };
    this.selectedColor = '#3498db'; 
    this.joystick = {
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0
    };
    this.init();
  }

  init() {
    this.setupCanvas();
    this.setupEventListeners();
    this.initSocket();
    this.initTips(); 
    this.gameLoop(); //🔥 新增：初始化完成後直接啟動畫面的渲染迴圈
  }
  initTips() {                      // ✅ 新增方法
    const tips = [
      "如果名字前後加四個空白會有驚喜！",
      "不如在名字前加個ex試試！",
      "預判是重點！",
      "蝦打是殺人的精髓！",
      "打到他人會扣血",
      "來比比手速吧！",
      "不妨試試 tetrischjhs.netlify.app！"
    ];
    const tipBox = document.getElementById("tip-box");
    if (!tipBox) return;
    const update = () => {
      tipBox.textContent = tips[Math.floor(Math.random() * tips.length)];
    };
    update();
    setInterval(update, 20000);
  }

  initSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    try {
      this.socket = new WebSocket(wsUrl);
      this.socket.onopen = () => {
        console.log('已連接到伺服器');
        // ✅ 旁觀者打招呼，索取一次玩家清單
        this.socket.send(JSON.stringify({ type: 'spectateHello' }));
      };
      this.socket.onmessage = (event) => {
        // console.log('[Client] 收到訊息：', event.data);
        this.handleServerMessage(JSON.parse(event.data));
      };
      this.socket.onclose = () => { console.log('與伺服器連接斷開'); this.socket = null; };
      this.socket.onerror = (error) => console.error('WebSocket 錯誤:', error);
    } catch (error) {
      console.error('無法連接到伺服器:', error);
    }
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'joinAck':
      // 記下伺服器分給我的唯一 ID
        this.playerNetId = data.id;
        break;

      case 'currentPlayers':
        data.players.forEach(p => {
          if (p.id !== this.playerNetId) {
            //🔥 修改：把原本寫死的 '#e67e22' 換成 p.color
            this.otherPlayers.set(p.id, new Player(p.x, p.y, p.color || '#e67e22', p.displayName, p.hp ?? 10));
          }
        });
        break;
      case 'playerJoined':
        if (data.player.id !== this.playerNetId) {
          this.otherPlayers.set(
            data.player.id,
            //🔥 修改：接收新玩家的顏色 data.player.color
            new Player(data.player.x, data.player.y, data.player.color || '#e67e22', data.player.displayName, data.player.hp ?? 10)
          );
        }
        break;
      case 'playerUpdate':
        if (data.player.id !== this.playerNetId && this.otherPlayers.has(data.player.id)) {
          const p = this.otherPlayers.get(data.player.id);
          // 🔥 修改：不要直接改變實體座標，而是告訴他「你接下來該往哪裡平滑移動」
          p.targetX = data.player.x;
          p.targetY = data.player.y;
          p.directionX = data.player.directionX;
          p.directionY = data.player.directionY;
        }
        break;
      case 'playerLeft':
        this.otherPlayers.delete(data.playerId);
        break;
      case 'projectileCreated':
        this.projectiles.push(new Projectile(
          data.projectile.x,
          data.projectile.y,
          data.projectile.directionX,
          data.projectile.directionY,
          data.projectile.playerId,
          data.projectile.radius || 5,
          data.projectile.speed || 10,
          data.projectile.id
        ));
        break;
      //🔥 新增：監聽伺服器廣播的子彈銷毀，避免別人的子彈打中人後還留在畫面上
      case 'projectileDestroyed':
        this.projectiles = this.projectiles.filter(p => p.id !== data.projectileId);
        break;
      case 'systemMessage':
        this.killFeed.push({
          text: data.message,
          time: Date.now()
        });
        break;
      case 'hpUpdate': {
        const id = data.playerId;
        const newHp = data.hp;
        if (id === this.playerNetId && this.player) {
          this.player.hp = newHp;
        } else if (this.otherPlayers.has(id)) {
          this.otherPlayers.get(id).hp = newHp;
        }
        break;
      }
      case 'playerHit': {
        const victimId = data.playerId;
        const killerId = data.killerId;

        // UI & 狀態
        if (victimId === this.playerNetId) {
          this.playerHit();
        } else {
          console.log('刪除玩家:', victimId);
          this.otherPlayers.delete(victimId);
          this.render();
        }

        // 計數：killer +1、victim 歸零
        let killerCount = null;
        if (killerId) {
          killerCount = (this.killCounts.get(killerId) || 0) + 1;
          this.killCounts.set(killerId, killerCount);
        }
        this.killCounts.set(victimId, 0);

        // Kill feed：帶出累積 K
        const suffix = (killerId && killerCount !== null) ? ` | 連殺:${killerCount}` : '';
        const killerName = killerId ?? '未知';
        this.killFeed.push({
          text: `${killerName} 擊殺了 ${victimId}${suffix}`,
          time: Date.now()
        });
        break;
      }
    }
  }
  
  drawGridOnContext(ctx) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.06;
    for (let x = 0; x <= this.mapWidth; x += this.gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.mapHeight); ctx.stroke();
    }
    for (let y = 0; y <= this.mapHeight; y += this.gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.mapWidth, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  setupCanvas() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setupEventListeners() {
    document.getElementById('startBtn').addEventListener('click', () => this.startGame());
    
    document.querySelectorAll('.color-option').forEach(option => {
      option.addEventListener('click', (e) => {
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
        e.target.classList.add('selected');
        this.selectedColor = e.target.getAttribute('data-color');
      });
    });

    document.addEventListener('keydown', (e) => { if (e.key) this.keys[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', (e) => { if (e.key) this.keys[e.key.toLowerCase()] = false; });
    document.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos.x = e.clientX - rect.left;
      this.mousePos.y = e.clientY - rect.top;
    });
    document.addEventListener('click', (e) => {
      //🔥 修改：加上 this.player 判斷，避免在首頁觀戰時點擊滑鼠會不小心觸發射擊
      if (this.player && !this.joystick.active) this.shoot();
    });
    this.setupTouchControls();
  }

  setupTouchControls() {
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    let touchId = null;

    document.addEventListener('touchstart', (e) => {
      if (!this.player) return; //🔥 新增：如果還沒開始遊戲，不觸發虛擬搖桿
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        touchId = touch.identifier;
        this.joystick.startX = this.joystick.currentX = touch.clientX;
        this.joystick.startY = this.joystick.currentY = touch.clientY;
        this.joystick.active = true;
        joystick.style.display = 'block';
        joystick.style.left = `${touch.clientX - 60}px`;
        joystick.style.top = `${touch.clientY - 60}px`;
      }
    });

    document.addEventListener('touchmove', (e) => {
      for (let touch of e.touches) {
        if (touch.identifier === touchId && this.joystick.active) {
          this.joystick.currentX = touch.clientX;
          this.joystick.currentY = touch.clientY;
          this.updateJoystickKnob(knob);
          e.preventDefault();
        }
      }
    });

    document.addEventListener('touchend', (e) => {
      for (let touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          this.joystick.active = false;
          touchId = null;
          knob.style.transform = 'translate(-50%, -50%)';
          joystick.style.display = 'none';
          if (this.player) this.shoot(); //🔥 修改：確保有玩家實體才能射擊
          break;
        }
      }
    });
  }

  updateJoystickKnob(knob) {
    const deltaX = this.joystick.currentX - this.joystick.startX;
    const deltaY = this.joystick.currentY - this.joystick.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxDistance = 40;
    if (distance <= maxDistance) {
      knob.style.transform = `translate(${deltaX - 20}px, ${deltaY - 20}px)`;
    } else {
      const angle = Math.atan2(deltaY, deltaX);
      knob.style.transform = `translate(${Math.cos(angle) * maxDistance - 20}px, ${Math.sin(angle) * maxDistance - 20}px)`;
    }
  }

 startGame() {
    const input = document.getElementById('playerIdInput');
    const rawId = input ? input.value : '';
    this.playerName = rawId.trim() !== '' ? rawId : Math.random().toString(36).substr(2, 9);

    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');

    let spawnX, spawnY;
    let isColliding = true;
    const playerRadius = 20;

    while (isColliding) {
      spawnX = Math.random() * this.mapWidth / 2 + this.mapWidth / 4;
      spawnY = Math.random() * this.mapHeight / 2 + this.mapHeight / 4;
      isColliding = false;

      for (let w of this.walls) {
        if (spawnX + playerRadius > w.x && spawnX - playerRadius < w.x + w.w &&
            spawnY + playerRadius > w.y && spawnY - playerRadius < w.y + w.h) {
          isColliding = true; 
          break;
        }
      }
    }

    this.player = new Player(
      spawnX,
      spawnY,
      this.selectedColor, 
      this.playerName
    );

    this.killCounts.clear();
    this.projectiles = [];
    //🔥 修改：移除 this.otherPlayers.clear()，確保加入瞬間不會看到場上的人閃爍消失
    //🔥 修改：移除 this.isRunning = true 與 this.gameLoop()，因為迴圈已經在背景執行了

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'playerJoin',
        displayName: this.playerName,
        x: this.player.x,
        y: this.player.y,
        color: this.selectedColor
      }));
    }
  }

  gameLoop() {
    if (!this.isRunning) return;
    this.update();
    this.render();
    requestAnimationFrame(() => this.gameLoop());
  }

  update() {
    this.updatePlayer();
    this.updateProjectiles();
    this.updateOtherPlayers();
    this.checkCollisions();
  }

  updatePlayer() {
    if (!this.player) return;
    
    //🔥 修改：完美整合搖桿與鍵盤判斷。不再被 isMobile 綁死，解決平板或觸控筆電誤判導致完全動不了的問題
    if (this.joystick.active) {
      const dx = this.joystick.currentX - this.joystick.startX;
      const dy = this.joystick.currentY - this.joystick.startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const maxSpeed = 8;
        const normX = dx / len; 
        const normY = dy / len;
        const speed = Math.min(len * 0.1, maxSpeed);
        this.player.move(normX * speed, normY * speed);
        this.player.setDirection(dx, dy);
      } 
    } else {
      let mx = 0, my = 0;
      if (this.keys['w'] || this.keys['arrowup']) my -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) my += 1;
      if (this.keys['a'] || this.keys['arrowleft']) mx -= 1;
      if (this.keys['d'] || this.keys['arrowright']) mx += 1;

      //🔥 新增：對角線移動正規化，防止斜向移動速度過快
      if (mx !== 0 && my !== 0) {
        const len = Math.sqrt(mx * mx + my * my);
        mx /= len;
        my /= len;
      }

      this.player.move(mx * 5, my * 5);
      
      //🔥 修改：修復滑鼠瞄準偏移。因為畫面會跟著玩家移動，滑鼠(螢幕座標)應直接與螢幕中心做計算
      const dx = this.mousePos.x - (this.canvas.width / 2);
      const dy = this.mousePos.y - (this.canvas.height / 2);
      this.player.setDirection(dx, dy);
    }
    
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.playerNetId) {
      this.socket.send(JSON.stringify({
        type: 'playerUpdate',
        playerId: this.playerNetId,
        x: this.player.x,
        y: this.player.y,
        directionX: this.player.directionX,
        directionY: this.player.directionY
      }));
    }
  }

  updateOtherPlayers() {}

  updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      
      proj.bounces = proj.bounces || 0;

      // X 軸移動與反彈 (包含牆壁與世界邊緣)
      proj.x += proj.directionX * proj.speed;
      let hitX = false;
      for (let w of this.walls) {
        if (proj.x > w.x && proj.x < w.x + w.w && proj.y > w.y && proj.y < w.y + w.h) {
          hitX = true; break;
        }
      }
      // 檢查是否撞到世界左右邊緣
      if (proj.x < 0 || proj.x > this.mapWidth) hitX = true;

      if (hitX) {
        proj.directionX *= -1; // 反轉 X 方向
        proj.x += proj.directionX * proj.speed * 2; // 推離障礙物避免卡死
        proj.bounces++;
      }

      // Y 軸移動與反彈 (包含牆壁與世界邊緣)
      proj.y += proj.directionY * proj.speed;
      let hitY = false;
      for (let w of this.walls) {
        if (proj.x > w.x && proj.x < w.x + w.w && proj.y > w.y && proj.y < w.y + w.h) {
          hitY = true; break;
        }
      }
      // 檢查是否撞到世界上下邊緣
      if (proj.y < 0 || proj.y > this.mapHeight) hitY = true;

      if (hitY) {
        proj.directionY *= -1; // 反轉 Y 方向
        proj.y += proj.directionY * proj.speed * 2;
        proj.bounces++;
      }

      // 超過反彈次數就刪除 (不再因為飛出邊界刪除，因為現在已經會反彈了)
      if (proj.bounces > 2) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  checkCollisions() {
    // 🔥 新增：如果還沒有加入遊戲（觀戰中，沒有 this.player），就直接跳過碰撞計算
    if (!this.player) return;

    for (let proj of this.projectiles) {
      if (proj.playerId !== this.playerNetId) {  
        const dist = Math.hypot(proj.x - this.player.x, proj.y - this.player.y);
        if (dist < this.player.radius + proj.radius) {
          // 回報命中給伺服器，交由伺服器扣血／判死亡
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
              type: 'playerDamaged',
              victimId: this.playerNetId,
              shooterId: proj.playerId,
              projectileId: proj.id
            }));
          }
          // 客戶端先把這顆子彈移除，避免多次觸發（伺服器也會廣播正式移除）  
          this.projectiles = this.projectiles.filter(p => p.id !== proj.id);
          return; // 一次處理一顆就好
        }
      }
    }
  }

  playerHit() {
    if (this.playerNetId) this.killCounts.set(this.playerNetId, 0);
    //🔥 修改：不再設定 this.isRunning = false，讓迴圈繼續運作以維持觀戰畫面
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    //🔥 修改：不再執行 this.otherPlayers.clear()，讓你可以繼續在畫面上看到擊殺你的人
    this.projectiles = [];
    this.player = null;
  }

  shoot() {
    //🔥 新增：防抖機制，防止手機端同時觸發 touch 和 click 導致一次射出兩顆子彈
    const now = Date.now();
    if (now - (this.lastShootTime || 0) < 100) return; // 100毫秒內只能射擊一次
    this.lastShootTime = now;

    let bulletRadius = 5;
    if (this.playerName.startsWith("    ") && this.playerName.endsWith("    ")) {
      bulletRadius = 10; // ✅ 加大子彈
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'shoot',
        x: this.player.x,
        y: this.player.y,
        directionX: this.player.directionX,
        directionY: this.player.directionY,
        playerId: this.playerNetId,
        radius: bulletRadius
      }));
    }
  }

  drawGrid() {
    this.drawGridOnContext(this.ctx);
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.06;
    for (let x = 0; x <= this.mapWidth; x += this.gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.mapHeight);
      this.ctx.stroke();
    }
    for (let y = 0; y <= this.mapHeight; y += this.gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.mapWidth, y);
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1;
  }

  render() {
    //🔥 修改：判定焦點，自己 > 場上其他任一玩家 > 地圖正中心
    let focusX = this.mapWidth / 2;
    let focusY = this.mapHeight / 2;

    if (this.player) {
      focusX = this.player.x;
      focusY = this.player.y;
    } else if (this.otherPlayers.size > 0) {
      // 抓取 Map 中的第一個玩家當作觀戰焦點
      const firstPlayer = this.otherPlayers.values().next().value;
      focusX = firstPlayer.x;
      focusY = firstPlayer.y;
    }

    const camX = focusX - this.canvas.width / 2;
    const camY = focusY - this.canvas.height / 2;

    this.ctx.fillStyle = '#34495e'; 
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.save();
    this.ctx.translate(-camX, -camY);
    
    this.ctx.fillStyle = '#2c3e50'; 
    this.ctx.fillRect(0, 0, this.mapWidth, this.mapHeight);
    this.drawGrid();

    this.ctx.fillStyle = '#7f8c8d'; 
    for (let w of this.walls) {
      this.ctx.fillRect(w.x, w.y, w.w, w.h);
      this.ctx.strokeStyle = '#1a252f'; 
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    if (this.player) this.player.render(this.ctx);
    for (let [id, player] of this.otherPlayers.entries()) {
      if (player) player.render(this.ctx);
    }
    this.projectiles.forEach(p => p.render(this.ctx));
    this.ctx.restore();
    
    this.ctx.fillStyle = 'white';
    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'left';
    let now = Date.now();
    this.killFeed = this.killFeed.filter(msg => now - msg.time < 5000); 
    this.killFeed.forEach((msg, index) => {
      this.ctx.fillText(msg.text, 20, 30 + index * 20);
    });
  }
}

class Player {
  constructor(x, y, color = '#3498db', id = '', hp = 10) {
    this.x = x;
    this.y = y;
    // 🔥 新增：記錄插值用的目標座標，初始值等於出生座標
    this.targetX = x;
    this.targetY = y;
    
    this.radius = 20;
    this.color = color;
    this.directionX = 0;
    this.directionY = 0;
    this.id = id;
    this.hp = hp;
  }

  move(dx, dy) {
    const game = window.game;
    if (game) {
      //🔥 新增：玩家與牆壁的碰撞偵測
      let nextX = this.x + dx;
      let nextY = this.y + dy;

      for (let w of game.walls) {
        // 檢查 X 軸移動是否會撞牆
        if (nextX + this.radius > w.x && nextX - this.radius < w.x + w.w &&
            this.y + this.radius > w.y && this.y - this.radius < w.y + w.h) {
          dx = 0; // 撞牆則取消該方向移動
        }
        // 檢查 Y 軸移動是否會撞牆
        if (this.x + this.radius > w.x && this.x - this.radius < w.x + w.w &&
            nextY + this.radius > w.y && nextY - this.radius < w.y + w.h) {
          dy = 0; // 撞牆則取消該方向移動
        }
      }

      this.x += dx;
      this.y += dy;

      this.x = Math.max(this.radius, Math.min(game.mapWidth - this.radius, this.x));
      this.y = Math.max(this.radius, Math.min(game.mapHeight - this.radius, this.y));
    }
  }

  setDirection(dx, dy) {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      this.directionX = dx / len;
      this.directionY = dy / len;
    }
  }

  render(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(
      this.x + this.directionX * this.radius * 1.5,
      this.y + this.directionY * this.radius * 1.5
    );
    ctx.stroke();
    if (this.id) {
      ctx.fillStyle = 'white';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(hideDefInName(this.id), this.x, this.y - this.radius - 10);
    }
    // 血條（可選）
    const barW = 40, barH = 6;
    const hpPct = Math.max(0, Math.min(1, (this.hp ?? 10) / 10));
    const barY = this.y - this.radius - 7;
    ctx.fillStyle = '#000';
    ctx.fillRect(this.x - barW/2, barY, barW, barH);
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(this.x - barW/2, barY, barW * hpPct, barH);
  }
}

class Projectile {
  constructor(x, y, directionX, directionY, playerId,radius = 5, speed = 10, id = null) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.speed = speed;
    this.directionX = directionX;
    this.directionY = directionY;
    this.color = '#e74c3c';
    this.playerId = playerId;
    this.id = id;
  }

  update() {
    this.x += this.directionX * this.speed;
    this.y += this.directionY * this.speed;
  }

  render(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

window.game = new Game();
