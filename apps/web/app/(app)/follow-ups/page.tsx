import type { Metadata } from "next";
import { FollowUpsClient } from "./components/follow-ups-client";

export const metadata: Metadata = { title: "Follow-ups" };

export default function FollowUpsPage() {
  return <FollowUpsClient />;
}
