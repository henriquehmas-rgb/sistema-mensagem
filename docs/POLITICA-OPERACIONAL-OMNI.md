# Política operacional do Omni

## Fonte executável

A configuração canônica está em `apps/api/src/operational-policy/omni-operational-policy.ts`, versão `1.0.0`.
Ela também pode ser consultada por administradores e supervisores em
`GET /api/v1/operational-actions/policy`.

## Estado atual

- Modo: `SHADOW`.
- Escrita externa: desabilitada.
- Primeiro modo com escrita real: `REVIEW_REQUIRED`, somente após homologação.
- Piloto: suporte técnico.
- Omni decide e dispara; o IXC executa e permanece como sistema de registro.
- O Olho de Deus fornece somente evidência de rede em leitura.
- A IA nunca escreve diretamente em sistemas externos.

## Barreiras principais

- Identidade válida, skill ativa e departamento correto.
- Confiança mínima efetiva é o maior valor entre o limite da skill e o piso global de `0,85`.
- OS exige falha individual confirmada.
- Rompimento coletivo, evidência inconclusiva ou possível falso positivo bloqueiam ação individual.
- Qualquer ticket ou OS aberta do cliente é tratado como possível duplicidade até o mapeamento
  completo dos campos equivalentes do IXC.

## Parâmetros de rede

- Evidência correlacionada com o cliente: no máximo 2 minutos.
- Tolerância de relógio futuro: 30 segundos.
- Resumo de OLT do Olho de Deus: `stale` após 600 segundos.
- A janela de rompimentos foi informada como 15, mas a unidade ainda precisa ser confirmada.
- Indício coletivo: pelo menos 3 ONUs e 20% da base observada.

## Pendências antes da integração real

- Mapear cliente/contrato do IXC para OLT e PON.
- Homologar os endpoints selecionados, payloads, permissões e retornos de criação definidos no
  `CONTRATO-INTEGRACAO-IXC-OMNI.md`.
- Definir consulta por idempotência depois de timeout, antes de repetir qualquer criação.
- Proteger o transporte do Olho de Deus com HTTPS ou rede privada e trocar a chave exposta em teste.
- Confirmar a unidade da janela de rompimentos da API.

Toda alteração deve gerar uma nova versão desta política e passar novamente pela matriz de homologação.
