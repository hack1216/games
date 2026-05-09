// ─── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://games-ql8x.onrender.com';

const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

let myId = null;
let myRoomCode = null;
let selectedGame = 'poker';
let currentBetAmount = 0;
let roomState = null;
let isHost = false;
let winnerTimeout = null;

// ─── CHEAT STATE ───────────────────────────────────────────────────────────────
let cheatRevealCards = false;
let cheatBuffer = '';

// ─── UNO Card Rendering (SUITS REMOVED) ────────────────────────────────────────
const SUIT_CLASS = {
  hearts: 'suit-hearts',
  diamonds: 'suit-diamonds',
  clubs: 'suit-clubs',
  spades: 'suit-spades'
};

const VAL_MAP = {
  'A': '1',
  '10': '0',
  'J': '⟲',
  'Q': '⊘',
  'K': '+2'
};

function unoVal(v) {
  return VAL_MAP[v] || v;
}

function renderCard(card, small = false) {
  if (!card || card.hidden) {
    return `<div class="uno-card${small ? ' sm' : ''} hidden-card">
      <div class="card-oval"></div>
      <div class="card-center" style="color:rgba(255,255,255,.3)">?</div>
    </div>`;
  }

  const sc = SUIT_CLASS[card.suit] || '';
  const val = unoVal(card.value);
  const sz = small ? ' sm' : '';

  return `<div class="uno-card${sz} ${sc}">
    <div class="card-oval"></div>
    <div class="card-corner tl">${val}</div>
    <div class="card-center">${val}</div>
    <div class="card-corner br">${val}</div>
  </div>`;
}

// ─── Seat Positions ────────────────────────────────────────────────────────────
function getSeatPositions(count) {
  const positions = {
    1: [{ x: 50, y: 8 }],
    2: [{ x: 20, y: 20 }, { x: 80, y: 20 }],
    3: [{ x: 18, y: 35 }, { x: 50, y: 6 }, { x: 82, y: 35 }],
  };
  return positions[count] || positions[1];
}

// ─── Screen Management ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg, dur = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), dur);
}

function copyCode() {
  const code = document.getElementById('lobby-code').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
  showToast('Copied!', 1500);
}

function selectGame(game, btn) {
  selectedGame = game;
  document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ─── Room Actions ──────────────────────────────────────────────────────────────
function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return showToast('Enter your name');
  socket.emit('createRoom', { name, game: selectedGame });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return showToast('Enter your name');
  if (code.length !== 6) return showToast('Enter valid 6-character code');
  socket.emit('joinRoom', { name, code });
}

function addBots() {
  socket.emit('addBots', { code: myRoomCode });
}

function startGame() {
  if (!roomState || roomState.players.length < 2) {
    return showToast('Need at least 2 players');
  }
  socket.emit('startGame', { code: myRoomCode });
}

// ─── Socket ────────────────────────────────────────────────────────────────────
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

socket.on('error', msg => showToast(msg));

socket.on('roomUpdate', room => {
  roomState = room;

  if (room.phase === 'lobby') {
    renderLobby(room);
    showScreen('screen-lobby');
  } else {
    showScreen('screen-game');
    if (room.game === 'poker') renderPoker(room);
    else renderBlackjack(room);
  }
});

// ─── Lobby ─────────────────────────────────────────────────────────────────────
function renderLobby(room) {
  document.getElementById('lobby-code').textContent = room.code;

  const pList = document.getElementById('lobby-players');
  pList.innerHTML = '';

  room.players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.innerHTML = `
      <span class="pname">${esc(p.name)}</span>
      <span class="phint">${p.id === room.hostId ? '👑 Host' : ''}</span>`;
    pList.appendChild(el);
  });
}

// ─── Seats ─────────────────────────────────────────────────────────────────────
function renderSeatsRing(containerId, opponents, activeTurnIdx, players, game) {
  const ring = document.getElementById(containerId);
  ring.innerHTML = '';

  const positions = getSeatPositions(opponents.length);

  opponents.forEach((p, i) => {
    const pos = positions[i] || { x: 50, y: 8 };
    const isActive = players.indexOf(p) === activeTurnIdx;

    const visibleCards = cheatRevealCards
      ? (p.cards || [])
      : (p.cards || []).map(() => ({ hidden: true }));

    const cards = visibleCards.map(c => renderCard(c, true)).join('');

    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = pos.x + '%';
    seat.style.top = pos.y + '%';

    seat.innerHTML = `
      <div class="seat-box ${isActive ? 'active-turn' : ''}">
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-chips">💰 ${p.chips}</div>
        <div class="seat-cards">${cards}</div>
      </div>`;
    ring.appendChild(seat);
  });
}

// ─── Poker ─────────────────────────────────────────────────────────────────────
function renderPoker(room) {
  document.getElementById('poker-table').classList.remove('hidden');
  document.getElementById('blackjack-table').classList.add('hidden');

  const me = room.players.find(p => p.id === myId);
  const myIdx = room.players.findIndex(p => p.id === myId);

  if (me) {
    document.getElementById('my-poker-name').textContent = me.name;
    document.getElementById('my-poker-chips').textContent = `💰 ${me.chips}`;
    document.getElementById('my-hole-cards').innerHTML =
      (me.cards || []).map(c => renderCard(c)).join('');
  }

  const opponents = room.players.filter(p => p.id !== myId);
  renderSeatsRing('poker-seats', opponents, room.currentTurn, room.players, 'poker');
}

// ─── Blackjack ────────────────────────────────────────────────────────────────
function renderBlackjack(room) {
  const opponents = room.players.filter(p => p.id !== myId);
  renderSeatsRing('bj-seats', opponents, room.currentTurn, room.players, 'blackjack');
}

// ─── Utils ─────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ─── CHEAT CODE (kkl3) ─────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  cheatBuffer += e.key.toLowerCase();
  if (cheatBuffer.length > 4) cheatBuffer = cheatBuffer.slice(-4);

  if (cheatBuffer === 'kkl3') {
    cheatRevealCards = !cheatRevealCards;

    showToast(
      cheatRevealCards ? '👁 Cheat ON' : '🙈 Cheat OFF',
      2000
    );

    if (roomState) {
      roomState.game === 'poker'
        ? renderPoker(roomState)
        : renderBlackjack(roomState);
    }

    cheatBuffer = '';
  }
});

// ─── ENTER KEY FIX ────────────────────────────────────────────────────────────
document.getElementById('join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
document.getElementById('join-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
document.getElementById('create-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') createRoom();
});