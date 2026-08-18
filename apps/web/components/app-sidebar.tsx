"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  ChevronsUpDown,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquareKanban,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { Role } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSocketStatus } from "@/lib/hooks/use-socket-status";
import { APP_NAME } from "@/lib/constants";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "sm-sidebar-collapsed";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/kanban", label: "Kanban", icon: SquareKanban },
  { href: "/contacts", label: "Contatos", icon: Users },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/settings", label: "Configurações", icon: Settings },
] as const;

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  AGENT: "Agente",
};

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative flex h-2.5 w-2.5 shrink-0"
          aria-label={connected ? "Tempo real conectado" : "Tempo real desconectado"}
        >
          {connected ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-40" />
          ) : null}
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              connected ? "bg-success" : "bg-destructive",
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        {connected
          ? "Tempo real conectado"
          : "Tempo real desconectado — reconectando…"}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken));
  const socketConnected = useSocketStatus(isAuthenticated);

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // localStorage indisponível — mantém expandida.
    }
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // noop
      }
      return next;
    });
  };

  const handleLogout = async (): Promise<void> => {
    await logout();
    toast.success("Sessão encerrada. Até logo!");
    router.replace("/login");
  };

  const displayName = user?.name ?? "Usuário";
  const roleLabel = user ? ROLE_LABELS[user.role] : "";

  return (
    <aside
      className={cn(
        "flex h-dvh shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[68px]" : "w-64",
      )}
    >
      {/* Cabeçalho: logo + toggle */}
      <div
        className={cn(
          "flex h-14 items-center border-b px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed ? (
          <Link href="/inbox" className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient shadow-soft">
              <MessageSquare className="h-4 w-4 text-white" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">
              {APP_NAME}
            </span>
          </Link>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expandir menu" : "Recolher menu"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary"
                />
              ) : null}
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </Link>
          );

          if (!collapsed) return link;

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Rodapé: usuário + status da conexão */}
      <div className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                collapsed && "justify-center",
              )}
            >
              <div className="relative shrink-0">
                <UserAvatar
                  name={displayName}
                  src={user?.avatarUrl}
                  className="h-8 w-8"
                />
                {collapsed ? (
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
                      socketConnected ? "bg-success" : "bg-destructive",
                    )}
                  />
                ) : null}
              </div>
              {!collapsed ? (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium leading-tight">
                        {displayName}
                      </p>
                      <ConnectionDot connected={socketConnected} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {roleLabel}
                    </p>
                  </div>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={collapsed ? "right" : "top"}
            align={collapsed ? "end" : "center"}
            className="w-56"
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-0.5">
                <p className="text-sm font-medium leading-none">{displayName}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email ?? ""}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                void handleLogout();
              }}
            >
              <LogOut />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
