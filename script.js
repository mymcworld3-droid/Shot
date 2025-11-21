// ✅ Firebase 初始化
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const chatRef = db.ref('chat');

// 監聽聊天訊息
chatRef.limitToLast(50).on('child_added', snapshot => {
  const msg = snapshot.val();
  const div = document.createElement('div');
  div.classList.add('msg');
  div.innerHTML = `<span class="name">${msg.name}:</span> ${msg.text}`;
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// 發送訊息
const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim() !== '') {
    const name = window.game?.playerName || '玩家';
    chatRef.push({ name, text: chatInput.value.trim(), time: Date.now() });
    chatInput.value = '';
  }
});

// ✅ 遊戲核心：保留你原本的 Game、Player、Projectile class
// 這裡可以直接貼你現有 script.js 的 Game class 與相關方法
// 並把 joystick 改為雙搖桿：左移動、右射擊
// 例如 updatePlayer() 裡面分左右半螢幕 touch，shoot() 用右搖桿
// 保留擊殺訊息、grid、hp、bullet 規則

window.game = new Game();
