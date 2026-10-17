import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { MoreIcon } from '../icons.js';

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  /** Asks first, with this sentence, for actions that lose something (desktop UX plan phase 7). */
  readonly confirm?: string;
}

/** A ⋯ button with a short list of less common actions. Items that are null are left out. */
export function MoreMenu({ label = 'More actions', items }: { label?: string; items: readonly (MenuItem | null | false | undefined)[] }) {
  const shown = items.filter((item): item is MenuItem => Boolean(item));
  return (
    <Popover
      label={label}
      trigger={<MoreIcon className="icon" />}
      triggerClass="btn btn-secondary btn-icon"
      role="menu"
      render={(close) => <MenuList label={label} items={shown} close={close} />}
    />
  );
}

/** The menu's items; one that needs confirming turns the menu into its question, in place. */
function MenuList({ label, items, close }: { label: string; items: readonly MenuItem[]; close: () => void }) {
  const [asking, setAsking] = useState<MenuItem | null>(null);
  if (asking) {
    return (
      <div className="popover-body" role="alertdialog" aria-label={asking.confirm}>
        <p>{asking.confirm}</p>
        <div className="confirm-buttons">
          <button
            type="button"
            className={`btn btn-small ${asking.danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
            onClick={() => {
              close();
              asking.onSelect();
            }}
          >
            {asking.label}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
        <ul className="menu" role="menu" aria-label={label} onKeyDown={moveFocus}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`menu-item${item.danger ? ' is-danger' : ''}`}
                onClick={() => {
                  if (item.confirm) return setAsking(item);
                  close();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
  );
}

/** Arrow keys move between a menu's items. */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
}

interface PopoverProps {
  readonly label: string;
  readonly trigger: ReactNode;
  readonly triggerClass: string;
  readonly role?: 'menu' | 'dialog';
  readonly render: (close: () => void) => ReactNode;
  /** The tooltip, when it should say more than the label. */
  readonly title?: string;
}

/** A button that opens a panel under it. Escape, a click outside, or choosing closes it. */
export function Popover({ label, trigger, triggerClass, role = 'dialog', render, title }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the first thing inside, so the keyboard can carry on from the button.
    root.current?.querySelector<HTMLElement>('.popover button, .popover a')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="popover-root" ref={root}>
      <button
        ref={button}
        type="button"
        className={triggerClass}
        aria-label={label}
        title={title ?? label}
        aria-haspopup={role}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open ? <div className="popover">{render(() => setOpen(false))}</div> : null}
    </div>
  );
}
