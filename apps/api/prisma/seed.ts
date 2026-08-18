/**
 * Seed de desenvolvimento — SEEG Omni.
 * Executar: pnpm --filter @sm/api seed  (usa tsx; requer DATABASE_URL acessível)
 * Idempotente: se a org "seeg" existir, é removida (cascade) e recriada.
 * Usa o PrismaClient cru (system) — seed roda fora de contexto de tenant.
 */
import {
  ChannelType,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
  PrismaClient,
  Role,
  type Contact,
  type PipelineStage,
  type Tag,
  type User,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PASSWORD = 'Admin@123';
const MINUTE = 60_000;
const HOUR = 3_600_000;

type Sender = 'contact' | 'ai' | 'system' | 'admin' | 'sup' | 'ana' | 'bruno';

interface SeedMessage {
  from: Sender;
  text?: string;
  media?: { mediaUrl: string; mimeType: string; caption?: string; filename?: string };
  type?: MessageType;
  status?: MessageStatus;
  error?: string;
}

interface SeedConversation {
  contact: number;
  stage: string;
  status: ConversationStatus;
  assignee?: 'ana' | 'bruno' | 'sup';
  aiEnabled?: boolean;
  unread?: number;
  tags?: string[];
  hoursAgo: number;
  messages: SeedMessage[];
}

function messageType(msg: SeedMessage): MessageType {
  if (msg.type) return msg.type;
  if (msg.media) {
    return msg.media.mimeType.startsWith('image/') ? MessageType.IMAGE : MessageType.DOCUMENT;
  }
  return MessageType.TEXT;
}

function messageContent(msg: SeedMessage): Prisma.InputJsonValue {
  if (msg.media) return { ...msg.media };
  return { text: msg.text ?? '' };
}

function previewOf(msg: SeedMessage): string {
  const type = messageType(msg);
  if (type === MessageType.IMAGE) return msg.media?.caption ?? '📷 Imagem';
  if (type === MessageType.DOCUMENT) return `📄 ${msg.media?.filename ?? 'Documento'}`;
  return (msg.text ?? '').slice(0, 120);
}

const CONTACTS = [
  { name: 'Maria Oliveira', phone: '+5562999110001', email: 'maria.oliveira@gmail.com', city: 'Goiânia' },
  { name: 'João Santos', phone: '+5562998220002', email: 'joao.santos@hotmail.com', city: 'Aparecida de Goiânia' },
  { name: 'Fernanda Lima', phone: '+5511987330003', email: 'fer.lima@outlook.com', city: 'São Paulo' },
  { name: 'Carlos Pereira', phone: '+5562996440004', email: 'carlosp@gmail.com', city: 'Goiânia' },
  { name: 'Juliana Costa', phone: '+5531985550005', email: 'ju.costa@yahoo.com.br', city: 'Belo Horizonte' },
  { name: 'Rafael Almeida', phone: '+5562994660006', email: null, city: 'Anápolis' },
  { name: 'Patrícia Souza', phone: '+5521983770007', email: 'patricia.souza@gmail.com', city: 'Rio de Janeiro' },
  { name: 'Lucas Martins', phone: '+5562992880008', email: null, city: 'Goiânia' },
];

const CONVERSATIONS: SeedConversation[] = [
  {
    contact: 0,
    stage: 'Novo',
    status: ConversationStatus.OPEN,
    unread: 2,
    tags: ['Vendas'],
    hoursAgo: 1,
    messages: [
      { from: 'contact', text: 'Olá, boa tarde! Gostaria de saber como faço para me filiar ao sindicato.' },
      { from: 'ai', text: 'Olá, Maria! Que bom ter você por aqui 😊 A filiação pode ser feita 100% online: basta preencher a ficha de cadastro e anexar um documento com foto. Posso te enviar o link?' },
      { from: 'contact', text: 'Pode sim, por favor!' },
      { from: 'contact', text: 'Ah, e quanto fica a mensalidade?' },
    ],
  },
  {
    contact: 1,
    stage: 'Novo',
    status: ConversationStatus.OPEN,
    unread: 3,
    tags: ['Suporte'],
    hoursAgo: 3,
    messages: [
      { from: 'contact', text: 'Bom dia, não consegui acessar a segunda via do meu boleto pelo site.' },
      { from: 'ai', text: 'Bom dia, João! Sem problemas — consigo gerar a segunda via por aqui. Pode me confirmar o CPF do titular, por favor?' },
      { from: 'contact', text: 'Claro, 123.456.789-00' },
      {
        from: 'contact',
        media: {
          mediaUrl: 'https://picsum.photos/seed/boleto-joao/800/600',
          mimeType: 'image/jpeg',
          caption: 'Print do erro que aparece pra mim',
        },
      },
      { from: 'contact', text: 'Fica travado nessa tela aí' },
    ],
  },
  {
    contact: 2,
    stage: 'Novo',
    status: ConversationStatus.OPEN,
    unread: 1,
    hoursAgo: 0.5,
    messages: [
      { from: 'contact', text: 'Oi! O convênio odontológico do sindicato cobre aparelho?' },
      { from: 'ai', text: 'Olá, Fernanda! Sim 😄 O convênio odontológico cobre a manutenção mensal do aparelho com 50% de desconto na rede credenciada. Quer que eu envie a lista de clínicas da sua região?' },
      { from: 'contact', text: 'Quero sim! Sou de São Paulo, zona leste.' },
      {
        from: 'ai',
        status: MessageStatus.SENT,
        media: {
          mediaUrl: 'https://picsum.photos/seed/clinicas-pdf/600/800',
          mimeType: 'application/pdf',
          filename: 'rede-credenciada-sp.pdf',
          caption: 'Rede credenciada — São Paulo',
        },
      },
    ],
  },
  {
    contact: 3,
    stage: 'Em Atendimento',
    status: ConversationStatus.OPEN,
    assignee: 'ana',
    tags: ['VIP'],
    hoursAgo: 26,
    messages: [
      { from: 'contact', text: 'Boa tarde, preciso atualizar meu endereço no cadastro.' },
      { from: 'ai', text: 'Boa tarde, Carlos! Posso te ajudar com isso. Me informa o novo endereço completo com CEP, por favor?' },
      { from: 'contact', text: 'Rua das Acácias, 123, Setor Bueno, Goiânia - GO, CEP 74223-010' },
      { from: 'ana', text: 'Oi Carlos, aqui é a Ana do atendimento 😊 Vou fazer a alteração no sistema agora mesmo, um instante.' },
      { from: 'ana', text: 'Pronto! Endereço atualizado. Vai chegar um e-mail de confirmação pra você.', status: MessageStatus.READ },
      { from: 'contact', text: 'Recebi sim. Aproveitando: consigo incluir minha esposa como dependente?' },
      { from: 'ana', text: 'Consegue sim! Vou te enviar o formulário de inclusão de dependente.' },
      {
        from: 'ana',
        status: MessageStatus.FAILED,
        error: 'Falha no envio do anexo: tamanho excede o limite do canal',
        media: {
          mediaUrl: 'https://picsum.photos/seed/form-dependente/600/800',
          mimeType: 'application/pdf',
          filename: 'inclusao-dependente.pdf',
        },
      },
    ],
  },
  {
    contact: 4,
    stage: 'Em Atendimento',
    status: ConversationStatus.OPEN,
    assignee: 'bruno',
    hoursAgo: 5,
    messages: [
      { from: 'contact', text: 'Olá! Queria saber se o sindicato tem convênio com alguma faculdade.' },
      { from: 'ai', text: 'Olá, Juliana! Temos sim parceria com instituições de ensino 🎓 com descontos de até 30% em graduação e pós. Vou te passar para um atendente confirmar as instituições disponíveis na sua cidade.' },
      { from: 'bruno', text: 'Oi Juliana, Bruno por aqui! Em Belo Horizonte temos parceria com a UNA e a Estácio. Qual curso você procura?' },
      { from: 'contact', text: 'Estou olhando pós em Gestão de Pessoas.' },
      { from: 'bruno', text: 'Ótima escolha! Na UNA a pós sai com 25% de desconto pra filiados. Te mando o regulamento.' },
      {
        from: 'bruno',
        media: {
          mediaUrl: 'https://picsum.photos/seed/convenio-educacao/600/800',
          mimeType: 'application/pdf',
          filename: 'regulamento-convenio-educacao.pdf',
        },
      },
    ],
  },
  {
    contact: 5,
    stage: 'Em Atendimento',
    status: ConversationStatus.OPEN,
    assignee: 'ana',
    hoursAgo: 8,
    messages: [
      { from: 'contact', text: 'Bom dia. Fui demitido ontem e queria orientação jurídica sobre a rescisão.' },
      { from: 'ai', text: 'Bom dia, Rafael. Sinto muito pela situação. Nosso departamento jurídico atende filiados de segunda a sexta, das 8h às 17h. Vou te transferir para um atendente agendar um horário, tudo bem?' },
      { from: 'contact', text: 'Tudo bem, obrigado.' },
      { from: 'ana', text: 'Oi Rafael, aqui é a Ana. Temos horário amanhã às 10h ou quinta às 14h com o Dr. Marcos. Qual prefere?' },
      { from: 'contact', text: 'Amanhã às 10h fica ótimo.' },
      { from: 'ana', text: 'Agendado! ✅ Traga a carteira de trabalho, o termo de rescisão e os três últimos contracheques.', status: MessageStatus.READ },
      { from: 'contact', text: 'Perfeito, estarei lá. Muito obrigado!' },
    ],
  },
  {
    contact: 6,
    stage: 'Aguardando Cliente',
    status: ConversationStatus.PENDING,
    assignee: 'bruno',
    hoursAgo: 30,
    messages: [
      { from: 'contact', text: 'Oi, quero cancelar minha filiação.' },
      { from: 'bruno', text: 'Oi Patrícia, aqui é o Bruno. Posso saber o motivo? Às vezes conseguimos resolver o que está te incomodando.' },
      { from: 'contact', text: 'Acho que não uso os benefícios o suficiente.' },
      { from: 'bruno', text: 'Entendo! Você sabia que tem direito a consultas odontológicas gratuitas e ao clube de descontos? Posso te enviar um resumo dos benefícios antes de seguir com o cancelamento?' },
      { from: 'bruno', text: 'Fico no aguardo da sua resposta pra dar andamento, combinado?', status: MessageStatus.DELIVERED },
    ],
  },
  {
    contact: 7,
    stage: 'Aguardando Cliente',
    status: ConversationStatus.PENDING,
    assignee: 'ana',
    hoursAgo: 50,
    messages: [
      { from: 'contact', text: 'Boa tarde! Como faço pra emitir a carteirinha digital?' },
      { from: 'ai', text: "Boa tarde, Lucas! A carteirinha digital fica disponível no app SEEG, na aba 'Meu Perfil'. Você já tem o app instalado?" },
      { from: 'contact', text: "Tenho, mas aparece 'cadastro pendente'." },
      { from: 'ana', text: 'Oi Lucas! Verifiquei aqui e falta a confirmação do seu e-mail. Acabei de reenviar o link de ativação.' },
      { from: 'ana', text: 'Consegue verificar se chegou? Às vezes cai no spam.' },
      { from: 'contact', text: 'Vou olhar e te falo!' },
    ],
  },
  {
    contact: 1,
    stage: 'Intervenção Humana',
    status: ConversationStatus.OPEN,
    aiEnabled: false,
    unread: 2,
    tags: ['Urgente'],
    hoursAgo: 2,
    messages: [
      { from: 'contact', text: 'Preciso resolver URGENTE um desconto indevido na minha folha!' },
      { from: 'ai', text: 'Olá, João! Entendo a urgência. Pode me informar o valor e o mês do desconto que apareceu na sua folha?' },
      { from: 'contact', text: 'Já é o terceiro mês seguido! R$ 89,90 que eu NÃO autorizei. Quero falar com uma pessoa de verdade, não com robô.' },
      { from: 'ai', text: 'Entendo sua frustração, João. Vou te transferir agora para um atendente humano, que vai tratar seu caso com prioridade. 🙏' },
      { from: 'system', text: 'Conversa movida para Intervenção Humana — motivo: pedido explícito de atendimento humano.' },
      { from: 'contact', text: 'Ok, estou aguardando.' },
    ],
  },
  {
    contact: 2,
    stage: 'Intervenção Humana',
    status: ConversationStatus.OPEN,
    aiEnabled: false,
    assignee: 'sup',
    unread: 1,
    hoursAgo: 4,
    messages: [
      { from: 'contact', text: 'Estou sofrendo assédio moral do meu supervisor e não sei o que fazer.' },
      { from: 'ai', text: 'Fernanda, sinto muito que você esteja passando por isso. Esse é um assunto sério e delicado — vou te conectar imediatamente com a nossa equipe especializada, que vai te atender com total sigilo.' },
      { from: 'system', text: 'Conversa movida para Intervenção Humana — motivo: assunto sensível detectado.' },
      { from: 'sup', text: 'Fernanda, aqui é a Sofia, supervisora de atendimento. Estou aqui pra te ouvir. Tudo o que conversarmos é confidencial. Pode me contar o que está acontecendo?' },
      { from: 'contact', text: 'Obrigada... Podemos conversar amanhã cedo? Agora não consigo falar.' },
    ],
  },
  {
    contact: 3,
    stage: 'Resolvido',
    status: ConversationStatus.RESOLVED,
    assignee: 'ana',
    hoursAgo: 120,
    messages: [
      { from: 'contact', text: 'Oi! O boleto da mensalidade veio duplicado esse mês.' },
      { from: 'ai', text: 'Olá, Carlos! Vou verificar isso pra você. Um momento, por favor.' },
      { from: 'ana', text: 'Oi Carlos! Confirmei aqui: houve um erro na geração e o segundo boleto já foi cancelado. Pode desconsiderar.', status: MessageStatus.READ },
      { from: 'contact', text: 'Que alívio! Preciso fazer mais alguma coisa?' },
      { from: 'ana', text: 'Nada mais! O valor correto é só o do boleto com vencimento dia 10. Qualquer coisa, estamos por aqui 😊', status: MessageStatus.READ },
      { from: 'contact', text: 'Perfeito, obrigado pela agilidade!' },
    ],
  },
  {
    contact: 6,
    stage: 'Resolvido',
    status: ConversationStatus.RESOLVED,
    assignee: 'bruno',
    hoursAgo: 200,
    messages: [
      { from: 'contact', text: 'Vocês têm colônia de férias pros filiados?' },
      { from: 'ai', text: 'Olá, Patrícia! Temos sim 🏖️ A colônia de férias fica em Caldas Novas e filiados têm 40% de desconto na hospedagem. As reservas podem ser feitas pelo site ou por aqui mesmo.' },
      { from: 'contact', text: 'Show! Vou ver com a família e faço a reserva pelo site. Obrigada!' },
      { from: 'bruno', text: 'Fechado, Patrícia! Qualquer dúvida na reserva é só chamar. Boas férias! 😄', status: MessageStatus.READ },
    ],
  },
];

async function main(): Promise<void> {
  const existing = await prisma.organization.findUnique({ where: { slug: 'seeg' } });
  if (existing) {
    console.log('Org "seeg" já existe — removendo para reseed (cascade)...');
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const org = await prisma.organization.create({
    data: {
      name: 'SEEG',
      slug: 'seeg',
      plan: 'pro',
      settings: { timezone: 'America/Sao_Paulo', locale: 'pt-BR' },
    },
  });

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const createUser = (name: string, email: string, role: Role): Promise<User> =>
    prisma.user.create({ data: { orgId: org.id, name, email, passwordHash, role } });

  const admin = await createUser('Administrador SEEG', 'admin@seeg.local', Role.ADMIN);
  const sup = await createUser('Sofia Ribeiro', 'sup@seeg.local', Role.SUPERVISOR);
  const ana = await createUser('Ana Ferreira', 'ana@seeg.local', Role.AGENT);
  const bruno = await createUser('Bruno Cardoso', 'bruno@seeg.local', Role.AGENT);
  const usersByKey: Record<string, User> = { admin, sup, ana, bruno };

  const stageDefs = [
    { name: 'Novo', color: '#6366f1', isDefault: true },
    { name: 'Em Atendimento', color: '#8b5cf6' },
    { name: 'Aguardando Cliente', color: '#f59e0b' },
    { name: 'Intervenção Humana', color: '#ef4444', isHumanHandoff: true },
    { name: 'Resolvido', color: '#10b981' },
  ];
  const stagesByName = new Map<string, PipelineStage>();
  for (const [position, def] of stageDefs.entries()) {
    const stage = await prisma.pipelineStage.create({
      data: {
        orgId: org.id,
        name: def.name,
        color: def.color,
        position,
        isDefault: def.isDefault ?? false,
        isHumanHandoff: def.isHumanHandoff ?? false,
      },
    });
    stagesByName.set(def.name, stage);
  }

  const tagDefs = [
    { name: 'VIP', color: '#d4af37' },
    { name: 'Suporte', color: '#3b82f6' },
    { name: 'Vendas', color: '#22c55e' },
    { name: 'Urgente', color: '#ef4444' },
  ];
  const tagsByName = new Map<string, Tag>();
  for (const def of tagDefs) {
    tagsByName.set(def.name, await prisma.tag.create({ data: { orgId: org.id, ...def } }));
  }

  const channel = await prisma.channel.create({
    data: {
      orgId: org.id,
      type: ChannelType.WEBCHAT,
      name: 'Chat do Site',
      config: { welcomeMessage: 'Olá! Como podemos ajudar? 👋', primaryColor: '#6366f1' },
      encryptedCredentials: '', // webchat não possui credenciais sensíveis
    },
  });

  const contacts: Contact[] = [];
  for (const [index, def] of CONTACTS.entries()) {
    const contact = await prisma.contact.create({
      data: {
        orgId: org.id,
        name: def.name,
        phone: def.phone,
        email: def.email,
        avatarUrl: `https://picsum.photos/seed/avatar-${index + 1}/200/200`,
        customFields: { cidade: def.city },
      },
    });
    contacts.push(contact);

    await prisma.contactIdentity.create({
      data: {
        orgId: org.id,
        contactId: contact.id,
        channelType: ChannelType.WEBCHAT,
        externalId: `visitor_${String(index + 1).padStart(4, '0')}`,
      },
    });
    await prisma.contactIdentity.create({
      data: {
        orgId: org.id,
        contactId: contact.id,
        channelType: ChannelType.WHATSAPP,
        externalId: def.phone.replace('+', ''),
      },
    });
  }

  const stagePositionCounters = new Map<string, number>();
  let messageCount = 0;

  for (const seed of CONVERSATIONS) {
    const stage = stagesByName.get(seed.stage);
    if (!stage) throw new Error(`Stage desconhecido: ${seed.stage}`);
    const contact = contacts[seed.contact];
    if (!contact) throw new Error(`Contato inexistente no índice ${seed.contact}`);

    const stagePosition = (stagePositionCounters.get(seed.stage) ?? 0) + 1024;
    stagePositionCounters.set(seed.stage, stagePosition);

    const startedAt = new Date(Date.now() - seed.hoursAgo * HOUR);
    const conversation = await prisma.conversation.create({
      data: {
        orgId: org.id,
        contactId: contact.id,
        channelId: channel.id,
        status: seed.status,
        stageId: stage.id,
        stagePosition,
        aiEnabled: seed.aiEnabled ?? true,
        assigneeId: seed.assignee ? usersByKey[seed.assignee]?.id : undefined,
        createdAt: startedAt,
      },
    });

    // últimos `unread` INBOUND ficam DELIVERED (não lidos); demais READ
    const unread = seed.unread ?? 0;
    const inboundIndices = seed.messages
      .map((msg, index) => (msg.from === 'contact' ? index : -1))
      .filter((index) => index >= 0);
    const unreadSet = new Set(unread > 0 ? inboundIndices.slice(-unread) : []);

    let lastMessageAt = startedAt;
    for (const [index, msg] of seed.messages.entries()) {
      const createdAt = new Date(startedAt.getTime() + (index + 1) * (3 * MINUTE + 37_000));
      lastMessageAt = createdAt;
      const isInbound = msg.from === 'contact';
      const author = msg.from in usersByKey ? usersByKey[msg.from] : undefined;

      let status: MessageStatus;
      if (msg.status) {
        status = msg.status;
      } else if (isInbound) {
        status = unreadSet.has(index) ? MessageStatus.DELIVERED : MessageStatus.READ;
      } else {
        status = MessageStatus.DELIVERED;
      }

      await prisma.message.create({
        data: {
          orgId: org.id,
          conversationId: conversation.id,
          direction: isInbound ? MessageDirection.INBOUND : MessageDirection.OUTBOUND,
          type: msg.from === 'system' ? MessageType.SYSTEM : messageType(msg),
          content: messageContent(msg),
          status,
          authorId: author?.id,
          isAiGenerated: msg.from === 'ai',
          errorMessage: msg.error,
          createdAt,
        },
      });
      messageCount += 1;
    }

    const lastMsg = seed.messages[seed.messages.length - 1];
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: unread,
        lastMessageAt,
        lastMessagePreview: lastMsg ? previewOf(lastMsg) : null,
      },
    });

    for (const tagName of seed.tags ?? []) {
      const tag = tagsByName.get(tagName);
      if (!tag) throw new Error(`Tag desconhecida: ${tagName}`);
      await prisma.conversationTag.create({
        data: { conversationId: conversation.id, tagId: tag.id },
      });
    }
  }

  console.log('Seed concluído com sucesso:');
  console.log(`  org:          SEEG (slug "seeg")`);
  console.log(`  users:        4 (admin@seeg.local / sup@seeg.local / ana@seeg.local / bruno@seeg.local — senha ${PASSWORD})`);
  console.log(`  stages:       ${stageDefs.length}`);
  console.log(`  tags:         ${tagDefs.length}`);
  console.log(`  channel:      Chat do Site (WEBCHAT)`);
  console.log(`  contacts:     ${contacts.length} (+ ${contacts.length * 2} identities)`);
  console.log(`  conversas:    ${CONVERSATIONS.length}`);
  console.log(`  mensagens:    ${messageCount}`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
