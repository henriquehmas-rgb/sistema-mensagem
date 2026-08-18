import type { QueryClient } from "@tanstack/react-query";

/**
 * Registro do QueryClient da aplicação fora da árvore React, para que camadas
 * não-React (ex.: `clearSession` do auth store) consigam limpar o cache no
 * encerramento da sessão — "logout limpa tudo", sem vazar dados entre
 * usuários/orgs na mesma aba.
 */
let registeredQueryClient: QueryClient | null = null;

export function registerQueryClient(client: QueryClient): void {
  registeredQueryClient = client;
}

export function getRegisteredQueryClient(): QueryClient | null {
  return registeredQueryClient;
}
