"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";

import type { ContactDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { useContact, useUpdateContactProfile } from "@/lib/contacts/hooks";
import { useContactConversations } from "@/lib/inbox/hooks";
import { formatFullDate, formatRelativeShort } from "@/lib/inbox/utils";
import { useInboxStore } from "@/lib/stores/inbox";
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
    </Sheet>
  );
}
