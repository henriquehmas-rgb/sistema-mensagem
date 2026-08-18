import { Suspense } from "react";
import type { Metadata } from "next";

import { SettingsClient } from "./components/settings-client";

export const metadata: Metadata = { title: "Configurações" };

export default function SettingsPage() {
  // Suspense: exigido pelo Next para useSearchParams em página estática.
  return (
    <Suspense fallback={null}>
      <SettingsClient />
    </Suspense>
  );
}
