/**
 * On Windows, gigacad:// links and File Explorer's GigaCAD menu start the app (or wake the running
 * one through `second-instance`) with arguments rather than macOS's open-url event:
 *
 *   GigaCAD.exe gigacad://action/checkout?path=…        a link from a browser
 *   GigaCAD.exe --action checkout "C:\\…\\Branches\\dev"   the right-click menu (paths aren't URL-safe)
 *
 * Both become the same gigacad:// link the Quick Actions use, for Controller.handleUrl.
 * Chromium may insert its own switches anywhere, so the arguments are searched, not indexed.
 */
export function actionUrlFromArgv(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf('--action');
  if (flag >= 0) {
    const action = argv[flag + 1];
    const path = argv[flag + 2];
    if (action && path && !action.startsWith('-')) return `gigacad://action/${encodeURIComponent(action)}?path=${encodeURIComponent(path)}`;
    return undefined;
  }
  return argv.find((arg) => /^gigacad:\/\//i.test(arg));
}
