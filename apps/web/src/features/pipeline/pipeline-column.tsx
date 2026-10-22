'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';

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
  const [slot, setSlot] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const width = draft ?? column.widthPx;
  const sum = column.cards.reduce((total, card) => total + card.amount, 0);
  const cardTotal = sourceCount ?? column.cards.length;
  const headerColor = stageColors[stageIndex];
  return (
    <section
      className={styles.column}
      style={{ width }}
      onDragEnter={rememberDragDepth}
      onDragOver={(event) => allowCardDrag(event, listRef.current)}
      onDragLeave={(event) => {
        releaseDragDepth(event);
        if (event.currentTarget.dataset.dragDepth === '0') {
          setSlot(null);
          if (listRef.current !== null) {
            listRef.current.dataset.slot = '';
          }
        }
      }}
      onDrop={(event) => {
        if (event.defaultPrevented) {
          return;
        }
        clearDragDepth(event.currentTarget);
        setSlot(null);
        dropCard(event, onMoveCard);
      }}
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
      <div
        className={styles.cards}
        ref={listRef}
        onDragOver={(event) =>
          hoverSlot(event, column.cards.length, (next) => setSlot(next), listRef.current)
        }
        onDrop={(event) => {
          event.stopPropagation();
          clearDragDepth(event.currentTarget.closest('section'));
          const index = readSlot(listRef.current, slot);
          setSlot(null);
          if (listRef.current !== null) {
            listRef.current.dataset.slot = '';
          }
          dropAt(event, column.id, column.cards, index, onSaveCard);
        }}
      >
        {column.cards.map((card, index) => (
          <Fragment key={card.id}>
            {slot === index ? <div className={styles.dropSlot} /> : null}
          <PipelineCardView
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
          </Fragment>
        ))}
        {slot === column.cards.length ? <div className={styles.dropSlot} /> : null}
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

function readSlot(list: HTMLDivElement | null, fallback: number | null): number | null {
  const raw = list?.dataset.slot ?? '';
  if (raw === '') {
    return fallback;
  }
  const index = Number(raw);
  return Number.isInteger(index) ? index : fallback;
}

function dropAt(
  event: DragEvent,
  columnId: string,
  cards: PipelineColumn['cards'],
  slot: number | null,
  onSave: (cardId: string, patch: CardUpdate) => void,
): void {
  event.preventDefault();
  const cardId = event.dataTransfer.getData('text/plain');
  if (cardId === '' || slot === null) {
    return;
  }
  const from = cards.findIndex((card) => card.id === cardId);
  const position = from >= 0 && slot > from ? slot - 1 : slot;
  if (from >= 0 && position === from) {
    return;
  }
  onSave(cardId, from >= 0 ? { position } : { columnId, position });
}

function allowCardDrag(event: DragEvent, list: HTMLDivElement | null): void {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add(styles.columnOver);
  scrollList(list, event.clientY);
}

function hoverSlot(
  event: DragEvent,
  count: number,
  setSlot: (slot: number | null) => void,
  list: HTMLDivElement | null,
): void {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';
  const cards = list === null ? [] : [...list.querySelectorAll('article')];
  const index = cards.findIndex((card) => {
    const box = card.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2;
  });
  const next = index === -1 ? count : index;
  if (list !== null && list.dataset.slot === String(next)) {
    scrollList(list, event.clientY);
    return;
  }
  if (list !== null) {
    list.dataset.slot = String(next);
  }
  setSlot(next);
  scrollList(list, event.clientY);
}

function scrollList(list: HTMLDivElement | null, clientY: number): void {
  if (list === null) {
    return;
  }
  const box = list.getBoundingClientRect();
  const edge = 36;
  if (clientY < box.top + edge) {
    list.scrollTop -= 12;
  } else if (clientY > box.bottom - edge) {
    list.scrollTop += 12;
  }
}

function rememberDragDepth(event: DragEvent<HTMLElement>): void {
  const depth = Number(event.currentTarget.dataset.dragDepth ?? '0') + 1;
  event.currentTarget.dataset.dragDepth = String(depth);
  event.currentTarget.classList.add(styles.columnOver);
}

function releaseDragDepth(event: DragEvent<HTMLElement>): void {
  const depth = Number(event.currentTarget.dataset.dragDepth ?? '1') - 1;
  event.currentTarget.dataset.dragDepth = String(Math.max(0, depth));
  if (depth <= 0) {
    event.currentTarget.classList.remove(styles.columnOver);
  }
}

function clearDragDepth(node: Element | null): void {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  node.dataset.dragDepth = '0';
  node.classList.remove(styles.columnOver);
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
