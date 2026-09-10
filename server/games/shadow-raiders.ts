import { z } from "zod";
import type { GameDefinition, Seat } from "../../shared/game.js";
import {
  SR_AIRSHIP,
  SR_CARDS,
  SR_CHARACTERS,
  SR_OUTER_AREAS,
  SR_RULES_VERSION,
  srCardById,
  srCharacterById,
  type SRAction,
  type SRCardInstance,
  type SRDeck,
  type SRLegal,
  type SRPending,
  type SRPlayer,
  type SRState,
  type SRView,
} from "../../shared/shadow-raiders.js";

type Random = (max: number) => number;
type After = "area" | "turn" | "attack" | "none";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll"), promptId: z.string().max(50) }).strict(),
  z.object({ type: z.literal("choose"), promptId: z.string().max(50), optionId: z.string().max(120) }).strict(),
  z.object({ type: z.literal("ability") }).strict(),
]);

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function shuffle<T>(input: readonly T[], random: Random) {
  const values = [...input];
  for (let i = values.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
function player(s: SRState, id: string) { const p = s.players.find((x) => x.id === id); assert(p, "玩家不存在"); return p; }
function character(p: SRPlayer) { return srCharacterById(p.character); }
function has(p: SRPlayer, card: string) { return p.equipment.some((e) => e.card === card); }
function count(p: SRPlayer, card: string) { return p.equipment.filter((e) => e.card === card).length; }
function log(s: SRState, text: string, recipients?: string[]) {
  s.logs.push({ text, ...(recipients ? { recipients } : {}) });
  s.logs = s.logs.slice(-300);
}
function prompt(s: SRState, actor: string, kind: string, text: string, options: { id: string; label: string }[], data: Record<string, unknown> = {}) {
  assert(options.length, "提示沒有選項");
  s.pending = { id: `sr-${++s.promptSequence}`, actor, kind, text, options, data };
}
function roll(s: SRState, random: Random, purpose: string, dice: "both" | "d4" | "d6" = "both") {
  const d4 = dice === "d6" ? 0 : random(4) + 1;
  const d6 = dice === "d4" ? 0 : random(6) + 1;
  s.lastRoll = { d4, d6, purpose };
  return { d4, d6 };
}
function instances(deck: SRDeck, random: Random) {
  let n = 0;
  return shuffle(SR_CARDS.filter((c) => c.deck === deck).flatMap((c) =>
    Array.from({ length: c.count }, () => ({ id: `sr-${deck}-${n++}`, card: c.id }))), random);
}
function draw(s: SRState, deck: SRDeck, random: Random) {
  if (!s.decks[deck].length) {
    s.decks[deck] = shuffle(s.discards[deck], random);
    s.discards[deck] = [];
  }
  const card = s.decks[deck].shift();
  assert(card, "牌堆中沒有牌");
  return card;
}
function discard(s: SRState, card: SRCardInstance) { s.discards[srCardById(card.card).deck].push(card); }
function reveal(s: SRState, p: SRPlayer) {
  if (!p.revealed) {
    p.revealed = true;
    const f = character(p).faction === "raider" ? "奇襲者" : character(p).faction === "shadow" ? "暗影" : "市民";
    log(s, `${p.name} 公開身分：${character(p).name}（${f}）。`);
  }
}
function markDead(s: SRState, p: SRPlayer) {
  if (!p.alive) return false;
  p.alive = false;
  p.revealed = true;
  p.location = null;
  p.guardian = false;
  p.barrier = false;
  log(s, `${p.name}（${character(p).name}）死亡。`);
  return true;
}
type DamageSource = { kind: "attack" | "black" | "white" | "reasoning" | "area" | "ability"; card?: string; attacker?: string };
function damage(s: SRState, target: SRPlayer, amount: number, source: DamageSource) {
  if (!target.alive || amount <= 0) return false;
  if (target.barrier) amount = 0;
  if (source.kind === "attack" && target.guardian) amount = 0;
  if (source.kind === "attack" && has(target, "sage-robe")) amount = Math.max(0, amount - 1);
  if (source.kind === "black" && source.card && ["black-dog", "bloodthirsty-spider", "vampire-bat", "cursed-doll"].includes(source.card) && has(target, "holy-grail")) amount = 0;
  if (source.kind === "area" && has(target, "lucky-brooch")) amount = 0;
  if (!amount) { log(s, `${target.name} 擋下了傷害。`); return false; }
  target.damage = Math.min(character(target).maxHp, target.damage + amount);
  log(s, `${target.name} 受到 ${amount} 點傷害。`);
  return target.damage >= character(target).maxHp ? markDead(s, target) : false;
}
function heal(s: SRState, p: SRPlayer, amount: number) {
  const before = p.damage;
  p.damage = Math.max(0, p.damage - amount);
  log(s, `${p.name} 治療 ${before - p.damage} 點傷害。`);
}

export function raiderAttackAreaIds(s: Pick<SRState, "areas">, attacker: Pick<SRPlayer, "location" | "equipment">) {
  if (!attacker.location) return [];
  if (attacker.location === "airship") return s.areas.map((a) => a.id);
  const outer = s.areas.filter((a) => !a.airship);
  const own = outer.findIndex((a) => a.id === attacker.location);
  if (own < 0) return [];
  const reach = 1 + attacker.equipment.filter((e) => e.card === "death-scope").length;
  const ids = new Set(["airship", attacker.location]);
  for (let step = 1; step <= reach; step++) ids.add(outer[(own - step + outer.length) % outer.length].id);
  return [...ids];
}
function attackTargets(s: SRState, attacker: SRPlayer) {
  const ids = new Set(raiderAttackAreaIds(s, attacker));
  return s.players.filter((p) => p.alive && p.id !== attacker.id && !!p.location && ids.has(p.location));
}
function outerForRoll(s: SRState, total: number) { return s.areas.find((a) => !a.airship && a.rolls.includes(total)); }
function movementOptions(s: SRState, p: SRPlayer, total: number, prefix = "") {
  const base = total === 10 ? s.areas.find((a) => a.airship) : outerForRoll(s, total);
  assert(base, "骰值沒有對應地點");
  const areas = [base];
  if (!p.abilityDisabled && p.character === "emi" && !base.airship) {
    const outer = s.areas.filter((a) => !a.airship);
    const index = outer.findIndex((a) => a.id === base.id);
    areas.push(outer[(index - 1 + outer.length) % outer.length], outer[(index + 1) % outer.length]);
  }
  return [...new Map(areas.map((a) => [a.id, a])).values()].map((a) => ({
    id: `${prefix ? `${prefix}:` : ""}${a.id === base.id ? a.id : `emi:${a.id}`}`,
    label: `${prefix ? `${prefix}：` : ""}${a.name}${a.id === base.id ? `（${total}）` : "（艾蜜）"}`,
  }));
}
function resolveMovementRoll(s: SRState, p: SRPlayer, random: Random, previous: number[] = []) {
  const dice = roll(s, random, "移動");
  const total = dice.d4 + dice.d6;
  const results = [...previous, total];
  if (has(p, "mystic-compass") && results.length < 2) {
    prompt(s, p.id, "compass-roll", "神祕羅盤：再擲一次後選擇結果。", [{ id: "roll", label: "再次擲 D4 + D6" }], { results });
    return;
  }
  if (results.length === 1) {
    const options = movementOptions(s, p, total);
    if (options.length === 1) moveTo(s, options[0].id);
    else prompt(s, p.id, "move-result", "選擇擲骰結果或艾蜜的相鄰地點。", options);
    return;
  }
  prompt(s, p.id, "move-result", "神祕羅盤：選擇一次移動結果。", results.flatMap((value, i) => movementOptions(s, p, value, i ? "第二次" : "第一次")));
}
function startTurn(s: SRState) {
  const p = player(s, s.current);
  p.guardian = false;
  p.barrier = false;
  p.attacksRemaining = p.character === "ulster" && !p.abilityDisabled ? 2 : 1;
  p.extraAttackUsed = false;
  p.turnAbilityUsed = false;
  s.phase = "move";
  const options = [{ id: "roll", label: "擲 D4 + D6 移動" }];
  if (p.location === "airship") s.areas.filter((a) => !a.airship).forEach((a) => options.push({ id: `leave:${a.id}`, label: `直接前往${a.name}` }));
  prompt(s, p.id, "move", p.location === "airship" ? "可擲骰，或直接離開飛行船前往任一外圍地點。" : "移動是每回合的必要行動。", options);
  log(s, `輪到 ${p.name}。`);
}
function moveTo(s: SRState, areaId: string) {
  const p = player(s, s.current);
  const area = s.areas.find((a) => a.id === areaId);
  assert(area, "地點不存在");
  p.location = area.id;
  log(s, `${p.name} 移動到${area.name}。`);
  if (area.airship) { beginAttack(s); return; }
  s.phase = "area";
  prompt(s, p.id, "area", `${area.name}：${area.text}`, [{ id: "use", label: "執行地點行動" }, { id: "skip", label: "略過地點行動" }]);
}
function beginAttack(s: SRState) {
  if (s.phase === "finished") return;
  s.phase = "attack";
  const p = player(s, s.current);
  const targets = attackTargets(s, p);
  const options = targets.map((t) => ({ id: t.id, label: `攻擊 ${t.name}` }));
  if (has(p, "rainbow-parasol") && targets.length) options.push({ id: "parasol", label: "用彩虹陽傘改抽推理牌" });
  if (!has(p, "masamune") || !targets.length) options.push({ id: "skip", label: "不攻擊" });
  prompt(s, p.id, "attack", targets.length ? `選擇攻擊目標（剩餘 ${p.attacksRemaining} 次）。` : "目前沒有可攻擊角色。", options);
}
function nextTurn(s: SRState) {
  const current = player(s, s.current);
  if (current.extraTurns > 0) current.extraTurns--;
  else {
    let index = s.players.indexOf(current);
    do index = (index + 1) % s.players.length; while (!s.players[index].alive);
    s.current = s.players[index].id;
  }
  startTurn(s);
}
function finishTurn(s: SRState) {
  if (s.phase === "finished") return;
  const p = player(s, s.current);
  if (!p.alive) { if (!checkWin(s)) nextTurn(s); return; }
  const options = [{ id: "end", label: "結束回合" }];
  if (canUseAbility(s, p)) options.unshift({ id: "ability", label: `使用${character(p).ability.split("：")[0]}` });
  prompt(s, p.id, "turn-end", "確認回合結束。", options);
}

function recordDeaths(s: SRState, deaths: SRPlayer[], killer?: SRPlayer, byAttack = false) {
  if (!deaths.length) return;
  const before = s.deathOrder.flat().length;
  s.deathOrder.push(deaths.map((p) => p.id));
  for (const d of deaths) if (["daniel", "carol"].includes(d.character) && before === 0) d.winQualified = true;
  for (const p of s.players) if (p.alive && p.character === "daniel" && deaths.some((d) => d.id !== p.id)) reveal(s, p);
  if (killer && byAttack) {
    if (killer.character === "bruce") {
      if (deaths.some((d) => character(d).maxHp >= 12)) killer.winQualified = true;
      if (deaths.some((d) => character(d).maxHp <= 11)) reveal(s, killer);
    }
    if (killer.character === "craig" && before >= 2) killer.winQualified = true;
  }
}
function directNeutralWinners(s: SRState) {
  const alive = s.players.filter((p) => p.alive);
  return s.players.filter((p) => {
    if (character(p).faction !== "citizen") return false;
    if (p.winQualified || (p.changedWinToDeath && !p.alive)) return true;
    if (p.character === "bylon") return p.equipment.length >= 5;
    if (p.character === "benjamin") return s.players.some((x) => x.id !== p.id && x.equipment.length >= 5);
    if (p.character === "david") return ["holy-grail", "mystic-compass", "lucky-brooch", "silver-rosary"].filter((id) => has(p, id)).length >= 3;
    if (p.character === "carol") return p.alive && alive.length <= 2;
    return false;
  });
}
function checkWin(s: SRState) {
  const raidersDead = s.players.filter((p) => character(p).faction === "raider").every((p) => !p.alive);
  const shadowsDead = s.players.filter((p) => character(p).faction === "shadow").every((p) => !p.alive);
  const citizenDeaths = s.players.filter((p) => character(p).faction === "citizen" && !p.alive).length;
  const maxDamage = Math.max(...s.players.map((p) => p.damage));
  const ids = new Set(directNeutralWinners(s).map((p) => p.id));
  if (shadowsDead) s.players.filter((p) => character(p).faction === "raider").forEach((p) => ids.add(p.id));
  if (raidersDead || citizenDeaths >= 3) s.players.filter((p) => character(p).faction === "shadow").forEach((p) => ids.add(p.id));
  if (!ids.size) return false;
  for (const p of s.players) {
    if (p.character === "alice" && p.alive) ids.add(p.id);
    if (p.character === "agatha" && p.id === s.current) ids.add(p.id);
    if (p.character === "bruce" && p.location === "oliver-hideout") ids.add(p.id);
    if (p.character === "daniel" && p.alive && shadowsDead) ids.add(p.id);
    if (p.character === "claire" && p.damage >= 6 && p.damage <= 8) ids.add(p.id);
    if (p.character === "deborah" && s.players.length === 5 && p.damage === maxDamage) ids.add(p.id);
  }
  for (const p of s.players) if (p.character === "deborah" && s.players.length >= 6 && s.players.some((x) => x.id !== p.id && character(x).faction === "citizen" && ids.has(x.id))) ids.add(p.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      if (p.character !== "angela" || ids.has(p.id)) continue;
      const offset = p.neighborSide === "right" ? -1 : 1;
      if (ids.has(s.players[(i + offset + s.players.length) % s.players.length].id)) { ids.add(p.id); changed = true; }
    }
  }
  s.winners = [...ids];
  s.phase = "finished";
  s.pending = null;
  s.players.forEach((p) => (p.revealed = true));
  log(s, `${s.players.filter((p) => ids.has(p.id)).map((p) => p.name).join("、")} 獲勝。`);
  return true;
}
function continueAfter(s: SRState, after: After) {
  if (checkWin(s)) return;
  if (after === "area") beginAttack(s);
  else if (after === "attack") afterAttack(s);
  else if (after === "turn") finishTurn(s);
}
function discardVictim(s: SRState, victim: SRPlayer) { victim.equipment.splice(0).forEach((e) => discard(s, e)); }
function finishDeaths(s: SRState, deaths: SRPlayer[], killer: SRPlayer | undefined, byAttack: boolean, after: After, attackTarget?: string) {
  recordDeaths(s, deaths, killer, byAttack);
  const godwin = deaths.find((d) => d.character === "godwin" && !d.abilityDisabled);
  const priorDead = s.players.filter((p) => !p.alive && p.id !== godwin?.id && !deaths.includes(p));
  if (godwin && priorDead.length) {
    prompt(s, godwin.id, "godwin", "復活一名先前死亡的角色。", priorDead.map((p) => ({ id: p.id, label: `${p.name}（${character(p).name}）` })), { deaths: deaths.map((d) => d.id), killer: killer?.id, byAttack, after, attackTarget });
    return;
  }
  finishDeathLoot(s, deaths, killer, byAttack, after, attackTarget);
}
function finishDeathLoot(s: SRState, deaths: SRPlayer[], killer: SRPlayer | undefined, byAttack: boolean, after: After, attackTarget?: string) {
  const victims = byAttack && killer?.alive ? deaths.filter((d) => d.id !== killer.id && d.equipment.length).map((d) => d.id) : [];
  deaths.filter((d) => !victims.includes(d.id)).forEach((d) => discardVictim(s, d));
  if (killer && victims.length) { beginLoot(s, killer, victims, after, attackTarget); return; }
  if (after === "attack") afterAttack(s, attackTarget); else continueAfter(s, after);
}
function beginLoot(s: SRState, killer: SRPlayer, victims: string[], after: After, attackTarget?: string) {
  if (!victims.length) { if (after === "attack") afterAttack(s, attackTarget); else continueAfter(s, after); return; }
  const victim = player(s, victims[0]);
  if (has(killer, "silver-rosary")) {
    killer.equipment.push(...victim.equipment.splice(0));
    log(s, `${killer.name} 取得 ${victim.name} 的全部裝備。`);
    beginLoot(s, killer, victims.slice(1), after, attackTarget);
    return;
  }
  prompt(s, killer.id, "loot", `從 ${victim.name} 的遺物選一件裝備。`, victim.equipment.map((e) => ({ id: e.id, label: srCardById(e.card).title })), { victims, after, attackTarget });
}
function completeAttack(s: SRState) {
  if (checkWin(s)) return;
  const attacker = player(s, s.current);
  if (!attacker.alive) { finishTurn(s); return; }
  attacker.attacksRemaining--;
  if (attacker.attacksRemaining > 0) { if (attacker.character === "ulster" && !attacker.abilityDisabled) reveal(s, attacker); beginAttack(s); } else finishTurn(s);
}
function afterAttack(s: SRState, attackedId?: string) {
  const attacker = player(s, s.current);
  const attacked = attackedId ? player(s, attackedId) : undefined;
  if (attacked?.alive && attacked.character === "werewolf" && !attacked.abilityDisabled && attacker.alive) {
    prompt(s, attacked.id, "counter", `反擊 ${attacker.name}？`, [{ id: "counter", label: "立刻反擊" }, { id: "skip", label: "不反擊" }], { attacker: attacker.id });
    return;
  }
  if (attacker.alive && attacker.character === "craig" && !attacker.abilityDisabled && !attacker.extraAttackUsed && attacked?.alive) {
    prompt(s, attacker.id, "craig", "受到 2 點傷害，再攻擊同一目標一次？", [{ id: "attack", label: "發動血宴" }, { id: "skip", label: "不發動" }], { target: attacked.id });
    return;
  }
  completeAttack(s);
}

function resolveAttackRoll(s: SRState, attacker: SRPlayer, chosen: SRPlayer, random: Random, isCounter = false) {
  const die = attacker.character === "vendetta" || has(attacker, "masamune") ? "d4" : "both";
  const dice = roll(s, random, "攻擊", die);
  const failed = die === "both" && dice.d4 === dice.d6;
  if (failed && attacker.character === "galahad" && !attacker.abilityDisabled && has(attacker, "excalibur")) {
    reveal(s, attacker);
    prompt(s, attacker.id, "galahad", "王者之劍：攻擊失敗，必須重擲。", [{ id: "roll", label: "重新擲攻擊骰" }], { target: chosen.id, isCounter });
    return;
  }
  const base = die === "d4" ? dice.d4 : Math.abs(dice.d4 - dice.d6);
  let amount = failed ? 0 : base;
  if (amount) {
    amount += ["handgun", "saber", "crossbow"].reduce((n, id) => n + count(attacker, id), 0);
    if (has(attacker, "sage-robe")) amount = Math.max(0, amount - 1);
    if (attacker.revealed && character(attacker).faction === "raider" && has(attacker, "excalibur")) amount += 2;
    if (attacker.character === "freddie" && !attacker.abilityDisabled && chosen.revealed) { reveal(s, attacker); amount += 2; }
  }
  const targets = has(attacker, "gatling") && !isCounter ? attackTargets(s, attacker) : [chosen];
  if (amount >= 2 && attacker.character === "bylon" && !attacker.abilityDisabled && targets.some((t) => t.equipment.length)) {
    prompt(s, attacker.id, "bylon-mode", "掠奪：選擇對所有目標造成傷害，或改從每名有裝備的目標取得一件。", [{ id: "damage", label: `造成 ${amount} 點傷害` }, { id: "steal", label: "改為取得裝備" }], { targets: targets.map((t) => t.id), amount, chosen: chosen.id });
    return;
  }
  applyAttack(s, attacker, targets, amount, chosen.id, isCounter);
}
function applyAttack(s: SRState, attacker: SRPlayer, targets: SRPlayer[], amount: number, chosenId: string, isCounter = false) {
  const deaths = targets.filter((t) => damage(s, t, amount, { kind: "attack", attacker: attacker.id }));
  if (amount > 0 && attacker.character === "vampire" && !attacker.abilityDisabled) { reveal(s, attacker); heal(s, attacker, 2); }
  const venom = targets.find((t) => t.alive && t.character === "venom" && !t.abilityDisabled && attacker.alive);
  if (venom) {
    reveal(s, venom);
    prompt(s, attacker.id, "venom", `${venom.name} 的毒牙：受到 1 點傷害或交出裝備。`, [{ id: "damage", label: "受到 1 點傷害" }, ...attacker.equipment.map((e) => ({ id: e.id, label: `交出${srCardById(e.card).title}` }))], { venom: venom.id, deaths: deaths.map((d) => d.id), chosen: chosenId, isCounter });
    return;
  }
  finishDeaths(s, deaths, attacker, true, isCounter ? "turn" : "attack", isCounter ? undefined : chosenId);
}

function areaAction(s: SRState, random: Random) {
  const p = player(s, s.current);
  const area = s.areas.find((a) => a.id === p.location)!;
  if (area.id === "detective-office") resolveDraw(s, p, "reasoning", random);
  else if (area.id === "blackmist") prompt(s, p.id, "choose-deck", "選擇一個牌堆。", [{ id: "white", label: "白牌" }, { id: "black", label: "黑牌" }, { id: "reasoning", label: "推理牌" }]);
  else if (area.id === "cathedral") resolveDraw(s, p, "white", random);
  else if (area.id === "underground") resolveDraw(s, p, "black", random);
  else if (area.id === "town-hall") prompt(s, p.id, "town", "選擇市政廳效果。", s.players.filter((x) => x.alive).flatMap((x) => [{ id: `damage:${x.id}`, label: `${x.name} 受到 2 點傷害` }, { id: `heal:${x.id}`, label: `${x.name} 治療 1 點` }]));
  else {
    const options = s.players.filter((x) => x.alive && x.id !== p.id).flatMap((x) => x.equipment.map((e) => ({ id: `${x.id}:${e.id}`, label: `從 ${x.name} 取得${srCardById(e.card).title}` })));
    if (options.length) prompt(s, p.id, "steal", "選擇要取得的裝備。", options, { after: "area" }); else beginAttack(s);
  }
}
function resolveDraw(s: SRState, p: SRPlayer, deck: SRDeck, random: Random, forcedTargets?: SRPlayer[], after: After = "area") {
  const instance = draw(s, deck, random);
  const card = srCardById(instance.card);
  if (deck === "reasoning") {
    log(s, `${p.name} 抽到一張推理牌。`);
    log(s, `你抽到${card.title}：${card.text}`, [p.id]);
  } else log(s, `${p.name} 抽到${card.title}。`);
  if (card.type === "equipment") { p.equipment.push(instance); log(s, `${p.name} 裝備了${card.title}。`); continueAfter(s, after); return; }
  if (deck === "reasoning") {
    const targets = forcedTargets || s.players.filter((x) => x.alive && x.id !== p.id);
    prompt(s, p.id, "reasoning-target", `推理牌：${card.text}`, targets.map((x) => ({ id: x.id, label: `交給 ${x.name}` })), { instance, after });
    return;
  }
  discard(s, instance);
  resolveSingle(s, p, instance.card, random);
}
function targetPrompt(s: SRState, p: SRPlayer, text: string, effect: string, includeSelf: boolean) {
  prompt(s, p.id, "card-target", text, s.players.filter((x) => x.alive && (includeSelf || x.id !== p.id)).map((x) => ({ id: x.id, label: x.name })), { effect });
}
function resolveSingle(s: SRState, p: SRPlayer, id: string, random: Random) {
  if (["advent", "ritual", "happy-cookie"].includes(id)) {
    const allowed = id === "advent" ? character(p).faction === "raider" : id === "ritual" ? character(p).faction === "shadow" : ["A", "E", "U"].includes(character(p).initial);
    if (allowed) { reveal(s, p); heal(s, p, p.damage); }
    continueAfter(s, "area");
  } else if (id === "mirror") { if (character(p).faction === "shadow") reveal(s, p); continueAfter(s, "area"); }
  else if (id === "blessing") targetPrompt(s, p, "選擇接受祝福的角色。", "blessing", false);
  else if (id === "concealed-knowledge") { p.extraTurns++; continueAfter(s, "area"); }
  else if (id === "guardian-angel") { p.guardian = true; continueAfter(s, "area"); }
  else if (id === "flare") {
    const deaths = s.players.filter((x) => x.alive && x.id !== p.id && damage(s, x, 2, { kind: "white", card: id }));
    finishDeaths(s, deaths, p, false, "area");
  } else if (id === "first-aid") targetPrompt(s, p, "選擇把傷害設為 7 的角色。", "first-aid", true);
  else if (id === "healing-water") { heal(s, p, 2); continueAfter(s, "area"); }
  else if (id === "mermaid-tears") { const max = Math.max(...s.players.filter((x) => x.alive).map((x) => x.damage)); s.players.filter((x) => x.alive && x.damage === max).forEach((x) => heal(s, x, 3)); continueAfter(s, "area"); }
  else if (id === "oliver-servant") {
    const options = s.players.filter((x) => x.alive && x.id !== p.id).flatMap((x) => x.equipment.map((e) => ({ id: `${x.id}:${e.id}`, label: `從 ${x.name} 取得${srCardById(e.card).title}` })));
    if (options.length) prompt(s, p.id, "steal", "選擇要取得的裝備。", options, { after: "area" }); else continueAfter(s, "area");
  } else if (["black-dog", "bloodthirsty-spider"].includes(id)) targetPrompt(s, p, "選擇攻擊的角色。", id, false);
  else if (id === "vampire-bat") targetPrompt(s, p, "選擇吸血蝙蝠的目標。", "vampire-bat", false);
  else if (id === "banana-peel") {
    if (!p.equipment.length) { const died = damage(s, p, 1, { kind: "black", card: id }); finishDeaths(s, died ? [p] : [], p, false, "area"); }
    else prompt(s, p.id, "banana-equipment", "選擇要交出的裝備。", p.equipment.map((e) => ({ id: e.id, label: srCardById(e.card).title })));
  } else if (id === "riot") {
    const dice = roll(s, random, "暴動");
    const area = outerForRoll(s, dice.d4 + dice.d6);
    const deaths = area ? s.players.filter((x) => x.alive && x.location === area.id && damage(s, x, 3, { kind: "black", card: id })) : [];
    finishDeaths(s, deaths, p, false, "area");
  } else if (id === "cursed-doll") targetPrompt(s, p, "選擇詛咒娃娃的目標。", "cursed-doll", false);
  else continueAfter(s, "area");
}
function reasoningMatches(card: string, p: SRPlayer) {
  const faction = character(p).faction;
  if (card === "rc") return faction === "citizen" || faction === "shadow";
  if (card === "rr") return faction === "citizen" || faction === "raider";
  if (card === "rs") return faction === "raider" || faction === "shadow";
  if (["raider-hit", "raider-heal", "raider-airship"].includes(card)) return faction === "raider";
  if (["shadow-hit", "shadow-hit2", "shadow-heal", "shadow-airship"].includes(card)) return faction === "shadow";
  if (["citizen-heal", "citizen-airship"].includes(card)) return faction === "citizen";
  if (card === "low-hit") return character(p).maxHp <= 11;
  if (card === "high-hit") return character(p).maxHp >= 12;
  return true;
}
function resolveReasoning(s: SRState, giver: SRPlayer, target: SRPlayer, card: SRCardInstance, trigger: boolean, after: After = "area") {
  discard(s, card);
  log(s, `你收到${srCardById(card.card).title}：${srCardById(card.card).text}`, [target.id, giver.id]);
  if (!trigger) { log(s, `${target.name} 宣稱沒有發生任何事。`); continueAfter(s, after); return; }
  const id = card.card;
  if (["rc", "rr", "rs"].includes(id)) {
    if (!target.equipment.length) { const died = damage(s, target, 1, { kind: "reasoning", card: id }); finishDeaths(s, died ? [target] : [], giver, false, after); }
    else prompt(s, target.id, "reasoning-payment", "交出一件裝備，或受到 1 點傷害。", [{ id: "damage", label: "受到 1 點傷害" }, ...target.equipment.map((e) => ({ id: e.id, label: `交出${srCardById(e.card).title}` }))], { giver: giver.id, after });
  } else if (["raider-hit", "shadow-hit", "shadow-hit2", "low-hit", "high-hit"].includes(id)) {
    const amount = ["shadow-hit2", "high-hit"].includes(id) ? 2 : 1;
    const died = damage(s, target, amount, { kind: "reasoning", card: id });
    finishDeaths(s, died ? [target] : [], giver, false, after);
  } else if (["citizen-heal", "raider-heal", "shadow-heal"].includes(id)) {
    if (target.damage) heal(s, target, 1); else damage(s, target, 1, { kind: "reasoning", card: id });
    continueAfter(s, after);
  } else if (["citizen-airship", "raider-airship", "shadow-airship"].includes(id)) {
    if (target.location === "airship") {
      const died = damage(s, target, 1, { kind: "reasoning", card: id });
      finishDeaths(s, died ? [target] : [], giver, false, after);
    } else { target.location = "airship"; log(s, `${target.name} 被移到飛行船。`); continueAfter(s, after); }
  } else { log(s, `${giver.name} 私下查看了 ${target.name} 的身分：${character(target).name}。`, [giver.id]); continueAfter(s, after); }
}

function canUseAbility(s: SRState, p: SRPlayer) {
  if (!p.alive || p.id !== s.current || p.abilityDisabled || s.phase === "finished") return false;
  const start = s.phase === "move" && ["alice", "angela", "claire", "carol", "david", "deborah", "erica", "felix", "felicia", "uranus"].includes(p.character);
  const end = s.pending?.kind === "turn-end" && ["agatha", "benjamin", "emma", "gordon", "wight"].includes(p.character);
  const attack = s.pending?.kind === "attack" && p.character === "walpugra";
  if (!start && !end && !attack) return false;
  if (p.turnAbilityUsed) return false;
  if (["alice", "angela", "claire", "david", "deborah", "erica", "felix", "felicia", "agatha", "gordon", "wight"].includes(p.character) && p.abilityUsed) return false;
  if (p.character === "david") return (["white", "black"] as SRDeck[]).some((d) => s.discards[d].some((e) => srCardById(e.card).type === "equipment"));
  if (p.character === "benjamin") return !!p.equipment.length && s.players.some((x) => x.alive && x.id !== p.id && x.location === p.location);
  if (p.character === "emma") return s.players.some((x) => x.alive && x.id !== p.id && x.location === p.location);
  if (p.character === "uranus") return s.players.some((x) => x.alive && x.id !== p.id && ["blackmist", "airship"].includes(x.location || ""));
  return true;
}
function useAbility(s: SRState, p: SRPlayer, random: Random) {
  assert(canUseAbility(s, p), "目前不能使用能力");
  reveal(s, p);
  p.turnAbilityUsed = true;
  const returnPrompt = s.pending ? structuredClone(s.pending) : null;
  if (p.character === "alice") { p.abilityUsed = true; heal(s, p, p.damage); }
  else if (p.character === "angela") { p.abilityUsed = true; p.neighborSide = "left"; log(s, `${p.name} 改變了相鄰勝利條件。`); }
  else if (p.character === "carol") heal(s, p, 2);
  else if (p.character === "deborah") { p.abilityUsed = true; p.changedWinToDeath = true; log(s, `${p.name} 將勝利條件改為自己死亡。`); }
  else if (p.character === "gordon") { p.abilityUsed = true; p.barrier = true; log(s, `${p.name} 啟動幽靈屏障。`); }
  else if (p.character === "wight") { p.abilityUsed = true; p.extraTurns += s.deathOrder.flat().length; log(s, `${p.name} 獲得 ${s.deathOrder.flat().length} 個額外回合。`); }
  else if (p.character === "agatha") {
    p.abilityUsed = true;
    const dice = roll(s, random, "魔女之夜");
    const area = outerForRoll(s, dice.d4 + dice.d6) || (dice.d4 + dice.d6 === 10 ? s.areas.find((a) => a.airship) : undefined);
    const deaths = area ? s.players.filter((x) => x.alive && x.location === area.id && damage(s, x, 3, { kind: "ability", attacker: p.id })) : [];
    finishDeaths(s, deaths, p, false, "turn"); return;
  } else if (p.character === "david") {
    const cards = (["white", "black"] as SRDeck[]).flatMap((d) => s.discards[d].filter((e) => srCardById(e.card).type === "equipment"));
    prompt(s, p.id, "grave", "從棄牌堆取得一件裝備。", cards.map((e) => ({ id: e.id, label: srCardById(e.card).title })), { returnPrompt }); return;
  } else if (["erica", "felix", "felicia", "uranus", "claire"].includes(p.character)) {
    const targets = s.players.filter((x) => x.alive && x.id !== p.id && (p.character !== "uranus" || ["blackmist", "airship"].includes(x.location || "")));
    prompt(s, p.id, "ability-target", character(p).ability, targets.map((x) => ({ id: x.id, label: x.name })), { ability: p.character, returnPrompt }); return;
  } else if (["benjamin", "emma"].includes(p.character)) {
    const targets = s.players.filter((x) => x.alive && x.id !== p.id && x.location === p.location);
    if (p.character === "benjamin") prompt(s, p.id, "gift-equipment", "選擇要送出的裝備。", p.equipment.map((e) => ({ id: e.id, label: srCardById(e.card).title })), { targets: targets.map((x) => x.id), returnPrompt });
    else prompt(s, p.id, "emma-target", "選擇同地點的治療目標。", targets.map((x) => ({ id: x.id, label: x.name })), { returnPrompt });
    return;
  } else if (p.character === "walpugra") {
    prompt(s, p.id, "swap-location", "選擇交換位置的角色。", s.players.filter((x) => x.alive && x.id !== p.id && x.location).map((x) => ({ id: x.id, label: x.name })), { returnPrompt }); return;
  }
  if (returnPrompt?.kind === "turn-end") finishTurn(s); else s.pending = returnPrompt;
}

function choose(s: SRState, id: string, random: Random) {
  const q = s.pending!;
  assert(q.options.some((o) => o.id === id), "選項不存在");
  const actor = player(s, q.actor);
  if (q.kind === "move") {
    assert(id.startsWith("leave:"), "移動擲骰必須使用 roll"); moveTo(s, id.slice(6));
  } else if (q.kind === "move-result") {
    if (id.includes("emi:")) reveal(s, actor);
    moveTo(s, id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id);
  }
  else if (q.kind === "area") id === "use" ? areaAction(s, random) : beginAttack(s);
  else if (q.kind === "choose-deck") resolveDraw(s, actor, id as SRDeck, random);
  else if (q.kind === "town") {
    const [effect, targetId] = id.split(":"); const target = player(s, targetId);
    if (effect === "heal") { heal(s, target, 1); continueAfter(s, "area"); }
    else { const died = damage(s, target, 2, { kind: "area" }); finishDeaths(s, died ? [target] : [], actor, false, "area"); }
  } else if (q.kind === "steal") {
    const [fromId, equipmentId] = id.split(":"); const from = player(s, fromId); const index = from.equipment.findIndex((e) => e.id === equipmentId); assert(index >= 0, "裝備不存在");
    actor.equipment.push(from.equipment.splice(index, 1)[0]); log(s, `${actor.name} 從 ${from.name} 取得一件裝備。`); continueAfter(s, (q.data.after as After) || "area");
  } else if (q.kind === "card-target") {
    const target = player(s, id); const effect = q.data.effect as string; let deaths: SRPlayer[] = [];
    if (effect === "blessing") heal(s, target, roll(s, random, "祝福", "d6").d6);
    else if (effect === "first-aid") { target.damage = 7; if (target.damage >= character(target).maxHp && markDead(s, target)) deaths = [target]; log(s, `${target.name} 的傷害設為 7。`); }
    else if (["black-dog", "bloodthirsty-spider"].includes(effect)) { if (damage(s, target, 2, { kind: "black", card: effect })) deaths.push(target); if (damage(s, actor, 2, { kind: "black", card: effect })) deaths.push(actor); }
    else if (effect === "vampire-bat") { if (damage(s, target, 2, { kind: "black", card: effect })) deaths.push(target); heal(s, actor, 1); }
    else if (effect === "cursed-doll") { const victim = roll(s, random, "詛咒娃娃", "d6").d6 <= 4 ? target : actor; if (damage(s, victim, 3, { kind: "black", card: effect })) deaths.push(victim); }
    finishDeaths(s, deaths, actor, false, "area");
  } else if (q.kind === "reasoning-target") {
    const target = player(s, id); const card = q.data.instance as unknown as SRCardInstance; const matches = reasoningMatches(card.card, target);
    const after = (q.data.after as After) || "area";
    if (target.character === "urlich" && card.card !== "identity") prompt(s, target.id, "urlich", `${srCardById(card.card).title}：選擇宣告結果。`, [{ id: "honest", label: "照實處理" }, { id: "trigger", label: "讓效果生效" }, { id: "nothing", label: "宣稱無事發生" }], { giver: actor.id, card, after });
    else resolveReasoning(s, actor, target, card, matches, after);
  } else if (q.kind === "urlich") {
    const giver = player(s, q.data.giver as string); const card = q.data.card as unknown as SRCardInstance;
    resolveReasoning(s, giver, actor, card, id === "honest" ? reasoningMatches(card.card, actor) : id === "trigger", (q.data.after as After) || "area");
  } else if (q.kind === "reasoning-payment") {
    const giver = player(s, q.data.giver as string);
    const after = (q.data.after as After) || "area";
    if (id === "damage") { const died = damage(s, actor, 1, { kind: "reasoning" }); finishDeaths(s, died ? [actor] : [], giver, false, after); }
    else { const index = actor.equipment.findIndex((e) => e.id === id); assert(index >= 0, "裝備不存在"); giver.equipment.push(actor.equipment.splice(index, 1)[0]); continueAfter(s, after); }
  } else if (q.kind === "banana-equipment") prompt(s, actor.id, "banana-target", "選擇接收裝備的角色。", s.players.filter((x) => x.alive && x.id !== actor.id).map((x) => ({ id: x.id, label: x.name })), { equipment: id });
  else if (q.kind === "banana-target") { const index = actor.equipment.findIndex((e) => e.id === q.data.equipment); assert(index >= 0, "裝備不存在"); player(s, id).equipment.push(actor.equipment.splice(index, 1)[0]); continueAfter(s, "area"); }
  else if (q.kind === "attack") {
    if (id === "skip") finishTurn(s);
    else if (id === "parasol") resolveDraw(s, actor, "reasoning", random, attackTargets(s, actor), "turn");
    else resolveAttackRoll(s, actor, player(s, id), random);
  } else if (q.kind === "galahad") resolveAttackRoll(s, actor, player(s, q.data.target as string), random, !!q.data.isCounter);
  else if (q.kind === "bylon-mode") {
    const targets = (q.data.targets as string[]).map((x) => player(s, x));
    if (id === "damage") applyAttack(s, actor, targets, q.data.amount as number, q.data.chosen as string);
    else {
      reveal(s, actor);
      const withEquipment = targets.filter((t) => t.equipment.length);
      prompt(s, actor.id, "bylon-steal", `從 ${withEquipment[0].name} 取得一件裝備。`, withEquipment[0].equipment.map((e) => ({ id: e.id, label: srCardById(e.card).title })), { targets: withEquipment.map((t) => t.id), chosen: q.data.chosen });
    }
  } else if (q.kind === "bylon-steal") {
    const targets = q.data.targets as string[]; const victim = player(s, targets[0]); const index = victim.equipment.findIndex((e) => e.id === id); actor.equipment.push(victim.equipment.splice(index, 1)[0]);
    const rest = targets.slice(1).filter((x) => player(s, x).equipment.length);
    if (rest.length) { const next = player(s, rest[0]); prompt(s, actor.id, "bylon-steal", `從 ${next.name} 取得一件裝備。`, next.equipment.map((e) => ({ id: e.id, label: srCardById(e.card).title })), { targets: rest, chosen: q.data.chosen }); }
    else afterAttack(s, q.data.chosen as string);
  } else if (q.kind === "venom") {
    const venom = player(s, q.data.venom as string);
    const deaths = (q.data.deaths as string[]).map((x) => player(s, x));
    if (id === "damage") { if (damage(s, actor, 1, { kind: "ability", attacker: venom.id })) deaths.push(actor); }
    else { const index = actor.equipment.findIndex((e) => e.id === id); assert(index >= 0, "裝備不存在"); venom.equipment.push(actor.equipment.splice(index, 1)[0]); }
    const isCounter = !!q.data.isCounter;
    finishDeaths(s, [...new Set(deaths)], actor, true, isCounter ? "turn" : "attack", isCounter ? undefined : q.data.chosen as string);
  } else if (q.kind === "counter") {
    if (id === "counter") {
      reveal(s, actor);
      resolveAttackRoll(s, actor, player(s, q.data.attacker as string), random, true);
    } else {
      const original = player(s, q.data.attacker as string);
      if (original.character === "craig" && original.revealed && !original.abilityDisabled && !original.extraAttackUsed && actor.alive)
        prompt(s, original.id, "craig", "受到 2 點傷害，再攻擊同一目標一次？", [{ id: "attack", label: "發動血宴" }, { id: "skip", label: "不發動" }], { target: actor.id });
      else completeAttack(s);
    }
  } else if (q.kind === "craig") {
    actor.extraAttackUsed = true;
    if (id === "skip") completeAttack(s);
    else {
      reveal(s, actor);
      const died = damage(s, actor, 2, { kind: "ability" });
      if (died) finishDeaths(s, [actor], actor, false, "turn");
      else resolveAttackRoll(s, actor, player(s, q.data.target as string), random);
    }
  } else if (q.kind === "godwin") {
    const revived = player(s, id); revived.alive = true; revived.revealed = true; revived.damage = 7; revived.location = null; revived.equipment.splice(0).forEach((e) => discard(s, e)); revived.guardian = false; revived.barrier = false;
    log(s, `${revived.name} 被復活，傷害為 7，位置未定。`);
    finishDeathLoot(s, (q.data.deaths as string[]).map((x) => player(s, x)), q.data.killer ? player(s, q.data.killer as string) : undefined, !!q.data.byAttack, q.data.after as After, q.data.attackTarget as string | undefined);
  } else if (q.kind === "loot") {
    const victims = q.data.victims as string[]; const victim = player(s, victims[0]); const index = victim.equipment.findIndex((e) => e.id === id); assert(index >= 0, "裝備不存在"); actor.equipment.push(victim.equipment.splice(index, 1)[0]); discardVictim(s, victim); beginLoot(s, actor, victims.slice(1), q.data.after as After, q.data.attackTarget as string | undefined);
  } else if (q.kind === "turn-end") {
    if (id === "ability") { useAbility(s, actor, random); return; }
    if (!checkWin(s)) nextTurn(s);
  } else if (q.kind === "ability-target") {
    const target = player(s, id); const ability = q.data.ability as string; actor.abilityUsed = !["uranus"].includes(ability);
    if (ability === "erica") { target.abilityDisabled = true; target.barrier = false; }
    else if (ability === "claire") {
      const own = actor.damage;
      actor.damage = Math.min(target.damage, character(actor).maxHp);
      target.damage = Math.min(own, character(target).maxHp);
      if (actor.damage >= character(actor).maxHp) markDead(s, actor);
      if (target.damage >= character(target).maxHp) markDead(s, target);
    }
    else if (ability === "felicia") { target.damage = 7; if (target.damage >= character(target).maxHp) markDead(s, target); }
    else { const amount = ability === "felix" ? roll(s, random, "雷擊", "d6").d6 : 3; damage(s, target, amount, { kind: "ability", attacker: actor.id }); }
    const deaths = s.players.filter((x) => !x.alive && !s.deathOrder.flat().includes(x.id));
    if (deaths.length) finishDeaths(s, deaths, actor, false, "none");
    if (s.phase !== "finished" && !s.pending) s.pending = q.data.returnPrompt as unknown as SRPending;
    else if (s.phase !== "finished" && s.pending?.kind === "ability-target") s.pending = q.data.returnPrompt as unknown as SRPending;
  } else if (q.kind === "grave") {
    for (const deck of ["white", "black"] as SRDeck[]) { const index = s.discards[deck].findIndex((e) => e.id === id); if (index >= 0) actor.equipment.push(s.discards[deck].splice(index, 1)[0]); }
    actor.abilityUsed = true;
    if (!checkWin(s)) s.pending = q.data.returnPrompt as unknown as SRPending;
  } else if (q.kind === "gift-equipment") prompt(s, actor.id, "gift-target", "選擇接收者。", (q.data.targets as string[]).map((x) => ({ id: x, label: player(s, x).name })), { equipment: id, returnPrompt: q.data.returnPrompt });
  else if (q.kind === "gift-target") { const index = actor.equipment.findIndex((e) => e.id === q.data.equipment); player(s, id).equipment.push(actor.equipment.splice(index, 1)[0]); if (!checkWin(s)) { const back = q.data.returnPrompt as unknown as SRPending; if (back?.kind === "turn-end") finishTurn(s); else s.pending = back; } }
  else if (q.kind === "emma-target") { heal(s, player(s, id), roll(s, random, "艾瑪治療", "d4").d4); const back = q.data.returnPrompt as unknown as SRPending; if (back?.kind === "turn-end") finishTurn(s); else s.pending = back; }
  else if (q.kind === "swap-location") { const target = player(s, id); [actor.location, target.location] = [target.location, actor.location]; s.pending = q.data.returnPrompt as unknown as SRPending; }
}

export const shadowRaidersAirship: GameDefinition<SRState, SRAction, SRView> = {
  info: { id: "shadow-raiders-airship", name: "暗影奇襲：女王陛下的飛行船", rulesVersion: SR_RULES_VERSION, minPlayers: 4, maxPlayers: 10, description: "登上飛行船，在環狀地圖追獵敵對陣營並完成秘密勝利條件。", firstPlayerPolicy: "random" },
  initialize(seats: Seat[], first, random) {
    assert(seats.length >= 4 && seats.length <= 10 && new Set(seats.map((p) => p.id)).size === seats.length, "需要 4–10 位不同玩家");
    assert(seats.some((p) => p.id === first), "先手玩家不存在");
    const selected = [...new Set(SR_CHARACTERS.map((c) => c.initial))].map((initial) => { const group = SR_CHARACTERS.filter((c) => c.initial === initial); return group[random(group.length)]; });
    const quotas = ({ 4: [2, 2, 0], 5: [2, 2, 1], 6: [2, 2, 2], 7: [2, 2, 3], 8: [3, 3, 2], 9: [3, 3, 3], 10: [3, 3, 4] } as Record<number, number[]>)[seats.length];
    const dealt = shuffle([
      ...shuffle(selected.filter((c) => c.faction === "raider"), random).slice(0, quotas[0]),
      ...shuffle(selected.filter((c) => c.faction === "shadow"), random).slice(0, quotas[1]),
      ...shuffle(selected.filter((c) => c.faction === "citizen"), random).slice(0, quotas[2]),
    ], random);
    assert(dealt.length === seats.length, "角色配置不足");
    const outer = shuffle(SR_OUTER_AREAS, random).map((a) => ({ ...a, rolls: [...a.rolls] }));
    const state: SRState = {
      rulesVersion: SR_RULES_VERSION,
      players: seats.map((seat, i) => ({ ...seat, character: dealt[i].id, damage: 0, alive: true, revealed: false, location: null, equipment: [], abilityUsed: false, abilityDisabled: false, guardian: false, barrier: false, neighborSide: "right", changedWinToDeath: false, extraTurns: 0, winQualified: false, attacksRemaining: 1, extraAttackUsed: false, turnAbilityUsed: false })),
      areas: [...outer, SR_AIRSHIP], decks: { white: instances("white", random), black: instances("black", random), reasoning: instances("reasoning", random) }, discards: { white: [], black: [], reasoning: [] }, current: first, phase: "move", pending: null, promptSequence: 0, lastRoll: null, deathOrder: [], winners: [], logs: [],
    };
    startTurn(state);
    return state;
  },
  legalActions(state, id) {
    const p = state.players.find((x) => x.id === id);
    return { canUseAbility: !!p && canUseAbility(state, p), ...(state.pending?.actor === id ? { pending: { id: state.pending.id, kind: state.pending.kind, text: state.pending.text, options: state.pending.options } } : {}) };
  },
  parseAction(input) { return actionSchema.parse(input); },
  transition(state, id, action, random) {
    assert(state.rulesVersion === SR_RULES_VERSION, "不支援此規則版本"); assert(state.phase !== "finished", "遊戲已結束");
    const s = structuredClone(state); const p = player(s, id);
    if (action.type === "ability") { useAbility(s, p, random); return s; }
    assert(s.pending && s.pending.actor === id, "目前不是由你決定"); assert(action.promptId === s.pending.id, "操作提示已過期");
    if (action.type === "roll") {
      assert(["move", "compass-roll", "galahad"].includes(s.pending.kind) && s.pending.options.some((o) => o.id === "roll"), "目前不需擲骰");
      if (s.pending.kind === "galahad") resolveAttackRoll(s, p, player(s, s.pending.data.target as string), random, !!s.pending.data.isCounter);
      else resolveMovementRoll(s, p, random, (s.pending.data.results as number[] | undefined) || []);
    } else choose(s, action.optionId, random);
    return s;
  },
  playerView(s, id) {
    return {
      rulesVersion: s.rulesVersion,
      players: s.players.map((p) => { const visible = p.id === id || p.revealed || s.phase === "finished"; const c = character(p); const { character: _character, winQualified: _qualified, neighborSide: _side, changedWinToDeath: _changed, ...publicPlayer } = p; return { ...publicPlayer, ...(visible ? { character: c, maxHp: c.maxHp, faction: c.faction } : {}) }; }),
      areas: s.areas, deckCounts: { white: s.decks.white.length, black: s.decks.black.length, reasoning: s.decks.reasoning.length }, discardCounts: { white: s.discards.white.length, black: s.discards.black.length, reasoning: s.discards.reasoning.length }, current: s.current, phase: s.phase, lastRoll: s.lastRoll, winners: s.winners,
      logs: s.logs.filter((l) => !l.recipients || l.recipients.includes(id)).map((l) => ({ text: l.text })), legal: this.legalActions(s, id) as SRLegal,
    };
  },
  result(s) { return s.phase === "finished" ? { scores: Object.fromEntries(s.players.map((p) => [p.id, s.winners.includes(p.id) ? 1 : 0])), winners: s.winners } : null; },
};
