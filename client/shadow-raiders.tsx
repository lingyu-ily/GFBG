import type { RoomAction, RoomView } from "../shared/room";
import { srCardById, type SRView } from "../shared/shadow-raiders";

const faction = (value?: string) => value === "raider" ? "奇襲者" : value === "shadow" ? "暗影" : value === "citizen" ? "市民" : "身分未明";

export function ShadowRaidersTable({ room, me, busy, onAction }: {
  room: RoomView<SRView>; me: string; busy: boolean; onAction: (action: RoomAction) => void;
}) {
  const game = room.game!;
  const self = game.players.find((p) => p.id === me)!;
  const current = game.players.find((p) => p.id === game.current);
  const pending = game.legal.pending;
  const outer = game.areas.filter((a) => !a.airship);
  const airship = game.areas.find((a) => a.airship)!;
  const act = (action: unknown) => onAction({ type: "game", action });
  return (
    <div className="shadow-layout raiders-layout">
      <section className="shadow-board raiders-board">
        <header className="shadow-status">
          <div><span className="eyebrow">QUEEN MAJESTY IS AIRBORNE</span><strong>{game.phase === "finished" ? "對局結束" : `輪到 ${current?.name}`}</strong></div>
          {game.lastRoll && <div className="shadow-dice"><span>D4 <b>{game.lastRoll.d4 || "–"}</b></span><span>D6 <b>{game.lastRoll.d6 || "–"}</b></span></div>}
        </header>
        <div className="raiders-map" aria-label="飛行船環狀地圖">
          <article className="raiders-airship">
            <span>10 · 全域射程</span><h3>{airship.name}</h3><p>{airship.text}</p>
            <div className="shadow-tokens">{game.players.filter((p) => p.alive && p.location === airship.id).map((p) => <span title={p.name} key={p.id}>{p.name.slice(0, 1)}</span>)}</div>
          </article>
          {outer.map((area, index) => (
            <article className={`shadow-area raiders-area area-${index}`} key={area.id}>
              <span>{area.rolls.join(" / ")} · ← 攻擊左鄰</span><h3>{area.name}</h3><p>{area.text}</p>
              <div className="shadow-tokens">{game.players.filter((p) => p.alive && p.location === area.id).map((p) => <span title={p.name} key={p.id}>{p.name.slice(0, 1)}</span>)}</div>
            </article>
          ))}
        </div>
        <div className="shadow-decks">
          {(["white", "reasoning", "black"] as const).map((deck) => <div className={`shadow-deck ${deck}`} key={deck}><b>{deck === "white" ? "白牌" : deck === "black" ? "黑牌" : "推理牌"}</b><span>{game.deckCounts[deck]} 張 · 棄牌 {game.discardCounts[deck]}</span></div>)}
        </div>
        <div className="shadow-players raiders-players">
          {game.players.map((p) => <article className={`shadow-player ${!p.alive ? "dead" : ""} ${p.id === game.current ? "current" : ""}`} key={p.id}>
            <div className="shadow-player-head"><strong>{p.name}{p.id === me ? "（你）" : ""}</strong><span>{p.alive ? `${p.damage} 傷害` : "已死亡"}</span></div>
            <small>{p.character ? `${p.character.name} · ${faction(p.faction)} · ${p.maxHp} HP` : faction()}</small>
            <small>{p.location ? game.areas.find((a) => a.id === p.location)?.name : "位置未定"}{p.equipment.filter((e) => e.card === "death-scope").length ? ` · 射程 +${p.equipment.filter((e) => e.card === "death-scope").length}` : ""}</small>
            <div className="shadow-equipment">{p.equipment.length ? p.equipment.map((e) => <span title={srCardById(e.card).text} key={e.id}>{srCardById(e.card).title}</span>) : <i>沒有裝備</i>}</div>
          </article>)}
        </div>
        <section className="shadow-self">
          <div className={`shadow-identity faction-${self.faction}`}><span className="eyebrow">YOUR SECRET IDENTITY</span><h2>{self.character?.name} <small>{self.character?.englishName}</small></h2><p><b>{faction(self.faction)}</b> · 最大生命 {self.maxHp}</p><p><strong>勝利：</strong>{self.character?.win}</p><p><strong>能力：</strong>{self.character?.ability}</p></div>
          <div className="shadow-actions">
            {game.phase === "finished" ? <div><span className="eyebrow">WINNERS</span><h2>{game.players.filter((p) => game.winners.includes(p.id)).map((p) => p.name).join("、")}</h2></div> : pending ? <><h3>{pending.text}</h3><div className="shadow-option-list">{pending.options.map((option) => <button disabled={busy} key={option.id} onClick={() => act(option.id === "roll" ? { type: "roll", promptId: pending.id } : { type: "choose", promptId: pending.id, optionId: option.id })}>{option.label}</button>)}</div></> : <p>等待其他玩家完成選擇。</p>}
            <div className="shadow-special-actions">{game.legal.canUseAbility && <button className="outline" disabled={busy} onClick={() => act({ type: "ability" })}>使用角色能力</button>}</div>
          </div>
        </section>
      </section>
      <aside className="table-sidebar">
        <details className="panel role-reference" open><summary>飛船版規則<span>環狀射程、登船、推理</span></summary><div><p>外圍可攻擊所在地與逆時針左鄰；每張死亡瞄準鏡再延伸一格。飛船與所有地點互相在射程內。</p><p>擲出 10 強制登船；在飛船開始回合可直接選一個外圍地點。身分只能因能力、牌或死亡公開。</p></div></details>
        <section className="panel journal"><span className="eyebrow">TABLE JOURNAL</span><h3>牌桌紀錄</h3><ol>{[...game.logs].reverse().map((entry, i) => <li key={i}>{entry.text}</li>)}</ol></section>
      </aside>
    </div>
  );
}
