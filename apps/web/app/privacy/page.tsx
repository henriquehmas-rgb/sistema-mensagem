import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Política de Privacidade do SEEG Omni.",
};

const updatedAt = "20 de setembro de 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <header className="border-b pb-8">
        <p className="text-sm font-medium text-primary">SEEG Omni</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Política de Privacidade
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Última atualização: {updatedAt}
        </p>
      </header>

      <article className="space-y-8 py-9 text-sm leading-7 text-muted-foreground">
        <p>
          Esta Política descreve como a Seeg Fibras Telecomunicações Ltda.
          utiliza dados pessoais no SEEG Omni, ambiente de atendimento que
          centraliza conversas de clientes e interessados por canais como
          WhatsApp, Instagram e webchat.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Dados tratados</h2>
          <p className="mt-2">
            Podemos tratar dados de identificação e contato, mensagens,
            anexos, informações fornecidas durante o atendimento, dados do
            canal de origem e registros técnicos necessários para segurança,
            auditoria e continuidade da conversa. Quando autorizado para o
            atendimento, o sistema também pode consultar informações
            operacionais nos sistemas integrados da SEEG.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Finalidades</h2>
          <p className="mt-2">
            Os dados são usados para responder solicitações, prestar suporte,
            apresentar propostas, direcionar o atendimento ao setor adequado,
            preservar o contexto da conversa, aprimorar a qualidade do
            serviço, prevenir fraudes e cumprir obrigações legais e
            regulatórias aplicáveis.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Compartilhamento</h2>
          <p className="mt-2">
            O acesso é restrito a pessoas autorizadas da SEEG e a fornecedores
            estritamente necessários para operar os canais de atendimento e a
            infraestrutura tecnológica. Dados também poderão ser tratados
            quando exigido por lei ou por autoridade competente. A SEEG não
            comercializa dados pessoais de conversas.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Segurança e retenção</h2>
          <p className="mt-2">
            Adotamos controles de acesso, registros de auditoria e medidas
            técnicas proporcionais para proteger as informações. Os dados são
            mantidos pelo período necessário às finalidades descritas, à
            continuidade do relacionamento e às obrigações legais aplicáveis.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Seus direitos</h2>
          <p className="mt-2">
            Você pode solicitar informações, correção, eliminação quando
            aplicável ou outros direitos previstos na legislação de proteção
            de dados pelos canais oficiais de atendimento da SEEG. Identifique
            a solicitação como <strong className="font-medium text-foreground">“Privacidade – Omni”</strong>.
            Para exclusão de dados, consulte também as
            {" "}<a className="font-medium text-primary underline underline-offset-4" href="/data-deletion">instruções de exclusão</a>.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Atualizações</h2>
          <p className="mt-2">
            Esta política poderá ser atualizada para refletir mudanças legais,
            operacionais ou tecnológicas. A versão vigente permanecerá nesta
            página.
          </p>
        </section>
      </article>
    </main>
  );
}
