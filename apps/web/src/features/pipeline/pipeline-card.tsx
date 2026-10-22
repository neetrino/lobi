'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';

import { listContacts } from '../contacts/contacts-api';
import type { Contact } from '../contacts/contact';
import { Pencil, X } from 'lucide-react';

import { ConfirmDialog } from '../../ui/confirm/confirm-dialog';
import { useSheetDismiss } from '../../ui/overlay/sheet-dismiss';
import { DateField } from '../../ui/calendar/calendar';
import { Select, type SelectOption } from '../../ui/select/select';
import { SheetChrome, SheetFrame, sheetStyles } from '../../ui/side-sheet/side-sheet';
import { OverlayPortal } from '../contacts/overlay-portal';
import type { CardUpdate, PipelineBoard, PipelineCard, PipelineKindName } from './pipeline-api';
import styles from './pipeline.module.css';
import { PipelineChat } from './pipeline-chat';
import { PipelineNotes } from './pipeline-notes';

const OUTCOMES = ['OPEN', 'WON', 'LOST', 'DISQUALIFIED', 'CONVERTED'] as const;

export function PipelineCardView({
  card,
  index,
  total,
  kind,
  userId,
  amountLabel,
  locale,
  statuses = [],
  stageColors = [],
  stageIndex = 0,
  onSave,
  onDelete,
  onConvert,
}: {
  card: PipelineCard;
  index: number;
  total: number;
  kind: PipelineKindName;
  userId: string | null;
  amountLabel: string;
  locale: string;
  statuses?: PipelineBoard['statuses'];
  stageColors?: string[];
  stageIndex?: number;
  onSave: (patch: CardUpdate) => void;
  onDelete: () => void;
  onConvert: () => void;
}) {
  const t = useTranslations('pipeline');
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <article
      className={styles.card}
      draggable={!editing}
      onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
    >
      <div className={styles.cardTop}>
        <strong>{card.title}</strong>
        <span className={styles.cardTools}>
          <span className={styles.cardToolRow}>
            {card.createdByName === null ? null : (
              <span
                className={styles.avatar}
                title={card.createdByName}
                aria-label={card.createdByName}
              >
                {initials(card.createdByName)}
              </span>
            )}
            <button
              type="button"
              className={
                card.priority === 'URGENT'
                  ? `${styles.flagButton} ${styles.flagOn}`
                  : styles.flagButton
              }
              aria-pressed={card.priority === 'URGENT'}
              aria-label={card.priority === 'URGENT' ? t('clearUrgent') : t('markUrgent')}
              onClick={() => onSave({ priority: card.priority === 'URGENT' ? 'NORMAL' : 'URGENT' })}
            >
              <FlagIcon />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('editCard')}
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('deleteCard')}
              onClick={() => setConfirming(true)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
          <span className={styles.cardIcons}>
            <PipelineNotes
              cardId={card.id}
              cardTitle={card.title}
              kind={kind}
              initialCount={card.noteCount}
            />
            <PipelineChat
              cardId={card.id}
              cardTitle={card.title}
              kind={kind}
              initialCount={card.messageCount}
            />
          </span>
        </span>
      </div>
      <b>
        {new Intl.NumberFormat(locale).format(card.amount)} {amountLabel}
      </b>
      {card.company === '' ? null : <small>{card.company}</small>}
      <CardMarks card={card} locale={locale} stageColors={stageColors} stageIndex={stageIndex} />
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.add}
          disabled={index === 0}
          onClick={() => onSave({ position: index - 1 })}
        >
          {t('earlier')}
        </button>
        <button
          type="button"
          className={styles.add}
          disabled={index >= total - 1}
          onClick={() => onSave({ position: index + 1 })}
        >
          {t('later')}
        </button>
      </div>
      <CardStatus card={card} statuses={statuses} onSave={onSave} />
      {confirming ? (
        <ConfirmDialog
          title={t('deleteCard')}
          message={t('confirmDelete')}
          confirmLabel={t('deleteCard')}
          cancelLabel={t('cancel')}
          onConfirm={onDelete}
          onClose={() => setConfirming(false)}
        />
      ) : null}
      {editing ? (
        <CardEditor
          card={card}
          kind={kind}
          userId={userId}
          statuses={statuses}
          onSave={onSave}
          onConvert={onConvert}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </article>
  );
}

