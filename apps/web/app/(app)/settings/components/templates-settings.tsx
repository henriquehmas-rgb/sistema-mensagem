"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import type { ChannelDto, MessageTemplateDto, TemplateStatus } from "@sm/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useChannelTemplates, useSyncChannelTemplates } from "@/lib/settings/hooks";

export const TEMPLATE_STATUS_META: Record<
  TemplateStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary" }
> = {
  APPROVED: { label: "Aprovado", variant: "success" },
  PENDING: { label: "Em análise", variant: "warning" },
  REJECTED: { label: "Rejeitado", variant: "destructive" },
  PAUSED: { label: "Pausado", variant: "secondary" },
  DISABLED: { label: "Desativado", variant: "secondary" },
};

const CATEGORY_LABELS: Record<MessageTemplateDto["category"], string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

/** Destaca `{{n}}` no corpo do template — preview simples com regex. */
export function TemplateBodyPreview({ text }: { text: string }) {
  const parts = text.split(/(\{\{\d+\}\})/g);
  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
      {parts.map((part, index) =>
        /^\{\{\d+\}\}$/.test(part) ? (
          <span
            key={index}
            className="rounded bg-primary/15 px-1 py-0.5 font-mono text-[11px] font-medium text-primary"
          >
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

export function templateBodyText(template: MessageTemplateDto): string {
  const body = template.components.find((component) => component.type === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

function TemplateCard({ template }: { template: MessageTemplateDto }) {
  const status = TEMPLATE_STATUS_META[template.status];
  const body = templateBodyText(template);
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{template.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {CATEGORY_LABELS[template.category]} · {template.language}
            {template.bodyParamsCount > 0
              ? ` · ${template.bodyParamsCount} parâmetro(s)`
              : ""}
          </p>
        </div>
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      </div>
      {body.length > 0 ? (
        <TemplateBodyPreview text={body} />
      ) : (
        <p className="text-xs italic text-muted-foreground">Sem corpo de texto.</p>
      )}
    </div>
  );
}

export function TemplatesSettings({ channels }: { channels: ChannelDto[] }) {
  const [channelId, setChannelId] = useState<string | null>(channels[0]?.id ?? null);

  // Mantém a seleção válida se a lista de canais mudar (ex.: canal removido).
  useEffect(() => {
    if (channelId !== null && channels.some((channel) => channel.id === channelId)) return;
    setChannelId(channels[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à lista de canais
  }, [channels]);

  const templatesQuery = useChannelTemplates(channelId);
  const syncTemplates = useSyncChannelTemplates(channelId ?? "");

  const templates = templatesQuery.data ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Templates de mensagem</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sincronizados da Meta — obrigatórios para iniciar conversas fora da
            janela de 24h.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {channels.length > 1 ? (
            <Select
              value={channelId ?? undefined}
              onValueChange={(value) => setChannelId(value)}
            >
              <SelectTrigger className="h-9 w-48 text-xs">
                <SelectValue placeholder="Canal…" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={channelId === null || syncTemplates.isPending}
            onClick={() => syncTemplates.mutate()}
          >
            {syncTemplates.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sincronizar agora
          </Button>
        </div>
      </div>

      {templatesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
          <p className="text-sm font-medium">Nenhum template sincronizado</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Clique em &quot;Sincronizar agora&quot; para buscar os templates
            aprovados na sua conta WhatsApp Business.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}
