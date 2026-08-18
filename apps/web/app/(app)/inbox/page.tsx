import type { Metadata } from "next";

import { InboxClient } from "./components/inbox-client";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return <InboxClient />;
}
