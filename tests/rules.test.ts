import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loveLetter as game,
  legalActions,
} from "../server/games/love-letter.js";
import { ROLES, type Card, type LLState } from "../shared/love-letter.js";
let serial = 0;
const card = (value: number): Card => ({ id: `t${serial++}`, value });
function scenario(hands: number[][], deck = [1, 2, 3, 4]): LLState {
  return {
    rulesVersion: game.info.rulesVersion,
    players: hands.map((h, i) => ({
      id: `p${i}`,
      name: `玩家${i}`,
      hand: h.map(card),
      discards: [],
      alive: true,
      protected: false,
      score: 0,
    })),
    deck: deck.map(card),
    reserve: card(0),
    removed: [],
    current: "p0",
    phase: "playing",
    round: 1,
    targetScore: 6,
    logs: [],
    roundWinners: [],
    winners: [],
  };
}
function play(s: LLState, value: number, target?: string, guess?: number) {
  return game.transition(
    s,
    "p0",
    {
      type: "play",
      card: s.players[0].hand.find((c) => c.value === value)!.id,
      ...(target ? { target } : {}),
      ...(guess !== undefined ? { guess } : {}),
    },
    () => 0,
  );
}
test("21-card setup, two-player removal, correct scoring thresholds and immutable transitions", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const s = game.initialize(
      Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      "p0",
      (m) => m - 1,
    );
    assert.equal(s.removed.length, n === 2 ? 3 : 0);
    assert.equal(s.players[0].hand.length, 2);
    assert.equal(s.deck.length, 21 - 1 - n - 1 - s.removed.length);
    assert.equal(s.targetScore, ({ 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 } as any)[n]);
    const all = [
      ...s.deck,
      ...s.removed,
      s.reserve!,
      ...s.players.flatMap((p) => p.hand),
    ];
    assert.equal(new Set(all.map((c) => c.id)).size, 21);
    ROLES.forEach((r, i) =>
      assert.equal(all.filter((c) => c.value === i).length, r.count),
    );
  }
  assert.throws(() => game.initialize([{ id: "a", name: "A" }], "a", () => 0));
  const s = scenario([[0, 2], [4], [5]]);
  const before = structuredClone(s);
  play(s, 0);
  assert.deepEqual(s, before);
});
test("Guard rejects Guard guesses, wrong guesses survive, right guesses eliminate", () => {
  const s = scenario([[1, 8], [9], [4]]);
  assert.throws(() => play(s, 1, "p1", 1));
  assert.throws(() => play(s, 1, "p1", 10));
  assert.equal(play(s, 1, "p1", 9).players[1].alive, false);
  assert.equal(play(s, 1, "p1", 0).players[1].alive, true);
});
test("Priest secrets only reach the actor, never the target or third player", () => {
  const s = play(scenario([[2, 5], [9], [4]]), 2, "p1");
  assert.ok(
    game.playerView(s, "p0").logs.some((l) => l.text.includes("查看到")),
  );
  for (const id of ["p1", "p2"]) {
    const view = game.playerView(s, id);
    assert.ok(!view.logs.some((l) => l.text.includes("查看到")));
    assert.equal(view.players.find((p) => p.id === "p0")!.hand, undefined);
    const text = JSON.stringify(view);
    assert.ok(!text.includes('"deck":'));
    assert.ok(!text.includes('"reserve":'));
    assert.ok(!text.includes("recipients"));
  }
});
test("Baron compares privately, eliminates lower card, tie leaves both alive", () => {
  let s = play(scenario([[3, 4], [7], [0]]), 3, "p1");
  assert.equal(s.players[0].alive, false);
  assert.ok(
    game.playerView(s, "p1").logs.some((l) => l.text.includes("秘密比牌")),
  );
  assert.ok(
    !game.playerView(s, "p2").logs.some((l) => l.text.includes("秘密比牌")),
  );
  s = play(scenario([[3, 9], [7], [0]]), 3, "p1");
  assert.equal(s.players[1].alive, false);
  s = play(scenario([[3, 4], [4], [0]]), 3, "p1");
  assert.ok(s.players.every((p) => p.alive));
});
test("Handmaid protection blocks others and expires at next turn, no-target cards fizzle", () => {
  let s = play(scenario([[4, 9], [0], [0]], [0, 0, 1, 2]), 4);
  assert.equal(s.players[0].protected, true);
  s = game.transition(
    s,
    "p1",
    { type: "play", card: s.players[1].hand[0].id },
    () => 0,
  );
  s = game.transition(
    s,
    "p2",
    { type: "play", card: s.players[2].hand[0].id },
    () => 0,
  );
  assert.equal(s.current, "p0");
  assert.equal(s.players[0].protected, false);
  for (const value of [1, 2, 3, 7]) {
    const state = scenario([[value, 9], [4], [4]]);
    state.players[1].protected = state.players[2].protected = true;
    assert.deepEqual(legalActions(state, "p0").cards[0].targets, []);
    assert.throws(() => play(state, value, "p1"));
    assert.doesNotThrow(() => play(state, value));
  }
});
test("Prince must self-target when all opponents protected and draws reserve if deck empty", () => {
  let s = scenario([[5, 7], [4], [4]]);
  s.players[1].protected = s.players[2].protected = true;
  assert.deepEqual(legalActions(s, "p0").cards[0].targets, ["p0"]);
  assert.throws(() => play(s, 5, "p1"));
  s = play(s, 5, "p0");
  assert.equal(s.players[0].discards.length, 2);
  s = scenario([[5, 7], [2]], []);
  const reserve = s.reserve;
  s = play(s, 5, "p1");
  assert.deepEqual(s.players[1].hand, [reserve]);
  assert.equal(s.reserve, null);
  s = play(scenario([[5, 7], [9], [2]], []), 5, "p1");
  assert.equal(s.players[1].alive, false);
  assert.equal(s.players[1].hand.length, 0);
});
test("Prince discard does not invoke discarded card effect", () => {
  const s = play(scenario([[5, 7], [4], [7]]), 5, "p1");
  assert.equal(s.players[1].protected, false);
});
test("Chancellor keeps one, returns ordered cards, does not enforce Countess during selection", () => {
  let s = play(scenario([[6, 8], [2], [3]], [7, 5, 1, 0]), 6);
  assert.equal(s.phase, "chancellor");
  assert.equal(s.players[0].hand.length, 3);
  const hand = s.players[0].hand;
  const chosen = hand.find((c) => c.value === 7)!;
  const bottom = hand.filter((c) => c.id !== chosen.id).reverse();
  assert.throws(() =>
    game.transition(
      s,
      "p0",
      { type: "chancellor", keep: chosen.id, bottom: [chosen.id, chosen.id] },
      () => 0,
    ),
  );
  s = game.transition(
    s,
    "p0",
    { type: "chancellor", keep: chosen.id, bottom: bottom.map((c) => c.id) },
    () => 0,
  );
  assert.deepEqual(s.players[0].hand, [chosen]);
  assert.deepEqual(s.deck.slice(-2), bottom);
  assert.equal(s.phase, "playing");
  s = play(scenario([[6, 9], [2]], [1]), 6);
  assert.equal(s.players[0].hand.length, 2);
  const keep = s.players[0].hand[0];
  s = game.transition(
    s,
    "p0",
    { type: "chancellor", keep: keep.id, bottom: [s.players[0].hand[1].id] },
    () => 0,
  );
  assert.equal(s.phase, "playing");
  s = play(scenario([[6, 9], [2]], []), 6);
  assert.equal(s.phase, "roundEnd");
});
test("King trades, Countess forced with King/Prince only, Princess always eliminates", () => {
  const s = play(scenario([[7, 9], [2], [3]]), 7, "p1");
  assert.equal(s.players[0].hand[0].value, 2);
  assert.equal(s.players[1].hand[0].value, 9);
  for (const v of [5, 7]) {
    const state = scenario([[8, v], [2], [3]]);
    assert.equal(legalActions(state, "p0").cards.length, 1);
    assert.throws(() => play(state, v, "p1"));
    assert.doesNotThrow(() => play(state, 8));
  }
  assert.equal(legalActions(scenario([[8, 6], [2]]), "p0").cards.length, 2);
  assert.equal(play(scenario([[9, 2], [5], [6]]), 9).players[0].alive, false);
});
test("Round ties each earn favor; spy bonus only for sole surviving spy user, max one", () => {
  let s = scenario([[0, 7], [7], [2]], []);
  s.players[0].discards = [card(0)];
  s = play(s, 0);
  assert.deepEqual(s.roundWinners, ["p0", "p1"]);
  assert.deepEqual(
    s.players.map((p) => p.score),
    [2, 1, 0],
  );
  s = scenario([[0, 7], [7], [2]], []);
  s.players[1].discards = [card(0)];
  s = play(s, 0);
  assert.deepEqual(
    s.players.map((p) => p.score),
    [1, 1, 0],
  );
  s = scenario([[9, 0], [7]], []);
  s = play(s, 9);
  assert.equal(s.players[0].score, 0);
  assert.equal(s.players[1].score, 1);
});
test("Multiple match winners supported; next round starts with a round winner", () => {
  let s = scenario([[0, 7], [7]], []);
  s.players.forEach((p) => (p.score = 5));
  s = play(s, 0);
  assert.equal(s.phase, "matchEnd");
  assert.deepEqual(s.winners, ["p0", "p1"]);
  assert.ok(game.result(s));
  assert.throws(() => game.transition(s, "p0", { type: "next" }, () => 0));
  s = play(scenario([[0, 7], [7]], []), 0);
  s = game.transition(s, "p0", { type: "next" }, () => 1);
  assert.equal(s.current, "p1");
  assert.equal(s.round, 2);
  assert.equal(s.players[1].hand.length, 2);
});
test("2/4/6-player simulations preserve every card and always reach a match result", () => {
  for (const n of [2, 4, 6])
    for (let seed = 1; seed <= 20; seed++) {
      let rng = seed;
      const random = (max: number) => {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        return rng % max;
      };
      let s = game.initialize(
        Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
        "p0",
        random,
      );
      let turns = 0;
      while (s.phase !== "matchEnd" && turns++ < 2000) {
        if (s.phase === "roundEnd")
          s = game.transition(s, "p0", { type: "next" }, random);
        else if (s.phase === "chancellor") {
          const h = s.players.find((p) => p.id === s.current)!.hand;
          s = game.transition(
            s,
            s.current,
            {
              type: "chancellor",
              keep: h[0].id,
              bottom: h.slice(1).map((c) => c.id),
            },
            random,
          );
        } else {
          const l = legalActions(s, s.current).cards;
          const c = l[random(l.length)];
          s = game.transition(
            s,
            s.current,
            {
              type: "play",
              card: c.id,
              ...(c.needsTarget
                ? { target: c.targets[random(c.targets.length)] }
                : {}),
              ...(c.needsGuess ? { guess: 9 } : {}),
            },
            random,
          );
        }
        const all = [
          ...s.deck,
          ...s.removed,
          ...(s.reserve ? [s.reserve] : []),
          ...s.players.flatMap((p) => [...p.hand, ...p.discards]),
        ];
        assert.equal(all.length, 21);
        assert.equal(new Set(all.map((c) => c.id)).size, 21);
        assert.ok(s.players.every((p) => p.alive || p.hand.length === 0));
      }
      assert.equal(s.phase, "matchEnd", `simulation ${n}/${seed}`);
    }
});
