// ✅ Firebase 初始化
const firebaseConfig = {
  apiKey: "AIzaSyB132hSQq7DaHqvGhvvuLxxOM4tE7qATl8",
  authDomain: "all-game-6c562.firebaseapp.com",
  projectId: "all-game-6c562",
  storageBucket: "all-game-6c562.firebasestorage.app",
  messagingSenderId: "486227925026",
  appId: "1:486227925026:web:201f63385c470cc24dd27b",
  measurementId: "G-QMGXNJDBJZ"
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
