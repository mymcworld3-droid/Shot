
const wsUrl = `wss://${window.location.host}`;
this.socket = new WebSocket(wsUrl);

class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.player = null;
    this.otherPlayers = new Map();
    this.projectiles = [];
    this.isRunning = false;
    this.isMobile = true;
    this.playerId = Math.random().toString(36).substr(2, 9);
    this.socket = null;
    this.gridSize = 50;
    
    // 輸入控制
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
    // 連接到 WebSocket 伺服器
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = () => {
        console.log('已連接到伺服器');
      };
      
      this.socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleServerMessage(data);
      };
      
      this.socket.onclose = () => {
        console.log('與伺服器連接斷開');
        this.socket = null;
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket 錯誤:', error);
      };
    } catch (error) {
      console.error('無法連接到伺服器:', error);
    }
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'currentPlayers':
        // 接收當前所有玩家
        data.players.forEach(playerData => {
          if (playerData.id !== this.playerId) {
            this.otherPlayers.set(playerData.id, new Player(
              playerData.x,
              playerData.y,
              '#e67e22'
            ));
          }
        });
        break;
        
      case 'playerJoined':
        // 新玩家加入
        if (data.player.id !== this.playerId) {
          this.otherPlayers.set(data.player.id, new Player(
            data.player.x,
            data.player.y,
            '#e67e22'
          ));
        }
        break;
        
      case 'playerUpdate':
        // 更新其他玩家位置
        if (data.player.id !== this.playerId && this.otherPlayers.has(data.player.id)) {
          const player = this.otherPlayers.get(data.player.id);
          player.x = data.player.x;
          player.y = data.player.y;
          player.directionX = data.player.directionX;
          player.directionY = data.player.directionY;
        }
        break;
        
      case 'playerLeft':
        // 玩家離開
        this.otherPlayers.delete(data.playerId);
        break;
        
      case 'projectileCreated':
        // 新的圓球
        if (data.projectile.playerId !== this.playerId) {
          this.projectiles.push(new Projectile(
            data.projectile.x,
            data.projectile.y,
            data.projectile.directionX,
            data.projectile.directionY,
            data.projectile.playerId
          ));
        }
        break;
        
      case 'playerHit':
        // 玩家被擊中
        if (data.playerId === this.playerId) {
          this.playerHit();
        } else {
          this.otherPlayers.delete(data.playerId);
        }
        break;
    }
  }

  setupEventListeners() {
    // 開始按鈕
    document.getElementById('startBtn').addEventListener('click', () => {
      this.startGame();
    });

    // 鍵盤事件
    document.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    // 滑鼠事件
    document.addEventListener('mousemove', (e) => {
      const rect = this.canvas?.getBoundingClientRect();
      if (rect) {
        this.mousePos.x = e.clientX - rect.left;
        this.mousePos.y = e.clientY - rect.top;
      }
    });

    document.addEventListener('click', (e) => {
      if (this.isRunning && !this.isMobile) {
        this.shoot();
      }
    });

    // 觸控事件（手機版搖桿）
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

        // 設定起點
        this.joystick.startX = touch.clientX;
        this.joystick.startY = touch.clientY;
        this.joystick.currentX = touch.clientX;
        this.joystick.currentY = touch.clientY;
        this.joystick.active = true;

        // 顯示搖桿
        joystick.style.display = 'block';
        joystick.style.left = `${touch.clientX - 60}px`; // 120 / 2
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

          if (this.isRunning) {
            this.shoot(); // 可選
          }
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
      const limitedX = Math.cos(angle) * maxDistance;
      const limitedY = Math.sin(angle) * maxDistance;
      knob.style.transform = `translate(${limitedX - 20}px, ${limitedY - 20}px)`;
    }
  }

  setupCanvas() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });
  }

  resizeCanvas() {
    if (this.canvas) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
  }

  startGame() {
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    this.player = new Player(this.canvas.width / 2, this.canvas.height / 2, '#3498db');
    this.projectiles = [];
    this.otherPlayers.clear();
    this.isRunning = true;
    
    // 通知伺服器玩家加入
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'playerJoin',
        playerId: this.playerId,
        x: this.player.x,
        y: this.player.y
      }));
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
    if (this.isMobile) {
      // 手機版控制
      if (this.joystick.active) {
        const deltaX = this.joystick.currentX - this.joystick.startX;
        const deltaY = this.joystick.currentY - this.joystick.startY;
        
        this.player.move(deltaX * 0.1, deltaY * 0.1);
        this.player.setDirection(deltaX, deltaY);
      }
    } else {
      // 電腦版控制
      let moveX = 0;
      let moveY = 0;
      
      if (this.keys['w'] || this.keys['arrowup']) moveY -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) moveY += 1;
      if (this.keys['a'] || this.keys['arrowleft']) moveX -= 1;
      if (this.keys['d'] || this.keys['arrowright']) moveX += 1;
      
      this.player.move(moveX * 5, moveY * 5);
      
      // 面朝滑鼠方向
      const deltaX = this.mousePos.x - this.player.x;
      const deltaY = this.mousePos.y - this.player.y;
      this.player.setDirection(deltaX, deltaY);
    }

    // 發送玩家位置給伺服器
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

  updateOtherPlayers() {
    // 其他玩家的更新將透過 WebSocket 接收
  }

  updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update();
      
      // 移除超出邊界的圓球
      if (proj.x < 0 || proj.x > this.canvas.width || 
          proj.y < 0 || proj.y > this.canvas.height) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  checkCollisions() {
    // 檢查玩家被擊中
    for (let proj of this.projectiles) {
      if (proj.playerId !== this.playerId) {
        const distance = Math.sqrt(
          (proj.x - this.player.x) ** 2 + (proj.y - this.player.y) ** 2
        );
        if (distance < this.player.radius + proj.radius) {
          this.playerHit();
          return;
        }
      }
    }
  }

  playerHit() {
    this.isRunning = false;
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    this.otherPlayers.clear();
    this.projectiles = [];
    this.player = null;
  }

  shoot() {
    const projectile = new Projectile(
      this.player.x, 
      this.player.y, 
      this.player.directionX, 
      this.player.directionY,
      this.playerId
    );
    this.projectiles.push(projectile);
    
    // 發送射擊到伺服器
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'shoot',
        x: this.player.x,
        y: this.player.y,
        directionX: this.player.directionX,
        directionY: this.player.directionY,
        playerId: this.playerId
      }));
    }
  }

  drawGrid() {
    this.ctx.strokeStyle = '#2c3e50';
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.3;

    // 繪製垂直線
    for (let x = 0; x <= this.canvas.width; x += this.gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    // 繪製水平線
    for (let y = 0; y <= this.canvas.height; y += this.gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    this.ctx.globalAlpha = 1;
  }

  render() {
    // 清除畫布
    this.ctx.fillStyle = '#34495e';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  
    // 繪製網格
    this.drawGrid();
  
    // 繪製玩家
    if (this.player) {
      this.player.render(this.ctx);
    }

    // 繪製其他玩家
    this.otherPlayers.forEach(player => player.render(this.ctx));
  
    // 繪製圓球
    this.projectiles.forEach(proj => proj.render(this.ctx));
  }
}
class Player {
  constructor(x, y, color = '#3498db') {
    this.x = x;
    this.y = y;
    this.radius = 20;
    this.color = color;
    this.directionX = 0;
    this.directionY = 0;
  }

  move(deltaX, deltaY) {
    this.x += deltaX;
    this.y += deltaY;
    
    // 邊界檢查
    const canvas = document.getElementById('gameCanvas');
    this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y));
  }

  setDirection(deltaX, deltaY) {
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (length > 0) {
      this.directionX = deltaX / length;
      this.directionY = deltaY / length;
    }
  }

  render(ctx) {
    // 繪製玩家圓形
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // 繪製邊框
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 繪製方向指示器
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(
      this.x + this.directionX * this.radius * 1.5,
      this.y + this.directionY * this.radius * 1.5
    );
    ctx.stroke();
  }
}

class Projectile {
  constructor(x, y, directionX, directionY, playerId) {
    this.x = x;
    this.y = y;
    this.radius = 5;
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
    
    // 繪製邊框
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// 初始化遊戲
const game = new Game();
