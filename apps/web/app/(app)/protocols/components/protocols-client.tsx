"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, Plus, ShieldCheck } from "lucide-react";

import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { listDepartments } from "@/lib/inbox/api";
import type { CreateOperationalSkillInput, OperationalSkillDto } from "@/lib/operational-skills/api";
import {
  useChangeOperationalSkillStatus, useCreateOperationalSkill, useOperationalSkills,
} from "@/lib/operational-skills/hooks";
import { useAuthStore } from "@/lib/stores/auth";

const STATUS_LABELS = {
  DRAFT: "Rascunho", IN_REVIEW: "Em revisão", APPROVED: "Aprovado",
  ACTIVE: "Ativo", SUSPENDED: "Suspenso", REPLACED: "Substituído",
};

const STATUS_VARIANTS = {
  DRAFT: "secondary", IN_REVIEW: "warning", APPROVED: "default",
  ACTIVE: "success", SUSPENDED: "destructive", REPLACED: "outline",
} as const;

const NEXT_STATUS = {
  DRAFT: { status: "IN_REVIEW", label: "Enviar para revisão" },
  IN_REVIEW: { status: "APPROVED", label: "Aprovar conteúdo" },
  APPROVED: { status: "ACTIVE", label: "Ativar protocolo" },
  ACTIVE: { status: "SUSPENDED", label: "Suspender" },
  SUSPENDED: { status: "ACTIVE", label: "Reativar" },
} as const;

const EMPTY_FORM: CreateOperationalSkillInput = {
  key: "", name: "", description: "", owner: "", departmentId: undefined,
  identityRequirement: "NONE", minimumConfidence: 0.8,
  triggerConditions: [], requiredData: [], allowedSources: [], protocolSteps: [],
  allowedActions: [], forbiddenActions: [], completionCriteria: [],
  reviewConditions: [], humanHandoffConditions: [],
};
const PROPOSABLE_ACTIONS = [
  ["request_ticket", "Propor chamado"],
  ["request_service_order", "Propor ordem de serviço"],
] as const;

