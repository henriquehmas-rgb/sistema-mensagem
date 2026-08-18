"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BookOpenText,
  Layers,
  Radio,
  Tags,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/lib/stores/auth";

import { AutomationsSettings } from "./automations-settings";
import { ChannelsSettings } from "./channels-settings";
import { KnowledgeSettings } from "./knowledge-settings";
import { StagesSettings } from "./stages-settings";
import { TagsSettings } from "./tags-settings";
import { UsersSettings } from "./users-settings";

type SettingsTab =
  | "stages"
  | "tags"
  | "users"
  | "channels"
  | "knowledge"
  | "automations";

interface TabDef {
  value: SettingsTab;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const TAB_DEFS: readonly TabDef[] = [
  { value: "stages", label: "Etapas", icon: Layers },
  { value: "tags", label: "Tags", icon: Tags },
  { value: "users", label: "Usuários", icon: Users, adminOnly: true },
  { value: "channels", label: "Canais", icon: Radio },
  { value: "knowledge", label: "Base de Conhecimento", icon: BookOpenText },
  { value: "automations", label: "Automações", icon: Workflow },
] as const;

function isSettingsTab(value: string | null): value is SettingsTab {
  return TAB_DEFS.some((tab) => tab.value === value);
}

export function SettingsClient() {
  const searchParams = useSearchParams();
  const isAdmin = useAuthStore((state) => state.user?.role === "ADMIN");

  const visibleTabs = TAB_DEFS.filter((tab) => !tab.adminOnly || isAdmin);

  const [tab, setTab] = useState<SettingsTab>("stages");

  // Deep-link: /settings?tab=stages (usado pelo menu das colunas do kanban).
  useEffect(() => {
    const fromUrl = searchParams.get("tab");
    if (isSettingsTab(fromUrl) && visibleTabs.some((item) => item.value === fromUrl)) {
      setTab(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem/param
  }, [searchParams]);

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center border-b px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight">Configurações</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
          <TabsList className="h-auto flex-wrap justify-start gap-0.5">
            {visibleTabs.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="gap-1.5">
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="stages" className="mt-5">
            <StagesSettings />
          </TabsContent>
          <TabsContent value="tags" className="mt-5">
            <TagsSettings />
          </TabsContent>
          {isAdmin ? (
            <TabsContent value="users" className="mt-5">
              <UsersSettings />
            </TabsContent>
          ) : null}
          <TabsContent value="channels" className="mt-5">
            <ChannelsSettings />
          </TabsContent>
          <TabsContent value="knowledge" className="mt-5">
            <KnowledgeSettings />
          </TabsContent>
          <TabsContent value="automations" className="mt-5">
            <AutomationsSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
