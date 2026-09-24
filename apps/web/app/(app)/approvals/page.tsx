import type { Metadata } from "next";

import { ApprovalsClient } from "./components/approvals-client";

export const metadata: Metadata = { title: "Aprovações" };

export default function ApprovalsPage() {
  return <ApprovalsClient />;
}