function CardStatus({
  card,
  statuses,
  onSave,
}: {
  card: PipelineCard;
  statuses: PipelineBoard['statuses'];
  onSave: (patch: CardUpdate) => void;
}) {
  const t = useTranslations('pipeline');
  if (statuses.length === 0) {
    return null;
  }
  const current = statuses.find((item) => item.id === card.statusId);
  const color = current?.color;
  return (
    <div className={styles.statusCorner}>
      <Select
        size="compact"
        label={t('status')}
        value={card.statusId ?? ''}
        triggerStyle={color === undefined ? undefined : { background: color, color: textOn(color) }}
        options={[
          { value: '', label: t('noStatus') },
          ...statuses.map((status) => ({ value: status.id, label: status.name })),
        ]}
        onChange={(next) => onSave({ statusId: next === '' ? null : next })}
      />
    </div>
  );
}

function CardMarks({
  card,
  locale,
  stageColors,
  stageIndex,
}: {
  card: PipelineCard;
  locale: string;
  stageColors: string[];
  stageIndex: number;
}) {
  return (
    <>
      {card.createdAt === null ? null : (
        <time className={styles.when} dateTime={card.createdAt}>
          {formatWhen(card.createdAt, locale)}
        </time>
      )}
      <div className={styles.stages} aria-hidden="true">
        {stageColors.map((color, index) => (
          <span
            key={color + String(index)}
            className={styles.stage}
            style={{ background: index <= stageIndex ? color : '#fff' }}
          />
        ))}
      </div>
    </>
  );
}

function CardEditor({
  card,
  kind,
  userId,
  statuses,
  onSave,
  onConvert,
  onClose,
}: {
  card: PipelineCard;
  kind: PipelineKindName;
  userId: string | null;
  statuses: PipelineBoard['statuses'];
  onSave: (patch: CardUpdate) => void;
  onConvert: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('pipeline');
  const contacts = useContacts();
  return (
    <OverlayPortal onDismiss={onClose}>
      <SheetFrame label={t('editCard')} closeLabel={t('close')}>
        <SheetChrome
          as="form"
          title={t('editCard')}
          onSubmit={(event) => submitCard(event, onSave, onClose)}
          footer={
            <>
              {kind === 'lead' && card.outcome !== 'CONVERTED' ? (
                <button type="button" className={styles.convert} onClick={onConvert}>
                  {t('convert')}
                </button>
              ) : null}
              <SheetCancel label={t('cancel')} />
              <button type="submit" className={sheetStyles.save}>
                {t('save')}
              </button>
            </>
          }
        >
          <TextField name="title" label={t('cardTitle')} defaultValue={card.title} required />
          <TextField name="company" label={t('company')} defaultValue={card.company} />
          <TextField name="amount" label={t('amount')} defaultValue={String(card.amount)} inputMode="numeric" />
          <TextField name="source" label={t('source')} defaultValue={card.source} />
          <TextField name="qualification" label={t('qualification')} defaultValue={card.qualification} />
          <TextField name="nextAction" label={t('nextAction')} defaultValue={card.nextAction} />
          <TextField name="lostReason" label={t('lostReason')} defaultValue={card.lostReason} />
          <Select
            name="outcome"
            label={t('outcome')}
            defaultValue={card.outcome}
            options={OUTCOMES.map((outcome) => ({
              value: outcome,
              label: t(outcomeLabel(outcome)),
            }))}
          />
          <DateField
            name="expectedCloseOn"
            label={t('expectedClose')}
            defaultValue={card.expectedCloseOn ?? ''}
          />
          <Select
            name="contactId"
            label={t('contact')}
            defaultValue={card.contactId ?? ''}
            options={[
              { value: '', label: t('noContact') },
              ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
            ]}
          />
          <Select
            name="statusId"
            label={t('status')}
            defaultValue={card.statusId ?? ''}
            options={[
              { value: '', label: t('noStatus') },
              ...statuses.map((status) => ({ value: status.id, label: status.name })),
            ]}
          />
          <Select
            name="ownerUserId"
            label={t('owner')}
            defaultValue={card.ownerUserId ?? ''}
            options={ownerOptions(t('clearOwner'), t('assignToMe'), userId)}
          />
        </SheetChrome>
      </SheetFrame>
    </OverlayPortal>
  );
}

function useContacts(): Contact[] {
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    listContacts('limit=50&sort=asc', controller.signal)
      .then((page) => setContacts(page.data))
      .catch(() => setContacts([]));
    return () => controller.abort();
  }, []);
  return contacts;
}

