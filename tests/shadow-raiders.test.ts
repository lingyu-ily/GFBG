import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowRaidersAirship as game, raiderAttackAreaIds } from "../server/games/shadow-raiders.js";
import { SR_AIRSHIP, SR_CARDS, SR_CHARACTERS, SR_OUTER_AREAS, SR_RULES_VERSION, srCharacterById, type SRState } from "../shared/shadow-raiders.js";

function rng(seed = 1) {
  let value = seed >>> 0;
  return (max: number) => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value % max; };
}
function seats(n: number) { return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `乘員${i}` })); }

test("飛行船版資料為 30 名角色、七地點及三副各 20 張牌", () => {
  assert.equal(SR_RULES_VERSION, "shadow-raiders-queen-majesty-v2-unofficial-v1");
  assert.equal(SR_CHARACTERS.length, 30);
  for (const initial of "ABCDEFGUVW") assert.equal(SR_CHARACTERS.filter((c) => c.initial === initial).length, 3);
  assert.equal(SR_OUTER_AREAS.length, 6);
  assert.deepEqual(SR_OUTER_AREAS.flatMap((a) => a.rolls), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(SR_AIRSHIP.rolls, [10]);
  for (const deck of ["white", "black", "reasoning"]) assert.equal(SR_CARDS.filter((c) => c.deck === deck).reduce((n, c) => n + c.count, 0), 20, deck);
  assert.equal(new Set(SR_CHARACTERS.map((c) => c.id)).size, 30);
  assert.equal(new Set(SR_CARDS.map((c) => `${c.deck}:${c.id}`)).size, SR_CARDS.length);
  assert.ok(SR_CHARACTERS.every((c) => c.name && c.ability && c.win && c.maxHp > 0));
});

test("4–10 人套用陣營配額、同字首三選一且牌實例唯一", () => {
  const expected: Record<number, number[]> = { 4: [2, 2, 0], 5: [2, 2, 1], 6: [2, 2, 2], 7: [2, 2, 3], 8: [3, 3, 2], 9: [3, 3, 3], 10: [3, 3, 4] };
  for (let n = 4; n <= 10; n++) {
    const s = game.initialize(seats(n), "r0", rng(100 + n));
    assert.deepEqual(["raider", "shadow", "citizen"].map((f) => s.players.filter((p) => srCharacterById(p.character).faction === f).length), expected[n]);
    assert.equal(new Set(s.players.map((p) => srCharacterById(p.character).initial)).size, n);
    assert.deepEqual(Object.values(s.decks).map((d) => d.length), [20, 20, 20]);
    assert.equal(new Set(Object.values(s.decks).flat().map((c) => c.id)).size, 60);
    for (const area of SR_OUTER_AREAS) assert.deepEqual(s.areas.find((a) => a.id === area.id)!.rolls, area.rolls);
  }
  assert.throws(() => game.initialize(seats(3), "r0", rng()));
  assert.throws(() => game.initialize(seats(11), "r0", rng()));
});

test("玩家視角不洩漏其他角色、牌序、私人提示或 prompt continuation", () => {
  const s = game.initialize(seats(4), "r0", rng(4));
  const view = game.playerView(s, "r0");
  assert.ok(view.players[0].character);
  assert.equal(view.players[1].character, undefined);
  const json = JSON.stringify(view);
  assert.ok(!json.includes('"decks"'));
  assert.ok(!json.includes('"data"'));
  assert.ok(!json.includes(s.players[1].character));
  assert.throws(() => game.parseAction({ type: "reveal" }));
  assert.throws(() => game.transition(s, "r1", { type: "roll", promptId: s.pending!.id }, rng()));
  assert.throws(() => game.transition(s, "r0", { type: "roll", promptId: "expired" }, rng()));
});

test("30 名角色都有唯一且正確的主動能力時機或被動規則分類", () => {
  const start = ["alice", "angela", "claire", "carol", "david", "deborah", "erica", "felix", "felicia", "uranus"];
  const end = ["agatha", "benjamin", "emma", "gordon", "wight"];
  const attack = ["walpugra"];
  const passive = ["bylon", "bruce", "craig", "daniel", "emi", "freddie", "galahad", "godwin", "urlich", "ulster", "vampire", "vendetta", "venom", "werewolf"];
  assert.deepEqual(new Set([...start, ...end, ...attack, ...passive]), new Set(SR_CHARACTERS.map((c) => c.id)));
  for (const id of start) {
    const s = game.initialize(seats(10), "r0", rng(200));
    s.players[0].character = id;
    s.players.forEach((p) => { p.location = s.areas[0].id; });
    s.players[0].equipment = [{ id: "gift", card: "handgun" }];
    s.discards.white = [{ id: "grave-card", card: "silver-rosary" }];
    if (id === "uranus") s.players[1].location = "airship";
    assert.equal((game.legalActions(s, "r0") as any).canUseAbility, true, id);
  }
  for (const id of end) {
    const s = game.initialize(seats(10), "r0", rng(201));
    s.players[0].character = id;
    s.players.forEach((p) => { p.location = s.areas[0].id; });
    s.players[0].equipment = [{ id: "gift", card: "handgun" }];
    s.phase = "attack";
    s.pending = { id: "sr-end", actor: "r0", kind: "turn-end", text: "結束", options: [{ id: "end", label: "結束" }], data: {} };
    assert.equal((game.legalActions(s, "r0") as any).canUseAbility, true, id);
  }
  const swap = game.initialize(seats(10), "r0", rng(202));
  swap.players[0].character = "walpugra"; swap.players[0].location = swap.areas[0].id; swap.players[1].location = swap.areas[1].id;
  swap.phase = "attack"; swap.pending = { id: "sr-attack", actor: "r0", kind: "attack", text: "攻擊", options: [{ id: "skip", label: "略過" }], data: {} };
  assert.equal((game.legalActions(swap, "r0") as any).canUseAbility, true);
  for (const id of passive) { const s = game.initialize(seats(10), "r0", rng(203)); s.players[0].character = id; assert.equal((game.legalActions(s, "r0") as any).canUseAbility, false, id); }
});

test("10 強制登船、船上可直接離開，擲回原地仍進入地點行動", () => {
  const s = game.initialize(seats(4), "r0", rng(9));
  const ten = (max: number) => max === 4 ? 3 : 5;
  const aboard = game.transition(s, "r0", { type: "roll", promptId: s.pending!.id }, ten);
  assert.equal(aboard.players[0].location, "airship");
  assert.equal(aboard.pending?.kind, "attack");

  const next = structuredClone(s);
  next.players[0].location = "airship";
  next.pending!.options.push(...next.areas.filter((a) => !a.airship).map((a) => ({ id: `leave:${a.id}`, label: a.name })));
  const leave = game.transition(next, "r0", { type: "choose", promptId: next.pending!.id, optionId: next.pending!.options.find((o) => o.id.startsWith("leave:"))!.id }, rng());
  assert.notEqual(leave.players[0].location, "airship");

  const same = game.initialize(seats(4), "r0", rng(10));
  const area = same.areas.find((a) => a.rolls.includes(2))!;
  same.players[0].location = area.id;
  const stayed = game.transition(same, "r0", { type: "roll", promptId: same.pending!.id }, () => 0);
  assert.equal(stayed.players[0].location, area.id);
  assert.equal(stayed.pending?.kind, "area");
});

test("環狀逆時針射程、雙瞄準鏡與飛船雙向全射程", () => {
  const s = game.initialize(seats(4), "r0", rng(11));
  const outer = s.areas.filter((a) => !a.airship);
  s.players[0].location = outer[0].id;
  assert.deepEqual(new Set(raiderAttackAreaIds(s, s.players[0])), new Set([outer[0].id, outer[5].id, "airship"]));
  s.players[0].equipment.push({ id: "scope-a", card: "death-scope" }, { id: "scope-b", card: "death-scope" });
  assert.deepEqual(new Set(raiderAttackAreaIds(s, s.players[0])), new Set([outer[0].id, outer[5].id, outer[4].id, outer[3].id, "airship"]));
  s.players[0].location = "airship";
  assert.deepEqual(new Set(raiderAttackAreaIds(s, s.players[0])), new Set(s.areas.map((a) => a.id)));
});

test("Urlich 可說謊且推理牌只對抽牌者與接收者公開", () => {
  const random = rng(12);
  const s = game.initialize(seats(4), "r0", random);
  s.players[1].character = "urlich";
  s.pending = { id: "sr-secret", actor: "r0", kind: "reasoning-target", text: "推理", options: [{ id: "r1", label: "乘員1" }], data: { instance: { id: "reasoning-x", card: "raider-hit" } } };
  const offered = game.transition(s, "r0", { type: "choose", promptId: "sr-secret", optionId: "r1" }, random);
  assert.equal(offered.pending?.kind, "urlich");
  assert.deepEqual(offered.pending?.options.map((o) => o.id), ["honest", "trigger", "nothing"]);
  assert.equal(game.playerView(offered, "r2").legal.pending, undefined);
  assert.ok(!JSON.stringify(game.playerView(offered, "r2")).includes("奇襲者受創"));
  const lied = game.transition(offered, "r1", { type: "choose", promptId: offered.pending!.id, optionId: "nothing" }, random);
  assert.equal(lied.players[1].damage, 0);
});

test("彩虹陽傘結算推理牌後直接進入回合結束，不會再開一次攻擊", () => {
  const random = rng(121);
  const s = game.initialize(seats(4), "r0", random);
  s.players[0].equipment = [{ id: "parasol", card: "rainbow-parasol" }];
  s.players[0].location = s.areas[0].id;
  s.players[1].location = s.areas[0].id;
  s.decks.reasoning = [{ id: "reasoning-identity", card: "identity" }];
  s.phase = "attack";
  s.pending = { id: "sr-parasol", actor: "r0", kind: "attack", text: "攻擊", options: [{ id: "parasol", label: "使用陽傘" }], data: {} };
  const target = game.transition(s, "r0", { type: "choose", promptId: "sr-parasol", optionId: "parasol" }, random);
  assert.equal(target.pending?.kind, "reasoning-target");
  const done = game.transition(target, "r0", { type: "choose", promptId: target.pending!.id, optionId: "r1" }, random);
  assert.equal(done.pending?.kind, "turn-end");
});

test("Galahad 重擲、Venom 付款與 Ulster 第二次攻擊皆保存為提示", () => {
  const equal = () => 0;
  const galahad = game.initialize(seats(4), "r0", rng(13));
  galahad.players[0].character = "galahad"; galahad.players[0].revealed = true; galahad.players[0].equipment = [{ id: "ex", card: "excalibur" }];
  galahad.players[0].location = galahad.areas[0].id; galahad.players[1].location = galahad.areas[0].id;
  galahad.phase = "attack"; galahad.pending = { id: "sr-g", actor: "r0", kind: "attack", text: "攻擊", options: [{ id: "r1", label: "乘員1" }], data: {} };
  const reroll = game.transition(galahad, "r0", { type: "choose", promptId: "sr-g", optionId: "r1" }, equal);
  assert.equal(reroll.pending?.kind, "galahad");

  const venom = game.initialize(seats(4), "r0", rng(14));
  venom.players[1].character = "venom"; venom.players[1].revealed = true;
  venom.players[0].location = venom.areas[0].id; venom.players[1].location = venom.areas[0].id;
  venom.phase = "attack"; venom.pending = { id: "sr-v", actor: "r0", kind: "attack", text: "攻擊", options: [{ id: "r1", label: "乘員1" }], data: {} };
  const pay = game.transition(venom, "r0", { type: "choose", promptId: "sr-v", optionId: "r1" }, (max) => max === 4 ? 0 : 3);
  assert.equal(pay.pending?.kind, "venom");

  const ulster = game.initialize(seats(4), "r0", rng(15));
  ulster.players[0].character = "ulster"; ulster.players[0].revealed = true; ulster.players[0].attacksRemaining = 2;
  ulster.players[0].location = ulster.areas[0].id; ulster.players[1].location = ulster.areas[0].id;
  ulster.phase = "attack"; ulster.pending = { id: "sr-u", actor: "r0", kind: "attack", text: "攻擊", options: [{ id: "r1", label: "乘員1" }], data: {} };
  const twice = game.transition(ulster, "r0", { type: "choose", promptId: "sr-u", optionId: "r1" }, (max) => max === 4 ? 0 : 2);
  assert.equal(twice.pending?.kind, "attack");
  assert.equal(twice.players[0].attacksRemaining, 1);
});

test("Godwin 死亡後以 7 傷害、無裝備、位置未定復活先前死者", () => {
  const s = game.initialize(seats(4), "r0", rng(16));
  s.players[1].character = "godwin"; s.players[1].damage = 12;
  s.players[2].alive = false; s.players[2].revealed = true; s.players[2].location = null; s.players[2].equipment = [{ id: "old", card: "handgun" }];
  s.deathOrder = [["r2"]];
  s.pending = { id: "sr-death", actor: "r0", kind: "card-target", text: "黑犬", options: [{ id: "r1", label: "乘員1" }], data: { effect: "black-dog" } };
  const revivePrompt = game.transition(s, "r0", { type: "choose", promptId: "sr-death", optionId: "r1" }, rng(17));
  assert.equal(revivePrompt.pending?.kind, "godwin");
  const revived = game.transition(revivePrompt, "r1", { type: "choose", promptId: revivePrompt.pending!.id, optionId: "r2" }, rng(18));
  assert.equal(revived.players[2].alive, true);
  assert.equal(revived.players[2].revealed, true);
  assert.equal(revived.players[2].damage, 7);
  assert.equal(revived.players[2].location, null);
  assert.equal(revived.players[2].equipment.length, 0);
});

test("同一效果讓奇襲者與暗影同時滅亡時雙方都獲勝", () => {
  const s = game.initialize(seats(4), "r0", rng(19));
  s.players[0].character = "felix";
  s.players[1].character = "urlich";
  s.players[2].character = "emi";
  s.players[3].character = "vampire";
  s.players[2].alive = false; s.players[2].revealed = true;
  s.players[3].alive = false; s.players[3].revealed = true;
  s.deathOrder = [["r2", "r3"]];
  s.players[0].damage = srCharacterById("felix").maxHp - 2;
  s.players[1].damage = srCharacterById("urlich").maxHp - 2;
  s.pending = { id: "sr-double-ko", actor: "r0", kind: "card-target", text: "黑犬", options: [{ id: "r1", label: "乘員1" }], data: { effect: "black-dog" } };
  const finished = game.transition(s, "r0", { type: "choose", promptId: "sr-double-ko", optionId: "r1" }, rng(20));
  assert.equal(finished.phase, "finished");
  assert.deepEqual(new Set(finished.winners), new Set(["r0", "r1", "r2", "r3"]));
});

function auto(s: SRState, random: (max: number) => number) {
  const q = s.pending!;
  if (q.options.some((o) => o.id === "roll")) return game.transition(s, q.actor, { type: "roll", promptId: q.id }, random);
  let option = q.options[0];
  if (q.kind === "area") option = q.options.find((o) => o.id === "use")!;
  if (q.kind === "attack") option = q.options.find((o) => !["skip", "parasol"].includes(o.id)) || q.options.at(-1)!;
  if (["turn-end", "counter", "craig"].includes(q.kind)) option = q.options.at(-1)!;
  if (["urlich", "reasoning-payment", "venom"].includes(q.kind)) option = q.options[0];
  return game.transition(s, q.actor, { type: "choose", promptId: q.id, optionId: option.id }, random);
}

test("固定種子 4／6／8／9／10 人對局完成並只產生 0／1 戰績", () => {
  for (const n of [4, 6, 8, 9, 10]) {
    const random = rng(900 + n);
    let s = game.initialize(seats(n), "r0", random);
    let actions = 0;
    while (s.phase !== "finished" && actions++ < 20000) s = auto(s, random);
    assert.equal(s.phase, "finished", `${n} 人模擬未完成；pending=${s.pending?.kind}`);
    assert.ok(Object.values(game.result(s)!.scores).every((x) => x === 0 || x === 1));
  }
});
