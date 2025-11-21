// ✅ 工具函數
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
    this.mapWidth = 2000;
    this.mapHeight = 2000;
    this.killFeed = [];
    this.isRunning = false;
    this.isMobile = true;
    this.socket = null;
    this.gridSize = 50;
    this.killCounts = new Map();
    this.keys = {};
    this.mousePos = { x: 0, y: 0 };
    this.joysticks = {
      move: { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 },
      shoot: { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 }
    };
    this.init();
  }

  init() {
    this.setupCanvas();
    this.setupEventListeners();
    this.initSocket();
    this.initTips();
  }

  initTips() {
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
        this.socket.send(JSON.stringify({ type: 'spectateHello' }));
      };
      this.socket.onmessage = (event) => this.handleServerMessage(JSON.parse(event.data));
      this.socket.onclose = () => { console.log('與伺服器連接斷開'); this.socket = null; };
      this.socket.onerror = (error) => console.error('WebSocket 錯誤:', error);
    } catch (error) {
      console.error('無法連接到伺服器:', error);
    }
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'joinAck': this.playerNetId = data.id; break;
      case 'currentPlayers':
        data.players.forEach(p => {
          if (p.id !== this.playerNetId) {
            this.otherPlayers.set(p.id, new Player(p.x, p.y, '#e67e22', p.displayName, p.hp ?? 10));
          }
        });
        break;
      case 'playerJoined':
        if (data.player.id !== this.playerNetId) {
          this.otherPlayers.set(data.player.id, new Player(
            data.player.x, data.player.y, '#e67e22', data.player.displayName, data.player.hp ?? 10
          ));
        }
        break;
      case 'playerUpdate':
        if (data.player.id !== this.playerNetId && this.otherPlayers.has(data.player.id)) {
          const p = this.otherPlayers.get(data.player.id);
          p.x = data.player.x;
          p.y = data.player.y;
          p.directionX = data.player.directionX;
          p.directionY = data.player.directionY;
        }
        break;
      case 'playerLeft': this.otherPlayers.delete(data.playerId); break;
      case 'projectileCreated':
        this.projectiles.push(new Projectile(
          data.projectile.x, data.projectile.y,
          data.projectile.directionX, data.projectile.directionY,
          data.projectile.playerId, data.projectile.radius || 5,
          data.projectile.speed || 10, data.projectile.id
        ));
        break;
      case 'systemMessage':
        this.killFeed.push({ text: data.message, time: Date.now() });
        break;
      case 'hpUpdate': {
        const id = data.playerId;
        const newHp = data.hp;
        if (id === this.playerNetId && this.player) this.player.hp = newHp;
        else if (this.otherPlayers.has(id)) this.otherPlayers.get(id).hp = newHp;
        break;
      }
      case 'playerHit': {
        const victimId = data.playerId;
        const killerId = data.killerId;
        if (victimId === this.playerNetId) this.playerHit();
        else this.otherPlayers.delete(victimId);
        let killerCount = killerId ? (this.killCounts.get(killerId)||0)+1 : null;
        if(killerId) this.killCounts.set(killerId,killerCount);
        this.killCounts.set(victimId,0);
        const suffix = (killerId && killerCount !== null) ? ` | 連殺:${killerCount}` : '';
        const killerName = killerId ?? '未知';
        this.killFeed.push({ text: `${killerName} 擊殺了 ${victimId}${suffix}`, time: Date.now() });
        break;
      }
    }
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
    document.addEventListener('click', (e) => { if (this.isRunning && !this.isMobile) this.shoot(); });
    this.setupTouchControls();
  }

  // ===================== 手機雙搖桿 =====================
  setupTouchControls() {
    const moveJoystick = document.getElementById('moveJoystick');
    const moveKnob = document.getElementById('moveKnob');
    const shootJoystick = document.getElementById('shootJoystick');
    const shootKnob = document.getElementById('shootKnob');

    let touchMap = {}; // 記錄 touchId -> 'move' 或 'shoot'

    document.addEventListener('touchstart', (e) => {
      for (let t of e.changedTouches) {
        const x = t.clientX;
        const y = t.clientY;
        if (x < window.innerWidth/2) {
          // 左半螢幕
          this.joysticks.move.active = true;
          this.joysticks.move.startX = this.joysticks.move.currentX = x;
          this.joysticks.move.startY = this.joysticks.move.currentY = y;
          moveJoystick.style.display='block';
          moveJoystick.style.left=`${x-60}px`; moveJoystick.style.top=`${y-60}px`;
          touchMap[t.identifier]='move';
        } else {
          // 右半螢幕
          this.joysticks.shoot.active = true;
          this.joysticks.shoot.startX = this.joysticks.shoot.currentX = x;
          this.joysticks.shoot.startY = this.joysticks.shoot.currentY = y;
          shootJoystick.style.display='block';
          shootJoystick.style.left=`${x-60}px`; shootJoystick.style.top=`${y-60}px`;
          touchMap[t.identifier]='shoot';
        }
      }
    });

    document.addEventListener('touchmove', (e) => {
      for (let t of e.touches) {
        const type = touchMap[t.identifier];
        if(!type) continue;
        this.joysticks[type].currentX = t.clientX;
        this.joysticks[type].currentY = t.clientY;
        this.updateJoystickKnob(type==='move'?moveKnob:shootKnob,this.joysticks[type]);
        e.preventDefault();
      }
    });

    document.addEventListener('touchend', (e) => {
      for (let t of e.changedTouches) {
        const type = touchMap[t.identifier];
        if(!type) continue;
        this.joysticks[type].active=false;
        delete touchMap[t.identifier];
        const knob = type==='move'?moveKnob:shootKnob;
        const joystickEl = type==='move'?moveJoystick:shootJoystick;
        knob.style.transform='translate(-50%,-50%)';
        joystickEl.style.display='none';
        if(type==='shoot' && this.isRunning) this.shoot();
      }
    });
  }

  updateJoystickKnob(knob, joy) {
    const dx = joy.currentX - joy.startX;
    const dy = joy.currentY - joy.startY;
    const distance = Math.sqrt(dx*dx + dy*dy);
    const maxDistance = 40;
    if(distance<=maxDistance) knob.style.transform=`translate(${dx-20}px, ${dy-20}px)`;
    else { const angle=Math.atan2(dy,dx); knob.style.transform=`translate(${Math.cos(angle)*maxDistance-20}px, ${Math.sin(angle)*maxDistance-20}px)`; }
  }

  // ===================== 遊戲邏輯 =====================
  startGame() {
    const input=document.getElementById('playerIdInput');
    const rawId = input?input.value:'';
    this.playerName = rawId.trim()!==''?rawId:Math.random().toString(36).substr(2,9);

    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');

    this.player = new Player(
      Math.random()*this.mapWidth/2+this.mapWidth/4,
      Math.random()*this.mapHeight/2+this.mapHeight/4,
      '#3498db', this.playerName
    );

    this.killCounts.clear(); this.projectiles=[]; this.otherPlayers.clear();
    this.isRunning=true;

    if(this.socket && this.socket.readyState===WebSocket.OPEN){
      this.socket.send(JSON.stringify({type:'playerJoin',displayName:this.playerName,x:this.player.x,y:this.player.y}));
    }

    this.gameLoop();
  }

  gameLoop() { if(!this.isRunning) return; this.update(); this.render(); requestAnimationFrame(()=>this.gameLoop()); }

  update() {
    this.updatePlayer();
    this.updateProjectiles();
    this.updateOtherPlayers();
    this.checkCollisions();
  }

  updatePlayer() {
    if(!this.player) return;
    if(this.isMobile && this.joysticks) {
      // 左半螢幕 → 移動
      const move = this.joysticks.move;
      if(move.active){
        const dx = move.currentX - move.startX;
        const dy = move.currentY - move.startY;
        const len = Math.hypot(dx,dy);
        if(len>0){
          const speed = Math.min(len*0.1,8);
          this.player.move(dx/len*speed, dy/len*speed);
        }
      }
      // 右半螢幕 → 射擊方向
      const shoot = this.joysticks.shoot;
      if(shoot.active){
        const dx = shoot.currentX - shoot.startX;
        const dy = shoot.currentY - shoot.startY;
        this.player.setDirection(dx,dy);
      }
    } else {
      // 桌機鍵盤/滑鼠保持原本
      let mx=0,my=0;
      if(this.keys['w']||this.keys['arrowup']) my-=1;
      if(this.keys['s']||this.keys['arrowdown']) my+=1;
      if(this.keys['a']||this.keys['arrowleft']) mx-=1;
      if(this.keys['d']||this.keys['arrowright']) mx+=1;
      this.player.move(mx*5,my*5);
      const dx = this.mousePos.x - this.player.x;
      const dy = this.mousePos.y - this.player.y;
      this.player.setDirection(dx,dy);
    }

    if(this.socket && this.socket.readyState===WebSocket.OPEN && this.playerNetId){
      this.socket.send(JSON.stringify({type:'playerUpdate',playerId:this.playerNetId,x:this.player.x,y:this.player.y,directionX:this.player.directionX,directionY:this.player.directionY}));
    }
  }

  updateOtherPlayers() {}
  updateProjectiles() { for(let i=this.projectiles.length-1;i>=0;i--){ const p=this.projectiles[i]; p.update(); if(p.x<0||p.x>this.mapWidth||p.y<0||p.y>this.mapHeight) this.projectiles.splice(i,1); } }

  checkCollisions() { 
    for(let proj of this.projectiles){
      if(proj.playerId!==this.playerNetId){
        const dist=Math.hypot(proj.x-this.player.x,proj.y-this.player.y);
        if(dist<this.player.radius+proj.radius){
          if(this.socket && this.socket.readyState===WebSocket.OPEN){
            this.socket.send(JSON.stringify({type:'playerDamaged',victimId:this.playerNetId,shooterId:proj.playerId,projectileId:proj.id}));
          }
          this.projectiles = this.projectiles.filter(p=>p.id!==proj.id);
          return;
        }
      }
    }
  }

  playerHit() {
    if(this.playerNetId) this.killCounts.set(this.playerNetId,0);
    this.isRunning=false;
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    this.otherPlayers.clear();
    this.projectiles=[];
    this.player=null;
  }

  shoot() {
    let bulletRadius = 5;
    if(this.playerName.startsWith("    ") && this.playerName.endsWith("    ")) bulletRadius=10;
    if(this.socket && this.socket.readyState===WebSocket.OPEN){
      this.socket.send(JSON.stringify({type:'shoot',x:this.player.x,y:this.player.y,directionX:this.player.directionX,directionY:this.player.directionY,playerId:this.playerNetId,radius:bulletRadius}));
    }
  }

  drawGridOnContext(ctx) {
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=1; ctx.globalAlpha=0.06;
    for(let x=0;x<=this.mapWidth;x+=this.gridSize){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,this.mapHeight);ctx.stroke();}
    for(let y=0;y<=this.mapHeight;y+=this.gridSize){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(this.mapWidth,y);ctx.stroke();}
    ctx.globalAlpha=1;
  }

  drawGrid() { this.drawGridOnContext(this.ctx); }

  render() {
    const camX = this.player ? this.player.x - this.canvas.width/2 : 0;
    const camY = this.player ? this.player.y - this.canvas.height/2 : 0;
    this.ctx.fillStyle='#34495e'; this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    this.ctx.save(); this.ctx.translate(-camX,-camY);
    this.ctx.fillStyle='#2c3e50'; this.ctx.fillRect(0,0,this.mapWidth,this.mapHeight);
    this.drawGrid();
    if(this.player) this.player.render(this.ctx);
    for(let [id,player] of this.otherPlayers.entries()) player.render(this.ctx);
    this.projectiles.forEach(p=>p.render(this.ctx));
    this.ctx.restore();

    this.ctx.fillStyle='white'; this.ctx.font='16px Arial'; this.ctx.textAlign='left';
    const now=Date.now();
    this.killFeed = this.killFeed.filter(msg => now - msg.time < 5000);
    this.killFeed.forEach((msg,index)=>{ this.ctx.fillText(msg.text,20,30+index*20); });
  }
}

