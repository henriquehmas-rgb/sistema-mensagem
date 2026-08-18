import { redirect } from "next/navigation";

export default function RootPage() {
  // O middleware decide entre /inbox e /login; este redirect é o fallback.
  redirect("/inbox");
}
