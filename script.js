// ─── Config ───────────────────────────────────────────────────────────────────
// IMPORTANT: Replace with your Render backend URL after deploying
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://games-ql8x.onrender.com';

const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

// ─── State ────────────────────────────────────────────────────────────────────
let myId = null;
let myRoomCode = null;
let selectedGame = 'poker';
let currentBetAmount = 0;
let roomState = null;
let isHost = false;
let winnerTimeout = null;

// ─── UNO Card Mapping ─────────────────────────────────────────────────────────
const SUIT_CLASS = { hearts: 'suit-hearts', diamonds: 'suit-diamonds', clubs: 'suit-clubs', spades: 'suit-spades' };

function unoValue(val) {
  const map = { 'A': '1', '10': '0', 'J': '⟲', 'Q': '⊘', 'K': '+2' };
  return map[val] || val;
}

function unoSuitSymbol(suit) {
  const s = { hearts: '♥', diamonds: '◆', clubs: '♣', spades: '♠' };
  return s[suit] || suit;
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
// ─── Screen Management ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function copyCode() {
  const code = document.getElementById('lobby-code').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
  showToast('Room code copied!', 1500);
}

// ─── Game Selection ────────────────────────────────────────────────────────────
function selectGame(game, btn) {
  selectedGame = game;
  document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ─── Room Actions ─────────────────────────────────────────────────────────────
function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) { showToast('Enter your name'); return; }
  socket.emit('createRoom', { name, game: selectedGame });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { showToast('Enter your name'); return; }
  if (code.length !== 6) { showToast('Enter valid room code'); return; }
  socket.emit('joinRoom', { name, code });
}

function addBots() { socket.emit('addBots', { code: myRoomCode }); }

function startGame() {
  const room = roomState;
  if (!room) return;
  if (room.players.length < 2) { showToast('Need at least 2 players to start'); return; }
  socket.emit('startGame', { code: myRoomCode });
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
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

socket.on('error', (msg) => { showToast(msg); });

socket.on('roomUpdate', (room) => {
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

// ─── Lobby Render ─────────────────────────────────────────────────────────────
function renderLobby(room) {
  document.getElementById('lobby-code').textContent = room.code;
  const pList = document.getElementById('lobby-players');
  pList.innerHTML = '';
  room.players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.innerHTML = `<span class="pname">${escHtml(p.name)}</span><span class="phint">${p.id === room.hostId ? '👑 Host' : ''}${p.isBot ? '🤖 Bot' : ''}${!p.connected ? ' (disconnected)' : ''}</span>`;
    pList.appendChild(el);
  });
  for (let i = room.players.length; i < 4; i++) {
    const el = document.createElement('div');
    el.className = 'lobby-slot';
    el.textContent = `Seat ${i + 1} — Empty`;
    pList.appendChild(el);
  }

  const controls = document.getElementById('lobby-host-controls');
  const guestMsg = document.getElementById('lobby-guest-msg');
  if (isHost) {
    controls.classList.remove('hidden');
    guestMsg.classList.add('hidden');
    document.getElementById('btn-start-game').disabled = room.players.length < 2;
  } else {
    controls.classList.add('hidden');
    guestMsg.classList.remove('hidden');
  }
}

// ─── Poker Render ─────────────────────────────────────────────────────────────
function renderPoker(room) {
  document.getElementById('poker-table').classList.remove('hidden');
  document.getElementById('blackjack-table').classList.add('hidden');

  document.getElementById('poker-pot').textContent = room.pot;
  document.getElementById('poker-phase').textContent = room.phase.toUpperCase();
  if (room.log) document.getElementById('poker-log').textContent = room.log;

  // Community cards
  const cc = document.getElementById('community-cards');
  cc.innerHTML = room.communityCards.map(c => renderCard(c)).join('');

  // My player
  const me = room.players.find(p => p.id === myId);
  if (me) {
    document.getElementById('my-poker-name').textContent = me.name;
    document.getElementById('my-poker-chips').textContent = `💰 ${me.chips} chips`;
    document.getElementById('my-poker-bet').textContent = me.folded ? '(folded)' : me.allIn ? '(ALL IN)' : `Bet: ${me.totalBet}`;
    document.getElementById('my-hole-cards').innerHTML = me.cards.map(c => renderCard(c)).join('');
  }

  // Opponents
  const opponents = room.players.filter(p => p.id !== myId);
const container = document.getElementById('poker-opponents');

container.innerHTML = '';

const total = opponents.length;
const radius = 42; // how far from center (percentage)
const centerX = 50;
const centerY = 50;

opponents.forEach((p, i) => {
  const angle = (i / total) * 2 * Math.PI;

  const x = centerX + radius * Math.cos(angle);
  const y = centerY + radius * Math.sin(angle);

  const div = document.createElement('div');
  div.className = 'opponent-card';

  // important: absolute positioning around circle
  div.style.position = 'absolute';
  div.style.left = x + '%';
  div.style.top = y + '%';
  div.style.transform = 'translate(-50%, -50%)';

  div.innerHTML = `
    <div class="opp-name">${p.name}</div>
    <div class="opp-chips">💰 ${p.chips}</div>
    <div class="opp-bet">${p.folded ? 'Folded' : ''}</div>
  `;

  container.appendChild(div);
});
    const isActive = room.players.indexOf(p) === room.currentTurn;
    const div = document.createElement('div');
    div.className = `opponent-card${isActive ? ' active-turn' : ''}${p.folded ? ' folded' : ''}`;
    div.innerHTML = `
      <div class="opp-name">${isActive ? '▶ ' : ''}${escHtml(p.name)}${p.isBot ? ' 🤖' : ''}</div>
      <div class="opp-chips">💰 ${p.chips}</div>
      <div class="opp-bet">${p.folded ? 'Folded' : p.allIn ? '🔥 All In' : `Bet: ${p.totalBet}`}</div>
      <div class="opp-cards">${p.cards.map(c => renderCard(c, true)).join('')}</div>`;
    oppRow.appendChild(div);
  });

  // Action buttons
  const actions = document.getElementById('poker-actions');
  const myIdx = room.players.findIndex(p => p.id === myId);
  const isMyTurn = myIdx === room.currentTurn && room.phase !== 'showdown';
  const meFull = room.players[myIdx];

  if (isMyTurn && meFull && !meFull.folded && !meFull.allIn) {
    actions.classList.remove('hidden');
    const callAmount = room.currentBet - (meFull.totalBet || 0);
    document.getElementById('btn-check').classList.toggle('hidden', callAmount > 0);
    const callBtn = document.getElementById('btn-call');
    callBtn.classList.toggle('hidden', callAmount === 0);
    if (callAmount > 0) callBtn.textContent = `Call ${callAmount}`;
  } else {
    actions.classList.add('hidden');
  }

  // Show winner popup
  if (room.phase === 'showdown' && room.winners && room.winners.length > 0) {
    showWinnerPopup(room.winners, 'poker');
  } else {
    hideWinnerPopup();
  }
}

