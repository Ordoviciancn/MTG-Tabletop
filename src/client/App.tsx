import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createTranslator, languageNames, translateLogEntry, translatePhase, translateServerMessage, type AppLanguage, type Translator } from "./i18n";
import type { Card, CardImageDatabase, CardImageRecord, CardKind, ClientMessage, ClientRoomView, LibraryPosition, PublicZoneId, ServerMessage, ZoneId } from "../shared/types";

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
const defaultCardBackUrl = "/mtg-card-back.png";

type DetailModalState = { title: string; zone: "graveyard" | "exile"; playerId: string } | null;
type LocalDeckPackage = {
  app?: "mtg-tabletop";
  version?: number;
  deckText?: string;
  cardImages?: CardImageDatabase;
  exportedAt?: string;
};
type ImagePreviewState = { title: string; imageUrl: string } | null;

const ImagePreviewContext = createContext<(preview: ImagePreviewState) => void>(() => undefined);

export function App() {
  const initialLanguage = getInitialLanguage();
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(initialLanguage);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("mtg-player-name") ?? (initialLanguage === "en" ? "Player" : "玩家"));
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
  const [deckText, setDeckText] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSideboard, setShowSideboard] = useState(false);
  const [peekCount, setPeekCount] = useState(3);
  const [showPeek, setShowPeek] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showMoveActions, setShowMoveActions] = useState(false);
  const [customDiceSides, setCustomDiceSides] = useState(20);
  const [chatText, setChatText] = useState("");
  const [detailModal, setDetailModal] = useState<DetailModalState>(null);
  const [cardImages, setCardImages] = useState<CardImageDatabase>(() => loadStoredCardImages());
  const [cardImageMessage, setCardImageMessage] = useState("");
  const [imagePreview, setImagePreview] = useState<ImagePreviewState>(null);
  const [isFetchingCardImages, setIsFetchingCardImages] = useState(false);
  const [tokenName, setTokenName] = useState(() => localStorage.getItem("mtg-token-name") ?? (initialLanguage === "en" ? "Soldier" : "士兵"));
  const [tokenPower, setTokenPower] = useState(() => localStorage.getItem("mtg-token-power") ?? "1");
  const [tokenToughness, setTokenToughness] = useState(() => localStorage.getItem("mtg-token-toughness") ?? "1");
  const [tokenHasPT, setTokenHasPT] = useState(() => localStorage.getItem("mtg-token-has-pt") !== "false");
  const [showManual, setShowManual] = useState(false);
  const [lifeDraft, setLifeDraft] = useState("20");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    localStorage.setItem("mtg-player-name", playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem("mtg-language", appLanguage);
    document.documentElement.lang = appLanguage === "en" ? "en" : "zh-CN";
  }, [appLanguage]);

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
        setError(translateServerMessage(message.message, createTranslator(appLanguage)));
      }
    };
    ws.onclose = () => setError(createTranslator(appLanguage)("connectionClosed"));
    return () => ws.close();
  }, [appLanguage]);

  const you = useMemo(() => room?.players.find((player) => player.id === room.youId), [room]);
  const opponent = useMemo(() => room?.players.find((player) => player.id !== room.youId), [room]);
  const selectedCard = useMemo(() => findCard(room, selectedCardId), [room, selectedCardId]);
  const filteredLibrary = useMemo(() => {
    const cards = you?.library ?? [];
    const query = libraryFilter.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter((card) => card.name.toLowerCase().includes(query));
  }, [you?.library, libraryFilter]);
  const peekCards = you?.peek ?? [];
  const deckReady = !!you?.hasDeck;
  const selectedIsBattlefield = !!selectedCardId && !!room?.publicZones.battlefield.some((card) => card.id === selectedCardId);
  const selectedIsToken = !!selectedCard?.token;
  const selectedIsDoubleFaced = selectedIsBattlefield && !!selectedCard?.doubleFaced;
  const t = useMemo(() => createTranslator(appLanguage), [appLanguage]);
  const deckStats = useMemo(() => parseDeckStats(deckText), [deckText]);
  const canEnterRoom = deckStats.total > 0 && !isFetchingCardImages;

  useEffect(() => {
    setLifeDraft(String(you?.life ?? 20));
  }, [you?.life]);

  function send(message: ClientMessage) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError(t("serverNotReady"));
      return;
    }
    wsRef.current.send(JSON.stringify(message));
  }

  async function createRoom() {
    const images = await prepareDeckForRoom();
    if (!images) return;
    send({ type: "createRoom", playerId, playerName, deckText, cardImages: images });
  }

  async function joinRoom() {
    const images = await prepareDeckForRoom();
    if (!images) return;
    send({ type: "joinRoom", roomCode: roomCodeInput, playerId, playerName, deckText, cardImages: images });
  }

  function moveSelected(toZone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    if (!selectedCardId) return;
    send({ type: "moveCard", cardId: selectedCardId, toZone, kind, libraryPosition });
    setSelectedCardId(null);
  }

  function moveCard(cardId: string, toZone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    if (toZone === "hand" && you?.hand.some((card) => card.id === cardId)) {
      setSelectedCardId(cardId);
      return;
    }
    send({ type: "moveCard", cardId, toZone, kind, libraryPosition });
    setSelectedCardId(null);
  }

  function moveCards(cardIds: string[], toZone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    if (cardIds.length === 0) return;
    send({ type: "moveCards", cardIds, toZone, kind, libraryPosition });
    setSelectedCardId(null);
  }

  function reorderHand(cardId: string, targetCardId: string) {
    send({ type: "reorderHand", cardId, targetCardId });
    setSelectedCardId(cardId);
  }

  function attachCard(cardId: string, targetCardId: string) {
    send({ type: "attachCard", cardId, targetCardId });
    setSelectedCardId(cardId);
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

  function clearSelectedCounter(counter: "plusOne" | "generic") {
    if (!selectedCardId) return;
    const currentValue = counter === "plusOne" ? (selectedCard?.plusOneCounters ?? 0) : (selectedCard?.counters ?? 0);
    if (currentValue <= 0) return;
    send({ type: "adjustCounter", cardId: selectedCardId, counter, delta: -currentValue });
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

  function extractPeekCards(isPublic = false) {
    send({ type: "peekLibrary", count: peekCount, public: isPublic });
    setShowPeek(true);
  }

  function commitLifeDraft() {
    const nextLife = Number(lifeDraft);
    if (!Number.isFinite(nextLife)) {
      setLifeDraft(String(you?.life ?? 20));
      return;
    }
    send({ type: "setLife", life: Math.max(-99, Math.min(999, Math.floor(nextLife))) });
  }

  async function importLocalDeck(file: File | undefined) {
    if (!file) return;
    try {
      const rawText = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const deckPackage = JSON.parse(rawText) as LocalDeckPackage;
        if (!deckPackage.deckText?.trim()) throw new Error(t("localDeckInvalid"));
        setDeckText(deckPackage.deckText);
        const nextImages = { ...cardImages, ...(deckPackage.cardImages ?? {}) };
        setCardImages(nextImages);
        localStorage.setItem("mtg-card-images", JSON.stringify(nextImages));
        setCardImageMessage(t("localDeckImported", { count: Object.keys(deckPackage.cardImages ?? {}).length }));
        return;
      }
      setDeckText(rawText);
      setCardImageMessage(t("deckTextImported"));
    } catch (error) {
      setCardImageMessage(t("localDeckImportFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function exportLocalDeck() {
    const names = parseDeckNames(deckText);
    if (names.length === 0) {
      setCardImageMessage(t("deckRequired"));
      return;
    }
    const readyImages = await ensureCardImagesForDeck();
    const deckImageMap: CardImageDatabase = {};
    for (const name of names) {
      const record = readyImages[normalizeCardName(name)];
      if (record) deckImageMap[normalizeCardName(name)] = record;
    }
    const deckPackage: LocalDeckPackage = {
      app: "mtg-tabletop",
      version: 1,
      deckText,
      cardImages: deckImageMap,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(deckPackage, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mtg-deck-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function prepareDeckForRoom() {
    if (parseDeckNames(deckText).length === 0) {
      setCardImageMessage(t("deckRequired"));
      return null;
    }
    return ensureCardImagesForDeck();
  }

  async function ensureCardImagesForDeck() {
    const names = parseDeckNames(deckText);
    if (names.length === 0) {
      setCardImageMessage(t("deckRequired"));
      return cardImages;
    }
    const missingNames = names.filter((name) => !cardImages[normalizeCardName(name)]);
    if (missingNames.length === 0) return cardImages;

    setIsFetchingCardImages(true);
    setCardImageMessage(t("cardImageFetching", { current: 0, total: missingNames.length }));
    const nextImages: CardImageDatabase = { ...cardImages };
    for (let index = 0; index < missingNames.length; index += 1) {
      const name = missingNames[index];
      setCardImageMessage(t("cardImageFetching", { current: index + 1, total: missingNames.length }));
      try {
        const record = await fetchScryfallImageRecord(name);
        nextImages[normalizeCardName(name)] = record;
        await sleep(90);
      } catch (error) {
        console.warn(`Failed to fetch Scryfall image for ${name}`, error);
      }
    }
    setIsFetchingCardImages(false);
    setCardImages(nextImages);
    localStorage.setItem("mtg-card-images", JSON.stringify(nextImages));
    setCardImageMessage(t("cardImageLoaded", { count: Object.keys(nextImages).length }));
    return nextImages;
  }

  return (
    <ImagePreviewContext.Provider value={setImagePreview}>
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">{t("appSubtitle")}</div>
          <h1>{t("appTitle")}</h1>
        </div>
        <div className="connection">{room ? `${t("room")} ${room.roomCode}` : t("notSeated")}</div>
      </header>

      {error && <div className="error">{error}</div>}

      {!room ? (
        <section className="panel lobby">
          <div className="lobbyHero">
            <div>
              <div className="eyebrow">{t("lobbyEyebrow")}</div>
              <h2>{t("lobbyHeroTitle")}</h2>
            </div>
            <button className="manualButton secondary" onClick={() => setShowManual(true)}>{t("viewManual")}</button>
          </div>

          <div className="lobbyGrid">
            <section className="lobbyCard">
              <h2>{t("lobbyProfile")}</h2>
              <label>
                {t("yourName")}
                <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
              </label>
              <label>
                {t("language")}
                <select value={appLanguage} onChange={(event) => setAppLanguage(event.target.value as AppLanguage)}>
                  <option value="zh">{languageNames.zh}</option>
                  <option value="en">{languageNames.en}</option>
                </select>
              </label>
              <div className="deckStats">
                <span><strong>{deckStats.total}</strong>{t("deckStatCards")}</span>
                <span><strong>{deckStats.unique}</strong>{t("deckStatNames")}</span>
                <span><strong>{deckStats.sideboard}</strong>{t("deckStatSideboard")}</span>
              </div>
              <button className="primaryAction" disabled={!canEnterRoom} onClick={createRoom}>{t("createRoom")}</button>
            </section>

            <section className="lobbyCard roomJoinCard">
              <h2>{t("joinExistingRoom")}</h2>
              <p className="hint">{t("joinExistingRoomHint")}</p>
              <div className="roomJoinRow">
                <input placeholder={t("roomCodePlaceholder")} value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} />
                <button className="secondary" disabled={!canEnterRoom || roomCodeInput.trim().length === 0} onClick={joinRoom}>{t("joinRoom")}</button>
              </div>
            </section>

            <section className="lobbyDeckSetup">
              <div className="lobbySectionHeader">
                <div>
                  <h2>{t("preRoomDeckSetup")}</h2>
                </div>
                <span className={deckStats.total > 0 ? "statusPill ready" : "statusPill"}>{deckStats.total > 0 ? t("deckReady") : t("deckMissing")}</span>
              </div>
              <textarea placeholder={defaultDeck} value={deckText} onChange={(event) => setDeckText(event.target.value)} />
              <div className="lobbyDeckActions">
                <button className="secondary" disabled={isFetchingCardImages || deckStats.total === 0} onClick={ensureCardImagesForDeck}>{t("fetchScryfallImages")}</button>
                <label className="fileButton">
                  {t("importLocalDeck")}
                  <input type="file" accept="application/json,.json,text/plain,.txt" onChange={(event) => importLocalDeck(event.target.files?.[0])} />
                </label>
                <button className="secondary" disabled={deckStats.total === 0} onClick={exportLocalDeck}>{t("exportLocalDeck")}</button>
              </div>
              {cardImageMessage && <p className="hint">{cardImageMessage}</p>}
            </section>
          </div>
          {showManual && <ManualModal t={t} onClose={() => setShowManual(false)} />}
        </section>
      ) : (
        <main className="table">
          <aside className="panel sidebar">
            <section className="players">
              <PlayerCard t={t} name={you?.name ?? t("you")} life={you?.life ?? 20} library={you?.libraryCount ?? 0} hand={you?.handCount ?? 0} mulligans={you?.mulligans ?? 0} isYou />
              <PlayerCard t={t} name={opponent?.name ?? t("waitingOpponent")} life={opponent?.life ?? 20} library={opponent?.libraryCount ?? 0} hand={opponent?.handCount ?? 0} mulligans={opponent?.mulligans ?? 0} />
            </section>

            <section>
              <h2>{t("commonActions")}</h2>
              <div className="buttonGrid">
                <button disabled={!deckReady} onClick={() => send({ type: "shuffleLibrary" })}>{t("shuffle")}</button>
                <button disabled={!deckReady} onClick={() => send({ type: "draw", count: 1 })}>{t("drawOne")}</button>
                <button disabled={!deckReady} onClick={() => send({ type: "draw", count: 7 })}>{t("drawSeven")}</button>
                <button disabled={!deckReady} onClick={() => send({ type: "mulligan" })}>{t("mulligan")}</button>
                <button disabled={!deckReady} onClick={() => setShowLibrary(true)}>{t("searchLibrary")}</button>
                <button onClick={() => setShowDice(true)}>{t("rollDice")}</button>
                <button disabled={!selectedCardId} onClick={() => selectedCardId && send({ type: "toggleTap", cardId: selectedCardId })}>{t("tapUntap")}</button>
                <button disabled={!selectedCardId} onClick={() => selectedCardId && send({ type: "toggleFaceDown", cardId: selectedCardId })}>{selectedCard?.faceDown ? t("turnFaceUp") : t("turnFaceDown")}</button>
                <button disabled={!selectedIsDoubleFaced} onClick={() => selectedCardId && send({ type: "toggleBackFace", cardId: selectedCardId })}>{selectedCard?.backFaceUp ? t("frontFace") : t("backFace")}</button>
              </div>
              <div className="buttonGrid lifeGrid">
                <button onClick={() => send({ type: "adjustLife", delta: 1 })}>{t("lifeUp")}</button>
                <input
                  aria-label={t("life")}
                  type="number"
                  value={lifeDraft}
                  onChange={(event) => setLifeDraft(event.target.value)}
                  onBlur={commitLifeDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitLifeDraft();
                  }}
                />
                <button onClick={() => send({ type: "adjustLife", delta: -1 })}>{t("lifeDown")}</button>
              </div>
            </section>

            <section>
              <h2>{t("peekLibraryTop")}</h2>
              <div className="peekTool">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={peekCount}
                  onChange={(event) => setPeekCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                />
                <button disabled={!deckReady} onClick={() => extractPeekCards(false)}>{t("peekLibraryTop")}</button>
                <button disabled={!deckReady} onClick={() => extractPeekCards(true)}>公开看顶</button>
                <button disabled={peekCards.length === 0} onClick={() => setShowPeek(true)}>{t("continuePeek", { count: peekCards.length })}</button>
              </div>
              <p className="hint">{t("peekHint")}</p>
            </section>

            <section>
              <button className="sectionToggle" onClick={() => setShowMoveActions((value) => !value)}>
                <span>{t("moveSelectedCard")}</span>
                <small>{showMoveActions ? t("collapse") : t("expand")}</small>
              </button>
              {showMoveActions && (
                <>
                  <div className="buttonGrid">
                    <button disabled={!selectedCardId} onClick={() => moveSelected("battlefield", "spell")}>{t("toNonLandBattlefield")}</button>
                    <button disabled={!selectedCardId} onClick={() => moveSelected("battlefield", "land")}>{t("toLandArea")}</button>
                    <button disabled={!selectedCardId} onClick={() => moveSelected("stack")}>{t("toStack")}</button>
                    <button disabled={!selectedIsBattlefield} onClick={() => selectedCardId && send({ type: "activateAbility", sourceCardId: selectedCardId })}>{t("abilityToStack")}</button>
                    <button disabled={!selectedIsToken} onClick={() => selectedCardId && send({ type: "removeToken", cardId: selectedCardId })}>{t("removeToken")}</button>
                    {(["graveyard", "exile", "hand"] as ZoneId[]).map((zone) => (
                      <button key={zone} disabled={!selectedCardId} onClick={() => moveSelected(zone)}>
                        {t("toZone", { zone: zoneLabel(zone, t) })}
                      </button>
                    ))}
                  </div>
                  <div className="buttonGrid libraryMoveGrid">
                    <button disabled={!selectedCardId} onClick={() => moveSelected("library", undefined, "top")}>{t("toLibraryTop")}</button>
                    <button disabled={!selectedCardId} onClick={() => moveSelected("library", undefined, "bottom")}>{t("toLibraryBottom")}</button>
                    <button disabled={!selectedCardId} onClick={() => moveSelected("library", undefined, "shuffle")}>{t("shuffleIntoLibrary")}</button>
                  </div>
                  <p className="hint">{selectedCard ? t("selectedCard", { name: selectedCard.name }) : t("selectCardHint")}</p>
                </>
              )}
            </section>

            <section>
              <h2>{t("counters")}</h2>
              <div className="counterPanel">
                <div>
                  <span>{t("plusOne")}</span>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("plusOne", -1)}>-</button>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("plusOne", 1)}>+</button>
                  <button disabled={!selectedCardId} onClick={() => clearSelectedCounter("plusOne")}>{t("clear")}</button>
                </div>
                <div>
                  <span>{t("genericCounter")}</span>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("generic", -1)}>-</button>
                  <button disabled={!selectedCardId} onClick={() => adjustSelected("generic", 1)}>+</button>
                  <button disabled={!selectedCardId} onClick={() => clearSelectedCounter("generic")}>{t("clear")}</button>
                </div>
              </div>
              <p className="hint">{t("counterHint")}</p>
            </section>

            <section>
              <h2>{t("tableCounter")}</h2>
              <div className="counterPanel">
                <div>
                  <span>{you?.tableCounters ?? 0}</span>
                  <button onClick={() => send({ type: "adjustTableCounter", delta: -1 })}>-</button>
                  <button onClick={() => send({ type: "adjustTableCounter", delta: 1 })}>+</button>
                  <button onClick={() => send({ type: "adjustTableCounter", delta: -(you?.tableCounters ?? 0) })}>{t("clear")}</button>
                </div>
              </div>
              <p className="hint">{t("tableCounterHint")}</p>
            </section>

            <section>
              <h2>{t("createToken")}</h2>
              <div className="tokenTool">
                <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder={t("tokenName")} />
                <label className="checkRow">
                  <input type="checkbox" checked={tokenHasPT} onChange={(event) => setTokenHasPT(event.target.checked)} />
                  {t("hasPowerToughness")}
                </label>
                {tokenHasPT && (
                  <div className="ptRow">
                    <input value={tokenPower} onChange={(event) => setTokenPower(event.target.value)} placeholder={t("power")} />
                    <span>/</span>
                    <input value={tokenToughness} onChange={(event) => setTokenToughness(event.target.value)} placeholder={t("toughness")} />
                  </div>
                )}
                <button onClick={createToken}>{t("createToken")}</button>
              </div>
              <p className="hint">{t("tokenHint")}</p>
            </section>

            <section>
              <h2>{t("sideboard")}</h2>
              <button disabled={!deckReady} className="secondary" onClick={() => setShowSideboard(true)}>{t("sideboard")}</button>
              <p className="hint">{t("sideboardOnlyHint")}</p>
            </section>

            <section className="dangerZone">
              <h2>{t("restart")}</h2>
              <button className="danger" onClick={() => send({ type: "resetGame" })}>{t("restartGame")}</button>
            </section>
          </aside>

          <section className="board">
            {!deckReady ? (
              <section className="panel deckGate">
                <h2>{t("importDeckFirst")}</h2>
                <p>{t("importDeckFirstText")}</p>
                <p className="hint">{t("importDeckFirstHint")}</p>
              </section>
            ) : (
              <>
                <Battlefield
                  cards={room.publicZones.battlefield}
                  stack={room.publicZones.stack}
                  selectedCardId={selectedCardId}
                  onSelect={setSelectedCardId}
                  onMove={moveCard}
                  onAttach={attachCard}
                  onToggleTap={(cardId) => send({ type: "toggleTap", cardId })}
                  onProcessStackItem={(stackItemId) => send({ type: "processStackItem", stackItemId })}
                  turn={room.turn}
                  onStepPhase={(direction) => send({ type: "stepPhase", direction })}
                  onSetTurnMode={(mode) => send({ type: "setTurnMode", mode })}
                  onEndTurn={() => send({ type: "endTurn" })}
                  youId={room.youId}
                  youName={you?.name ?? t("you")}
                  opponentName={opponent?.name ?? t("opponent")}
                  t={t}
                />

                <HandArea t={t} cards={you?.hand ?? []} selectedCardId={selectedCardId} onSelect={setSelectedCardId} onMove={moveCard} onReorder={reorderHand} />
              </>
            )}
          </section>

          <aside className="panel log">
            <PublicInfo t={t} room={room} onOpen={setDetailModal} />

            <h2>{t("publicLogChat")}</h2>
            <div className="chatBox">
              <input
                placeholder={t("chatPlaceholder")}
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendChat();
                }}
              />
              <button onClick={sendChat}>{t("send")}</button>
            </div>
            <ol>
              {room.log.slice().reverse().map((entry, index) => (
                <li key={`${entry}-${index}`}>{translateLogEntry(entry, appLanguage)}</li>
              ))}
            </ol>
            <h2>{t("privateLog")}</h2>
            <ol>
              {(you?.privateLog ?? []).slice().reverse().map((entry, index) => (
                <li key={`${entry}-${index}`}>{translateLogEntry(entry, appLanguage)}</li>
              ))}
            </ol>
          </aside>

          {showLibrary && <LibrarySearch t={t} cards={filteredLibrary} query={libraryFilter} onQueryChange={setLibraryFilter} onClose={() => setShowLibrary(false)} onMove={moveCard} />}
          {showSideboard && you && <SideboardModal t={t} main={you.library} sideboard={you.sideboard} onClose={() => setShowSideboard(false)} onMove={(cardId, to) => send({ type: "swapSideboardCard", cardId, to })} />}
          {showPeek && <PeekLibraryModal t={t} cards={peekCards} selectedCardId={selectedCardId} onSelect={setSelectedCardId} onClose={() => setShowPeek(false)} onMove={moveCard} onMoveMany={moveCards} />}
          {showDice && <DiceModal t={t} onClose={() => setShowDice(false)} onRoll={rollDice} customSides={customDiceSides} setCustomSides={setCustomDiceSides} />}
          {detailModal && (
            <ZoneDetailModal
              title={detailModal.title}
              cards={room.publicZones[detailModal.zone].filter((card) => card.ownerId === detailModal.playerId)}
              onClose={() => setDetailModal(null)}
              onMove={moveCard}
              onMoveMany={moveCards}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
              t={t}
            />
          )}
          {imagePreview && <ImagePreviewModal preview={imagePreview} onClose={() => setImagePreview(null)} t={t} />}
        </main>
      )}
      <footer className="siteFooter">{t("siteDisclaimer")}</footer>
    </div>
    </ImagePreviewContext.Provider>
  );
}

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const isViteDevServer = window.location.port === "5180";
  if (isViteDevServer) return `${protocol}//${window.location.hostname || "127.0.0.1"}:8787`;
  return `${protocol}//${window.location.host}`;
}

