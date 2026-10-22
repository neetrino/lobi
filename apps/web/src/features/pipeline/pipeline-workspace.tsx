'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ContactsRequestError, readSession } from '../contacts/contacts-api';
import type { SessionPrincipal } from '../contacts/contact';
import { ContactsShell } from '../contacts/contacts-shell';
import shell from '../contacts/contacts.module.css';
import { PipelineColumnView } from './pipeline-column';
import { shownCards } from './pipeline-filter';
import { createBoardQueue } from './pipeline-queue';
import {
  convertLead,
  createCard,
  createColumn,
  deleteCard,
  deleteColumn,
  moveCard,
  patchColumn,
  patchPipeline,
  PipelineRequestError,
  readPipeline,
  createStatus,
  deleteStatus,
  updateCard,
  updateStatus,
  type PipelineBoard,
  type PipelineKindName,
} from './pipeline-api';
import glass from '../../ui/glass/glass.module.css';
import { stageColors } from './pipeline-stage-color';
import { PipelineToolbar } from './pipeline-toolbar';
import styles from './pipeline.module.css';

export function PipelineWorkspace({ kind }: { kind: PipelineKindName }) {
  const t = useTranslations('pipeline');
  const locale = useLocale();
  const router = useRouter();
  const [session, setSession] = useState<SessionPrincipal | null>(null);
  const [board, setBoard] = useState<PipelineBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardQueue = useRef(createBoardQueue());
  const boardRevision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([readSession(controller.signal), readPipeline(kind, controller.signal)])
      .then(([nextSession, nextBoard]) => {
        if (controller.signal.aborted) {
          return;
        }
        if (kind === 'lead' && !nextSession.user.leadsEnabled) {
          router.replace(`/${locale}/dashboard`);
          return;
        }
        setSession(nextSession);
        setBoard(nextBoard);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isSignedOut(reason)) {
          router.replace(`/${locale}/login`);
          return;
        }
        if (reason instanceof PipelineRequestError && reason.code === 'LEADS_DISABLED') {
          router.replace(`/${locale}/dashboard`);
          return;
        }
        setError(t('failed'));
      });
    return () => controller.abort();
  }, [kind, locale, router, t]);

  function change(
    action: () => Promise<PipelineBoard>,
    apply?: (current: PipelineBoard) => PipelineBoard,
  ): Promise<void> {
    const revision = boardRevision.current + 1;
    boardRevision.current = revision;
    let previous: PipelineBoard | null = null;
    if (apply !== undefined) {
      setBoard((current) => {
        previous = current;
        return current === null ? current : apply(current);
      });
    }
    return boardQueue.current.run(action).then(
      (next) => {
        if (boardRevision.current !== revision) {
          return;
        }
        setBoard(next);
        setError(null);
      },
      (reason: unknown) => {
        if (boardRevision.current === revision && previous !== null) {
          setBoard(previous);
        }
        if (isSignedOut(reason)) {
          router.replace(`/${locale}/login`);
          return;
        }
        setError(
          reason instanceof PipelineRequestError && reason.code === 'PIPELINE_COLUMN_NOT_EMPTY'
            ? t('columnNotEmpty')
            : t('failed'),
        );
      },
    );
  }

  return (
    <div className={shell.app}>
      <ContactsShell session={session} current={kind === 'lead' ? 'leads' : 'deals'} />
      <main className={board === null ? `${shell.main} ${shell.mainFill}` : shell.main}>
        {board === null ? (
          <p className={shell.loading}>{error ?? t('loading')}</p>
        ) : (
          <PipelineView
            board={board}
            error={error}
            locale={locale}
            userId={session?.user.id ?? null}
            canConfigure={session?.user.role === 'OWNER' || session?.user.role === 'ADMIN'}
            onChange={change}
          />
        )}
      </main>
    </div>
  );
}

function PipelineMetrics({
  board,
  locale,
  cards,
  total,
}: {
  board: PipelineBoard;
  locale: string;
  cards: number;
  total: number;
}) {
  const t = useTranslations('pipeline');
  const empty = board.columns.filter((column) => column.cards.length === 0).length;
  return (
    <section className={styles.metrics} aria-label={t('summary')}>
      <article className={`${styles.metric} ${glass.panel} ${glass.soft}`}>
        <span>{t('metricCards')}</span>
        <strong>{cards}</strong>
      </article>
      <article className={`${styles.metric} ${glass.panel} ${glass.soft}`}>
        <span>{t('metricAmount')}</span>
        <strong>
          {new Intl.NumberFormat(locale).format(total)} {board.amountLabel}
        </strong>
      </article>
      <article className={`${styles.metric} ${glass.panel} ${glass.soft}`}>
        <span>{t('metricColumns')}</span>
        <strong>{board.columns.length}</strong>
      </article>
      <article className={`${styles.metric} ${glass.panel} ${glass.soft}`}>
        <span>{t('metricEmpty')}</span>
        <strong>{empty}</strong>
      </article>
    </section>
  );
}

