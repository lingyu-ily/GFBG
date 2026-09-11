import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ChatChannel, ChatMessage } from "../shared/chat";
import type { RoomView } from "../shared/room";
import { api } from "./api";
import { PlayerAvatar } from "./avatar";

interface ChatWidgetProps {
  me: {
    id: string;
    isMember: boolean;
    csrf: string;
  };
  room?: Pick<RoomView, "id" | "code" | "viewerRole">;
  messages: Record<ChatChannel, ChatMessage[]>;
  liveMessage?: { nonce: string; message: ChatMessage };
  onMessage: (message: ChatMessage) => void;
  onLogin: () => void;
}

const time = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
});

export function ChatWidget({
  me,
  room,
  messages,
  liveMessage,
  onMessage,
  onLogin,
}: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ChatChannel>("public");
  const [drafts, setDrafts] = useState<Record<ChatChannel, string>>({
    public: "",
    room: "",
  });
  const [unread, setUnread] = useState<Record<ChatChannel, number>>({
    public: 0,
    room: 0,
  });
  const [preview, setPreview] = useState<ChatMessage>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [pending, setPending] = useState<{
    channel: ChatChannel;
    id: string;
    text: string;
  }>();
  const list = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeMessages = messages[active];
  const totalUnread = unread.public + (room ? unread.room : 0);

  useEffect(() => {
    if (!room && active === "room") setActive("public");
    if (!room) {
      setUnread((old) => ({ ...old, room: 0 }));
      setPreview((old) => (old?.channel === "room" ? undefined : old));
    }
  }, [room?.id, active]);

  useEffect(() => {
    if (open) setUnread((old) => ({ ...old, [active]: 0 }));
  }, [open, active]);

  useEffect(() => {
    if (!liveMessage) return;
    const message = liveMessage.message;
    if (message.sender.playerId === me.id) return;
    if (!(open && active === message.channel))
      setUnread((old) => ({
        ...old,
        [message.channel]: old[message.channel] + 1,
      }));
    if (!open) {
      setPreview(message);
      clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => setPreview(undefined), 6000);
    }
    return () => clearTimeout(previewTimer.current);
  }, [liveMessage?.nonce]);

  useEffect(() => {
    if (!open || !stickToBottom.current) return;
    requestAnimationFrame(() => {
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
    });
  }, [open, active, activeMessages.length]);

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  const endpoint = useMemo(() => {
    if (active === "public") return "/chat/public";
    if (!room) return "";
    return room.viewerRole === "spectator"
      ? `/rooms/watch/${room.code}/chat`
      : `/rooms/${room.id}/chat`;
  }, [active, room?.id, room?.code, room?.viewerRole]);

  function choose(channel: ChatChannel) {
    stickToBottom.current = true;
    setActive(channel);
    setSendError("");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!me.isMember || !endpoint || sending) return;
    const text = drafts[active].trim();
    if (!text) return;
    const id =
      pending?.channel === active && pending.text === text
        ? pending.id
        : crypto.randomUUID();
    setPending({ channel: active, id, text });
    setSending(true);
    setSendError("");
    try {
      const result = await api<{ message: ChatMessage }>(
        endpoint,
        { messageId: id, text },
        me.csrf,
      );
      onMessage(result.message);
      setDrafts((old) => ({ ...old, [active]: "" }));
      setPending(undefined);
      stickToBottom.current = true;
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className={`chat-widget ${open ? "open" : ""}`} aria-label="聊天室">
      {!open && preview && (
        <button
          className="chat-preview"
          type="button"
          onClick={() => {
            clearTimeout(previewTimer.current);
            setPreview(undefined);
            choose(preview.channel);
            setOpen(true);
          }}
          aria-label={`開啟${preview.channel === "public" ? "公開" : "房間"}聊天室查看新訊息`}
        >
          <small>{preview.channel === "public" ? "公開" : "房間"} · {preview.sender.name}</small>
          <span>{preview.text}</span>
        </button>
      )}

      {open && (
        <section className="chat-panel">
          <div className="chat-heading">
            <div>
              <span className="eyebrow">TABLE TALK</span>
              <h2>聊天室</h2>
            </div>
            <button
              className="chat-close"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收合聊天室"
            >
              ×
            </button>
          </div>

          <div className="chat-tabs" role="tablist" aria-label="聊天頻道">
            <button
              type="button"
              role="tab"
              aria-selected={active === "public"}
              className={active === "public" ? "active" : ""}
              onClick={() => choose("public")}
            >
              公開{unread.public > 0 && <b>{Math.min(unread.public, 99)}</b>}
            </button>
            {room && (
              <button
                type="button"
                role="tab"
                aria-selected={active === "room"}
                className={active === "room" ? "active" : ""}
                onClick={() => choose("room")}
              >
                房間{unread.room > 0 && <b>{Math.min(unread.room, 99)}</b>}
              </button>
            )}
          </div>

          <div
            className="chat-messages"
            ref={list}
            role="log"
            aria-live="polite"
            aria-label={active === "public" ? "公開聊天訊息" : "房間聊天訊息"}
            onScroll={(event) => {
              const target = event.currentTarget;
              stickToBottom.current =
                target.scrollHeight - target.scrollTop - target.clientHeight < 36;
            }}
          >
            {activeMessages.length ? (
              activeMessages.map((message) => {
                const own = message.sender.playerId === me.id;
                return (
                  <article className={`chat-message ${own ? "own" : ""}`} key={message.id}>
                    {!own && (
                      <PlayerAvatar
                        name={message.sender.name}
                        src={message.sender.avatarUrl}
                      />
                    )}
                    <div>
                      <header>
                        <strong>{own ? "你" : message.sender.name}</strong>
                        <time dateTime={message.createdAt}>
                          {time.format(new Date(message.createdAt))}
                        </time>
                      </header>
                      <p>{message.text}</p>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="chat-empty">還沒有訊息，這裡很安靜。</p>
            )}
          </div>

          {me.isMember ? (
            <form className="chat-composer" onSubmit={send}>
              {sendError && <p role="alert">{sendError}</p>}
              <div>
                <input
                  aria-label={`傳送到${active === "public" ? "公開" : "房間"}聊天`}
                  placeholder="輸入訊息…"
                  maxLength={500}
                  value={drafts[active]}
                  onChange={(event) => {
                    setDrafts((old) => ({ ...old, [active]: event.target.value }));
                    setPending(undefined);
                    setSendError("");
                  }}
                />
                <button disabled={sending || !drafts[active].trim()}>
                  {sending ? "傳送中" : "傳送"}
                </button>
              </div>
            </form>
          ) : (
            <div className="chat-login-note">
              <span>登入會員即可發送訊息。</span>
              <button type="button" className="text-button" onClick={onLogin}>
                登入／註冊
              </button>
            </div>
          )}
        </section>
      )}

      <button
        className="chat-toggle"
        type="button"
        onClick={() => {
          setPreview(undefined);
          clearTimeout(previewTimer.current);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-label={open ? "收合聊天室" : "展開聊天室"}
      >
        <span aria-hidden="true">{open ? "×" : "聊"}</span>
        {!open && totalUnread > 0 && (
          <b aria-label={`${totalUnread} 則未讀訊息`}>{Math.min(totalUnread, 99)}</b>
        )}
      </button>
    </aside>
  );
}
