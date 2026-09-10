import type { GameDefinition, Seat } from "../../shared/game.js";
import {
  ROLES,
  type Card,
  type LLAction,
  type LLState,
  type LLView,
  type Legal,
} from "../../shared/love-letter.js";
import { z } from "zod";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("play"),
      card: z.string().max(16),
      target: z.string().optional(),
      guess: z.number().int().min(0).max(9).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("chancellor"),
      keep: z.string().max(16),
      bottom: z.array(z.string().max(16)).max(2),
    })
    .strict(),
  z.object({ type: z.literal("next") }).strict(),
]);
function log(s: LLState, text: string, recipients?: string[]) {
  s.logs.push({ text, ...(recipients ? { recipients } : {}) });
  s.logs = s.logs.slice(-200);
}
function shuffled(random: (max: number) => number): Card[] {
  const cards = ROLES.flatMap((r, value) =>
    Array.from({ length: r.count }, (_, i) => ({ id: `${value}-${i}`, value })),
  );
  for (let i = cards.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function deal(s: LLState, first: string, random: (max: number) => number) {
  s.round++;
  s.deck = shuffled(random);
  s.reserve = s.deck.shift()!;
  s.removed = s.players.length === 2 ? s.deck.splice(0, 3) : [];
  s.roundWinners = [];
  s.logs = [];
  s.phase = "playing";
  for (const p of s.players) {
    p.hand = [s.deck.shift()!];
    p.discards = [];
    p.alive = true;
    p.protected = false;
  }
  log(s, `第 ${s.round} 輪開始。`);
  beginTurn(s, first);
}
function beginTurn(s: LLState, id: string) {
  const p = s.players.find((p) => p.id === id)!;
  s.current = id;
  p.protected = false;
  p.hand.push(s.deck.shift()!);
  s.phase = "playing";
}
function eliminate(s: LLState, id: string) {
  const p = s.players.find((p) => p.id === id)!;
  p.alive = false;
  p.protected = false;
  p.discards.push(...p.hand);
  p.hand = [];
  log(s, `${p.name} 出局。`);
}
function finishTurn(s: LLState) {
  const alive = s.players.filter((p) => p.alive);
  if (alive.length <= 1 || s.deck.length === 0) {
    const highest = Math.max(...alive.map((p) => p.hand[0].value));
    const winners = alive.filter((p) => p.hand[0].value === highest);
    s.roundWinners = winners.map((p) => p.id);
    winners.forEach((p) => p.score++);
    const spies = alive.filter((p) => p.discards.some((c) => c.value === 0));
    if (spies.length === 1) {
      spies[0].score++;
      log(s, `${spies[0].name} 的間諜帶來 1 枚額外好感。`);
    }
    log(s, `${winners.map((p) => p.name).join("、")} 贏得本輪。`);
    s.winners = s.players
      .filter((p) => p.score >= s.targetScore)
      .map((p) => p.id);
    s.phase = s.winners.length ? "matchEnd" : "roundEnd";
    return;
  }
  let i = s.players.findIndex((p) => p.id === s.current);
  do {
    i = (i + 1) % s.players.length;
  } while (!s.players[i].alive);
  beginTurn(s, s.players[i].id);
}
export function legalActions(s: LLState, id: string): Legal {
  const empty = { cards: [], chancellor: false };
  const p = s.players.find((p) => p.id === id);
  if (!p || id !== s.current || !p.alive) return empty;
  if (s.phase === "chancellor") return { cards: [], chancellor: true };
  if (s.phase !== "playing") return empty;
  const forced =
    p.hand.some((c) => c.value === 8) &&
    p.hand.some((c) => c.value === 5 || c.value === 7);
  return {
    chancellor: false,
    cards: p.hand
      .filter((c) => !forced || c.value === 8)
      .map((c) => {
        const targeted = [1, 2, 3, 5, 7].includes(c.value);
        const targets = targeted
          ? s.players
              .filter(
                (t) => t.alive && (t.id === id ? c.value === 5 : !t.protected),
              )
              .map((t) => t.id)
          : [];
        return {
          id: c.id,
          targets,
          needsTarget: targets.length > 0,
          needsGuess: c.value === 1 && targets.length > 0,
        };
      }),
  };
}
export const loveLetter: GameDefinition<LLState, LLAction, LLView> = {
  info: {
    id: "love-letter",
    name: "情書",
    rulesVersion: "2019-21-v1",
    minPlayers: 2,
    maxPlayers: 6,
    description: "一封信，十種角色。推敲對手的心思，把心意交到公主手中。",
    firstPlayerPolicy: "host-choice",
  },
  initialize(seats: Seat[], first, random) {
    assert(
      seats.length >= 2 &&
        seats.length <= 6 &&
        new Set(seats.map((p) => p.id)).size === seats.length,
      "需要 2–6 位不同玩家",
    );
    assert(
      seats.some((p) => p.id === first),
      "先手玩家不存在",
    );
    const s: LLState = {
      rulesVersion: this.info.rulesVersion,
      players: seats.map((p) => ({
        ...p,
        hand: [],
        discards: [],
        alive: true,
        protected: false,
        score: 0,
      })),
      deck: [],
      reserve: null,
      removed: [],
      current: first,
      phase: "playing",
      round: 0,
      targetScore: ({ 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 } as Record<number, number>)[
        seats.length
      ],
      logs: [],
      roundWinners: [],
      winners: [],
    };
    deal(s, first, random);
    return s;
  },
  legalActions,
  parseAction(input) {
    return actionSchema.parse(input);
  },
  transition(state, id, action, random) {
    assert(state.rulesVersion === this.info.rulesVersion, "不支援此規則版本");
    const s = structuredClone(state);
    if (action.type === "next") {
      assert(s.phase === "roundEnd", "尚不能開始下一輪");
      const first = s.roundWinners[random(s.roundWinners.length)];
      deal(s, first, random);
      return s;
    }
    assert(s.current === id, "尚未輪到你");
    const p = s.players.find((p) => p.id === id)!;
    assert(p?.alive, "你已出局");
    if (action.type === "chancellor") {
      assert(s.phase === "chancellor", "目前不是大臣選牌階段");
      const chosen = [action.keep, ...action.bottom];
      assert(
        chosen.length === p.hand.length &&
          new Set(chosen).size === chosen.length &&
          chosen.every((id) => p.hand.some((c) => c.id === id)),
        "請保留一張，其餘依序放回",
      );
      const keep = p.hand.find((c) => c.id === action.keep)!;
      s.deck.push(
        ...action.bottom.map((id) => p.hand.find((c) => c.id === id)!),
      );
      p.hand = [keep];
      log(s, `${p.name} 完成了大臣選牌。`);
      finishTurn(s);
      return s;
    }
    assert(action.type === "play" && s.phase === "playing", "目前不能出牌");
    const legal = legalActions(s, id).cards.find((c) => c.id === action.card);
    assert(legal, "這張牌不能打出");
    assert(
      !legal.needsTarget ||
        (action.target && legal.targets.includes(action.target)),
      "請選擇合法目標",
    );
    assert(legal.needsTarget || action.target === undefined, "此牌不需要目標");
    assert(
      !legal.needsGuess ||
        (Number.isInteger(action.guess) &&
          action.guess! >= 0 &&
          action.guess! <= 9 &&
          action.guess !== 1),
      "不能猜衛兵",
    );
    const card = p.hand.splice(
      p.hand.findIndex((c) => c.id === action.card),
      1,
    )[0];
    p.discards.push(card);
    const t = s.players.find((p) => p.id === action.target);
    log(
      s,
      `${p.name} 打出${ROLES[card.value].name}${t ? `，目標是 ${t.name}` : ""}${legal.needsGuess ? `，猜測${ROLES[action.guess!].name}` : ""}。`,
    );
    switch (card.value) {
      case 1:
        if (t) {
          if (t.hand[0].value === action.guess) eliminate(s, t.id);
          else log(s, "沒有猜中。");
        }
        break;
      case 2:
        if (t)
          log(
            s,
            `你查看到 ${t.name} 的手牌：${ROLES[t.hand[0].value].name}（${t.hand[0].value}）。`,
            [id],
          );
        break;
      case 3:
        if (t) {
          log(
            s,
            `秘密比牌：${p.name} 持有${ROLES[p.hand[0].value].name}，${t.name} 持有${ROLES[t.hand[0].value].name}。`,
            [id, t.id],
          );
          if (p.hand[0].value < t.hand[0].value) eliminate(s, id);
          else if (p.hand[0].value > t.hand[0].value) eliminate(s, t.id);
          else log(s, "比牌平手，兩人留在場上。");
        }
        break;
      case 4:
        p.protected = true;
        break;
      case 5:
        if (t) {
          const discard = t.hand.pop()!;
          t.discards.push(discard);
          if (discard.value === 9) eliminate(s, t.id);
          else {
            const draw = s.deck.shift() ?? s.reserve;
            assert(draw, "沒有可抽取的牌");
            if (!s.deck.length && draw === s.reserve) s.reserve = null;
            t.hand = [draw];
          }
        }
        break;
      case 6: {
        const drawn = s.deck.splice(0, 2);
        if (drawn.length) {
          p.hand.push(...drawn);
          s.phase = "chancellor";
          return s;
        }
        break;
      }
      case 7:
        if (t) [p.hand, t.hand] = [t.hand, p.hand];
        break;
      case 9:
        eliminate(s, id);
        break;
    }
    finishTurn(s);
    return s;
  },
  playerView(s, id) {
    const reveal = s.phase === "roundEnd" || s.phase === "matchEnd";
    return {
      rulesVersion: s.rulesVersion,
      players: s.players.map(({ hand, ...p }) => ({
        ...p,
        handCount: hand.length,
        ...(p.id === id || reveal ? { hand: structuredClone(hand) } : {}),
      })),
      deckCount: s.deck.length,
      removed: s.removed,
      current: s.current,
      phase: s.phase,
      round: s.round,
      targetScore: s.targetScore,
      roundWinners: s.roundWinners,
      winners: s.winners,
      legal: legalActions(s, id),
      logs: s.logs
        .filter((l) => !l.recipients || l.recipients.includes(id))
        .map((l) => ({ text: l.text })),
    };
  },
  result(s) {
    return s.phase === "matchEnd"
      ? {
          scores: Object.fromEntries(s.players.map((p) => [p.id, p.score])),
          winners: s.winners,
        }
      : null;
  },
};
