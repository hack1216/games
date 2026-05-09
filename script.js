// ─── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://YOUR-RENDER-APP-NAME.onrender.com';

const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

let myId = null;
let myRoomCode = null;
let selectedGame = 'poker';
let currentBetAmount = 0;
let roomState = null;
let isHost = false;
let winnerTimeout = null;

// ─── UNO Card Rendering ────────────────────────────────────────────────────────
const SUIT_CLASS = { hearts: 'suit-hearts', diamonds: 'suit-diamonds', clubs: 'suit-clubs', spades: 'suit-spades' };
const SUIT_SYM   = { hearts: '♥', diamonds: '◆', clubs: '♣', spades: '♠' };
const VAL_MAP    = { 'A': '1', '10': '0', 'J': '⟲', 'Q': '⊘', 'K': '+2' };

function unoVal(v) { return VAL_MAP[v] || v; }

function renderCard(card, small = false) {
  if (!card || card.hidden) {
    return `<div class="uno-card${small ? ' sm' : ''} hidden-card">
      <div class="card-oval"></div>
      <div class="card-center" style="color:rgba(255,255,255,.3)">?</div>
    </div>`;
  }
  const sc   = SUIT_CLASS[card.suit] || '';
  const sym  = SUIT_SYM[card.suit] || '';
  const val  = unoVal(card.value);
  const sz   = small ? ' sm' : '';
  return `<div class="uno-card${sz} ${sc}">
    <div class="card-oval"></div>
    <div class="card-corner tl">${val}<br/>${sym}</div>
    <div class="card-center">${val}</div>
    <div class="card-corner br">${val}<br/>${sym}</div>
  </div>`;
}

// ─── Seat Positions Around Oval ────────────────────────────────────────────────
// Returns {left, top} in % for seats around an ellipse
// Positions arranged so seat 0 (opponent) starts at top, going clockwise
// My player is always rendered separately in the bottom bar, not in the ring
function getSeatPositions(count) {
  // We distribute 'count' seats around the oval (excluding bottom — my player)
  // Oval is in the felt-wrap which is relative. We position as % of felt-wrap.
  // Angles: 0=top, clockwise. We skip the very bottom (my spot).
  // For 1 opponent: top center
  // For 2 opponents: top-left, top-right
  // For 3 opponents: top-left, top, top-right
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
  if (!name) { showToast('Enter your name'); return; }
  socket.emit('createRoom', { name, game: selectedGame });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { showToast('Enter your name'); return; }
  if (code.length !== 6) { showToast('Enter valid 6-character code'); return; }
  socket.emit('joinRoom', { name, code });
}

function addBots()   { socket.emit('addBots',   { code: myRoomCode }); }
function startGame() {
  if (!roomState || roomState.players.length < 2) { showToast('Need at least 2 players'); return; }
  socket.emit('startGame', { code: myRoomCode });
}

// ─── Socket Handlers ───────────────────────────────────────────────────────────
socket.on('roomCreated', ({ code, playerId }) => {
  myId = playerId; myRoomCode = code; isHost = true;
  document.getElementById('lobby-code').textContent = code;
  showScreen('screen-lobby');
});

socket.on('roomJoined', ({ code, playerId }) => {
  myId = playerId; myRoomCode = code; isHost = false;
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
    else                       renderBlackjack(room);
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
    el.innerHTML = `<span class="pname">${esc(p.name)}</span>
      <span class="phint">${p.id === room.hostId ? '👑 Host' : ''}${p.isBot ? '🤖 Bot' : ''}${!p.connected ? ' (off)' : ''}</span>`;
    pList.appendChild(el);
  });
  for (let i = room.players.length; i < 4; i++) {
    const el = document.createElement('div');
    el.className = 'lobby-slot';
    el.textContent = `Seat ${i + 1} — Empty`;
    pList.appendChild(el);
  }
  const ctrl = document.getElementById('lobby-host-controls');
  const gmsg = document.getElementById('lobby-guest-msg');
  if (isHost) {
    ctrl.classList.remove('hidden'); gmsg.classList.add('hidden');
    document.getElementById('btn-start-game').disabled = room.players.length < 2;
  } else {
    ctrl.classList.add('hidden'); gmsg.classList.remove('hidden');
  }
}

