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

export type CardImageRecord = {
  name: string;
  imageUrl?: string;
  highresImageUrl?: string;
  backImageUrl?: string;
  highresBackImageUrl?: string;
  cardBackId?: string;
  cardBackUrl?: string;
  doubleFaced?: boolean;
  scryfallUri?: string;
};

export type CardImageDatabase = Record<string, CardImageRecord>;

export type Card = {
  id: string;
  name: string;
  ownerId: string;
  kind: CardKind;
  token?: boolean;
  power?: string;
  toughness?: string;
  tapped?: boolean;
  faceDown?: boolean;
  plusOneCounters?: number;
  counters?: number;
  attachedTo?: string;
  attachmentOrder?: number;
  stackAbility?: boolean;
  sourceCardId?: string;
  imageUrl?: string;
  highresImageUrl?: string;
  backImageUrl?: string;
  highresBackImageUrl?: string;
  cardBackUrl?: string;
  doubleFaced?: boolean;
  backFaceUp?: boolean;
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
  mode: "manual" | "auto";
};

export type ClientRoomView = {
  roomCode: string;
  youId: string;
  players: PlayerView[];
  publicZones: PublicZones;
  turn: TurnView;
  log: string[];
};

export type ClientMessage =
  | { type: "createRoom"; playerId: string; playerName: string; deckText?: string; cardImages?: CardImageDatabase }
  | { type: "joinRoom"; roomCode: string; playerId: string; playerName: string; deckText?: string; cardImages?: CardImageDatabase }
  | { type: "swapSideboardCard"; cardId: string; to: "main" | "sideboard" }
  | { type: "shuffleLibrary" }
  | { type: "reorderHand"; cardId: string; targetCardId: string }
  | { type: "draw"; count: number }
  | { type: "peekLibrary"; count: number; public?: boolean }
  | { type: "mulligan" }
  | { type: "resetGame" }
  | { type: "moveCard"; cardId: string; toZone: ZoneId; kind?: CardKind; libraryPosition?: LibraryPosition }
  | { type: "moveCards"; cardIds: string[]; toZone: ZoneId; kind?: CardKind; libraryPosition?: LibraryPosition }
  | { type: "attachCard"; cardId: string; targetCardId: string }
  | { type: "detachCard"; cardId: string }
  | { type: "activateAbility"; sourceCardId: string }
  | { type: "processStackItem"; stackItemId: string }
  | { type: "removeToken"; cardId: string }
  | { type: "toggleTap"; cardId: string }
  | { type: "toggleFaceDown"; cardId: string }
  | { type: "toggleBackFace"; cardId: string }
  | { type: "setLife"; life: number }
  | { type: "adjustLife"; delta: number }
  | { type: "adjustTableCounter"; delta: number }
  | { type: "adjustCounter"; cardId: string; counter: CounterKind; delta: number }
  | { type: "declarePhase"; phase: string }
  | { type: "stepPhase"; direction: "next" | "previous" }
  | { type: "setTurnMode"; mode: "manual" | "auto" }
  | { type: "undoPhase" }
  | { type: "endTurn" }
  | { type: "chat"; text: string }
  | { type: "rollDice"; sides: number; count?: number }
  | { type: "createToken"; name: string; power?: string; toughness?: string };

export type ServerMessage =
  | { type: "room"; room: ClientRoomView }
  | { type: "error"; message: string };
