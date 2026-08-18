import type { UserDto } from "@sm/shared";

import { useAuthStore } from "@/lib/stores/auth";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api/v1").replace(/\/+$/, "");

/** Corpo de erro padrão do NestJS — docs/CONTRACTS.md §6 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly error: string | undefined;
  readonly messages: readonly string[];

  constructor(statusCode: number, body?: Partial<ApiErrorBody>) {
    const messages =
      body?.message === undefined
        ? []
        : Array.isArray(body.message)
          ? body.message
          : [body.message];
    super(messages[0] ?? `Request failed with status ${statusCode}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.error = body?.error;
    this.messages = messages;
  }

  /** Mensagem amigável em pt-BR para exibição direta na UI. */
  get friendlyMessage(): string {
    switch (true) {
      case this.statusCode === 0:
        return "Não foi possível conectar ao servidor. Verifique sua conexão.";
      case this.statusCode === 401:
        return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
      case this.statusCode === 403:
        return "Você não tem permissão para executar esta ação.";
      case this.statusCode === 404:
        return "Recurso não encontrado.";
      case this.statusCode === 429:
        return "Muitas tentativas seguidas. Aguarde um instante e tente novamente.";
      case this.statusCode >= 500:
        return "O servidor encontrou um problema. Tente novamente em instantes.";
      default:
        return this.messages[0] ?? "Algo deu errado. Tente novamente.";
    }
  }
}

/** Resposta de POST /auth/login — docs/CONTRACTS.md §6 */
export interface AuthSessionDto {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

/** Resposta de POST /auth/refresh */
export interface RefreshResponseDto {
  accessToken: string;
  refreshToken: string;
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue | QueryValue[]>;
  body?: unknown;
  /** `false` para endpoints públicos (login, refresh). Padrão: `true`. */
  auth?: boolean;
  signal?: AbortSignal;
  headers?: HeadersInit;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) params.append(key, String(item));
      }
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs.length > 0 ? `${url}?${qs}` : url;
}

/**
 * Refresh single-flight: o primeiro 401 dispara o refresh; requisições
 * concorrentes que também receberem 401 aguardam a MESMA promise (fila) e
 * são reexecutadas com o novo token quando ela resolve.
 *
 * Exportada para o `lib/socket.ts` reutilizar no `connect_error` do handshake
 * (JWT expirado no middleware de auth do /rt não dispara reconexão automática).
 */
let refreshInFlight: Promise<string | null> | null = null;

export async function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async (): Promise<string | null> => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return null;
    try {
      const response = await fetch(buildUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as RefreshResponseDto;
      useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const { auth = true } = options;

  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0);
  }

  if (response.status === 401 && auth && !isRetry && !path.startsWith("/auth/")) {
    const newToken = await refreshSession();
    if (newToken) {
      return request<T>(method, path, options, true);
    }
    useAuthStore.getState().clearSession();
    throw new ApiError(401, { statusCode: 401, message: "Sessão expirada" });
  }

  if (!response.ok) {
    let body: Partial<ApiErrorBody> | undefined;
    try {
      body = (await response.json()) as Partial<ApiErrorBody>;
    } catch {
      body = undefined;
    }
    throw new ApiError(response.status, body);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length > 0 ? (JSON.parse(text) as T) : (undefined as T));
}

/**
 * multipart/form-data (upload de arquivo — CONTRACTS §13): NUNCA define
 * Content-Type manualmente (o browser define o boundary do multipart
 * sozinho); mesmo refresh single-flight em 401 do `request()` acima.
 */
async function uploadRequest<T>(path: string, formData: FormData, isRetry = false): Promise<T> {
  const headers = new Headers();
  const token = useAuthStore.getState().accessToken;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(buildUrl(path), { method: "POST", headers, body: formData });
  } catch {
    throw new ApiError(0);
  }

  if (response.status === 401 && !isRetry) {
    const newToken = await refreshSession();
    if (newToken) {
      return uploadRequest<T>(path, formData, true);
    }
    useAuthStore.getState().clearSession();
    throw new ApiError(401, { statusCode: 401, message: "Sessão expirada" });
  }

  if (!response.ok) {
    let body: Partial<ApiErrorBody> | undefined;
    try {
      body = (await response.json()) as Partial<ApiErrorBody>;
    } catch {
      body = undefined;
    }
    throw new ApiError(response.status, body);
  }

  const text = await response.text();
  return (text.length > 0 ? (JSON.parse(text) as T) : (undefined as T));
}

/** Cliente HTTP tipado da API (`/api/v1`, JWT Bearer, refresh automático em 401). */
export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("GET", path, options),
  post: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("POST", path, options),
  patch: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("PATCH", path, options),
  put: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("PUT", path, options),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("DELETE", path, options),
  upload: <T>(path: string, formData: FormData): Promise<T> => uploadRequest<T>(path, formData),
} as const;
