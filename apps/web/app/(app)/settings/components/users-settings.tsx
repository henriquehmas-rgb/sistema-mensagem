"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2, Plus, RefreshCw } from "lucide-react";

import type { Role } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuthStore } from "@/lib/stores/auth";
import { useInviteUser, useUpdateUser, useUsers } from "@/lib/settings/hooks";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  AGENT: "Agente",
};

const ROLE_OPTIONS: Role[] = ["AGENT", "SUPERVISOR", "ADMIN"];

function generateTemporaryPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length] ?? "x").join("");
}

// ---------------------------------------------------------------------------
// Dialog de convite
// ---------------------------------------------------------------------------

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function InviteDialog({ open, onOpenChange }: InviteDialogProps) {
  const inviteUser = useInviteUser();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: generateTemporaryPassword(),
    role: "AGENT" as Role,
  });
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit =
    form.name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.password.length >= 8 &&
    !inviteUser.isPending;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    inviteUser.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
      },
      {
        onSuccess: () => {
          setForm({
            name: "",
            email: "",
            password: generateTemporaryPassword(),
            role: "AGENT",
          });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>
            O usuário entra com o e-mail e a senha temporária abaixo — compartilhe
            com segurança.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Nome *</Label>
            <Input
              id="invite-name"
              value={form.name}
              onChange={(event) =>
                setForm((value) => ({ ...value, name: event.target.value }))
              }
              placeholder="João Souza"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">E-mail *</Label>
            <Input
              id="invite-email"
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((value) => ({ ...value, email: event.target.value }))
              }
              placeholder="joao@empresa.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-password">Senha temporária *</Label>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input
                  id="invite-password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, password: event.target.value }))
                  }
                  className="pr-9 font-mono text-sm"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() =>
                  setForm((value) => ({
                    ...value,
                    password: generateTemporaryPassword(),
                  }))
                }
                aria-label="Gerar nova senha"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Mínimo de 8 caracteres.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Papel *</Label>
            <Select
              value={form.role}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, role: value as Role }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {inviteUser.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Convidar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Aba Usuários (visível apenas para ADMIN)
// ---------------------------------------------------------------------------

export function UsersSettings() {
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === "ADMIN";

  const usersQuery = useUsers(isAdmin);
  const updateUser = useUpdateUser();

  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Apenas administradores podem gerenciar usuários.
      </p>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Usuários da equipe</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Convide atendentes, supervisores e administradores.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Convidar
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ativo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="space-y-1">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="h-3 w-40" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-14" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-5 w-9 rounded-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <UserAvatar
                          name={user.name}
                          src={user.avatarUrl}
                          className="h-8 w-8 text-[10px]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {user.name}
                            {isSelf ? (
                              <span className="ml-1.5 text-[10px] text-muted-foreground">
                                (você)
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {user.email}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ROLE_LABELS[user.role]}
                    </TableCell>
                    <TableCell>
                      {user.isActive ? (
                        <Badge variant="success">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Desativado</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={user.isActive}
                        disabled={isSelf || updateUser.isPending}
                        onCheckedChange={(checked) =>
                          updateUser.mutate({
                            id: user.id,
                            input: { isActive: checked },
                          })
                        }
                        aria-label={
                          user.isActive
                            ? `Desativar ${user.name}`
                            : `Ativar ${user.name}`
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <InviteDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
