import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IxcService } from './ixc.service';

const ORG_ID = 'org_seeg';
const integration = {
  id: 'ixc_1',
  orgId: ORG_ID,
  baseUrl: 'https://ixc.example.com/webservice/v1',
  encryptedCredentials: 'encrypted',
  isEnabled: true,
  lastTestedAt: null,
  lastTestSucceeded: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function harness() {
  const model = {
    findUnique: vi.fn().mockResolvedValue(integration),
    upsert: vi.fn().mockResolvedValue(integration),
    update: vi.fn().mockResolvedValue(integration),
  };
  const conversation = { findFirst: vi.fn().mockResolvedValue({ identityVerifiedAt: new Date() }) };
  const systemConversation = {
    findFirst: vi.fn().mockResolvedValue({
      id: 'conv_1', contactId: 'contact_1', identityVerifiedAt: new Date(),
      contact: { phone: '(65) 99999-0000' },
    }),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const contact = { update: vi.fn().mockResolvedValue(undefined) };
  const systemIntegration = { findFirst: vi.fn().mockResolvedValue(integration) };
  const prisma = {
    tenant: { ixcIntegration: model, conversation },
    prismaSystem: { conversation: systemConversation, contact, ixcIntegration: systemIntegration },
  };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue(ORG_ID) };
  const crypto = {
    encrypt: vi.fn().mockReturnValue('encrypted-new'),
    decrypt: vi.fn().mockReturnValue(JSON.stringify({ username: 'api-user', token: 'secret' })),
  };
  const config = { get: vi.fn().mockReturnValue('ixc.example.com') };
  const audit = { log: vi.fn().mockResolvedValue(undefined), logSystem: vi.fn().mockResolvedValue(undefined) };
  const http = { list: vi.fn().mockResolvedValue({ registros: [] }) };
  const redis = { client: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() } };
  const caseState = { recordSalesCoverageOutcome: vi.fn().mockResolvedValue(undefined) };
  const identityAttempts = {
    status: vi.fn().mockResolvedValue({ locked: false, attemptsRemaining: 5, retryAfterSeconds: null }),
    failure: vi.fn().mockResolvedValue({ locked: false, attemptsRemaining: 4, retryAfterSeconds: null }),
    success: vi.fn().mockResolvedValue(undefined),
    verifiedCustomerId: vi.fn().mockResolvedValue(null),
    clearVerifiedCustomer: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn().mockResolvedValue(undefined),
    startChallenge: vi.fn().mockResolvedValue(undefined),
    challengePending: vi.fn().mockResolvedValue(true),
    finishChallenge: vi.fn().mockResolvedValue(undefined),
  };
  const metrics = {
    recordIdentityVerification: vi.fn(),
    recordMcpIntegrationOutcome: vi.fn(),
  };
  const evidenceCache = { clear: vi.fn().mockResolvedValue(undefined) };
  const service = new IxcService(
    prisma as never,
    tenancy as never,
    crypto as never,
    config as never,
    audit as never,
    http as never,
    redis as never,
    caseState as never,
    identityAttempts as never,
    metrics as never,
    evidenceCache as never,
  );
  return { service, model, conversation, systemConversation, contact, crypto, audit, http, redis, identityAttempts, metrics, evidenceCache };
}

