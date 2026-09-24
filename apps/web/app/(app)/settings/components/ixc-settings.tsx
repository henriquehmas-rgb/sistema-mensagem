"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useConfigureIxc,
  useIxcAutoViabilityRuntimeConfiguration,
  useIxcConfiguration,
  useTestIxc,
} from "@/lib/settings/hooks";

export function IxcSettings() {
  const configuration = useIxcConfiguration(true);
  const configure = useConfigureIxc();
  const test = useTestIxc();
  const autoViability = useIxcAutoViabilityRuntimeConfiguration(Boolean(configuration.data?.isEnabled));
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    if (!configuration.data) return;
    setBaseUrl(configuration.data.baseUrl);
    setIsEnabled(configuration.data.isEnabled);
  }, [configuration.data]);

  const save = (): void => {
    configure.mutate({
      baseUrl: baseUrl.trim(),
      username: username.trim(),
      ...(token.length > 0 ? { token } : {}),
      isEnabled,
    }, { onSuccess: () => setToken("") });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Integração IXC Provedor
          </CardTitle>
          <CardDescription>
            Acesso somente para consultas de clientes. O token é cifrado e nunca volta para o navegador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ixc-url">URL do Webservice</Label>
            <Input id="ixc-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://ixc.exemplo.com.br/webservice/v1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ixc-user">Usuário Webservice</Label>
            <Input id="ixc-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder="Usuário exclusivo de leitura" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ixc-token">Token</Label>
            <Input id="ixc-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" placeholder={configuration.data?.hasCredentials ? "Deixe vazio para manter o token atual" : "Token do usuário Webservice"} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Habilitar consultas</p>
              <p className="text-xs text-muted-foreground">Ative somente após validar a conexão.</p>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={!configuration.data?.lastTestSucceeded} aria-label="Habilitar integração IXC" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={!baseUrl.trim() || !username.trim() || configure.isPending}>
              {configure.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar configuração
            </Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={!configuration.data?.hasCredentials || test.isPending}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Testar conexão
            </Button>
            {configuration.data?.lastTestSucceeded ? (
              <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Último teste aprovado</span>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            InMap · Auto Viabilidade
          </CardTitle>
          <CardDescription>
            Diagnóstico do motor oficial. Esta leitura não envia endereço ou telefone e não cria prospecção no IXC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {autoViability.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Consultando configuração…</div>
          ) : autoViability.data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {autoViability.data.readyForControlledCheck ? (
                  <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" /> Pronto para homologação controlada</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-warning"><CircleAlert className="h-4 w-4" /> Configuração pendente</span>
                )}
                <span className="text-xs text-muted-foreground">Versão {autoViability.data.version ?? "não informada"}</span>
              </div>
              <dl className="grid gap-2 sm:grid-cols-2 text-xs">
                <div><dt className="text-muted-foreground">Filial</dt><dd className="font-medium">{autoViability.data.hasBranch ? "Configurada" : "Pendente"}</dd></div>
                <div><dt className="text-muted-foreground">Agendamento</dt><dd className="font-medium">{autoViability.data.scheduleConfigured ? "Configurado" : "Não informado"}</dd></div>
                <div><dt className="text-muted-foreground">Assunto de negociação</dt><dd className="font-medium">{autoViability.data.hasNegotiationSubject ? "Configurado" : "Não informado"}</dd></div>
                <div><dt className="text-muted-foreground">Servidor externo</dt><dd className="font-medium">{autoViability.data.usesExternalServer === null ? "Não informado" : autoViability.data.usesExternalServer ? "Sim" : "Não"}</dd></div>
              </dl>
              <p className="text-xs text-muted-foreground">
                A homologação ainda exige consentimento do interessado e um caso de teste. O Omni não repete consultas que possam abrir lead duplicado.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Configure e habilite o IXC para consultar o diagnóstico do InMap.</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        O host também precisa estar autorizado no servidor pela variável IXC_ALLOWED_HOSTS. Consultas individuais e qualquer criação indireta de lead continuam protegidas por consentimento e auditoria.
      </p>
    </div>
  );
}
