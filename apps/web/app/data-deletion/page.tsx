import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solicitação de Exclusão de Dados",
  description: "Instruções para solicitar exclusão de dados no SEEG Omni.",
};

export default function DataDeletionPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <header className="border-b pb-8">
        <p className="text-sm font-medium text-primary">SEEG Omni</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Solicitação de Exclusão de Dados
        </h1>
      </header>

      <article className="space-y-8 py-9 text-sm leading-7 text-muted-foreground">
        <p>
          Você pode solicitar a exclusão de dados pessoais tratados no SEEG
          Omni pelos canais oficiais de atendimento da SEEG.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Como solicitar</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>Contate a SEEG por um canal oficial de atendimento.</li>
            <li>Informe que se trata de uma solicitação “Exclusão de Dados – Omni”.</li>
            <li>
              Informe seu nome e o telefone ou canal usado na conversa para
              que possamos localizar o registro. Não envie senhas, códigos de
              autenticação, dados bancários ou documentos completos.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Validação e prazo</h2>
          <p className="mt-2">
            Para proteger sua privacidade, poderemos confirmar a identidade do
            solicitante antes de executar o pedido. A solicitação será
            analisada e respondida pelos canais oficiais da SEEG, observadas
            as hipóteses de retenção exigidas por lei, defesa de direitos,
            prevenção a fraudes ou manutenção de registros obrigatórios.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Escopo</h2>
          <p className="mt-2">
            A exclusão se aplica aos dados sob controle da SEEG no ambiente
            Omni. Registros que estejam sujeitos a obrigação legal de guarda
            poderão ser mantidos pelo prazo estritamente necessário e terão o
            tratamento limitado a essa finalidade.
          </p>
        </section>

        <p>
          Consulte também a {" "}
          <a className="font-medium text-primary underline underline-offset-4" href="/privacy">Política de Privacidade</a>.
        </p>
      </article>
    </main>
  );
}