describe('IxcService - fronteira somente leitura', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it.each(['technical_support', 'billing'] as const)('revoga o CPF anterior e abre desafio para o titular correto em %s', async (route) => {
    h.identityAttempts.startChallenge.mockResolvedValue(true);
    await expect(h.service.beginAccountHolderRebind('org_seeg', 'conv_1', 'contact_1', route)).resolves.toBe(true);
    expect(h.identityAttempts.clearVerifiedCustomer).toHaveBeenCalledWith('org_seeg', 'contact_1', 'conv_1');
    expect(h.systemConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { identityVerifiedAt: null, identityVerifiedBy: null, identityVerificationMethod: null },
    });
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_seeg', expect.objectContaining({
      meta: { route, reason: 'different_account_holder' },
    }));
  });

  it('não confirma outro titular se o cache do cadastro anterior não puder ser limpo', async () => {
    h.systemConversation.findFirst.mockResolvedValue({
      id: 'conv_1', contactId: 'contact_1', contact: { phone: '(65) 99999-0000' },
    });
    h.http.list.mockResolvedValue({
      registros: [{ id: '20', cnpj_cpf: '123.456.789-01' }],
    });
    h.evidenceCache.clear.mockRejectedValue(new Error('redis unavailable'));
    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '12345678901'),
    ).rejects.toThrow('redis unavailable');
    expect(h.identityAttempts.success).not.toHaveBeenCalled();
    expect(h.systemConversation.update).not.toHaveBeenCalled();
  });

  it('mantém a viabilidade inconclusiva e registra apenas a forma do retorno desconhecido', () => {
    const internals = h.service as unknown as {
      normalizeAutoViabilityResponse: (raw: Record<string, unknown>) => { outcome: string };
      autoViabilityResponseShape: (raw: Record<string, unknown>) => unknown;
    };
    const raw = {
      retorno: { statusTecnico: 'valor-que-nunca-deve-ser-auditado', endereco: 'conteudo-privado' },
      mensagem: 'conteudo-privado',
    };

    expect(internals.normalizeAutoViabilityResponse(raw)).toEqual({ outcome: 'INCONCLUSIVE', planReferences: [] });
    expect(internals.autoViabilityResponseShape(raw)).toEqual({
      topLevelKeys: ['retorno', 'mensagem'],
      objectContainers: [{ key: 'retorno', keys: ['statusTecnico', 'endereco'] }],
    });
    expect(JSON.stringify(internals.autoViabilityResponseShape(raw))).not.toContain('conteudo-privado');
  });

  it('normaliza o contrato real do IXC encapsulado na chave numérica zero', () => {
    const internals = h.service as unknown as {
      normalizeAutoViabilityResponse: (raw: Record<string, unknown>) => { outcome: string };
    };

    expect(internals.normalizeAutoViabilityResponse({
      0: { status_viabilidade: 'N', result: null, planos: [] },
      success: false,
    })).toEqual({ outcome: 'NOT_AVAILABLE', planReferences: [] });

    expect(internals.normalizeAutoViabilityResponse({
      0: { status_viabilidade: 'S', result: 'Viável', planos: [{ id: '1', nome: 'Fibra 600 Mega', valor: '99.90' }] },
      success: true,
    })).toEqual({
      outcome: 'CONFIRMED',
      planReferences: [{ id: '1', name: 'Fibra 600 Mega', value: 99.9 }],
    });
  });

  it('rejeita formato inesperado sem consultar nem persistir os fatores', async () => {
    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '1234567890'),
    ).resolves.toEqual({ status: 'format_invalid' });
    expect(h.http.list).not.toHaveBeenCalled();
    expect(h.systemConversation.update).not.toHaveBeenCalled();
  });

  it('valida resposta protegida, persiste somente o resultado e encerra o desafio', async () => {
    h.systemConversation.findFirst.mockResolvedValue({
      id: 'conv_1', contactId: 'contact_1', contact: { phone: '(65) 99999-0000' },
    });
    h.http.list.mockResolvedValue({
      registros: [{ id: '10', cnpj_cpf: '123.456.789-01', data_nascimento: '1990-09-20' }],
    });
    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '123.456.789-01'),
    ).resolves.toEqual(expect.objectContaining({ status: 'verified' }));
    expect(h.systemConversation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ identityVerificationMethod: 'CPF_FULL_EXACT' }),
    }));
    expect(h.contact.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customFields: expect.objectContaining({ _omniTrustedIxcCustomerId: '10' }) }),
    }));
    expect(h.identityAttempts.finishChallenge).toHaveBeenCalledWith('org_seeg', 'contact_1', 'conv_1');
    expect(h.evidenceCache.clear).toHaveBeenCalledWith('org_seeg', 'conv_1');
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_seeg', expect.objectContaining({
      meta: { method: 'CPF_FULL_EXACT' },
    }));
  });

  it('continua a validação pelo vínculo confiável quando o telefone está ausente ou desatualizado', async () => {
    h.systemConversation.findFirst.mockResolvedValue({
      id: 'conv_1', contactId: 'contact_1',
      contact: { phone: '(65) 90000-0000', customFields: { _omniTrustedIxcCustomerId: '11' } },
    });
    h.http.list.mockImplementation((_base: string, _credentials: unknown, _endpoint: string, payload: { qtype: string }) => (
      payload.qtype === 'cliente.cnpj_cpf'
        ? Promise.resolve({ registros: [{ id: '11', cnpj_cpf: '987.654.321-02', data_nascimento: '1985-03-10' }] })
        : Promise.resolve({ registros: [] })
    ));

    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '98765432102'),
    ).resolves.toEqual(expect.objectContaining({ status: 'verified' }));
    expect(h.identityAttempts.success).toHaveBeenCalledWith('org_seeg', 'contact_1', 'conv_1', '11');
    expect(h.http.list).toHaveBeenCalledWith(
      integration.baseUrl, expect.any(Object), 'cliente',
      expect.objectContaining({ qtype: 'cliente.cnpj_cpf' }),
    );
  });

  it('faz a pré-busca automática pelo telefone antes de pedir os fatores', async () => {
    h.systemConversation.findFirst.mockResolvedValue({
      id: 'conv_1', contactId: 'contact_1',
      contact: { phone: '(65) 99999-0000', identities: [{ externalId: '5565999990000' }] },
    });
    h.http.list.mockResolvedValue({ registros: [{ id: '10' }] });

    await expect(
      h.service.preparePhoneIdentityFallback('org_seeg', 'conv_1', 'contact_1'),
    ).resolves.toEqual({ status: 'candidate_ready', candidateCount: 1 });

    expect(h.redis.client.set).toHaveBeenCalledWith(
      'identity-location-candidates:org_seeg:contact_1:conv_1', '["10"]', 'EX', 600,
    );
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_seeg', expect.objectContaining({
      action: 'conversation.identity.location-candidate.evaluate',
      meta: { source: 'WHATSAPP_PHONE', status: 'candidate_ready', candidateCount: 1 },
    }));
    expect(JSON.stringify(h.audit.logSystem.mock.calls)).not.toContain('99999-0000');
  });

  it('usa localização compartilhada apenas para reduzir candidatos antes dos fatores', async () => {
    h.http.list.mockResolvedValue({
      registros: [{ id: '10', latitude: '-16.066495', longitude: '-57.686852' }],
    });

    await expect(
      h.service.prepareLocationIdentityFallback('org_seeg', 'conv_1', 'contact_1', -16.066495, -57.686852),
    ).resolves.toEqual({ status: 'candidate_ready', candidateCount: 1 });

    expect(h.redis.client.set).toHaveBeenCalledWith(
      'identity-location-candidates:org_seeg:contact_1:conv_1', '["10"]', 'EX', 600,
    );
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_seeg', expect.objectContaining({
      action: 'conversation.identity.location-candidate.evaluate',
      meta: { source: 'SHARED_LOCATION', status: 'candidate_ready', candidateCount: 1 },
    }));
    expect(JSON.stringify(h.audit.logSystem.mock.calls)).not.toContain('-16.066495');
  });

  it('confirma os fatores somente contra o candidato efêmero da localização', async () => {
    h.redis.client.get.mockResolvedValue('["10"]');
    h.http.list.mockResolvedValue({
      registros: [{ id: '10', cnpj_cpf: '123.456.789-01', data_nascimento: '1990-09-20' }],
    });

    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '12345678901'),
    ).resolves.toEqual(expect.objectContaining({ status: 'verified' }));

    expect(h.http.list).toHaveBeenCalledWith(
      integration.baseUrl, expect.any(Object), 'cliente', expect.objectContaining({
        qtype: 'cliente.cnpj_cpf', oper: '=',
      }),
    );
  });

  it('aceita CEP+número apenas como contingência sem persistir o endereço', async () => {
    h.http.list.mockResolvedValue({ registros: [{ id: '10' }] });

    await expect(
      h.service.prepareAddressIdentityFallback('org_seeg', 'conv_1', 'contact_1', '78216-624', '671'),
    ).resolves.toEqual({ status: 'candidate_ready', candidateCount: 1 });

    expect(h.redis.client.set).toHaveBeenCalledWith(
      'identity-location-candidates:org_seeg:contact_1:conv_1', '["10"]', 'EX', 600,
    );
    expect(JSON.stringify(h.audit.logSystem.mock.calls)).not.toContain('78216-624');
  });

  it('desambigua telefone compartilhado pela combinação dos fatores de identidade', async () => {
    h.http.list.mockResolvedValue({
      registros: [
        { id: '10', cnpj_cpf: '123.456.789-01', data_nascimento: '1990-09-20' },
        { id: '11', cnpj_cpf: '987.654.321-02', data_nascimento: '1985-03-10' },
        { id: '12', cnpj_cpf: '111.222.333-03', data_nascimento: '1970-12-01' },
      ],
    });
    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '98765432102'),
    ).resolves.toEqual(expect.objectContaining({ status: 'verified' }));
    expect(h.identityAttempts.failure).not.toHaveBeenCalled();
    expect(h.identityAttempts.success).toHaveBeenCalledWith(
      'org_seeg', 'contact_1', 'conv_1', '11',
    );
  });

  it('não aprova quando os fatores continuam ambíguos entre cadastros do mesmo telefone', async () => {
    h.http.list.mockResolvedValue({
      registros: [
        { id: '10', cnpj_cpf: '123.456.789-01', data_nascimento: '1990-09-20' },
        { id: '11', cnpj_cpf: '123.456.789-01', data_nascimento: '1985-09-10' },
      ],
    });
    await expect(
      h.service.consumeIdentityChallenge('org_seeg', 'conv_1', 'contact_1', '12345678901'),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(h.systemConversation.update).not.toHaveBeenCalled();
    expect(h.identityAttempts.failure).not.toHaveBeenCalled();
    expect(h.audit.logSystem).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({
      action: 'conversation.identity.unavailable',
      entityId: 'conv_1',
      meta: expect.objectContaining({ reason: 'ambiguous_identity_match', candidateCount: 2 }),
    }));
  });

  it('não expõe credenciais na configuração pública', async () => {
    await expect(h.service.getConfiguration()).resolves.toEqual({
      baseUrl: integration.baseUrl,
      isEnabled: true,
      hasCredentials: true,
      lastTestedAt: null,
      lastTestSucceeded: null,
    });
  });

  it('bloqueia host fora da allowlist para evitar SSRF', async () => {
    await expect(
      h.service.configure({
        baseUrl: 'https://internal.example/webservice/v1',
        username: 'api',
        token: 'secret',
        isEnabled: false,
      }),
    ).rejects.toThrow('Host IXC não está autorizado');
    expect(h.model.upsert).not.toHaveBeenCalled();
  });

  it('mantém o token cifrado ao alterar apenas usuário/configuração', async () => {
    await h.service.configure({
      baseUrl: integration.baseUrl,
      username: 'novo-usuario',
      isEnabled: false,
    });
    expect(h.crypto.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ username: 'novo-usuario', token: 'secret' }),
    );
  });

  it('não habilita antes de um teste aprovado da configuração atual', async () => {
    await expect(
      h.service.configure({
        baseUrl: integration.baseUrl,
        username: 'api-user',
        isEnabled: true,
      }),
    ).rejects.toThrow('conclua um teste bem-sucedido antes de habilitar');
    expect(h.model.upsert).not.toHaveBeenCalled();
  });

  it('exige exatamente um critério de pesquisa', async () => {
    await expect(h.service.searchCustomers({})).rejects.toThrow('Informe exatamente um filtro');
    await expect(
      h.service.searchCustomers({ id: '1', cpfCnpj: '123' }),
    ).rejects.toThrow('Informe exatamente um filtro');
    expect(h.http.list).not.toHaveBeenCalled();
  });

  it('consulta os quatro campos telefônicos e remove clientes duplicados', async () => {
    h.http.list.mockResolvedValue({
      registros: [{ id: '10', razao: 'Ana', ativo: 'S', telefone_celular: '(65) 99999-0000' }],
    });
    const result = await h.service.searchCustomers({ phone: '(65) 99999-0000' });
    expect(h.http.list).toHaveBeenCalledTimes(4);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: '10', name: 'Ana', active: true });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { filter: 'phone', resultCount: 1 } }),
    );
  });

  it('não registra o valor pesquisado na auditoria', async () => {
    await h.service.searchCustomers({ cpfCnpj: '123.456.789-00' });
    const auditPayload = h.audit.log.mock.calls[0]?.[0];
    expect(JSON.stringify(auditPayload)).not.toContain('123.456.789-00');
  });

  it('consulta contratos pelo id_cliente com paginação limitada', async () => {
    h.http.list.mockResolvedValue({
      registros: [
        {
          id: '20',
          id_cliente: '10',
          status: 'A',
          status_internet: 'A',
          descricao_aux_plano_venda: 'Fibra 500 Mega',
        },
      ],
    });

    await expect(h.service.listContracts('10', 'conv_1')).resolves.toEqual([
      expect.objectContaining({ id: '20', customerId: '10', planDescription: 'Fibra 500 Mega' }),
    ]);
    expect(h.http.list).toHaveBeenCalledWith(
      integration.baseUrl,
      expect.any(Object),
      'cliente_contrato',
      expect.objectContaining({
        qtype: 'cliente_contrato.id_cliente', query: '10', rp: '20', sortname: 'cliente_contrato.id',
      }),
    );
  });

  it('bloqueia dados protegidos quando a identidade não foi validada', async () => {
    h.conversation.findFirst.mockResolvedValue({ identityVerifiedAt: null });
    await expect(h.service.listContracts('10', 'conv_1')).rejects.toThrow(
      'Valide a identidade do cliente',
    );
    expect(h.http.list).not.toHaveBeenCalled();
  });

  it('bloqueia validação de identidade expirada', async () => {
    h.conversation.findFirst.mockResolvedValue({
      identityVerifiedAt: new Date(Date.now() - 31 * 60 * 1_000),
    });
    await expect(h.service.listContracts('10', 'conv_1')).rejects.toThrow(
      'Valide novamente a identidade',
    );
    expect(h.http.list).not.toHaveBeenCalled();
  });

  it('expõe somente campos seguros da conexão e descarta todas as credenciais', async () => {
    h.http.list.mockResolvedValue({
      registros: [
        {
          id: '30',
          id_cliente: '10',
          id_contrato: '20',
          ativo: 'S',
          online: 'S',
          conexao: 'Online',
          senha: 'nao-pode-sair',
          senha_router1: 'nao-pode-sair',
          senha_rede_sem_fio: 'nao-pode-sair',
          ip: '192.0.2.1',
          mac: '00:00:00:00:00:00',
        },
      ],
    });

    const result = await h.service.listConnections('10', 'conv_1');
    expect(result).toEqual([
      expect.objectContaining({ id: '30', customerId: '10', active: true, online: true }),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('nao-pode-sair');
    expect(serialized).not.toContain('192.0.2.1');
    expect(serialized).not.toContain('00:00:00:00:00:00');
    expect(serialized).not.toContain('senha');
  });

  it('lê caixas InMap por cidade sem expor identificador ou endereço da infraestrutura', async () => {
    h.http.list.mockResolvedValue({
      registros: [{
        id: 'caixa-interna-9', status: 'A', id_cidade: '77',
        latitude: '-15.601', longitude: '-56.097', capacidade: '16',
        endereco: 'Rua que não pode sair', obs_caixa_ftth: 'detalhe interno',
      }],
    });

    const result = await h.service.listFtthBoxesByCity('77');

    expect(h.http.list).toHaveBeenCalledWith(
      integration.baseUrl,
      expect.any(Object),
      'rad_caixa_ftth',
      expect.objectContaining({
        qtype: 'rad_caixa_ftth.id_cidade', query: '77', rp: '250', sortname: 'rad_caixa_ftth.id',
      }),
    );
    expect(result).toEqual([expect.objectContaining({
      active: true, cityId: '77', latitude: -15.601, longitude: -56.097, reportedCapacity: 16,
    })]);
    expect(JSON.stringify(result)).not.toContain('caixa-interna-9');
    expect(JSON.stringify(result)).not.toContain('Rua que não pode sair');
    expect(JSON.stringify(result)).not.toContain('detalhe interno');
  });

  it('faturas não incluem boleto, linha digitável, pix ou dados de cobrança', async () => {
    h.http.list.mockResolvedValue({
      registros: [
        {
          id: '40',
          id_cliente: '10',
          id_contrato: '20',
          status: 'A',
          data_vencimento: '2026-09-01',
          valor: '199.90',
          valor_aberto: '199,90',
          linha_digitavel: 'segredo-financeiro',
          pix_txid: 'segredo-pix',
          boleto: 'segredo-boleto',
        },
      ],
    });

    const result = await h.service.listInvoices('10', 'conv_1');
    expect(result[0]).toMatchObject({ amount: 199.9, openAmount: 199.9 });
    expect(JSON.stringify(result)).not.toContain('segredo');
  });

  it('executor operacional entrega somente evidências tipadas, nunca o retorno bruto', async () => {
    for (let index = 0; index < 4; index += 1) {
      h.http.list.mockResolvedValueOnce({ registros: [{ id: '10', razao: 'Ana' }] });
    }
    h.http.list.mockResolvedValueOnce({ registros: [{
      id: '20', id_cliente: '10', status: 'A', status_internet: 'A',
      descricao_aux_plano_venda: 'Fibra 500 Mega', senha: 'segredo', mac: '00:11:22:33:44:55',
    }] });

    const evidence = await h.service.collectOperationalEvidence('org_seeg', 'conv_1', ['contracts']);
    expect(evidence).toMatchObject({ source: 'IXC', status: 'success' });
    expect(evidence.mcpOutcome).toMatchObject({ status: 'CONFIRMED', safeForAutomaticReply: true });
    expect(evidence.facts).toEqual([expect.objectContaining({
      resource: 'contracts', entityRef: '20', fields: expect.objectContaining({ status: 'A' }),
    })]);
    expect(JSON.stringify(evidence)).not.toContain('segredo');
    expect(JSON.stringify(evidence)).not.toContain('00:11:22:33:44:55');
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_seeg', expect.objectContaining({
      meta: expect.objectContaining({ actions: ['contracts'], factCount: 1, failedActions: [] }),
    }));
  });

  it('reaproveita vínculo IXC confiável após identidade validada, sem depender do telefone', async () => {
    h.systemConversation.findFirst.mockResolvedValue({
      id: 'conv_1', contactId: 'contact_1', identityVerifiedAt: new Date(),
      contact: { phone: '(65) 90000-0000', customFields: { _omniTrustedIxcCustomerId: '10' } },
    });
    h.http.list.mockResolvedValue({ registros: [{
      id: '40', id_cliente: '10', status: 'A', data_vencimento: '2026-09-01', valor: '199.90',
    }] });

    const evidence = await h.service.collectOperationalEvidence('org_seeg', 'conv_1', ['invoices']);

    expect(evidence).toMatchObject({ source: 'IXC', customerRef: '10', status: 'success' });
    expect(h.http.list).toHaveBeenCalledTimes(1);
    expect(h.http.list).toHaveBeenCalledWith(
      integration.baseUrl, expect.any(Object), 'fn_areceber',
      expect.objectContaining({ qtype: 'fn_areceber.id_cliente', query: '10' }),
    );
  });

  it('preserva evidências válidas quando um endpoint opcional do IXC falha', async () => {
    h.identityAttempts.verifiedCustomerId.mockResolvedValue('10');
    h.http.list
      .mockRejectedValueOnce(new Error('contratos indisponíveis'))
      .mockResolvedValueOnce({ registros: [{
        id: '30', id_cliente: '10', id_contrato: '20', ativo: 'S', online: 'N', conexao: 'Offline',
      }] });

    const evidence = await h.service.collectOperationalEvidence(
      'org_seeg', 'conv_1', ['contracts', 'connections'],
    );
    expect(evidence.status).toBe('success');
    expect(evidence.facts).toEqual([
      expect.objectContaining({ resource: 'connections', entityRef: '30' }),
    ]);
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_seeg', expect.objectContaining({
      meta: expect.objectContaining({
        completedActions: ['connections'], failedActions: ['contracts'], factCount: 1,
      }),
    }));
  });

  it('consulta o equipamento FTTH apenas pelos contratos já identificados', async () => {
    h.identityAttempts.verifiedCustomerId.mockResolvedValue('10');
    h.http.list
      .mockResolvedValueOnce({ registros: [{
        id: '20', id_cliente: '10', status: 'A', descricao_aux_plano_venda: 'Fibra 500 Mega',
      }] })
      .mockResolvedValueOnce({ registros: [{
        id: 'onu_30', id_contrato: '20', id_caixa_ftth: 'cto_7', id_transmissor: 'olt_2',
        ponid: '0/1/3', sinal_rx: '-22.1', data_sinal: '2026-09-21 10:00:00',
        mac: '00:11:22:33:44:55', senha_onu_cliente: 'nunca-expor',
      }] });

    const evidence = await h.service.collectOperationalEvidence(
      'org_seeg', 'conv_1', ['fiber_access'],
    );

    expect(h.http.list).toHaveBeenCalledTimes(2);
    expect(h.http.list).toHaveBeenLastCalledWith(
      integration.baseUrl,
      expect.any(Object),
      'radpop_radio_cliente_fibra',
      expect.objectContaining({
        qtype: 'radpop_radio_cliente_fibra.id_contrato', query: '20',
      }),
    );
    expect(evidence.facts).toEqual([expect.objectContaining({
      resource: 'fiber_access', entityRef: 'onu_30', fields: {
        equipmentLinked: true, hasFtthBox: true, hasTransmitter: true, hasPon: true,
        signalRecordedAt: '2026-09-21 10:00:00', hasLastSignal: true,
      },
    })]);
    expect(JSON.stringify(evidence.facts)).not.toContain('00:11:22:33:44:55');
    expect(JSON.stringify(evidence.facts)).not.toContain('nunca-expor');
  });

  it('forma a coorte FTTH pelo contrato e pela caixa documentados pelo IXC', async () => {
    h.identityAttempts.verifiedCustomerId.mockResolvedValue('10');
    h.http.list
      .mockResolvedValueOnce({ registros: [{ id: '20', id_cliente: '10', status: 'A' }] })
      .mockResolvedValueOnce({ registros: [{
        id: 'onu_cliente', id_contrato: '20', id_caixa_ftth: 'caixa_7',
      }] })
      .mockResolvedValueOnce({
        total: 2,
        registros: [
          { id: 'onu_1', id_contrato: '20', id_caixa_ftth: 'caixa_7', sinal_rx: '-22.0', data_sinal: '2026-09-21 10:00:00' },
          { id: 'onu_2', id_contrato: '21', id_caixa_ftth: 'caixa_7' },
        ],
      });

    const evidence = await h.service.collectBoxCohortEvidence('org_seeg', 'conv_1');

    expect(evidence).toMatchObject({
      source: 'IXC_FTTH_BOX', status: 'available', boxCount: 1, sampleComplete: true,
      fiberEquipment: { total: 2, signalTimestamped: 1, lastSignalRecorded: 1 },
    });
    expect(h.http.list).toHaveBeenNthCalledWith(
      2,
      integration.baseUrl,
      expect.any(Object),
      'radpop_radio_cliente_fibra',
      expect.objectContaining({
        qtype: 'radpop_radio_cliente_fibra.id_contrato', query: '20',
      }),
    );
    expect(h.http.list).toHaveBeenNthCalledWith(
      3,
      integration.baseUrl,
      expect.any(Object),
      'radpop_radio_cliente_fibra',
      expect.objectContaining({
        qtype: 'radpop_radio_cliente_fibra.id_caixa_ftth', query: 'caixa_7',
      }),
    );
  });

  it('confirma somente evento estrutural IXC com login explicitamente afetado e OS ativa', async () => {
    h.identityAttempts.verifiedCustomerId.mockResolvedValue('10');
    h.http.list
      .mockResolvedValueOnce({ registros: [{ id: 'login_9', id_cliente: '10', ativo: 'S' }] })
      .mockResolvedValueOnce({ registros: [{
        id: 'affected_1',
        id_radusuarios: 'login_9',
        id_su_oss_chamado: 'os_cliente_1',
        id_su_oss_chamado_regiao_manutencao: 'os_44',
      }] })
      .mockResolvedValueOnce({ registros: [{ id: 'os_44', tipo: 'E', status: 'A' }] });

    const evidence = await h.service.collectStructuralIncidentEvidence('org_seeg', 'conv_1');

    expect(evidence).toMatchObject({
      source: 'IXC_STRUCTURAL_OS',
      status: 'CONFIRMED',
      matchedLogins: 1,
      matchedMaintenanceRegions: 1,
      activeStructuralOrders: 1,
      incidentCode: expect.stringMatching(/^ixc_estrutura_[a-f0-9]{24}$/),
    });
    expect(h.http.list).toHaveBeenNthCalledWith(
      2,
      integration.baseUrl,
      expect.any(Object),
      'su_oss_chamado_regiao_manutencao_radusuarios',
      expect.objectContaining({
        qtype: 'su_oss_chamado_regiao_manutencao_radusuarios.id_radusuarios',
        query: 'login_9',
      }),
    );
    expect(h.http.list).toHaveBeenNthCalledWith(
      3,
      integration.baseUrl,
      expect.any(Object),
      'su_oss_chamado',
      expect.objectContaining({ qtype: 'su_oss_chamado.id', query: 'os_44' }),
    );
  });

  it('não confirma evento por sinal ou vínculo regional sem OS estrutural ativa', async () => {
    h.identityAttempts.verifiedCustomerId.mockResolvedValue('10');
    h.http.list
      .mockResolvedValueOnce({ registros: [{ id: 'login_9', id_cliente: '10', online: 'N' }] })
      .mockResolvedValueOnce({ registros: [{
        id_radusuarios: 'login_9',
        id_su_oss_chamado: 'os_cliente_1',
        id_su_oss_chamado_regiao_manutencao: 'os_finalizada',
      }] })
      .mockResolvedValueOnce({ registros: [{ id: 'os_finalizada', tipo: 'E', status: 'F' }] });

    await expect(h.service.collectStructuralIncidentEvidence('org_seeg', 'conv_1')).resolves.toMatchObject({
      status: 'NOT_CONFIRMED',
      matchedLogins: 1,
      matchedMaintenanceRegions: 1,
      activeStructuralOrders: 0,
      incidentCode: null,
    });
  });
});
