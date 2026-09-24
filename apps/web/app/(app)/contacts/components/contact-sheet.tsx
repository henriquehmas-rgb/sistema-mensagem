"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, GitMerge, Loader2 } from "lucide-react";

import type { ContactDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useContact, useContacts, useMergeContacts, useUpdateContactProfile } from "@/lib/contacts/hooks";
import { useContactConversations } from "@/lib/inbox/hooks";
import { formatFullDate, formatRelativeShort } from "@/lib/inbox/utils";
import { useInboxStore } from "@/lib/stores/inbox";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

import {
  CHANNEL_LABELS,
  ChannelIcon,
} from "../../inbox/components/channel-icons";

const STATUS_LABELS = {
  OPEN: "Aberta",
  PENDING: "Pendente",
  RESOLVED: "Resolvida",
  SNOOZED: "Adiada",
} as const;

interface ContactSheetProps {
  contactId: string | null;
  onClose: () => void;
}

interface ContactForm {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

function toForm(contact: ContactDto): ContactForm {
  return {
    name: contact.name,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    notes: contact.notes ?? "",
  };
}

/** Sheet de detalhe do contato — dados editáveis + conversas com link. */
export function ContactSheet({ contactId, onClose }: ContactSheetProps) {
  const router = useRouter();
  const contactQuery = useContact(contactId);
  const conversationsQuery = useContactConversations(contactId);
  const updateContact = useUpdateContactProfile();
  const mergeContact = useMergeContacts();
  const user = useAuthStore((state) => state.user);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [sourceContactId, setSourceContactId] = useState<string | null>(null);
  const mergeCandidatesQuery = useContacts({ q: mergeSearch, page: 1 });

  const contact = contactQuery.data ?? null;

  const [form, setForm] = useState<ContactForm>({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });

  useEffect(() => {
    if (contact) setForm(toForm(contact));
  }, [contact]);

  const isDirty =
    contact !== null &&
    (form.name !== contact.name ||
      form.phone !== (contact.phone ?? "") ||
      form.email !== (contact.email ?? "") ||
      form.notes !== (contact.notes ?? ""));

  const handleSave = (): void => {
    if (!contact || !isDirty) return;
    const name = form.name.trim();
    updateContact.mutate({
      id: contact.id,
      input: {
        name: name.length > 0 ? name : contact.name,
        phone: form.phone.trim().length > 0 ? form.phone.trim() : null,
        email: form.email.trim().length > 0 ? form.email.trim() : null,
        notes: form.notes.trim().length > 0 ? form.notes : null,
      },
    });
  };

  const openConversation = (conversationId: string): void => {
    useInboxStore.getState().setActiveConversation(conversationId);
    router.push("/inbox");
  };

  const conversations = conversationsQuery.data ?? [];
  const canMerge = user?.role === "ADMIN" || user?.role === "SUPERVISOR";
  const mergeCandidates = (mergeCandidatesQuery.data?.data ?? []).filter((candidate) => candidate.id !== contact?.id);
  const sourceContact = mergeCandidates.find((candidate) => candidate.id === sourceContactId) ?? null;

  const confirmMerge = async (): Promise<void> => {
    if (!contact || !sourceContactId) return;
    await mergeContact.mutateAsync({ targetContactId: contact.id, sourceContactId });
    setMergeOpen(false);
    setMergeSearch("");
    setSourceContactId(null);
  };

  return (
    <Sheet open={contactId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          {contact ? (
            <div className="flex items-center gap-3">
              <UserAvatar
                name={contact.name}
                src={contact.avatarUrl}
                className="h-12 w-12 text-base"
              />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base">{contact.name}</SheetTitle>
                <SheetDescription className="text-xs">
                  Contato desde {formatFullDate(contact.createdAt)}
                </SheetDescription>
              </div>
            </div>
          ) : (
            <>
              <SheetTitle className="sr-only">Carregando contato</SheetTitle>
              <SheetDescription className="sr-only">
                Carregando dados do contato…
              </SheetDescription>
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            </>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Dados editáveis */}
          <div className="space-y-3 p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Dados do contato
            </h3>
            <div className="space-y-2.5">
              <div className="space-y-1">
                <Label htmlFor="sheet-contact-name" className="text-xs">
                  Nome
                </Label>
                <Input
                  id="sheet-contact-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, name: event.target.value }))
                  }
                  disabled={!contact}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sheet-contact-phone" className="text-xs">
                  Telefone
                </Label>
                <Input
                  id="sheet-contact-phone"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, phone: event.target.value }))
                  }
                  placeholder="+55 11 99999-9999"
                  disabled={!contact}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sheet-contact-email" className="text-xs">
                  E-mail
                </Label>
                <Input
                  id="sheet-contact-email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, email: event.target.value }))
                  }
                  placeholder="contato@empresa.com"
                  disabled={!contact}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sheet-contact-notes" className="text-xs">
                  Notas
                </Label>
                <Textarea
                  id="sheet-contact-notes"
                  value={form.notes}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, notes: event.target.value }))
                  }
                  placeholder="Anotações internas sobre o contato…"
                  disabled={!contact}
                  className="min-h-20 resize-none text-sm"
                />
              </div>
            </div>
            {canMerge ? (
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setMergeOpen(true)}
                disabled={!contact}
              >
                <GitMerge className="h-4 w-4" />
                Unificar registro
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={!isDirty || updateContact.isPending}
              onClick={handleSave}
            >
              {updateContact.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Salvar alterações
            </Button>
          </div>

          <Separator />

          {/* Conversas do contato */}
          <div className="space-y-2.5 p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Conversas ({conversations.length})
            </h3>
            {conversationsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma conversa com este contato ainda.
              </p>
            ) : (
              <div className="space-y-1.5">
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                    className="group flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <ChannelIcon
                      type={conversation.channelType}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {conversation.lastMessagePreview ??
                          CHANNEL_LABELS[conversation.channelType]}
                      </span>
                      <span
                        className={cn(
                          "text-[10px]",
                          conversation.status === "OPEN"
                            ? "text-success"
                            : "text-muted-foreground",
                        )}
                      >
                        {STATUS_LABELS[conversation.status]}
                        {conversation.lastMessageAt
                          ? ` · ${formatRelativeShort(conversation.lastMessageAt)}`
                          : ""}
                      </span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
      <Dialog open={mergeOpen} onOpenChange={(open) => {
        setMergeOpen(open);
        if (!open) {
          setMergeSearch("");
          setSourceContactId(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unificar registros de contato</DialogTitle>
            <DialogDescription>
              Escolha o registro duplicado que pertence à mesma pessoa. As conversas e identidades dele serão movidas para {contact?.name || "este contato"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="merge-contact-search">Buscar por nome ou telefone</Label>
              <Input
                id="merge-contact-search"
                value={mergeSearch}
                onChange={(event) => {
                  setMergeSearch(event.target.value);
                  setSourceContactId(null);
                }}
                placeholder="Digite ao menos parte do nome ou telefone"
              />
            </div>
            {mergeSearch.trim().length < 2 ? (
              <p className="text-xs text-muted-foreground">Pesquise o outro registro e confira os dados antes de unificar.</p>
            ) : mergeCandidatesQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : mergeCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum outro contato encontrado.</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
                {mergeCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSourceContactId(candidate.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-accent",
                      sourceContactId === candidate.id && "bg-primary/10 ring-1 ring-primary/30",
                    )}
                  >
                    <span className="min-w-0"><span className="block truncate font-medium">{candidate.name}</span><span className="block truncate text-xs text-muted-foreground">{candidate.phone || candidate.email || "Sem telefone/e-mail"}</span></span>
                    {sourceContactId === candidate.id ? <span className="text-xs font-medium text-primary">Selecionado</span> : null}
                  </button>
                ))}
              </div>
            )}
            {sourceContact ? <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">Confirme somente após verificar que “{sourceContact.name}” é a mesma pessoa. Duas conversas abertas no mesmo canal não serão unificadas.</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Cancelar</Button>
            <Button disabled={!sourceContact || mergeContact.isPending} onClick={() => void confirmMerge()}>
              {mergeContact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              Unificar com segurança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
