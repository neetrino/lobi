'use client';

import { X } from 'lucide-react';
import type { FormEventHandler, ReactNode } from 'react';

import { useSheetDismiss } from '../overlay/sheet-dismiss';
import styles from './side-sheet.module.css';

/** Right-hand sheet with the notched corner and circular close button. */
export function SheetFrame({
  label,
  closeLabel,
  onClose,
  className,
  frameClassName,
  children,
}: {
  label: string;
  closeLabel: string;
  onClose?: () => void;
  className?: string;
  frameClassName?: string;
  children: ReactNode;
}): ReactNode {
  const dismiss = useSheetDismiss(onClose ?? noop);
  const surface = className === undefined ? styles.surface : `${styles.surface} ${className}`;
  const frame =
    frameClassName === undefined ? styles.frame : `${styles.frame} ${frameClassName}`;
  return (
    <div
      className={frame}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={styles.cornerClose}
        aria-label={closeLabel}
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </button>
      <div className={surface}>{children}</div>
    </div>
  );
}

/** Shared New-reservation layout: titled header, scroll body, optional footer. */
export function SheetChrome({
  title,
  headerAction,
  footer,
  children,
  as = 'div',
  onSubmit,
}: {
  title: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  as?: 'div' | 'form' | 'aside' | 'section';
  onSubmit?: FormEventHandler<HTMLFormElement>;
}): ReactNode {
  const inner = (
    <>
      <header className={styles.head}>
        <h2>{title}</h2>
        {headerAction}
      </header>
      <div className={styles.body}>{children}</div>
      {footer === undefined ? null : <div className={styles.foot}>{footer}</div>}
    </>
  );
  if (as === 'form') {
    return (
      <form className={styles.form} onSubmit={onSubmit}>
        {inner}
      </form>
    );
  }
  const Tag = as;
  return <Tag className={styles.form}>{inner}</Tag>;
}

export const sheetStyles = styles;

function noop(): void {
  return undefined;
}
