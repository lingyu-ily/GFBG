export const SR_RULES_VERSION = "shadow-raiders-queen-majesty-v2-unofficial-v1";

export type SRFaction = "raider" | "shadow" | "citizen";
export type SRDeck = "white" | "black" | "reasoning";

export interface SRCharacter {
  id: string;
  initial: string;
  name: string;
  englishName: string;
  faction: SRFaction;
  maxHp: number;
  win: string;
  ability: string;
}

const factionWin = {
  raider: "所有暗影死亡。",
  shadow: "所有奇襲者死亡，或至少 3 名市民死亡。",
} as const;

export const SR_CHARACTERS: readonly SRCharacter[] = [
  { id: "alice", initial: "A", name: "愛麗絲", englishName: "Alice", faction: "citizen", maxHp: 8, win: "遊戲結束時仍存活。", ability: "母愛：每局一次，回合開始時完全治療自己。" },
  { id: "angela", initial: "A", name: "安潔拉", englishName: "Angela", faction: "citizen", maxHp: 8, win: "起始座位右鄰玩家獲勝時一同獲勝。", ability: "隨想曲：每局一次，回合開始時改為左鄰玩家。" },
  { id: "agatha", initial: "A", name: "阿嘉莎", englishName: "Agatha", faction: "citizen", maxHp: 8, win: "遊戲在自己的回合結束。", ability: "魔女之夜：每局一次，回合結束擲 D4+D6，對結果地點所有角色造成 3 點傷害。" },
  { id: "bylon", initial: "B", name: "拜隆", englishName: "Bylon", faction: "citizen", maxHp: 10, win: "持有至少 5 張裝備。", ability: "掠奪：攻擊原本會造成至少 2 點傷害時，可改為取得目標一件裝備；不限次數。" },
  { id: "benjamin", initial: "B", name: "班傑明", englishName: "Benjamin", faction: "citizen", maxHp: 10, win: "任一其他角色持有至少 5 張裝備。", ability: "饋贈：回合結束時可把一件裝備交給同地點另一角色。" },
  { id: "bruce", initial: "B", name: "布魯斯", englishName: "Bruce", faction: "citizen", maxHp: 10, win: "以攻擊殺死最大生命 12 以上角色；或結算時位於奧利佛藏身處。", ability: "天啊：以攻擊殺死最大生命 11 以下角色時必須公開。" },
  { id: "craig", initial: "C", name: "克雷格", englishName: "Craig", faction: "citizen", maxHp: 11, win: "場上已有至少 2 名死者後，以攻擊殺死角色。", ability: "血宴：每回合一次，攻擊後可受到 2 點傷害，再攻擊同一目標。" },
  { id: "claire", initial: "C", name: "克萊兒", englishName: "Claire", faction: "citizen", maxHp: 11, win: "結算時自己的傷害介於 6–8。", ability: "交換：每局一次，回合開始時與另一角色交換傷害。" },
  { id: "carol", initial: "C", name: "卡蘿", englishName: "Carol", faction: "citizen", maxHp: 11, win: "成為第一批死亡者；或結算時只剩自己與另一名生還者。", ability: "聖痕：回合開始時治療自己 2 點。" },
  { id: "daniel", initial: "D", name: "丹尼爾", englishName: "Daniel", faction: "citizen", maxHp: 14, win: "成為第一批死亡者；或所有暗影死亡時自己仍存活。", ability: "尖叫：其他角色死亡時強制公開。" },
  { id: "david", initial: "D", name: "大衛", englishName: "David", faction: "citizen", maxHp: 13, win: "持有聖杯、神祕羅盤、幸運胸針、銀念珠中的至少 3 件。", ability: "掘墓：每局一次，回合開始時從棄牌堆取得一件裝備。" },
  { id: "deborah", initial: "D", name: "黛博拉", englishName: "Deborah", faction: "citizen", maxHp: 13, win: "5 人局結算時並列最高傷害；6 人以上任一其他市民獲勝。", ability: "轉念：每局一次，回合開始時把勝利條件改為自己死亡。" },
  { id: "emi", initial: "E", name: "艾蜜", englishName: "Emi", faction: "raider", maxHp: 10, win: factionWin.raider, ability: "瞬移：移動擲骰後可改去結果地點的左鄰或右鄰外圍地點。" },
  { id: "erica", initial: "E", name: "艾莉卡", englishName: "Erica", faction: "raider", maxHp: 10, win: factionWin.raider, ability: "封印：每局一次，回合開始時永久封印另一角色的能力。" },
  { id: "emma", initial: "E", name: "艾瑪", englishName: "Emma", faction: "raider", maxHp: 10, win: factionWin.raider, ability: "急救：回合結束時可擲 D4，治療同地點另一角色。" },
  { id: "felix", initial: "F", name: "菲利克斯", englishName: "Felix", faction: "raider", maxHp: 12, win: factionWin.raider, ability: "雷擊：每局一次，回合開始時對另一角色造成 D6 傷害。" },
  { id: "freddie", initial: "F", name: "弗雷迪", englishName: "Freddie", faction: "raider", maxHp: 12, win: factionWin.raider, ability: "處刑：攻擊已公開角色時額外造成 2 點傷害。" },
  { id: "felicia", initial: "F", name: "菲莉西亞", englishName: "Felicia", faction: "raider", maxHp: 12, win: factionWin.raider, ability: "炸藥護士：每局一次，回合開始時把一名角色的傷害設為 7。" },
  { id: "gordon", initial: "G", name: "戈登", englishName: "Gordon", faction: "raider", maxHp: 14, win: factionWin.raider, ability: "幽靈屏障：每局一次，回合結束時啟動；直到下回合開始前不受傷害。" },
  { id: "galahad", initial: "G", name: "加拉哈德", englishName: "Galahad", faction: "raider", maxHp: 14, win: factionWin.raider, ability: "聖劍：裝備王者之劍且攻擊失敗時，必須重擲直到成功。" },
  { id: "godwin", initial: "G", name: "戈德溫", englishName: "Godwin", faction: "raider", maxHp: 14, win: factionWin.raider, ability: "復活：死亡時選擇一名已死亡角色，以 7 傷害、無裝備且位置未定復活。" },
  { id: "urlich", initial: "U", name: "烏爾利希", englishName: "Urlich", faction: "shadow", maxHp: 11, win: factionWin.shadow, ability: "欺詐：收到推理牌時可照實、讓效果生效，或宣稱無事。" },
  { id: "uranus", initial: "U", name: "烏拉諾斯", englishName: "Uranus", faction: "shadow", maxHp: 11, win: factionWin.shadow, ability: "殺人光線：回合開始時可對黑霧沼澤或飛行船上的一名角色造成 3 點傷害。" },
  { id: "ulster", initial: "U", name: "阿爾斯特", englishName: "Ulster", faction: "shadow", maxHp: 11, win: factionWin.shadow, ability: "雙重獵殺：每個攻擊階段可攻擊兩次。" },
  { id: "vampire", initial: "V", name: "吸血鬼", englishName: "Vampire", faction: "shadow", maxHp: 13, win: factionWin.shadow, ability: "吸血：攻擊造成至少 1 點傷害後治療自己 2 點。" },
  { id: "vendetta", initial: "V", name: "薇妲", englishName: "Vendetta", faction: "shadow", maxHp: 13, win: factionWin.shadow, ability: "戰爭號角：攻擊直接擲 D4 作為傷害。" },
  { id: "venom", initial: "V", name: "維農", englishName: "Venom", faction: "shadow", maxHp: 13, win: factionWin.shadow, ability: "毒牙：受到攻擊後，攻擊者須受到 1 點傷害或交出一件裝備。" },
  { id: "werewolf", initial: "W", name: "狼人", englishName: "Werewolf", faction: "shadow", maxHp: 14, win: factionWin.shadow, ability: "反擊：受到攻擊且存活時，可立刻攻擊攻擊者。" },
  { id: "walpugra", initial: "W", name: "瓦爾普拉", englishName: "Walpugra", faction: "shadow", maxHp: 14, win: factionWin.shadow, ability: "換位：攻擊前可與場上任一角色交換位置。" },
  { id: "wight", initial: "W", name: "巫妖", englishName: "Wight", faction: "shadow", maxHp: 14, win: factionWin.shadow, ability: "增殖：每局一次，回合結束時獲得等同死者數量的額外回合。" },
] as const;

