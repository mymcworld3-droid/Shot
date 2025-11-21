// ------------------ 工具函數 ------------------
function hideDefInName(name) {
  return typeof name === 'string' ? name.replace(/def/gi, '') : name;
}
function displayToClients(name) {
  const cleaned = hideDefInName(name || '');
  const trimmed = cleaned.trim();
  return trimmed.length ? cleaned : '(玩家)';
}
function isSpaced(name) { return name.startsWith('    ') && name.endsWith('    '); }
function isExName(name) { return /^ex/i.test(name); }
function hasDefInName(name) { return typeof name === 'string' && name.toLowerCase().includes('def'); }
function computeDamageByShooter(id) {
  const p = window.game.players?.get(id);
  const name = p?.displayName || '';
  if (isSpaced(name)) return 18;
  if (isExName(name)) return 7;
  return 10;
}
function getFanDirections(baseDx, baseDy, totalDeg = 80, count = 4) {
  const len = Math.hypot(baseDx, baseDy) || 1;
  const ux = baseDx / len;
  const uy = baseDy / len;
  const baseAngle = Math.atan2(uy, ux);
  const half = (totalDeg * Math.PI / 180) / 2;
  const step = (count === 1 ? 0 : (totalDeg * Math.PI / 180) / (count - 1));
  const start = baseAngle - half;
  const dirs = [];
  for (let i = 0; i < count; i++) {
    const a = start + i * step;
    dirs.push({ dx: Math.cos(a), dy: Math.sin(a) });
  }
  return dirs;
}

