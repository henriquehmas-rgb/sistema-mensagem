"use client";

import { useEffect, useState } from "react";

import { connectSocket } from "@/lib/socket";

/**
 * Conecta o socket singleton (quando `enabled`) e expõe o estado da conexão.
 * Não desconecta no cleanup — a conexão pertence à sessão, não ao componente;
 * o logout (auth store) é quem desconecta.
 */
export function useSocketStatus(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    const socket = connectSocket();
    setConnected(socket.connected);

    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [enabled]);

  return connected;
}
