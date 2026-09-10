import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowHunters as game } from "../server/games/shadow-hunters.js";
import { AREAS, CARDS, CHARACTERS, characterById, type SHState } from "../shared/shadow-hunters.js";

function rng(seed = 1) {
  let value = seed >>> 0;
  return (max: number) => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % max;
  };
}
function seats(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}` }));
}

test("完整資料包含 20 名配對角色、6 個地點與三副各 16 張牌", () => {
  assert.equal(CHARACTERS.length, 20);
  for (const initial of "ABCDEFGUVW")
    assert.equal(CHARACTERS.filter((c) => c.initial === initial).length, 2);
  assert.equal(AREAS.length, 6);
  for (const deck of ["white", "black", "hermit"])
    assert.equal(CARDS.filter((c) => c.deck === deck).reduce((n, c) => n + c.count, 0), 16);
  assert.equal(new Set(CHARACTERS.map((character) => character.id)).size, 20);
  assert.equal(new Set(CARDS.map((card) => `${card.deck}:${card.id}`)).size, CARDS.length);
  assert.ok(CHARACTERS.every((character) => character.name && character.win && character.ability && character.maxHp > 0));
  assert.ok(CARDS.every((card) => card.title && card.text && card.count > 0));
  assert.ok(AREAS.every((area) => area.name && area.text && area.rolls.length));
  const state = game.initialize(seats(4), "p0", rng(99));
  const instances = Object.values(state.decks).flat();
  assert.equal(instances.length, 48);
  assert.equal(new Set(instances.map((card) => card.id)).size, 48);
});

test("4–8 人依官方陣營配額配置，且每個字首最多一名", () => {
  const expected: Record<number, number[]> = { 4: [2, 2, 0], 5: [2, 2, 1], 6: [2, 2, 2], 7: [2, 2, 3], 8: [3, 3, 2] };
  for (const n of [4, 5, 6, 7, 8]) {
    const s = game.initialize(seats(n), "p0", rng(n));
    const factions = ["hunter", "shadow", "neutral"].map((f) => s.players.filter((p) => characterById(p.character).faction === f).length);
    assert.deepEqual(factions, expected[n]);
    assert.equal(new Set(s.players.map((p) => characterById(p.character).initial)).size, n);
    assert.deepEqual(Object.values(s.decks).map((d) => d.length), [16, 16, 16]);
    assert.equal(s.pending?.kind, "move");
  }
  assert.throws(() => game.initialize(seats(3), "p0", rng()));
  assert.throws(() => game.initialize(seats(9), "p0", rng()));
});

test("玩家視角隱藏其他身分、牌庫順序、內部提示與私人紀錄", () => {
  let s = game.initialize(seats(4), "p0", rng(7));
  const own = game.playerView(s, "p0");
  assert.ok(own.players[0].character);
  assert.equal(own.players[1].character, undefined);
  const text = JSON.stringify(own);
  assert.ok(!text.includes('"decks"'));
  assert.ok(!text.includes('"data"'));
  assert.ok(!text.includes('"winQualified"'));
  assert.ok(!text.includes(s.players[1].character));
  s = game.transition(s, "p1", { type: "reveal" }, rng(8));
  assert.equal(game.playerView(s, "p0").players[1].character?.id, s.players[1].character);
});

test("無名氏可照實、觸發或宣稱隱士牌無事，私人提示不外洩", () => {
  const random = rng(17);
  const base = game.initialize(seats(4), "p0", random);
  base.players[1].character = "unknown";
  base.pending = {
    id: "sh-private",
    actor: "p0",
    kind: "hermit-target",
    text: "選擇接收者",
    options: [{ id: "p1", label: "玩家1" }],
    data: { instance: { id: "hermit-test", card: "slap" } },
  };
  const prompted = game.transition(base, "p0", { type: "choose", promptId: "sh-private", optionId: "p1" }, random);
  assert.equal(prompted.pending?.kind, "hermit-unknown");
  assert.deepEqual(prompted.pending?.options.map((option) => option.id), ["honest", "trigger", "nothing"]);
  assert.equal(game.playerView(prompted, "p2").legal.pending, undefined);
  assert.ok(!JSON.stringify(game.playerView(prompted, "p2")).includes("隱士的耳光"));

  const honest = game.transition(structuredClone(prompted), "p1", { type: "choose", promptId: prompted.pending!.id, optionId: "honest" }, random);
  assert.equal(honest.players[1].damage, 0);
  const triggered = game.transition(structuredClone(prompted), "p1", { type: "choose", promptId: prompted.pending!.id, optionId: "trigger" }, random);
  assert.equal(triggered.players[1].damage, 1);
});

test("移動、略過地點、攻擊與回合交接均由有效 promptId 驅動", () => {
  const random = rng(3);
  let s = game.initialize(seats(4), "p0", random);
  const move = s.pending!;
  assert.throws(() => game.transition(s, "p1", { type: "roll", promptId: move.id }, random));
  assert.throws(() => game.transition(s, "p0", { type: "roll", promptId: "old" }, random));
  s = game.transition(s, "p0", { type: "roll", promptId: move.id }, random);
  if (s.pending?.kind === "move-result")
    s = game.transition(s, "p0", { type: "choose", promptId: s.pending.id, optionId: s.pending.options[0].id }, random);
  assert.equal(s.pending?.kind, "area");
  s = game.transition(s, "p0", { type: "choose", promptId: s.pending!.id, optionId: "skip" }, random);
  assert.equal(s.pending?.kind, "attack");
  const option = s.pending!.options.find((o) => o.id === "skip") || s.pending!.options[0];
  s = game.transition(s, "p0", { type: "choose", promptId: s.pending!.id, optionId: option.id }, random);
  while (s.pending && s.pending.kind !== "turn-end") {
    const actor = s.pending.actor;
    s = game.transition(s, actor, { type: "choose", promptId: s.pending.id, optionId: s.pending.options.at(-1)!.id }, random);
  }
  assert.equal(s.pending?.kind, "turn-end");
});

test("骰回原地與神祕羅盤的第二次擲骰都保存在提示佇列", () => {
  const fixed = (_max: number) => 0;
  const sameArea = game.initialize(seats(4), "p0", fixed);
  sameArea.players[0].location = sameArea.areas.find((area) => area.rolls.includes(2))!.id;
  const reroll = game.transition(sameArea, "p0", { type: "roll", promptId: sameArea.pending!.id }, fixed);
  assert.equal(reroll.pending?.kind, "reroll");
  assert.deepEqual(reroll.pending?.options.map((option) => option.id), ["roll"]);

  const compass = game.initialize(seats(4), "p0", fixed);
  compass.players[0].equipment.push({ id: "white-test", card: "mystic-compass" });
  const secondRoll = game.transition(compass, "p0", { type: "roll", promptId: compass.pending!.id }, fixed);
  assert.equal(secondRoll.pending?.kind, "compass-roll");
  assert.deepEqual(secondRoll.pending?.data.results, [2]);
  const choice = game.transition(secondRoll, "p0", { type: "roll", promptId: secondRoll.pending!.id }, fixed);
  assert.equal(choice.pending?.kind, "move-result");
  assert.equal(choice.pending?.options.length, 2);
});

test("丹尼爾不能自行公開，其他角色首次死亡時會強制公開", () => {
  const random = rng(23);
  const s = game.initialize(seats(4), "p1", random);
  s.players[0].character = "daniel";
  assert.equal((game.legalActions(s, "p0") as any).canReveal, false);
  assert.throws(() => game.transition(s, "p0", { type: "reveal" }, random));
  const victim = s.players[2];
  victim.damage = characterById(victim.character).maxHp - 2;
  s.pending = {
    id: "sh-daniel",
    actor: "p1",
    kind: "card-target",
    text: "選擇目標",
    options: [{ id: victim.id, label: victim.name }],
    data: { effect: "bat" },
  };
  const after = game.transition(s, "p1", { type: "choose", promptId: "sh-daniel", optionId: victim.id }, random);
  assert.equal(after.players[0].revealed, true);
});

test("裝備傷害可疊加，機關槍把同批多目標死亡一起結算", () => {
  const random = (max: number) => max === 4 ? 0 : 3;
  const s = game.initialize(seats(4), "p0", rng(31));
  const area = s.areas[0].id;
  s.players.slice(0, 3).forEach((p) => { p.location = area; });
  s.players[0].equipment = [
    { id: "gun", card: "machine-gun" },
    { id: "knife", card: "butcher-knife" },
    { id: "saw", card: "chainsaw" },
    { id: "axe", card: "rusted-axe" },
  ];
  for (const victim of s.players.slice(1, 3))
    victim.damage = characterById(victim.character).maxHp - 6;
  s.phase = "attack";
  s.pending = { id: "sh-machine", actor: "p0", kind: "attack", text: "攻擊", options: [{ id: "p1", label: "玩家1" }], data: {} };
  const after = game.transition(s, "p0", { type: "choose", promptId: "sh-machine", optionId: "p1" }, random);
  assert.equal(after.players[1].alive, false);
  assert.equal(after.players[2].alive, false);
  assert.deepEqual(after.deathOrder[0], ["p1", "p2"]);
});

test("狼人反擊、死亡戰利品與空牌堆重洗皆可從提示狀態續行", () => {
  const attackRoll = (max: number) => max === 4 ? 0 : 3;
  const counter = game.initialize(seats(4), "p0", rng(41));
  counter.players[1].character = "werewolf";
  counter.players[0].location = counter.areas[0].id;
  counter.players[1].location = counter.areas[1].id;
  counter.phase = "attack";
  counter.pending = { id: "sh-counter", actor: "p0", kind: "attack", text: "攻擊", options: [{ id: "p1", label: "玩家1" }], data: {} };
  const offered = game.transition(counter, "p0", { type: "choose", promptId: "sh-counter", optionId: "p1" }, attackRoll);
  assert.equal(offered.pending?.kind, "counter");
  const countered = game.transition(offered, "p1", { type: "choose", promptId: offered.pending!.id, optionId: "counter" }, attackRoll);
  assert.equal(countered.players[1].revealed, true);

  const loot = game.initialize(seats(4), "p0", rng(43));
  loot.players[0].character = "george";
  loot.players[0].location = loot.areas[0].id;
  loot.players[1].location = loot.areas[1].id;
  loot.players[1].damage = characterById(loot.players[1].character).maxHp - 3;
  loot.players[1].equipment = [{ id: "loot-a", card: "talisman" }, { id: "loot-b", card: "mystic-compass" }];
  loot.phase = "attack";
  loot.pending = { id: "sh-loot", actor: "p0", kind: "attack", text: "攻擊", options: [{ id: "p1", label: "玩家1" }], data: {} };
  const choosingLoot = game.transition(loot, "p0", { type: "choose", promptId: "sh-loot", optionId: "p1" }, attackRoll);
  assert.equal(choosingLoot.pending?.kind, "loot");
  const looted = game.transition(choosingLoot, "p0", { type: "choose", promptId: choosingLoot.pending!.id, optionId: "loot-a" }, rng(44));
  assert.ok(looted.players[0].equipment.some((card) => card.id === "loot-a"));
  assert.ok(looted.discards.white.some((card) => card.id === "loot-b"));

  const reshuffle = game.initialize(seats(4), "p0", rng(45));
  reshuffle.players[0].location = reshuffle.areas.find((area) => area.id === "church")!.id;
  reshuffle.decks.white = [];
  reshuffle.discards.white = [{ id: "recycled", card: "mystic-compass" }];
  reshuffle.phase = "area";
  reshuffle.pending = { id: "sh-reshuffle", actor: "p0", kind: "area", text: "教堂", options: [{ id: "use", label: "抽牌" }], data: {} };
  const recycled = game.transition(reshuffle, "p0", { type: "choose", promptId: "sh-reshuffle", optionId: "use" }, rng(46));
  assert.ok(recycled.players[0].equipment.some((card) => card.id === "recycled"));
  assert.equal(recycled.discards.white.length, 0);
});

function automatedTurn(s: SHState, random: (max: number) => number) {
  const q = s.pending!;
  const legal = game.legalActions(s, q.actor) as any;
  assert.equal(legal.pending.id, q.id);
  if (q.options.some((o) => o.id === "roll"))
    return game.transition(s, q.actor, { type: "roll", promptId: q.id }, random);
  let option = q.options[0];
  if (q.kind === "area") option = q.options.find((o) => o.id === "use")!;
  if (q.kind === "turn-end") option = q.options.find((o) => o.id === "end")!;
  if (q.kind === "card-confirm" || q.kind === "counter") option = q.options.at(-1)!;
  return game.transition(s, q.actor, { type: "choose", promptId: q.id, optionId: option.id }, random);
}

test("固定種子 4／6／8 人對局能完成且只回傳 0／1 戰績", () => {
  for (const n of [4, 6, 8]) {
    const random = rng(100 + n);
    let s = game.initialize(seats(n), "p0", random);
    let actions = 0;
    while (s.phase !== "finished" && actions++ < 10000) s = automatedTurn(s, random);
    assert.equal(s.phase, "finished", `${n} 人模擬未完成`);
    const result = game.result(s)!;
    assert.ok(result.winners.length > 0);
    assert.ok(Object.values(result.scores).every((score) => score === 0 || score === 1));
  }
});