// ------------------ 遊戲類 ------------------
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.player = null;
    this.otherPlayers = new Map();
    this.players = new Map(); // 客戶端存 WebSocket 玩家資料
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
    this.mousePos = {x:0,y:0};
    this.joystick = {active:false,startX:0,startY:0,currentX:0,currentY:0};
    this.init();
  }

  init() {
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupEventListeners();
    this.initSocket();
    this.initTips();
    this.initFirebase();
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
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
    if(!tipBox) return;
    const update = () => tipBox.textContent = tips[Math.floor(Math.random()*tips.length)];
    update();
    setInterval(update, 20000);
  }

  initSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('已連接到伺服器');
      this.socket.send(JSON.stringify({type:'spectateHello'}));
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleServerMessage(data);
    };

    this.socket.onclose = () => console.log('與伺服器斷開');
    this.socket.onerror = (err) => console.error(err);
  }

  handleServerMessage(data) {
    switch(data.type){
      case 'joinAck': this.playerNetId = data.id; break;
      case 'currentPlayers':
        data.players.forEach(p=>{
          if(p.id!==this.playerNetId){
            this.otherPlayers.set(p.id, new Player(p.x,p.y,'#e67e22',p.displayName,p.hp??10));
          }
        }); break;
      case 'playerJoined':
        if(data.player.id!==this.playerNetId)
          this.otherPlayers.set(data.player.id,new Player(data.player.x,data.player.y,'#e67e22',data.player.displayName,data.player.hp??10));
        break;
      case 'playerUpdate':
        if(data.player.id!==this.playerNetId && this.otherPlayers.has(data.player.id)){
          const p=this.otherPlayers.get(data.player.id);
          p.x=data.player.x; p.y=data.player.y;
          p.directionX=data.player.directionX; p.directionY=data.player.directionY;
        } break;
      case 'playerLeft': this.otherPlayers.delete(data.playerId); break;
      case 'projectileCreated':
        this.projectiles.push(new Projectile(data.projectile.x,data.projectile.y,data.projectile.directionX,data.projectile.directionY,data.projectile.playerId,data.projectile.radius,data.projectile.speed,data.projectile.id)); break;
      case 'hpUpdate':
        if(data.playerId===this.playerNetId && this.player) this.player.hp=data.hp;
        else if(this.otherPlayers.has(data.playerId)) this.otherPlayers.get(data.playerId).hp=data.hp;
        break;
      case 'playerHit':
        if(data.playerId===this.playerNetId) this.playerHit();
        else this.otherPlayers.delete(data.playerId);
        break;
    }
  }

  setupEventListeners() {
    document.getElementById('startBtn').addEventListener('click', ()=>this.startGame());
    document.addEventListener('keydown', e=>this.keys[e.key.toLowerCase()]=true);
    document.addEventListener('keyup', e=>this.keys[e.key.toLowerCase()]=false);
    document.addEventListener('mousemove', e=>{
      const rect=this.canvas.getBoundingClientRect();
      this.mousePos.x=e.clientX-rect.left;
      this.mousePos.y=e.clientY-rect.top;
    });
    document.addEventListener('mousedown', ()=>{ if(this.isRunning && !this.isMobile) this.shoot(); });
    this.setupTouchControls();
  }

  setupTouchControls() {
    const joystick=document.getElementById('joystick');
    const knob=document.getElementById('joystickKnob');
    let touchId=null;

    document.addEventListener('touchstart', e=>{
      if(e.touches.length>0){
        const touch=e.touches[0];
        touchId=touch.identifier;
        this.joystick.startX=this.joystick.currentX=touch.clientX;
        this.joystick.startY=this.joystick.currentY=touch.clientY;
        this.joystick.active=true;
        joystick.style.display='block';
        joystick.style.left=`${touch.clientX-60}px`;
        joystick.style.top=`${touch.clientY-60}px`;
      }
    });

    document.addEventListener('touchmove', e=>{
      for(let touch of e.touches){
        if(touch.identifier===touchId && this.joystick.active){
          this.joystick.currentX=touch.clientX;
          this.joystick.currentY=touch.clientY;
          const dx=this.joystick.currentX-this.joystick.startX;
          const dy=this.joystick.currentY-this.joystick.startY;
          const len=Math.sqrt(dx*dx+dy*dy);
          const maxSpeed=8;
          if(len>0 && this.player){
            const normX=dx/len; const normY=dy/len;
            const speed=Math.min(len*0.1,maxSpeed);
            this.player.move(normX*speed,normY*speed);
            this.player.setDirection(dx,dy);
          }
          e.preventDefault();
        }
      }
    });

    document.addEventListener('touchend', e=>{
      for(let touch of e.changedTouches){
        if(touch.identifier===touchId){
          this.joystick.active=false;
          touchId=null;
          knob.style.transform='translate(-50%,-50%)';
          joystick.style.display='none';
          if(this.isRunning) this.shoot();
        }
      }
    });
  }

  startGame() {
    const input=document.getElementById('playerIdInput');
    const rawId=input?input.value:'';
    this.playerName=rawId.trim()!==''?rawId:Math.random().toString(36).substr(2,9);
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');

    this.player=new Player(Math.random()*this.mapWidth/2+this.mapWidth/4, Math.random()*this.mapHeight/2+this.mapHeight/4,'#3498db',this.playerName);
    this.killCounts.clear();
    this.projectiles=[];
    this.otherPlayers.clear();
    this.isRunning=true;

    if(this.socket && this.socket.readyState===WebSocket.OPEN){
      this.socket.send(JSON.stringify({
        type:'playerJoin', displayName:this.playerName, x:this.player.x, y:this.player.y
      }));
    }

    this.gameLoop();
  }

  gameLoop() { if(!this.isRunning) return; this.update(); this.render(); requestAnimationFrame(()=>this.gameLoop()); }

  update() {
    if(!this.player) return;

    // 移動
    let mx=0,my=0;
    if(this.keys['w']||this.keys['arrowup']) my-=1;
    if(this.keys['s']||this.keys['arrowdown']) my+=1;
    if(this.keys['a']||this.keys['arrowleft']) mx-=1;
    if(this.keys['d']||this.keys['arrowright']) mx+=1;
    this.player.move(mx*5,my*5);

    // 設定方向（滑鼠或搖桿）
    if(!this.isMobile){
      const dx=this.mousePos.x - this.player.x;
      const dy=this.mousePos.y - this.player.y;
      this.player.setDirection(dx,dy);
    }

    // 移動後發送位置更新
    if(this.socket && this.socket.readyState===WebSocket.OPEN && this.playerNetId){
      this.socket.send(JSON.stringify({
        type:'playerUpdate',
        playerId:this.playerNetId,
        x:this.player.x,
        y:this.player.y,
        directionX:this.player.directionX,
        directionY:this.player.directionY
      }));
    }

    // 射擊邏輯
    if(this.isMobile && !this.joystick.active) this.shoot();

    // 更新子彈
    for(let i=this.projectiles.length-1;i>=0;i--){
      const proj=this.projectiles[i]; proj.update();
      if(proj.x<0||proj.x>this.mapWidth||proj.y<0||proj.y>this.mapHeight) this.projectiles.splice(i,1);
    }
  }

  render() {
    const camX=this.player?this.player.x-this.canvas.width/2:0;
    const camY=this.player?this.player.y-this.canvas.height/2:0;
    this.ctx.fillStyle='#34495e'; this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    this.ctx.save(); this.ctx.translate(-camX,-camY);
    this.ctx.fillStyle='#2c3e50'; this.ctx.fillRect(0,0,this.mapWidth,this.mapHeight);
    this.drawGrid();
    if(this.player) this.player.render(this.ctx);
    for(let [id,p] of this.otherPlayers) p.render(this.ctx);
    this.projectiles.forEach(p=>p.render(this.ctx));
    this.ctx.restore();

    this.ctx.fillStyle='white'; this.ctx.font='16px Arial'; this.ctx.textAlign='left';
    let now=Date.now();
    this.killFeed=this.killFeed.filter(msg=>now-msg.time<5000);
    this.killFeed.forEach((msg,index)=>this.ctx.fillText(msg.text,20,30+index*20));
  }

  drawGrid() {
    this.ctx.strokeStyle='#ffffff'; this.ctx.lineWidth=1; this.ctx.globalAlpha=0.06;
    for(let x=0;x<=this.mapWidth;x+=this.gridSize){ this.ctx.beginPath(); this.ctx.moveTo(x,0); this.ctx.lineTo(x,this.mapHeight); this.ctx.stroke(); }
    for(let y=0;y<=this.mapHeight;y+=this.gridSize){ this.ctx.beginPath(); this.ctx.moveTo(0,y); this.ctx.lineTo(this.mapWidth,y); this.ctx.stroke(); }
    this.ctx.globalAlpha=1;
  }

  shoot() {
    if (!this.playerNetId || !this.socket || this.socket.readyState !== WebSocket.OPEN || !this.player) return;

    let dx = this.player.directionX;
    let dy = this.player.directionY;
    if(dx===0 && dy===0) { dx=0; dy=-1; } // 零方向預設向上

    let bulletRadius = 5;
    if(this.playerName.startsWith("    ") && this.playerName.endsWith("    ")) bulletRadius=10;

    this.socket.send(JSON.stringify({
      type: 'shoot',
      x: this.player.x,
      y: this.player.y,
      directionX: dx,
      directionY: dy,
      playerId: this.playerNetId,
      radius: bulletRadius
    }));
  }

  playerHit() {
    this.killCounts.set(this.playerNetId,0); this.isRunning=false;
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    this.otherPlayers.clear(); this.projectiles=[]; this.player=null;
  }

  // ------------------ Firebase 聊天整合 ------------------
  initFirebase(){
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    if (!chatMessages || !chatInput || !sendBtn) return;

    // 發送訊息
    sendBtn.onclick = () => {
      const msg = chatInput.value.trim();
      if (!msg || !this.playerName) return;
      firebase.database().ref('chat').push({
        name: this.playerName,
        msg,
        time: Date.now()
      });
      chatInput.value = '';
    };

    // 監聽新訊息
    firebase.database().ref('chat').on('child_added', snap => {
      const { name, msg } = snap.val();
      const div = document.createElement('div');
      div.textContent = `${name}: ${msg}`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }
}

// ------------------ 玩家 ------------------
class Player {
  constructor(x,y,color='#3498db',id='',hp=10){
    this.x=x; this.y=y; this.radius=20; this.color=color;
    this.directionX=0; this.directionY=0;
    this.id=id; this.hp=hp;
  }
  move(dx,dy){
    this.x+=dx; this.y+=dy;
    const g=window.game;
    if(g){ this.x=Math.max(this.radius,Math.min(g.mapWidth-this.radius,this.x)); this.y=Math.max(this.radius,Math.min(g.mapHeight-this.radius,this.y)); }
  }
  setDirection(dx,dy){ const len=Math.sqrt(dx*dx+dy*dy); if(len>0){ this.directionX=dx/len; this.directionY=dy/len; } }
  render(ctx){
    ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(this.x,this.y,this.radius,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#2c3e50'; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(this.x,this.y);
    ctx.lineTo(this.x+this.directionX*this.radius*1.5,this.y+this.directionY*this.radius*1.5); ctx.stroke();
    if(this.id){ ctx.fillStyle='white'; ctx.font='14px Arial'; ctx.textAlign='center'; ctx.fillText(hideDefInName(this.id),this.x,this.y-this.radius-10); }
    const barW=40,barH=6; const hpPct=Math.max(0,Math.min(1,(this.hp??10)/10)); const barY=this.y-this.radius-7;
    ctx.fillStyle='#000'; ctx.fillRect(this.x-barW/2,barY,barW,barH);
    ctx.fillStyle='#27ae60'; ctx.fillRect(this.x-barW/2,barY,barW*hpPct,barH);
  }
}

// ------------------ 子彈 ------------------
class Projectile {
  constructor(x,y,dx,dy,playerId,radius=5,speed=10,id=null){ this.x=x; this.y=y; this.directionX=dx; this.directionY=dy; this.speed=speed; this.radius=radius; this.color='#e74c3c'; this.playerId=playerId; this.id=id; }
  update(){ this.x+=this.directionX*this.speed; this.y+=this.directionY*this.speed; }
  render(ctx){ ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(this.x,this.y,this.radius,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#c0392b'; ctx.lineWidth=1; ctx.stroke(); }
}

window.game = new Game();
