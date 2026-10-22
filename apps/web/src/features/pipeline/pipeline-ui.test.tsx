/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '../../messages/en.json';
import type { SessionPrincipal } from '../contacts/contact';
import { ContactsShell } from '../contacts/contacts-shell';
import { clearRememberedSession } from '../contacts/remembered-session';
import type { PipelineCard, PipelineColumn } from './pipeline-api';
import { PipelineCardView } from './pipeline-card';
import { PipelineColumnView } from './pipeline-column';
import { PipelineWorkspace } from './pipeline-workspace';

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const cardId = '00000000-0000-4000-8000-000000000010';
const userId = '00000000-0000-4000-8000-000000000020';

describe('pipeline board controls', () => {
  afterEach(() => {
    cleanup();
    clearRememberedSession();
    vi.unstubAllGlobals();
    router.replace.mockReset();
  });

  it('asks before deleting a card and edits amount, outcome, contact, and owner', async () => {
    const onDelete = vi.fn();
    const onSave = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: [contactRow()], page: { nextCursor: null } })),
    );
    renderCard({ onDelete, onSave });

    fireEvent.click(screen.getByText('Ada'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    const confirm = screen.getByText('Delete this card?').closest('section');
    expect(confirm).toBeTruthy();
    fireEvent.click(within(confirm as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '40' } });
    fireEvent.click(screen.getByLabelText('Contact'));
    fireEvent.click(await screen.findByRole('option', { name: 'Nare' }));
    fireEvent.click(screen.getByLabelText('Outcome'));
    fireEvent.click(await screen.findByRole('option', { name: 'Won' }));
    fireEvent.click(screen.getByLabelText('Owner'));
    fireEvent.click(await screen.findByRole('option', { name: 'Assign to me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 40,
        outcome: 'WON',
        contactId,
        ownerUserId: userId,
      }),
    );
  });

  it('toggles a card between urgent and normal', () => {
    const onSave = vi.fn();
    const view = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PipelineCardView
          card={sampleCard()}
          index={0}
          total={2}
          kind="lead"
          userId={userId}
          amountLabel="AMD"
          locale="en"
          onSave={onSave}
          onDelete={vi.fn()}
          onConvert={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark as urgent' }));
    expect(onSave).toHaveBeenLastCalledWith({ priority: 'URGENT' });

    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PipelineCardView
          card={{ ...sampleCard(), priority: 'URGENT' }}
          index={0}
          total={2}
          kind="lead"
          userId={userId}
          amountLabel="AMD"
          locale="en"
          onSave={onSave}
          onDelete={vi.fn()}
          onConvert={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear urgent' }));
    expect(onSave).toHaveBeenLastCalledWith({ priority: 'NORMAL' });
  });

  it('opens the card chat on the page, outside the card', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: [] })),
    );
    Element.prototype.scrollIntoView = () => undefined;
    renderCard({});
    fireEvent.click(screen.getByRole('button', { name: 'Open card chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat for Ada' });
    expect(dialog.closest('article')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('converts a lead and reorders with the buttons and a drop', () => {
    const onConvert = vi.fn();
    const onSave = vi.fn();
    const onMove = vi.fn();
    renderColumn({ onConvertCard: onConvert, onSaveCard: onSave, onMoveCard: onMove });

    fireEvent.click(screen.getByText('Ada'));
    fireEvent.click(screen.getByRole('button', { name: 'Convert to deal' }));
    expect(onConvert).toHaveBeenCalledWith(cardId);

    expect(screen.getAllByRole('button', { name: 'Earlier' })[0]).toHaveProperty('disabled', true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Later' })[0] ?? document.body);
    expect(onSave).toHaveBeenCalledWith(cardId, { position: 1 });

    const article = screen.getByText('Ada').closest('article');
    fireEvent.dragStart(article ?? document.body, { dataTransfer: { setData: vi.fn() } });
    const column = screen.getByLabelText('Column name').closest('section');
    fireEvent.drop(column ?? document.body, { dataTransfer: { getData: () => cardId } });
    expect(onMove).toHaveBeenCalledWith(cardId);
  });

  it('lets a member add a card without column configuration', () => {
    renderColumn({ canConfigure: false });
    expect(screen.getByRole('button', { name: 'Add card' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete column' })).toBeNull();
    expect(screen.getByLabelText('Column name')).toHaveProperty('readOnly', true);
  });

  it('asks before deleting a column', () => {
    const onDelete = vi.fn();
    renderColumn({ onDelete });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete column' })[0] ?? document.body);
    expect(screen.getByText('Delete this column?')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete column' })[1] ?? document.body);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('keeps the account visible while the next page session is still loading', () => {
    renderShell();
    cleanup();
    renderUi(<ContactsShell session={null} current="contacts" />);
    expect(screen.getByRole('button', { name: /Owner/ })).toBeTruthy();
  });

  it('shows loading, then the failure, and leaves Leads when they are off', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      await gate;
      return workspaceReply(input, 'REQUEST_FAILED', 500);
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PipelineWorkspace kind="lead" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Loading the board…')).toBeTruthy();
    release?.();
    expect(await screen.findByText('The board could not be loaded.')).toBeTruthy();

    cleanup();
    router.replace.mockReset();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      Promise.resolve(workspaceReply(input, 'LEADS_DISABLED', 403)),
    );
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PipelineWorkspace kind="lead" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/dashboard');
    });
  });
});

const contactId = '00000000-0000-4000-8000-000000000030';
const tenantId = '00000000-0000-4000-8000-000000000040';

function renderCard(handlers: { onDelete?: () => void; onSave?: (patch: unknown) => void }): void {
  renderUi(
    <PipelineCardView
      card={sampleCard()}
      index={0}
      total={2}
      kind="lead"
      userId={userId}
      amountLabel="AMD"
      locale="en"
      onSave={handlers.onSave ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
      onConvert={vi.fn()}
    />,
  );
}

function renderColumn(handlers: {
  onDelete?: () => void;
  onConvertCard?: (cardId: string) => void;
  onSaveCard?: (cardId: string, patch: unknown) => void;
  onMoveCard?: (cardId: string) => void;
  canConfigure?: boolean;
}): void {
  const column: PipelineColumn = {
    id: '00000000-0000-4000-8000-000000000050',
    name: 'New',
    position: 0,
    widthPx: 300,
    cards: [
      sampleCard(),
      { ...sampleCard(), id: '00000000-0000-4000-8000-000000000011', title: 'Bo', position: 1 },
    ],
  };
  renderUi(
    <PipelineColumnView
      column={column}
      kind="lead"
      userId={userId}
      amountLabel="AMD"
      locale="en"
      onRename={vi.fn()}
      onResize={vi.fn(async () => undefined)}
      onDelete={handlers.onDelete ?? vi.fn()}
      onCreateCard={vi.fn()}
      onMoveCard={handlers.onMoveCard ?? vi.fn()}
      onDeleteCard={vi.fn()}
      onSaveCard={handlers.onSaveCard ?? vi.fn()}
      onConvertCard={handlers.onConvertCard ?? vi.fn()}
      canConfigure={handlers.canConfigure}
    />,
  );
}

function renderShell(): void {
  const session: SessionPrincipal = {
    user: { id: userId, name: 'Ada', role: 'OWNER', leadsEnabled: true },
    tenant: { id: tenantId },
  };
  renderUi(<ContactsShell session={session} current="dashboard" />);
}

function renderUi(node: ReactNode): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function sampleCard(): PipelineCard {
  return {
    id: cardId,
    title: 'Ada',
    company: 'Acme',
    amount: 10,
    position: 0,
    source: '',
    qualification: '',
    nextAction: '',
    lostReason: '',
    outcome: 'OPEN',
    priority: 'NORMAL',
    expectedCloseOn: null,
    contactId: null,
    ownerUserId: null,
    statusId: null,
    createdAt: '2026-10-06T09:30:00.000Z',
    createdByName: 'Ada',
    messageCount: 0,
    noteCount: 0,
  };
}

function contactRow(): Record<string, unknown> {
  return {
    id: contactId,
    name: 'Nare',
    type: 'person',
    email: null,
    phone: null,
    archivedAt: null,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    createdByUserId: userId,
    ownerUserId: userId,
    ownerName: 'Ada',
  };
}

function workspaceReply(input: RequestInfo | URL, code: string, status: number): Response {
  const path = new URL(String(input), 'http://localhost:3001').pathname;
  if (path.endsWith('/auth/session')) {
    return json({
      data: {
        user: { id: userId, name: 'Ada', role: 'OWNER', leadsEnabled: true },
        tenant: { id: tenantId },
      },
    });
  }
  return json({ error: { code } }, status);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