// ─── Render seat around the oval ───────────────────────────────────────────────
function renderSeatsRing(containerId, opponents, activeTurnIdx, players, game) {
  const ring = document.getElementById(containerId);
  ring.innerHTML = '';
  const positions = getSeatPositions(opponents.length);

  opponents.forEach((p, i) => {
    const pos   = positions[i] || { x: 50, y: 8 };
    const isActive = players.indexOf(p) === activeTurnIdx;

    let statusText = '';
    let extraClass = '';
    if (game === 'poker') {
      if (p.folded)   { statusText = 'Folded'; extraClass = 'folded'; }
      else if (p.allIn) statusText = '🔥 All In';
      else statusText = `Bet: ${p.totalBet || 0}`;
    } else {
      if (p.busted)      { statusText = '💥 Bust'; extraClass = 'busted'; }
      else if (p.standing) statusText = '✋ Stand';
      else if (p.result)   {
        statusText = p.result.toUpperCase();
        extraClass = `result-${p.result}`;
      }
      else statusText = p.bet > 0 ? `Bet: ${p.bet}` : '';
    }

    const scoreOrBet = game === 'blackjack' && p.blackjackScore > 0
      ? `Score: ${p.blackjackScore}`
      : `💰 ${p.chips}`;

    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = pos.x + '%';
    seat.style.top  = pos.y + '%';

    const cards = (p.cards || []).map(c => renderCard(c, true)).join('');

    seat.innerHTML = `
      <div class="seat-box ${isActive ? 'active-turn' : ''} ${extraClass}">
        <div class="seat-name">${isActive ? '▶ ' : ''}${esc(p.name)}${p.isBot ? ' 🤖' : ''}</div>
        <div class="seat-chips">${scoreOrBet}</div>
        <div class="seat-status">${statusText}</div>
        <div class="seat-cards">${cards}</div>
      </div>`;
    ring.appendChild(seat);
  });
}

// ─── Poker Render ──────────────────────────────────────────────────────────────
function renderPoker(room) {
  document.getElementById('poker-table').classList.remove('hidden');
  document.getElementById('blackjack-table').classList.add('hidden');

  document.getElementById('poker-pot').textContent   = room.pot;
  document.getElementById('poker-phase').textContent = room.phase.toUpperCase();
  if (room.log) document.getElementById('poker-log').textContent = room.log;

  // Community cards
  document.getElementById('community-cards').innerHTML =
    (room.communityCards || []).map(c => renderCard(c)).join('');

  // My player
  const me    = room.players.find(p => p.id === myId);
  const myIdx = room.players.findIndex(p => p.id === myId);
  if (me) {
    document.getElementById('my-poker-name').textContent  = me.name;
    document.getElementById('my-poker-chips').textContent = `💰 ${me.chips} chips`;
    document.getElementById('my-poker-bet').textContent   =
      me.folded ? '(folded)' : me.allIn ? '(ALL IN)' : `Bet: ${me.totalBet}`;
    document.getElementById('my-hole-cards').innerHTML =
      (me.cards || []).map(c => renderCard(c)).join('');
  }

  // Opponents ring
  const opponents = room.players.filter(p => p.id !== myId);
  renderSeatsRing('poker-seats', opponents, room.currentTurn, room.players, 'poker');

  // Action bar
  const actions  = document.getElementById('poker-actions');
  const isMyTurn = myIdx === room.currentTurn && room.phase !== 'showdown';
  const meFull   = room.players[myIdx];
  if (isMyTurn && meFull && !meFull.folded && !meFull.allIn) {
    actions.classList.remove('hidden');
    const callAmt = room.currentBet - (meFull.totalBet || 0);
    document.getElementById('btn-check').classList.toggle('hidden', callAmt > 0);
    const callBtn = document.getElementById('btn-call');
    callBtn.classList.toggle('hidden', callAmt === 0);
    if (callAmt > 0) callBtn.textContent = `Call ${callAmt}`;
  } else {
    actions.classList.add('hidden');
  }

  if (room.phase === 'showdown' && room.winners?.length) showWinnerPopup(room.winners, 'poker');
  else hideWinnerPopup();
}

