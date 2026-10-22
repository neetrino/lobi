'use client';

import { useTranslations } from 'next-intl';
import { useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { Plus } from 'lucide-react';

import { ConfirmDialog } from '../../ui/confirm/confirm-dialog';
import { PipelineCardView } from './pipeline-card';
import { NewCardSheet } from './pipeline-new-card';
import { clampColumnWidth } from './pipeline-width';
import type { CardUpdate, PipelineBoard, PipelineColumn, PipelineKindName } from './pipeline-api';
import styles from './pipeline.module.css';

export function PipelineColumnView({
  column,
  amountLabel,
  locale,
  onRename,
  onResize,
  onDelete,
  kind,
  userId,
  statuses = [],
  stageColors = [],
  stageIndex = 0,
  sourceCount,
  onCreateCard,
  onMoveCard,
  onDeleteCard,
  onSaveCard,
  onConvertCard,
  canConfigure = true,
}: {
  column: PipelineColumn;
  kind: PipelineKindName;
  userId: string | null;
  statuses?: PipelineBoard['statuses'];
  stageColors?: string[];
  stageIndex?: number;
  sourceCount?: number;
  amountLabel: string;
  locale: string;
  onRename: (name: string) => void;
  onResize: (widthPx: number) => Promise<void>;
  onDelete: () => void;
  onCreateCard: (draft: { title: string; company: string; amount: number }) => void;
  onMoveCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onSaveCard: (cardId: string, patch: CardUpdate) => void;
  onConvertCard: (cardId: string) => void;
  canConfigure?: boolean;
}) {
  const t = useTranslations('pipeline');
  const [draft, setDraft] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const width = draft ?? column.widthPx;
  const sum = column.cards.reduce((total, card) => total + card.amount, 0);
  const cardTotal = sourceCount ?? column.cards.length;
  const headerColor = stageColors[stageIndex];
  return (
    <section
      className={styles.column}
      style={{ width }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => dropCard(event, onMoveCard)}
    >
      <header
        className={styles.columnHead}
        style={{ background: headerColor ?? '#ec8e0b' }}
      >
        <input
          className={styles.columnName}
          aria-label={t('columnName')}
          defaultValue={column.name}
          key={column.name}
          readOnly={!canConfigure}
          onBlur={(event) => {
            if (canConfigure) {
              commitName(event.currentTarget.value, column.name, onRename);
            }
          }}
        />
        <span className={styles.count}>{column.cards.length}</span>
        {canConfigure ? (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('deleteColumn')}
            onClick={() => setConfirming(true)}
          >
            ×
          </button>
        ) : null}
      </header>
      {confirming ? (
        <ConfirmDialog
          title={t('deleteColumn')}
          message={t('confirmColumn')}
          confirmLabel={t('deleteColumn')}
          cancelLabel={t('cancel')}
          onConfirm={onDelete}
          onClose={() => setConfirming(false)}
        />
      ) : null}
      <p className={styles.sum}>
        {formatAmount(sum, locale)} {amountLabel}
      </p>
      <div className={styles.cards}>
        {column.cards.map((card) => (
          <PipelineCardView
            key={card.id}
            card={card}
            index={card.position}
            total={cardTotal}
            kind={kind}
            userId={userId}
            amountLabel={amountLabel}
            locale={locale}
            statuses={statuses}
            stageColors={stageColors}
            stageIndex={stageIndex}
            onSave={(patch) => onSaveCard(card.id, patch)}
            onDelete={() => onDeleteCard(card.id)}
            onConvert={() => onConvertCard(card.id)}
          />
        ))}
      </div>
      <footer className={styles.columnFoot}>
        <AddCard onCreate={onCreateCard} />
      </footer>
      <span
        className={styles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resize')}
        onPointerDown={(event) => startResize(event, width, setDraft, onResize)}
      />
    </section>
  );
}

function AddCard({
  onCreate,
}: {
  onCreate: (draft: { title: string; company: string; amount: number }) => void;
}) {
  const t = useTranslations('pipeline');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.addCard} onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden="true" />
        {t('addCard')}
      </button>
      {open ? <NewCardSheet onClose={() => setOpen(false)} onCreate={onCreate} /> : null}
    </>
  );
}

function commitName(next: string, current: string, onRename: (name: string) => void): void {
  const name = next.trim();
  if (name !== '' && name !== current) {
    onRename(name);
  }
}

function dropCard(event: DragEvent, onMove: (cardId: string) => void): void {
  event.preventDefault();
  const cardId = event.dataTransfer.getData('text/plain');
  if (cardId !== '') {
    onMove(cardId);
  }
}

function startResize(
  event: ReactPointerEvent,
  startWidth: number,
  setDraft: (widthPx: number | null) => void,
  onResize: (widthPx: number) => Promise<void>,
): void {
  event.preventDefault();
  const startX = event.clientX;
  const next = (clientX: number) => clampColumnWidth(startWidth + clientX - startX);
  const move = (pointer: PointerEvent) => setDraft(next(pointer.clientX));
  const stop = (pointer: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    const widthPx = next(pointer.clientX);
    setDraft(widthPx);
    void onResize(widthPx).finally(() => setDraft(null));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

function formatAmount(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(amount);
}