const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function SkillCard({ skill, canEdit }: { skill: OperationalSkillDto; canEdit: boolean }) {
  const statusMutation = useChangeOperationalSkillStatus();
  const next = NEXT_STATUS[skill.status as keyof typeof NEXT_STATUS];
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANTS[skill.status]}>{STATUS_LABELS[skill.status]}</Badge>
              <span className="text-xs text-muted-foreground">v{skill.version}</span>
              <span className="text-xs text-muted-foreground">{skill.department?.name ?? "Regra geral"}</span>
            </div>
            <div>
              <h2 className="font-semibold">{skill.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {skill.description || "Sem descrição."}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>Responsável: <strong className="text-foreground">{skill.owner || "não definido"}</strong></span>
              <span>Confiança mínima: <strong className="text-foreground">{Math.round(skill.minimumConfidence * 100)}%</strong></span>
              <span>{skill.protocolSteps.length} etapas</span>
              <span>{skill.allowedSources.length} fontes autorizadas</span>
            </div>
            {skill.allowedActions.some((action) => [
              "create_commercial_proposal", "grant_discount", "change_price", "change_commercial_terms",
            ].includes(action)) ? (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <ShieldCheck className="h-3.5 w-3.5" /> Ação comercial: revisão humana obrigatória.
              </p>
            ) : null}
          </div>
          {canEdit && next ? (
            <Button
              size="sm"
              variant={skill.status === "ACTIVE" ? "destructive" : "outline"}
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ id: skill.id, status: next.status })}
            >
              {next.label}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProtocolsClient() {
  const user = useAuthStore((state) => state.user);
  const canView = user?.role === "ADMIN" || user?.role === "SUPERVISOR";
  const canEdit = user?.role === "ADMIN";
  const skills = useOperationalSkills();
  const departments = useQuery({ queryKey: ["departments"], queryFn: listDepartments, enabled: canView });
  const createMutation = useCreateOperationalSkill();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [text, setText] = useState({
    triggers: "", required: "", sources: "", steps: "", forbidden: "",
    completion: "", reviews: "", handoff: "",
  });

  if (!canView) return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Esta área é exclusiva para responsáveis pelos protocolos.</div>;

  const submit = async () => {
    await createMutation.mutateAsync({
      ...form,
      triggerConditions: lines(text.triggers), requiredData: lines(text.required),
      allowedSources: lines(text.sources), protocolSteps: lines(text.steps),
      forbiddenActions: lines(text.forbidden), completionCriteria: lines(text.completion),
      reviewConditions: lines(text.reviews), humanHandoffConditions: lines(text.handoff),
    });
    setOpen(false); setForm(EMPTY_FORM);
    setText({ triggers: "", required: "", sources: "", steps: "", forbidden: "", completion: "", reviews: "", handoff: "" });
  };

  return (
    <main className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5 text-primary" /><h1 className="text-lg font-semibold">Protocolos do Omni</h1></div>
            <p className="mt-1 text-sm text-muted-foreground">Regras versionadas que orientam a IA sem substituir as barreiras de segurança.</p>
          </div>
          {canEdit ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Novo protocolo</Button> : null}
        </header>

        {skills.isError ? <QueryError error={skills.error} onRetry={() => void skills.refetch()} retrying={skills.isFetching} />
          : skills.isLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 w-full" />)}</div>
          : skills.data?.length === 0 ? <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center"><BookOpenCheck className="mb-3 h-8 w-8 text-muted-foreground/50" /><p className="font-medium">Nenhum protocolo cadastrado</p><p className="mt-1 text-sm text-muted-foreground">Comece em rascunho e revise antes de ativar.</p></CardContent></Card>
          : <div className="space-y-3">{skills.data?.map((skill) => <SkillCard key={skill.id} skill={skill} canEdit={canEdit} />)}</div>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Novo protocolo</DialogTitle><DialogDescription>O protocolo será salvo como rascunho. Use uma linha para cada regra ou etapa.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="skill-name">Nome</Label><Input id="skill-name" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value, key: v.key || slug(e.target.value) }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="skill-key">Chave</Label><Input id="skill-key" value={form.key} onChange={(e) => setForm((v) => ({ ...v, key: slug(e.target.value) }))} /></div>
            <div className="space-y-1.5"><Label>Setor</Label><Select value={form.departmentId ?? "global"} onValueChange={(value) => setForm((v) => ({ ...v, departmentId: value === "global" ? undefined : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="global">Regra geral</SelectItem>{departments.data?.filter((d) => d.isActive).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="skill-owner">Responsável</Label><Input id="skill-owner" value={form.owner} onChange={(e) => setForm((v) => ({ ...v, owner: e.target.value }))} placeholder="Pessoa ou função responsável" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="skill-description">Objetivo</Label><Input id="skill-description" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Verificação de identidade</Label><Select value={form.identityRequirement} onValueChange={(value: CreateOperationalSkillInput["identityRequirement"]) => setForm((v) => ({ ...v, identityRequirement: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Não necessária</SelectItem><SelectItem value="LAST_3_CPF">Legado: 3 últimos números</SelectItem><SelectItem value="STRONG">CPF completo com proteção</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="skill-confidence">Confiança mínima: {Math.round(form.minimumConfidence * 100)}%</Label><Input id="skill-confidence" type="range" min="0.65" max="1" step="0.05" value={form.minimumConfidence} onChange={(e) => setForm((v) => ({ ...v, minimumConfidence: Number(e.target.value) }))} /></div>
            <Field label="Quando usar" value={text.triggers} onChange={(triggers) => setText((v) => ({ ...v, triggers }))} placeholder="cliente sem conexão" />
            <Field label="Dados necessários" value={text.required} onChange={(required) => setText((v) => ({ ...v, required }))} placeholder="contrato ativo" />
            <Field label="Fontes permitidas" value={text.sources} onChange={(sources) => setText((v) => ({ ...v, sources }))} placeholder="ID da fonte aprovada — use * somente após revisão" />
            <Field label="Etapas do atendimento" value={text.steps} onChange={(steps) => setText((v) => ({ ...v, steps }))} placeholder="Confirmar o sintoma\nConsultar o estado da conexão" />
            <Field label="Critérios de conclusão" value={text.completion} onChange={(completion) => setText((v) => ({ ...v, completion }))} />
            <Field label="Quando consultar uma pessoa" value={text.handoff} onChange={(handoff) => setText((v) => ({ ...v, handoff }))} />
            <Field label="Revisões obrigatórias" value={text.reviews} onChange={(reviews) => setText((v) => ({ ...v, reviews }))} placeholder="Toda condição comercial personalizada" />
            <Field label="Ações proibidas" value={text.forbidden} onChange={(forbidden) => setText((v) => ({ ...v, forbidden }))} />
            <div className="space-y-2 sm:col-span-2"><Label>Ações que o protocolo pode propor</Label><div className="flex flex-wrap gap-4">{PROPOSABLE_ACTIONS.map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><Checkbox checked={form.allowedActions.includes(value)} onCheckedChange={(checked) => setForm((v) => ({ ...v, allowedActions: checked ? [...v.allowedActions, value] : v.allowedActions.filter((item) => item !== value) }))} />{label}</label>)}</div></div>
          </div>
          <p className="text-xs text-muted-foreground">Para ativar, será obrigatório definir responsável, fonte permitida e ao menos uma etapa.</p>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={createMutation.isPending || !form.name || !form.key} onClick={() => void submit()}>{createMutation.isPending ? "Salvando…" : "Salvar rascunho"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}
