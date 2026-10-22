import { NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@lobby/database' with { 'resolution-mode': 'import' };

import type { TenantId } from '../../../common/tenant/tenant-id';
import { PipelineColumnNotEmptyError } from './pipeline-column-not-empty.error';
import { PipelineConflictError } from './pipeline-conflict.error';
import type { PipelineKindName } from './pipeline-defaults';
import { lockCard, lockColumn, lockPipeline } from './pipeline-lock';
import {
  nextColumnPosition,
  compactColumn,
  openSlot,
  placeAt,
  placeCard,
  requireCard,
  requireColumn,
  requireParty,
  rethrowWrite,
  storedKind,
} from './pipeline-positions';
import { cardChanges, cardInsert, copiedDeal, presentCard } from './pipeline-card-fields';
import { listStatuses, requireStatus } from './pipeline-status';
import type { CardCreate, CardPatch, ColumnPatch, PipelinePatch } from './pipeline.schema';

type BoardCard = {
  id: string;
  title: string;
  company: string;
  amount: number;
  position: number;
  source: string;
  qualification: string;
  nextAction: string;
  lostReason: string;
  outcome: 'OPEN' | 'WON' | 'LOST' | 'DISQUALIFIED' | 'CONVERTED';
  priority: 'NORMAL' | 'URGENT';
  expectedCloseOn: string | null;
  contactId: string | null;
  ownerUserId: string | null;
  statusId: string | null;
  createdAt: string;
  createdByName: string | null;
  messageCount: number;
  noteCount: number;
};

type BoardStatus = {
  id: string;
  name: string;
  color: string;
  position: number;
};

type BoardColumn = {
  id: string;
  name: string;
  position: number;
  widthPx: number;
  cards: BoardCard[];
};

export type AfterWrite = (tx: Prisma.TransactionClient) => Promise<void>;

export type PipelineBoard = {
  id: string;
  kind: PipelineKindName;
  name: string;
  amountLabel: string;
  columns: BoardColumn[];
  statuses: BoardStatus[];
};

type StoredPipeline = { id: string };

export async function existingPipeline(
  prisma: PrismaClient,
  tenantId: TenantId,
  kind: PipelineKindName,
): Promise<StoredPipeline> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { tenantId_kind: { tenantId, kind: storedKind(kind) } },
  });
  if (pipeline === null) {
    throw new NotFoundException();
  }
  return pipeline;
}

export async function loadBoard(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  kind: PipelineKindName,
): Promise<PipelineBoard> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, tenantId },
    include: {
      columns: {
        orderBy: { position: 'asc' },
        include: {
          cards: {
            orderBy: { position: 'asc' },
            include: {
              createdBy: { select: { name: true } },
              _count: { select: { messages: true, notes: true } },
            },
          },
        },
      },
    },
  });
  if (pipeline === null) {
    throw new NotFoundException();
  }
  const statuses = await listStatuses(prisma, tenantId);
  return {
    id: pipeline.id,
    kind,
    name: pipeline.name,
    amountLabel: pipeline.amountLabel,
    columns: pipeline.columns.map((column) => ({
      id: column.id,
      name: column.name,
      position: column.position,
      widthPx: column.widthPx,
      cards: column.cards.map(presentCard),
    })),
    statuses,
  };
}

export async function renamePipeline(
  prisma: PrismaClient,
  pipelineId: string,
  patch: PipelinePatch,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.pipeline
      .update({
        where: { id: pipelineId },
        data: { name: patch.name, amountLabel: patch.amountLabel },
      })
      .catch(rethrowWrite);
    await after?.(tx);
  });
}

export async function appendColumn(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  name: string,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockPipeline(tx, pipelineId);
    const position = await nextColumnPosition(tx, tenantId, pipelineId);
    await tx.pipelineColumn
      .create({
        data: { tenantId, pipelineId, name, position, widthPx: 300 },
      })
      .catch(rethrowWrite);
    await after?.(tx);
  });
}

