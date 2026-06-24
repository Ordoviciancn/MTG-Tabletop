export type ZoneId =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "stack";

export type PublicZoneId = Exclude<ZoneId, "library" | "hand">;
export type CardKind = "land" | "creature" | "spell";
export type LibraryPosition = "top" | "bottom" | "shuffle";
export type CounterKind = "plusOne" | "generic";

export type Card = {
  id: string;
  name: string;
  ownerId: string;
  kind: CardKind;
  token?: boolean;
  power?: string;
  toughness?: string;
  tapped?: boolean;
  plusOneCounters?: number;
  counters?: number;
  attachedTo?: string;
  attachmentOrder?: number;
  stackAbility?: boolean;
  sourceCardId?: string;
};

export type PlayerView = {
  id: string;
  name: string;
  life: number;
  libraryCount: number;
  handCount: number;
  mulligans: number;
  hand: Card[];
  library: Card[];
  peek: Card[];
  sideboard: Card[];
  hasDeck: boolean;
  tableCounters: number;
  privateLog: string[];
};

export type PublicZones = Record<PublicZoneId, Card[]>;

export type TurnView = {
  activePlayerId: string | null;
  activePlayerName: string;
  phase: string;
  canUndoPhase: boolean;
};

export type ClientRoomView = {
  roomCode: string;
  youId: string;
  players: PlayerView[];
  publicZones: PublicZones;
  turn: TurnView;
  firstPlayerId: string | null;
  firstPlayerName: string;
  log: string[];
};

export type ClientMessage =
  | { type: "createRoom"; playerId: string; playerName: string }
  | { type: "joinRoom"; roomCode: string; playerId: string; playerName: string }
  | { type: "loadDeck"; deckText: string }
  | { type: "swapSideboardCard"; cardId: string; to: "main" | "sideboard" }
  | { type: "shuffleLibrary" }
  | { type: "draw"; count: number }
  | { type: "peekLibrary"; count: number }
  | { type: "mulligan" }
  | { type: "resetGame" }
  | { type: "setFirstPlayer"; playerId: string }
  | { type: "moveCard"; cardId: string; toZone: ZoneId; kind?: CardKind; libraryPosition?: LibraryPosition }
  | { type: "attachCard"; cardId: string; targetCardId: string }
  | { type: "detachCard"; cardId: string }
  | { type: "activateAbility"; sourceCardId: string }
  | { type: "processStackItem"; stackItemId: string }
  | { type: "removeToken"; cardId: string }
  | { type: "toggleTap"; cardId: string }
  | { type: "setLife"; life: number }
  | { type: "adjustTableCounter"; delta: number }
  | { type: "adjustCounter"; cardId: string; counter: CounterKind; delta: number }
  | { type: "declarePhase"; phase: string }
  | { type: "stepPhase"; direction: "next" | "previous" }
  | { type: "undoPhase" }
  | { type: "endTurn" }
  | { type: "chat"; text: string }
  | { type: "rollDice"; sides: number; count?: number }
  | { type: "createToken"; name: string; power?: string; toughness?: string };

export type ServerMessage =
  | { type: "room"; room: ClientRoomView }
  | { type: "error"; message: string };
