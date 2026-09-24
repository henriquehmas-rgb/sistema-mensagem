export interface TimelineMessageOrder {
  id: string;
  createdAt: Date | string;
}

/**
 * Ordem cronológica determinística para mensagens que compartilham o mesmo
 * timestamp. O banco usa a mesma regra em consultas; esta função sustenta os
 * testes e consumidores em memória sem inferir uma ordem pela chegada.
 */
export function compareTimelineMessageOrder(
  left: TimelineMessageOrder,
  right: TimelineMessageOrder,
): number {
  const time = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (time !== 0) return time;
  return left.id.localeCompare(right.id);
}