export async function patchColumn(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  columnId: string,
  patch: ColumnPatch,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await requireColumn(tx, tenantId, pipelineId, columnId);
    await tx.pipelineColumn
      .update({
        where: { id: columnId },
        data: { name: patch.name, widthPx: patch.widthPx },
      })
      .catch(rethrowWrite);
    await after?.(tx);
  });
}

export async function deleteColumn(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  columnId: string,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockColumn(tx, columnId);
    await requireColumn(tx, tenantId, pipelineId, columnId);
    const cards = await tx.pipelineCard.count({ where: { tenantId, columnId } });
    if (cards > 0) {
      throw new PipelineColumnNotEmptyError();
    }
    await tx.pipelineColumn.delete({ where: { id: columnId } }).catch(rethrowWrite);
    await after?.(tx);
  });
}

export async function appendCard(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  input: CardCreate,
  createdByUserId: string,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await requireParty(tx, tenantId, input.contactId, input.ownerUserId);
    await requireStatus(tx, tenantId, input.statusId);
    const position = await placeCard(tx, tenantId, pipelineId, input.columnId);
    await tx.pipelineCard
      .create({
        data: cardInsert(tenantId, pipelineId, input, position, createdByUserId),
      })
      .catch(rethrowWrite);
    await after?.(tx);
  });
}

export async function patchCard(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  cardId: string,
  patch: CardPatch,
  after?: AfterWrite,
  onMove?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCard(tx, cardId);
    const card = await requireCard(tx, tenantId, pipelineId, cardId);
    await requireParty(tx, tenantId, patch.contactId, patch.ownerUserId);
    await requireStatus(tx, tenantId, patch.statusId);
    const destination = patch.columnId;
    const moved = destination !== undefined && destination !== card.columnId;
    const position = moved
      ? patch.position === undefined
        ? await placeCard(tx, tenantId, pipelineId, destination)
        : await openSlot(tx, tenantId, pipelineId, destination, patch.position)
      : undefined;
    await tx.pipelineCard
      .update({
        where: { id: cardId },
        data: cardChanges(patch, moved, destination, position),
      })
      .catch(rethrowWrite);
    if (moved) {
      await compactColumn(tx, tenantId, card.columnId);
      await onMove?.(tx);
    } else if (patch.position !== undefined) {
      await placeAt(tx, tenantId, card.columnId, cardId, card.position, patch.position);
    }
    await after?.(tx);
  });
}

export async function deleteCard(
  prisma: PrismaClient,
  tenantId: TenantId,
  pipelineId: string,
  cardId: string,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCard(tx, cardId);
    const card = await requireCard(tx, tenantId, pipelineId, cardId);
    await tx.pipelineCard.delete({ where: { id: cardId } }).catch(rethrowWrite);
    await compactColumn(tx, tenantId, card.columnId);
    await after?.(tx);
  });
}

export async function convertLead(
  prisma: PrismaClient,
  tenantId: TenantId,
  cardId: string,
  createdByUserId: string,
  after?: AfterWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCard(tx, cardId);
    const lead = await tx.pipeline.findUnique({
      where: { tenantId_kind: { tenantId, kind: 'LEAD' } },
    });
    const deal = await tx.pipeline.findUnique({
      where: { tenantId_kind: { tenantId, kind: 'DEAL' } },
      include: { columns: { orderBy: { position: 'asc' }, take: 1 } },
    });
    const card = lead === null ? null : await requireCard(tx, tenantId, lead.id, cardId);
    const column = deal?.columns[0];
    if (lead === null || deal === null || card === null || column === undefined) {
      throw new NotFoundException();
    }
    if (card.outcome === 'CONVERTED') {
      throw new PipelineConflictError('Lead is already converted.');
    }
    const source = await tx.pipelineCard.findFirstOrThrow({ where: { id: cardId, tenantId } });
    const position = await placeCard(tx, tenantId, deal.id, column.id);
    await tx.pipelineCard
      .create({
        data: copiedDeal(tenantId, deal.id, column.id, position, source, createdByUserId),
      })
      .catch(rethrowWrite);
    await tx.pipelineCard.update({ where: { id: cardId }, data: { outcome: 'CONVERTED' } });
    await after?.(tx);
  });
}
