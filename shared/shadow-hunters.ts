export type SHFaction = "hunter" | "shadow" | "neutral";
export type SHDeck = "white" | "black" | "hermit";

export interface SHCharacter {
  id: string;
  initial: string;
  name: string;
  englishName: string;
  faction: SHFaction;
  maxHp: number;
  win: string;
  ability: string;
}

export const CHARACTERS: readonly SHCharacter[] = [
  { id: "allie", initial: "A", name: "愛麗", englishName: "Allie", faction: "neutral", maxHp: 8, win: "遊戲結束時仍然存活。", ability: "母愛：每局一次，完全治療自己。" },
  { id: "agnes", initial: "A", name: "艾格妮絲", englishName: "Agnes", faction: "neutral", maxHp: 8, win: "起始座位右邊的玩家獲勝時，你也獲勝。", ability: "隨想曲：每局一次，在回合開始時把勝利條件改為左邊玩家獲勝。" },
  { id: "bob", initial: "B", name: "鮑伯", englishName: "Bob", faction: "neutral", maxHp: 10, win: "持有至少 5 張裝備。", ability: "搶奪：4–6 人時可用一次至少 2 點的攻擊傷害換取目標一件裝備；7–8 人時取得自己擊殺者的全部裝備。" },
  { id: "bryan", initial: "B", name: "布萊恩", englishName: "Bryan", faction: "neutral", maxHp: 10, win: "以攻擊殺死原始生命 13 以上的角色；或遊戲結束時位於祭壇。", ability: "天啊：以攻擊殺死原始生命 12 以下角色時必須公開身分。" },
  { id: "charles", initial: "C", name: "查爾斯", englishName: "Charles", faction: "neutral", maxHp: 11, win: "你的攻擊造成全場第 3 名或更晚的死亡。", ability: "血宴：攻擊後可受到 2 點傷害，再攻擊同一目標一次。" },
  { id: "catherine", initial: "C", name: "凱瑟琳", englishName: "Catherine", faction: "neutral", maxHp: 11, win: "成為第一批死亡者，或成為最後兩名生還者之一。", ability: "聖痕：每次自己的回合開始時可治療 1 點。" },
  { id: "daniel", initial: "D", name: "丹尼爾", englishName: "Daniel", faction: "neutral", maxHp: 13, win: "第一個死亡；若未達成，則在所有暗影死亡且自己存活時獲勝。", ability: "尖叫：其他角色首次死亡時強制公開；其他時間不能自行公開。" },
  { id: "david", initial: "D", name: "大衛", englishName: "David", faction: "neutral", maxHp: 13, win: "同時持有朗基努斯之槍、聖袍、銀念珠、護符中的至少 3 件。", ability: "掘墓：每局一次，可在任何時間從白色或黑色棄牌堆取得一件裝備。" },
  { id: "emi", initial: "E", name: "艾蜜", englishName: "Emi", faction: "hunter", maxHp: 10, win: "所有暗影死亡。", ability: "瞬移：移動時可不擲骰，改到相鄰位置。" },
  { id: "ellen", initial: "E", name: "艾倫", englishName: "Ellen", faction: "hunter", maxHp: 10, win: "所有暗影死亡。", ability: "禁咒鎖鏈：每局一次，在回合開始時永久封印一名角色的能力。" },
  { id: "franklin", initial: "F", name: "富蘭克林", englishName: "Franklin", faction: "hunter", maxHp: 12, win: "所有暗影死亡。", ability: "雷擊：每局一次，在回合開始時對一名角色造成 D6 傷害。" },
  { id: "fu-ka", initial: "F", name: "芙卡", englishName: "Fu-ka", faction: "hunter", maxHp: 12, win: "所有暗影死亡。", ability: "炸藥護士：每局一次，在回合開始時把一名角色的傷害設為 7。" },
  { id: "george", initial: "G", name: "喬治", englishName: "George", faction: "hunter", maxHp: 14, win: "所有暗影死亡。", ability: "破壞：每局一次，在回合開始時對一名角色造成 D4 傷害。" },
  { id: "gregor", initial: "G", name: "格雷戈", englishName: "Gregor", faction: "hunter", maxHp: 14, win: "所有暗影死亡。", ability: "幽靈屏障：每局一次，回合結束時啟動；直到下回合開始前不受傷害。" },
  { id: "unknown", initial: "U", name: "無名氏", englishName: "Unknown", faction: "shadow", maxHp: 11, win: "所有獵人死亡，或至少 3 名中立角色死亡。", ability: "欺詐：收到隱士牌時可選擇是否觸發條件，無須公開。" },
  { id: "ultra-soul", initial: "U", name: "超靈體", englishName: "Ultra Soul", faction: "shadow", maxHp: 11, win: "所有獵人死亡，或至少 3 名中立角色死亡。", ability: "殺人光線：每次回合開始可對冥界之門的一名角色造成 3 點傷害。" },
  { id: "vampire", initial: "V", name: "吸血鬼", englishName: "Vampire", faction: "shadow", maxHp: 13, win: "所有獵人死亡，或至少 3 名中立角色死亡。", ability: "吸血：攻擊造成傷害後治療自己 2 點。" },
  { id: "valkyrie", initial: "V", name: "女武神", englishName: "Valkyrie", faction: "shadow", maxHp: 13, win: "所有獵人死亡，或至少 3 名中立角色死亡。", ability: "戰爭號角：攻擊只擲 D4，傷害等於結果。" },
  { id: "werewolf", initial: "W", name: "狼人", englishName: "Werewolf", faction: "shadow", maxHp: 14, win: "所有獵人死亡，或至少 3 名中立角色死亡。", ability: "反擊：受到攻擊且存活時，可立刻反擊攻擊者。" },
  { id: "wight", initial: "W", name: "巫妖", englishName: "Wight", faction: "shadow", maxHp: 14, win: "所有獵人死亡，或至少 3 名中立角色死亡。", ability: "增殖：每局一次，在回合結束時獲得等同當時死亡人數的額外回合。" },
] as const;

