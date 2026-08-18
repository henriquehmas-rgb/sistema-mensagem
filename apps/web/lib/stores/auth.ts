import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { UserDto } from "@sm/shared";

import { api, type AuthSessionDto } from "@/lib/api";
import { AUTH_COOKIE_NAME } from "@/lib/constants";
import { getRegisteredQueryClient } from "@/lib/query-client";
import { disconnectSocket } from "@/lib/socket";
import { useInboxStore } from "@/lib/stores/inbox";

const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function setAuthCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_COOKIE_NAME}=1; path=/; max-age=${AUTH_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function clearAuthCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

export interface LoginInput {
  email: string;
  password: string;
  orgSlug?: string;
}

interface AuthState {
  user: UserDto | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** `true` após o persist reidratar do localStorage (evita flash/loop no guard). */
  hasHydrated: boolean;
  login: (input: LoginInput) => Promise<UserDto>;
  logout: () => Promise<void>;
  setSession: (session: AuthSessionDto) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: UserDto) => void;
  clearSession: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hasHydrated: false,

      login: async (input) => {
        const session = await api.post<AuthSessionDto>("/auth/login", {
          body: input,
          auth: false,
        });
        get().setSession(session);
        return session.user;
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          if (refreshToken) {
            await api.post<void>("/auth/logout", { body: { refreshToken } });
          }
        } catch {
          // Best-effort: a sessão local é encerrada mesmo se a API falhar.
        }
        get().clearSession();
      },

      setSession: (session) => {
        setAuthCookie();
        set({
          user: session.user,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
      },

      setTokens: (accessToken, refreshToken) => {
        setAuthCookie();
        set({ accessToken, refreshToken });
      },

      setUser: (user) => {
        set({ user });
      },

      /**
       * Encerramento completo da sessão local (logout explícito OU refresh
       * falho após 401). Ordem importa: desconecta o socket ANTES de limpar o
       * cache para que nenhum evento realtime repovoe dados da org anterior.
       */
      clearSession: () => {
        clearAuthCookie();
        disconnectSocket();
        set({ user: null, accessToken: null, refreshToken: null });
        useInboxStore.getState().reset();
        getRegisteredQueryClient()?.clear();
      },

      setHasHydrated: (value) => {
        set({ hasHydrated: value });
      },
    }),
    {
      name: "sm-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