// ===================== Player & Projectile =====================
class Player{
  constructor(x,y,color='#3498db',id='',hp=10){this.x=x;this.y=y;this.radius=20;this.color=color;this.directionX=0;this.directionY=0;this.id=id;this.hp=hp;}
  move(dx,dy){this.x+=dx;this.y+=dy;const g=window.game;if(g){this.x=Math.max(this.radius,Math.min(g.mapWidth-this.radius,this.x));this.y=Math.max(this.radius,Math.min(g.mapHeight-this.radius,this.y));}}
  setDirection(dx,dy){const len=Math.hypot(dx,dy);if(len>0){this.directionX=dx/len;this.directionY=dy/len;}}
  render(ctx){
    ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(this.x,this.y,this.radius,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#2c3e50'; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(this.x,this.y); ctx.lineTo(this.x+this.directionX*this.radius*1.5,this.y+this.directionY*this.radius*1.5); ctx.stroke();
    if(this.id){ ctx.fillStyle='white'; ctx.font='14px Arial'; ctx.textAlign='center'; ctx.fillText(hideDefInName(this.id),this.x,this.y-this.radius-10);}
    const barW=40,barH=6,barY=this.y-this.radius-7; const hpPct=Math.max(0,Math.min(1,(this.hp??10)/10));
    ctx.fillStyle='#000'; ctx.fillRect(this.x-barW/2,barY,barW,barH);
    ctx.fillStyle='red'; ctx.fillRect(this.x-barW/2,barY,barW*hpPct,barH);
  }
}

class Projectile{
  constructor(x,y,dx,dy,playerId,radius=5,speed=10,id){this.x=x;this.y=y;this.directionX=dx;this.directionY=dy;this.radius=radius;this.speed=speed;this.playerId=playerId;this.id=id;}
  update(){this.x+=this.directionX*this.speed;this.y+=this.directionY*this.speed;}
  render(ctx){ctx.fillStyle='yellow';ctx.beginPath();ctx.arc(this.x,this.y,this.radius,0,Math.PI*2);ctx.fill();}
}

// ===================== 啟動遊戲 =====================
window.game = new Game();