export type SHCardType = "equipment" | "single" | "hermit";
export interface SHCardDefinition {
  id: string;
  title: string;
  englishTitle: string;
  deck: SHDeck;
  type: SHCardType;
  count: number;
  text: string;
}

export const CARDS: readonly SHCardDefinition[] = [
  { id: "mystic-compass", title: "神祕羅盤", englishTitle: "Mystic Compass", deck: "white", type: "equipment", count: 1, text: "移動時擲兩次，選擇一個結果。" },
  { id: "talisman", title: "護符", englishTitle: "Talisman", deck: "white", type: "equipment", count: 1, text: "不受嗜血蜘蛛、吸血蝙蝠與炸藥傷害。" },
  { id: "fortune-brooch", title: "幸運胸針", englishTitle: "Fortune Brooch", deck: "white", type: "equipment", count: 1, text: "不受詭異森林傷害，但仍可被治療。" },
  { id: "silver-rosary", title: "銀念珠", englishTitle: "Silver Rosary", deck: "white", type: "equipment", count: 1, text: "殺死角色時取得其全部裝備。" },
  { id: "spear-of-longinus", title: "朗基努斯之槍", englishTitle: "Spear of Longinus", deck: "white", type: "equipment", count: 1, text: "已公開的獵人攻擊成功時額外造成 2 點傷害。" },
  { id: "advent", title: "降臨", englishTitle: "Advent", deck: "white", type: "single", count: 1, text: "若你是獵人，可公開身分並完全治療。" },
  { id: "disenchant-mirror", title: "破魔鏡", englishTitle: "Disenchant Mirror", deck: "white", type: "single", count: 1, text: "除無名氏外的暗影必須公開身分。" },
  { id: "blessing", title: "祝福", englishTitle: "Blessing", deck: "white", type: "single", count: 1, text: "選擇自己以外一名角色，治療 D6 點。" },
  { id: "chocolate", title: "巧克力", englishTitle: "Chocolate", deck: "white", type: "single", count: 1, text: "愛麗、艾格妮絲、艾蜜、艾倫、無名氏或超靈體可公開並完全治療。" },
  { id: "concealed-knowledge", title: "秘藏知識", englishTitle: "Concealed Knowledge", deck: "white", type: "single", count: 1, text: "本回合結束後再進行一個回合。" },
  { id: "guardian-angel", title: "守護天使", englishTitle: "Guardian Angel", deck: "white", type: "single", count: 1, text: "直到下回合開始前，不受其他角色直接攻擊的傷害。" },
  { id: "holy-robe", title: "聖袍", englishTitle: "Holy Robe", deck: "white", type: "equipment", count: 1, text: "造成及承受的攻擊傷害各減少 1。" },
  { id: "flare-of-judgement", title: "審判閃光", englishTitle: "Flare of Judgement", deck: "white", type: "single", count: 1, text: "自己以外所有角色受到 2 點傷害。" },
  { id: "first-aid", title: "急救", englishTitle: "First Aid", deck: "white", type: "single", count: 1, text: "把任一角色的傷害設為 7。" },
  { id: "holy-water", title: "治療聖水", englishTitle: "Holy Water of Healing", deck: "white", type: "single", count: 2, text: "治療自己 2 點。" },
  { id: "masamune", title: "妖刀村正", englishTitle: "Cursed Sword Masamune", deck: "black", type: "equipment", count: 1, text: "回合中若有合法目標必須攻擊，且只擲 D4。" },
  { id: "machine-gun", title: "機關槍", englishTitle: "Machine Gun", deck: "black", type: "equipment", count: 1, text: "一次攻擊命中攻擊範圍內所有角色。" },
  { id: "handgun", title: "手槍", englishTitle: "Handgun", deck: "black", type: "equipment", count: 1, text: "攻擊範圍改為自己所在地區以外的兩個地區。" },
  { id: "butcher-knife", title: "屠刀", englishTitle: "Butcher Knife", deck: "black", type: "equipment", count: 1, text: "攻擊成功時額外造成 1 點傷害。" },
  { id: "chainsaw", title: "鏈鋸", englishTitle: "Chainsaw", deck: "black", type: "equipment", count: 1, text: "攻擊成功時額外造成 1 點傷害。" },
  { id: "rusted-axe", title: "鏽蝕闊斧", englishTitle: "Rusted Broad Axe", deck: "black", type: "equipment", count: 1, text: "攻擊成功時額外造成 1 點傷害。" },
  { id: "moody-goblin", title: "善變哥布林", englishTitle: "Moody Goblin", deck: "black", type: "single", count: 2, text: "從任一角色偷取一件裝備。" },
  { id: "bloodthirsty-spider", title: "嗜血蜘蛛", englishTitle: "Bloodthirsty Spider", deck: "black", type: "single", count: 1, text: "任一角色與自己各受到 2 點傷害。" },
  { id: "vampire-bat", title: "吸血蝙蝠", englishTitle: "Vampire Bat", deck: "black", type: "single", count: 3, text: "任一角色受到 2 點傷害，自己治療 1 點。" },
  { id: "diabolic-ritual", title: "惡魔儀式", englishTitle: "Diabolic Ritual", deck: "black", type: "single", count: 1, text: "若你是暗影，可公開身分並完全治療。" },
  { id: "banana-peel", title: "香蕉皮", englishTitle: "Banana Peel", deck: "black", type: "single", count: 1, text: "把一件裝備交給其他角色；沒有裝備則受到 1 點傷害。" },
  { id: "dynamite", title: "炸藥", englishTitle: "Dynamite", deck: "black", type: "single", count: 1, text: "擲兩顆骰；總和所在地點的所有角色受到 3 點傷害，7 則無事發生。" },
  { id: "spiritual-doll", title: "靈魂娃娃", englishTitle: "Spiritual Doll", deck: "black", type: "single", count: 1, text: "選一名角色擲 D6；1–4 對方受 3 點，5–6 自己受 3 點。" },
  { id: "blackmail", title: "隱士的勒索", englishTitle: "Hermit's Blackmail", deck: "hermit", type: "hermit", count: 2, text: "中立或獵人：交出一件裝備，否則受到 1 點傷害。" },
  { id: "greed", title: "隱士的貪婪", englishTitle: "Hermit's Greed", deck: "hermit", type: "hermit", count: 2, text: "中立或暗影：交出一件裝備，否則受到 1 點傷害。" },
  { id: "anger", title: "隱士的憤怒", englishTitle: "Hermit's Anger", deck: "hermit", type: "hermit", count: 2, text: "獵人或暗影：交出一件裝備，否則受到 1 點傷害。" },
  { id: "slap", title: "隱士的耳光", englishTitle: "Hermit's Slap", deck: "hermit", type: "hermit", count: 2, text: "獵人受到 1 點傷害。" },
  { id: "spell", title: "隱士的咒語", englishTitle: "Hermit's Spell", deck: "hermit", type: "hermit", count: 1, text: "暗影受到 1 點傷害。" },
  { id: "exorcism", title: "隱士的驅魔", englishTitle: "Hermit's Exorcism", deck: "hermit", type: "hermit", count: 1, text: "暗影受到 2 點傷害。" },
  { id: "nurturance", title: "隱士的照料", englishTitle: "Hermit's Nurturance", deck: "hermit", type: "hermit", count: 1, text: "中立治療 1 點；若原本沒有傷害則受到 1 點。" },
  { id: "aid", title: "隱士的援助", englishTitle: "Hermit's Aid", deck: "hermit", type: "hermit", count: 1, text: "獵人治療 1 點；若原本沒有傷害則受到 1 點。" },
  { id: "huddle", title: "隱士的抱團", englishTitle: "Hermit's Huddle", deck: "hermit", type: "hermit", count: 1, text: "暗影治療 1 點；若原本沒有傷害則受到 1 點。" },
  { id: "lesson", title: "隱士的教訓", englishTitle: "Hermit's Lesson", deck: "hermit", type: "hermit", count: 1, text: "最大生命 12 以上者受到 2 點傷害。" },
  { id: "bully", title: "隱士的欺凌", englishTitle: "Hermit's Bully", deck: "hermit", type: "hermit", count: 1, text: "最大生命 11 以下者受到 1 點傷害。" },
  { id: "prediction", title: "隱士的預言", englishTitle: "Hermit's Prediction", deck: "hermit", type: "hermit", count: 1, text: "私下向目前玩家展示角色身分。" },
] as const;

