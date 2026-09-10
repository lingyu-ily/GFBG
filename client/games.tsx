import type { ComponentType } from "react";
import type { RoomAction, RoomView } from "../shared/room";
import type { LLView } from "../shared/love-letter";
import { LoveLetterTable } from "./table";
import { ShadowHuntersTable } from "./shadow-hunters";
import type { SHView } from "../shared/shadow-hunters";
export interface TableProps {
  room: RoomView;
  me: string;
  busy: boolean;
  onAction: (action: RoomAction) => void;
}
// This is the only game-specific UI boundary. The room transport stays opaque.
export interface GameUiDefinition {
  Table: ComponentType<TableProps>;
  englishName: string;
  coverNumber: string;
  coverLine: string;
  coverTagline: string;
  coverCredit: string;
  coverDetail: string;
  genres: string;
  duration: string;
  complexity: string;
  complexityNote: string;
  roomTitle: string;
  activeTitle: string;
  waitingTitle: string;
  waitingSteps: string[];
  waitingSummary: string;
  score: (score: number) => string;
  showHistoryStatus: boolean;
  theme: string;
}
export const gameUis: Record<string, GameUiDefinition> = {
  "love-letter": {
    Table: (props) => <LoveLetterTable {...props} room={props.room as RoomView<LLView>} />,
    englishName: "Love Letter",
    coverNumber: "01",
    coverLine: "A GAME OF RISK & DEDUCTION",
    coverTagline: "心意只有一封，心機不只一種。",
    coverCredit: "SEIJI KANAI",
    coverDetail: "21 CARDS / 10 ROLES",
    genres: "推理 · 運氣 · 心理戰",
    duration: "20 分",
    complexity: "輕量",
    complexityNote: "容易上手",
    roomTitle: "一封信，無數可能。",
    activeTitle: "一封信，無數可能。",
    waitingTitle: "少一點規則，多一點心機。",
    waitingSteps: ["輪到你時，抽一張、出一張。", "善用角色，猜出朋友手中的秘密。", "留到最後，或留下最大的牌。"],
    waitingSummary: "每輪贏得好感，率先達標就獲勝。詳細角色效果在牌桌上隨時可查。",
    score: (score) => `${score} 好感`,
    showHistoryStatus: true,
    theme: "love-letter",
  },
  "shadow-hunters": {
    Table: (props) => <ShadowHuntersTable {...props} room={props.room as RoomView<SHView>} />,
    englishName: "Shadow Hunters",
    coverNumber: "02",
    coverLine: "A HIDDEN WAR IN THE FOREST",
    coverTagline: "敵友未明，勝負早已潛伏。",
    coverCredit: "YASUTAKA IKEDA",
    coverDetail: "20 ROLES / 3 DECKS",
    genres: "隱藏身分 · 推理 · 戰鬥",
    duration: "30–60 分",
    complexity: "中量",
    complexityNote: "陣營推理",
    roomTitle: "迷霧裡，沒有人值得全信。",
    activeTitle: "獵殺，已經開始。",
    waitingTitle: "藏好身分，認清敵友。",
    waitingSteps: ["擲 D4 與 D6，移動到新的地點。", "選擇是否執行地點效果。", "攻擊同一區域內的可疑角色。"],
    waitingSummary: "獵人、暗影與中立角色各有勝利條件；公開身分後才能使用多數特殊能力。",
    score: (score) => (score ? "勝利" : "敗北"),
    showHistoryStatus: false,
    theme: "shadow-hunters",
  },
};
export const tables: Record<string, ComponentType<TableProps>> = Object.fromEntries(
  Object.entries(gameUis).map(([id, ui]) => [id, ui.Table]),
);
