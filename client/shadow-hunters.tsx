import type { RoomAction, RoomView } from "../shared/room";
import { cardById, type SHView } from "../shared/shadow-hunters";
import { PlayerAvatar } from "./avatar";

const faction = (value?: string) =>
  value === "hunter" ? "獵人" : value === "shadow" ? "暗影" : value === "neutral" ? "中立" : "身分未明";

export function ShadowHuntersTable({ room, me, busy, onAction }: {
  room: RoomView<SHView>;
  me: string;
  busy: boolean;
  onAction: (action: RoomAction) => void;
}) {
  const game = room.game!;
  const self = game.players.find((p) => p.id === me);
  const current = game.players.find((p) => p.id === game.current);
  const pending = game.legal.pending;
  const act = (action: unknown) => onAction({ type: "game", action });
  return (
    <div className="shadow-layout">
      <section className="shadow-board">
        <header className="shadow-status">
          <div>
            <span className="eyebrow">THE HUNT IS ON</span>
            <strong>{game.phase === "finished" ? "對局結束" : `輪到 ${current?.name}`}</strong>
          </div>
          {game.lastRoll && (
            <div className="shadow-dice" aria-label={`${game.lastRoll.purpose}骰值`}>
              <span>D4 <b>{game.lastRoll.d4 || "–"}</b></span>
              <span>D6 <b>{game.lastRoll.d6 || "–"}</b></span>
            </div>
          )}
        </header>
        <div className="shadow-zones">
          {[0, 1, 2].map((zone) => (
            <div className="shadow-zone" key={zone}>
              {game.areas.slice(zone * 2, zone * 2 + 2).map((area) => (
                <article className="shadow-area" key={area.id}>
                  <span>{area.rolls.join(" / ")}</span>
                  <h3>{area.name}</h3>
                  <p>{area.text}</p>
                  <div className="shadow-tokens">
                    {game.players.filter((p) => p.alive && p.location === area.id).map((p) => (
                      <PlayerAvatar name={p.name} src={room.members.find((m) => m.id === p.id)?.avatarUrl} title={p.name} key={p.id} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
        <div className="shadow-decks">
          {(["white", "hermit", "black"] as const).map((deck) => (
            <div className={`shadow-deck ${deck}`} key={deck}>
              <b>{deck === "white" ? "白色牌" : deck === "black" ? "黑色牌" : "隱士牌"}</b>
              <span>{game.deckCounts[deck]} 張 · 棄牌 {game.discardCounts[deck]}</span>
            </div>
          ))}
        </div>
        <div className="shadow-players">
          {game.players.map((p) => (
            <article className={`shadow-player ${!p.alive ? "dead" : ""} ${p.id === game.current ? "current" : ""}`} key={p.id}>
              <div className="shadow-player-head">
                <div className="shadow-player-identity"><PlayerAvatar name={p.name} src={room.members.find((m) => m.id === p.id)?.avatarUrl} /><strong>{p.name}{p.id === me ? "（你）" : ""}</strong></div>
                <span>{p.alive ? `${p.damage} 傷害` : "已死亡"}</span>
              </div>
              <small>{p.character ? `${p.character.name} · ${faction(p.faction)} · ${p.maxHp} HP` : faction()}</small>
              <div className="shadow-equipment">
                {p.equipment.length ? p.equipment.map((e) => <span title={cardById(e.card).text} key={e.id}>{cardById(e.card).title}</span>) : <i>沒有裝備</i>}
              </div>
            </article>
          ))}
        </div>
        {self ? <section className="shadow-self">
          <div className={`shadow-identity faction-${self.faction}`}>
            <span className="eyebrow">YOUR SECRET IDENTITY</span>
            <h2>{self.character?.name} <small>{self.character?.englishName}</small></h2>
            <p><b>{faction(self.faction)}</b> · 最大生命 {self.maxHp}</p>
            <p><strong>勝利：</strong>{self.character?.win}</p>
            <p><strong>能力：</strong>{self.character?.ability}</p>
          </div>
          <div className="shadow-actions">
            {game.phase === "finished" ? (
              <div><span className="eyebrow">WINNERS</span><h2>{game.players.filter((p) => game.winners.includes(p.id)).map((p) => p.name).join("、")}</h2></div>
            ) : pending ? (
              <>
                <h3>{pending.text}</h3>
                <div className="shadow-option-list">
                  {pending.options.map((option) => (
                    <button disabled={busy} key={option.id} onClick={() => act(
                      option.id === "roll"
                        ? { type: "roll", promptId: pending.id }
                        : { type: "choose", promptId: pending.id, optionId: option.id },
                    )}>{option.label}</button>
                  ))}
                </div>
              </>
            ) : <p>等待其他玩家完成選擇。</p>}
            <div className="shadow-special-actions">
              {game.legal.canReveal && <button className="outline" disabled={busy} onClick={() => act({ type: "reveal" })}>公開身分</button>}
              {game.legal.canUseAbility && <button className="outline" disabled={busy} onClick={() => act({ type: "ability" })}>使用角色能力</button>}
            </div>
          </div>
        </section> : (
          <section className="shadow-self spectator-game-panel">
            <div className="shadow-identity">
              <span className="eyebrow">SPECTATOR VIEW</span>
              <h2>正在旁觀獵殺現場</h2>
              <p>未公開身分、私人提示與玩家操作均已隱藏。</p>
            </div>
            {game.phase === "finished" && (
              <div className="shadow-actions">
                <span className="eyebrow">WINNERS</span>
                <h2>{game.players.filter((p) => game.winners.includes(p.id)).map((p) => p.name).join("、")}</h2>
              </div>
            )}
          </section>
        )}
      </section>
      <aside className="table-sidebar">
        <details className="panel role-reference" open>
          <summary>公開規則<span>移動、地點、攻擊</span></summary>
          <div>
            <p>移動必須執行；地點行動與攻擊可以略過。攻擊範圍是同一組兩個地點，傷害為 D4 與 D6 的差。</p>
            <p>死亡者公開身分並離場，但仍可能因陣營或個人條件獲勝。</p>
          </div>
        </details>
        <section className="panel journal">
          <span className="eyebrow">TABLE JOURNAL</span>
          <h3>牌桌紀錄</h3>
          <ol>{[...game.logs].reverse().map((entry, i) => <li key={i}>{entry.text}</li>)}</ol>
        </section>
      </aside>
    </div>
  );
}
