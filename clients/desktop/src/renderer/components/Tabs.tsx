import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
}

/** A tab list; arrow keys, Home and End move between tabs, and the panel is labelled by its tab. */
export function Tabs<T extends string>({ tabs, value, onChange, children }: { tabs: readonly TabItem<T>[]; value: T; onChange: (tab: T) => void; children: ReactNode }) {
  const prefix = useId();
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent) => {
    const at = tabs.findIndex((tab) => tab.id === value);
    const next =
      event.key === 'ArrowRight' ? (at + 1) % tabs.length : event.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next]!.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <>
      <div className="tabs" role="tablist" ref={list} onKeyDown={move}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${prefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            aria-controls={`${prefix}-panel`}
            tabIndex={tab.id === value ? 0 : -1}
            className={`tab${tab.id === value ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="content" role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-tab-${value}`}>
        {children}
      </div>
    </>
  );
}
