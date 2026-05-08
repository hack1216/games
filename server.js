const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const path = require('path');

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Deck Utilities ───────────────────────────────────────────────────────────
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  if (card.value === 'A') return 11;
  return parseInt(card.value);
}

// ─── Poker Hand Evaluation ────────────────────────────────────────────────────
function pokerCardRank(v) {
  const order = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  return order[v] || 0;
}

function getBestHand(holeCards, communityCards) {
  const all = [...holeCards, ...communityCards];
  const combos = getCombinations(all, 5);
  let best = null;
  for (const combo of combos) {
    const ranked = rankHand(combo);
    if (!best || compareHandRanks(ranked, best) > 0) best = ranked;
  }
  return best;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function rankHand(cards) {
  const sorted = [...cards].sort((a, b) => pokerCardRank(b.value) - pokerCardRank(a.value));
  const vals = sorted.map(c => pokerCardRank(c.value));
  const suits = sorted.map(c => c.suit);
  const valCounts = {};
  vals.forEach(v => { valCounts[v] = (valCounts[v] || 0) + 1; });
  const counts = Object.values(valCounts).sort((a, b) => b - a);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(vals);

  let rank, name;
  if (isFlush && isStraight && vals[0] === 14 && vals[4] === 10) { rank = 9; name = 'Royal Flush'; }
  else if (isFlush && isStraight) { rank = 8; name = 'Straight Flush'; }
  else if (counts[0] === 4) { rank = 7; name = 'Four of a Kind'; }
  else if (counts[0] === 3 && counts[1] === 2) { rank = 6; name = 'Full House'; }
  else if (isFlush) { rank = 5; name = 'Flush'; }
  else if (isStraight) { rank = 4; name = 'Straight'; }
  else if (counts[0] === 3) { rank = 3; name = 'Three of a Kind'; }
  else if (counts[0] === 2 && counts[1] === 2) { rank = 2; name = 'Two Pair'; }
  else if (counts[0] === 2) { rank = 1; name = 'One Pair'; }
  else { rank = 0; name = 'High Card'; }

  return { rank, name, vals, cards: sorted };
}

function checkStraight(vals) {
  const unique = [...new Set(vals)].sort((a, b) => b - a);
  if (unique.length < 5) return false;
  // Normal straight
  if (unique[0] - unique[4] === 4) return true;
  // Wheel: A-2-3-4-5
  if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) return true;
  return false;
}

function compareHandRanks(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < a.vals.length; i++) {
    if (a.vals[i] !== b.vals[i]) return a.vals[i] - b.vals[i];
  }
  return 0;
}

// ─── Room State ────────────────────────────────────────────────────────────────
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createPlayer(id, name, isBot = false) {
  return {
    id,
    name,
    isBot,
    chips: 1000,
    cards: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    standing: false,
    busted: false,
    blackjackScore: 0,
    connected: true
  };
}

function getPublicRoom(room) {
  const r = { ...room };
  // Hide deck
  delete r.deck;
  // Hide other players' hole cards in poker (show only community + self)
  r.players = r.players.map(p => ({ ...p }));
  return r;
}

function broadcastRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach(player => {
    if (!player.isBot) {
      const pub = getPublicRoom(room);
      // In poker, hide hole cards of others unless showdown
      if (room.game === 'poker' && room.phase !== 'showdown') {
        pub.players = pub.players.map(p => {
          if (p.id === player.id) return p;
          return { ...p, cards: p.cards.map(() => ({ hidden: true })) };
        });
      }
      io.to(player.id).emit('roomUpdate', pub);
    }
  });
}

