"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";

import { QueryError } from "@/components/query-error";
import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTACTS_PAGE_SIZE, type ContactListItemDto } from "@/lib/contacts/api";
import { useContacts } from "@/lib/contacts/hooks";

import { ContactDialog } from "./contact-dialog";
import { ContactSheet } from "./contact-sheet";

const SEARCH_DEBOUNCE_MS = 300;
const MAX_VISIBLE_TAGS = 3;

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd/MM/yyyy");
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, index) => (
        <TableRow key={index}>
          <TableCell>
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-36" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-8" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function ContactTags({ contact }: { contact: ContactListItemDto }) {
  const tags = contact.tags ?? [];
  if (tags.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const visible = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflow = tags.length - visible.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${tag.color}1f`, color: tag.color }}
        >
          <span
            className="h-1 w-1 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export function ContactsClient() {
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  // Busca server-side com debounce (volta para a página 1).
  useEffect(() => {
    const handle = setTimeout(() => {
      setQ((current) => {
        if (current === searchInput.trim()) return current;
        setPage(1);
        return searchInput.trim();
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const filters = useMemo(() => ({ q, page }), [q, page]);
  const contactsQuery = useContacts(filters);

  const contacts = contactsQuery.data?.data ?? [];
  const total = contactsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const isLoading = contactsQuery.isLoading;

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      {/* Topo */}
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight">Contatos</h1>
        {total > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {total}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nome, telefone, e-mail…"
              aria-label="Buscar contatos"
              className="h-9 pl-8 pr-8"
            />
            {searchInput.length > 0 ? (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Novo contato
          </Button>
        </div>
      </header>

      {/* Tabela */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Conversas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton />
              ) : contactsQuery.isError && contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40">
                    <QueryError
                      error={contactsQuery.error}
                      retrying={contactsQuery.isFetching}
                      onRetry={() => void contactsQuery.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <p className="text-sm font-medium">Nenhum contato encontrado</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {q.length > 0
                        ? "Tente ajustar a busca."
                        : "Contatos são criados automaticamente com as conversas dos canais."}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer"
                    onClick={() => setOpenContactId(contact.id)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <UserAvatar
                          name={contact.name}
                          src={contact.avatarUrl}
                          className="h-8 w-8 text-[10px]"
                        />
                        <span className="font-medium">{contact.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.phone ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ContactTags contact={contact} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatCreatedAt(contact.createdAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {contact.conversationCount ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Paginação */}
        {totalPages > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs tabular-nums text-muted-foreground">
              Página {page} de {totalPages} · {total} contatos
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1 || contactsQuery.isFetching}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages || contactsQuery.isFetching}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                aria-label="Próxima página"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ContactDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ContactSheet
        contactId={openContactId}
        onClose={() => setOpenContactId(null)}
      />
    </div>
  );
}
