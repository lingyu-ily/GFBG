import { z } from "zod";
import type { GameDefinition, Seat } from "../../shared/game.js";
import {
  AREAS,
  CARDS,
  CHARACTERS,
  cardById,
  characterById,
  type SHAction,
  type SHCardInstance,
  type SHDeck,
  type SHPending,
  type SHPlayer,
  type SHLegal,
  type SHState,
  type SHView,
} from "../../shared/shadow-hunters.js";

type Random = (max: number) => number;
type After = "area" | "turn" | "none";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll"), promptId: z.string().max(40) }).strict(),
  z.object({ type: z.literal("choose"), promptId: z.string().max(40), optionId: z.string().max(100) }).strict(),
  z.object({ type: z.literal("reveal") }).strict(),
  z.object({ type: z.literal("ability") }).strict(),
]);

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function shuffle<T>(values: readonly T[], random: Random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function log(s: SHState, text: string, recipients?: string[]) {
  s.logs.push({ text, ...(recipients ? { recipients } : {}) });
  s.logs = s.logs.slice(-250);
}
function player(s: SHState, id: string) {
  const value = s.players.find((p) => p.id === id);
  assert(value, "玩家不存在");
  return value;
}
function character(p: SHPlayer) {
  return characterById(p.character);
}
function has(p: SHPlayer, card: string) {
  return p.equipment.some((e) => e.card === card);
}
function prompt(
  s: SHState,
  actor: string,
  kind: string,
  text: string,
  options: { id: string; label: string }[],
  data: Record<string, unknown> = {},
) {
  s.pending = {
    id: `sh-${++s.promptSequence}`,
    actor,
    kind,
    text,
    options,
    data,
  };
}
function roll(s: SHState, random: Random, purpose: string, dice: "both" | "d4" | "d6" = "both") {
  const d4 = dice === "d6" ? 0 : random(4) + 1;
  const d6 = dice === "d4" ? 0 : random(6) + 1;
  s.lastRoll = { d4, d6, purpose };
  return { d4, d6 };
}
function cardInstances(deck: SHDeck, random: Random) {
  let n = 0;
  return shuffle(
    CARDS.filter((c) => c.deck === deck).flatMap((c) =>
      Array.from({ length: c.count }, () => ({ id: `${deck}-${n++}`, card: c.id })),
    ),
    random,
  );
}
function draw(s: SHState, deck: SHDeck, random: Random) {
  if (!s.decks[deck].length) {
    s.decks[deck] = shuffle(s.discards[deck], random);
    s.discards[deck] = [];
  }
  const result = s.decks[deck].shift();
  assert(result, "牌堆中沒有牌");
  return result;
}
function discard(s: SHState, instance: SHCardInstance) {
  s.discards[cardById(instance.card).deck].push(instance);
}
function reveal(s: SHState, p: SHPlayer) {
  if (!p.revealed) {
    p.revealed = true;
    log(s, `${p.name} 公開身分：${character(p).name}（${factionName(character(p).faction)}）。`);
  }
}
function factionName(value: string) {
  return value === "hunter" ? "獵人" : value === "shadow" ? "暗影" : "中立";
}
function movementOptions(s: SHState, total: number, prefix = "") {
  if (total === 7)
    return s.areas
      .filter((a) => a.id !== player(s, s.current).location)
      .map((a) => ({ id: `${prefix ? `${prefix}:` : ""}${a.id}`, label: `${prefix ? `${prefix}：` : ""}${a.name}` }));
  const area = s.areas.find((a) => a.rolls.includes(total));
  assert(area, "骰值沒有對應地點");
  return [{ id: `${prefix ? `${prefix}:` : ""}${area.id}`, label: `${prefix ? `${prefix}：` : ""}${area.name}（${total}）` }];
}
function resolveMovementRoll(s: SHState, p: SHPlayer, random: Random, previous: number[] = []) {
  const dice = roll(s, random, "移動");
  const total = dice.d4 + dice.d6;
  const current = s.areas.find((a) => a.id === p.location);
  if (total !== 7 && current?.rolls.includes(total)) {
    prompt(s, p.id, "reroll", "骰回目前所在地點，必須重新擲骰。", [{ id: "roll", label: "重新擲 D4 + D6" }], { results: previous });
    return;
  }
  const results = [...previous, total];
  if (has(p, "mystic-compass") && results.length < 2) {
    prompt(s, p.id, "compass-roll", "神祕羅盤：再擲一次，之後選擇移動結果。", [{ id: "roll", label: "再次擲 D4 + D6" }], { results });
    return;
  }
  if (results.length === 1) {
    const options = movementOptions(s, total);
    if (options.length === 1) moveTo(s, options[0].id);
    else prompt(s, p.id, "move-result", "擲出 7，選擇任一其他地點。", options);
    return;
  }
  const labels = ["第一次", "第二次"];
  prompt(s, p.id, "move-result", "神祕羅盤讓你選擇一次移動結果。", results.flatMap((result, index) => movementOptions(s, result, labels[index])));
}
function startTurn(s: SHState) {
  const p = player(s, s.current);
  p.guardian = false;
  p.barrier = false;
  s.phase = "move";
  const opts = [{ id: "roll", label: "擲 D4 + D6 移動" }];
  if (p.revealed && !p.abilityDisabled && p.character === "emi" && p.location) {
    const index = s.areas.findIndex((a) => a.id === p.location);
    for (const offset of [-1, 1]) {
      const area = s.areas[(index + offset + s.areas.length) % s.areas.length];
      opts.push({ id: `teleport:${area.id}`, label: `瞬移到${area.name}` });
    }
  }
  prompt(s, p.id, "move", "移動是每回合的必要行動。", opts);
  log(s, `輪到 ${p.name}。`);
}
function moveTo(s: SHState, areaId: string) {
  const p = player(s, s.current);
  const area = s.areas.find((a) => a.id === areaId);
  assert(area && area.id !== p.location, "必須移動到另一個地點");
  p.location = area.id;
  s.phase = "area";
  log(s, `${p.name} 移動到${area.name}。`);
  prompt(s, p.id, "area", `${area.name}：${area.text}`, [
    { id: "use", label: "執行地點行動" },
    { id: "skip", label: "略過地點行動" },
  ]);
}
function attackTargets(s: SHState, attacker: SHPlayer) {
  if (!attacker.location) return [];
  const ownZone = Math.floor(s.areas.findIndex((a) => a.id === attacker.location) / 2);
  return s.players.filter((p) => {
    if (!p.alive || p.id === attacker.id || !p.location) return false;
    const zone = Math.floor(s.areas.findIndex((a) => a.id === p.location) / 2);
    return has(attacker, "handgun") ? zone !== ownZone : zone === ownZone;
  });
}
function beginAttack(s: SHState) {
  if (s.phase === "finished") return;
  s.phase = "attack";
  const p = player(s, s.current);
  const targets = attackTargets(s, p);
  const options = targets.map((t) => ({ id: t.id, label: `攻擊 ${t.name}` }));
  if (!has(p, "masamune") || !targets.length) options.push({ id: "skip", label: "不攻擊，結束回合" });
  prompt(s, p.id, "attack", targets.length ? "選擇攻擊目標。" : "目前沒有可攻擊的角色。", options);
}
function nextTurn(s: SHState) {
  const current = player(s, s.current);
  if (current.extraTurns > 0) current.extraTurns--;
  else {
    let i = s.players.findIndex((p) => p.id === s.current);
    do i = (i + 1) % s.players.length;
    while (!s.players[i].alive);
    s.current = s.players[i].id;
  }
  startTurn(s);
}
function finishTurn(s: SHState) {
  if (s.phase === "finished") return;
  const p = player(s, s.current);
  const options = [{ id: "end", label: "結束回合" }];
  if (p.revealed && !p.abilityDisabled && !p.abilityUsed && ["gregor", "wight"].includes(p.character))
    options.unshift({ id: "ability", label: `使用${character(p).ability.split("：")[0]}` });
  prompt(s, p.id, "turn-end", "確認回合結束。", options);
}

type DamageSource = { kind: "attack" | "black" | "white" | "hermit" | "area" | "ability"; card?: string; attacker?: string };
function markDead(s: SHState, target: SHPlayer) {
  if (!target.alive) return false;
  target.alive = false;
  target.revealed = true;
  target.location = null;
  log(s, `${target.name}（${character(target).name}）死亡。`);
  return true;
}
function applyDamage(s: SHState, target: SHPlayer, amount: number, source: DamageSource) {
  if (!target.alive || amount <= 0) return false;
  if (target.barrier) amount = 0;
  if (source.kind === "attack" && target.guardian) amount = 0;
  if (source.kind === "attack" && has(target, "holy-robe")) amount = Math.max(0, amount - 1);
  if (source.kind === "black" && source.card && ["bloodthirsty-spider", "vampire-bat", "dynamite"].includes(source.card) && has(target, "talisman")) amount = 0;
  if (!amount) {
    log(s, `${target.name} 擋下了傷害。`);
    return false;
  }
  target.damage = Math.min(character(target).maxHp, target.damage + amount);
  log(s, `${target.name} 受到 ${amount} 點傷害。`);
  if (target.damage >= character(target).maxHp) return markDead(s, target);
  return false;
}
function heal(s: SHState, target: SHPlayer, amount: number) {
  const before = target.damage;
  target.damage = Math.max(0, target.damage - amount);
  log(s, `${target.name} 治療 ${before - target.damage} 點傷害。`);
}
function recordDeaths(s: SHState, deaths: SHPlayer[], killer?: SHPlayer, byAttack = false) {
  if (!deaths.length) return;
  s.deathOrder.push(deaths.map((p) => p.id));
  for (const d of deaths) {
    if (d.character === "daniel" && s.deathOrder.length === 1) d.winQualified = true;
    if (d.character === "catherine" && s.deathOrder.length === 1) d.winQualified = true;
  }
  for (const p of s.players)
    if (p.alive && p.character === "daniel" && deaths.some((d) => d.id !== p.id)) reveal(s, p);
  if (killer && byAttack) {
    if (killer.character === "bryan") {
      if (deaths.some((d) => character(d).maxHp >= 13)) killer.winQualified = true;
      else if (deaths.length) reveal(s, killer);
    }
    if (killer.character === "charles" && s.deathOrder.flat().length >= 3) killer.winQualified = true;
  }
}
function primaryWinners(s: SHState) {
  const deadNeutral = s.players.filter((p) => !p.alive && character(p).faction === "neutral").length;
  const huntersDead = s.players.filter((p) => character(p).faction === "hunter").every((p) => !p.alive);
  const shadowsDead = s.players.filter((p) => character(p).faction === "shadow").every((p) => !p.alive);
  const alive = s.players.filter((p) => p.alive);
  return s.players.filter((p) => {
    const c = character(p);
    if (c.faction === "hunter") return shadowsDead;
    if (c.faction === "shadow") return huntersDead || deadNeutral >= 3;
    if (p.winQualified) return true;
    if (p.character === "bob") return p.equipment.length >= 5;
    if (p.character === "david") return ["spear-of-longinus", "holy-robe", "silver-rosary", "talisman"].filter((id) => has(p, id)).length >= 3;
    if (p.character === "daniel") return p.alive && shadowsDead;
    if (p.character === "catherine") return p.alive && alive.length <= 2;
    return false;
  });
}
function checkWin(s: SHState) {
  const primary = primaryWinners(s);
  if (!primary.length) return false;
  const ids = new Set(primary.map((p) => p.id));
  for (const p of s.players) {
    if (p.character === "allie" && p.alive) ids.add(p.id);
    if (p.character === "bryan" && p.location === "erstwhile-altar") ids.add(p.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      if (p.character !== "agnes" || ids.has(p.id)) continue;
      const offset = p.agnesSide === "right" ? -1 : 1;
      const neighbor = s.players[(i + offset + s.players.length) % s.players.length];
      if (ids.has(neighbor.id)) {
        ids.add(p.id);
        changed = true;
      }
    }
  }
  s.winners = [...ids];
  s.phase = "finished";
  s.pending = null;
  s.players.forEach((p) => (p.revealed = true));
  log(s, `${s.players.filter((p) => ids.has(p.id)).map((p) => p.name).join("、")} 獲勝。`);
  return true;
}
function continueAfter(s: SHState, after: After) {
  if (checkWin(s)) return;
  if (after === "area") beginAttack(s);
  else if (after === "turn") finishTurn(s);
}
function finishDeaths(s: SHState, deaths: SHPlayer[], killer: SHPlayer | undefined, byAttack: boolean, after: After) {
  recordDeaths(s, deaths, killer, byAttack);
  const victims = byAttack && killer?.alive
    ? deaths.filter((d) => d.equipment.length && d.id !== killer.id).map((d) => d.id)
    : [];
  deaths
    .filter((d) => !victims.includes(d.id))
    .forEach((d) => d.equipment.splice(0).forEach((e) => discard(s, e)));
  if (killer && victims.length) {
    beginLoot(s, killer, victims, after, byAttack);
    return;
  }
  continueAfter(s, after);
}
function beginLoot(s: SHState, killer: SHPlayer, victims: string[], after: After, byAttack: boolean) {
  if (!victims.length) return continueAfter(s, after);
  const victim = player(s, victims[0]);
  const takeAll = has(killer, "silver-rosary") || (byAttack && killer.character === "bob" && killer.revealed && !killer.abilityDisabled && s.players.length >= 7);
  if (takeAll) {
    killer.equipment.push(...victim.equipment.splice(0));
    log(s, `${killer.name} 取得 ${victim.name} 的全部裝備。`);
    beginLoot(s, killer, victims.slice(1), after, byAttack);
    return;
  }
  prompt(s, killer.id, "loot", `從 ${victim.name} 的遺物選擇一件裝備。`, victim.equipment.map((e) => ({ id: e.id, label: cardById(e.card).title })), { victims, after, byAttack });
}
function resolveLoot(s: SHState, optionId: string, random: Random) {
  const pending = s.pending!;
  const victims = pending.data.victims as string[];
  const after = pending.data.after as After;
  const byAttack = pending.data.byAttack as boolean;
  const killer = player(s, pending.actor);
  const victim = player(s, victims[0]);
  const index = victim.equipment.findIndex((e) => e.id === optionId);
  assert(index >= 0, "裝備不存在");
  killer.equipment.push(victim.equipment.splice(index, 1)[0]);
  victim.equipment.splice(0).forEach((e) => discard(s, e));
  beginLoot(s, killer, victims.slice(1), after, byAttack);
  void random;
}
function areaAction(s: SHState, random: Random) {
  const p = player(s, s.current);
  const area = s.areas.find((a) => a.id === p.location)!;
  if (["church", "cemetery", "hermit-cabin"].includes(area.id)) {
    const deck: SHDeck = area.id === "church" ? "white" : area.id === "cemetery" ? "black" : "hermit";
    resolveDraw(s, p, deck, random);
  } else if (area.id === "underworld-gate") {
    prompt(s, p.id, "choose-deck", "選擇要抽取的牌堆。", [
      { id: "white", label: "白色牌" }, { id: "black", label: "黑色牌" }, { id: "hermit", label: "隱士牌" },
    ]);
  } else if (area.id === "weird-woods") {
    prompt(s, p.id, "woods", "選擇一名角色及森林效果。", s.players.filter((x) => x.alive).flatMap((x) => [
      { id: `damage:${x.id}`, label: `${x.name} 受到 2 點傷害` },
      { id: `heal:${x.id}`, label: `${x.name} 治療 1 點` },
    ]));
  } else {
    const options = s.players.filter((x) => x.alive && x.id !== p.id).flatMap((x) => x.equipment.map((e) => ({ id: `${x.id}:${e.id}`, label: `從 ${x.name} 偷取${cardById(e.card).title}` })));
    if (!options.length) return beginAttack(s);
    prompt(s, p.id, "altar", "選擇要偷取的裝備。", options);
  }
}
function resolveDraw(s: SHState, p: SHPlayer, deck: SHDeck, random: Random) {
  const instance = draw(s, deck, random);
  const card = cardById(instance.card);
  log(s, `${p.name} 抽到${deck === "hermit" ? "一張隱士牌" : card.title}。`);
  log(s, `你抽到${card.title}：${card.text}`, [p.id]);
  if (card.type === "equipment") {
    p.equipment.push(instance);
    log(s, `${p.name} 裝備了${card.title}。`);
    continueAfter(s, "area");
    return;
  }
  if (deck === "hermit") {
    prompt(s, p.id, "hermit-target", `隱士牌：${card.text}`, s.players.filter((x) => x.alive && x.id !== p.id).map((x) => ({ id: x.id, label: `交給 ${x.name}` })), { instance });
    return;
  }
  resolveSingle(s, p, instance, random);
}
function targetPrompt(s: SHState, p: SHPlayer, text: string, effect: string, includeSelf: boolean, data: Record<string, unknown> = {}) {
  prompt(s, p.id, "card-target", text, s.players.filter((x) => x.alive && (includeSelf || x.id !== p.id)).map((x) => ({ id: x.id, label: x.name })), { effect, ...data });
}
function resolveSingle(s: SHState, p: SHPlayer, instance: SHCardInstance, random: Random) {
  const id = instance.card;
  discard(s, instance);
  if (id === "advent" || id === "diabolic-ritual" || id === "chocolate") {
    const allowed = id === "advent" ? character(p).faction === "hunter" : id === "diabolic-ritual" ? character(p).faction === "shadow" : ["allie", "agnes", "emi", "ellen", "unknown", "ultra-soul"].includes(p.character);
    if (!allowed) return continueAfter(s, "area");
    prompt(s, p.id, "card-confirm", `${cardById(id).title}可以公開身分並完全治療。`, [{ id: "use", label: "公開並完全治療" }, { id: "skip", label: "不使用" }], { effect: "reveal-heal" });
  } else if (id === "disenchant-mirror") {
    if (character(p).faction === "shadow" && p.character !== "unknown") reveal(s, p);
    continueAfter(s, "area");
  } else if (id === "blessing") targetPrompt(s, p, "選擇接受祝福的角色。", "blessing", false);
  else if (id === "concealed-knowledge") { p.extraTurns++; continueAfter(s, "area"); }
  else if (id === "guardian-angel") { p.guardian = true; continueAfter(s, "area"); }
  else if (id === "flare-of-judgement") {
    const deaths = s.players.filter((x) => x.alive && x.id !== p.id && applyDamage(s, x, 2, { kind: "white", card: id }));
    finishDeaths(s, deaths, p, false, "area");
  } else if (id === "first-aid") targetPrompt(s, p, "選擇把傷害設為 7 的角色。", "first-aid", true);
  else if (id === "holy-water") { heal(s, p, 2); continueAfter(s, "area"); }
  else if (id === "moody-goblin") {
    const options = s.players.filter((x) => x.id !== p.id).flatMap((x) => x.equipment.map((e) => ({ id: `${x.id}:${e.id}`, label: `從 ${x.name} 偷取${cardById(e.card).title}` })));
    if (!options.length) continueAfter(s, "area"); else prompt(s, p.id, "steal", "選擇要偷取的裝備。", options, { after: "area" });
  } else if (id === "bloodthirsty-spider") targetPrompt(s, p, "選擇蜘蛛攻擊的角色。", "spider", false);
  else if (id === "vampire-bat") targetPrompt(s, p, "選擇蝙蝠攻擊的角色。", "bat", false);
  else if (id === "banana-peel") {
    if (!p.equipment.length) {
      const died = applyDamage(s, p, 1, { kind: "black", card: id });
      finishDeaths(s, died ? [p] : [], p, false, "area");
    } else prompt(s, p.id, "banana-equipment", "選擇要交出的裝備。", p.equipment.map((e) => ({ id: e.id, label: cardById(e.card).title })));
  } else if (id === "dynamite") {
    const dice = roll(s, random, "炸藥");
    const total = dice.d4 + dice.d6;
    const area = total === 7 ? undefined : s.areas.find((a) => a.rolls.includes(total));
    const deaths = area ? s.players.filter((x) => x.alive && x.location === area.id && applyDamage(s, x, 3, { kind: "black", card: id })) : [];
    finishDeaths(s, deaths, p, false, "area");
  } else if (id === "spiritual-doll") targetPrompt(s, p, "選擇靈魂娃娃的目標。", "doll", false);
  else continueAfter(s, "area");
}
function hermitMatches(card: string, p: SHPlayer) {
  const faction = character(p).faction;
  if (card === "blackmail") return faction === "neutral" || faction === "hunter";
  if (card === "greed") return faction === "neutral" || faction === "shadow";
  if (card === "anger") return faction === "hunter" || faction === "shadow";
  if (["slap", "aid"].includes(card)) return faction === "hunter";
  if (["spell", "exorcism", "huddle"].includes(card)) return faction === "shadow";
  if (card === "nurturance") return faction === "neutral";
  if (card === "lesson") return character(p).maxHp >= 12;
  if (card === "bully") return character(p).maxHp <= 11;
  return true;
}
function resolveHermit(s: SHState, giver: SHPlayer, target: SHPlayer, instance: SHCardInstance, trigger: boolean) {
  const id = instance.card;
  discard(s, instance);
  log(s, `你收到${cardById(id).title}：${cardById(id).text}`, [target.id]);
  if (id === "prediction") {
    log(s, `${target.name} 的身分是${character(target).name}（${factionName(character(target).faction)}）。`, [giver.id]);
    return continueAfter(s, "area");
  }
  if (!trigger) {
    log(s, `${target.name} 宣告無事發生。`);
    return continueAfter(s, "area");
  }
  if (["blackmail", "greed", "anger"].includes(id) && target.equipment.length) {
    prompt(s, target.id, "hermit-payment", `${cardById(id).title}生效：交出裝備或受到 1 點傷害。`, [{ id: "damage", label: "受到 1 點傷害" }, ...target.equipment.map((e) => ({ id: e.id, label: `交出${cardById(e.card).title}` }))], { giver: giver.id, card: id });
    return;
  }
  let deaths: SHPlayer[] = [];
  if (["blackmail", "greed", "anger", "slap", "spell", "exorcism", "lesson", "bully"].includes(id)) {
    const amount = ["exorcism", "lesson"].includes(id) ? 2 : 1;
    if (applyDamage(s, target, amount, { kind: "hermit", card: id })) deaths = [target];
  } else {
    if (target.damage === 0) {
      if (applyDamage(s, target, 1, { kind: "hermit", card: id })) deaths = [target];
    } else heal(s, target, 1);
  }
  finishDeaths(s, deaths, giver, false, "area");
}
function attackDamage(attacker: SHPlayer, raw: number) {
  if (!raw) return 0;
  let amount = raw;
  for (const id of ["butcher-knife", "chainsaw", "rusted-axe"]) if (has(attacker, id)) amount++;
  if (has(attacker, "holy-robe")) amount = Math.max(0, amount - 1);
  if (attacker.revealed && character(attacker).faction === "hunter" && has(attacker, "spear-of-longinus")) amount += 2;
  return amount;
}
function performAttack(s: SHState, attacker: SHPlayer, chosen: SHPlayer, random: Random, isCounter = false) {
  const diceType = has(attacker, "masamune") || (attacker.revealed && !attacker.abilityDisabled && attacker.character === "valkyrie") ? "d4" : "both";
  const dice = roll(s, random, isCounter ? "反擊" : "攻擊", diceType);
  const raw = diceType === "d4" ? dice.d4 : Math.abs(dice.d6 - dice.d4);
  const amount = attackDamage(attacker, raw);
  const targets = has(attacker, "machine-gun") && !isCounter ? attackTargets(s, attacker) : [chosen];
  if (!isCounter && attacker.character === "bob" && attacker.revealed && !attacker.abilityDisabled && !attacker.abilityUsed && s.players.length <= 6 && amount >= 2 && chosen.equipment.length && targets.length === 1) {
    prompt(s, attacker.id, "bob", `要對 ${chosen.name} 造成 ${amount} 點傷害，或改偷一件裝備？`, [{ id: "damage", label: `造成 ${amount} 點傷害` }, ...chosen.equipment.map((e) => ({ id: e.id, label: `偷取${cardById(e.card).title}` }))], { target: chosen.id, amount });
    return;
  }
  const deaths: SHPlayer[] = [];
  let dealt = false;
  for (const target of targets) {
    const before = target.damage;
    if (applyDamage(s, target, amount, { kind: "attack", attacker: attacker.id })) deaths.push(target);
    if (target.damage > before) dealt = true;
  }
  if (dealt && attacker.revealed && !attacker.abilityDisabled && attacker.character === "vampire") heal(s, attacker, 2);
  finishDeaths(s, deaths, attacker, true, "turn");
  if (!deaths.length && !checkWin(s) && !isCounter && chosen.alive && chosen.character === "werewolf" && !chosen.abilityDisabled) {
    prompt(s, chosen.id, "counter", `${attacker.name} 攻擊了你。要公開身分並反擊嗎？`, [{ id: "counter", label: "公開並反擊" }, { id: "skip", label: "不反擊" }], { attacker: attacker.id });
  } else if (!deaths.length && !isCounter && attacker.alive && chosen.alive && attacker.character === "charles" && !attacker.abilityDisabled) {
    prompt(s, attacker.id, "charles", `要受到 2 點傷害，再攻擊 ${chosen.name} 一次嗎？`, [{ id: "again", label: "公開身分並再次攻擊" }, { id: "skip", label: "結束攻擊" }], { target: chosen.id });
  }
}
function canUseAbility(s: SHState, p: SHPlayer) {
  if (!p.alive || !p.revealed || p.abilityDisabled) return false;
  if (p.character === "allie") return !p.abilityUsed;
  if (p.character === "david")
    return !p.abilityUsed && (["white", "black"] as SHDeck[]).some((deck) => s.discards[deck].some((e) => cardById(e.card).type === "equipment"));
  if (p.id !== s.current) return false;
  if (s.phase === "move" && ["agnes", "catherine", "ellen", "franklin", "fu-ka", "george", "ultra-soul"].includes(p.character))
    return !p.abilityUsed || ["catherine", "ultra-soul"].includes(p.character);
  return s.phase === "attack" && s.pending?.kind === "turn-end" && !p.abilityUsed && ["gregor", "wight"].includes(p.character);
}
function useAbility(s: SHState, p: SHPlayer, random: Random) {
  assert(canUseAbility(s, p), "目前不能使用角色能力");
  if (p.character === "allie") { p.abilityUsed = true; heal(s, p, p.damage); }
  else if (p.character === "agnes") { p.abilityUsed = true; p.agnesSide = "left"; log(s, `${p.name} 改變了自己的勝利條件。`); }
  else if (p.character === "catherine") heal(s, p, 1);
  else if (p.character === "david") {
    const returnPrompt = s.pending ? structuredClone(s.pending) : null;
    const equipment = (["white", "black"] as SHDeck[]).flatMap((deck) => s.discards[deck].filter((e) => cardById(e.card).type === "equipment"));
    assert(equipment.length, "棄牌堆沒有裝備");
    prompt(s, p.id, "grave-digger", "從棄牌堆選擇一件裝備。", equipment.map((e) => ({ id: e.id, label: cardById(e.card).title })), { returnPrompt });
    return;
  } else if (["ellen", "franklin", "fu-ka", "george"].includes(p.character)) {
    prompt(s, p.id, "ability-target", character(p).ability, s.players.filter((x) => x.alive && x.id !== p.id).map((x) => ({ id: x.id, label: x.name })), { ability: p.character });
    return;
  } else if (p.character === "ultra-soul") {
    const targets = s.players.filter((x) => x.alive && x.id !== p.id && x.location === "underworld-gate");
    assert(targets.length, "冥界之門沒有其他角色");
    prompt(s, p.id, "ability-target", character(p).ability, targets.map((x) => ({ id: x.id, label: x.name })), { ability: p.character });
    return;
  } else if (p.character === "gregor") { p.abilityUsed = true; p.barrier = true; log(s, `${p.name} 啟動幽靈屏障。`); }
  else if (p.character === "wight") { p.abilityUsed = true; p.extraTurns += s.deathOrder.flat().length; log(s, `${p.name} 獲得 ${s.deathOrder.flat().length} 個額外回合。`); }
  void random;
}

function choose(s: SHState, id: string, random: Random) {
  const q = s.pending!;
  assert(q.options.some((o) => o.id === id), "選項不存在");
  const actor = player(s, q.actor);
  if (q.kind === "move") {
    assert(id.startsWith("teleport:"), "移動擲骰必須使用 roll 操作");
    moveTo(s, id.slice(9));
  } else if (q.kind === "move-result") moveTo(s, id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);
  else if (q.kind === "area") id === "use" ? areaAction(s, random) : beginAttack(s);
  else if (q.kind === "choose-deck") resolveDraw(s, actor, id as SHDeck, random);
  else if (q.kind === "woods") {
    const [effect, targetId] = id.split(":");
    const target = player(s, targetId);
    if (effect === "heal") { heal(s, target, 1); continueAfter(s, "area"); }
    else {
      const died = has(target, "fortune-brooch") ? false : applyDamage(s, target, 2, { kind: "area" });
      finishDeaths(s, died ? [target] : [], actor, false, "area");
    }
  } else if (["altar", "steal"].includes(q.kind)) {
    const [fromId, equipmentId] = id.split(":");
    const from = player(s, fromId);
    const index = from.equipment.findIndex((e) => e.id === equipmentId);
    assert(index >= 0, "裝備不存在");
    actor.equipment.push(from.equipment.splice(index, 1)[0]);
    log(s, `${actor.name} 從 ${from.name} 取得一件裝備。`);
    continueAfter(s, (q.data.after as After) || "area");
  } else if (q.kind === "card-confirm") {
    if (id === "use") { reveal(s, actor); heal(s, actor, actor.damage); }
    continueAfter(s, "area");
  } else if (q.kind === "card-target") {
    const target = player(s, id);
    const effect = q.data.effect as string;
    let deaths: SHPlayer[] = [];
    if (effect === "blessing") { const dice = roll(s, random, "祝福", "d6"); heal(s, target, dice.d6); }
    else if (effect === "first-aid") { target.damage = 7; if (target.damage >= character(target).maxHp && applyDamage(s, target, 0, { kind: "white" })) deaths = [target]; log(s, `${target.name} 的傷害被設為 7。`); }
    else if (effect === "spider") {
      if (applyDamage(s, target, 2, { kind: "black", card: "bloodthirsty-spider" })) deaths.push(target);
      if (applyDamage(s, actor, 2, { kind: "black", card: "bloodthirsty-spider" })) deaths.push(actor);
    } else if (effect === "bat") {
      if (applyDamage(s, target, 2, { kind: "black", card: "vampire-bat" })) deaths = [target];
      heal(s, actor, 1);
    } else if (effect === "doll") {
      const dice = roll(s, random, "靈魂娃娃", "d6");
      const victim = dice.d6 <= 4 ? target : actor;
      if (applyDamage(s, victim, 3, { kind: "black", card: "spiritual-doll" })) deaths = [victim];
    }
    finishDeaths(s, deaths, actor, false, "area");
  } else if (q.kind === "hermit-target") {
    const target = player(s, id);
    const instance = q.data.instance as unknown as SHCardInstance;
    const matches = hermitMatches(instance.card, target);
    if (target.character === "unknown" && instance.card !== "prediction")
      prompt(s, target.id, "hermit-unknown", `${cardById(instance.card).title}：選擇要宣告的結果。`, [
        { id: "honest", label: "照實處理" },
        { id: "trigger", label: "讓效果生效" },
        { id: "nothing", label: "宣告無事發生" },
      ], { giver: actor.id, instance });
    else resolveHermit(s, actor, target, instance, matches);
  } else if (q.kind === "hermit-unknown") {
    const giver = player(s, q.data.giver as string);
    const instance = q.data.instance as unknown as SHCardInstance;
    const trigger = id === "honest" ? hermitMatches(instance.card, actor) : id === "trigger";
    resolveHermit(s, giver, actor, instance, trigger);
  } else if (q.kind === "hermit-payment") {
    const giver = player(s, q.data.giver as string);
    if (id === "damage") {
      const died = applyDamage(s, actor, 1, { kind: "hermit", card: q.data.card as string });
      finishDeaths(s, died ? [actor] : [], giver, false, "area");
    } else {
      const index = actor.equipment.findIndex((e) => e.id === id);
      assert(index >= 0, "裝備不存在");
      giver.equipment.push(actor.equipment.splice(index, 1)[0]);
      continueAfter(s, "area");
    }
  } else if (q.kind === "banana-equipment") {
    const equipment = actor.equipment.find((e) => e.id === id)!;
    prompt(s, actor.id, "banana-target", "選擇接收裝備的角色。", s.players.filter((x) => x.alive && x.id !== actor.id).map((x) => ({ id: x.id, label: x.name })), { equipment: equipment.id });
  } else if (q.kind === "banana-target") {
    const index = actor.equipment.findIndex((e) => e.id === q.data.equipment);
    player(s, id).equipment.push(actor.equipment.splice(index, 1)[0]);
    continueAfter(s, "area");
  } else if (q.kind === "attack") {
    if (id === "skip") finishTurn(s); else performAttack(s, actor, player(s, id), random);
  } else if (q.kind === "bob") {
    const target = player(s, q.data.target as string);
    if (id === "damage") {
      const died = applyDamage(s, target, q.data.amount as number, { kind: "attack", attacker: actor.id });
      finishDeaths(s, died ? [target] : [], actor, true, "turn");
    } else {
      const index = target.equipment.findIndex((e) => e.id === id);
      actor.equipment.push(target.equipment.splice(index, 1)[0]);
      actor.abilityUsed = true;
      continueAfter(s, "turn");
    }
  } else if (q.kind === "counter") {
    if (id === "counter") { reveal(s, actor); performAttack(s, actor, player(s, q.data.attacker as string), random, true); }
    else finishTurn(s);
  } else if (q.kind === "charles") {
    if (id === "skip") finishTurn(s);
    else {
      reveal(s, actor);
      const died = applyDamage(s, actor, 2, { kind: "ability" });
      if (died) finishDeaths(s, [actor], actor, false, "turn");
      else performAttack(s, actor, player(s, q.data.target as string), random);
    }
  } else if (q.kind === "turn-end") {
    if (id === "ability") useAbility(s, actor, random);
    if (!checkWin(s)) nextTurn(s);
  } else if (q.kind === "grave-digger") {
    for (const deck of ["white", "black"] as SHDeck[]) {
      const index = s.discards[deck].findIndex((e) => e.id === id);
      if (index >= 0) actor.equipment.push(s.discards[deck].splice(index, 1)[0]);
    }
    actor.abilityUsed = true;
    if (!checkWin(s)) s.pending = q.data.returnPrompt as unknown as SHPending | null;
  } else if (q.kind === "ability-target") {
    const target = player(s, id);
    const ability = q.data.ability as string;
    actor.abilityUsed = !["ultra-soul"].includes(ability);
    if (ability === "ellen") { target.abilityDisabled = true; target.barrier = false; }
    else if (ability === "fu-ka") {
      target.damage = 7;
      const died = target.damage >= character(target).maxHp && markDead(s, target);
      if (died) {
        finishDeaths(s, [target], actor, false, "none");
        if (s.phase === "finished") return;
      }
    }
    else {
      const dice = ability === "franklin" ? roll(s, random, "雷擊", "d6").d6 : ability === "george" ? roll(s, random, "破壞", "d4").d4 : 3;
      const died = applyDamage(s, target, dice, { kind: "ability", attacker: actor.id });
      if (died) recordDeaths(s, [target], actor, false);
    }
    if (!checkWin(s)) startTurnPromptPreserving(s, actor);
  } else if (q.kind === "loot") resolveLoot(s, id, random);
}
function startTurnPromptPreserving(s: SHState, actor: SHPlayer) {
  const opts = [{ id: "roll", label: "擲 D4 + D6 移動" }];
  if (actor.revealed && !actor.abilityDisabled && actor.character === "emi" && actor.location) {
    const index = s.areas.findIndex((a) => a.id === actor.location);
    for (const offset of [-1, 1]) {
      const area = s.areas[(index + offset + s.areas.length) % s.areas.length];
      opts.push({ id: `teleport:${area.id}`, label: `瞬移到${area.name}` });
    }
  }
  prompt(s, actor.id, "move", "移動是每回合的必要行動。", opts);
}

export const shadowHunters: GameDefinition<SHState, SHAction, SHView> = {
  info: {
    id: "shadow-hunters",
    name: "暗影獵人",
    rulesVersion: "zman-2016-plus10-v1",
    minPlayers: 4,
    maxPlayers: 8,
    description: "隱藏身分、試探盟友，在迷霧森林裡活到自己的勝利條件成真。",
    firstPlayerPolicy: "random",
  },
  initialize(seats: Seat[], first, random) {
    assert(seats.length >= 4 && seats.length <= 8 && new Set(seats.map((p) => p.id)).size === seats.length, "需要 4–8 位不同玩家");
    assert(seats.some((p) => p.id === first), "先手玩家不存在");
    const initials = [...new Set(CHARACTERS.map((c) => c.initial))];
    const selected = initials.map((initial) => {
      const pair = CHARACTERS.filter((c) => c.initial === initial);
      return pair[random(pair.length)];
    });
    const counts = ({ 4: [2, 2, 0], 5: [2, 2, 1], 6: [2, 2, 2], 7: [2, 2, 3], 8: [3, 3, 2] } as Record<number, number[]>)[seats.length];
    const dealt = shuffle([
      ...shuffle(selected.filter((c) => c.faction === "hunter"), random).slice(0, counts[0]),
      ...shuffle(selected.filter((c) => c.faction === "shadow"), random).slice(0, counts[1]),
      ...shuffle(selected.filter((c) => c.faction === "neutral"), random).slice(0, counts[2]),
    ], random);
    assert(dealt.length === seats.length, "角色配置不足");
    const state: SHState = {
      rulesVersion: this.info.rulesVersion,
      players: seats.map((seat, i) => ({ ...seat, character: dealt[i].id, damage: 0, alive: true, revealed: false, location: null, equipment: [], abilityUsed: false, abilityDisabled: false, guardian: false, barrier: false, agnesSide: "right", extraTurns: 0, winQualified: false })),
      areas: shuffle(AREAS, random).map((area, i) => ({ ...area, rolls: [[2, 3], [4, 5], [6], [8], [9], [10]][i] })),
      decks: { white: cardInstances("white", random), black: cardInstances("black", random), hermit: cardInstances("hermit", random) },
      discards: { white: [], black: [], hermit: [] },
      current: first,
      phase: "move",
      pending: null,
      promptSequence: 0,
      lastRoll: null,
      deathOrder: [],
      winners: [],
      logs: [],
    };
    startTurn(state);
    return state;
  },
  legalActions(state, id) {
    const p = state.players.find((x) => x.id === id);
    return {
      canReveal: !!p && p.alive && !p.revealed && p.character !== "daniel" && state.phase !== "finished",
      canUseAbility: !!p && canUseAbility(state, p),
      ...(state.pending?.actor === id ? { pending: { id: state.pending.id, kind: state.pending.kind, text: state.pending.text, options: state.pending.options } } : {}),
    };
  },
  parseAction(input) { return actionSchema.parse(input); },
  transition(state, id, action, random) {
    assert(state.rulesVersion === this.info.rulesVersion, "不支援此規則版本");
    assert(state.phase !== "finished", "遊戲已結束");
    const s = structuredClone(state);
    const p = player(s, id);
    if (action.type === "reveal") {
      assert(this.legalActions(s, id) && p.alive && !p.revealed && p.character !== "daniel", "目前不能公開身分");
      reveal(s, p);
      return s;
    }
    if (action.type === "ability") {
      useAbility(s, p, random);
      checkWin(s);
      return s;
    }
    assert(s.pending && s.pending.actor === id, "目前不是由你決定");
    assert(action.promptId === s.pending.id, "操作提示已過期");
    if (action.type === "roll") {
      assert(["move", "reroll", "compass-roll"].includes(s.pending.kind) && s.pending.options.some((o) => o.id === "roll"), "目前不需擲骰");
      resolveMovementRoll(s, p, random, (s.pending.data.results as number[] | undefined) || []);
    } else choose(s, action.optionId, random);
    return s;
  },
  playerView(s, id) {
    return {
      rulesVersion: s.rulesVersion,
      players: s.players.map((p) => {
        const visible = p.id === id || p.revealed || s.phase === "finished";
        const c = character(p);
        const { character: _hidden, winQualified: _qualified, agnesSide: _side, ...publicPlayer } = p;
        return { ...publicPlayer, maxHp: visible ? c.maxHp : undefined, ...(visible ? { character: c, faction: c.faction } : {}) };
      }),
      areas: s.areas,
      deckCounts: { white: s.decks.white.length, black: s.decks.black.length, hermit: s.decks.hermit.length },
      discardCounts: { white: s.discards.white.length, black: s.discards.black.length, hermit: s.discards.hermit.length },
      current: s.current,
      phase: s.phase,
      lastRoll: s.lastRoll,
      winners: s.winners,
      logs: s.logs.filter((l) => !l.recipients || l.recipients.includes(id)).map((l) => ({ text: l.text })),
      legal: this.legalActions(s, id) as SHLegal,
    };
  },
  spectatorView(s) {
    return this.playerView(s, "");
  },
  result(s) {
    return s.phase === "finished" ? { scores: Object.fromEntries(s.players.map((p) => [p.id, s.winners.includes(p.id) ? 1 : 0])), winners: s.winners } : null;
  },
};
