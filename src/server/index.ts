import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type {
  Card,
  CardKind,
  ClientMessage,
  ClientRoomView,
  CounterKind,
  LibraryPosition,
  PlayerView,
  PublicZoneId,
  PublicZones,
  ServerMessage,
  TurnView,
  ZoneId
} from "../shared/types";

type PlayerState = {
  id: string;
  name: string;
  life: number;
  mulligans: number;
  deckText: string;
  library: Card[];
  hand: Card[];
  peek: Card[];
};

type CardSourceZone = ZoneId | "peek";

type PhaseSnapshot = {
  activePlayerId: string | null;
  phase: string;
};

type Room = {
  roomCode: string;
  players: PlayerState[];
  publicZones: PublicZones;
  activePlayerId: string | null;
  phase: string;
  phaseHistory: PhaseSnapshot[];
  log: string[];
  clients: Map<WebSocket, string>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map<string, Room>();
const publicZoneIds: PublicZoneId[] = ["battlefield", "graveyard", "exile", "stack"];

const orderedPhases = [
  "重置阶段",
  "维持阶段",
  "抓牌阶段",
  "战斗前行动阶段",
  "战斗开始",
  "宣攻击者",
  "宣阻挡者",
  "伤害结算",
  "战斗结束",
  "战斗后行动阶段",
  "结束阶段",
  "清除阶段"
];

app.use(express.static(path.resolve(__dirname, "../../dist")));
app.get("/health", (_req, res) => res.json({ ok: true }));

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      handleMessage(ws, JSON.parse(raw.toString()) as ClientMessage);
    } catch (error) {
      send(ws, { type: "error", message: `消息格式错误：${String(error)}` });
    }
  });

  ws.on("close", () => {
    for (const room of rooms.values()) {
      if (room.clients.delete(ws)) broadcast(room);
    }
  });
});

function handleMessage(ws: WebSocket, message: ClientMessage) {
  if (message.type === "createRoom") {
    const room = createRoom(message.playerId, message.playerName);
    room.clients.set(ws, message.playerId);
    broadcast(room);
    return;
  }

  if (message.type === "joinRoom") {
    const room = rooms.get(message.roomCode.trim().toUpperCase());
    if (!room) return send(ws, { type: "error", message: "找不到房间。" });

    let player = room.players.find((candidate) => candidate.id === message.playerId);
    if (!player) {
      if (room.players.length >= 2) return send(ws, { type: "error", message: "房间已经有两名玩家。" });
      player = createPlayer(message.playerId, message.playerName);
      room.players.push(player);
      addLog(room, `${player.name} 加入房间。`);
    }

    room.clients.set(ws, player.id);
    broadcast(room);
    return;
  }

  const context = getContext(ws);
  if (!context) return send(ws, { type: "error", message: "请先创建或加入房间。" });

  const { room, player } = context;
  switch (message.type) {
    case "loadDeck":
      player.deckText = message.deckText;
      player.library = parseDeck(message.deckText, player.id);
      player.hand = [];
      player.peek = [];
      player.mulligans = 0;
      player.life = 20;
      removeOwnedCardsFromPublicZones(room, player.id);
      addLog(room, `${player.name} 导入了 ${player.library.length} 张牌。`);
      break;
    case "shuffleLibrary":
      shuffle(player.library);
      addLog(room, `${player.name} 洗牌。`);
      break;
    case "draw":
      drawCards(room, player, clampNumber(message.count, 1, 20));
      break;
    case "peekLibrary":
      peekLibrary(room, player, clampNumber(message.count, 1, 50));
      break;
    case "mulligan":
      mulligan(room, player);
      break;
    case "resetGame":
      resetGame(room);
      break;
    case "moveCard":
      moveCard(room, player, message.cardId, message.toZone, message.kind, message.libraryPosition);
      break;
    case "toggleTap":
      toggleTap(room, message.cardId);
      break;
    case "setLife":
      player.life = clampNumber(message.life, -99, 999);
      addLog(room, `${player.name} 将生命调整为 ${player.life}。`);
      break;
    case "adjustCounter":
      adjustCounter(room, player, message.cardId, message.counter, message.delta);
      break;
    case "declarePhase":
      declarePhase(room, player, message.phase);
      break;
    case "stepPhase":
      stepPhase(room, player, message.direction);
      break;
    case "undoPhase":
      undoPhase(room, player);
      break;
    case "endTurn":
      endTurn(room, player);
      break;
    case "chat":
      addChat(room, player, message.text);
      break;
    case "rollDice":
      rollDice(room, player, message.sides, message.count);
      break;
    case "createToken":
      createToken(room, player, message.name, message.power, message.toughness);
      break;
  }

  broadcast(room);
}

