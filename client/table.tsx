import { useEffect, useState } from "react";
import { ROLES, type Card, type LLView } from "../shared/love-letter";
import type { RoomAction, RoomView } from "../shared/room";
import { PlayerAvatar } from "./avatar";
function PlayingCard({
  card,
  selected,
  disabled,
  onClick,
}: {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="card-top">
        <b>{card.value}</b>
        <small>{ROLES[card.value].count} 張</small>
      </span>
      <span className="card-role">{ROLES[card.value].name}</span>
      <span className="card-rule">{ROLES[card.value].text}</span>
      <span className="card-footer">
        LOVE LETTER <span>◇</span>
      </span>
    </>
  );
  return onClick ? (
    <button
      className={`playing-card role-${card.value} ${selected ? "selected" : ""}`}
      aria-pressed={!!selected}
      disabled={disabled}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className={`playing-card role-${card.value}`}>{body}</div>
  );
}
export function LoveLetterTable({
  room,
  me,
  busy,
  onAction,
}: {
  room: RoomView<LLView>;
  me: string;
  busy: boolean;
  onAction: (action: RoomAction) => void;
}) {
  const g = room.game!;
  const self = g.players.find((p) => p.id === me);
  const [selected, select] = useState("");
  const [target, setTarget] = useState("");
  const [guess, setGuess] = useState("");
  const [bottom, setBottom] = useState<string[]>([]);
  useEffect(() => {
    select("");
    setTarget("");
    setGuess("");
    setBottom([]);
  }, [room.version]);
  const legal = g.legal.cards.find((c) => c.id === selected);
  const card = self?.hand?.find((c) => c.id === selected);
  const current = g.players.find((p) => p.id === g.current);
  const end = g.phase === "roundEnd" || g.phase === "matchEnd";
  const choose = (c: Card) => {
    select(c.id);
    const l = g.legal.cards.find((x) => x.id === c.id);
    setTarget(l?.targets.length === 1 ? l.targets[0] : "");
    setGuess("");
    setBottom((self?.hand || []).filter((x) => x.id !== c.id).map((x) => x.id));
  };
  return (
    <div className="game-layout">
      <section className="table-main">
        <div className="table-meta">
          <span>
            第 <strong>{g.round}</strong> 輪
          </span>
          <span>
            目標 <strong>{g.targetScore}</strong> 枚好感
          </span>
          <span className="pill">
            {end ? "本輪結束" : !self ? "旁觀中" : self.alive ? "進行中" : "本輪出局"}
          </span>
        </div>
        <div className="opponents">
          {g.players
            .filter((p) => p.id !== me)
            .map((p) => (
              <article
                className={`opponent ${!p.alive ? "eliminated" : ""} ${p.id === g.current && !end ? "turn" : ""}`}
                key={p.id}
              >
                <div className="opponent-head">
                  <PlayerAvatar
                    name={p.name}
                    src={room.members.find((m) => m.id === p.id)?.avatarUrl}
                  />
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.protected
                        ? "侍女保護中"
                        : !p.alive
                          ? "已出局"
                          : p.id === g.current && !end
                            ? "正在思考…"
                            : "等待回合"}
                      {!room.members.find((m) => m.id === p.id)?.online &&
                        " · 離線"}
                    </small>
                  </div>
                  <span className="score">♡ {p.score}</span>
                </div>
                <div className="opponent-cards">
                  {p.hand
                    ? p.hand.map((c) => (
                        <span className="revealed-card" key={c.id}>
                          {c.value} {ROLES[c.value].name}
                        </span>
                      ))
                    : Array.from({ length: p.handCount }, (_, i) => (
                        <span
                          className="mini-back"
                          key={i}
                          aria-label="隱藏手牌"
                        >
                          ◇
                        </span>
                      ))}
                </div>
                <div className="discards">
                  {p.discards.length ? (
                    p.discards.map((c) => (
                      <span key={c.id} title={ROLES[c.value].text}>
                        {c.value} {ROLES[c.value].name}
                      </span>
                    ))
                  ) : (
                    <small>尚無棄牌</small>
                  )}
                </div>
              </article>
            ))}
        </div>
        <div className="table-center">
          <div className="deck" aria-label={`牌庫剩餘 ${g.deckCount} 張`}>
            <span>GFBG</span>
            <strong>◇</strong>
            <small>LOVE LETTER</small>
          </div>
          <div>
            <span className="eyebrow">THE LETTER IS STILL IN PLAY</span>
            <h2>
              {end
                ? g.phase === "matchEnd"
                  ? "心意，送到了。"
                  : "這一輪，揭曉。"
                : g.current === me
                  ? g.phase === "chancellor"
                    ? "把最好的，留給自己。"
                    : "輪到你，寫下一步。"
                  : `等待 ${current?.name}`}
            </h2>
            <p>
              {end
                ? `${g.players
                    .filter((p) =>
                      (g.phase === "matchEnd"
                        ? g.winners
                        : g.roundWinners
                      ).includes(p.id),
                    )
                    .map((p) => p.name)
                    .join(
                      "、",
                    )} ${g.phase === "matchEnd" ? "贏得這場對局！" : "贏得本輪。"}`
                : g.current === me
                  ? g.phase === "chancellor"
                    ? "保留 1 張，其餘依序放回牌庫底。"
                    : "已為你抽牌。選擇一張手牌打出。"
                  : "看看公開棄牌，猜猜朋友手裡的秘密。"}
            </p>
            <span className="deck-count">
              牌庫剩餘 <b>{g.deckCount}</b> 張
            </span>
            {g.phase === "roundEnd" &&
              (room.hostId === me ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    onAction({ type: "game", action: { type: "next" } })
                  }
                >
                  開始下一輪 →
                </button>
              ) : (
                <p>等待房主開始下一輪。</p>
              ))}
          </div>
        </div>
        {g.removed.length > 0 && (
          <div className="removed">
            <span>雙人局公開移除</span>
            {g.removed.map((c) => (
              <span key={c.id}>
                {c.value} {ROLES[c.value].name}
              </span>
            ))}
          </div>
        )}
        {self ? <section className="hand-panel">
          <div className="hand-heading">
            <div>
              <span className="eyebrow">YOUR HAND · 只有你看得到</span>
              <h3>
                {self.name} <span className="muted">（你）</span>
              </h3>
            </div>
            <span className="score">
              ♡ {self.score} / {g.targetScore}
            </span>
          </div>
          <div className="hand-content">
            <div className="hand-cards">
              {self.hand?.length ? (
                self.hand.map((c) => (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    selected={c.id === selected}
                    disabled={
                      busy ||
                      end ||
                      (g.phase !== "chancellor" &&
                        !g.legal.cards.some((l) => l.id === c.id)) ||
                      g.current !== me
                    }
                    onClick={() => choose(c)}
                  />
                ))
              ) : (
                <p className="muted">本輪已出局，下一輪會再發牌給你。</p>
              )}
            </div>
            <div className="action-panel" aria-live="polite">
              {!self.alive && !end ? (
                <>
                  <h3>先看朋友過招。</h3>
                  <p>你的手牌已公開，請等待下一輪。</p>
                </>
              ) : end ? (
                <>
                  <h3>
                    {g.phase === "matchEnd" ? "謝謝同桌的你。" : "好感已結算。"}
                  </h3>
                  <p>
                    {g.phase === "matchEnd"
                      ? "登入玩家的戰績已保存。返回大廳可再開新桌。"
                      : "看看右側紀錄，了解這一輪的結果。"}
                  </p>
                </>
              ) : g.current !== me ? (
                <>
                  <h3>秘密，先留在手裡。</h3>
                  <p>輪到你時，這裡會顯示可以採取的行動。</p>
                </>
              ) : g.phase === "chancellor" ? (
                <>
                  <h3>大臣 · 保留與排序</h3>
                  <p>
                    {selected
                      ? `保留${ROLES[card!.value].name}。以下由先被抽到至最後被抽到排列：`
                      : "點選你要保留的手牌。"}
                  </p>
                  {bottom.map((id, i) => (
                    <div className="bottom-order" key={id}>
                      <span>
                        {i + 1}.{" "}
                        {ROLES[self.hand!.find((c) => c.id === id)!.value].name}
                      </span>
                      {i === 0 && bottom.length === 2 && (
                        <button
                          className="outline small"
                          disabled={busy}
                          onClick={() => setBottom([...bottom].reverse())}
                        >
                          交換順序
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    disabled={busy || !selected}
                    onClick={() =>
                      onAction({
                        type: "game",
                        action: { type: "chancellor", keep: selected, bottom },
                      })
                    }
                  >
                    確認保留與順序
                  </button>
                </>
              ) : legal && card ? (
                <>
                  <h3>打出{ROLES[card.value].name}</h3>
                  {legal.needsTarget && (
                    <>
                      <label htmlFor="target">選擇目標</label>
                      <select
                        id="target"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="">選一位玩家</option>
                        {legal.targets.map((id) => (
                          <option key={id} value={id}>
                            {g.players.find((p) => p.id === id)!.name}
                            {id === me ? "（自己）" : ""}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {legal.needsGuess && (
                    <>
                      <label htmlFor="guess">猜測角色（不能猜衛兵）</label>
                      <select
                        id="guess"
                        value={guess}
                        onChange={(e) => setGuess(e.target.value)}
                      >
                        <option value="">選擇角色</option>
                        {ROLES.map(
                          (r, i) =>
                            i !== 1 && (
                              <option value={i} key={i}>
                                {i} · {r.name}
                              </option>
                            ),
                        )}
                      </select>
                    </>
                  )}
                  {[1, 2, 3, 7].includes(card.value) && !legal.needsTarget && (
                    <p>所有對手都受保護，此牌打出後沒有作用。</p>
                  )}
                  {card.value === 9 && (
                    <p className="inline-error">打出公主，你會立即出局。</p>
                  )}
                  <button
                    disabled={
                      busy ||
                      (legal.needsTarget && !target) ||
                      (legal.needsGuess && guess === "")
                    }
                    onClick={() =>
                      onAction({
                        type: "game",
                        action: {
                          type: "play",
                          card: selected,
                          ...(legal.needsTarget ? { target } : {}),
                          ...(legal.needsGuess ? { guess: Number(guess) } : {}),
                        },
                      })
                    }
                  >
                    確認出牌 →
                  </button>
                </>
              ) : (
                <>
                  <h3>你會把哪張牌交出去？</h3>
                  <p>點選左側手牌，查看下一步。</p>
                  {g.legal.cards.length === 1 && self.hand?.length === 2 && (
                    <p>持有國王或王子時，必須打出伯爵夫人。</p>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="discards self-discards">
            <span>你的公開棄牌</span>
            {self.discards.map((c) => (
              <span key={c.id} title={ROLES[c.value].text}>
                {c.value} {ROLES[c.value].name}
              </span>
            ))}
          </div>
        </section> : (
          <section className="hand-panel spectator-hand-panel">
            <div className="hand-heading">
              <div>
                <span className="eyebrow">SPECTATOR VIEW</span>
                <h3>正在旁觀這場對局</h3>
              </div>
            </div>
            <p className="muted">手牌、私人提示與只有玩家能採取的操作不會顯示。</p>
          </section>
        )}
      </section>
      <aside className="table-sidebar">
        <details className="panel role-reference">
          <summary>
            角色速查 <span>10 種角色</span>
          </summary>
          <div>
            {ROLES.map((r, i) => (
              <div className="reference-row" key={i}>
                <b>{i}</b>
                <div>
                  <strong>
                    {r.name} <small>×{r.count}</small>
                  </strong>
                  <p>{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        </details>
        <section className="panel journal">
          <span className="eyebrow">AT THE TABLE</span>
          <h3>本輪紀錄</h3>
          <ol>
            {[...g.logs].reverse().map((l, i) => (
              <li key={`${g.round}-${g.logs.length - i}`}>{l.text}</li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