// ─── Blackjack Render ─────────────────────────────────────────────────────────
function renderBlackjack(room) {
  document.getElementById('blackjack-table').classList.remove('hidden');
  document.getElementById('poker-table').classList.add('hidden');

  document.getElementById('bj-phase').textContent = room.phase.toUpperCase();
  if (room.log) document.getElementById('bj-log').textContent = room.log;

  // Dealer
  const dealerCards = document.getElementById('dealer-cards');
  if (room.dealerCards && room.dealerCards.length > 0) {
    // Hide second card while playing
    const cards = room.phase === 'playing'
      ? [room.dealerCards[0], { hidden: true }]
      : room.dealerCards;
    dealerCards.innerHTML = cards.map(c => renderCard(c)).join('');
    document.getElementById('dealer-score').textContent = room.phase !== 'playing' && room.dealerScore ? `(${room.dealerScore})` : '';
  } else {
    dealerCards.innerHTML = '';
    document.getElementById('dealer-score').textContent = '';
  }

  // My player
  const me = room.players.find(p => p.id === myId);
  const myIdx = room.players.findIndex(p => p.id === myId);
  if (me) {
    document.getElementById('my-bj-name').textContent = me.name;
    document.getElementById('my-bj-chips').textContent = `💰 ${me.chips} chips`;
    document.getElementById('my-bj-score').textContent = me.blackjackScore > 0 ? `Score: ${me.blackjackScore}` : me.bet > 0 ? `Bet: ${me.bet}` : '';
    document.getElementById('my-bj-cards').innerHTML = (me.cards || []).map(c => renderCard(c)).join('');
  }

  // Opponents
  const oppRow = document.getElementById('bj-opponents');
  oppRow.innerHTML = '';
  room.players.filter(p => p.id !== myId).forEach(p => {
    const isActive = room.players.indexOf(p) === room.currentTurn;
    const div = document.createElement('div');
    div.className = `opponent-card${isActive ? ' active-turn' : ''}${p.busted ? ' busted' : ''}`;
    div.innerHTML = `
      <div class="opp-name">${isActive ? '▶ ' : ''}${escHtml(p.name)}${p.isBot ? ' 🤖' : ''}</div>
      <div class="opp-chips">💰 ${p.chips} | Bet: ${p.bet}</div>
      <div class="opp-bet">${p.busted ? '💥 Bust' : p.standing ? '✋ Stand' : p.blackjackScore > 0 ? `Score: ${p.blackjackScore}` : ''}</div>
      <div class="opp-cards">${(p.cards || []).map(c => renderCard(c, true)).join('')}</div>`;
    oppRow.appendChild(div);
  });

  // Controls
  const betCtrl = document.getElementById('bj-bet-controls');
  const actCtrl = document.getElementById('bj-actions');
  betCtrl.classList.add('hidden');
  actCtrl.classList.add('hidden');

  if (room.phase === 'betting' && me && !me.isBot) {
    if (me.bet === 0) {
      betCtrl.classList.remove('hidden');
      updateBetDisplay();
    }
  } else if (room.phase === 'playing' && myIdx === room.currentTurn && me && !me.standing && !me.busted) {
    actCtrl.classList.remove('hidden');
  }

  // Winner popup
  if (room.phase === 'showdown' && room.winners && room.winners.length > 0) {
    showWinnerPopup(room.winners, 'blackjack');
  } else {
    hideWinnerPopup();
  }
}