export type SRCardType = "equipment" | "single" | "reasoning";
export interface SRCardDefinition {
  id: string;
  title: string;
  englishTitle: string;
  deck: SRDeck;
  type: SRCardType;
  count: number;
  text: string;
}

export const SR_CARDS: readonly SRCardDefinition[] = [
  { id: "mystic-compass", title: "神祕羅盤", englishTitle: "Mystic Compass", deck: "white", type: "equipment", count: 1, text: "移動時擲兩次，選擇一個結果。" },
  { id: "holy-grail", title: "聖杯", englishTitle: "Holy Grail", deck: "white", type: "equipment", count: 1, text: "不受黑犬、吸血蝙蝠與詛咒娃娃傷害。" },
  { id: "lucky-brooch", title: "幸運胸針", englishTitle: "Lucky Brooch", deck: "white", type: "equipment", count: 1, text: "不受市政廳造成的傷害。" },
  { id: "silver-rosary", title: "銀念珠", englishTitle: "Silver Rosary", deck: "white", type: "equipment", count: 2, text: "以攻擊殺死角色時取得其全部裝備。" },
  { id: "excalibur", title: "王者之劍", englishTitle: "Excalibur", deck: "white", type: "equipment", count: 1, text: "已公開奇襲者攻擊成功時額外造成 2 點傷害。" },
  { id: "sage-robe", title: "賢者長袍", englishTitle: "Sage's Robe", deck: "white", type: "equipment", count: 1, text: "造成及承受的攻擊傷害各減少 1。" },
  { id: "rainbow-parasol", title: "彩虹陽傘", englishTitle: "Rainbow Parasol", deck: "white", type: "equipment", count: 1, text: "可放棄攻擊，改對攻擊範圍內角色使用一張推理牌。" },
  { id: "advent", title: "降臨", englishTitle: "Advent", deck: "white", type: "single", count: 1, text: "若是奇襲者，公開身分並完全治療。" },
  { id: "mirror", title: "破魔鏡", englishTitle: "Disenchanting Mirror", deck: "white", type: "single", count: 1, text: "若是暗影，公開身分。" },
  { id: "blessing", title: "祝福", englishTitle: "Blessing", deck: "white", type: "single", count: 1, text: "另一角色治療 D6。" },
  { id: "happy-cookie", title: "幸福餅乾", englishTitle: "Happy Cookie", deck: "white", type: "single", count: 1, text: "名字以 A、E 或 U 開頭者公開並完全治療。" },
  { id: "concealed-knowledge", title: "秘藏知識", englishTitle: "Concealed Knowledge", deck: "white", type: "single", count: 1, text: "本回合後再進行一個回合。" },
  { id: "guardian-angel", title: "守護天使", englishTitle: "Guardian Angel", deck: "white", type: "single", count: 1, text: "直到下回合開始前不受直接攻擊傷害。" },
  { id: "flare", title: "審判閃光", englishTitle: "Flare of Judgement", deck: "white", type: "single", count: 1, text: "自己以外所有角色受到 2 點傷害。" },
  { id: "first-aid", title: "急救", englishTitle: "First Aid", deck: "white", type: "single", count: 1, text: "把任一角色的傷害設為 7。" },
  { id: "healing-water", title: "治療聖水", englishTitle: "Healing Water", deck: "white", type: "single", count: 3, text: "治療自己 2 點。" },
  { id: "mermaid-tears", title: "人魚之淚", englishTitle: "Mermaid's Tears", deck: "white", type: "single", count: 1, text: "並列最高傷害的所有角色治療 3 點。" },

  { id: "masamune", title: "妖刀村正", englishTitle: "Masamune", deck: "black", type: "equipment", count: 1, text: "有合法目標時必須攻擊，且只擲 D4。" },
  { id: "gatling", title: "格林機槍", englishTitle: "Gatling Gun", deck: "black", type: "equipment", count: 1, text: "一次攻擊命中攻擊範圍內所有角色。" },
  { id: "handgun", title: "手槍", englishTitle: "Handgun", deck: "black", type: "equipment", count: 1, text: "攻擊成功時額外造成 1 點傷害。" },
  { id: "saber", title: "軍刀", englishTitle: "Saber", deck: "black", type: "equipment", count: 1, text: "攻擊成功時額外造成 1 點傷害。" },
  { id: "crossbow", title: "十字弓", englishTitle: "Crossbow", deck: "black", type: "equipment", count: 1, text: "攻擊成功時額外造成 1 點傷害。" },
  { id: "death-scope", title: "死亡瞄準鏡", englishTitle: "Death Scope", deck: "black", type: "equipment", count: 2, text: "攻擊範圍再向逆時針左側延伸一個外圍地點，可疊加。" },
  { id: "oliver-servant", title: "奧利佛的僕役", englishTitle: "Oliver's Servant", deck: "black", type: "single", count: 3, text: "從任一角色取得一件裝備。" },
  { id: "black-dog", title: "黑犬", englishTitle: "Black Dog", deck: "black", type: "single", count: 2, text: "任一角色與自己各受到 2 點傷害。" },
  { id: "bloodthirsty-spider", title: "嗜血蜘蛛", englishTitle: "Bloodthirsty Spider", deck: "black", type: "single", count: 1, text: "任一角色與自己各受到 2 點傷害。" },
  { id: "vampire-bat", title: "吸血蝙蝠", englishTitle: "Vampire Bat", deck: "black", type: "single", count: 3, text: "任一角色受到 2 點傷害，自己治療 1 點。" },
  { id: "ritual", title: "惡魔儀式", englishTitle: "Diabolic Ritual", deck: "black", type: "single", count: 1, text: "若是暗影，公開身分並完全治療。" },
  { id: "banana-peel", title: "香蕉皮", englishTitle: "Banana Peel", deck: "black", type: "single", count: 1, text: "交出一件裝備；沒有裝備則受到 1 點傷害。" },
  { id: "riot", title: "暴動", englishTitle: "Riot", deck: "black", type: "single", count: 1, text: "擲 D4+D6；對應外圍地點所有角色受到 3 點傷害，10 無事。" },
  { id: "cursed-doll", title: "詛咒娃娃", englishTitle: "Cursed Doll", deck: "black", type: "single", count: 1, text: "選一角色擲 D6；1–4 對方受 3 點，5–6 自己受 3 點。" },

  { id: "rc", title: "推理：市民或暗影", englishTitle: "Citizen or Shadow", deck: "reasoning", type: "reasoning", count: 2, text: "市民或暗影：交裝備，否則受到 1 點傷害。" },
  { id: "rr", title: "推理：市民或奇襲者", englishTitle: "Citizen or Raider", deck: "reasoning", type: "reasoning", count: 2, text: "市民或奇襲者：交裝備，否則受到 1 點傷害。" },
  { id: "rs", title: "推理：奇襲者或暗影", englishTitle: "Raider or Shadow", deck: "reasoning", type: "reasoning", count: 2, text: "奇襲者或暗影：交裝備，否則受到 1 點傷害。" },
  { id: "raider-hit", title: "推理：奇襲者受創", englishTitle: "Raider Damage", deck: "reasoning", type: "reasoning", count: 2, text: "奇襲者受到 1 點傷害。" },
  { id: "shadow-hit", title: "推理：暗影受創", englishTitle: "Shadow Damage", deck: "reasoning", type: "reasoning", count: 1, text: "暗影受到 1 點傷害。" },
  { id: "shadow-hit2", title: "推理：暗影重創", englishTitle: "Shadow Heavy Damage", deck: "reasoning", type: "reasoning", count: 2, text: "暗影受到 2 點傷害。" },
  { id: "low-hit", title: "推理：低生命", englishTitle: "Low HP", deck: "reasoning", type: "reasoning", count: 1, text: "最大生命 11 以下受到 1 點傷害。" },
  { id: "high-hit", title: "推理：高生命", englishTitle: "High HP", deck: "reasoning", type: "reasoning", count: 1, text: "最大生命 12 以上受到 2 點傷害。" },
  { id: "citizen-heal", title: "推理：市民治療", englishTitle: "Citizen Aid", deck: "reasoning", type: "reasoning", count: 1, text: "市民治療 1；原本 0 傷害則受到 1。" },
  { id: "raider-heal", title: "推理：奇襲者治療", englishTitle: "Raider Aid", deck: "reasoning", type: "reasoning", count: 1, text: "奇襲者治療 1；原本 0 傷害則受到 1。" },
  { id: "shadow-heal", title: "推理：暗影治療", englishTitle: "Shadow Aid", deck: "reasoning", type: "reasoning", count: 1, text: "暗影治療 1；原本 0 傷害則受到 1。" },
  { id: "identity", title: "推理：真實身分", englishTitle: "Identity", deck: "reasoning", type: "reasoning", count: 1, text: "私下向目前玩家展示身分。" },
  { id: "citizen-airship", title: "推理：市民登船", englishTitle: "Citizen to Airship", deck: "reasoning", type: "reasoning", count: 1, text: "市民移到飛行船；已在船上則受到 1 點傷害。" },
  { id: "raider-airship", title: "推理：奇襲者登船", englishTitle: "Raider to Airship", deck: "reasoning", type: "reasoning", count: 1, text: "奇襲者移到飛行船；已在船上則受到 1 點傷害。" },
  { id: "shadow-airship", title: "推理：暗影登船", englishTitle: "Shadow to Airship", deck: "reasoning", type: "reasoning", count: 1, text: "暗影移到飛行船；已在船上則受到 1 點傷害。" },
] as const;

