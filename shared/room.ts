export interface Member {
  id: string;
  name: string;
  ready: boolean;
  online: boolean;
  position: number;
  avatarUrl: string | null;
}
export interface Spectator {
  id: string;
  name: string;
  avatarUrl: string | null;
}
export interface RoomView<GameView = unknown> {
  id: string;
  code: string;
  gameId: string;
  hostId: string;
  status: "waiting" | "active" | "finished" | "aborted";
  isPublic: boolean;
  viewerRole: "player" | "spectator";
  version: number;
  members: Member[];
  spectators: Spectator[];
  game: GameView | null;
}
export interface PublicRoomSummary {
  id: string;
  code: string;
  gameId: string;
  status: "waiting" | "active";
  playerCount: number;
  spectatorCount: number;
  updatedAt: string;
}
export type RoomAction =
  | { type: "ready"; ready: boolean }
  | { type: "start"; first?: string }
  | { type: "setVisibility"; isPublic: boolean }
  | { type: "returnToLobby" }
  | { type: "abort" }
  | { type: "leave" }
  | { type: "game"; action: unknown };
export type RoomCommand = RoomAction;