function submitCard(
  event: FormEvent<HTMLFormElement>,
  onSave: (patch: CardUpdate) => void,
  onClose: () => void,
): void {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const title = String(data.get('title') ?? '').trim();
  if (title === '') {
    return;
  }
  const expected = String(data.get('expectedCloseOn') ?? '');
  const contactId = String(data.get('contactId') ?? '');
  const ownerUserId = String(data.get('ownerUserId') ?? '');
  const statusId = String(data.get('statusId') ?? '');
  onSave({
    title,
    company: String(data.get('company') ?? '').trim(),
    amount: Math.max(0, Math.round(Number(data.get('amount') ?? 0) || 0)),
    source: String(data.get('source') ?? '').trim(),
    qualification: String(data.get('qualification') ?? '').trim(),
    nextAction: String(data.get('nextAction') ?? '').trim(),
    lostReason: String(data.get('lostReason') ?? '').trim(),
    outcome: outcomeValue(String(data.get('outcome') ?? 'OPEN')),
    expectedCloseOn: expected === '' ? null : expected,
    contactId: contactId === '' ? null : contactId,
    ownerUserId: ownerUserId === '' ? null : ownerUserId,
    statusId: statusId === '' ? null : statusId,
  });
  onClose();
}

function outcomeValue(value: string): PipelineCard['outcome'] {
  return OUTCOMES.find((outcome) => outcome === value) ?? 'OPEN';
}

function textOn(color: string): string {
  const hex = color.replace('#', '');
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#1f2937' : '#fff';
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3v18M6 4h11l-2.2 4L17 12H6" />
    </svg>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  required = false,
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  inputMode?: 'numeric';
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        aria-label={label}
        defaultValue={defaultValue}
        placeholder={label}
        required={required}
        inputMode={inputMode}
      />
    </label>
  );
}

function SheetCancel({ label }: { label: string }) {
  const dismiss = useSheetDismiss(() => undefined);
  return (
    <button type="button" className={styles.sheetCancel} onClick={dismiss}>
      {label}
    </button>
  );
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function formatWhen(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function ownerOptions(
  emptyLabel: string,
  mineLabel: string,
  userId: string | null,
): SelectOption[] {
  if (userId === null) {
    return [{ value: '', label: emptyLabel }];
  }
  return [
    { value: '', label: emptyLabel },
    { value: userId, label: mineLabel },
  ];
}

function outcomeLabel(
  outcome: PipelineCard['outcome'],
): 'outcomeOpen' | 'outcomeWon' | 'outcomeLost' | 'outcomeDisqualified' | 'outcomeConverted' {
  if (outcome === 'WON') return 'outcomeWon';
  if (outcome === 'LOST') return 'outcomeLost';
  if (outcome === 'DISQUALIFIED') return 'outcomeDisqualified';
  if (outcome === 'CONVERTED') return 'outcomeConverted';
  return 'outcomeOpen';
}
