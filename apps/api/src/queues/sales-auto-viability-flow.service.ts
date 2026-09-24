import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageDirection, MessageType, type Message } from '@prisma/client';
import type { Env } from '../config/env.validation';
import type { IxcAutoViabilityCheckDto } from '../integrations/ixc/dto/ixc-auto-viability-check.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { OperationalCaseState } from '../support-case-state/support-case-state.types';
import { PostalAddressLookupService } from './postal-address-lookup.service';

type DirectCheckInput = Omit<IxcAutoViabilityCheckDto, 'conversationId'>;

export type SalesAutoViabilityFlowResult =
  | { kind: 'NONE' }
  | { kind: 'REPLY'; reply: string }
  | { kind: 'EXECUTE'; input: DirectCheckInput };

const ASK_NUMBER = 'Encontrei o CEP. Agora, me informe somente o número do endereço.';
const ASK_STREET = 'Esse CEP não informa a rua. Me diga somente o nome da rua para eu continuar.';
const INVALID_POSTAL = 'Não consegui localizar esse CEP. Confira os oito números e me envie novamente junto com o número do endereço.';

const ASK_LOCATION_OR_POSTAL = 'Para verificar a disponibilidade agora, compartilhe sua localização pelo clipe. Se preferir, envie somente o CEP e o número do endereço — por exemplo: 12345-678, 100.';

function textOf(message: Pick<Message, 'type' | 'content'>): string {
  const content = message.content;
  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const text = (content as Record<string, unknown>).text;
    return typeof text === 'string' ? text.trim() : '';
  }
  return '';
}

