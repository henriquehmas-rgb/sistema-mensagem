"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, Database, Loader2, Plus, Search, Tag as TagIcon, X } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  useContactConversations,
  useConversationTags,
  useCreateTag,
  useIxcCustomerDetails,
  useIxcCustomerLookup,
  useStages,
  useTags,
  useUpdateContact,
} from "@/lib/inbox/hooks";
import { useAuthStore } from "@/lib/stores/auth";
import { formatFullDate, formatRelativeLong, formatRelativeShort } from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS, ChannelIcon } from "./channel-icons";

const AUTOSAVE_DEBOUNCE_MS = 800;

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function compactDate(value: string | null): string {
  if (!value) return "Não informado";
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

const TAG_COLOR_PALETTE = [
  "#6366F1",
  "#8B5CF6",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#14B8A6",
] as const;

function pickTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TAG_COLOR_PALETTE[hash % TAG_COLOR_PALETTE.length] ?? "#6366F1";
}

const STATUS_LABELS: Record<ConversationDto["status"], string> = {
  OPEN: "Aberta",
  PENDING: "Pendente",
  RESOLVED: "Resolvida",
  SNOOZED: "Adiada",
};

const INTENT_LABELS: Record<string, string> = {
  general_support: "Atendimento geral",
  technical_support: "Suporte técnico",
  billing: "Financeiro",
  sales: "Vendas",
  cancellation: "Cancelamento",
};

type SaveState = "idle" | "saving" | "saved";

