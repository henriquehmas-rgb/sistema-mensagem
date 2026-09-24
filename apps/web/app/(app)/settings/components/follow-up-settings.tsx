"use client";

import { UserRoundCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfigureFollowUpResponsible, useFollowUpConfiguration, useUsers } from "@/lib/settings/hooks";

const UNASSIGNED = "__unassigned__";

export function FollowUpSettings() {
  const configuration = useFollowUpConfiguration(true);
  const users = useUsers(true);
  const configure = useConfigureFollowUpResponsible();
  const activeUsers = (users.data ?? []).filter((user) => user.isActive);

  return (
    <section className="max-w-2xl space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <UserRoundCheck className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Responsável pelo follow-up</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Uma única pessoa pode revisar follow-ups de Suporte, Financeiro e Comercial.
            Isso não assume a conversa nem autoriza envio automático: cada contato continua em revisão humana.
          </p>
        </div>
      </div>

      {configuration.isLoading || users.isLoading ? <Skeleton className="h-10 w-full" /> : (
        <div className="space-y-2">
          <Select
            value={configuration.data?.responsibleUserId ?? UNASSIGNED}
            disabled={configure.isPending}
            onValueChange={(value) => configure.mutate(value === UNASSIGNED ? null : value)}
          >
            <SelectTrigger><SelectValue placeholder="Escolha uma pessoa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Sem responsável padrão</SelectItem>
              {activeUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {configuration.data?.responsibleUser ? (
            <Badge variant="secondary">Ponto focal atual: {configuration.data.responsibleUser.name}</Badge>
          ) : null}
        </div>
      )}
    </section>
  );
}
