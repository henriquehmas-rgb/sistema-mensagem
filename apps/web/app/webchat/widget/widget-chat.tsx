"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  MessageCircle,
  RefreshCw,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";

import type { MessageDto, MessageStatus } from "@sm/shared";

import {
  URL_SPLIT_REGEX,
  formatMessageTime,
  getMessagePreview,
  isHttpUrl,
  isMediaContent,
  isTextContent,
} from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Contrato do namespace /webchat (apps/api/src/webchat/webchat.gateway.ts):
// auth = { token: visitorToken }; servidor emite message:new {message},
// message:status {messageId, conversationId, status} e typing; cliente emite
// apenas typing {isTyping}.
// ---------------------------------------------------------------------------

interface WebchatServerToClientEvents {
  "message:new": (p: { message: MessageDto }) => void;
  "message:status": (p: {
    messageId: string;
    conversationId: string;
    status: MessageStatus;
  }) => void;
  typing: (p: {
    conversationId: string;
    userId?: string;
    contactId?: string;
    isTyping: boolean;
  }) => void;
}

interface WebchatClientToServerEvents {
  typing: (p: { isTyping: boolean }) => void;
}

type WebchatSocket = Socket<WebchatServerToClientEvents, WebchatClientToServerEvents>;

interface SessionInfo {
  visitorToken: string;
  conversationId: string;
  orgName: string;
}

const API_BASE = "/api/webchat";
const SOCKET_NAMESPACE = "/webchat";
const TEMP_PREFIX = "tmp-";
const TYPING_IDLE_MS = 2_200;
const TYPING_DISPLAY_MS = 8_000;
const POLL_INTERVAL_MS = 5_000;
const HISTORY_LIMIT = 100;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

async function requestJson<T>(
  path: string,
  options: { method?: "GET" | "POST"; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new HttpError(0);
  }
  if (!response.ok) throw new HttpError(response.status);
  return (await response.json()) as T;
}