function getInitialLanguage(): AppLanguage {
  return localStorage.getItem("mtg-language") === "en" ? "en" : "zh";
}

function setDraggedCard(event: { dataTransfer: DataTransfer }, cardId: string) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/card-id", cardId);
  event.dataTransfer.setData("text/plain", cardId);
}

function getDraggedCard(event: { dataTransfer: DataTransfer }) {
  return event.dataTransfer.getData("text/card-id") || event.dataTransfer.getData("text/plain");
}

function getCardDisplayImage(card: Card) {
  if (card.faceDown) return card.cardBackUrl || defaultCardBackUrl;
  if (card.backFaceUp) return card.backImageUrl || card.imageUrl || "";
  return card.imageUrl || "";
}

function getCardHighresImage(card: Card) {
  if (card.faceDown) return card.cardBackUrl || defaultCardBackUrl;
  if (card.backFaceUp) return card.highresBackImageUrl || card.backImageUrl || card.highresImageUrl || card.imageUrl || "";
  return card.highresImageUrl || card.imageUrl || "";
}

function loadStoredCardImages(): CardImageDatabase {
  try {
    return JSON.parse(localStorage.getItem("mtg-card-images") ?? "{}") as CardImageDatabase;
  } catch {
    return {};
  }
}

function normalizeCardName(name: string) {
  return name.trim().toLowerCase();
}

