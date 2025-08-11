// ✅ Fixed map support with camera movement and boundary constraints
const wsUrl = `wss://${window.location.host}`;

class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.player = null;
    this.otherPlayers = new Map();
    this.projectiles = [];
    this.mapWidth = 2000;
    this.mapHeight = 2000;
    this.killFeed = []; // 用來存擊殺訊息
    this.isRunning = false;
    this.isMobile = true;
    this.socket = null;
    this.gridSize = 50; 
    this.killCounts = new Map();
    this.keys = {};
    this.mousePos = { x: 0, y: 0 };
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
      case 'currentPlayers':
        data.players.forEach(playerData => {
          if (playerData.id !== this.playerId) {
            this.otherPlayers.set(playerData.id, new Player(playerData.x, playerData.y, '#e67e22', playerData.id));
          }
        });
        break;
      case 'playerJoined':
        if (data.player.id !== this.playerId) {
          this.otherPlayers.set(data.player.id, new Player(data.player.x, data.player.y, '#e67e22', data.player.id));
        }
        break;
      case 'playerUpdate':
        if (data.player.id !== this.playerId && this.otherPlayers.has(data.player.id)) {
          const player = this.otherPlayers.get(data.player.id);
          Object.assign(player, data.player);
        }
        break;
      case 'playerLeft':
        this.otherPlayers.delete(data.playerId);
        break;
      case 'projectileCreated':
        if (data.projectile.playerId !== this.playerId) {
          this.projectiles.push(new Projectile(
            data.projectile.x,
            data.projectile.y,
            data.projectile.directionX,
            data.projectile.directionY,
            data.projectile.playerId,
            data.projectile.radius || 5
          ));
        }
        break;
      case 'systemMessage':
        this.killFeed.push({
          text: data.message,
          time: Date.now()
        });
        break;
      case 'playerHit': {
        const victimId = data.playerId;
        const killerId = data.killerId;

        // UI & 狀態
        if (victimId === this.playerId) {
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
    document.addEventListener('keydown', (e) => this.keys[e.key.toLowerCase()] = true);
    document.addEventListener('keyup', (e) => this.keys[e.key.toLowerCase()] = false);
    document.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos.x = e.clientX - rect.left;
      this.mousePos.y = e.clientY - rect.top;
    });
    document.addEventListener('click', (e) => {
      if (this.isRunning && !this.isMobile) this.shoot();
    });
    this.setupTouchControls();
  }

  setupTouchControls() {
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    let touchId = null;

    document.addEventListener('touchstart', (e) => {
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
          if (this.isRunning) this.shoot();
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
    this.playerId = input && input.value.trim() !== ''
      ? input.value.trim()
      : Math.random().toString(36).substr(2, 9);
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    this.player = new Player( Math.random() * this.mapWidth /2 + this.mapWidth/4, Math.random() * this.mapHeight /2 + this.mapHeight /4, '#3498db',this.playerId);
    this.killCounts.clear();
    this.killCounts.set(this.playerId, 0);
    this.projectiles = [];
    this.otherPlayers.clear();
    this.isRunning = true;
    if (!this.hasJoinedBefore && this.socket && this.socket.readyState === WebSocket.OPEN) {
    // 廣播玩家加入事件
      this.socket.send(JSON.stringify({
        type: 'playerJoin',
        playerId: this.playerId,
        x: this.player.x,
        y: this.player.y
      }));  

      // 廣播系統訊息
      this.socket.send(JSON.stringify({
        type: 'systemMessage',
        message: `[系統] 玩家 ${this.playerId} 加入了遊戲`
      }));

      this.hasJoinedBefore = true;
    }
    this.gameLoop();
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
    if (this.isMobile) {
      if (this.joystick.active){
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
      }
    } else {
      let mx = 0, my = 0;
      if (this.keys['w'] || this.keys['arrowup']) my -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) my += 1;
      if (this.keys['a'] || this.keys['arrowleft']) mx -= 1;
      if (this.keys['d'] || this.keys['arrowright']) mx += 1;
      this.player.move(mx * 5, my * 5);
      const dx = this.mousePos.x - this.player.x;
      const dy = this.mousePos.y - this.player.y;
      this.player.setDirection(dx, dy);
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'playerUpdate',
        playerId: this.playerId,
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
      proj.update();
      if (proj.x < 0 || proj.x > this.mapWidth || proj.y < 0 || proj.y > this.mapHeight) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  checkCollisions() {
    for (let proj of this.projectiles) {
      if (proj.playerId !== this.playerId) {
        const dist = Math.sqrt((proj.x - this.player.x) ** 2 + (proj.y - this.player.y) ** 2);
        if (dist < this.player.radius + proj.radius) {
          // 告訴 server 我死了
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
              type: 'playerHit',
              playerId: this.playerId,
              killerId: proj.playerId
            }));
          }
          this.playerHit();
          return;
        }
      }
    }
  }

  playerHit() {
    if (this.playerId) this.killCounts.set(this.playerId, 0);
    this.isRunning = false;
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    this.otherPlayers.clear();
    this.projectiles = [];
    this.player = null;
  }

  shoot() {
    let bulletRadius = 5;
    if (this.playerId.startsWith("    ") && this.playerId.endsWith("    ")) {
      bulletRadius = 10; // ✅ 加大子彈
    }
    const projectile = new Projectile(
      this.player.x,
      this.player.y,
      this.player.directionX,
      this.player.directionY,
      this.playerId,
      bulletRadius
    );
    this.projectiles.push(projectile);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'shoot',
        x: this.player.x,
        y: this.player.y,
        directionX: this.player.directionX,
        directionY: this.player.directionY,
        playerId: this.playerId,
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
    const camX = this.player ? this.player.x - this.canvas.width / 2 : 0;
    const camY = this.player ? this.player.y - this.canvas.height / 2 : 0;
    // 畫「外框」→ 畫整個畫布（畫面背景）
    this.ctx.fillStyle = '#34495e'; // 外框色（畫布整體）
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.save();
    this.ctx.translate(-camX, -camY);
    // 畫「地圖」→ 地圖範圍內（置中玩家）
    this.ctx.fillStyle = '#2c3e50'; // 地圖內部顏色
    this.ctx.fillRect(0, 0, this.mapWidth, this.mapHeight);
    this.drawGrid();
    if (this.player) this.player.render(this.ctx);
    for (let [id, player] of this.otherPlayers.entries()) {
      if (player) player.render(this.ctx);
    }
    this.projectiles.forEach(p => p.render(this.ctx));
    this.ctx.restore();
    // 畫擊殺訊息
    this.ctx.fillStyle = 'white';
    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'left';
    let now = Date.now();
    this.killFeed = this.killFeed.filter(msg => now - msg.time < 5000); // 只留5秒
    this.killFeed.forEach((msg, index) => {
      this.ctx.fillText(msg.text, 20, 30 + index * 20);
    });
  }
}

class Player {
  constructor(x, y, color = '#3498db',id='') {
    this.x = x;
    this.y = y;
    this.radius = 20;
    this.color = color;
    this.directionX = 0;
    this.directionY = 0;
    this.id = id;
  }

  move(dx, dy) {
    this.x += dx;
    this.y += dy;
    const game = window.game;
    if (game) {
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
      ctx.fillText(this.id, this.x, this.y - this.radius - 10);
    }
  }
}

class Projectile {
  constructor(x, y, directionX, directionY, playerId) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.speed = 10;
    this.directionX = directionX;
    this.directionY = directionY;
    this.color = '#e74c3c';
    this.playerId = playerId;
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