// localStorage pode estar bloqueado em iframe third-party (Safari/ITP) —
// toda leitura/escrita é best-effort e o widget funciona só em memória.
function readStoredSession(org: string): SessionInfo | null {
  try {
    const raw = window.localStorage.getItem(`sm-webchat:${org}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionInfo>;
    if (typeof parsed.visitorToken !== "string" || typeof parsed.conversationId !== "string") {
      return null;
    }
    return {
      visitorToken: parsed.visitorToken,
      conversationId: parsed.conversationId,
      orgName: typeof parsed.orgName === "string" ? parsed.orgName : "",
    };
  } catch {
    return null;
  }
}

function writeStoredSession(org: string, session: SessionInfo | null): void {
  try {
    if (session) {
      window.localStorage.setItem(`sm-webchat:${org}`, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(`sm-webchat:${org}`);
    }
  } catch {
    /* storage indisponível — segue em memória */
  }
}

function readMuted(org: string): boolean {
  try {
    return window.localStorage.getItem(`sm-webchat:muted:${org}`) === "1";
  } catch {
    return false;
  }
}

function writeMuted(org: string, muted: boolean): void {
  try {
    window.localStorage.setItem(`sm-webchat:muted:${org}`, muted ? "1" : "0");
  } catch {
    /* noop */
  }
}

/** URL de mídia segura: http(s) absoluto ou caminho relativo do próprio host. */
function safeMediaUrl(url: string): string | null {
  if (isHttpUrl(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return null;
}

function prettifySlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Insere/atualiza uma mensagem vinda do servidor, reconciliando otimistas. */
function mergeServerMessage(list: MessageDto[], incoming: MessageDto): MessageDto[] {
  if (list.some((m) => m.id === incoming.id)) {
    return list.map((m) => (m.id === incoming.id ? incoming : m));
  }
  if (incoming.direction === "INBOUND" && isTextContent(incoming.content)) {
    const text = incoming.content.text;
    const tempIndex = list.findIndex(
      (m) =>
        m.id.startsWith(TEMP_PREFIX) &&
        m.status !== "FAILED" &&
        isTextContent(m.content) &&
        m.content.text === text,
    );
    if (tempIndex >= 0) {
      const next = [...list];
      next[tempIndex] = incoming;
      return next;
    }
  }
  return [...list, incoming];
}

// ---------------------------------------------------------------------------
// Tokens de design escopados: o app usa next-themes com tema fixo (html.dark),
// mas o widget respeita o prefers-color-scheme do VISITANTE — redefinimos as
// variáveis do design system no wrapper .wc-root (vencem as do html por
// especificidade de cascata no elemento mais próximo).
// ---------------------------------------------------------------------------

const WC_THEME_CSS = `
.wc-root{
  --background:240 20% 99%;--foreground:240 10% 9%;
  --card:0 0% 100%;--card-foreground:240 10% 9%;
  --muted:240 6% 95%;--muted-foreground:240 4% 45%;
  --border:240 6% 90%;--input:240 6% 87%;
  --primary:243 75% 59%;--primary-foreground:0 0% 100%;
  --secondary:240 6% 94%;--secondary-foreground:240 8% 20%;
  --accent:244 75% 96%;--accent-foreground:243 66% 45%;
  --destructive:0 72% 51%;--destructive-foreground:0 0% 100%;
  --success:152 60% 36%;--success-foreground:0 0% 100%;
  --status-read:197 100% 82%;--status-failed:0 100% 86%;
  --ring:243 75% 59%;
  --brand-from:243 75% 59%;--brand-to:262 83% 58%;
}
@media (prefers-color-scheme: dark){
  .wc-root{
    --background:240 10% 4%;--foreground:240 10% 94%;
    --card:240 8% 7%;--card-foreground:240 10% 94%;
    --muted:240 6% 11%;--muted-foreground:240 5% 62%;
    --border:240 6% 14%;--input:240 6% 17%;
    --primary:239 84% 67%;--primary-foreground:0 0% 100%;
    --secondary:240 6% 13%;--secondary-foreground:240 8% 86%;
    --accent:243 40% 17%;--accent-foreground:240 90% 88%;
    --destructive:0 66% 56%;--destructive-foreground:0 0% 100%;
    --success:152 55% 46%;--success-foreground:152 80% 8%;
    --status-read:199 95% 74%;--status-failed:0 94% 80%;
    --ring:239 84% 67%;
    --brand-from:243 72% 62%;--brand-to:262 80% 62%;
  }
}
`;

// ---------------------------------------------------------------------------
// Subcomponentes de mensagem — texto SEMPRE como texto puro (nunca HTML).
// ---------------------------------------------------------------------------

function PlainLinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_REGEX);
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 opacity-90 hover:opacity-100"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

function MessageBody({ message }: { message: MessageDto }) {
  const { content, type } = message;

  if (isMediaContent(content)) {
    const url = safeMediaUrl(content.mediaUrl);
    if (url) {
      if (type === "IMAGE" || type === "STICKER") {
        return (
          <span className="block">
            <a href={url} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={content.caption ?? "Imagem enviada na conversa"}
                loading="lazy"
                className="max-h-64 w-full rounded-lg object-cover"
              />
            </a>
            {content.caption ? (
              <span className="mt-1.5 block">
                <PlainLinkifiedText text={content.caption} />
              </span>
            ) : null}
          </span>
        );
      }
      if (type === "AUDIO") {
        return <audio controls preload="metadata" src={url} className="max-w-full" />;
      }
      if (type === "VIDEO") {
        return (
          <span className="block">
            <video controls preload="metadata" src={url} className="max-h-64 w-full rounded-lg" />
            {content.caption ? (
              <span className="mt-1.5 block">
                <PlainLinkifiedText text={content.caption} />
              </span>
            ) : null}
          </span>
        );
      }
      // DOCUMENT e demais mídias: link para abrir/baixar.
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 underline underline-offset-2 opacity-90 hover:opacity-100"
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{content.filename ?? "Abrir documento"}</span>
        </a>
      );
    }
  }

  if (isTextContent(content)) {
    return <PlainLinkifiedText text={content.text} />;
  }

  return <span className="italic opacity-80">{getMessagePreview(message)}</span>;
}

function StatusTicks({ status }: { status: MessageStatus }) {
  switch (status) {
    case "PENDING":
      return <Clock className="h-3 w-3 opacity-70" aria-label="Enviando" />;
    case "FAILED":
      return <AlertCircle className="h-3.5 w-3.5 text-status-failed" aria-label="Falha no envio" />;
    case "READ":
      return <CheckCheck className="h-3.5 w-3.5 text-status-read" aria-label="Lida" />;
    case "DELIVERED":
      return <CheckCheck className="h-3.5 w-3.5 opacity-80" aria-label="Entregue" />;
    default:
      return <Check className="h-3.5 w-3.5 opacity-80" aria-label="Enviada" />;
  }
}

function TypingDots() {
  return (
    <div className="flex justify-start" aria-live="polite">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-muted px-3.5 py-3 shadow-soft">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:300ms]" />
        <span className="sr-only">Atendente está digitando…</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

type WidgetStatus = "loading" | "ready" | "error";

export function WidgetChat({ org, parentOrigin }: { org: string; parentOrigin: string }) {
  const validParentOrigin = useMemo(
    () => (/^https?:\/\/[^\s/]+$/.test(parentOrigin) ? parentOrigin : ""),
    [parentOrigin],
  );

  const [status, setStatus] = useState<WidgetStatus>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [muted, setMuted] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  const socketRef = useRef<WebchatSocket | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const sessionPromiseRef = useRef<Promise<SessionInfo> | null>(null);
  const bootstrappedRef = useRef(false);
  const openRef = useRef(false);
  const mutedRef = useRef(false);
  const unreadRef = useRef(0);
  const lastServerIdRef = useRef<string | null>(null);
  const pollBusyRef = useRef(false);
  const typingSentRef = useRef(false);
  const typingIdleTimerRef = useRef<number | null>(null);
  const agentTypingTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tempSeqRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const orgName = session?.orgName || prettifySlug(org) || "Atendimento";

  // ------------------------------------------------------------- postMessage
  const postToParent = useCallback(
    (data: Record<string, unknown>) => {
      if (typeof window === "undefined" || window.parent === window) return;
      // Validação bilateral de origin: sem ?parent= válido, NENHUM postMessage
      // é feito (nunca targetOrigin "*"). O loader sempre envia ?parent=, então
      // o fluxo legítimo não é afetado.
      if (!validParentOrigin) return;
      window.parent.postMessage(data, validParentOrigin);
    },
    [validParentOrigin],
  );

  // ------------------------------------------------------------------- som
  const playPing = useCallback(() => {
    if (mutedRef.current) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioCtxRef.current ??= new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    } catch {
      /* autoplay bloqueado / sem suporte — silêncio */
    }
  }, []);

  // ------------------------------------------------- mensagens do servidor
  const applyServerMessage = useCallback(
    (message: MessageDto) => {
      setMessages((prev) => mergeServerMessage(prev, message));
      if (message.direction === "OUTBOUND") {
        setAgentTyping(false);
        playPing();
        if (!openRef.current) {
          unreadRef.current += 1;
          postToParent({ type: "sm-webchat:unread", count: unreadRef.current });
        }
      }
    },
    [playPing, postToParent],
  );

  // bootstrap acessível de callbacks declarados antes dele (recuperação 401)
  const bootstrapRef = useRef<() => Promise<void>>(async () => {});

  /**
   * Busca incremental (?after=lastServerId) SEM early-return de socket
   * conectado — usada tanto pelo polling de fallback quanto pelo catch-up no
   * "connect" do socket (mensagens emitidas entre o último tick de poll e o
   * re-join do room não têm replay no Socket.io).
   */
  const fetchNewMessages = useCallback(async () => {
    if (pollBusyRef.current) return;
    const token = sessionTokenRef.current;
    if (!token) return;
    pollBusyRef.current = true;
    try {
      const after = lastServerIdRef.current;
      const query = after ? `?after=${encodeURIComponent(after)}` : `?limit=${HISTORY_LIMIT}`;
      const res = await requestJson<{ data: MessageDto[] }>(`${API_BASE}/messages${query}`, {
        token,
      });
      for (const message of res.data) applyServerMessage(message);
    } catch (error) {
      // visitorToken expirou (socket também é recusado) → limpa a sessão.
      if (error instanceof HttpError && error.status === 401) {
        writeStoredSession(org, null);
        void bootstrapRef.current();
      }
      // demais erros: offline — tenta no próximo tick
    } finally {
      pollBusyRef.current = false;
    }
  }, [applyServerMessage, org]);

  const pollNewMessages = useCallback(async () => {
    if (socketRef.current?.connected) return;
    await fetchNewMessages();
  }, [fetchNewMessages]);

  useEffect(() => {
    sessionRef.current = session;
    sessionTokenRef.current = session?.visitorToken ?? null;
  }, [session]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const last = [...messages].reverse().find((m) => !m.id.startsWith(TEMP_PREFIX));
    lastServerIdRef.current = last?.id ?? null;
  }, [messages]);

  // ------------------------------------------------------------- bootstrap
  /**
   * Bootstrap LAZY: NUNCA cria sessão (contato+conversa) aqui — só retoma uma
   * sessão já salva (GET /messages) ou fica pronto sem sessão. A sessão real
   * nasce em ensureSession(), na PRIMEIRA mensagem do visitante: pageviews e
   * aberturas do widget não poluem inbox/kanban nem disparam automações.
   */
  const bootstrap = useCallback(async () => {
    if (!org) {
      setStatus("error");
      return;
    }
    const active = readStoredSession(org);
    if (!active) {
      setSession(null);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    try {
      const res = await requestJson<{ data: MessageDto[] }>(
        `${API_BASE}/messages?limit=${HISTORY_LIMIT}`,
        { token: active.visitorToken },
      );
      setSession(active);
      setMessages(res.data);
      setStatus("ready");
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 404)) {
        // token expirado/conversa inexistente → próxima mensagem cria nova sessão
        writeStoredSession(org, null);
        setSession(null);
        setStatus("ready");
        return;
      }
      setStatus("error");
    }
  }, [org]);

  /** Cria (uma única vez, mesmo com envios concorrentes) a sessão do visitante. */
  const ensureSession = useCallback(async (): Promise<SessionInfo> => {
    const existing = sessionRef.current;
    if (existing) return existing;
    sessionPromiseRef.current ??= (async () => {
      const created = await requestJson<SessionInfo>(`${API_BASE}/session`, {
        method: "POST",
        body: { orgSlug: org },
      });
      const active: SessionInfo = {
        visitorToken: created.visitorToken,
        conversationId: created.conversationId,
        orgName: created.orgName ?? "",
      };
      writeStoredSession(org, active);
      sessionRef.current = active;
      setSession(active);
      return active;
    })();
    try {
      return await sessionPromiseRef.current;
    } finally {
      sessionPromiseRef.current = null;
    }
  }, [org]);

  useEffect(() => {
    bootstrapRef.current = bootstrap;
  }, [bootstrap]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    setMuted(readMuted(org));
    setEmbedded(window.parent !== window);
    if (window.parent === window) openRef.current = true;
    void bootstrap();
  }, [bootstrap, org]);

  // --------------------------------------------------------------- socket
  useEffect(() => {
    if (!session) return;
    const socket: WebchatSocket = io(SOCKET_NAMESPACE, {
      path: process.env.NEXT_PUBLIC_SOCKET_PATH ?? "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
      auth: { token: session.visitorToken },
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      // Catch-up: eventos emitidos entre o último poll e o re-join do room no
      // servidor não têm replay — busca única com ?after=lastServerId.
      void fetchNewMessages();
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));
    socket.on("message:new", ({ message }) => applyServerMessage(message));
    socket.on("message:status", ({ messageId, status: nextStatus }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: nextStatus } : m)),
      );
    });
    socket.on("typing", (payload) => {
      // Só interessa o typing de agente/IA (userId) — não o eco do visitante.
      if (!payload.userId) return;
      if (agentTypingTimerRef.current) window.clearTimeout(agentTypingTimerRef.current);
      if (payload.isTyping) {
        setAgentTyping(true);
        agentTypingTimerRef.current = window.setTimeout(
          () => setAgentTyping(false),
          TYPING_DISPLAY_MS,
        );
      } else {
        setAgentTyping(false);
      }
    });

    socketRef.current = socket;
    return () => {
      socketRef.current = null;
      if (agentTypingTimerRef.current) window.clearTimeout(agentTypingTimerRef.current);
      socket.disconnect();
    };
  }, [session, applyServerMessage, fetchNewMessages]);

  // ------------------------------------------------- fallback: polling 5s
  useEffect(() => {
    if (status !== "ready" || socketConnected || !session) return;
    void pollNewMessages();
    const id = window.setInterval(() => void pollNewMessages(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, socketConnected, session, pollNewMessages]);

  // ------------------------------------- visibilidade vinda do loader (pai)
  useEffect(() => {
    // Sem ?parent= válido não há canal legítimo com o pai: nenhuma mensagem é
    // aceita (validação bilateral — nunca um listener permissivo).
    if (!validParentOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== validParentOrigin) return;
      const data = event.data as { type?: unknown; open?: unknown } | null;
      if (!data || data.type !== "sm-webchat:visibility" || typeof data.open !== "boolean") {
        return;
      }
      openRef.current = data.open;
      if (data.open) {
        unreadRef.current = 0;
        postToParent({ type: "sm-webchat:unread", count: 0 });
        window.setTimeout(() => inputRef.current?.focus(), 250);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [validParentOrigin, postToParent]);

  // ----------------------------------------------------- scroll automático
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, agentTyping, status]);

  // ----------------------------------------------------------------- envio
  const sendText = useCallback(
    async (text: string, reuseTempId?: string) => {
      const tempId = reuseTempId ?? `${TEMP_PREFIX}${Date.now()}-${tempSeqRef.current++}`;
      const optimistic: MessageDto = {
        id: tempId,
        conversationId: sessionRef.current?.conversationId ?? "",
        direction: "INBOUND",
        type: "TEXT",
        content: { text },
        status: "PENDING",
        authorId: null,
        isAiGenerated: false,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return [...withoutTemp, optimistic];
      });

      try {
        // Sessão criada aqui (primeira mensagem) — nunca em pageview/abertura.
        const active = await ensureSession();
        const res = await requestJson<{ message: MessageDto }>(`${API_BASE}/messages`, {
          method: "POST",
          token: active.visitorToken,
          body: { text },
        });
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return mergeServerMessage(withoutTemp, res.message);
        });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          // sessão expirou no meio da conversa — recria no próximo envio
          writeStoredSession(org, null);
          sessionRef.current = null;
          setSession(null);
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "FAILED" as const } : m)),
        );
      }
    },
    [ensureSession, org],
  );

  const handleSubmit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const text = input.trim();
      if (!text || status !== "ready" || sending) return;
      setSending(true);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      if (typingSentRef.current) {
        typingSentRef.current = false;
        socketRef.current?.emit("typing", { isTyping: false });
      }
      void sendText(text).finally(() => setSending(false));
    },
    [input, status, sending, sendText],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const notifyTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    if (!typingSentRef.current) {
      typingSentRef.current = true;
      socket.emit("typing", { isTyping: true });
    }
    if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = window.setTimeout(() => {
      typingSentRef.current = false;
      socketRef.current?.emit("typing", { isTyping: false });
    }, TYPING_IDLE_MS);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      writeMuted(org, next);
      return next;
    });
  }, [org]);

  const requestClose = useCallback(() => {
    postToParent({ type: "sm-webchat:close" });
  }, [postToParent]);

  // ------------------------------------------------------------------ views
  const orgInitial = orgName.charAt(0).toUpperCase() || "?";

  return (
    <div className="wc-root flex h-dvh flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      {/* CSS estático de tema (constante em build — nenhum dado de usuário) */}
      <style>{WC_THEME_CSS}</style>

      {/* -------------------------------------------------------- cabeçalho */}
      <header className="flex shrink-0 items-center gap-3 bg-brand-gradient px-4 py-3 text-white shadow-soft">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-semibold">
          {orgInitial}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white/70 bg-emerald-400"
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{orgName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/85">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
            </span>
            {status === "ready" ? "Online agora" : status === "loading" ? "Conectando…" : "Indisponível"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleMuted}
          className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          aria-label={muted ? "Ativar sons de notificação" : "Silenciar sons de notificação"}
          title={muted ? "Ativar sons" : "Silenciar sons"}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        {embedded ? (
          <button
            type="button"
            onClick={requestClose}
            className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            aria-label="Fechar chat"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      {/* ----------------------------------------------------------- corpo */}
      {status === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Chat indisponível no momento</p>
          <p className="text-xs text-muted-foreground">
            Não foi possível iniciar a conversa. Tente novamente em instantes.
          </p>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2 text-xs font-medium text-white shadow-soft transition-transform hover:scale-[1.03]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </button>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
          {status === "loading" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-transparent" />
              <p className="text-xs text-muted-foreground">Carregando conversa…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                <MessageCircle className="h-6 w-6 text-accent-foreground" />
              </div>
              <p className="text-sm font-medium">Olá! 👋</p>
              <p className="text-xs text-muted-foreground">
                Envie uma mensagem e nossa equipe responderá em instantes.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const own = message.direction === "INBOUND";
              const authorLabel = own
                ? null
                : message.isAiGenerated
                  ? "Assistente"
                  : (message.author?.name ?? null);
              return (
                <div key={message.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm shadow-soft",
                      own
                        ? "rounded-br-md bg-brand-gradient text-white"
                        : "rounded-bl-md bg-muted text-foreground",
                    )}
                  >
                    {authorLabel ? (
                      <p className="mb-0.5 text-[11px] font-semibold text-accent-foreground">
                        {authorLabel}
                      </p>
                    ) : null}
                    <MessageBody message={message} />
                    <span
                      className={cn(
                        "mt-1 flex items-center justify-end gap-1 text-[10px]",
                        own ? "text-white/75" : "text-muted-foreground",
                      )}
                    >
                      {formatMessageTime(message.createdAt)}
                      {own ? <StatusTicks status={message.status} /> : null}
                    </span>
                    {own && message.status === "FAILED" ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (isTextContent(message.content)) {
                            void sendText(message.content.text, message.id);
                          }
                        }}
                        className="mt-1 flex items-center gap-1 text-[11px] font-medium text-status-failed underline underline-offset-2"
                      >
                        <RefreshCw className="h-3 w-3" /> Não enviada — tentar de novo
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          {agentTyping ? <TypingDots /> : null}
        </div>
      )}

      {/* ---------------------------------------------------------- composer */}
      <div className="shrink-0 border-t border-border bg-card px-3 pb-2 pt-2.5">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              const el = event.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
              notifyTyping();
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={4096}
            placeholder="Escreva sua mensagem…"
            disabled={status !== "ready"}
            aria-label="Mensagem"
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={status !== "ready" || input.trim().length === 0 || sending}
            aria-label="Enviar mensagem"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-soft transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/70">
          Atendimento por <span className="font-medium">SEEG Omni</span>
        </p>
      </div>
    </div>
  );
}
