"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { useRealtimeHandlers } from "@/lib/realtime-handlers";
import { useAuthStore } from "@/lib/stores/auth";

function SplashScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient shadow-soft-lg">
          <MessageSquare className="h-6 w-6 text-white" />
        </div>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-shimmer rounded-full bg-primary/60 -translate-x-full" />
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken));

  // Evita divergência de hidratação: primeira renderização (SSR e cliente)
  // sempre mostra o splash; a decisão de rota acontece só após montar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Tempo real (Socket.io → caches React Query) — vivo em todo o app autenticado.
  useRealtimeHandlers(mounted && hasHydrated && isAuthenticated);

  useEffect(() => {
    if (mounted && hasHydrated && !isAuthenticated) {
      router.replace("/login");
    }
  }, [mounted, hasHydrated, isAuthenticated, router]);

  if (!mounted || !hasHydrated || !isAuthenticated) {
    return <SplashScreen />;
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
