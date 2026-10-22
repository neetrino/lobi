import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@lobby/database' with { 'resolution-mode': 'import' };

import type { TenantId } from '../../../common/tenant/tenant-id';
import { PipelineConflictError } from './pipeline-conflict.error';
import type { PipelineKindName } from './pipeline-defaults';
import { lockColumn } from './pipeline-lock';

type Tx = Prisma.TransactionClient;

export function storedKind(kind: PipelineKindName): 'LEAD' | 'DEAL' {
  return kind === 'lead' ? 'LEAD' : 'DEAL';
}

export async function nextColumnPosition(
  tx: Tx,
  tenantId: TenantId,
  pipelineId: string,
): Promise<number> {
  const last = await tx.pipelineColumn.aggregate({
    where: { tenantId, pipelineId },
    _max: { position: true },
  });
  return (last._max.position ?? -1) + 1;
}

export async function placeCard(
  tx: Tx,
  tenantId: TenantId,
  pipelineId: string,
  columnId: string,
): Promise<number> {
  await lockColumn(tx, columnId);
  await requireColumn(tx, tenantId, pipelineId, columnId);
  const last = await tx.pipelineCard.aggregate({
    where: { tenantId, columnId },
    _max: { position: true },
  });
  return (last._max.position ?? -1) + 1;
}

/** Opens a free index in a column. `index` may be one past the last card. */
export async function openSlot(
  tx: Tx,
  tenantId: TenantId,
  pipelineId: string,
  columnId: string,
  index: number,
): Promise<number> {
  await lockColumn(tx, columnId);
  await requireColumn(tx, tenantId, pipelineId, columnId);
  const count = await tx.pipelineCard.count({ where: { tenantId, columnId } });
  const target = Math.max(0, Math.min(index, count));
  const gap = 1_000_000;
  await tx.pipelineCard.updateMany({
    where: { tenantId, columnId, position: { gte: target } },
    data: { position: { increment: gap } },
  });
  await tx.pipelineCard.updateMany({
    where: { tenantId, columnId, position: { gte: target + gap } },
    data: { position: { decrement: gap - 1 } },
  });
  return target;
}

/** Moves one card inside its column without breaking the unique position. */
export async function placeAt(
  tx: Tx,
  tenantId: TenantId,
  columnId: string,
  cardId: string,
  from: number,
  to: number,
): Promise<void> {
  await lockColumn(tx, columnId);
  const count = await tx.pipelineCard.count({ where: { tenantId, columnId } });
  const target = Math.max(0, Math.min(to, count - 1));
  if (from === target) {
    return;
  }
  await tx.pipelineCard
    .update({ where: { id: cardId }, data: { position: -1 } })
    .catch(rethrowWrite);
  await shiftPositions(tx, tenantId, columnId, from, target);
  await tx.pipelineCard
    .update({ where: { id: cardId }, data: { position: target } })
    .catch(rethrowWrite);
}

/** Parks the range above the unique positions, then writes the shifted values. */
async function shiftPositions(
  tx: Tx,
  tenantId: TenantId,
  columnId: string,
  from: number,
  target: number,
): Promise<void> {
  const gap = 1_000_000;
  const movingDown = from < target;
  await tx.pipelineCard.updateMany({
    where: {
      tenantId,
      columnId,
      position: movingDown ? { gt: from, lte: target } : { gte: target, lt: from },
    },
    data: { position: { increment: gap } },
  });
  await tx.pipelineCard.updateMany({
    where: {
      tenantId,
      columnId,
      position: movingDown
        ? { gt: from + gap, lte: target + gap }
        : { gte: target + gap, lt: from + gap },
    },
    data: { position: { decrement: movingDown ? gap + 1 : gap - 1 } },
  });
}

/** Rewrites one column so the remaining cards occupy 0, 1, 2, … in their current order. */
export async function compactColumn(tx: Tx, tenantId: TenantId, columnId: string): Promise<void> {
  await lockColumn(tx, columnId);
  const cards = await tx.pipelineCard.findMany({
    where: { tenantId, columnId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true },
  });
  if (cards.every((card, index) => card.position === index)) {
    return;
  }
  await tx.pipelineCard.updateMany({
    where: { tenantId, columnId },
    data: { position: { increment: 1_000_000 } },
  });
  for (const [index, card] of cards.entries()) {
    await tx.pipelineCard.update({ where: { id: card.id }, data: { position: index } });
  }
}

export async function requireColumn(
  tx: Tx,
  tenantId: TenantId,
  pipelineId: string,
  columnId: string,
): Promise<void> {
  const column = await tx.pipelineColumn.findFirst({
    where: { id: columnId, tenantId, pipelineId },
    select: { id: true },
  });
  if (column === null) {
    throw new NotFoundException();
  }
}

export async function requireCard(
  tx: Tx,
  tenantId: TenantId,
  pipelineId: string,
  cardId: string,
): Promise<{ columnId: string; position: number; outcome: string }> {
  const card = await tx.pipelineCard.findFirst({
    where: { id: cardId, tenantId, pipelineId },
    select: { columnId: true, position: true, outcome: true },
  });
  if (card === null) {
    throw new NotFoundException();
  }
  return card;
}

export async function requireParty(
  tx: Tx,
  tenantId: TenantId,
  contactId: string | null | undefined,
  ownerUserId: string | null | undefined,
): Promise<void> {
  if (contactId) {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true },
    });
    if (contact === null) {
      throw new NotFoundException();
    }
  }
  if (ownerUserId) {
    const owner = await tx.user.findFirst({
      where: { id: ownerUserId, tenantId },
      select: { id: true },
    });
    if (owner === null) {
      throw new NotFoundException();
    }
  }
}

export function isUniqueConflict(error: unknown): boolean {
  return prismaCode(error) === 'P2002';
}

export function rethrowWrite(error: unknown): never {
  const code = prismaCode(error);
  if (isUniqueConflict(error)) {
    throw new PipelineConflictError();
  }
  if (code === 'P2003' || code === 'P2025') {
    throw new NotFoundException();
  }
  throw error;
}

function prismaCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}