export interface SRArea { id: string; name: string; rolls: number[]; text: string; airship?: boolean }
export const SR_OUTER_AREAS: readonly SRArea[] = [
  { id: "detective-office", name: "偵探事務所", rolls: [2, 3], text: "抽一張推理牌並交給另一角色。" },
  { id: "blackmist", name: "黑霧沼澤", rolls: [4, 5], text: "選擇白、黑或推理牌抽一張。" },
  { id: "cathedral", name: "大教堂", rolls: [6], text: "抽一張白牌。" },
  { id: "underground", name: "地下通道", rolls: [7], text: "抽一張黑牌。" },
  { id: "town-hall", name: "市政廳", rolls: [8], text: "任一角色受到 2 點傷害或治療 1 點。" },
  { id: "oliver-hideout", name: "奧利佛藏身處", rolls: [9], text: "從另一角色取得一件裝備。" },
] as const;
export const SR_AIRSHIP: SRArea = { id: "airship", name: "女王陛下的飛行船", rolls: [10], text: "中央飛船；下回合可直接前往任一外圍地點。", airship: true };

export interface SRCardInstance { id: string; card: string }
export interface SRPlayer {
  id: string; name: string; character: string; damage: number; alive: boolean; revealed: boolean;
  location: string | null; equipment: SRCardInstance[]; abilityUsed: boolean; abilityDisabled: boolean;
  guardian: boolean; barrier: boolean; neighborSide: "right" | "left"; changedWinToDeath: boolean;
  extraTurns: number; winQualified: boolean; attacksRemaining: number; extraAttackUsed: boolean; turnAbilityUsed: boolean;
}
export interface SRLog { text: string; recipients?: string[] }
export interface SRPromptOption { id: string; label: string }
export interface SRPending { id: string; actor: string; kind: string; text: string; options: SRPromptOption[]; data: Record<string, unknown> }
export interface SRState {
  rulesVersion: typeof SR_RULES_VERSION; players: SRPlayer[]; areas: SRArea[];
  decks: Record<SRDeck, SRCardInstance[]>; discards: Record<SRDeck, SRCardInstance[]>;
  current: string; phase: "move" | "area" | "attack" | "finished"; pending: SRPending | null;
  promptSequence: number; lastRoll: { d4: number; d6: number; purpose: string } | null;
  deathOrder: string[][]; winners: string[]; logs: SRLog[];
}
export type SRAction = { type: "roll"; promptId: string } | { type: "choose"; promptId: string; optionId: string } | { type: "ability" };
export interface SRLegal { canUseAbility: boolean; pending?: Omit<SRPending, "actor" | "data"> }
export interface SRViewPlayer extends Omit<SRPlayer, "character" | "winQualified" | "neighborSide" | "changedWinToDeath"> { character?: SRCharacter; maxHp?: number; faction?: SRFaction }
export interface SRView {
  rulesVersion: string; players: SRViewPlayer[]; areas: SRArea[]; deckCounts: Record<SRDeck, number>;
  discardCounts: Record<SRDeck, number>; current: string; phase: SRState["phase"];
  lastRoll: SRState["lastRoll"]; winners: string[]; logs: { text: string }[]; legal: SRLegal;
}

export const srCharacterById = (id: string) => SR_CHARACTERS.find((c) => c.id === id)!;
export const srCardById = (id: string) => SR_CARDS.find((c) => c.id === id)!;