// ─── Bot Logic ────────────────────────────────────────────────────────────────
function botPokerAction(room) {
  const player = room.players[room.currentTurn];
  if (!player || !player.isBot || player.folded || player.allIn) {
    advancePokerTurn(room);
    return;
  }

  const callAmount = room.currentBet - player.totalBet;
  const rand = Math.random();

  setTimeout(() => {
    if (callAmount > player.chips) {
      // Can't call fully, go all in or fold
      if (rand < 0.4) doFold(room, player.id);
      else doAllIn(room, player.id);
    } else if (callAmount === 0) {
      if (rand < 0.7) doCheck(room, player.id);
      else {
        const raise = Math.min(Math.floor(Math.random() * 100) + 20, player.chips);
        doRaise(room, player.id, raise);
      }
    } else {
      if (rand < 0.3) doFold(room, player.id);
      else if (rand < 0.8) doCall(room, player.id);
      else doAllIn(room, player.id);
    }
  }, 800 + Math.random() * 700);
}

function botBlackjackAction(room) {
  const player = room.players[room.currentTurn];
  if (!player || !player.isBot) return;

  setTimeout(() => {
    const score = calcBlackjackScore(player.cards);
    if (score < 17) {
      doHit(room, player.id);
    } else {
      doStand(room, player.id);
    }
  }, 900 + Math.random() * 600);
}

// ─── Poker Actions ────────────────────────────────────────────────────────────
function doFold(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || player.folded) return;
  player.folded = true;
  room.log = `${player.name} folded`;
  advancePokerTurn(room);
}

function doCheck(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  room.log = `${player.name} checked`;
  advancePokerTurn(room);
}

function doCall(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  const amount = Math.min(room.currentBet - player.totalBet, player.chips);
  player.chips -= amount;
  player.bet += amount;
  player.totalBet += amount;
  room.pot += amount;
  if (player.chips === 0) player.allIn = true;
  room.log = `${player.name} called ${amount}`;
  advancePokerTurn(room);
}

function doRaise(room, playerId, amount) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  const callAmount = room.currentBet - player.totalBet;
  const total = Math.min(callAmount + amount, player.chips);
  player.chips -= total;
  player.bet += total;
  player.totalBet += total;
  room.pot += total;
  room.currentBet = player.totalBet;
  room.lastRaiser = player.id;
  if (player.chips === 0) player.allIn = true;
  room.log = `${player.name} raised to ${player.totalBet}`;
  advancePokerTurn(room);
}

function doAllIn(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || player.chips === 0) return;
  const amount = player.chips;
  player.bet += amount;
  player.totalBet += amount;
  room.pot += amount;
  player.chips = 0;
  player.allIn = true;
  if (player.totalBet > room.currentBet) {
    room.currentBet = player.totalBet;
    room.lastRaiser = player.id;
  }
  room.log = `${player.name} went ALL IN (${amount})`;
  advancePokerTurn(room);
}

function advancePokerTurn(room) {
  const active = room.players.filter(p => !p.folded && !p.allIn);
  const allActive = room.players.filter(p => !p.folded);

  // Check if round is over
  if (active.length <= 1 || isBettingRoundOver(room)) {
    advancePokerPhase(room);
    return;
  }

  // Find next active player
  let next = (room.currentTurn + 1) % room.players.length;
  let loops = 0;
  while ((room.players[next].folded || room.players[next].allIn) && loops < room.players.length) {
    next = (next + 1) % room.players.length;
    loops++;
  }
  room.currentTurn = next;
  broadcastRoom(room.code);

  if (room.players[next].isBot) {
    botPokerAction(room);
  }
}

function isBettingRoundOver(room) {
  const active = room.players.filter(p => !p.folded && !p.allIn);
  if (active.length === 0) return true;
  // Everyone has matched the current bet or acted
  return active.every(p => p.totalBet === room.currentBet || p.allIn);
}

