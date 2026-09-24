import { BadRequestException } from '@nestjs/common';

const CPF_OR_CNPJ_CANDIDATE = /(?<!\d)(?:\d[.\s/-]?){10,13}\d(?!\d)/g;
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const PHONE_WITH_LABEL = /\b(?:telefone|celular|whatsapp)\b\s*(?::|=|-)?\s*(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b/i;
const BANK_SLIP_LINE = /\b(?:linha\s+digit[aá]vel|c[oó]digo\s+de\s+barras)\b\s*(?::|=|-)?\s*[\d.\s-]{35,}/i;
const PIX_KEY = /\b(?:chave\s*pix|pix\s*key)\b\s*(?::|=|-)\s*\S+/i;
const SECRET_VALUE = /\b(?:senha|password|token(?:\s+de\s+acesso)?|cvv|cvc)\b\s*(?::|=|-)\s*\S+/i;

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function hasRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

function isValidCpf(value: string): boolean {
  if (value.length !== 11 || hasRepeatedDigits(value)) return false;
  const check = (length: number) => {
    const sum = value.slice(0, length).split('').reduce((total, digit, index) => (
      total + Number(digit) * (length + 1 - index)
    ), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return check(9) === Number(value[9]) && check(10) === Number(value[10]);
}

function isValidCnpj(value: string): boolean {
  if (value.length !== 14 || hasRepeatedDigits(value)) return false;
  const check = (base: string, weights: number[]) => {
    const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return check(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[12])
    && check(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[13]);
}

function passesLuhn(value: string): boolean {
  let total = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return total % 10 === 0;
}

/**
 * RAG só recebe conhecimento geral aprovado. Informações de clientes, cobrança
 * e segredos devem permanecer nos sistemas transacionais protegidos, nunca em
 * chunks recuperáveis. A checagem é deliberadamente anterior à persistência.
 */
export function assertKnowledgeContentIsSafe(content: string): void {
  const documentIds = content.match(CPF_OR_CNPJ_CANDIDATE) ?? [];
  if (documentIds.some((candidate) => {
    const value = digits(candidate);
    return isValidCpf(value) || isValidCnpj(value);
  })) {
    throw new BadRequestException('A fonte não pode conter CPF ou CNPJ de cliente');
  }

  const cardNumbers = content.match(CARD_CANDIDATE) ?? [];
  if (cardNumbers.some((candidate) => passesLuhn(digits(candidate)))) {
    throw new BadRequestException('A fonte não pode conter número de cartão');
  }

  if (PHONE_WITH_LABEL.test(content)) {
    throw new BadRequestException('A fonte não pode conter telefone de cliente');
  }
  if (BANK_SLIP_LINE.test(content)) {
    throw new BadRequestException('A fonte não pode conter linha digitável ou código de barras');
  }
  if (PIX_KEY.test(content)) {
    throw new BadRequestException('A fonte não pode conter chave PIX');
  }
  if (SECRET_VALUE.test(content)) {
    throw new BadRequestException('A fonte não pode conter senha, token ou código de segurança');
  }
}
