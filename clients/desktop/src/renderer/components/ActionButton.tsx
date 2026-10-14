import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from '../api.js';

interface Props {
  /** What the button says, and its accessible name when it shows only the icon. */
  readonly label: string;
  /** What it says while the action runs: "Checking out…". */
  readonly pending: string;
  /** A toast once it worked: "Checked out suspension-v3". */
  readonly done?: string;
  /** Runs the action; resolves whether it worked (act() shows the error). */
  readonly run: () => Promise<boolean>;
  /** The branch is busy in the sync engine: the button waits for that too. */
  readonly busy?: boolean;
  readonly icon?: ReactNode;
  readonly iconOnly?: boolean;
  readonly variant?: 'primary' | 'secondary';
  readonly small?: boolean;
  readonly disabled?: boolean;
  readonly shortcut?: string;
  /** Asks first, in place: this sentence, then the same button again (the web's ActionButton `confirm`). */
  readonly confirm?: string;
}

/** A button that says what it's doing until the work is finished, then confirms it. */
export function ActionButton({ label, pending, done, run, busy = false, icon, iconOnly = false, variant = 'secondary', small = false, disabled = false, shortcut, confirm }: Props) {
  const [running, setRunning] = useState(false);
  const [asking, setAsking] = useState(false);
  // Started here: keep the pending label until the engine lets go of the branch.
  const started = useRef(false);
  useEffect(() => {
    if (!busy && !running) started.current = false;
  }, [busy, running]);

  const go = async () => {
    setAsking(false);
    started.current = true;
    setRunning(true);
    const ok = await run();
    setRunning(false);
    if (ok && done) toast(done);
  };

  if (asking) {
    return (
      <span className="confirm-inline" role="group" onKeyDown={(event) => event.key === 'Escape' && setAsking(false)}>
        <span className="confirm-text">{confirm}</span>
        <button type="button" className={`btn btn-${variant === 'primary' ? 'primary' : 'secondary'}${small ? ' btn-small' : ''}`} autoFocus onClick={() => void go()}>
          {label}
        </button>
        <button type="button" className={`btn btn-secondary${small ? ' btn-small' : ''}`} onClick={() => setAsking(false)}>
          Cancel
        </button>
      </span>
    );
  }

  const working = running || (busy && started.current);
  const text = working ? pending : label;
  const tooltip = iconOnly ? `${text}${shortcut ? ` (${shortcut})` : ''}` : shortcut ? `${label} (${shortcut})` : undefined;
  return (
    <button
      type="button"
      className={`btn btn-${variant}${small ? ' btn-small' : ''}${iconOnly ? ' btn-icon' : ''}`}
      disabled={disabled || running || busy}
      aria-busy={working}
      aria-label={iconOnly ? text : undefined}
      title={tooltip}
      onClick={() => (confirm ? setAsking(true) : void go())}
    >
      {icon ? <span className={`btn-glyph${working ? ' spin' : ''}`}>{icon}</span> : null}
      {iconOnly ? null : <span className="btn-label">{text}</span>}
    </button>
  );
}
