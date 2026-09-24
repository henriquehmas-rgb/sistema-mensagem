/*
 * Smoke determinístico para o núcleo multissetor.
 *
 * Ele não chama IA, IXC, Olho de Deus, banco ou canais. Existe para que o
 * gate local continue executável mesmo em ambientes onde o Vitest não pode
 * iniciar por restrições do sandbox. A suíte Vitest continua sendo obrigatória
 * no CI e em estações sem essa limitação.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [path.join(root, 'apps', 'api')],
}));

const transpiledModules = new Map();

function loadTsFile(filePath) {
  if (transpiledModules.has(filePath)) return transpiledModules.get(filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  transpiledModules.set(filePath, mod.exports);
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request);
    const base = path.resolve(path.dirname(filePath), request);
    for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return loadTsFile(candidate);
    }
    return require(base);
  };
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire);
  transpiledModules.set(filePath, mod.exports);
  return mod.exports;
}

function loadTsModule(relativePath) {
  return loadTsFile(path.join(root, relativePath));
}

const { deriveSupportCaseState } = loadTsModule('apps/api/src/support-case-state/support-case-state.policy.ts');
const { planIxcReads } = loadTsModule('apps/api/src/integrations/ixc/ixc-query-planner.ts');
const { classifyHandoff } = loadTsModule('apps/api/src/queues/handoff-classification.ts');
const { assessOperationalReadiness } = loadTsModule('apps/api/src/dashboard/operational-readiness.policy.ts');
const { observeAiReply } = loadTsModule('apps/api/src/queues/response-observation.policy.ts');
const { assessIntegrationActivationReadiness } = loadTsModule('apps/api/src/dashboard/integration-activation-readiness.policy.ts');
const { resilientHandoffReason } = loadTsModule('apps/api/src/queues/technical-resilience.policy.ts');
const { compareTimelineMessageOrder } = loadTsModule('apps/api/src/queues/message-ordering.policy.ts');

const support = deriveSupportCaseState({
  route: 'technical_support', identityVerified: false, identityRequiredNow: false,
  messages: [
    { role: 'user', content: 'Estou sem internet e a luz LOS está vermelha.' },
    { role: 'user', content: 'A LOS apagou, mas continua lento nos dois celulares.' },
  ],
});
assert.equal(support.losLight, 'OFF');
assert.equal(support.currentSymptom, 'SLOWNESS');
assert.equal(support.nextStep, 'ASK_INTERNET_LIGHT');

assert.deepEqual(
  planIxcReads('Como funciona o parcelamento da fatura?', 'billing'),
  {
    actions: [], requiresIdentity: false, identityGate: 'NOT_REQUIRED', reason: null,
    continuedFromPrevious: false, operationalRouteHint: null,
  },
);
assert.equal(
  planIxcReads('Preciso da segunda via da minha fatura.', 'billing').identityGate,
  'REQUIRED_FOR_ACCOUNT_LOOKUP',
);
assert.equal(planIxcReads('Quais planos estão disponíveis?', 'billing').requiresIdentity, false);
assert.equal(
  planIxcReads('Meu CPF final é 418 e o mês é 3', 'billing', 'Preciso da segunda via da minha fatura.').continuedFromPrevious,
  true,
);

for (const reason of [
  'ixc_indisponivel', 'olho_de_deus_indisponivel', 'timeout_da_integracao',
  'credencial_da_integracao_invalida', 'validacao_temporariamente_indisponivel',
]) {
  assert.equal(classifyHandoff(reason).disposition, 'TECHNICAL_INCIDENT', reason);
}
for (const reason of ['sem_contexto_na_base_de_conhecimento', 'contexto_insuficiente']) {
  assert.equal(classifyHandoff(reason).disposition, 'KNOWLEDGE_GAP', reason);
}
for (const reason of ['commercial_approval_required', 'pedido_de_atendimento_humano']) {
  assert.equal(classifyHandoff(reason).disposition, 'OPERATIONAL_REVIEW', reason);
}
assert.equal(
  resilientHandoffReason('contexto_insuficiente', { ixcEvidenceStatus: 'unavailable' }),
  'ixc_indisponivel',
);
assert.equal(
  classifyHandoff(resilientHandoffReason('sem_contexto_na_base_de_conhecimento', {
    ixcEvidenceStatus: 'success', networkReason: 'olho_de_deus_indisponivel',
  })).disposition,
  'TECHNICAL_INCIDENT',
);
assert.deepEqual(
  [
    { id: 'message-b', createdAt: '2026-09-17T18:00:00.000Z' },
    { id: 'message-a', createdAt: '2026-09-17T18:00:00.000Z' },
  ].sort(compareTimelineMessageOrder).map((message) => message.id),
  ['message-a', 'message-b'],
);

const readinessBaseline = {
  sector: 'technical_support', conversations: 30,
  externalChannelConversations: 0,
  triageConflicts: 0, lowConfidenceTriages: 1,
  lowConfidenceWithoutAlternative: 1,
  conversationsWithRepeatedClarification: 3,
  pendingKnowledgeGaps: 0, pendingShadowProposals: 0,
  aiRepliesWithTrace: 24, aiRepliesWithoutTrace: 6,
  unclassifiedAiReplies: 0,
  technicalIncidents: 1, operationalReviews: 0,
};
assert.equal(assessOperationalReadiness(readinessBaseline).status, 'CONTROLLED_USE');
assert.equal(assessOperationalReadiness(readinessBaseline).evidenceScope, 'WEBCHAT_SHADOW');
assert.equal(assessOperationalReadiness({ ...readinessBaseline, conversations: 10 }).status, 'SHADOW_ONLY');
assert.equal(assessOperationalReadiness({ ...readinessBaseline, lowConfidenceTriages: 2 }).status, 'HOLD');

assert.equal(
  observeAiReply({
    reply: 'Pode me dizer se isso acontece perto do roteador?', clarification: true,
    sources: [], identityRequiredNow: false, identityVerified: false,
    caseNextStep: 'ASK_ROUTER_DISTANCE',
  }).clarificationKey,
  'CASE_STEP:ASK_ROUTER_DISTANCE',
);
assert.equal(
  observeAiReply({
    reply: 'Olá, como posso ajudar?', clarification: false,
    sources: [], identityRequiredNow: false, identityVerified: false, caseNextStep: null,
  }).traceExpectation,
  'NOT_REQUIRED',
);

const preflight = assessIntegrationActivationReadiness({
  channels: [
    { channel: 'WHATSAPP', configured: true, hasCredentials: true, hasExternalId: true, lastTestSucceeded: true, approvedTemplates: 1 },
    { channel: 'INSTAGRAM', configured: true, hasCredentials: true, hasExternalId: true, lastTestSucceeded: true, approvedTemplates: 0 },
  ],
  sentryConfigured: true, teamsAlertsConfigured: false,
  confirmedTopologyMappings: 0, shadowTopologyMappings: 1,
});
assert.equal(preflight.channels.every((channel) => channel.status === 'READY_FOR_REVIEW'), true);
assert.equal(preflight.networkDecisionBlocker !== null, true);
assert.equal(preflight.externalDeliveryEnabled, false);

console.log('CORE_REGRESSION_SMOKE_OK');
