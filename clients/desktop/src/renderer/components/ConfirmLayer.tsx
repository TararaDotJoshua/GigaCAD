import { useEffect, useRef } from 'react';
import { ask, useQuestion } from '../confirm.js';

/** The question from a right-click menu, at the pointer. Escape or a click outside cancels. */
export function ConfirmLayer() {
  const question = useQuestion();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!question) return;
    const onDown = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) ask(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && ask(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [question]);
  if (!question) return null;
  // Keep it on screen: it opens below and right of the pointer, or above and left near the edges.
  const style = {
    left: Math.max(8, Math.min(question.x, window.innerWidth - 328)),
    top: question.y + 160 > window.innerHeight ? Math.max(8, question.y - 140) : question.y,
  };
  return (
    <div className="popover confirm-popover" style={style} ref={panel} role="alertdialog" aria-label={question.sentence}>
      <div className="popover-body">
        <p>{question.sentence}</p>
        <div className="confirm-buttons">
          <button
            type="button"
            className={`btn btn-small ${question.danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
            onClick={() => {
              ask(null);
              question.onConfirm();
            }}
          >
            {question.label}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => ask(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
