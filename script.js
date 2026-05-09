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
let cheatBuffer = '';
let cheatRevealCards = false;

// ─── UNO Card Rendering ────────────────────────────────────────────────────────
const SUIT_CLASS = {
  hearts: 'suit-hearts',
  diamonds: 'suit-diamonds',
  clubs: 'suit-clubs',
  spades: 'suit-spades'
};

const SUIT_SYM = {
  hearts: '♥',
  diamonds: '◆',
  clubs: '♣',
  spades: '♠'
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
  const sym = SUIT_SYM[card.suit] || '';
  const val = unoVal(card.value);
  const sz = small ? ' sm' : '';

  return `<div class="uno-card${sz} ${sc}">
    <div class="card-oval"></div>
    <div class="card-corner tl">${val}<br/>${sym}</div>
    <div class="card-center">${val}</div>
    <div class="card-corner br">${val}<br/>${sym}</div>
  </div>`;
}

// ─── SEATS ─────────────────────────────────────────────────────────────────────
function getSeatPositions(count) {
  const positions = {
    1: [{ x: 50, y: 8 }],
    2: [{ x: 20, y: 20 }, { x: 80, y: 20 }],
    3: [{ x: 18, y: 35 }, { x: 50, y: 6 }, { x: 82, y: 35 }],
  };
  return positions[count] || positions[1];
}

// ─── SCREEN ────────────────────────────────────────────────────────────────────
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

// ─── CHEAT SYSTEM ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  cheatBuffer += e.key.toLowerCase();

  if (cheatBuffer.length > 4) {
    cheatBuffer = cheatBuffer.slice(-4);
  }

  if (cheatBuffer === 'kkl3') {
    cheatRevealCards = !cheatRevealCards;

    showToast(
      cheatRevealCards ? '👁 Cheat ON' : '🙈 Cheat OFF',
      2000
    );

    if (roomState) {
      if (roomState.game === 'poker') renderPoker(roomState);
      else renderBlackjack(roomState);
    }

    cheatBuffer = '';
  }
});

// ─── SOCKET ────────────────────────────────────────────────────────────────────
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

// ─── SEATS RENDER (FIXED CHEAT HERE) ───────────────────────────────────────────
function renderSeatsRing(containerId, opponents, activeTurnIdx, players, game) {
  const ring = document.getElementById(containerId);
  ring.innerHTML = '';

  const positions = getSeatPositions(opponents.length);

  opponents.forEach((p, i) => {
    const pos = positions[i] || { x: 50, y: 8 };
    const isActive = players.indexOf(p) === activeTurnIdx;

    const cards = (p.cards || []).map(c =>
      cheatRevealCards ? renderCard(c, true) : renderCard({ hidden: true }, true)
    ).join('');

    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = pos.x + '%';
    seat.style.top = pos.y + '%';

    seat.innerHTML = `
      <div class="seat-box ${isActive ? 'active-turn' : ''}">
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-cards">${cards}</div>
      </div>
    `;

    ring.appendChild(seat);
  });
}

// ─── ESCAPE ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}