function parseDeckNames(deckText: string) {
  const names = new Set<string>();
  for (const line of deckText.split(/\r?\n/)) {
    const rawLine = line.trim();
    if (!rawLine || rawLine.startsWith("#") || /^sideboard$/i.test(rawLine)) continue;
    const match = rawLine.replace(/^SB:\s*/i, "").trim().match(/^(\d+)\s+(.+)$/);
    if (match) names.add(match[2].trim());
  }
  return [...names];
}

function parseDeckStats(deckText: string) {
  const names = new Set<string>();
  let total = 0;
  let sideboard = 0;
  let inSideboard = false;
  let sawDeckLine = false;
  for (const line of deckText.split(/\r?\n/)) {
    const rawLine = line.trim();
    if (!rawLine) {
      if (sawDeckLine) inSideboard = true;
      continue;
    }
    if (rawLine.startsWith("#")) continue;
    if (/^sideboard$/i.test(rawLine)) {
      inSideboard = true;
      continue;
    }
    const isSideboardLine = /^SB:\s*/i.test(rawLine);
    const match = rawLine.replace(/^SB:\s*/i, "").trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    sawDeckLine = true;
    const count = Math.max(1, Math.min(99, Number(match[1]) || 1));
    total += count;
    if (inSideboard || isSideboardLine) sideboard += count;
    names.add(match[2].trim());
  }
  return { total, unique: names.size, sideboard };
}

