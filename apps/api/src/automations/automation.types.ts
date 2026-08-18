import { ConversationStatus } from '@prisma/client';
import { isAutomationEvent, type AutomationEvent } from '../queues/queues.constants';

/**
 * Formas internas dos campos Json de Automation (trigger/conditions/actions).
 * Única fonte de verdade de parsing/validação — usada pelo CRUD (rejeitar
 * payload inválido) e pelo engine (nunca confiar no que está no banco).
 */

export interface AutomationTrigger {
  event: AutomationEvent;
}

export const CONDITION_OPS = ['eq', 'neq', 'contains', 'exists', 'not_exists'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface AutomationCondition {
  /** Caminho no context do evento (dot notation), ex.: 'channelType', 'messageType'. */
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export type AutomationAction =
  | { type: 'assign'; userId: string }
  | { type: 'add_tag'; tagId: string }
  | { type: 'move_stage'; stageId: string }
  | { type: 'set_status'; status: ConversationStatus }
  | { type: 'disable_ai' }
  | { type: 'send_template'; templateId: string; params?: string[] };

/** Lista de tipos válidos usada nas mensagens de erro de validação (CONTRACTS §12). */
export const AUTOMATION_ACTION_TYPES = [
  'assign',
  'add_tag',
  'move_stage',
  'set_status',
  'disable_ai',
  'send_template',
] as const;

export function parseTrigger(value: unknown): AutomationTrigger | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const event = (value as Record<string, unknown>).event;
  return isAutomationEvent(event) ? { event } : null;
}

export function parseCondition(value: unknown): AutomationCondition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const field = record.field;
  const op = record.op;
  if (typeof field !== 'string' || field.length === 0) {
    return null;
  }
  if (typeof op !== 'string' || !(CONDITION_OPS as readonly string[]).includes(op)) {
    return null;
  }
  const needsValue = op === 'eq' || op === 'neq' || op === 'contains';
  if (needsValue && record.value === undefined) {
    return null;
  }
  return { field, op: op as ConditionOp, value: record.value };
}

export function parseAction(value: unknown): AutomationAction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case 'assign':
      return typeof record.userId === 'string' && record.userId
        ? { type: 'assign', userId: record.userId }
        : null;
    case 'add_tag':
      return typeof record.tagId === 'string' && record.tagId
        ? { type: 'add_tag', tagId: record.tagId }
        : null;
    case 'move_stage':
      return typeof record.stageId === 'string' && record.stageId
        ? { type: 'move_stage', stageId: record.stageId }
        : null;
    case 'set_status':
      return typeof record.status === 'string' &&
        record.status in ConversationStatus
        ? { type: 'set_status', status: record.status as ConversationStatus }
        : null;
    case 'disable_ai':
      return { type: 'disable_ai' };
    case 'send_template': {
      if (typeof record.templateId !== 'string' || record.templateId.length === 0) {
        return null;
      }
      if (record.params === undefined) {
        return { type: 'send_template', templateId: record.templateId };
      }
      if (
        !Array.isArray(record.params) ||
        !record.params.every((param): param is string => typeof param === 'string')
      ) {
        return null;
      }
      return { type: 'send_template', templateId: record.templateId, params: record.params };
    }
    default:
      return null;
  }
}

/** Resolve um caminho dot-notation dentro do context do evento. */
export function contextValue(context: Record<string, unknown>, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Avalia uma condição contra o context — comparações por igualdade estrita/string. */
export function evaluateCondition(
  condition: AutomationCondition,
  context: Record<string, unknown>,
): boolean {
  const actual = contextValue(context, condition.field);
  switch (condition.op) {
    case 'eq':
      return actual === condition.value;
    case 'neq':
      return actual !== condition.value;
    case 'contains':
      return (
        typeof actual === 'string' &&
        typeof condition.value === 'string' &&
        actual.toLowerCase().includes(condition.value.toLowerCase())
      );
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
  }
}