function createRoom(playerId: string, playerName: string): Room {
  const roomCode = makeRoomCode();
  const player = createPlayer(playerId, playerName);
  const room: Room = {
    roomCode,
    players: [player],
    publicZones: { battlefield: [], graveyard: [], exile: [], stack: [] },
    activePlayerId: player.id,
    phase: "游戏开始前",
    phaseHistory: [],
    log: [],
    clients: new Map()
  };
  addLog(room, `${player.name} 创建房间 ${roomCode}。`);
  rooms.set(roomCode, room);
  return room;
}

function createPlayer(id: string, name: string): PlayerState {
  return { id, name: name.trim() || "玩家", life: 20, mulligans: 0, deckText: "", library: [], hand: [], peek: [] };
}

function parseDeck(deckText: string, ownerId: string): Card[] {
  const cards: Card[] = [];
  for (const line of deckText.split(/\r?\n/)) {
    const cleanLine = line.replace(/^SB:\s*/i, "").trim();
    if (!cleanLine || cleanLine.startsWith("#") || /^sideboard$/i.test(cleanLine)) continue;
    const match = cleanLine.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const count = clampNumber(Number(match[1]), 1, 99);
    const name = match[2].trim();
    for (let index = 0; index < count; index += 1) {
      cards.push({ id: cryptoId(), name, ownerId, kind: "spell", plusOneCounters: 0, counters: 0, tapped: false });
    }
  }
  return cards;
}

function drawCards(room: Room, player: PlayerState, count: number) {
  let drawn = 0;
  for (let index = 0; index < count; index += 1) {
    const card = player.library.shift();
    if (!card) break;
    player.hand.push(card);
    drawn += 1;
  }
  addLog(room, `${player.name} 抓 ${drawn} 张牌。`);
}

function peekLibrary(room: Room, player: PlayerState, count: number) {
  let moved = 0;
  for (let index = 0; index < count; index += 1) {
    const card = player.library.shift();
    if (!card) break;
    player.peek.push(card);
    moved += 1;
  }
  addLog(room, `${player.name} 查看牌库顶 ${moved} 张牌。`);
}

function mulligan(room: Room, player: PlayerState) {
  player.library.push(...player.hand.splice(0));
  player.library.push(...player.peek.splice(0));
  shuffle(player.library);
  drawCards(room, player, 7);
  player.mulligans += 1;
  addLog(room, `${player.name} 第 ${player.mulligans} 次调度。请按需要手动把 ${player.mulligans} 张牌放回牌库。`);
}

function resetGame(room: Room) {
  room.publicZones = { battlefield: [], graveyard: [], exile: [], stack: [] };
  for (const player of room.players) {
    player.life = 20;
    player.mulligans = 0;
    player.hand = [];
    player.peek = [];
    player.library = player.deckText ? parseDeck(player.deckText, player.id) : [];
  }
  room.activePlayerId = room.players[0]?.id ?? null;
  room.phase = "游戏开始前";
  room.phaseHistory = [];
  addLog(room, "对局已重开：生命重置为 20，公共区域清空，牌库恢复为最近导入的牌表。");
}

function moveCard(
  room: Room,
  actor: PlayerState,
  cardId: string,
  toZone: ZoneId,
  kind?: CardKind,
  libraryPosition: LibraryPosition = "top"
) {
  const found = takeCard(room, actor, cardId);
  if (!found) return;

  if (kind) found.card.kind = kind;
  found.card.tapped = toZone === "battlefield" ? found.card.tapped : false;

  if (toZone === "library") {
    const owner = getOwner(room, found.card);
    if (!owner) return;
    putIntoLibrary(owner, found.card, libraryPosition);
    addLog(room, `${actor.name} 将 ${found.card.name} 从${zoneName(found.fromZone)}放回牌库${libraryPositionName(libraryPosition)}。`);
    return;
  }

  if (toZone === "hand") {
    getOwner(room, found.card)?.hand.push(found.card);
  } else {
    room.publicZones[toZone].push(found.card);
  }

  addLog(room, `${actor.name} 将 ${found.card.name} 从${zoneName(found.fromZone)}移到${zoneName(toZone)}。`);
}

