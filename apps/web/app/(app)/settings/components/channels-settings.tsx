"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";

import type { ChannelDto, ChannelStatus, ChannelType } from "@sm/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useChannels, useCreateChannel } from "@/lib/settings/hooks";
import { cn } from "@/lib/utils";

import {
  CHANNEL_LABELS,
  ChannelIcon,
} from "../../inbox/components/channel-icons";

const STATUS_META: Record<ChannelStatus, { label: string; variant: "success" | "secondary" | "destructive" }> = {
  ACTIVE: { label: "Ativo", variant: "success" },
  DISABLED: { label: "Desativado", variant: "secondary" },
  ERROR: { label: "Erro", variant: "destructive" },
};

function publicOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copiado.`);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => void handleCopy()}
      aria-label={`Copiar ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function EncryptionNotice() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted p-2.5 text-[11px] leading-relaxed text-muted-foreground">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      As credenciais são criptografadas em repouso (AES-256-GCM) e nunca são
      exibidas novamente após salvar.
    </p>
  );
}

function WebhookUrlField() {
  const webhookUrl = `${publicOrigin()}/api/webhooks/meta`;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">URL do webhook (cole no painel da Meta)</Label>
      <div className="flex items-center gap-1.5">
        <Input readOnly value={webhookUrl} className="h-8 font-mono text-xs" />
        <CopyButton value={webhookUrl} label="URL do webhook" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulários por tipo de canal
// ---------------------------------------------------------------------------

interface ChannelFormProps {
  onDone: () => void;
}

function MetaChannelForm({ type, onDone }: ChannelFormProps & { type: Extract<ChannelType, "WHATSAPP" | "INSTAGRAM"> }) {
  const createChannel = useCreateChannel();
  const isWhatsApp = type === "WHATSAPP";

  const [form, setForm] = useState({
    name: "",
    phoneNumberId: "",
    wabaId: "",
    igBusinessId: "",
    accessToken: "",
    verifyToken: "",
    appSecret: "",
  });

  const setField = (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setForm((value) => ({ ...value, [field]: event.target.value }));

  const requiredFilled =
    form.name.trim().length > 0 &&
    form.accessToken.trim().length > 0 &&
    form.appSecret.trim().length > 0 &&
    form.verifyToken.trim().length > 0 &&
    (isWhatsApp
      ? form.phoneNumberId.trim().length > 0 && form.wabaId.trim().length > 0
      : form.igBusinessId.trim().length > 0);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!requiredFilled || createChannel.isPending) return;
    createChannel.mutate(
      {
        type,
        name: form.name.trim(),
        credentials: {
          accessToken: form.accessToken.trim(),
          appSecret: form.appSecret.trim(),
          verifyToken: form.verifyToken.trim(),
          ...(isWhatsApp
            ? {
                phoneNumberId: form.phoneNumberId.trim(),
                wabaId: form.wabaId.trim(),
              }
            : { igBusinessId: form.igBusinessId.trim() }),
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="channel-name" className="text-xs">
          Nome do canal *
        </Label>
        <Input
          id="channel-name"
          value={form.name}
          onChange={setField("name")}
          placeholder={isWhatsApp ? "WhatsApp Comercial" : "Instagram da loja"}
          className="h-9"
          autoFocus
          required
        />
      </div>

      {isWhatsApp ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="channel-phone-id" className="text-xs">
              Phone Number ID *
            </Label>
            <Input
              id="channel-phone-id"
              value={form.phoneNumberId}
              onChange={setField("phoneNumberId")}
              className="h-9 font-mono text-xs"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="channel-waba-id" className="text-xs">
              WABA ID *
            </Label>
            <Input
              id="channel-waba-id"
              value={form.wabaId}
              onChange={setField("wabaId")}
              className="h-9 font-mono text-xs"
              required
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="channel-ig-id" className="text-xs">
            Instagram Business Account ID *
          </Label>
          <Input
            id="channel-ig-id"
            value={form.igBusinessId}
            onChange={setField("igBusinessId")}
            className="h-9 font-mono text-xs"
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="channel-access-token" className="text-xs">
          Access Token *
        </Label>
        <Input
          id="channel-access-token"
          type="password"
          value={form.accessToken}
          onChange={setField("accessToken")}
          className="h-9 font-mono text-xs"
          autoComplete="off"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="channel-app-secret" className="text-xs">
            App Secret *
          </Label>
          <Input
            id="channel-app-secret"
            type="password"
            value={form.appSecret}
            onChange={setField("appSecret")}
            className="h-9 font-mono text-xs"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel-verify-token" className="text-xs">
            Verify Token *
          </Label>
          <Input
            id="channel-verify-token"
            type="password"
            value={form.verifyToken}
            onChange={setField("verifyToken")}
            className="h-9 font-mono text-xs"
            autoComplete="off"
            required
          />
        </div>
      </div>

      <EncryptionNotice />
      <WebhookUrlField />

      <DialogFooter>
        <Button type="submit" disabled={!requiredFilled || createChannel.isPending}>
          {createChannel.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Conectar {CHANNEL_LABELS[type]}
        </Button>
      </DialogFooter>
    </form>
  );
}

function WebchatChannelForm({ onDone }: ChannelFormProps) {
  const createChannel = useCreateChannel();

  const [form, setForm] = useState({ name: "", orgSlug: "" });

  const snippet = useMemo(() => {
    const slug = form.orgSlug.trim() || "sua-organizacao";
    return `<script src="${publicOrigin()}/webchat.js" data-org="${slug}" async></script>`;
  }, [form.orgSlug]);

  const canSubmit =
    form.name.trim().length > 0 &&
    form.orgSlug.trim().length > 0 &&
    !createChannel.isPending;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    createChannel.mutate(
      {
        type: "WEBCHAT",
        name: form.name.trim(),
        config: { orgSlug: form.orgSlug.trim() },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="webchat-name" className="text-xs">
          Nome do canal *
        </Label>
        <Input
          id="webchat-name"
          value={form.name}
          onChange={(event) =>
            setForm((value) => ({ ...value, name: event.target.value }))
          }
          placeholder="Chat do site"
          className="h-9"
          autoFocus
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="webchat-slug" className="text-xs">
          Slug da organização *
        </Label>
        <Input
          id="webchat-slug"
          value={form.orgSlug}
          onChange={(event) =>
            setForm((value) => ({ ...value, orgSlug: event.target.value }))
          }
          placeholder="minha-empresa"
          className="h-9 font-mono text-xs"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          Identifica sua organização no widget (o mesmo slug usado no login).
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Snippet para o seu site</Label>
          <CopyButton value={snippet} label="Snippet" />
        </div>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
          <code>{snippet}</code>
        </pre>
        <p className="text-[11px] text-muted-foreground">
          Cole antes do fechamento da tag <code>&lt;/body&gt;</code> do seu site.
        </p>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={!canSubmit}>
          {createChannel.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Criar canal Webchat
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Dialog "Conectar canal" (escolha de tipo → formulário)
// ---------------------------------------------------------------------------

const CHANNEL_TYPE_OPTIONS: { type: ChannelType; description: string }[] = [
  { type: "WHATSAPP", description: "WhatsApp Business Cloud API (Meta)" },
  { type: "INSTAGRAM", description: "Instagram Direct (Meta)" },
  { type: "WEBCHAT", description: "Widget de chat para o seu site" },
];

function ConnectChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedType, setSelectedType] = useState<ChannelType | null>(null);

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next);
    if (!next) setSelectedType(null);
  };

  const handleDone = (): void => handleOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {selectedType
              ? `Conectar ${CHANNEL_LABELS[selectedType]}`
              : "Conectar canal"}
          </DialogTitle>
          <DialogDescription>
            {selectedType
              ? "Preencha as credenciais do canal."
              : "Escolha o tipo de canal que deseja conectar."}
          </DialogDescription>
        </DialogHeader>

        {selectedType === null ? (
          <div className="grid gap-2">
            {CHANNEL_TYPE_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => setSelectedType(option.type)}
                className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ChannelIcon type={option.type} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {CHANNEL_LABELS[option.type]}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : selectedType === "WEBCHAT" ? (
          <WebchatChannelForm onDone={handleDone} />
        ) : (
          <MetaChannelForm type={selectedType} onDone={handleDone} />
        )}

        {selectedType !== null ? (
          <button
            type="button"
            onClick={() => setSelectedType(null)}
            className="text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            ← Escolher outro tipo de canal
          </button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Aba Canais
// ---------------------------------------------------------------------------

function ChannelCard({ channel }: { channel: ChannelDto }) {
  const status = STATUS_META[channel.status];
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card p-4",
        channel.status === "ERROR" && "border-destructive/40",
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ChannelIcon type={channel.type} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{channel.name}</p>
        <p className="text-xs text-muted-foreground">
          {CHANNEL_LABELS[channel.type]}
          {channel.externalId ? ` · ${channel.externalId}` : ""}
        </p>
      </div>
      <Badge variant={status.variant}>{status.label}</Badge>
    </div>
  );
}

export function ChannelsSettings() {
  const channelsQuery = useChannels();
  const [dialogOpen, setDialogOpen] = useState(false);

  const channels = channelsQuery.data ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Canais conectados</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            WhatsApp, Instagram e Webchat — todas as conversas caem na mesma inbox.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Conectar canal
        </Button>
      </div>

      {channelsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
          <p className="text-sm font-medium">Nenhum canal conectado</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Conecte o primeiro canal para começar a receber conversas dos seus
            clientes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}

      <ConnectChannelDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