async function fetchScryfallImageRecord(name: string): Promise<CardImageRecord> {
  const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Scryfall ${response.status}`);
  const card = await response.json();
  const frontImages = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  const backImages = card.card_faces?.[1]?.image_uris;
  return {
    name,
    imageUrl: frontImages?.normal ?? frontImages?.large ?? frontImages?.png,
    highresImageUrl: frontImages?.large ?? frontImages?.png ?? frontImages?.normal,
    backImageUrl: backImages?.normal ?? backImages?.large ?? backImages?.png,
    highresBackImageUrl: backImages?.large ?? backImages?.png ?? backImages?.normal,
    cardBackId: card.card_back_id,
    doubleFaced: !!backImages,
    scryfallUri: card.scryfall_uri
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function zoneLabel(zone: ZoneId, t: Translator) {
  const labels: Record<ZoneId, ReturnType<Translator>> = {
    library: t("zoneLibrary"),
    hand: t("zoneHand"),
    battlefield: t("zoneBattlefield"),
    graveyard: t("zoneGraveyard"),
    exile: t("zoneExile"),
    stack: t("zoneStack")
  };
  return labels[zone];
}

function PlayerCard(props: { t: Translator; name: string; life: number; library: number; hand: number; mulligans: number; isYou?: boolean }) {
  return (
    <div className={props.isYou ? "player you" : "player"}>
      <strong>{props.name}</strong>
      <span>{props.t("life")} {props.life}</span>
      <span>{props.t("library")} {props.library}</span>
      <span>{props.t("hand")} {props.hand}</span>
      <span>{props.t("mulligan")} {props.mulligans}</span>
    </div>
  );
}

function ManualModal(props: { t: Translator; onClose: () => void }) {
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="manualModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{props.t("manualTitle")}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <div className="manualContent">
          <h3>{props.t("manualBasicFlow")}</h3>
          <p>{props.t("manualBasicFlowText")}</p>
          <h3>{props.t("manualTableOps")}</h3>
          <ul>
            <li>{props.t("manualOpSelect")}</li>
            <li>{props.t("manualOpDrag")}</li>
            <li>{props.t("manualOpRightClick")}</li>
            <li>{props.t("manualOpLand")}</li>
          </ul>
          <h3>{props.t("manualPublicInfo")}</h3>
          <ul>
            <li>{props.t("manualPublicZones")}</li>
            <li>{props.t("manualStack")}</li>
            <li>{props.t("manualLogs")}</li>
          </ul>
          <h3>{props.t("manualTools")}</h3>
          <ul>
            <li>{props.t("manualSearch")}</li>
            <li>{props.t("manualToken")}</li>
            <li>{props.t("manualDice")}</li>
            <li>{props.t("manualCounters")}</li>
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
  onAttach: (cardId: string, targetCardId: string) => void;
  onToggleTap: (cardId: string) => void;
  onProcessStackItem: (stackItemId: string) => void;
  turn: ClientRoomView["turn"];
  onStepPhase: (direction: "previous" | "next") => void;
  onSetTurnMode: (mode: "manual" | "auto") => void;
  onEndTurn: () => void;
  youId: string;
  youName: string;
  opponentName: string;
  t: Translator;
}) {
  const rootCards = props.cards.filter((card) => !card.attachedTo);
  const yourCards = rootCards.filter((card) => card.ownerId === props.youId);
  const opponentCards = rootCards.filter((card) => card.ownerId !== props.youId);
  const yourNonLands = yourCards.filter((card) => card.kind !== "land");
  const yourLands = yourCards.filter((card) => card.kind === "land");
  const opponentNonLands = opponentCards.filter((card) => card.kind !== "land");
  const opponentLands = opponentCards.filter((card) => card.kind === "land");

  return (
    <section className="playmat">
      <div className="playmatHeader">
        <span>{props.opponentName}</span>
        <strong>{props.t("battlefield")}</strong>
        <span>{props.youName}</span>
      </div>
      <div className="playmatSurface">
        <div className="playerSide opponentSide">
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="land" className="battleBand landBand opponentBack">
            <div className="bandLabel">{props.t("opponentLands")}</div>
            <Cards t={props.t} cards={opponentLands} allCards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onAttach={props.onAttach} onToggleTap={props.onToggleTap} onMoveToGraveyard={(cardId) => props.onMove(cardId, "graveyard")} youId={props.youId} />
          </DropArea>
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="spell" className="battleBand nonLandBand opponentFront">
            <div className="bandLabel">{props.t("opponentNonLands")}</div>
            <Cards t={props.t} cards={opponentNonLands} allCards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onAttach={props.onAttach} onToggleTap={props.onToggleTap} onMoveToGraveyard={(cardId) => props.onMove(cardId, "graveyard")} youId={props.youId} />
          </DropArea>
        </div>
        <div className="battlefieldCenter">
          <StackZone t={props.t} stack={props.stack} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onMove={props.onMove} onProcess={props.onProcessStackItem} />
          <PhaseCenter
            t={props.t}
            turn={props.turn}
            onStepPhase={props.onStepPhase}
            onSetTurnMode={props.onSetTurnMode}
            onEndTurn={props.onEndTurn}
          />
        </div>
        <div className="playerSide yourSide">
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="spell" className="battleBand nonLandBand yourFront">
            <div className="bandLabel">{props.t("yourNonLands")}</div>
            <Cards t={props.t} cards={yourNonLands} allCards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onAttach={props.onAttach} onToggleTap={props.onToggleTap} onMoveToGraveyard={(cardId) => props.onMove(cardId, "graveyard")} youId={props.youId} />
          </DropArea>
          <DropArea zoneId="battlefield" onMove={props.onMove} kind="land" className="battleBand landBand yourBack">
            <div className="bandLabel">{props.t("yourLands")}</div>
            <Cards t={props.t} cards={yourLands} allCards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onAttach={props.onAttach} onToggleTap={props.onToggleTap} onMoveToGraveyard={(cardId) => props.onMove(cardId, "graveyard")} youId={props.youId} />
          </DropArea>
        </div>
      </div>
    </section>
  );
}

function StackZone(props: {
  t: Translator;
  stack: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
  onProcess: (stackItemId: string) => void;
}) {
  const top = props.stack.at(-1);
  return (
    <DropArea zoneId="stack" onMove={props.onMove} className="stackZone">
      <div className="stackHeader">
        <strong>{props.t("stack")}</strong>
        <span>{props.stack.length ? props.t("stackTop", { name: top?.name ?? "" }) : props.t("stackEmpty")}</span>
      </div>
      <div className="stackCards">
        {props.stack.slice().reverse().map((card, index) => (
          <button
            key={card.id}
            draggable
            onDragStart={(event) => setDraggedCard(event, card.id)}
            className={["stackItem", props.selectedCardId === card.id ? "selected" : ""].join(" ")}
            onClick={() => props.onSelect(card.id)}
          >
            <small>#{props.stack.length - index}</small>
            <span>{card.name}</span>
            {index === 0 && <em>{card.stackAbility ? props.t("abilityPending") : props.t("nextResolve")}</em>}
          </button>
        ))}
      </div>
      {top && (
        <div className="stackActions">
          {top.stackAbility ? (
            <button onClick={() => props.onProcess(top.id)}>{props.t("processAbility")}</button>
          ) : (
            <>
              <button onClick={() => props.onMove(top.id, "graveyard")}>{props.t("toGraveyardShort")}</button>
              <button onClick={() => props.onMove(top.id, "exile")}>{props.t("exileShort")}</button>
              <button onClick={() => props.onMove(top.id, "battlefield", "spell")}>{props.t("enterBattlefield")}</button>
            </>
          )}
        </div>
      )}
    </DropArea>
  );
}

function PhaseCenter(props: {
  t: Translator;
  turn: ClientRoomView["turn"];
  onStepPhase: (direction: "previous" | "next") => void;
  onSetTurnMode: (mode: "manual" | "auto") => void;
  onEndTurn: () => void;
}) {
  const isAuto = props.turn.mode === "auto";
  return (
    <section className={isAuto ? "phaseCenter autoPhase" : "phaseCenter"}>
      {!isAuto && <button className="phaseNav previous" onClick={() => props.onStepPhase("previous")}>{props.t("previousPhase")}</button>}
      <div className="phaseBadge">
        <span>{props.turn.activePlayerName}</span>
        <strong>{translatePhase(props.turn.phase, props.t)}</strong>
      </div>
      {!isAuto && <button className="phaseNav next" onClick={() => props.onStepPhase("next")}>{props.t("nextPhase")}</button>}
      <button className="phaseNav end danger" onClick={props.onEndTurn}>{props.t("endTurn")}</button>
      <button className="phaseModeToggle" onClick={() => props.onSetTurnMode(isAuto ? "manual" : "auto")}>{isAuto ? "手动" : "自动"}</button>
    </section>
  );
}

function HandArea(props: {
  t: Translator;
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind) => void;
  onReorder: (cardId: string, targetCardId: string) => void;
}) {
  return (
    <div className="handArea">
      <Zone t={props.t} title={props.t("yourHand")} cards={props.cards} selectedCardId={props.selectedCardId} onSelect={props.onSelect} onMove={props.onMove} onReorder={props.onReorder} zoneId="hand" isPrivate />
      <DropArea zoneId="stack" onMove={props.onMove} className="castZone">
        <strong>CAST</strong>
        <span>{props.t("castHint")}</span>
      </DropArea>
    </div>
  );
}

function PublicInfo(props: { t: Translator; room: ClientRoomView; onOpen: (modal: DetailModalState) => void }) {
  const players = props.room.players;
  return (
    <section className="publicInfo">
      <h2>{props.t("publicZones")}</h2>
      {players.map((player) => {
        const graveyard = props.room.publicZones.graveyard.filter((card) => card.ownerId === player.id);
        const exile = props.room.publicZones.exile.filter((card) => card.ownerId === player.id);
        return (
          <div key={player.id} className={player.id === props.room.youId ? "publicPlayer youPublic" : "publicPlayer"}>
            <strong>{player.id === props.room.youId ? props.t("you") : player.name}</strong>
            <ZoneSummary t={props.t} title={props.t("graveyard")} cards={graveyard} onOpen={() => props.onOpen({ title: `${player.name} ${props.t("graveyard")}`, zone: "graveyard", playerId: player.id })} />
            <ZoneSummary t={props.t} title={props.t("exile")} cards={exile} onOpen={() => props.onOpen({ title: `${player.name} ${props.t("exile")}`, zone: "exile", playerId: player.id })} />
          </div>
        );
      })}
    </section>
  );
}

function ZoneSummary(props: { t: Translator; title: string; cards: Card[]; onOpen: () => void }) {
  return (
    <button className="zoneSummary" onClick={props.onOpen}>
      <span>{props.title} {props.cards.length}</span>
      <small>{props.cards.slice(-2).map((card) => card.name).join(" / ") || props.t("empty")}</small>
    </button>
  );
}

function ZoneDetailModal(props: {
  t: Translator;
  title: string;
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
  onMoveMany: (cardIds: string[], zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
  onClose: () => void;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const activeCardId = props.cards.some((card) => card.id === props.selectedCardId) ? props.selectedCardId : null;
  const selectedIds = [...checkedIds].filter((cardId) => props.cards.some((card) => card.id === cardId));
  const actionIds = selectedIds.length ? selectedIds : activeCardId ? [activeCardId] : [];
  function toggleChecked(cardId: string) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }
  function moveAction(zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    if (actionIds.length > 1) props.onMoveMany(actionIds, zone, kind, libraryPosition);
    else if (actionIds[0]) props.onMove(actionIds[0], zone, kind, libraryPosition);
    setCheckedIds(new Set());
  }
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="libraryModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{props.title}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <div className="bulkBar">
          <span>已选 {selectedIds.length}</span>
          <button onClick={() => setCheckedIds(new Set(props.cards.map((card) => card.id)))}>全选</button>
          <button onClick={() => setCheckedIds(new Set())}>清空</button>
        </div>
        <div className="selectableCards">
          {props.cards.map((card) => (
            <label key={card.id} className="selectableCard">
              <input type="checkbox" checked={checkedIds.has(card.id)} onChange={() => toggleChecked(card.id)} />
              <Cards t={props.t} cards={[card]} selectedCardId={props.selectedCardId} onSelect={props.onSelect} />
            </label>
          ))}
        </div>
        <div className="buttonGrid libraryMoveGrid">
          <button disabled={actionIds.length === 0} onClick={() => moveAction("battlefield", "spell")}>{props.t("toBattlefield")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("hand")}>{props.t("toHand")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("stack")}>{props.t("toStack")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("graveyard")}>{props.t("toGraveyard")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("exile")}>{props.t("toExile")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("library", undefined, "top")}>{props.t("toLibraryTopShort")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("library", undefined, "bottom")}>{props.t("toLibraryBottomShort")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("library", undefined, "shuffle")}>{props.t("shuffleBackShort")}</button>
        </div>
      </section>
    </div>
  );
}

function PeekLibraryModal(props: {
  t: Translator;
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onClose: () => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
  onMoveMany: (cardIds: string[], zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) => void;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const activeCardId = props.cards.some((card) => card.id === props.selectedCardId) ? props.selectedCardId : null;
  const selectedIds = [...checkedIds].filter((cardId) => props.cards.some((card) => card.id === cardId));
  const actionIds = selectedIds.length ? selectedIds : activeCardId ? [activeCardId] : [];
  function toggleChecked(cardId: string) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }
  function moveAction(zone: ZoneId, kind?: CardKind, libraryPosition?: LibraryPosition) {
    if (actionIds.length > 1) props.onMoveMany(actionIds, zone, kind, libraryPosition);
    else if (actionIds[0]) props.onMove(actionIds[0], zone, kind, libraryPosition);
    setCheckedIds(new Set());
  }
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="libraryModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{props.t("peekTitle", { count: props.cards.length })}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <p className="hint">{props.t("peekModalHint")}</p>
        <div className="bulkBar">
          <span>已选 {selectedIds.length}</span>
          <button onClick={() => setCheckedIds(new Set(props.cards.map((card) => card.id)))}>全选</button>
          <button onClick={() => setCheckedIds(new Set())}>清空</button>
        </div>
        <div className="selectableCards">
          {props.cards.map((card) => (
            <label key={card.id} className="selectableCard">
              <input type="checkbox" checked={checkedIds.has(card.id)} onChange={() => toggleChecked(card.id)} />
              <Cards t={props.t} cards={[card]} selectedCardId={props.selectedCardId} onSelect={props.onSelect} />
            </label>
          ))}
        </div>
        <div className="buttonGrid libraryMoveGrid">
          <button disabled={actionIds.length === 0} onClick={() => moveAction("hand")}>{props.t("toHand")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("stack")}>{props.t("toStack")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("graveyard")}>{props.t("toGraveyard")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("exile")}>{props.t("toExile")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("library", undefined, "top")}>{props.t("toLibraryTopShort")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("library", undefined, "bottom")}>{props.t("toLibraryBottomShort")}</button>
          <button disabled={actionIds.length === 0} onClick={() => moveAction("library", undefined, "shuffle")}>{props.t("shuffleBackShort")}</button>
        </div>
        {props.cards.length === 0 && <p className="hint">{props.t("peekEmpty")}</p>}
      </section>
    </div>
  );
}

function SideboardModal(props: {
  t: Translator;
  main: Card[];
  sideboard: Card[];
  onClose: () => void;
  onMove: (cardId: string, to: "main" | "sideboard") => void;
}) {
  const grouped = groupCardsForSideboard(props.main, props.sideboard);
  const mainGroups = grouped.filter((group) => group.main.length > 0);
  const sideGroups = grouped.filter((group) => group.sideboard.length > 0);

  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="sideboardModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{props.t("sideboardTitle")}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <p className="hint">{props.t("sideboardHint")}</p>
        <div className="sideboardArena">
          <section className="sideboardColumn">
            <header>{props.t("mainDeckCount", { count: props.main.length })}</header>
            <div className="sideboardList">
              {mainGroups.map((group) => (
                <button key={group.name} className="sideboardCardRow" onClick={() => group.main[0] && props.onMove(group.main[0].id, "sideboard")}>
                  <span>{group.name}</span>
                  <strong>x{group.main.length}</strong>
                  <em>›</em>
                </button>
              ))}
            </div>
          </section>
          <section className="sideboardColumn sideboardBench">
            <header>{props.t("sideboardCount", { count: props.sideboard.length })}</header>
            <div className="sideboardList">
              {sideGroups.map((group) => (
                <button key={group.name} className="sideboardCardRow" onClick={() => group.sideboard[0] && props.onMove(group.sideboard[0].id, "main")}>
                  <em>‹</em>
                  <span>{group.name}</span>
                  <strong>x{group.sideboard.length}</strong>
                </button>
              ))}
              {sideGroups.length === 0 && <p className="hint">{props.t("noSideboardCards")}</p>}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function LibrarySearch(props: {
  t: Translator;
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
          <h2>{props.t("searchLibraryTitle")}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <input autoFocus placeholder={props.t("searchNamePlaceholder")} value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} />
        <div className="libraryList">
          {props.cards.map((card) => (
            <div key={card.id} className="libraryRow" draggable onDragStart={(event) => setDraggedCard(event, card.id)}>
              <span>{card.name}</span>
              <button onClick={() => props.onMove(card.id, "hand")}>{props.t("toHand")}</button>
              <button onClick={() => props.onMove(card.id, "battlefield", "spell")}>{props.t("enterNonLand")}</button>
              <button onClick={() => props.onMove(card.id, "battlefield", "land")}>{props.t("enterLand")}</button>
            </div>
          ))}
          {props.cards.length === 0 && <p className="hint">{props.t("noMatches")}</p>}
        </div>
        <p className="hint">{props.t("searchHint")}</p>
      </section>
    </div>
  );
}

function DiceModal(props: {
  t: Translator;
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
          <h2>{props.t("publicDice")}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <div className="diceGrid">
          {dice.map((sides) => <button key={sides} onClick={() => props.onRoll(sides)}>D{sides}</button>)}
        </div>
        <div className="customDice">
          <input type="number" min={2} max={1000} value={props.customSides} onChange={(event) => props.setCustomSides(Number(event.target.value))} />
          <button onClick={() => props.onRoll(props.customSides)}>{props.t("rollCustom")}</button>
          <button onClick={() => props.onRoll(6, 2)}>2D6</button>
        </div>
        <p className="hint">{props.t("diceHint")}</p>
      </section>
    </div>
  );
}

function ImagePreviewModal(props: { preview: NonNullable<ImagePreviewState>; onClose: () => void; t: Translator }) {
  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <section className="imagePreviewModal panel" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{props.preview.title}</h2>
          <button className="secondary" onClick={props.onClose}>{props.t("close")}</button>
        </div>
        <img src={props.preview.imageUrl} alt={props.preview.title} />
      </section>
    </div>
  );
}

function Zone(props: {
  t: Translator;
  title: string;
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onMove: (cardId: string, zone: ZoneId, kind?: CardKind) => void;
  onReorder?: (cardId: string, targetCardId: string) => void;
  zoneId: ZoneId;
  isPrivate?: boolean;
}) {
  function moveIntoZone(cardId: string, zone: ZoneId, kind?: CardKind) {
    if (props.zoneId === "hand" && props.cards.some((card) => card.id === cardId)) return;
    props.onMove(cardId, zone, kind);
  }

  return (
    <DropArea zoneId={props.zoneId} onMove={moveIntoZone} className="zone">
      <h2>{props.title} <span>{props.cards.length}</span></h2>
      <Cards
        t={props.t}
        cards={props.cards}
        selectedCardId={props.selectedCardId}
        onSelect={props.onSelect}
        onReorder={props.onReorder}
        onMoveToZone={(cardId) => moveIntoZone(cardId, props.zoneId)}
      />
      {props.cards.length === 0 && <div className="empty">{props.isPrivate ? props.t("noHand") : props.t("dragHere")}</div>}
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
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const cardId = getDraggedCard(event);
        if (cardId) props.onMove(cardId, props.zoneId, props.kind);
      }}
    >
      {props.children}
    </section>
  );
}

function Cards(props: {
  t: Translator;
  cards: Card[];
  allCards?: Card[];
  selectedCardId: string | null;
  onSelect: (cardId: string) => void;
  onAttach?: (cardId: string, targetCardId: string) => void;
  onReorder?: (cardId: string, targetCardId: string) => void;
  onMoveToZone?: (cardId: string) => void;
  onMoveToGraveyard?: (cardId: string) => void;
  onToggleTap?: (cardId: string) => void;
  youId?: string;
}) {
  const openImagePreview = useContext(ImagePreviewContext);
  const rightPressRef = useRef<{ timer: number; fired: boolean; cardId: string } | null>(null);
  const allCards = props.allCards ?? props.cards;
  const attachmentsByParent = new Map<string, Card[]>();
  for (const card of allCards) {
    if (!card.attachedTo) continue;
    const attached = attachmentsByParent.get(card.attachedTo) ?? [];
    attached.push(card);
    attachmentsByParent.set(card.attachedTo, attached);
  }
  for (const attachments of attachmentsByParent.values()) {
    attachments.sort((a, b) => (a.attachmentOrder ?? 0) - (b.attachmentOrder ?? 0));
  }

  function renderCard(card: Card, depth = 0, attachmentIndex = 0): React.ReactNode {
    const attachments = attachmentsByParent.get(card.id) ?? [];
    const visibleName = card.faceDown ? props.t("cardBack") : card.name;
    const imageUrl = getCardDisplayImage(card);
    const highresImageUrl = getCardHighresImage(card);
    const isSelected = props.selectedCardId === card.id;
    const groupClassName = [
      depth ? "attachedCardGroup" : "cardGroup",
      attachments.length ? "hasAttachments" : ""
    ].join(" ");
    return (
      <div key={card.id} className={groupClassName} style={{ "--attachment-index": attachmentIndex } as CSSProperties}>
        <button
          draggable
          onDragStart={(event) => setDraggedCard(event, card.id)}
          onDragOver={(event) => {
            if (!props.onAttach && !props.onReorder) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!props.onAttach && !props.onReorder) return;
            event.preventDefault();
            event.stopPropagation();
            const draggedCardId = getDraggedCard(event);
            if (!draggedCardId || draggedCardId === card.id) return;
            if (props.onReorder) {
              if (props.cards.some((candidate) => candidate.id === draggedCardId)) props.onReorder(draggedCardId, card.id);
              else props.onMoveToZone?.(draggedCardId);
            }
            else props.onAttach?.(draggedCardId, card.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            const press = rightPressRef.current;
            if (press?.cardId === card.id && press.fired) {
              rightPressRef.current = null;
              return;
            }
            props.onToggleTap?.(card.id);
          }}
          onMouseDown={(event) => {
            if (event.button !== 2 || !props.onMoveToGraveyard) return;
            const timer = window.setTimeout(() => {
              rightPressRef.current = { timer, fired: true, cardId: card.id };
              props.onMoveToGraveyard?.(card.id);
            }, 650);
            rightPressRef.current = { timer, fired: false, cardId: card.id };
          }}
          onMouseUp={() => {
            const press = rightPressRef.current;
            if (!press) return;
            window.clearTimeout(press.timer);
          }}
          onMouseLeave={() => {
            const press = rightPressRef.current;
            if (!press) return;
            window.clearTimeout(press.timer);
          }}
          onDoubleClick={() => {
            if (highresImageUrl) openImagePreview({ title: visibleName, imageUrl: highresImageUrl });
          }}
          className={[
            "card",
            depth ? "attachedCard" : "",
            imageUrl ? "imageCard" : "",
            card.stackAbility ? "abilityCard" : "",
            card.faceDown ? "faceDown" : "",
            card.ownerId === props.youId ? "mine" : "theirs",
            isSelected ? "selected" : "",
            card.tapped ? "tapped" : "",
            card.kind
          ].join(" ")}
          onClick={() => props.onSelect(card.id)}
        >
          {imageUrl ? <img className="cardImage" src={imageUrl} alt={visibleName} draggable={false} loading="lazy" decoding="async" /> : <span>{visibleName}</span>}
          {!card.faceDown && !imageUrl && (
            <>
              <div className="cardMeta">
                {card.token && <small>Token</small>}
                {card.stackAbility && <small>{props.t("ability")}</small>}
                {(card.power || card.toughness) && <small>{card.power || "?"}/{card.toughness || "?"}</small>}
              </div>
            </>
          )}
          {!card.faceDown && (
            <div className="counterBadges">
              {!!card.plusOneCounters && <small>+{card.plusOneCounters}/+{card.plusOneCounters}</small>}
              {!!card.counters && <small>C:{card.counters}</small>}
            </div>
          )}
        </button>
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((attached, index) => renderCard(attached, depth + 1, index))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cards">
      {props.cards.map((card) => renderCard(card))}
    </div>
  );
}

function findCard(room: ClientRoomView | null, cardId: string | null) {
  if (!room || !cardId) return null;
  for (const player of room.players) {
    const card = [...player.hand, ...player.library, ...player.peek, ...player.sideboard].find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  for (const zone of ["battlefield", "graveyard", "exile", "stack"] as PublicZoneId[]) {
    const card = room.publicZones[zone].find((candidate) => candidate.id === cardId);
    if (card) return card;
  }
  return null;
}

function groupCardsForSideboard(main: Card[], sideboard: Card[]) {
  const groups = new Map<string, { name: string; main: Card[]; sideboard: Card[]; order: number }>();
  let order = 0;
  for (const [source, cards] of [["main", main], ["sideboard", sideboard]] as const) {
    for (const card of cards) {
      const existing = groups.get(card.name);
      const group = existing ?? { name: card.name, main: [], sideboard: [], order: order++ };
      group[source].push(card);
      groups.set(card.name, group);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.order - b.order);
}
