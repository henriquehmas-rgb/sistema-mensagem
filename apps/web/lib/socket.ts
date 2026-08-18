import { io, type Socket } from "socket.io-client";

import {
  SOCKET_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@sm/shared";

import { refreshSession } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/**
 * Recuperação de handshake recusado pelo middleware de auth do /rt.
 *
 * No socket.io v4, quando o servidor recusa a conexão no middleware (ex.: JWT
 * expirado no handshake após a máquina dormir), `socket.active === false` e a
 * reconexão automática NÃO acontece — sem tratamento, o tempo real morre até
 * recarregar a página. Aqui: refresh do token → `connect()` com backoff
 * exponencial; se o refresh falhar, a sessão local é encerrada.
 */
const AUTH_RETRY_BASE_DELAY_MS = 1_000;
const AUTH_RETRY_MAX_DELAY_MS = 15_000;

let authRetryAttempts = 0;
let authRetryTimer: ReturnType<typeof setTimeout> | null = null;
let authRecoveryInFlight = false;

function clearAuthRetry(): void {
  if (authRetryTimer) {
    clearTimeout(authRetryTimer);
    authRetryTimer = null;
  }
  authRetryAttempts = 0;
}

async function recoverFromRejectedHandshake(instance: AppSocket): Promise<void> {
  if (authRecoveryInFlight) return;
  authRecoveryInFlight = true;
  try {
    // Sessão pode ter sido encerrada enquanto o retry aguardava.
    if (!useAuthStore.getState().refreshToken) return;
    const token = await refreshSession();
    if (token) {
      // O callback `auth` relê o accessToken do store a cada tentativa.
      if (!instance.connected) instance.connect();
      return;
    }
    // Refresh recusado — sessão inválida no servidor: encerra localmente
    // (mesmo comportamento do caminho HTTP 401 → refresh falho).
    useAuthStore.getState().clearSession();
  } finally {
    authRecoveryInFlight = false;
  }
}

/**
 * Singleton do Socket.io — namespace `/rt` (docs/CONTRACTS.md §5).
 * Auth via JWT em `handshake.auth.token` (lido a cada tentativa de conexão,
 * então tokens renovados pelo refresh são usados automaticamente na reconexão).
 * Reconexão com backoff exponencial + jitter; handshake recusado pelo servidor
 * (token expirado) dispara refresh + reconexão manual (ver acima).
 */
export function getSocket(): AppSocket {
  if (socket) return socket;

  const typedSocket: AppSocket = io(SOCKET_NAMESPACE, {
    path: process.env.NEXT_PUBLIC_SOCKET_PATH ?? "/socket.io",
    autoConnect: false,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    randomizationFactor: 0.5,
    timeout: 10_000,
    auth: (cb) => {
      cb({ token: useAuthStore.getState().accessToken });
    },
  });

  typedSocket.on("connect", clearAuthRetry);

  typedSocket.on("connect_error", () => {
    // `active === true`: falha temporária (rede) — o cliente reconecta sozinho.
    // `active === false`: o servidor recusou o handshake (middleware de auth,
    // ex.: `unauthorized` por JWT expirado) e não haverá nova tentativa.
    if (typedSocket.active) return;
    if (!useAuthStore.getState().refreshToken) return; // sem sessão — nada a fazer

    authRetryAttempts += 1;
    const delay = Math.min(
      AUTH_RETRY_BASE_DELAY_MS * 2 ** (authRetryAttempts - 1),
      AUTH_RETRY_MAX_DELAY_MS,
    );
    if (authRetryTimer) clearTimeout(authRetryTimer);
    authRetryTimer = setTimeout(() => {
      authRetryTimer = null;
      void recoverFromRejectedHandshake(typedSocket);
    }, delay);
  });

  socket = typedSocket;
  return typedSocket;
}

/** Conecta (idempotente) — usar quando houver sessão autenticada. */
export function connectSocket(): AppSocket {
  const instance = getSocket();
  if (!instance.connected) instance.connect();
  return instance;
}

/** Desconecta sem destruir o singleton (logout / sessão encerrada). */
export function disconnectSocket(): void {
  clearAuthRetry();
  socket?.disconnect();
}