function advancePokerPhase(room) {
  const phases = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const phaseIdx = phases.indexOf(room.phase);

  const alive = room.players.filter(p => !p.folded);
  if (alive.length === 1) {
    // Only one player left
    const winner = alive[0];
    winner.chips += room.pot;
    room.phase = 'showdown';
    room.winners = [{ name: winner.name, handName: 'Last player standing', amount: room.pot }];
    room.pot = 0;
    broadcastRoom(room.code);
    scheduleNextPokerHand(room);
    return;
  }

  if (phaseIdx >= phases.length - 2) {
    // Showdown
    room.phase = 'showdown';
    resolvePokerShowdown(room);
    return;
  }

  room.phase = phases[phaseIdx + 1];
  // Reset bets for new round
  room.players.forEach(p => { p.bet = 0; });
  room.currentBet = 0;
  room.lastRaiser = null;

  if (room.phase === 'flop') {
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (room.phase === 'turn' || room.phase === 'river') {
    room.communityCards.push(room.deck.pop());
  }

  // First to act post-flop: left of dealer
  room.currentTurn = (room.dealerIndex + 1) % room.players.length;
  let loops = 0;
  while ((room.players[room.currentTurn].folded || room.players[room.currentTurn].allIn) && loops < room.players.length) {
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    loops++;
  }

  broadcastRoom(room.code);

  if (room.players[room.currentTurn].isBot) {
    botPokerAction(room);
  }
}

function resolvePokerShowdown(room) {
  const alive = room.players.filter(p => !p.folded);
  let bestRank = null;
  let winners = [];

  for (const p of alive) {
    const hand = getBestHand(p.cards, room.communityCards);
    p.bestHand = hand;
    if (!bestRank || compareHandRanks(hand, bestRank) > 0) {
      bestRank = hand;
      winners = [p];
    } else if (compareHandRanks(hand, bestRank) === 0) {
      winners.push(p);
    }
  }

  const share = Math.floor(room.pot / winners.length);
  room.winners = winners.map(w => ({
    name: w.name,
    handName: w.bestHand ? w.bestHand.name : '',
    amount: share
  }));
  winners.forEach(w => { w.chips += share; });
  room.pot = 0;

  broadcastRoom(room.code);
  scheduleNextPokerHand(room);
}

function scheduleNextPokerHand(room) {
  setTimeout(() => {
    // Remove busted players (0 chips, not bots)
    room.players = room.players.filter(p => p.chips > 0 || p.isBot);
    if (room.players.length < 2) {
      room.phase = 'lobby';
      broadcastRoom(room.code);
      return;
    }
    startPokerHand(room);
  }, 4000);
}

function startPokerHand(room) {
  room.deck = shuffleDeck(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.lastRaiser = null;
  room.winners = [];
  room.phase = 'preflop';
  room.log = '';

  room.players.forEach(p => {
    p.cards = [];
    p.bet = 0;
    p.totalBet = 0;
    p.folded = false;
    p.allIn = false;
    p.bestHand = null;
  });

  // Rotate dealer
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  const n = room.players.length;
  const sbIdx = (room.dealerIndex + 1) % n;
  const bbIdx = (room.dealerIndex + 2) % n;

  const sb = room.players[sbIdx];
  const bb = room.players[bbIdx];

  const sbAmount = Math.min(10, sb.chips);
  sb.chips -= sbAmount; sb.bet = sbAmount; sb.totalBet = sbAmount;
  room.pot += sbAmount;

  const bbAmount = Math.min(20, bb.chips);
  bb.chips -= bbAmount; bb.bet = bbAmount; bb.totalBet = bbAmount;
  room.pot += bbAmount;

  room.currentBet = bbAmount;

  // Deal 2 cards each
  for (const p of room.players) {
    p.cards = [room.deck.pop(), room.deck.pop()];
  }

  // First to act: left of BB
  room.currentTurn = (bbIdx + 1) % n;
  let loops = 0;
  while ((room.players[room.currentTurn].folded || room.players[room.currentTurn].allIn) && loops < n) {
    room.currentTurn = (room.currentTurn + 1) % n;
    loops++;
  }

  broadcastRoom(room.code);

  if (room.players[room.currentTurn].isBot) {
    botPokerAction(room);
  }
}

// ─── Blackjack Logic ──────────────────────────────────────────────────────────
function calcBlackjackScore(cards) {
  let score = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    score += v;
    if (c.value === 'A') aces++;
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function startBlackjackRound(room) {
  room.deck = shuffleDeck(createDeck());
  room.dealerCards = [];
  room.winners = [];
  room.phase = 'playing';
  room.log = '';

  room.players.forEach(p => {
    p.cards = [room.deck.pop(), room.deck.pop()];
    p.standing = false;
    p.busted = false;
    p.blackjackScore = calcBlackjackScore(p.cards);
  });

  // Dealer gets 2 cards (second hidden until reveal)
  room.dealerCards = [room.deck.pop(), room.deck.pop()];
  room.dealerScore = calcBlackjackScore(room.dealerCards);

  // Start with first player
  room.currentTurn = 0;
  while (room.currentTurn < room.players.length && room.players[room.currentTurn].blackjackScore === 21) {
    room.players[room.currentTurn].standing = true;
    room.currentTurn++;
  }

  broadcastRoom(room.code);

  if (room.currentTurn < room.players.length && room.players[room.currentTurn].isBot) {
    botBlackjackAction(room);
  } else if (room.currentTurn >= room.players.length) {
    runDealerBlackjack(room);
  }
}

function doHit(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || player.standing || player.busted) return;
  player.cards.push(room.deck.pop());
  player.blackjackScore = calcBlackjackScore(player.cards);
  if (player.blackjackScore > 21) {
    player.busted = true;
    room.log = `${player.name} busted!`;
    advanceBlackjackTurn(room);
  } else if (player.blackjackScore === 21) {
    player.standing = true;
    room.log = `${player.name} hit 21!`;
    advanceBlackjackTurn(room);
  } else {
    broadcastRoom(room.code);
    if (player.isBot) botBlackjackAction(room);
  }
}

function doStand(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || player.standing || player.busted) return;
  player.standing = true;
  room.log = `${player.name} stands at ${player.blackjackScore}`;
  advanceBlackjackTurn(room);
}

function advanceBlackjackTurn(room) {
  let next = room.currentTurn + 1;
  while (next < room.players.length && (room.players[next].standing || room.players[next].busted)) next++;
  room.currentTurn = next;
  broadcastRoom(room.code);

  if (next >= room.players.length) {
    runDealerBlackjack(room);
  } else if (room.players[next].isBot) {
    botBlackjackAction(room);
  }
}

function runDealerBlackjack(room) {
  room.phase = 'dealer';
  // Dealer draws until 17+
  while (calcBlackjackScore(room.dealerCards) < 17) {
    room.dealerCards.push(room.deck.pop());
  }
  room.dealerScore = calcBlackjackScore(room.dealerCards);
  resolveBlackjack(room);
}

function resolveBlackjack(room) {
  const dealerScore = room.dealerScore;
  const dealerBust = dealerScore > 21;
  room.winners = [];

  room.players.forEach(p => {
    let result;
    if (p.busted) {
      result = 'lose';
    } else if (dealerBust || p.blackjackScore > dealerScore) {
      result = 'win';
      p.chips += p.bet * 2;
    } else if (p.blackjackScore === dealerScore) {
      result = 'push';
      p.chips += p.bet;
    } else {
      result = 'lose';
    }
    p.result = result;
    room.winners.push({ name: p.name, result, score: p.blackjackScore });
  });

  room.phase = 'showdown';
  broadcastRoom(room.code);

  setTimeout(() => {
    startBlackjackBetting(room);
  }, 4000);
}

function startBlackjackBetting(room) {
  room.phase = 'betting';
  room.players.forEach(p => {
    p.bet = 0;
    p.cards = [];
    p.standing = false;
    p.busted = false;
    p.result = null;
    p.blackjackScore = 0;
  });
  room.dealerCards = [];
  room.winners = [];
  broadcastRoom(room.code);
  // Bots auto-bet
  room.players.filter(p => p.isBot).forEach(p => {
    const amount = Math.min(50, p.chips);
    p.bet = amount;
    p.chips -= amount;
  });
}

// ─── Socket Events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', ({ name, game }) => {
    let code = generateRoomCode();
    while (rooms[code]) code = generateRoomCode();

    const player = createPlayer(socket.id, name);
    rooms[code] = {
      code,
      game,
      phase: 'lobby',
      hostId: socket.id,
      players: [player],
      deck: [],
      communityCards: [],
      dealerCards: [],
      dealerScore: 0,
      pot: 0,
      currentBet: 0,
      currentTurn: 0,
      dealerIndex: 0,
      lastRaiser: null,
      winners: [],
      log: ''
    };

    socket.join(code);
    socket.emit('roomCreated', { code, playerId: socket.id });
    broadcastRoom(code);
  });

  socket.on('joinRoom', ({ name, code }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.phase !== 'lobby') { socket.emit('error', 'Game already in progress'); return; }
    if (room.players.length >= 4) { socket.emit('error', 'Room is full'); return; }

    const player = createPlayer(socket.id, name);
    room.players.push(player);
    socket.join(code);
    socket.emit('roomJoined', { code, playerId: socket.id });
    broadcastRoom(code);
  });

  socket.on('addBots', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    const botNames = ['Bot Alex', 'Bot Sam', 'Bot Jordan', 'Bot Taylor'];
    let botIdx = 0;
    while (room.players.length < 4) {
      const botId = 'bot_' + Date.now() + '_' + botIdx;
      room.players.push(createPlayer(botId, botNames[botIdx % botNames.length], true));
      botIdx++;
    }
    startGame(room);
    broadcastRoom(code);
  });

  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) { socket.emit('error', 'Need at least 2 players'); return; }
    startGame(room);
    broadcastRoom(code);
  });

  function startGame(room) {
    if (room.game === 'poker') {
      startPokerHand(room);
    } else if (room.game === 'blackjack') {
      startBlackjackBetting(room);
    }
  }

  // ── Poker Actions ──
  socket.on('poker:fold', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase === 'showdown') return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    doFold(room, socket.id);
    broadcastRoom(code);
  });

  socket.on('poker:check', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    const player = room.players[pidx];
    if (room.currentBet !== player.totalBet) return;
    doCheck(room, socket.id);
    broadcastRoom(code);
  });

  socket.on('poker:call', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    doCall(room, socket.id);
    broadcastRoom(code);
  });

  socket.on('poker:raise', ({ code, amount }) => {
    const room = rooms[code];
    if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    if (!amount || amount <= 0) return;
    doRaise(room, socket.id, parseInt(amount));
    broadcastRoom(code);
  });

  socket.on('poker:allIn', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    doAllIn(room, socket.id);
    broadcastRoom(code);
  });

  // ── Blackjack Actions ──
  socket.on('blackjack:bet', ({ code, amount }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'betting') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const bet = Math.min(parseInt(amount) || 50, player.chips);
    player.chips -= bet;
    player.bet = bet;
    // Check if all non-bot players have bet
    const humanPlayers = room.players.filter(p => !p.isBot);
    if (humanPlayers.every(p => p.bet > 0)) {
      startBlackjackRound(room);
    } else {
      broadcastRoom(code);
    }
  });

  socket.on('blackjack:hit', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    doHit(room, socket.id);
    broadcastRoom(code);
  });

  socket.on('blackjack:stand', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    const pidx = room.players.findIndex(p => p.id === socket.id);
    if (pidx !== room.currentTurn) return;
    doStand(room, socket.id);
    broadcastRoom(code);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        player.folded = true;
        if (room.phase !== 'lobby' && room.phase !== 'showdown') {
          if (room.game === 'poker') advancePokerTurn(room);
        }
        broadcastRoom(code);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
