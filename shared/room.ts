export interface Member {
  id: string;
  name: string;
  ready: boolean;
  online: boolean;
  position: number;
}
export interface RoomView<GameView = unknown> {
  id: string;
  code: string;
  gameId: string;
  hostId: string;
  status: "waiting" | "active" | "finished" | "aborted";
  version: number;
  members: Member[];
  game: GameView | null;
}
export type RoomAction =
  | { type: "ready"; ready: boolean }
  | { type: "start"; first?: string }
  | { type: "returnToLobby" }
  | { type: "abort" }
  | { type: "leave" }
  | { type: "game"; action: unknown };
export type RoomCommand = RoomAction;
