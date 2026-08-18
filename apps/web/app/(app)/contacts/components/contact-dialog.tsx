"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

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
import { useCreateContact } from "@/lib/contacts/hooks";

interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY_FORM = { name: "", phone: "", email: "" };

/** Dialog "Novo contato" — nome obrigatório, telefone/e-mail opcionais. */
export function ContactDialog({ open, onOpenChange }: ContactDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const createContact = useCreateContact();

  const canSubmit = form.name.trim().length > 0 && !createContact.isPending;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    createContact.mutate(
      {
        name: form.name.trim(),
        ...(form.phone.trim().length > 0 ? { phone: form.phone.trim() } : {}),
        ...(form.email.trim().length > 0 ? { email: form.email.trim() } : {}),
      },
      {
        onSuccess: () => {
          setForm(EMPTY_FORM);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo contato</DialogTitle>
          <DialogDescription>
            Cadastre um contato manualmente. Conversas dos canais criam contatos
            automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Nome *</Label>
            <Input
              id="contact-name"
              value={form.name}
              onChange={(event) =>
                setForm((value) => ({ ...value, name: event.target.value }))
              }
              placeholder="Maria da Silva"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-phone">Telefone</Label>
            <Input
              id="contact-phone"
              value={form.phone}
              onChange={(event) =>
                setForm((value) => ({ ...value, phone: event.target.value }))
              }
              placeholder="+55 11 99999-9999"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-email">E-mail</Label>
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((value) => ({ ...value, email: event.target.value }))
              }
              placeholder="contato@empresa.com"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createContact.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Criar contato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
