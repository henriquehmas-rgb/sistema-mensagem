"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Bot,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  SquareKanban,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Inbox unificada",
    description: "WhatsApp, Instagram e Webchat em uma única fila de atendimento.",
  },
  {
    icon: Bot,
    title: "IA com a sua base de conhecimento",
    description: "Respostas automáticas com guardrails e passagem para humanos.",
  },
  {
    icon: SquareKanban,
    title: "Kanban de conversas",
    description: "Pipeline visual com arrastar e soltar em tempo real.",
  },
] as const;

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-brand-gradient lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Decoração */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-black/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.08),transparent_50%)]"
      />

      <div className="relative flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 shadow-soft backdrop-blur-sm">
          <MessageSquare className="h-6 w-6 text-white" />
        </div>
        <span className="text-xl font-semibold tracking-tight text-white">
          {APP_NAME}
        </span>
      </div>

      <div className="relative max-w-md animate-fade-up">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white">
          Todas as suas conversas.
          <br />
          Um só lugar.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-white/80">
          {APP_TAGLINE}
        </p>

        <ul className="mt-10 space-y-5">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                <feature.icon className="h-[18px] w-[18px] text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{feature.title}</p>
                <p className="mt-0.5 text-sm text-white/70">
                  {feature.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-white/60">
        © {new Date().getFullYear()} SEEG — {APP_NAME}
      </p>
    </div>
  );
}

function resolveNextPath(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/inbox";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuthStore((state) => state.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): boolean => {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errors.email = "Informe seu e-mail.";
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = "Informe um e-mail válido.";
    }
    if (!password) {
      errors.password = "Informe sua senha.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const user = await login({ email: email.trim(), password });
      toast.success(`Bem-vindo de volta, ${user.name.split(" ")[0] ?? ""}!`);
      router.replace(resolveNextPath(searchParams.get("next")));
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.friendlyMessage
          : "Algo deu errado. Tente novamente.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-sm animate-fade-up">
      {/* Logo visível apenas no mobile (painel esquerdo oculto) */}
      <div className="mb-10 flex items-center gap-3 lg:hidden">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient shadow-soft">
          <MessageSquare className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">
          Entrar na sua conta
        </h2>
        <p className="text-sm text-muted-foreground">
          Use suas credenciais para acessar a plataforma.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
        {serverError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive animate-fade-in"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            disabled={isSubmitting}
            className={cn(
              fieldErrors.email &&
                "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
            )}
          />
          {fieldErrors.email ? (
            <p className="text-xs text-destructive">{fieldErrors.email}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              disabled={isSubmitting}
              className={cn(
                "pr-10",
                fieldErrors.password &&
                  "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
              )}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {fieldErrors.password ? (
            <p className="text-xs text-destructive">{fieldErrors.password}</p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" />
              Entrando…
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Entrar
            </>
          )}
        </Button>
      </form>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Acesso restrito à equipe. Problemas para entrar? Fale com um
        administrador.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <BrandPanel />
      <div className="flex items-center justify-center px-6 py-12">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
