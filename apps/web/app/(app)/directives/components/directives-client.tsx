"use client";
import { useState } from "react";
import { Plus, ScrollText } from "lucide-react";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { GlobalDirectiveDto } from "@/lib/global-directives/api";
import { useChangeGlobalDirectiveStatus, useCreateGlobalDirective, useGlobalDirectives } from "@/lib/global-directives/hooks";
import { useAuthStore } from "@/lib/stores/auth";

const labels = { DRAFT: "Rascunho", IN_REVIEW: "Em revisão", APPROVED: "Aprovada", ACTIVE: "Ativa", SUSPENDED: "Suspensa", REPLACED: "Substituída" };
const next = { DRAFT: ["IN_REVIEW", "Enviar para revisão"], IN_REVIEW: ["APPROVED", "Aprovar"], APPROVED: ["ACTIVE", "Ativar"], ACTIVE: ["SUSPENDED", "Suspender"], SUSPENDED: ["ACTIVE", "Reativar"] } as const;
const split = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function DirectiveCard({ item, admin }: { item: GlobalDirectiveDto; admin: boolean }) {
  const mutation = useChangeGlobalDirectiveStatus();
  const action = next[item.status as keyof typeof next];
  return <Card><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"><div className="space-y-2"><div className="flex gap-2"><Badge variant={item.status === "ACTIVE" ? "success" : item.status === "SUSPENDED" ? "destructive" : "secondary"}>{labels[item.status]}</Badge><span className="text-xs text-muted-foreground">v{item.version} · prioridade {item.priority}</span></div><div><h2 className="font-semibold">{item.title}</h2><p className="text-sm text-muted-foreground">{item.category} · Responsável: {item.owner || "não definido"}</p></div><p className="text-xs text-muted-foreground">{item.principles.length} princípios · {item.prohibitions.length} proibições</p></div>{admin && action ? <Button size="sm" variant={item.status === "ACTIVE" ? "destructive" : "outline"} disabled={mutation.isPending} onClick={() => mutation.mutate({ id: item.id, status: action[0] })}>{action[1]}</Button> : null}</CardContent></Card>;
}

export function DirectivesClient() {
  const user = useAuthStore((state) => state.user); const admin = user?.role === "ADMIN";
  const allowed = admin || user?.role === "SUPERVISOR"; const query = useGlobalDirectives();
  const create = useCreateGlobalDirective(); const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", key: "", category: "Atendimento", owner: "", priority: 100, principles: "", prohibitions: "" });
  if (!allowed) return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Área exclusiva para responsáveis.</div>;
  const submit = async () => { await create.mutateAsync({ ...form, principles: split(form.principles), prohibitions: split(form.prohibitions) }); setOpen(false); };
  return <main className="h-full overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-5"><header className="flex justify-between gap-4"><div><div className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-primary"/><h1 className="text-lg font-semibold">Diretrizes globais</h1></div><p className="mt-1 text-sm text-muted-foreground">Regras da SEEG aplicadas a todos os setores, sem substituir as barreiras fixas de segurança.</p></div>{admin ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4"/>Nova diretriz</Button> : null}</header>{query.isError ? <QueryError error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <Skeleton className="h-48 w-full"/> : query.data?.length ? <div className="space-y-3">{query.data.map((item) => <DirectiveCard key={item.id} item={item} admin={admin}/>)}</div> : <Card><CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">Nenhuma diretriz cadastrada.</CardContent></Card>}</div><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Nova diretriz</DialogTitle><DialogDescription>Será criada como rascunho e precisará de revisão antes da ativação.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value, key: v.key || slug(e.target.value) }))}/></div><div><Label>Chave</Label><Input value={form.key} onChange={(e) => setForm((v) => ({ ...v, key: slug(e.target.value) }))}/></div><div><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm((v) => ({ ...v, category: e.target.value }))}/></div><div><Label>Responsável</Label><Input value={form.owner} onChange={(e) => setForm((v) => ({ ...v, owner: e.target.value }))}/></div><div className="sm:col-span-2"><Label>Princípios — um por linha</Label><Textarea rows={4} value={form.principles} onChange={(e) => setForm((v) => ({ ...v, principles: e.target.value }))}/></div><div className="sm:col-span-2"><Label>Proibições — uma por linha</Label><Textarea rows={4} value={form.prohibitions} onChange={(e) => setForm((v) => ({ ...v, prohibitions: e.target.value }))}/></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={create.isPending || !form.title || !form.owner || (!form.principles && !form.prohibitions)} onClick={() => void submit()}>Salvar rascunho</Button></DialogFooter></DialogContent></Dialog></main>;
}