function coordinatesOf(message: Pick<Message, 'type' | 'content'>): Pick<DirectCheckInput, 'latitude' | 'longitude'> | null {
  if (message.type !== MessageType.LOCATION) return null;
  const content = message.content;
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null;
  const value = content as Record<string, unknown>;
  const latitude = typeof value.latitude === 'number' ? value.latitude : Number(value.latitude);
  const longitude = typeof value.longitude === 'number' ? value.longitude : Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

@Injectable()
export class SalesAutoViabilityFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly postalAddress: PostalAddressLookupService,
  ) {}

  /**
   * Mantém a coleta no próprio atendimento, sem duplicar dados no estado
   * operacional. A consulta direta só acontece depois de o cliente compartilhar
   * um CEP+número ou uma localização, sempre dentro da rota de Vendas.
   */
  async resolve(input: {
    orgId: string;
    conversationId: string;
    caseState: OperationalCaseState;
  }): Promise<SalesAutoViabilityFlowResult> {
    if (
      this.config.get('IXC_INMAP_DIRECT_CHECK_ENABLED', { infer: true }) !== true
      || input.caseState.route !== 'sales'
      || input.caseState.coverageCheckStatus !== 'NOT_CHECKED'
    ) return { kind: 'NONE' };

    const messages = await this.prisma.prismaSystem.message.findMany({
      where: { orgId: input.orgId, conversationId: input.conversationId, type: { not: MessageType.SYSTEM } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Evita pedir cidade/bairro/endereço outra vez após o cliente informar
      // CEP+número ou compartilhar a localização.
      take: 40,
    });
    messages.reverse();
    const inbound = messages.filter((message) => message.direction === MessageDirection.INBOUND);
    // Troca/upgrade de plano de quem já é cliente usa o cadastro e o contrato,
    // não a viabilidade de uma nova instalação. Mantemos os dois caminhos
    // comerciais separados para não pedir localização indevidamente.
    if (this.isExistingCustomerPlanChange(inbound)) return { kind: 'NONE' };
    const coordinates = this.extractCoordinates(inbound);
    // Coordenadas compartilhadas são usadas exclusivamente para a consulta
    // técnica oficial desta conversa de Vendas; elas não acionam busca de
    // cadastro, fluxo de Suporte ou de Financeiro.
    if (coordinates) return { kind: 'EXECUTE', input: coordinates };
    const postal = this.extractPostalAndNumber(inbound);
    // Sem local fornecido, a pergunta sobre uso vem primeiro. Este fluxo roda
    // antes da IA e não pode antecipar a coleta de endereço nessa etapa.
    if (!postal && input.caseState.primaryUsage === 'UNKNOWN'
      && input.caseState.nextStep === 'ASK_PRIMARY_USAGE') return { kind: 'NONE' };
    if (!postal) return { kind: 'REPLY', reply: ASK_LOCATION_OR_POSTAL };
    const resolved = await this.postalAddress.lookup(postal.postalCode);
    if (!resolved) return { kind: 'REPLY', reply: INVALID_POSTAL };
    const number = postal.number ?? this.extractAddress(inbound)?.number;
    if (!number) return { kind: 'REPLY', reply: ASK_NUMBER };
    const street = resolved.street || this.extractAddress(inbound)?.street;
    if (!street) return { kind: 'REPLY', reply: ASK_STREET };
    const neighborhood = resolved.neighborhood || this.neighborhoodAfterLatestRequest(messages);
    if (!neighborhood) return { kind: 'REPLY', reply: 'Esse CEP não informa o bairro. Me diga somente o bairro para eu continuar.' };
    // O endpoint nativo aceita endereço normalizado ou coordenadas.
    return {
      kind: 'EXECUTE',
      input: { ...resolved, neighborhood, postalCode: postal.postalCode, number, street },
    };
  }

  private extractCoordinates(messages: Message[]): Pick<DirectCheckInput, 'latitude' | 'longitude'> | null {
    for (const message of [...messages].reverse()) {
      const coordinates = coordinatesOf(message);
      if (coordinates) return coordinates;
    }
    return null;
  }

  private isExistingCustomerPlanChange(messages: Message[]): boolean {
    const text = messages.slice(-8).map((message) => textOf(message)).join(' ').toLocaleLowerCase('pt-BR');
    return /\b(?:j[aá]\s+sou\s+cliente|meu\s+plano|trocar\s+(?:de\s+)?plano|mudar\s+(?:de\s+)?plano|upgrade|aumentar\s+(?:a\s+)?(?:velocidade|internet|mega))\b/u.test(text);
  }

  private extractPostalAndNumber(messages: Message[]): { postalCode: string; number: string | null } | null {
    for (const message of [...messages].reverse()) {
      const value = textOf(message);
      const match = value.match(/\b(\d{5})[-\s]?(\d{3})\b/);
      if (!match || match.index === undefined) continue;
      const afterPostal = value.slice(match.index + match[0].length);
      const number = afterPostal.match(/\b(?:n[ºo°.]?\s*)?(\d{1,6}[a-z]?)\b/i)?.[1] ?? null;
      return { postalCode: `${match[1]}${match[2]}`, number };
    }
    return null;
  }


  private extractAddress(messages: Message[]): Pick<DirectCheckInput, 'street' | 'number'> | null {
    for (const message of [...messages].reverse()) {
      const value = textOf(message).replace(/\s+/g, ' ').trim();
      if (!/\b(rua|avenida|av\.?|travessa|estrada|rodovia|alameda|loteamento)\b/i.test(value)) continue;
      const numberMatch = value.match(/\b(?:n[ºo°.]?\s*)?(\d{1,6}[a-z]?)\b/i);
      if (!numberMatch || numberMatch.index === undefined) continue;
      const street = value.slice(0, numberMatch.index).replace(/[\s,.-]+$/, '').trim();
      if (street.length > 0) return { street, number: numberMatch[1]! };
    }
    return null;
  }

  private neighborhoodAfterLatestRequest(messages: Message[]): string | null {
    let requestIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.direction === MessageDirection.OUTBOUND && /cep não informa o bairro/i.test(textOf(message))) {
        requestIndex = index;
        break;
      }
    }
    if (requestIndex < 0) return null;
    for (const message of messages.slice(requestIndex + 1)) {
      if (message.direction !== MessageDirection.INBOUND) continue;
      const value = textOf(message).replace(/\s+/g, ' ').trim();
      if (value.length >= 2 && value.length <= 120 && !/\b\d{5}[-\s]?\d{3}\b/.test(value)) return value;
    }
    return null;
  }

}