function putIntoLibrary(player: PlayerState, card: Card, position: LibraryPosition) {
  if (position === "bottom") player.library.push(card);
  else if (position === "shuffle") {
    player.library.push(card);
    shuffle(player.library);
  } else player.library.unshift(card);
}

function takeCard(room: Room, actor: PlayerState, cardId: string): { card: Card; fromZone: CardSourceZone } | null {
  for (const candidate of [
    { zone: "hand" as ZoneId, cards: actor.hand },
    { zone: "library" as ZoneId, cards: actor.library },
    { zone: "peek" as const, cards: actor.peek }
  ]) {
    const index = candidate.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { card: candidate.cards.splice(index, 1)[0], fromZone: candidate.zone };
  }

  for (const zone of publicZoneIds) {
    const index = room.publicZones[zone].findIndex((card) => card.id === cardId);
    if (index >= 0) return { card: room.publicZones[zone].splice(index, 1)[0], fromZone: zone };
  }

  return null;
}

function toggleTap(room: Room, cardId: string) {
  const card = findPublicCard(room, cardId);
  if (!card) return;
  card.tapped = !card.tapped;
  addLog(room, `${card.name} ${card.tapped ? "横置" : "重置"}。`);
}

function adjustCounter(room: Room, player: PlayerState, cardId: string, counter: CounterKind, delta: number) {
  const card = findAnyCard(room, cardId);
  if (!card) return;
  const safeDelta = clampNumber(delta, -20, 20);
  if (counter === "plusOne") {
    card.plusOneCounters = Math.max(0, (card.plusOneCounters ?? 0) + safeDelta);
    addLog(room, `${player.name} 将 ${card.name} 的 +1/+1 指示物调整为 ${card.plusOneCounters}。`);
  } else {
    card.counters = Math.max(0, (card.counters ?? 0) + safeDelta);
    addLog(room, `${player.name} 将 ${card.name} 的计数器调整为 ${card.counters}。`);
  }
}

function declarePhase(room: Room, player: PlayerState, phase: string) {
  const cleanPhase = phase.trim();
  if (!cleanPhase) return;
  room.phaseHistory.push({ activePlayerId: room.activePlayerId, phase: room.phase });
  room.activePlayerId = player.id;
  room.phase = cleanPhase;
  addLog(room, `${player.name} 进入阶段：${cleanPhase}。`);
}

function stepPhase(room: Room, player: PlayerState, direction: "next" | "previous") {
  const currentIndex = orderedPhases.indexOf(room.phase);
  const fallbackIndex = orderedPhases.indexOf("维持阶段");
  const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
  const delta = direction === "next" ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(orderedPhases.length - 1, baseIndex + delta));
  declarePhase(room, player, orderedPhases[nextIndex]);
}

function undoPhase(room: Room, player: PlayerState) {
  const previous = room.phaseHistory.pop();
  if (!previous) return;
  room.activePlayerId = previous.activePlayerId;
  room.phase = previous.phase;
  addLog(room, `${player.name} 回溯阶段，回到：${room.phase}。`);
}

function endTurn(room: Room, player: PlayerState) {
  const nextPlayer = getNextPlayer(room, player);
  if (!nextPlayer) return;
  room.phaseHistory.push({ activePlayerId: room.activePlayerId, phase: room.phase });
  room.activePlayerId = nextPlayer.id;
  room.phase = "维持阶段";
  untapPlayerPermanents(room, nextPlayer.id);
  addLog(room, `${player.name} 回合结束。进入 ${nextPlayer.name} 的维持阶段，并自动重置其战场。`);
}

function addChat(room: Room, player: PlayerState, text: string) {
  const cleanText = text.trim().slice(0, 500);
  if (cleanText) addLog(room, `💬 ${player.name}：${cleanText}`);
}

function rollDice(room: Room, player: PlayerState, sides: number, count = 1) {
  const safeSides = clampNumber(sides, 2, 1000);
  const safeCount = clampNumber(count, 1, 20);
  const results = Array.from({ length: safeCount }, () => Math.floor(Math.random() * safeSides) + 1);
  const total = results.reduce((sum, value) => sum + value, 0);
  addLog(room, `🎲 ${player.name} 投 ${safeCount}D${safeSides} = ${results.join(", ")}${safeCount > 1 ? `（合计 ${total}）` : ""}`);
}

function createToken(room: Room, player: PlayerState, name: string, power?: string, toughness?: string) {
  const cleanName = name.trim().slice(0, 80) || "Token";
  const cleanPower = power?.trim().slice(0, 8) || "";
  const cleanToughness = toughness?.trim().slice(0, 8) || "";
  const token: Card = {
    id: cryptoId(),
    name: cleanName,
    ownerId: player.id,
    kind: "spell",
    token: true,
    power: cleanPower || undefined,
    toughness: cleanToughness || undefined,
    plusOneCounters: 0,
    counters: 0,
    tapped: false
  };
  room.publicZones.battlefield.push(token);
  addLog(room, `${player.name} 释放 Token：${cleanName}${cleanPower || cleanToughness ? ` ${cleanPower || "?"}/${cleanToughness || "?"}` : ""}。`);
}

function getNextPlayer(room: Room, player: PlayerState) {
  if (room.players.length <= 1) return player;
  return room.players.find((candidate) => candidate.id !== player.id) ?? player;
}

function untapPlayerPermanents(room: Room, playerId: string) {
  for (const card of room.publicZones.battlefield) {
    if (card.ownerId === playerId) card.tapped = false;
  }
}

function getContext(ws: WebSocket) {
  for (const room of rooms.values()) {
    const playerId = room.clients.get(ws);
    if (!playerId) continue;
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (player) return { room, player };
  }
  return null;
}

function createRoomView(room: Room, youId: string): ClientRoomView {
  const players: PlayerView[] = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    life: player.life,
    libraryCount: player.library.length,
    handCount: player.hand.length,
    mulligans: player.mulligans,
    hand: player.id === youId ? player.hand : [],
    library: player.id === youId ? player.library : [],
    peek: player.id === youId ? player.peek : []
  }));

  const activePlayer = room.players.find((player) => player.id === room.activePlayerId);
  const turn: TurnView = {
    activePlayerId: room.activePlayerId,
    activePlayerName: activePlayer?.name ?? "未指定",
    phase: room.phase,
    canUndoPhase: room.phaseHistory.length > 0
  };

  return {
    roomCode: room.roomCode,
    youId,
    players,
    publicZones: room.publicZones,
    turn,
    log: room.log.slice(-100)
  };
}

function removeOwnedCardsFromPublicZones(room: Room, ownerId: string) {
  for (const zone of publicZoneIds) {
    room.publicZones[zone] = room.publicZones[zone].filter((card) => card.ownerId !== ownerId);
  }
}

function findPublicCard(room: Room, cardId: string) {
  for (const zone of publicZoneIds) {
    const card = room.publicZones[zone].find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  return null;
}

function findAnyCard(room: Room, cardId: string) {
  for (const player of room.players) {
    const card = [...player.hand, ...player.library, ...player.peek].find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  return findPublicCard(room, cardId);
}

function getOwner(room: Room, card: Card) {
  return room.players.find((player) => player.id === card.ownerId);
}

function broadcast(room: Room) {
  for (const [ws, playerId] of room.clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) send(ws, { type: "room", room: createRoomView(room, playerId) });
  }
}

function send(ws: WebSocket, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

function addLog(room: Room, entry: string) {
  room.log.push(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${entry}`);
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cryptoId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function zoneName(zone: CardSourceZone) {
  const names: Record<CardSourceZone, string> = {
    library: "牌库",
    hand: "手牌",
    battlefield: "战场",
    graveyard: "坟场",
    exile: "放逐区",
    stack: "堆叠",
    peek: "看牌库顶"
  };
  return names[zone];
}

function libraryPositionName(position: LibraryPosition) {
  const names: Record<LibraryPosition, string> = {
    top: "顶",
    bottom: "底",
    shuffle: "并洗牌"
  };
  return names[position];
}

server.listen(8787, () => {
  console.log("MTG Tabletop server listening on http://127.0.0.1:8787");
});