// ─── Blackjack Render ──────────────────────────────────────────────────────────
function renderBlackjack(room) {
  document.getElementById('blackjack-table').classList.remove('hidden');
  document.getElementById('poker-table').classList.add('hidden');

  document.getElementById('bj-phase').textContent = room.phase.toUpperCase();
  if (room.log) document.getElementById('bj-log').textContent = room.log;

  // Dealer
  if (room.dealerCards?.length) {
    const visible = room.phase === 'playing'
      ? [room.dealerCards[0], { hidden: true }]
      : room.dealerCards;
    document.getElementById('dealer-cards').innerHTML = visible.map(c => renderCard(c)).join('');
    document.getElementById('dealer-score').textContent =
      room.phase !== 'playing' && room.dealerScore ? `(${room.dealerScore})` : '';
  } else {
    document.getElementById('dealer-cards').innerHTML = '';
    document.getElementById('dealer-score').textContent = '';
  }

  // My player
  const me    = room.players.find(p => p.id === myId);
  const myIdx = room.players.findIndex(p => p.id === myId);
  if (me) {
    document.getElementById('my-bj-name').textContent  = me.name;
    document.getElementById('my-bj-chips').textContent = `💰 ${me.chips} chips`;
    document.getElementById('my-bj-score').textContent =
      me.blackjackScore > 0 ? `Score: ${me.blackjackScore}` :
      me.bet > 0 ? `Bet: ${me.bet}` : '';
    document.getElementById('my-bj-cards').innerHTML =
      (me.cards || []).map(c => renderCard(c)).join('');
  }

  // Opponents ring
  const opponents = room.players.filter(p => p.id !== myId);
  renderSeatsRing('bj-seats', opponents, room.currentTurn, room.players, 'blackjack');

  // Controls
  const betCtrl = document.getElementById('bj-bet-controls');
  const actCtrl = document.getElementById('bj-actions');
  betCtrl.classList.add('hidden');
  actCtrl.classList.add('hidden');

  if (room.phase === 'betting' && me && !me.isBot && me.bet === 0) {
    betCtrl.classList.remove('hidden');
    updateBetDisplay();
  } else if (room.phase === 'playing' && myIdx === room.currentTurn && me && !me.standing && !me.busted) {
    actCtrl.classList.remove('hidden');
  }

  if (room.phase === 'showdown' && room.winners?.length) showWinnerPopup(room.winners, 'blackjack');
  else hideWinnerPopup();
}

// ─── Winner Popup ──────────────────────────────────────────────────────────────
function showWinnerPopup(winners, game) {
  if (winnerTimeout) clearTimeout(winnerTimeout);
  const popup   = document.getElementById('winner-popup');
  const content = document.getElementById('winner-content');
  popup.classList.remove('hidden');

  if (game === 'poker') {
    content.innerHTML = winners.map(w =>
      `<div class="winner-entry">
         <span class="wname">🏆 ${esc(w.name)}</span>
         <span class="whand">${esc(w.handName)}</span>
         <span class="wamount">+${w.amount} chips</span>
       </div>`).join('');
  } else {
    content.innerHTML = winners.map(w => {
      const cls = `result-${w.result}-txt`;
      const em  = w.result === 'win' ? '🏆' : w.result === 'lose' ? '💀' : '🤝';
      return `<div class="winner-entry">
        <span class="wname">${em} ${esc(w.name)}</span>
        <span class="${cls}"> ${w.result.toUpperCase()}</span>
        <span class="whand">Score: ${w.score}</span>
      </div>`;
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
  if      (type === 'fold')  socket.emit('poker:fold',  { code: myRoomCode });
  else if (type === 'check') socket.emit('poker:check', { code: myRoomCode });
  else if (type === 'call')  socket.emit('poker:call',  { code: myRoomCode });
  else if (type === 'allIn') socket.emit('poker:allIn', { code: myRoomCode });
  else if (type === 'raise') {
    const amount = parseInt(document.getElementById('raise-amount').value);
    if (!amount || amount <= 0) { showToast('Enter raise amount'); return; }
    socket.emit('poker:raise', { code: myRoomCode, amount });
    document.getElementById('raise-amount').value = '';
  }
}

// ─── Blackjack Actions ─────────────────────────────────────────────────────────
function addBet(amount) {
  const me = roomState?.players.find(p => p.id === myId);
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
  if (type === 'hit')   socket.emit('blackjack:hit',   { code: myRoomCode });
  if (type === 'stand') socket.emit('blackjack:stand', { code: myRoomCode });
}

// ─── Utils ─────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('join-code').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });
document.getElementById('join-name').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });
document.getElementById('create-name').addEventListener('keydown', e => { if (e.key==='Enter') createRoom(); });

// ─── CHEAT CODE: kkl3 (REVEAL OPPONENT CARDS) ────────────────────────────────
let cheatBuffer = '';
let cheatRevealCards = false;

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

    // refresh current screen safely
    if (roomState) {
      if (roomState.game === 'poker') {
        renderPoker(roomState);
      } else {
        renderBlackjack(roomState);
      }
    }

    cheatBuffer = '';
  }
});