export interface SHArea {
  id: string;
  name: string;
  rolls: number[];
  text: string;
}
export const AREAS: readonly SHArea[] = [
  { id: "hermit-cabin", name: "隱士小屋", rolls: [2, 3], text: "抽一張隱士牌並交給另一名角色。" },
  { id: "underworld-gate", name: "冥界之門", rolls: [4, 5], text: "從白、黑、隱士牌中選一副抽牌。" },
  { id: "church", name: "教堂", rolls: [6], text: "抽一張白色牌。" },
  { id: "cemetery", name: "墓園", rolls: [8], text: "抽一張黑色牌。" },
  { id: "weird-woods", name: "詭異森林", rolls: [9], text: "任一角色受到 2 點傷害或治療 1 點。" },
  { id: "erstwhile-altar", name: "古老祭壇", rolls: [10], text: "從任一角色偷取一件裝備。" },
] as const;

export interface SHCardInstance { id: string; card: string }
export interface SHPlayer {
  id: string;
  name: string;
  character: string;
  damage: number;
  alive: boolean;
  revealed: boolean;
  location: string | null;
  equipment: SHCardInstance[];
  abilityUsed: boolean;
  abilityDisabled: boolean;
  guardian: boolean;
  barrier: boolean;
  agnesSide: "right" | "left";
  extraTurns: number;
  winQualified: boolean;
}
export interface SHLog { text: string; recipients?: string[] }
export interface SHPromptOption { id: string; label: string }
export interface SHPending {
  id: string;
  actor: string;
  kind: string;
  text: string;
  options: SHPromptOption[];
  data: Record<string, unknown>;
}
export interface SHState {
  rulesVersion: string;
  players: SHPlayer[];
  areas: SHArea[];
  decks: Record<SHDeck, SHCardInstance[]>;
  discards: Record<SHDeck, SHCardInstance[]>;
  current: string;
  phase: "move" | "area" | "attack" | "finished";
  pending: SHPending | null;
  promptSequence: number;
  lastRoll: { d4: number; d6: number; purpose: string } | null;
  deathOrder: string[][];
  winners: string[];
  logs: SHLog[];
}

export type SHAction =
  | { type: "roll"; promptId: string }
  | { type: "choose"; promptId: string; optionId: string }
  | { type: "reveal" }
  | { type: "ability" };

export interface SHLegal {
  canReveal: boolean;
  canUseAbility: boolean;
  pending?: Omit<SHPending, "actor" | "data">;
}
export interface SHViewPlayer extends Omit<SHPlayer, "character" | "winQualified" | "agnesSide"> {
  character?: SHCharacter;
  maxHp?: number;
  faction?: SHFaction;
}
export interface SHView {
  rulesVersion: string;
  players: SHViewPlayer[];
  areas: SHArea[];
  deckCounts: Record<SHDeck, number>;
  discardCounts: Record<SHDeck, number>;
  current: string;
  phase: SHState["phase"];
  lastRoll: SHState["lastRoll"];
  winners: string[];
  logs: { text: string }[];
  legal: SHLegal;
}

export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id)!;
export const cardById = (id: string) => CARDS.find((c) => c.id === id)!;