// ─── Winner Popup ─────────────────────────────────────────────────────────────
function showWinnerPopup(winners, game) {
  if (winnerTimeout) clearTimeout(winnerTimeout);
  const popup = document.getElementById('winner-popup');
  const content = document.getElementById('winner-content');
  popup.classList.remove('hidden');

  if (game === 'poker') {
    content.innerHTML = winners.map(w =>
      `<div class="winner-entry"><span class="wname">🏆 ${escHtml(w.name)}</span><br/><span class="whand">${escHtml(w.handName)}</span><br/><span class="wamount">+${w.amount} chips</span></div>`
    ).join('');
  } else {
    content.innerHTML = winners.map(w => {
      const cls = w.result === 'win' ? 'result-win' : w.result === 'lose' ? 'result-lose' : 'result-push';
      const emoji = w.result === 'win' ? '🏆' : w.result === 'lose' ? '💀' : '🤝';
      return `<div class="winner-entry"><span class="wname">${emoji} ${escHtml(w.name)}</span> <span class="${cls}">${w.result.toUpperCase()}</span> (${w.score})</div>`;
    }).join('');
  }

  winnerTimeout = setTimeout(hideWinnerPopup, 3800);
}

function hideWinnerPopup() {
  document.getElementById('winner-popup').classList.add('hidden');
}

// ─── Poker Actions ─────────────────────────────────────────────────────────────
function pokerAction(type) {
  if (!myRoomCode) return;
  if (type === 'fold') socket.emit('poker:fold', { code: myRoomCode });
  else if (type === 'check') socket.emit('poker:check', { code: myRoomCode });
  else if (type === 'call') socket.emit('poker:call', { code: myRoomCode });
  else if (type === 'allIn') socket.emit('poker:allIn', { code: myRoomCode });
  else if (type === 'raise') {
    const amount = parseInt(document.getElementById('raise-amount').value);
    if (!amount || amount <= 0) { showToast('Enter raise amount'); return; }
    socket.emit('poker:raise', { code: myRoomCode, amount });
    document.getElementById('raise-amount').value = '';
  }
}

// ─── Blackjack Actions ────────────────────────────────────────────────────────
function addBet(amount) {
  const me = roomState && roomState.players.find(p => p.id === myId);
  if (!me) return;
  currentBetAmount = Math.min(currentBetAmount + amount, me.chips);
  updateBetDisplay();
}

function clearBet() { currentBetAmount = 0; updateBetDisplay(); }

function updateBetDisplay() {
  const el = document.getElementById('current-bet-display');
  if (el) el.textContent = `Bet: ${currentBetAmount}`;
}

function placeBet() {
  if (!myRoomCode || currentBetAmount <= 0) { showToast('Place a bet first'); return; }
  socket.emit('blackjack:bet', { code: myRoomCode, amount: currentBetAmount });
  currentBetAmount = 0;
  updateBetDisplay();
}

function bjAction(type) {
  if (!myRoomCode) return;
  if (type === 'hit') socket.emit('blackjack:hit', { code: myRoomCode });
  else if (type === 'stand') socket.emit('blackjack:stand', { code: myRoomCode });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Keyboard shortcut: Enter on join code input
document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
document.getElementById('create-name').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });