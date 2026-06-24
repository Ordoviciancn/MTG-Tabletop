import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, CardKind, ClientMessage, ClientRoomView, LibraryPosition, PublicZoneId, ServerMessage, ZoneId } from "../shared/types";

const defaultDeck = `4 Island
4 Forest
4 Merfolk of the Pearl Trident
4 Llanowar Elves
4 Counterspell
4 Giant Growth
4 Lightning Bolt
4 Opt
4 Grizzly Bears
24 Plains`;

const zoneLabels: Record<ZoneId, string> = {
  library: "牌库",
  hand: "手牌",
  battlefield: "战场",
  graveyard: "坟场",
  exile: "放逐",
  stack: "堆叠"
};

const phaseOrder = [
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

type DetailModalState = { title: string; zone: "graveyard" | "exile"; playerId: string } | null;

export function App() {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("mtg-player-name") ?? "玩家");
  const [playerId] = useState(() => {
    const existing = localStorage.getItem("mtg-player-id");
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem("mtg-player-id", created);
    return created;
  });
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [room, setRoom] = useState<ClientRoomView | null>(null);
  const [error, setError] = useState("");
  const [deckText, setDeckText] = useState(defaultDeck);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [peekCount, setPeekCount] = useState(3);
  const [showPeek, setShowPeek] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [customDiceSides, setCustomDiceSides] = useState(20);
  const [chatText, setChatText] = useState("");
  const [detailModal, setDetailModal] = useState<DetailModalState>(null);
  const [tokenName, setTokenName] = useState(() => localStorage.getItem("mtg-token-name") ?? "士兵");
  const [tokenPower, setTokenPower] = useState(() => localStorage.getItem("mtg-token-power") ?? "1");
  const [tokenToughness, setTokenToughness] = useState(() => localStorage.getItem("mtg-token-toughness") ?? "1");
  const [tokenHasPT, setTokenHasPT] = useState(() => localStorage.getItem("mtg-token-has-pt") !== "false");
  const [showManual, setShowManual] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    localStorage.setItem("mtg-player-name", playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem("mtg-token-name", tokenName);
    localStorage.setItem("mtg-token-power", tokenPower);
    localStorage.setItem("mtg-token-toughness", tokenToughness);
    localStorage.setItem("mtg-token-has-pt", String(tokenHasPT));
  }, [tokenName, tokenPower, tokenToughness, tokenHasPT]);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "room") {
        setRoom(message.room);
        setError("");
      } else {
        setError(message.message);
      }
    };
    ws.onclose = () => setError("连接已断开，请刷新页面重连。");
    return () => ws.close();
  }, []);

  const you = useMemo(() => room?.players.find((player) => player.id === room.youId), [room]);
  const opponent = useMemo(() => room?.players.find((player) => player.id !== room.youId), [room]);
  const selectedCard = useMemo(() => findCard(room, selectedCardId), [room, selectedCardId]);
  const currentPhaseIndex = room ? phaseOrder.indexOf(room.turn.phase) : -1;
  const filteredLibrary = useMemo(() => {
    const cards = you?.library ?? [];
    const query = libraryFilter.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter((card) => card.name.toLowerCase().includes(query));
  }, [you?.library, libraryFilter]);
  const peekCards = useMemo(() => {
    const count = Math.max(1, Math.min(50, Number.isFinite(peekCount) ? peekCount : 1));
    return (you?.library ?? []).slice(0, count);
  }, [you?.library, peekCount]);

  function send(message: ClientMessage) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("服务器还没连上，等一秒再试。");
      return;
    }
    wsRef.current.send(JSON.stringify(message));
  }

  function createRoom() {
    send({ type: "createRoom", playerId, playerName });
  }

  function joinRoom() {
    send({ type: "joinRoom", roomCode: roomCodeInput, playerId, playerName });
  }

  function moveSelected(toZone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    if (!selectedCardId) return;
    send({ type: "moveCard", cardId: selectedCardId, toZone, kind, libraryPosition });
    setSelectedCardId(null);
  }

  function moveCard(cardId: string, toZone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    send({ type: "moveCard", cardId, toZone, kind, libraryPosition });
    setSelectedCardId(null);
  }

  function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    send({ type: "chat", text });
    setChatText("");
  }

  function adjustSelected(counter: "plusOne" | "generic", delta: number) {
    if (!selectedCardId) return;
    send({ type: "adjustCounter", cardId: selectedCardId, counter, delta });
  }

  function rollDice(sides: number, count = 1) {
    send({ type: "rollDice", sides, count });
  }

  function createToken() {
    send({
      type: "createToken",
      name: tokenName,
      power: tokenHasPT ? tokenPower : undefined,
      toughness: tokenHasPT ? tokenToughness : undefined
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">MTG Tabletop MVP</div>
          <h1>双人娱乐对战模拟器</h1>
        </div>
        <div className="connection">{room ? `房间 ${room.roomCode}` : "未入座"}</div>
      </header>

      {error && <div className="error">{error}</div>}

      {!room ? (
        <section className="panel lobby">
          <label>
            你的名字
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
          </label>
          <div className="lobbyActions">
            <button onClick={createRoom}>创建房间</button>
            <input placeholder="输入房间码" value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} />
            <button className="secondary" onClick={joinRoom}>加入房间</button>
          </div>
          <button className="manualButton" onClick={() => setShowManual(true)}>查看说明书</button>
          <p className="hint">本机测试可开两个浏览器窗口；公网远程则用 remote.cmd 生成的链接。</p>
          {showManual && <ManualModal onClose={() => setShowManual(false)} />}
        </section>
      ) : (
        <main className="table">
          <aside className="panel sidebar">
            <section className="players">
              <PlayerCard name={you?.name ?? "你"} life={you?.life ?? 20} library={you?.libraryCount ?? 0} hand={you?.handCount ?? 0} mulligans={you?.mulligans ?? 0} isYou />
              <PlayerCard name={opponent?.name ?? "等待对手"} life={opponent?.life ?? 20} library={opponent?.libraryCount ?? 0} hand={opponent?.handCount ?? 0} mulligans={opponent?.mulligans ?? 0} />
            </section>

            <section>
              <h2>常用操作</h2>
              <div className="buttonGrid">
                <button onClick={() => send({ type: "shuffleLibrary" })}>洗牌</button>
                <button onClick={() => send({ type: "draw", count: 1 })}>抓 1</button>
                <button onClick={() => send({ type: "draw", count: 7 })}>抓 7</button>
                <button onClick={() => send({ type: "mulligan" })}>调度</button>
                <button onClick={() => setShowLibrary(true)}>找牌</button>
                <button onClick={() => setShowDice(true)}>投骰子</button>
                <button className="danger" onClick={() => send({ type: "resetGame" })}>重开</button>
                <button disabled={!selectedCardId} onClick={() => selectedCardId && send({ type: "toggleTap", cardId: selectedCardId })}>横置/重置</button>
              </div>
              <div className="buttonGrid lifeGrid">
                <button onClick={() => send({ type: "setLife", life: (you?.life ?? 20) + 1 })}>生命 +1</button>
                <button onClick={() => send({ type: "setLife", life: (you?.life ?? 20) - 1 })}>生命 -1</button>
              </div>
            </section>

            <section>
              <h2>看牌库顶</h2>
              <div className="peekTool">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={peekCount}
                  onChange={(event) => setPeekCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                />
                <button onClick={() => setShowPeek(true)}>看牌库顶</button>
              </div>
              <p className="hint">只查看自己的牌库顶 X 张，可逐张移动到需要的区域。</p>
            </section>

            <section>
              <h2>阶段 / 回合</h2>
              <div className="phaseBadge">
                <span>{room.turn.activePlayerName}</span>
                <strong>{room.turn.phase}</strong>
              </div>
              <div className="phaseTrack">
                {phaseOrder.map((phase, index) => (
                  <button key={phase} className={index === currentPhaseIndex ? "phasePip active" : "phasePip"} onClick={() => send({ type: "declarePhase", phase })} title={phase}>
                    {index + 1}
                  </button>
                ))}
              </div>
              <div className="buttonGrid phaseButtons">
                <button onClick={() => send({ type: "stepPhase", direction: "previous" })}>上一阶段</button>
                <button onClick={() => send({ type: "stepPhase", direction: "next" })}>下一阶段</button>
                <button className="danger" onClick={() => send({ type: "endTurn" })}>回合结束</button>
              </div>
            </section>

            <section>
              <h2>移动选中牌</h2>
              <div className="buttonGrid">
                <button disabled={!selectedCardId} onClick={() => moveSelected("battlefield", "spell")}>到非地战场</button>
                <button disabled={!selectedCardId} onClick={() => moveSelected("battlefield", "land")}>到地区域</button>
                <button disabled={!selectedCardId} onClick={() => moveSelected("stack")}>到堆叠</button>
                {(["graveyard", "exile", "hand"] as ZoneId[]).map((zone) => (
                  <button key={zone} disabled={!selectedCardId} onClick={() => moveSelected(zone)}>
                    到{zoneLabels[zone]}
                  </button>
                ))}
              </div>
              <div className="buttonGrid libraryMoveGrid">
                <button disabled={!selectedCardId} onClick={() => moveSelected("library", undefined, "top")}>回牌库顶</button>
                <button disabled={!selectedCardId} onClick={() => moveSelected("library", undefined, "bottom")}>回牌库底</button>
                <button disabled={!selectedCardId} onClick={() => moveSelected("library", undefined, "shuffle")}>洗回牌库</button>
              </div>
              <p className="hint">{selectedCard ? `已选：${selectedCard.name}` : "点击一张牌后移动；也可以拖拽到对应区域。"}</p>
            </section>

            <section>
              <h2>指示物 / 计数器</h2>
              <div className="counterPanel">
                <div>
                  <span>+1/+1</span>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("plusOne", -1)}>-</button>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("plusOne", 1)}>+</button>
                </div>
                <div>
                  <span>计数器</span>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("generic", -1)}>-</button>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("generic", 1)}>+</button>
                </div>
              </div>
              <p className="hint">选中战场、坟场、放逐或堆叠中的牌后可调整。</p>
            </section>

            <section>
              <h2>释放 Token</h2>
              <div className="tokenTool">
                <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="Token 名称" />
                <label className="checkRow">
                  <input type="checkbox" checked={tokenHasPT} onChange={(event) => setTokenHasPT(event.target.checked)} />
                  有攻防
                </label>
                {tokenHasPT && (
                  <div className="ptRow">
                    <input value={tokenPower} onChange={(event) => setTokenPower(event.target.value)} placeholder="攻" />
                    <span>/</span>
                    <input value={tokenToughness} onChange={(event) => setTokenToughness(event.target.value)} placeholder="防" />
                  </div>
                )}
                <button onClick={createToken}>释放 Token</button>
              </div>
              <p className="hint">会记忆这次配置；下次直接点击释放即可。</p>
            </section>

            <section>
              <h2>导入牌表</h2>
              <textarea value={deckText} onChange={(event) => setDeckText(event.target.value)} />
              <button onClick={() => send({ type: "loadDeck", deckText })}>导入到牌库</button>
              <p className="hint">支持 “4 Lightning Bolt” 格式。不会自动识别地牌，拖到地区域即可。</p>
            </section>
          </aside>

          <section className="board">
            <Battlefield
              cards={room.publicZones.battlefield}
              stack={room.publicZones.stack}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
              onMove={moveCard}
              onToggleTap={(cardId) => send({ type: "toggleTap", cardId })}
              youId={room.youId}
              youName={you?.name ?? "你"}
              opponentName={opponent?.name ?? "对手"}
            />

            <Zone title="你的手牌" cards={you?.hand ?? []} selectedCardId={selectedCardId} onSelect={setSelectedCardId} onMove={moveCard} zoneId="hand" isPrivate />
          </section>

          <aside className="panel log">
            <PublicInfo room={room} onOpen={setDetailModal} />

            <h2>对局记录 / 聊天</h2>
            <div className="chatBox">
              <input
                placeholder="输入聊天或对局备注"
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendChat();
                }}
              />
              <button onClick={sendChat}>发送</button>
            </div>
            <ol>
              {room.log.slice().reverse().map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ol>
          </aside>

          {showLibrary && <LibrarySearch cards={filteredLibrary} query={libraryFilter} onQueryChange={setLibraryFilter} onClose={() => setShowLibrary(false)} onMove={moveCard} />}
          {showPeek && <PeekLibraryModal cards={peekCards} count={peekCount} selectedCardId={selectedCardId} onSelect={setSelectedCardId} onClose={() => setShowPeek(false)} onMove={moveCard} />}
          {showDice && <DiceModal onClose={() => setShowDice(false)} onRoll={rollDice} customSides={customDiceSides} setCustomSides={setCustomDiceSides} />}
          {detailModal && (
            <ZoneDetailModal
              title={detailModal.title}
              cards={room.publicZones[detailModal.zone].filter((card) => card.ownerId === detailModal.playerId)}
              onClose={() => setDetailModal(null)}
              onMove={moveCard}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
            />
          )}
        </main>
      )}
    </div>
  );
}

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const isViteDevServer = window.location.port === "5180";
  if (isViteDevServer) return `${protocol}//${window.location.hostname || "127.0.0.1"}:8787`;
  return `${protocol}//${window.location.host}`;
}

function PlayerCard(props: { name: string; life: number; library: number; hand: number; mulligans: number; isYou?: boolean }) {
  return (
    <div className={props.isYou ? "player you" : "player"}>
      <strong>{props.name}</strong>
      <span>生命 {props.life}</span>
      <span>牌库 {props.library}</span>
      <span>手牌 {props.hand}</span>
      <span>调度 {props.mulligans}</span>
    </div>
  );
}

function ManualModal(props: { onClose: () => void }) {
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="manualModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>游戏说明书</h2>
          <button className="secondary" onClick={props.onClose}>关闭</button>
        </div>
        <div className="manualContent">
          <h3>基本流程</h3>
          <p>创建房间后，把房间码或公网链接发给对手。双方导入牌表、洗牌、抓牌后即可开始。此工具不自动裁定规则，玩家自行判断合法性。</p>
          <h3>牌桌操作</h3>
          <ul>
            <li>点击牌可选中，左侧可移动到战场、堆叠、坟场、放逐、手牌或牌库。</li>
            <li>也可以拖拽牌到战场、堆叠、坟场、放逐等区域。</li>
            <li>右键战场上的牌可横置/重置。</li>
            <li>拖到“地”区域会按地显示；拖到“非地”区域会按非地显示。</li>
          </ul>
          <h3>公开信息</h3>
          <ul>
            <li>双方坟场和放逐区都在右侧公开显示，点击可查看完整列表。</li>
            <li>堆叠位于牌垫中央，顶部项目可进坟、放逐或进场。</li>
            <li>聊天、骰子、阶段、移动牌都会写入对局记录。</li>
          </ul>
          <h3>辅助工具</h3>
          <ul>
            <li>“找牌”只查看自己的牌库，可把牌移到手牌、地或非地战场。</li>
            <li>“释放 Token”会记忆上一次名称和攻防设置。</li>
            <li>“投骰子”结果公开。</li>
            <li>+1/+1 指示物和通用计数器需要先选中一张牌再调整。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function Battlefield(props: {
  cards: Card[];
  stack: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
  onToggleTap: (cardId: string) => void;
  youId: string;
  youName: string;
  opponentName: string;
}) {
  const yourCards = props.cards.filter((card) => card.ownerId === props.youId);
  const opponentCards = props.cards.filter((card) => card.ownerId !== props.youId);
  const yourNonLands = yourCards.filter((card) => card.kind !== "land");
  const yourLands = yourCards.filter((card) => card.kind === "land");
  const opponentNonLands = opponentCards.filter((card) => card.kind !== "land");
  const opponentLands = opponentCards.filter((card) => card.kind === "land");

  return (
    <section className="playmat">
      <div className="playmatHeader">
        <span>{props.opponentName}</span>
        <strong>战场</strong>
        <span>{props.youName}</span>
      </div>
      <div className="playmatSurface">
        <div className="playerSide opponentSide">
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="land" className="battleBand landBand opponentBack">
            <div className="bandLabel">对手地</div>
            <Cards cards={opponentLands} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onToggleTap={props.onToggleTap} youId={props.youId} />
          </DropArea>
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="spell" className="battleBand nonLandBand opponentFront">
            <div className="bandLabel">对手非地</div>
            <Cards cards={opponentNonLands} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onToggleTap={props.onToggleTap} youId={props.youId} />
          </DropArea>
        </div>
        <StackZone stack={props.stack} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onMove={props.onMove} />
        <div className="playerSide yourSide">
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="spell" className="battleBand nonLandBand yourFront">
            <div className="bandLabel">你的非地</div>
            <Cards cards={yourNonLands} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onToggleTap={props.onToggleTap} youId={props.youId} />
          </DropArea>
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="land" className="battleBand landBand yourBack">
            <div className="bandLabel">你的地</div>
            <Cards cards={yourLands} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onToggleTap={props.onToggleTap} youId={props.youId} />
          </DropArea>
        </div>
      </div>
    </section>
  );
}

function StackZone(props: {
  stack: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
}) {
  const top = props.stack.at(-1);
  return (
    <DropArea zoneId="stack" onMove={props.onMove} className="stackZone">
      <div className="stackHeader">
        <strong>堆叠</strong>
        <span>{props.stack.length ? `顶部：${top?.name}` : "拖拽咒语或异能到这里"}</span>
      </div>
      <div className="stackCards">
        {props.stack.slice().reverse().map((card, index) => (
          <button
            key={card.id}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("text/card-id", card.id)}
            className={["stackItem", props.selectedCardId === card.id ? "selected" : ""].join(" ")}
            onClick={() => props.onSelect(card.id)}
          >
            <small>#{props.stack.length - index}</small>
            <span>{card.name}</span>
            {index === 0 && <em>下一个结算</em>}
          </button>
        ))}
      </div>
      {top && (
        <div className="stackActions">
          <button onClick={() => props.onMove(top.id, "graveyard")}>顶部进坟</button>
          <button onClick={() => props.onMove(top.id, "exile")}>顶部放逐</button>
          <button onClick={() => props.onMove(top.id, "battlefield", "spell")}>顶部进场</button>
        </div>
      )}
    </DropArea>
  );
}

function PublicInfo(props: { room: ClientRoomView; onOpen: (modal: DetailModalState) => void }) {
  const players = props.room.players;
  return (
    <section className="publicInfo">
      <h2>公开区域</h2>
      {players.map((player) => {
        const graveyard = props.room.publicZones.graveyard.filter((card) => card.ownerId === player.id);
        const exile = props.room.publicZones.exile.filter((card) => card.ownerId === player.id);
        return (
          <div key={player.id} className={player.id === props.room.youId ? "publicPlayer youPublic" : "publicPlayer"}>
            <strong>{player.id === props.room.youId ? "你" : player.name}</strong>
            <ZoneSummary title="坟场" cards={graveyard} onOpen={() => props.onOpen({ title: `${player.name} 的坟场`, zone: "graveyard", playerId: player.id })} />
            <ZoneSummary title="放逐" cards={exile} onOpen={() => props.onOpen({ title: `${player.name} 的放逐`, zone: "exile", playerId: player.id })} />
          </div>
        );
      })}
    </section>
  );
}

function ZoneSummary(props: { title: string; cards: Card[]; onOpen: () => void }) {
  return (
    <button className="zoneSummary" onClick={props.onOpen}>
      <span>{props.title} {props.cards.length}</span>
      <small>{props.cards.slice(-2).map((card) => card.name).join(" / ") || "空"}</small>
    </button>
  );
}

function ZoneDetailModal(props: {
  title: string;
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
  onClose: () => void;
}) {
  const activeCardId = props.cards.some((card) => card.id === props.selectedCardId) ? props.selectedCardId : null;
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="libraryModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{props.title}</h2>
          <button className="secondary" onClick={props.onClose}>关闭</button>
        </div>
        <Cards cards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} />
        <div className="buttonGrid libraryMoveGrid">
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "battlefield", "spell")}>到战场</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "hand")}>到手</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "stack")}>到堆叠</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "library", undefined, "top")}>回顶</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "library", undefined, "bottom")}>回底</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "library", undefined, "shuffle")}>洗回</button>
        </div>
      </section>
    </div>
  );
}

function PeekLibraryModal(props: {
  cards: Card[];
  count: number;
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onClose: () => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
}) {
  const activeCardId = props.cards.some((card) => card.id === props.selectedCardId) ? props.selectedCardId : null;
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="libraryModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>看牌库顶 {props.count} 张</h2>
          <button className="secondary" onClick={props.onClose}>关闭</button>
        </div>
        <p className="hint">这里显示的是当前牌库顶开始的顺序。点击其中一张牌后，可把它移到指定区域；未移动的牌会保持在牌库中。</p>
        <Cards cards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} />
        <div className="buttonGrid libraryMoveGrid">
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "hand")}>到手</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "stack")}>到堆叠</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "graveyard")}>到坟场</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "exile")}>到放逐</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "library", undefined, "top")}>回顶</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "library", undefined, "bottom")}>回底</button>
          <button disabled={!activeCardId} onClick={() => activeCardId && props.onMove(activeCardId, "library", undefined, "shuffle")}>洗回</button>
        </div>
        {props.cards.length === 0 && <p className="hint">牌库里已经没有可查看的牌。</p>}
      </section>
    </div>
  );
}

function LibrarySearch(props: {
  cards: Card[];
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
}) {
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="libraryModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>找牌 / 搜牌库</h2>
          <button className="secondary" onClick={props.onClose}>关闭</button>
        </div>
        <input autoFocus placeholder="输入牌名搜索" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} />
        <div className="libraryList">
          {props.cards.map((card) => (
            <div key={card.id} className="libraryRow" draggable onDragStart={(event) => event.dataTransfer.setData("text/card-id", card.id)}>
              <span>{card.name}</span>
              <button onClick={() => props.onMove(card.id, "hand")}>到手</button>
              <button onClick={() => props.onMove(card.id, "battlefield", "spell")}>进非地</button>
              <button onClick={() => props.onMove(card.id, "battlefield", "land")}>进地</button>
            </div>
          ))}
          {props.cards.length === 0 && <p className="hint">没有匹配的牌。</p>}
        </div>
        <p className="hint">只显示自己的牌库。找完牌后，如果需要随机化，请手动点“洗牌”。</p>
      </section>
    </div>
  );
}

function DiceModal(props: {
  onClose: () => void;
  onRoll: (sides: number, count?: number) => void;
  customSides: number;
  setCustomSides: (sides: number) => void;
}) {
  const dice = [2, 4, 6, 8, 10, 12, 20, 100];
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="diceModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>公开投骰</h2>
          <button className="secondary" onClick={props.onClose}>关闭</button>
        </div>
        <div className="diceGrid">
          {dice.map((sides) => <button key={sides} onClick={() => props.onRoll(sides)}>D{sides}</button>)}
        </div>
        <div className="customDice">
          <input type="number" min={2} max={1000} value={props.customSides} onChange={(event) => props.setCustomSides(Number(event.target.value))} />
          <button onClick={() => props.onRoll(props.customSides)}>投自定义</button>
          <button onClick={() => props.onRoll(6, 2)}>2D6</button>
        </div>
        <p className="hint">骰子结果会公开写入右侧对局记录。</p>
      </section>
    </div>
  );
}

function Zone(props: {
  title: string;
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind) => void;
  zoneId: ZoneId;
  isPrivate?: boolean;
}) {
  return (
    <DropArea zoneId={props.zoneId} onMove={props.onMove} className="zone">
      <h2>{props.title} <span>{props.cards.length}</span></h2>
      <Cards cards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} />
      {props.cards.length === 0 && <div className="empty">{props.isPrivate ? "还没有手牌" : "拖到这里"}</div>}
    </DropArea>
  );
}

function DropArea(props: {
  zoneId: ZoneId;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind) => void;
  kind?: CardKind;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={props.className}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const cardId = event.dataTransfer.getData("text/card-id");
        if (cardId) props.onMove(cardId, props.zoneId, props.kind);
      }}
    >
      {props.children}
    </section>
  );
}

function Cards(props: {
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onToggleTap?: (cardId: string) => void;
  youId?: string;
}) {
  return (
    <div className="cards">
      {props.cards.map((card) => (
        <button
          key={card.id}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/card-id", card.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onToggleTap?.(card.id);
          }}
          className={[
            "card",
            card.ownerId === props.youId ? "mine" : "theirs",
            props.selectedCardId === card.id ? "selected" : "",
            card.tapped ? "tapped" : "",
            card.kind
          ].join(" ")}
          onClick={() => props.onSelect(card.id)}
        >
          <span>{card.name}</span>
          <div className="cardMeta">
            {card.token && <small>Token</small>}
            {(card.power || card.toughness) && <small>{card.power || "?"}/{card.toughness || "?"}</small>}
          </div>
          <div className="counterBadges">
            {!!card.plusOneCounters && <small>+{card.plusOneCounters}/+{card.plusOneCounters}</small>}
            {!!card.counters && <small>C:{card.counters}</small>}
          </div>
        </button>
      ))}
    </div>
  );
}

function findCard(room: ClientRoomView | null, cardId: string | null) {
  if (!room || !cardId) return null;
  for (const player of room.players) {
    const card = [...player.hand, ...player.library].find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  for (const zone of ["battlefield", "graveyard", "exile", "stack"] as PublicZoneId[]) {
    const card = room.publicZones[zone].find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  return null;
}
