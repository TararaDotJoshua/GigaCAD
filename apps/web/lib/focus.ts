/**
 * Keyboard focus across refreshes. An action's refresh often removes the control that ran it
 * (a member's row, a renamed file's row, a "Build candidate" button), and the browser then
 * drops focus to the page, so keyboard users start over from the top.
 */

const lost = () => !document.activeElement || document.activeElement === document.body;

/** Focuses an element that isn't normally focusable, like a heading, without adding it to the tab order. */
function focusQuietly(element: HTMLElement) {
  if (!element.matches('a[href], button, input, select, textarea, [tabindex]')) element.tabIndex = -1;
  element.focus();
}

/**
 * Call while `element` holds focus and is about to be removed. Once it's gone, focus moves
 * to the heading of the nearest section still on the page.
 */
export function keepFocusNear(element: Element): void {
  const ancestors: Element[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) ancestors.push(node);
  setTimeout(() => {
    if (!lost()) return;
    const scope = ancestors.find((node) => node.isConnected && node.matches('section, aside, [role="region"], main')) ?? document.getElementById('main');
    const heading = scope?.querySelector<HTMLElement>('h1, h2, h3') ?? document.querySelector<HTMLElement>('#main h1');
    if (heading) focusQuietly(heading);
  }, 0);
}

/**
 * Focuses what `find` returns once `stale` (the element focus was in) has left the page, for
 * example a renamed file's new row once the list refreshes. Gives up after a few seconds, or
 * if focus has gone somewhere else in the meantime.
 */
export function focusAfterRefresh(find: () => HTMLElement | null, stale: Element | null, timeoutMs = 4000): void {
  const attempt = () => {
    if (stale?.isConnected) return false;
    if (!lost()) return true;
    const target = find();
    if (!target) return false;
    focusQuietly(target);
    return true;
  };
  if (attempt()) return;
  const observer = new MutationObserver(() => {
    if (attempt()) stop();
  });
  const timer = setTimeout(() => stop(), timeoutMs);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(document.body, { childList: true, subtree: true });
}
