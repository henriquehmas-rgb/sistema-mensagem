import type { Metadata } from "next";

import { WidgetChat } from "./widget-chat";

export const metadata: Metadata = {
  title: "Chat",
  robots: { index: false, follow: false },
};

interface WidgetPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Página STANDALONE do webchat embutível (fora do grupo (app) — sem auth,
 * sem sidebar). Carregada dentro do iframe criado por /webchat.js no site do
 * cliente: ?org= identifica a organização e ?parent= o origin da página host
 * (validado no client antes de qualquer postMessage).
 */
export default async function WebchatWidgetPage({ searchParams }: WidgetPageProps) {
  const params = await searchParams;
  const org = typeof params.org === "string" ? params.org : "";
  const parentOrigin = typeof params.parent === "string" ? params.parent : "";
  return <WidgetChat org={org} parentOrigin={parentOrigin} />;
}
