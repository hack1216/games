// ─── Config ───────────────────────────────────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://games-ql8x.onrender.com';

const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

// ─── State ────────────────────────────────────────────────────────────────────
let myId = null;
let myRoomCode = null;
let selectedGame = 'poker';
let roomState = null;
let isHost = false;
let currentBetAmount = 0;
let winnerTimeout = null;

// ─── UNO CARDS (CLEAN - NO SUITS) ────────────────────────────────────────────
function unoValue(val) {
  const map = { 'A': '1', '10': '0', 'J': '⟲', 'Q': '⊘', 'K': '+2' };
  return map[val] || val;
}

function renderCard(card, small = false) {
  if (!card || card.hidden) {
    return `<div class="uno-card${small ? ' sm' : ''} hidden-card">🂠</div>`;
  }

  const val = unoValue(card.value);

  return `
    <div class="uno-card${small ? ' sm' : ''}">
      <span class="center-val">${val}</span>
    </div>`;
}

// ─── SCREEN CONTROL ──────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

// ─── GAME SELECT ─────────────────────────────────────────────────────────────
function selectGame(game, btn) {
  selectedGame = game;
  document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ─── ROOM ACTIONS ────────────────────────────────────────────────────────────
function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return showToast('Enter name');
  socket.emit('createRoom', { name, game: selectedGame });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return showToast('Enter name');
  if (code.length !== 6) return showToast('Invalid code');
  socket.emit('joinRoom', { name, code });
}

function startGame() {
  if (!roomState) return;
  socket.emit('startGame', { code: myRoomCode });
}

// ─── SOCKET EVENTS ───────────────────────────────────────────────────────────
socket.on('roomCreated', ({ code, playerId }) => {
  myId = playerId;
  myRoomCode = code;
  isHost = true;
  document.getElementById('lobby-code').textContent = code;
  showScreen('screen-lobby');
});

socket.on('roomJoined', ({ code, playerId }) => {
  myId = playerId;
  myRoomCode = code;
  isHost = false;
  document.getElementById('lobby-code').textContent = code;
  showScreen('screen-lobby');
});

socket.on('error', showToast);

socket.on('roomUpdate', (room) => {
  roomState = room;

  if (room.phase === 'lobby') {
    renderLobby(room);
    showScreen('screen-lobby');
  } else {
    showScreen('screen-game');
    renderGame(room);
  }
});

// ─── LOBBY ───────────────────────────────────────────────────────────────────
function renderLobby(room) {
  const list = document.getElementById('lobby-players');
  list.innerHTML = '';

  room.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'lobby-player';
    div.textContent = p.name;
    list.appendChild(div);
  });
}

// ─── GAME RENDER ─────────────────────────────────────────────────────────────
function renderGame(room) {
  if (room.game === 'poker') renderPoker(room);
  else renderBlackjack(room);
}

// ─── POKER ───────────────────────────────────────────────────────────────────
function renderPoker(room) {
  document.getElementById('poker-pot').textContent = room.pot || 0;

  const me = room.players.find(p => p.id === myId);
  if (me) {
    document.getElementById('my-poker-name').textContent = me.name;
    document.getElementById('my-poker-chips').textContent = `💰 ${me.chips}`;
    document.getElementById('my-hole-cards').innerHTML = (me.cards || []).map(renderCard).join('');
  }

  const oppRow = document.getElementById('poker-opponents');
  oppRow.innerHTML = '';

  room.players.filter(p => p.id !== myId).forEach(p => {
    const div = document.createElement('div');
    div.className = 'opponent-card';

    div.innerHTML = `
      <div class="opp-name">${p.name}</div>
      <div class="opp-chips">💰 ${p.chips}</div>
    `;

    oppRow.appendChild(div);
  });
}

// ─── BLACKJACK ───────────────────────────────────────────────────────────────
function renderBlackjack(room) {
  document.getElementById('bj-phase').textContent = room.phase;

  const me = room.players.find(p => p.id === myId);
  if (me) {
    document.getElementById('my-bj-name').textContent = me.name;
    document.getElementById('my-bj-chips').textContent = `💰 ${me.chips}`;
    document.getElementById('my-bj-cards').innerHTML = (me.cards || []).map(renderCard).join('');
  }
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────
function pokerAction(type) {
  socket.emit(`poker:${type}`, { code: myRoomCode });
}

function bjAction(type) {
  socket.emit(`blackjack:${type}`, { code: myRoomCode });
}

// ─── BETTING ────────────────────────────────────────────────────────────────
function addBet(v) {
  currentBetAmount += v;
  document.getElementById('current-bet-display').textContent = `Bet: ${currentBetAmount}`;
}

function placeBet() {
  socket.emit('blackjack:bet', { code: myRoomCode, amount: currentBetAmount });
  currentBetAmount = 0;
}