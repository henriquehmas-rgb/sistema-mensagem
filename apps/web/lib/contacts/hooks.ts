"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type { ContactDto } from "@sm/shared";

import { ApiError } from "@/lib/api";
import { updateContact, type UpdateContactInput } from "@/lib/inbox/api";
import { patchContactInCaches } from "@/lib/inbox/cache";

import {
  createContact,
  getContact,
  listContacts,
  type ContactListFilters,
  type CreateContactInput,
} from "./api";

export const contactsKeys = {
  all: ["contacts"] as const,
  lists: ["contacts", "list"] as const,
  list: (filters: ContactListFilters) =>
    ["contacts", "list", { q: filters.q.trim(), page: filters.page }] as const,
  detail: (id: string) => ["contacts", "detail", id] as const,
};

function errorMessageOf(error: unknown): string {
  return error instanceof ApiError
    ? error.friendlyMessage
    : "Algo deu errado. Tente novamente.";
}

export function useContacts(filters: ContactListFilters) {
  return useQuery({
    queryKey: contactsKeys.list(filters),
    queryFn: () => listContacts(filters),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useContact(id: string | null) {
  return useQuery({
    queryKey: contactsKeys.detail(id ?? "none"),
    queryFn: () => getContact(id ?? ""),
    enabled: id !== null,
    staleTime: 15_000,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactInput) => createContact(input),
    onSuccess: () => {
      toast.success("Contato criado com sucesso.");
      void queryClient.invalidateQueries({ queryKey: contactsKeys.lists });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

/** PATCH /contacts/:id — atualiza detalhe, listagem e caches de conversas. */
export function useUpdateContactProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContactInput }) =>
      updateContact(id, input),
    onSuccess: (contact: ContactDto) => {
      queryClient.setQueryData(contactsKeys.detail(contact.id), contact);
      patchContactInCaches(queryClient, contact);
      void queryClient.invalidateQueries({ queryKey: contactsKeys.lists });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}
