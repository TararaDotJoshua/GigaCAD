import { act, dismissToast, pauseToast, resumeToast, toast, useToasts } from '../api.js';

/** Bottom-right messages. They pause while pointed at or focused; Escape or × closes one. */
export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`toast${item.error ? ' is-error' : ''}`}
          role={item.error ? 'alert' : 'status'}
          onMouseEnter={() => pauseToast(item.id)}
          onMouseLeave={() => resumeToast(item.id)}
          onFocus={() => pauseToast(item.id)}
          onBlur={() => resumeToast(item.id)}
          onKeyDown={(event) => event.key === 'Escape' && dismissToast(item.id)}
        >
          <div className="toast-body">
            <div>{item.text}</div>
            {item.hint ? <div className="hint">{item.hint}</div> : null}
            {item.error ? (
              <button
                type="button"
                className="link"
                onClick={() => void act('copyText', item.hint ? `${item.text}\n${item.hint}` : item.text).then((ok) => ok && toast('Error copied'))}
              >
                Copy error
              </button>
            ) : null}
          </div>
          <button type="button" className="toast-close" aria-label="Close" onClick={() => dismissToast(item.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
