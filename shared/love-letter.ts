export const ROLES = [
  {
    name: "間諜",
    count: 2,
    text: "回合結束時，若你是唯一仍在場且打出或棄掉間諜的人，額外獲得 1 枚好感。",
  },
  {
    name: "衛兵",
    count: 6,
    text: "選一位對手，猜測他持有的非衛兵角色。猜中則對手出局。",
  },
  { name: "神父", count: 2, text: "秘密查看一位對手的手牌。" },
  {
    name: "男爵",
    count: 2,
    text: "和一位對手秘密比牌，數值較低者出局；平手則無事發生。",
  },
  {
    name: "侍女",
    count: 2,
    text: "直到你的下次回合開始，其他玩家不能以你為目標。",
  },
  {
    name: "王子",
    count: 2,
    text: "指定任一玩家（包括自己）棄掉手牌並重抽。棄掉公主則出局。",
  },
  {
    name: "大臣",
    count: 2,
    text: "抽 2 張牌，保留 1 張，其餘依你指定的順序秘密放回牌庫底。",
  },
  { name: "國王", count: 1, text: "和一位對手交換手牌。" },
  {
    name: "伯爵夫人",
    count: 1,
    text: "你的另一張手牌為國王或王子時，必須打出伯爵夫人。",
  },
  { name: "公主", count: 1, text: "因任何原因打出或棄掉公主，你立即出局。" },
] as const;
export interface Card {
  id: string;
  value: number;
}
export interface LLPlayer {
  id: string;
  name: string;
  hand: Card[];
  discards: Card[];
  alive: boolean;
  protected: boolean;
  score: number;
}
export interface Log {
  text: string;
  recipients?: string[];
}
export type LLAction =
  | { type: "play"; card: string; target?: string; guess?: number }
  | { type: "chancellor"; keep: string; bottom: string[] }
  | { type: "next" };
export interface LLState {
  rulesVersion: string;
  players: LLPlayer[];
  deck: Card[];
  reserve: Card | null;
  removed: Card[];
  current: string;
  phase: "playing" | "chancellor" | "roundEnd" | "matchEnd";
  round: number;
  targetScore: number;
  logs: Log[];
  roundWinners: string[];
  winners: string[];
}
export interface Legal {
  cards: {
    id: string;
    targets: string[];
    needsTarget: boolean;
    needsGuess: boolean;
  }[];
  chancellor: boolean;
}
export interface LLView {
  rulesVersion: string;
  players: (Omit<LLPlayer, "hand"> & { hand?: Card[]; handCount: number })[];
  deckCount: number;
  removed: Card[];
  current: string;
  phase: LLState["phase"];
  round: number;
  targetScore: number;
  logs: { text: string }[];
  roundWinners: string[];
  winners: string[];
  legal: Legal;
}
