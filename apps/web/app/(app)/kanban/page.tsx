import type { Metadata } from "next";

import { KanbanClient } from "./components/kanban-client";

export const metadata: Metadata = { title: "Kanban" };

export default function KanbanPage() {
  return <KanbanClient />;
}