interface ContactDraft {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

interface CrmPanelProps {
  conversation: ConversationDto;
  onSelectConversation: (id: string) => void;
}

export function CrmPanel({ conversation, onSelectConversation }: CrmPanelProps) {
  const contact = conversation.contact;

  const stagesQuery = useStages();
  const tagsQuery = useTags();
  const createTag = useCreateTag();
  const conversationTags = useConversationTags(conversation.id);
  const updateContact = useUpdateContact();
  const otherConversationsQuery = useContactConversations(contact.id);
  const ixcLookup = useIxcCustomerLookup();
  const ixcDetails = useIxcCustomerDetails();
  const user = useAuthStore((state) => state.user);
  const canSeeInvoices = user?.role === "ADMIN" || user?.role === "SUPERVISOR";

  // -------------------------------------------------------------------------
  // Dados do contato — edição inline com autosave (debounce)
  // -------------------------------------------------------------------------
  const [draft, setDraft] = useState<ContactDraft>({
    name: contact.name,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    notes: contact.notes ?? "",
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset do rascunho ao trocar de contato.
  useEffect(() => {
    setDraft({
      name: contact.name,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? "",
    });
    setSaveState("idle");
    ixcLookup.reset();
    ixcDetails.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset apenas por contato
  }, [contact.id]);

  const isDirty =
    draft.name !== contact.name ||
    draft.phone !== (contact.phone ?? "") ||
    draft.email !== (contact.email ?? "") ||
    draft.notes !== (contact.notes ?? "");

  const { mutate: mutateContact } = updateContact;
  useEffect(() => {
    if (!isDirty) return;
    setSaveState("saving");
    const handle = setTimeout(() => {
      const name = draft.name.trim();
      mutateContact(
        {
          id: contact.id,
          input: {
            name: name.length > 0 ? name : contact.name,
            phone: draft.phone.trim().length > 0 ? draft.phone.trim() : null,
            email: draft.email.trim().length > 0 ? draft.email.trim() : null,
            notes: draft.notes.trim().length > 0 ? draft.notes : null,
          },
        },
        {
          onSuccess: () => {
            setSaveState("saved");
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2_000);
          },
          onError: () => setSaveState("idle"),
        },
      );
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara pelas mudanças do rascunho
  }, [draft]);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Custom fields (chave-valor)
  // -------------------------------------------------------------------------
  const customFields = useMemo(() => {
    const entries: { key: string; value: string }[] = [];
    for (const [key, value] of Object.entries(contact.customFields ?? {})) {
      if (value === null || value === undefined) continue;
      if (["string", "number", "boolean"].includes(typeof value)) {
        entries.push({ key, value: String(value) });
      }
    }
    return entries;
  }, [contact.customFields]);

  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");

  const saveCustomFields = (next: Record<string, unknown>): void => {
    mutateContact({ id: contact.id, input: { customFields: next } });
  };

  const setCustomField = (key: string, value: string): void => {
    saveCustomFields({ ...(contact.customFields ?? {}), [key]: value });
  };

  const removeCustomField = (key: string): void => {
    const { [key]: _removed, ...rest } = contact.customFields ?? {};
    saveCustomFields(rest);
  };

  const addCustomField = (): void => {
    const key = newFieldKey.trim();
    if (key.length === 0) return;
    setCustomField(key, newFieldValue.trim());
    setNewFieldKey("");
    setNewFieldValue("");
  };

  // -------------------------------------------------------------------------
  // Memória de longo prazo (CONTRACTS §15) — somente leitura + limpar
  // -------------------------------------------------------------------------
  const handleClearMemory = (): void => {
    if (!contact.memorySummary) return;
    const confirmed = window.confirm(
      "Limpar a memória da IA para este contato? Essa ação não pode ser desfeita.",
    );
    if (!confirmed) return;
    mutateContact({ id: contact.id, input: { memorySummary: null } });
  };

  // -------------------------------------------------------------------------
  // Tags da conversa
  // -------------------------------------------------------------------------
  const allTags = tagsQuery.data ?? [];
  const [tagQuery, setTagQuery] = useState("");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const conversationTagIds = new Set(conversation.tags.map((tag) => tag.id));
  const availableTags = allTags.filter((tag) => !conversationTagIds.has(tag.id));
  const canCreateTag =
    tagQuery.trim().length > 0 &&
    !allTags.some((tag) => tag.name.toLowerCase() === tagQuery.trim().toLowerCase());

  const handleCreateTag = (): void => {
    const name = tagQuery.trim();
    if (name.length === 0) return;
    createTag.mutate(
      { name, color: pickTagColor(name) },
      {
        onSuccess: (tag) => {
          conversationTags.add.mutate(tag.id);
          setTagQuery("");
          setTagPopoverOpen(false);
        },
      },
    );
  };

  const stages = stagesQuery.data ?? [];
  const stage = stages.find((item) => item.id === conversation.stageId);
  const otherConversations = (otherConversationsQuery.data ?? []).filter(
    (item) => item.id !== conversation.id,
  );

  return (
    <aside
      aria-label="Painel do contato"
      className="flex h-full w-[320px] shrink-0 animate-slide-in-right flex-col border-l bg-card/50"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Contato */}
        <div className="space-y-3 p-4">
          <div className="flex flex-col items-center gap-2 pb-1 text-center">
            <UserAvatar
              name={contact.name}
              src={contact.avatarUrl}
              className="h-16 w-16 text-lg"
            />
            <div className="flex h-4 items-center text-[10px] text-muted-foreground">
              {saveState === "saving" || updateContact.isPending ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Salvando…
                </span>
              ) : saveState === "saved" ? (
                <span className="flex items-center gap-1 text-success">
                  <Check className="h-3 w-3" />
                  Salvo
                </span>
              ) : null}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1">
              <Label htmlFor="crm-name" className="text-[11px] text-muted-foreground">
                Nome
              </Label>
              <Input
                id="crm-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, name: event.target.value }))
                }
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="crm-phone" className="text-[11px] text-muted-foreground">
                Telefone
              </Label>
              <Input
                id="crm-phone"
                value={draft.phone}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, phone: event.target.value }))
                }
                placeholder="+55 11 99999-9999"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="crm-email" className="text-[11px] text-muted-foreground">
                E-mail
              </Label>
              <Input
                id="crm-email"
                type="email"
                value={draft.email}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, email: event.target.value }))
                }
                placeholder="contato@empresa.com"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="crm-notes" className="text-[11px] text-muted-foreground">
                Notas
              </Label>
              <Textarea
                id="crm-notes"
                value={draft.notes}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, notes: event.target.value }))
                }
                placeholder="Anotações internas sobre o contato…"
                className="min-h-[72px] resize-none text-sm"
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Conversa */}
        <div className="space-y-2.5 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Conversa
          </h3>
          <dl className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Protocolo</dt>
              <dd className="font-mono text-[11px] font-semibold">{conversation.protocol}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{STATUS_LABELS[conversation.status]}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Departamento</dt>
              <dd className="font-medium">
                {conversation.department ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: conversation.department.color }}
                    />
                    {conversation.department.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Não definido</span>
                )}
              </dd>
            </div>
            {conversation.lastIntent ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Intenção</dt>
                <dd className="font-medium" title={conversation.lastIntent}>
                  {INTENT_LABELS[conversation.lastIntent] ?? conversation.lastIntent}
                  {conversation.triageConfidence !== null
                    ? ` · ${Math.round(conversation.triageConfidence * 100)}%`
                    : ""}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Etapa</dt>
              <dd>
                {stage ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: `${stage.color}1f`,
                      color: stage.color,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: stage.color }}
                    />
                    {stage.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Sem etapa</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Responsável</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {conversation.assignee ? (
                  <>
                    <UserAvatar
                      name={conversation.assignee.name}
                      src={conversation.assignee.avatarUrl}
                      className="h-4 w-4 text-[7px]"
                    />
                    <span className="max-w-32 truncate">
                      {conversation.assignee.name}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Não atribuído</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Canal</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <ChannelIcon type={conversation.channelType} className="h-3.5 w-3.5" />
                {CHANNEL_LABELS[conversation.channelType]}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Criada em</dt>
              <dd className="font-medium">{formatFullDate(conversation.createdAt)}</dd>
            </div>
            {conversation.status === "RESOLVED" ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Motivo</dt>
                  <dd className="max-w-40 truncate font-medium">
                    {conversation.resolutionReason?.name ?? "Não informado"}
                  </dd>
                </div>
                {conversation.resolvedAt ? (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Resolvida em</dt>
                    <dd className="font-medium">{formatFullDate(conversation.resolvedAt)}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        </div>

        <Separator />

        {/* IXC — consulta manual para não transmitir dados sem ação do atendente */}
        <div className="space-y-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Database className="h-3.5 w-3.5" /> Cliente IXC
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!contact.phone || ixcLookup.isPending}
              onClick={() => contact.phone && ixcLookup.mutate(contact.phone)}
            >
              {ixcLookup.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Consultar
            </Button>
          </div>
          {!contact.phone ? (
            <p className="text-xs text-muted-foreground">Cadastre um telefone para pesquisar no IXC.</p>
          ) : ixcLookup.data ? (
            ixcLookup.data.length === 0 ? (
              <p className="rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground">Nenhum cliente correspondente encontrado.</p>
            ) : (
              <div className="space-y-2">
                {ixcLookup.data.map((customer) => (
                  <div key={customer.id} className="rounded-md border bg-muted/20 p-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold">{customer.name}</span>
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", customer.active === true ? "bg-success/15 text-success" : customer.active === false ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
                        {customer.active === true ? "Ativo" : customer.active === false ? "Inativo" : "Status desconhecido"}
                      </span>
                    </div>
                    <dl className="mt-1.5 space-y-1 text-[11px]">
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">ID IXC</dt><dd className="font-mono">{customer.id}</dd></div>
                      {customer.cpfCnpj ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">CPF/CNPJ</dt><dd>{customer.cpfCnpj}</dd></div> : null}
                      {customer.email ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">E-mail</dt><dd className="max-w-40 truncate">{customer.email}</dd></div> : null}
                    </dl>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 w-full text-[11px]"
                      disabled={ixcDetails.isPending}
                      onClick={() =>
                        ixcDetails.mutate({ customerId: customer.id, conversationId: conversation.id, includeInvoices: canSeeInvoices })
                      }
                    >
                      {ixcDetails.isPending && ixcDetails.variables?.customerId === customer.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Database className="h-3 w-3" />
                      )}
                      Ver contratos e suporte
                    </Button>
                    {ixcDetails.data?.customerId === customer.id ? (
                      <div className="mt-2 space-y-2 border-t pt-2 text-[11px]">
                        <div>
                          <p className="font-semibold">Contratos ({ixcDetails.data.contracts.length})</p>
                          {ixcDetails.data.contracts.length === 0 ? (
                            <p className="text-muted-foreground">Nenhum contrato encontrado.</p>
                          ) : (
                            ixcDetails.data.contracts.slice(0, 3).map((contract) => (
                              <p key={contract.id} className="text-muted-foreground">
                                #{contract.id} · {contract.planDescription ?? "Plano não informado"} · {contract.internetStatus ?? contract.status ?? "Sem status"}
                              </p>
                            ))
                          )}
                        </div>
                        <div>
                          <p className="font-semibold">Conexões ({ixcDetails.data.connections.length})</p>
                          {ixcDetails.data.connections.length === 0 ? (
                            <p className="text-muted-foreground">Nenhuma conexão encontrada.</p>
                          ) : (
                            ixcDetails.data.connections.slice(0, 3).map((connection) => (
                              <p key={connection.id} className="text-muted-foreground">
                                Contrato {connection.contractId ?? "—"} · {connection.online === true ? "Online" : connection.online === false ? "Offline" : connection.connectionState ?? "Estado desconhecido"}
                              </p>
                            ))
                          )}
                        </div>
                        <div>
                          <p className="font-semibold">Ordens de serviço ({ixcDetails.data.serviceOrders.length})</p>
                          {ixcDetails.data.serviceOrders.length === 0 ? (
                            <p className="text-muted-foreground">Nenhuma OS encontrada.</p>
                          ) : (
                            ixcDetails.data.serviceOrders.slice(0, 3).map((order) => (
                              <p key={order.id} className="text-muted-foreground">
                                #{order.protocol ?? order.id} · {order.status ?? "Sem status"} · {compactDate(order.openedAt)}
                              </p>
                            ))
                          )}
                        </div>
                        {ixcDetails.data.invoices ? (
                          <div>
                            <p className="font-semibold">Faturas ({ixcDetails.data.invoices.length})</p>
                            {ixcDetails.data.invoices.length === 0 ? (
                              <p className="text-muted-foreground">Nenhuma fatura encontrada.</p>
                            ) : (
                              ixcDetails.data.invoices.slice(0, 3).map((invoice) => (
                                <p key={invoice.id} className="text-muted-foreground">
                                  {compactDate(invoice.dueDate)} · {invoice.openAmount === null ? "Valor não informado" : money.format(invoice.openAmount)} · {invoice.status ?? "Sem status"}
                                </p>
                              ))
                            )}
                          </div>
                        ) : null}
                        <p className="text-[10px] text-muted-foreground">
                          Consulta somente leitura. Senhas, IP, MAC, Wi‑Fi, boleto e Pix não são exibidos.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">A consulta é manual e somente leitura.</p>
          )}
        </div>

        <Separator />

        {/* Tags */}
        <div className="space-y-2.5 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tags
            </h3>
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  aria-label="Adicionar tag"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0">
                <Command shouldFilter>
                  <CommandInput
                    placeholder="Buscar ou criar tag…"
                    value={tagQuery}
                    onValueChange={setTagQuery}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {canCreateTag ? (
                        <button
                          type="button"
                          onClick={handleCreateTag}
                          disabled={createTag.isPending}
                          className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Criar tag “{tagQuery.trim()}”
                        </button>
                      ) : (
                        "Nenhuma tag disponível."
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {availableTags.map((tag) => (
                        <CommandItem
                          key={tag.id}
                          value={tag.name}
                          onSelect={() => {
                            conversationTags.add.mutate(tag.id);
                            setTagPopoverOpen(false);
                            setTagQuery("");
                          }}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </CommandItem>
                      ))}
                      {canCreateTag && availableTags.length > 0 ? (
                        <CommandItem value={`criar-${tagQuery}`} onSelect={handleCreateTag}>
                          <Plus className="h-3.5 w-3.5 text-primary" />
                          <span className="text-primary">
                            Criar tag “{tagQuery.trim()}”
                          </span>
                        </CommandItem>
                      ) : null}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {conversation.tags.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TagIcon className="h-3.5 w-3.5" />
              Nenhuma tag nesta conversa.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {conversation.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-medium"
                  style={{ backgroundColor: `${tag.color}1f`, color: tag.color }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <button
                    type="button"
                    onClick={() => conversationTags.remove.mutate(tag.id)}
                    aria-label={`Remover tag ${tag.name}`}
                    className="rounded-full p-0.5 hover:bg-black/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Campos personalizados */}
        <div className="space-y-2.5 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Campos personalizados
          </h3>

          {customFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum campo cadastrado.</p>
          ) : (
            <div className="space-y-1.5">
              {customFields.map((field) => (
                <CustomFieldRow
                  key={field.key}
                  fieldKey={field.key}
                  value={field.value}
                  onSave={(value) => setCustomField(field.key, value)}
                  onRemove={() => removeCustomField(field.key)}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Input
              value={newFieldKey}
              onChange={(event) => setNewFieldKey(event.target.value)}
              placeholder="Campo"
              aria-label="Nome do campo personalizado"
              className="h-7 flex-1 text-xs"
            />
            <Input
              value={newFieldValue}
              onChange={(event) => setNewFieldValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addCustomField();
              }}
              placeholder="Valor"
              aria-label="Valor do campo personalizado"
              className="h-7 flex-1 text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={newFieldKey.trim().length === 0}
              onClick={addCustomField}
              aria-label="Adicionar campo personalizado"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Memória da IA */}
        <div className="space-y-2 p-4">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Brain className="h-3.5 w-3.5" />
            Memória da IA
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Resumo que a IA mantém sobre este contato, atualizado ao fim de cada conversa
            resolvida — usado para lembrar contexto em conversas futuras.
          </p>
          {contact.memorySummary ? (
            <div className="space-y-1.5">
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2.5 text-xs leading-relaxed">
                {contact.memorySummary}
              </p>
              <div className="flex items-center justify-between gap-2">
                {contact.memoryUpdatedAt ? (
                  <span className="text-[10px] text-muted-foreground">
                    Atualizado {formatRelativeLong(contact.memoryUpdatedAt)}
                  </span>
                ) : (
                  <span />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={handleClearMemory}
                  disabled={updateContact.isPending}
                >
                  Limpar memória
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhuma memória ainda — a IA aprende conversa a conversa.
            </p>
          )}
        </div>

        <Separator />

        {/* Outras conversas */}
        <div className="space-y-2 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Outras conversas
          </h3>
          {otherConversationsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : otherConversations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma outra conversa com este contato.
            </p>
          ) : (
            <div className="space-y-1">
              {otherConversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectConversation(item.id)}
                  className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-accent"
                >
                  <ChannelIcon type={item.channelType} className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {item.lastMessagePreview ?? STATUS_LABELS[item.status]}
                    </span>
                    <span
                      className={cn(
                        "text-[10px]",
                        item.status === "OPEN" ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {STATUS_LABELS[item.status]}
                      {item.lastMessageAt
                        ? ` · ${formatRelativeShort(item.lastMessageAt)}`
                        : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Linha de campo personalizado (edição com salvar no blur/Enter)
// ---------------------------------------------------------------------------

interface CustomFieldRowProps {
  fieldKey: string;
  value: string;
  onSave: (value: string) => void;
  onRemove: () => void;
}

function CustomFieldRow({ fieldKey, value, onSave, onRemove }: CustomFieldRowProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (): void => {
    if (draft.trim() !== value) onSave(draft.trim());
  };

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-24 shrink-0 truncate text-[11px] font-medium text-muted-foreground"
        title={fieldKey}
      >
        {fieldKey}
      </span>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        aria-label={`Valor de ${fieldKey}`}
        className="h-7 flex-1 text-xs"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`Remover campo ${fieldKey}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
