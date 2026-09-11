export interface Seat {
  id: string;
  name: string;
}
export interface GameInfo {
  id: string;
  name: string;
  rulesVersion: string;
  minPlayers: number;
  maxPlayers: number;
  description: string;
  firstPlayerPolicy: "host-choice" | "random";
}
export interface GameDefinition<S = unknown, A = unknown, V = unknown> {
  info: GameInfo;
  initialize(seats: Seat[], first: string, random: (max: number) => number): S;
  legalActions(state: S, player: string): unknown;
  parseAction(input: unknown): A;
  transition(
    state: S,
    player: string,
    action: A,
    random: (max: number) => number,
  ): S;
  playerView(state: S, player: string): V;
  spectatorView(state: S): V;
  result(
    state: S,
  ): { scores: Record<string, number>; winners: string[] } | null;
}
