import { dismissToast, useToasts } from '../api.js';

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast${item.error ? ' is-error' : ''}`} role={item.error ? 'alert' : 'status'} onClick={() => dismissToast(item.id)}>
          <div>{item.text}</div>
          {item.hint ? <div className="hint">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}
