import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, deleteAvatar, uploadAvatar } from "./api";
import type { RoomView, RoomAction } from "../shared/room";
import type { GameInfo } from "../shared/game";
import { gameUis } from "./games";
import { PlayerAvatar } from "./avatar";
import "./style.css";

interface Me {
  id: string;
  name: string;
  isMember: boolean;
  loginId: string | null;
  email: string | null;
  emailVerified: boolean;
  csrf: string;
  mailEnabled: boolean;
  avatarEnabled: boolean;
  avatarUrl: string | null;
  rooms: { id: string; code: string; game_id: string; status: string }[];
}
function App() {
  const [me, setMe] = useState<Me>();
  const [path, setPath] = useState(location.pathname);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [room, setRoom] = useState<RoomView>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState("連線中");
  const [name, setName] = useState("");
  const [code, setCode] = useState(
    new URLSearchParams(location.search).get("join") || "",
  );
  const [panel, setPanel] = useState<"login" | "history" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [loginId, setLoginId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [avatarFile, setAvatarFile] = useState<File>();
  const [history, setHistory] = useState<any>();
  const [first, setFirst] = useState("");
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") || "",
  );
  const [pending, setPending] = useState<{
    operationId: string;
    version: number;
    action: RoomAction;
  }>();
  const actionLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const avatarPreview = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : ""),
    [avatarFile],
  );
  const roomId = path.match(/^\/rooms\/([a-f0-9-]+)$/)?.[1];
  function navigate(to: string) {
    window.history.pushState({}, "", to);
    setPath(location.pathname);
    setError("");
    setNotice("");
    setRoom(undefined);
    setPending(undefined);
  }
  async function refreshMe() {
    const value = await api<Me>("/me");
    setMe(value);
    setName(value.name === "旅人" ? "" : value.name);
    return value;
  }
  async function refreshRoom(id = roomId) {
    if (id) {
      const value = await api<RoomView>(`/rooms/${id}`);
      setRoom((old) =>
        old && old.id === value.id && old.version > value.version ? old : value,
      );
    }
  }
  async function run(fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const pop = () => {
      setPath(location.pathname);
      setRoom(undefined);
      setPending(undefined);
    };
    addEventListener("popstate", pop);
    void refreshMe().catch((e) => setError(e.message));
    void api<GameInfo[]>("/games")
      .then(setGames)
      .catch((e) => setError(e.message));
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (token && path.startsWith("/auth/"))
      window.history.replaceState({}, "", path);
  }, [token]);
  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    else if (!panel) {
      dialog.current?.close();
      setAvatarFile(undefined);
    }
  }, [panel]);
  useEffect(
    () => () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );
  useEffect(() => {
    if (!roomId || !me) return;
    let stop = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const connect = () => {
      if (stop) return;
      setConnection("連線中");
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?room=${roomId}`,
      );
      socket.onopen = () => {
        attempt = 0;
        setConnection("已連線");
      };
      socket.onmessage = (event) => {
        if (stop) return;
        const message = JSON.parse(event.data);
        if (message.type === "room") {
          setRoom((old) =>
            old &&
            old.id === message.room.id &&
            old.version > message.room.version
              ? old
              : message.room,
          );
          setConnection("已連線");
        } else if (message.type === "error") setConnection(message.error);
      };
      socket.onclose = (event) => {
        if (stop) return;
        setConnection("重新連線中");
        if (event.code === 4001 || event.code === 4003) {
          setError("身份或座位已更新，請返回大廳重新加入。");
          return;
        }
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
      };
      socket.onerror = () => socket?.close();
    };
    void refreshRoom(roomId).catch((e) => setError(e.message));
    connect();
    const focus = () => {
      void refreshRoom(roomId).catch((e) => setError(e.message));
    };
    addEventListener("focus", focus);
    return () => {
      stop = true;
      clearTimeout(retry);
      socket?.close();
      removeEventListener("focus", focus);
    };
  }, [roomId, me?.id, me?.csrf]);
  useEffect(() => {
    if (room && !room.members.some((m) => m.id === first))
      setFirst(room.members[0]?.id || "");
  }, [room, first]);
  async function saveName() {
    if (!me) return;
    if (me.isMember) return;
    if (!name.trim()) throw new Error("先取一個暱稱，讓朋友認出你。");
    await api("/profile", { name: name.trim() }, me.csrf);
  }
  async function join(joinCode: string) {
    await saveName();
    const { id } = await api("/rooms/join", { code: joinCode }, me!.csrf);
    await refreshMe();
    navigate(`/rooms/${id}`);
  }
  async function action(action: RoomAction, retry = false) {
    if (!room || !me) return;
    await run(async () => {
      const command =
        retry && pending
          ? pending
          : { operationId: crypto.randomUUID(), version: room.version, action };
      setPending(command);
      try {
        const result = await api(`/rooms/${room.id}/actions`, command, me.csrf);
        setPending(undefined);
        if (result.left) {
          navigate("/");
          await refreshMe();
        } else await refreshRoom();
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500)
          setPending(undefined);
        await refreshRoom().catch(() => {});
        throw e;
      }
    });
  }
  const isHost = room?.hostId === me?.id;
  const self = room?.members.find((m) => m.id === me?.id);
  const roomInfo = room && games.find((g) => g.id === room.gameId);
  const roomUi = room && gameUis[room.gameId];
  const Table = roomUi?.Table;
  return (
    <>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            navigate("/");
            void refreshMe().catch((e) => setError(e.message));
          }}
          aria-label="古楓桌遊，回到大廳"
        >
          <span className="brand-mark" aria-hidden="true">楓</span>
          <span className="brand-wordmark" aria-hidden="true">
            <span className="brand-full">古楓桌遊<small>GFBG</small></span>
            <span className="brand-compact">GFBG</span>
          </span>
        </button>
        <nav>
          <span className="nav-note">把朋友，聚在一桌。</span>
          {me?.isMember ? (
            <>
              <button
                className="text-button"
                onClick={() =>
                  void run(async () => {
                    setHistory(await api("/history"));
                    setPanel("history");
                  })
                }
              >
                我的戰績
              </button>
              <button
                className="avatar-button"
                onClick={() => setPanel("login")}
                aria-label={`開啟 ${me.name} 的帳號設定`}
              >
                <PlayerAvatar name={me.name} src={me.avatarUrl} />
              </button>
            </>
          ) : (
            <button
              className="outline small"
              onClick={() => {
                setAuthMode("login");
                setPanel("login");
              }}
            >
              登入／註冊 <span aria-hidden="true">↗</span>
            </button>
          )}
        </nav>
      </header>
      <main>
        {(error || notice) && (
          <div
            className={`message ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error || notice}
            <button
              aria-label="關閉通知"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              ×
            </button>
          </div>
        )}
        {!me ? (
          <section className="empty-state">
            <span className="eyebrow">WELCOME TO THE TABLE</span>
            <h1>為你留一個位子。</h1>
            <p>正在連接牌桌服務。</p>
            <button
              onClick={() =>
                void run(async () => {
                  await refreshMe();
                  setGames(await api("/games"));
                })
              }
            >
              重新連線
            </button>
          </section>
        ) : path === "/auth/verify-email" ? (
          <section className="auth-confirm panel">
            <span className="eyebrow">ONE LAST STEP</span>
            <h1>驗證你的 Email</h1>
            <p>驗證只確認信箱屬於你，不會讓這個瀏覽器登入。</p>
            <button
              disabled={busy || !token}
              onClick={() =>
                void run(async () => {
                  await api("/auth/verify-email", { token }, me.csrf);
                  await refreshMe();
                  navigate("/");
                  setNotice("Email 驗證完成。");
                })
              }
            >
              驗證 Email
            </button>
            {!token && <p>連結已移除或遺失，請登入後重新寄送驗證信。</p>}
          </section>
        ) : path === "/auth/reset-password" ? (
          <section className="auth-confirm panel">
            <span className="eyebrow">RESET PASSWORD</span>
            <h1>設定新密碼</h1>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  if (newPassword !== newPasswordConfirm)
                    throw new Error("兩次輸入的密碼不一致。");
                  await api("/auth/reset-password", { token, newPassword }, me.csrf);
                  setNewPassword("");
                  setNewPasswordConfirm("");
                  await refreshMe();
                  navigate("/");
                  setAuthMode("login");
                  setPanel("login");
                  setNotice("密碼已重設，請使用新密碼登入。");
                });
              }}
            >
              <label htmlFor="reset-password">新密碼</label>
              <input id="reset-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              <label htmlFor="reset-password-confirm">再次輸入新密碼</label>
              <input id="reset-password-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} />
              <button className="wide" disabled={busy || !token}>儲存新密碼</button>
            </form>
            {!token && <p>連結已移除或遺失，請重新申請重設密碼。</p>}
          </section>
        ) : path === "/games" ? (
          <>
            <section className="games-page-header">
              <button className="text-button" onClick={() => navigate("/")}>
                ← 返回大廳
              </button>
              <span className="eyebrow">THE GAME SHELF</span>
              <h1>今天，玩哪一款？</h1>
              <p>選好遊戲、開一間私人房，再把邀請連結傳給朋友。</p>
            </section>
            <section className="games-profile panel">
              <div>
                <span className="eyebrow">YOUR NAME AT THE TABLE</span>
                <h2>先讓朋友認出你</h2>
                <p>{me.isMember ? "會員名稱由帳號設定管理。" : "暱稱就能開玩；註冊後還能保存對局戰績。"}</p>
              </div>
              <div className="games-profile-field">
                <label htmlFor="games-nickname">{me.isMember ? "你的顯示名稱" : "你的暱稱"}</label>
                <input
                  id="games-nickname"
                  autoComplete="nickname"
                  maxLength={24}
                  placeholder="例如：今晚不當衛兵"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={me.isMember}
                />
              </div>
            </section>
            <section className="library games-library">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ALL GAMES</span>
                  <h2>挑一款，就開桌。</h2>
                </div>
                <span className="muted">{games.length} 款桌遊 · 持續擴充</span>
              </div>
              {games.map((g) => {
                const ui = gameUis[g.id];
                if (!ui) return null;
                return (
                  <article className={`game-feature ${ui.theme}`} key={g.id}>
                    <div className="game-cover">
                      <div className="cover-line">{ui.coverLine}</div>
                      <span className="cover-number">{ui.coverNumber}</span>
                      <div className="cover-title">
                        <span>{ui.englishName.toUpperCase()}</span>
                        <strong>{g.name.split("").join(" ")}</strong>
                        <i>{ui.coverTagline}</i>
                      </div>
                      <div className="cover-bottom">
                        <span>{ui.coverCredit}</span>
                        <span>{ui.coverDetail}</span>
                      </div>
                    </div>
                    <div className="game-description">
                      <span className="pill">{ui.genres}</span>
                      <h3>
                        {g.name}
                        <span>{ui.englishName}</span>
                      </h3>
                      <p>{g.description}</p>
                      <div className="game-facts">
                        <div>
                          <strong>{g.minPlayers}–{g.maxPlayers}</strong>
                          <span>位玩家</span>
                        </div>
                        <div>
                          <strong>{ui.duration}</strong>
                          <span>左右一局</span>
                        </div>
                        <div>
                          <strong>{ui.complexity}</strong>
                          <span>{ui.complexityNote}</span>
                        </div>
                      </div>
                      <button
                        className="wide"
                        disabled={busy || !name.trim()}
                        onClick={() =>
                          void run(async () => {
                            await saveName();
                            const { id } = await api(
                              "/rooms",
                              { gameId: g.id },
                              me.csrf,
                            );
                            await refreshMe();
                            navigate(`/rooms/${id}`);
                          })
                        }
                      >
                        建立私人房間 <span aria-hidden="true">↗</span>
                      </button>
                      <small>
                        {name.trim()
                          ? "把房間連結傳給朋友，就能一起玩。"
                          : "先在上方填入暱稱，就能開桌。"}
                      </small>
                    </div>
                  </article>
                );
              })}
            </section>
            <footer>
              <span>古楓桌遊 GFBG</span>
              <span>一點運氣，一點默契。剩下的，交給朋友。</span>
            </footer>
          </>
        ) : !roomId ? (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">
                  <span className="tiny-seal">◇</span> GOOD COMPANY. GREAT
                  GAMES.
                </span>
                <h1>
                  今晚，
                  <br />
                  來點<span className="accent">心機。</span>
                </h1>
                <p>
                  不必出門，也能圍坐一桌。
                  <br />
                  選一款遊戲，邀請朋友，好戲就開場。
                </p>
                <button className="hero-games-button" onClick={() => navigate("/games")}>
                  選擇遊戲 <span aria-hidden="true">→</span>
                </button>
                <div className="hero-foot">
                  <span>私人房間</span>
                  <span>免註冊開玩</span>
                  <span>手機也能加入</span>
                </div>
              </div>
              <aside className="join-panel">
                <span className="eyebrow">YOUR SEAT AT THE TABLE</span>
                <h2>先讓朋友認出你</h2>
                <label htmlFor="nickname">你的暱稱</label>
                <input
                  id="nickname"
                  autoComplete="nickname"
                  maxLength={24}
                  placeholder="例如：今晚不當衛兵"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => join(code));
                  }}
                >
                  <label htmlFor="room-code">有朋友開好房了？</label>
                  <div className="join-row">
                    <input
                      id="room-code"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      maxLength={8}
                      placeholder="8 碼房間代碼"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                    />
                    <button
                      type="submit"
                      disabled={busy || !name.trim() || code.length !== 8}
                    >
                      加入 <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </form>
                <p className="muted small-copy">
                  暱稱就能玩。註冊或登入後，可保存你的對局戰績。
                </p>
              </aside>
            </section>
            {me.rooms.length > 0 && (
              <section className="resume">
                <div className="section-heading">
                  <h2>你的牌桌還在</h2>
                  <span className="muted">繼續剛才的對局</span>
                </div>
                <div className="resume-list">
                  {me.rooms.map((r) => (
                    <button
                      className="resume-room"
                      key={r.id}
                      disabled={busy}
                      onClick={() => void run(() => join(r.code))}
                    >
                      <span>
                        {games.find((g) => g.id === r.game_id)?.name || r.game_id}{" "}
                        <small>
                          {r.status === "active" ? "進行中" : "等待朋友"}
                        </small>
                      </span>
                      <strong>{r.code} →</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <footer>
              <span>古楓桌遊 GFBG</span>
              <span>一點運氣，一點默契。剩下的，交給朋友。</span>
            </footer>
          </>
        ) : !room ? (
          <section className="empty-state">
            <h1>正在打開牌桌</h1>
            <p>{connection}</p>
            <button onClick={() => navigate("/")}>返回大廳</button>
          </section>
        ) : (
          <>
            <div className="room-heading">
              <div>
                <span className="eyebrow">PRIVATE TABLE / {roomInfo?.name || room.gameId}</span>
                <h1>
                  {room.status === "waiting"
                    ? "人到齊，就開場。"
                    : room.status === "aborted"
                      ? "這桌已結束。"
                      : room.status === "finished"
                        ? "這場已結束。"
                      : roomUi?.activeTitle || "對局進行中。"}
                </h1>
              </div>
              <div className="room-tools">
                <span className="connection">{connection}</span>
                <button
                  className="outline small"
                  onClick={() =>
                    void run(async () => {
                      const link = `${location.origin}/?join=${room.code}`;
                      try {
                        await navigator.clipboard.writeText(link);
                        setNotice("邀請連結已複製。");
                      } catch {
                        setNotice(`邀請朋友開啟 ${link}`);
                      }
                    })
                  }
                >
                  邀請朋友 · {room.code}
                </button>
              </div>
            </div>
            {pending && !busy && (
              <div className="message" role="alert">
                上次操作結果尚未確認。
                <button onClick={() => void action(pending.action, true)}>
                  重試同一操作
                </button>
              </div>
            )}
            {room.status === "waiting" ? (
              <section className="waiting-layout">
                <div className="panel seats-panel">
                  <span className="eyebrow">THE COMPANY</span>
                  <h2>
                    這一桌的朋友{" "}
                    <span className="muted">{room.members.length} / {roomInfo?.maxPlayers}</span>
                  </h2>
                  <div className="waiting-seats">
                    {room.members.map((m, i) => (
                      <div className="waiting-seat" key={m.id}>
                        <span className="seat-number">0{i + 1}</span>
                        <PlayerAvatar name={m.name} src={m.avatarUrl} />
                        <div>
                          <strong>
                            {m.name}
                            {m.id === me.id && "（你）"}
                          </strong>
                          <small>
                            {m.id === room.hostId ? "房主 · " : ""}
                            {m.online ? "在線" : "離線"}
                          </small>
                        </div>
                        <span className={m.ready ? "ready-label" : "muted"}>
                          {m.ready ? "已準備" : "還沒準備"}
                        </span>
                      </div>
                    ))}
                    {Array.from(
                      { length: Math.max(0, (roomInfo?.minPlayers || 2) - room.members.length) },
                      (_, i) => (
                        <div className="waiting-seat vacant" key={i}>
                          <span className="player-avatar">＋</span>
                          <span>為下一位朋友留座</span>
                        </div>
                      ),
                    )}
                  </div>
                  <button
                    className={self?.ready ? "outline wide" : "wide"}
                    disabled={busy || !!pending}
                    onClick={() =>
                      void action({ type: "ready", ready: !self?.ready })
                    }
                  >
                    {self?.ready ? "取消準備" : "我準備好了"}
                  </button>
                </div>
                <aside className="panel start-panel">
                  <span className="eyebrow">BEFORE WE BEGIN</span>
                  <h2>{roomUi?.waitingTitle}</h2>
                  <ol>
                    {roomUi?.waitingSteps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  <p className="muted">{roomUi?.waitingSummary}</p>
                  {isHost ? (
                    <>
                      {roomInfo?.firstPlayerPolicy === "host-choice" ? (
                        <>
                          <label htmlFor="first-player">誰先開始？</label>
                          <select id="first-player" value={first} onChange={(e) => setFirst(e.target.value)}>
                            {room.members.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}
                          </select>
                        </>
                      ) : <p className="muted">開始時會隨機決定第一位玩家。</p>}
                      <button
                        className="wide"
                        disabled={
                          busy ||
                          !!pending ||
                          room.members.length < (roomInfo?.minPlayers || 2) ||
                          !room.members.every((m) => m.ready)
                        }
                        onClick={() => void action({ type: "start", ...(roomInfo?.firstPlayerPolicy === "host-choice" ? { first } : {}) })}
                      >
                        開始遊戲 →
                      </button>
                      <small>至少 {roomInfo?.minPlayers || 2} 人，且每位玩家都已準備。</small>
                    </>
                  ) : (
                    <p>準備好後，等待房主開始。</p>
                  )}
                </aside>
              </section>
            ) : room.status === "aborted" ? (
              <section className="empty-state panel">
                <h2>對局已終止，不計入戰績。</h2>
                <p>還想再來一局？回大廳重新開桌。</p>
                <button
                  onClick={() => {
                    navigate("/");
                    void refreshMe().catch((e) => setError(e.message));
                  }}
                >
                  返回大廳
                </button>
              </section>
            ) : Table && room.game ? (
              <Table
                room={room}
                me={me.id}
                busy={busy || !!pending || connection !== "已連線"}
                onAction={(a) => void action(a)}
              />
            ) : (
              <p>此遊戲介面尚未註冊。</p>
            )}
            {room.status === "finished" && (
              <section className="panel rematch-panel">
                <div>
                  <span className="eyebrow">NEXT GAME</span>
                  <h2>同桌，再來一場？</h2>
                  <p className="muted">返回準備大廳後，所有人需要重新準備。</p>
                </div>
                {isHost ? (
                  <button
                    disabled={busy || !!pending}
                    onClick={() => void action({ type: "returnToLobby" })}
                  >
                    回到準備大廳 →
                  </button>
                ) : (
                  <p>等待房主帶大家回到準備大廳。</p>
                )}
              </section>
            )}
            <div className="room-bottom">
              <button
                className="text-button"
                onClick={() => {
                  navigate("/");
                  void refreshMe().catch((e) => setError(e.message));
                }}
              >
                ← 返回大廳（保留座位）
              </button>
              {room.status !== "active" && (
                <button
                  className="text-button"
                  disabled={busy || !!pending}
                  onClick={() => void action({ type: "leave" })}
                >
                  離開座位
                </button>
              )}
              {isHost && ["active", "waiting"].includes(room.status) && (
                <button
                  className="text-button danger"
                  disabled={busy || !!pending}
                  onClick={() => {
                    if (window.confirm("確定終止整場對局？這場不會計入戰績。"))
                      void action({ type: "abort" });
                  }}
                >
                  終止對局
                </button>
              )}
            </div>
          </>
        )}
      </main>
    <dialog
      ref={dialog}
      aria-label={
        panel === "history" ? "我的戰績" : me?.isMember ? "我的帳號" : "登入或註冊"
      }
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setPanel(null);
        }}
      >
        <div className="dialog-inner">
          <button
            className="close-dialog"
            aria-label="關閉"
            onClick={() => setPanel(null)}
          >
            ×
          </button>
          {panel === "login" ? (
            <>
              <span className="eyebrow">MAKE IT YOUR TABLE</span>
              <h2>{me?.isMember ? "你的帳號" : "留住每一場精彩。"}</h2>
              {me?.isMember ? (
                <>
                  <div className="avatar-profile">
                    <PlayerAvatar
                      name={me.name}
                      src={avatarPreview || me.avatarUrl}
                      className="profile-avatar"
                    />
                    <div>
                      <strong>{me.name}</strong>
                      <p>@{me.loginId} · {me.email}</p>
                      <small className={me.emailVerified ? "verified" : "muted"}>
                        {me.emailVerified ? "Email 已驗證" : "Email 尚未驗證"}
                      </small>
                    </div>
                  </div>
                  {!me.emailVerified && (
                    <button
                      className="outline wide"
                      disabled={busy || !me.mailEnabled}
                      onClick={() =>
                        void run(async () => {
                          const result = await api<{ verificationSent: boolean }>(
                            "/auth/resend-verification",
                            {},
                            me.csrf,
                          );
                          setNotice(
                            result.verificationSent
                              ? "驗證信已寄出，請在 24 小時內開啟連結。"
                              : "驗證信目前無法寄送，帳號仍可正常使用。",
                          );
                        })
                      }
                    >
                      {me.mailEnabled ? "重新寄送驗證信" : "驗證信服務尚未設定"}
                    </button>
                  )}
                  <form
                    className="account-section"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        if (!name.trim()) throw new Error("顯示名稱不可空白。");
                        await api("/profile", { name: name.trim() }, me.csrf);
                        await refreshMe();
                        setNotice("顯示名稱已更新；進行中的對局會保留開局名稱。");
                      });
                    }}
                  >
                    <label htmlFor="account-display-name">顯示名稱</label>
                    <input id="account-display-name" autoComplete="nickname" maxLength={24} required value={name} onChange={(event) => setName(event.target.value)} />
                    <button className="outline" disabled={busy || name.trim() === me.name}>儲存顯示名稱</button>
                  </form>
                  <form
                    className="account-section"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        if (newPassword !== newPasswordConfirm)
                          throw new Error("兩次輸入的新密碼不一致。");
                        await api(
                          "/auth/change-password",
                          { currentPassword, newPassword },
                          me.csrf,
                        );
                        setCurrentPassword("");
                        setNewPassword("");
                        setNewPasswordConfirm("");
                        await refreshMe();
                        setNotice("密碼已更新，其他裝置已登出。");
                      });
                    }}
                  >
                    <label htmlFor="current-password">目前密碼</label>
                    <input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                    <label htmlFor="new-password">新密碼</label>
                    <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                    <label htmlFor="new-password-confirm">再次輸入新密碼</label>
                    <input id="new-password-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} />
                    <button className="outline" disabled={busy}>更新密碼</button>
                  </form>
                  <div className="avatar-picker">
                    <label htmlFor="avatar-file">會員頭像</label>
                    <input
                      id="avatar-file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy || !me.avatarEnabled}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return setAvatarFile(undefined);
                        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                          setAvatarFile(undefined);
                          setError("只支援 JPEG、PNG 或 WebP 圖片。");
                          event.target.value = "";
                          return;
                        }
                        if (file.size > 5 * 1024 * 1024) {
                          setAvatarFile(undefined);
                          setError("圖片不可超過 5 MiB。");
                          event.target.value = "";
                          return;
                        }
                        setError("");
                        setAvatarFile(file);
                      }}
                    />
                    <small className="muted">
                      自動置中裁成正方形，支援 JPEG、PNG、WebP，最多 5 MiB。
                    </small>
                    {error && <p className="inline-error" role="alert">{error}</p>}
                    {!me.avatarEnabled && (
                      <p className="muted">頭像儲存服務尚未設定。</p>
                    )}
                    <div className="avatar-actions">
                      <button
                        disabled={busy || !avatarFile || !me.avatarEnabled}
                        onClick={() =>
                          void run(async () => {
                            await uploadAvatar(avatarFile!, me.csrf);
                            setAvatarFile(undefined);
                            await refreshMe();
                            setPanel(null);
                            setNotice("頭像已更新。");
                          })
                        }
                      >
                        儲存頭像
                      </button>
                      {me.avatarUrl && (
                        <button
                          className="text-button danger"
                          disabled={busy || !me.avatarEnabled}
                          onClick={() =>
                            void run(async () => {
                              await deleteAvatar(me.csrf);
                              setAvatarFile(undefined);
                              await refreshMe();
                              setPanel(null);
                              setNotice("頭像已移除。");
                            })
                          }
                        >
                          移除頭像
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="muted">完整對局會自動保存到你的戰績。</p>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("/auth/logout", {}, me.csrf);
                        await refreshMe();
                        setPanel(null);
                        navigate("/");
                      })
                    }
                  >
                    登出
                  </button>
                </>
              ) : (
                <>
                  <div className="auth-tabs" role="tablist" aria-label="帳號操作">
                    <button type="button" className={authMode === "login" ? "active" : "text-button"} onClick={() => setAuthMode("login")}>登入</button>
                    <button type="button" className={authMode === "register" ? "active" : "text-button"} onClick={() => setAuthMode("register")}>註冊</button>
                  </div>
                  {authMode === "login" ? (
                    <form
                      onSubmit={(event: FormEvent) => {
                        event.preventDefault();
                        void run(async () => {
                          await api("/auth/login", { loginId, password }, me!.csrf);
                          setPassword("");
                          await refreshMe();
                          setPanel(null);
                          setNotice("登入成功，進行中的座位已保留。");
                        });
                      }}
                    >
                      <p>使用登入帳號與密碼登入；Email 不可用來登入。</p>
                      <label htmlFor="login-id">登入帳號</label>
                      <input id="login-id" autoComplete="username" pattern="[A-Za-z][A-Za-z0-9_]{2,23}" required value={loginId} onChange={(event) => setLoginId(event.target.value)} />
                      <label htmlFor="login-password">密碼</label>
                      <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
                      <button className="wide" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
                      <button type="button" className="text-button wide" onClick={() => setAuthMode("forgot")}>忘記密碼</button>
                    </form>
                  ) : authMode === "register" ? (
                    <form
                      onSubmit={(event: FormEvent) => {
                        event.preventDefault();
                        void run(async () => {
                          if (password !== passwordConfirm)
                            throw new Error("兩次輸入的密碼不一致。");
                          if (!name.trim()) throw new Error("請輸入顯示名稱。");
                          const result = await api<{ verificationSent: boolean }>(
                            "/auth/register",
                            { loginId, displayName: name.trim(), email, password },
                            me!.csrf,
                          );
                          setPassword("");
                          setPasswordConfirm("");
                          await refreshMe();
                          setPanel(null);
                          setNotice(
                            result.verificationSent
                              ? "註冊完成，驗證信已寄出。"
                              : "註冊完成；驗證信目前無法寄送，可稍後從帳號設定重寄。",
                          );
                        });
                      }}
                    >
                      <p>註冊後立即登入；Email 只用於驗證與重設密碼。</p>
                      <label htmlFor="register-login-id">登入帳號</label>
                      <input id="register-login-id" autoComplete="username" pattern="[A-Za-z][A-Za-z0-9_]{2,23}" minLength={3} maxLength={24} required value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="例如 maple_player" />
                      <small className="muted">英文字母開頭，只能使用英數與底線，建立後不可修改。</small>
                      <label htmlFor="register-display-name">顯示名稱</label>
                      <input id="register-display-name" autoComplete="nickname" maxLength={24} required value={name} onChange={(event) => setName(event.target.value)} />
                      <label htmlFor="register-email">驗證 Email</label>
                      <input id="register-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                      <label htmlFor="register-password">密碼</label>
                      <input id="register-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
                      <label htmlFor="register-password-confirm">再次輸入密碼</label>
                      <input id="register-password-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} />
                      <button className="wide" disabled={busy}>{busy ? "建立中…" : "建立帳號"}</button>
                    </form>
                  ) : (
                    <form
                      onSubmit={(event: FormEvent) => {
                        event.preventDefault();
                        void run(async () => {
                          await api("/auth/forgot-password", { email }, me!.csrf);
                          setPanel(null);
                          setNotice("若此 Email 綁定已驗證帳號，重設信會在幾分鐘內寄出。");
                        });
                      }}
                    >
                      <p>輸入已驗證的 Email。我們不會透露是否存在對應帳號。</p>
                      <label htmlFor="forgot-email">驗證 Email</label>
                      <input id="forgot-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} />
                      <button className="wide" disabled={busy}>{busy ? "處理中…" : "寄送重設信"}</button>
                      <button type="button" className="text-button wide" onClick={() => setAuthMode("login")}>返回登入</button>
                    </form>
                  )}
                  <p className="small-copy muted">訪客仍可直接遊玩；註冊後可保存戰績與設定頭像。</p>
                </>
              )}
            </>
          ) : panel === "history" && history ? (
            <>
              <span className="eyebrow">YOUR GAME JOURNAL</span>
              <h2>每一局，都算數。</h2>
              <div className="history-summary">
                <div>
                  <strong>{history.summary.played}</strong>
                  <span>完成對局</span>
                </div>
                <div>
                  <strong>{history.summary.won}</strong>
                  <span>獲勝</span>
                </div>
                <div>
                  <strong>
                    {history.summary.played
                      ? Math.round(
                          (history.summary.won / history.summary.played) * 100,
                        )
                      : 0}
                    %
                  </strong>
                  <span>勝率</span>
                </div>
              </div>
              {history.matches.length ? (
                <div className="history-list">
                  {history.matches.map((m: any) => (
                    <div key={m.match_id}>
                      <span>
                        {games.find((g) => g.id === m.game_id)?.name || m.game_id}{" "}
                        <small>
                          {new Date(m.finished_at).toLocaleDateString("zh-TW")}
                        </small>
                      </span>
                      <strong>{gameUis[m.game_id]?.score(m.score) || m.score}</strong>
                      {gameUis[m.game_id]?.showHistoryStatus && (
                        <span className={m.won ? "ready-label" : "muted"}>
                          {m.won ? "獲勝" : "完成"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p>還沒有完整對局。找幾位朋友，開第一桌吧。</p>
              )}
            </>
          ) : null}
          {error && panel && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
