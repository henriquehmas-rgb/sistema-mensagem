"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useConfigureOlhoDeDeus,
  useOlhoDeDeusConfiguration,
  useTestOlhoDeDeus,
} from "@/lib/settings/hooks";

/** Apenas ADMIN enxerga este componente (proteção também existe na API). */
export function OlhoDeDeusSettings() {
  const configuration = useOlhoDeDeusConfiguration(true);
  const configure = useConfigureOlhoDeDeus();
  const test = useTestOlhoDeDeus();
  const [baseUrl, setBaseUrl] = useState("");
  const [allowedHosts, setAllowedHosts] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    if (!configuration.data) return;
    setBaseUrl(configuration.data.baseUrl);
    setAllowedHosts(configuration.data.allowedHosts.join(", "));
    setAllowInsecureHttp(configuration.data.allowInsecureHttp);
    setIsEnabled(configuration.data.isEnabled);
  }, [configuration.data]);

  const save = (): void => {
    configure.mutate({
      baseUrl: baseUrl.trim(),
      allowedHosts: allowedHosts.trim(),
      ...(apiKey.length > 0 ? { apiKey } : {}),
      allowInsecureHttp,
      isEnabled,
    }, { onSuccess: () => setApiKey("") });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Olho de Deus — evidência de rede
          </CardTitle>
          <CardDescription>
            Leitura técnica agregada de OLT/PON. A chave é cifrada, nunca volta ao navegador e esta integração não cria chamado ou OS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="odg-url">URL base da API</Label>
            <Input id="odg-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://monitoramento.exemplo.com/api/vis" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="odg-hosts">Hosts autorizados</Label>
            <Input id="odg-hosts" value={allowedHosts} onChange={(event) => setAllowedHosts(event.target.value)} autoComplete="off" placeholder="monitoramento.exemplo.com" />
            <p className="text-xs text-muted-foreground">Separe hosts por vírgula. O host da URL precisa constar nesta lista.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="odg-key">Chave da API</Label>
            <Input id="odg-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={configuration.data?.hasCredentials ? "Deixe vazio para manter a chave atual" : "Chave exclusiva de leitura"} />
          </div>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="space-y-2">
                <p className="text-sm font-medium">HTTP temporário</p>
                <p className="text-xs text-muted-foreground">Ative somente enquanto o acesso seguro não estiver disponível. A exceção fica auditada e deve ser removida ao migrar para HTTPS.</p>
                <div className="flex items-center gap-2">
                  <Switch checked={allowInsecureHttp} onCheckedChange={setAllowInsecureHttp} aria-label="Permitir HTTP temporariamente" />
                  <span className="text-xs">Permitir HTTP temporariamente</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Habilitar leitura técnica</p>
              <p className="text-xs text-muted-foreground">Ative somente após o teste. Não altera decisões automáticas nesta fase.</p>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={!configuration.data?.lastTestSucceeded} aria-label="Habilitar leitura do Olho de Deus" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={!baseUrl.trim() || !allowedHosts.trim() || configure.isPending}>
              {configure.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar configuração
            </Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={!configuration.data?.hasCredentials || test.isPending}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Testar leitura
            </Button>
            {configuration.data?.lastTestSucceeded ? (
              <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Último teste aprovado</span>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Somente ADMIN pode configurar ou testar. A integração continua exclusivamente em leitura e não é fonte de cadastro, contrato ou escrita no IXC.</p>
    </div>
  );
}