function PipelineView({
  board,
  error,
  locale,
  userId,
  canConfigure,
  onChange,
}: {
  board: PipelineBoard;
  error: string | null;
  locale: string;
  userId: string | null;
  canConfigure: boolean;
  onChange: (
    action: () => Promise<PipelineBoard>,
    apply?: (current: PipelineBoard) => PipelineBoard,
  ) => Promise<void>;
}) {
  const t = useTranslations('pipeline');
  const [query, setQuery] = useState('');
  const [statusId, setStatusId] = useState('');
  const boardRef = useRef<HTMLDivElement>(null);
  const colors = stageColors(board.columns.length);
  const cards = board.columns.flatMap((column) => shownCards(column.cards, query, statusId));
  const total = cards.reduce((sum, card) => sum + card.amount, 0);
  useEffect(() => {
    const node = boardRef.current;
    if (node === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) {
        return;
      }
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) {
        return;
      }
      event.preventDefault();
      node.scrollLeft += horizontal ? event.deltaX : event.deltaY;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [board.columns.length]);
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <input
            className={styles.nameInput}
            aria-label={t('boardName')}
            defaultValue={board.name}
            key={board.name}
            readOnly={!canConfigure}
            onBlur={(event) => {
              if (!canConfigure) {
                return;
              }
              const name = event.currentTarget.value.trim();
              if (name !== '' && name !== board.name) {
                void onChange(() => patchPipeline(board.kind, { name }));
              }
            }}
          />
          <p className={styles.note}>{t('note')}</p>
        </div>
      </header>
      {error === null ? null : <p className={styles.banner}>{error}</p>}
      <PipelineMetrics board={board} locale={locale} cards={cards.length} total={total} />
      <PipelineToolbar
        query={query}
        statusId={statusId}
        statuses={board.statuses}
        canConfigure={canConfigure}
        onQuery={setQuery}
        onStatus={setStatusId}
        onCreate={(draft) => void onChange(() => createStatus(board.kind, draft))}
        onRename={(id, name) => void onChange(() => updateStatus(board.kind, id, { name }))}
        onRecolor={(id, color) => void onChange(() => updateStatus(board.kind, id, { color }))}
        onDelete={(id) => void onChange(() => deleteStatus(board.kind, id))}
        onCreateColumn={(name) => void onChange(() => createColumn(board.kind, name))}
        whiteSearch
      />
      <div className={styles.board} ref={boardRef}>
        {board.columns.map((column, stageIndex) => (
          <PipelineColumnView
            key={column.id}
            column={{ ...column, cards: shownCards(column.cards, query, statusId) }}
            kind={board.kind}
            userId={userId}
            statuses={board.statuses}
            stageColors={colors}
            stageIndex={stageIndex}
            sourceCount={column.cards.length}
            amountLabel={board.amountLabel}
            locale={locale}
            onRename={(name) => void onChange(() => patchColumn(board.kind, column.id, { name }))}
            onResize={(widthPx) => onChange(() => patchColumn(board.kind, column.id, { widthPx }))}
            onDelete={() => void onChange(() => deleteColumn(board.kind, column.id))}
            onCreateCard={(draft) =>
              void onChange(() => createCard(board.kind, { ...draft, columnId: column.id }))
            }
            onMoveCard={(cardId) =>
              void onChange(
                () => moveCard(board.kind, cardId, column.id),
                (current) => relocateCard(current, cardId, column.id),
              )
            }
            onDeleteCard={(cardId) => void onChange(() => deleteCard(board.kind, cardId))}
            onSaveCard={(cardId, patch) =>
              void onChange(
                () => updateCard(board.kind, cardId, patch),
                patch.position === undefined && patch.columnId === undefined
                  ? undefined
                  : (current) =>
                      relocateCard(current, cardId, patch.columnId ?? column.id, patch.position),
              )
            }
            onConvertCard={(cardId) => void onChange(() => convertLead(cardId))}
            canConfigure={canConfigure}
          />
        ))}
      </div>
    </div>
  );
}

function relocateCard(
  board: PipelineBoard,
  cardId: string,
  columnId: string,
  position?: number,
): PipelineBoard {
  const moving = board.columns.flatMap((column) => column.cards).find((card) => card.id === cardId);
  if (moving === undefined) {
    return board;
  }
  const home = board.columns.find((column) => column.cards.some((card) => card.id === cardId));
  if (position === undefined && home?.id === columnId) {
    return board;
  }
  const columns = board.columns.map((column) => ({
    ...column,
    cards: column.cards
      .filter((card) => card.id !== cardId)
      .map((card, index) => ({ ...card, position: index })),
  }));
  return {
    ...board,
    columns: columns.map((column) => {
      if (column.id !== columnId) {
        return column;
      }
      const index =
        position === undefined
          ? column.cards.length
          : Math.max(0, Math.min(position, column.cards.length));
      const cards = [...column.cards];
      cards.splice(index, 0, { ...moving, position: index });
      return {
        ...column,
        cards: cards.map((card, cardIndex) => ({ ...card, position: cardIndex })),
      };
    }),
  };
}

function isSignedOut(reason: unknown): boolean {
  if (!(reason instanceof PipelineRequestError) && !(reason instanceof ContactsRequestError)) {
    return false;
  }
  return (
    reason.status === 401 ||
    reason.code === 'UNAUTHENTICATED' ||
    reason.code === 'SESSION_EXPIRED' ||
    reason.code === 'SESSION_REVOKED'
  );
}
