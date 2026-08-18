"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface QueryErrorProps {
  /** Erro da query (ApiError → mensagem amigável; outros → genérica). */
  error: unknown;
  /** Normalmente o `refetch` da query. */
  onRetry: () => void;
  /** `isFetching`/`isRefetching` — desabilita o botão e gira o ícone. */
  retrying?: boolean;
  className?: string;
}

/** Mensagem amigável em pt-BR para qualquer erro de query. */
export function queryErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.friendlyMessage
    : "Algo deu errado. Tente novamente.";
}

/**
 * Estado de erro padrão das telas: ícone + mensagem amigável + "Tentar
 * novamente". Usado por Inbox (lista/thread/mensagens), Kanban, Contatos e
 * Dashboard para nunca mascarar falha como estado vazio ou loading eterno.
 */
export function QueryError({
  error,
  onRetry,
  retrying = false,
  className,
}: QueryErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-8 text-center",
        className,
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-5 w-5 text-destructive" />
      </span>
      <p className="max-w-64 text-sm text-muted-foreground">
        {queryErrorMessage(error)}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={retrying}
        onClick={onRetry}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
        Tentar novamente
      </Button>
    </div>
  );
}
