// The code bundle's entry point, started by the bootstrap (src/bootstrap/index.ts).
import { app, ipcMain } from 'electron';
import { COMMAND_NAMES, type CommandName, type CommandResult } from '../shared/types.js';
import { Controller } from './controller.js';
import { GigaError } from './cli.js';
import { actionUrlFromArgv } from './launchArgs.js';

app.setName('GigaCAD');
// Windows ties notifications and taskbar entries to this id; it matches appId in electron-builder.yml.
if (process.platform === 'win32') app.setAppUserModelId('site.gigacad.desktop');
const runtime = globalThis.__gigacad;

if (!runtime || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: Controller | undefined;
  const waiting: string[] = [];
  const handle = (url: string) => {
    if (controller) void controller.handleUrl(url);
    else waiting.push(url);
  };

  // macOS: Quick Actions and links open gigacad:// URLs, which can arrive before the app is ready.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handle(url);
  });
  // Windows: links and the right-click menu start the app with arguments (launchArgs.ts). The
  // first launch reads its own; later ones reach this instance as second-instance.
  const launchUrl = process.platform === 'win32' ? actionUrlFromArgv(process.argv) : undefined;
  if (launchUrl) waiting.push(launchUrl);
  app.on('second-instance', (_event, argv) => {
    const url = process.platform === 'win32' ? actionUrlFromArgv(argv) : undefined;
    if (url) handle(url);
    else controller?.showWindow();
  });
  app.on('activate', () => controller?.showWindow());
  // A stray error in a background task (a dropped connection, say) shouldn't stop syncing or put
  // up Electron's modal error dialog. It goes to the activity list instead.
  const report = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    console.error('GigaCAD:', error);
    controller?.log(`Something went wrong: ${text}`);
  };
  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);
  // The app keeps syncing from the menu bar when its window is closed.
  app.on('window-all-closed', () => undefined);

  ipcMain.handle('gigacad:command', async (_event, name: CommandName, args: unknown[]): Promise<CommandResult<unknown>> => {
    if (!controller || !COMMAND_NAMES.includes(name)) return { ok: false, error: { code: 'unavailable', message: 'GigaCAD is still starting' } };
    try {
      return { ok: true, value: await controller.run(name, Array.isArray(args) ? args : []) };
    } catch (error) {
      if (error instanceof GigaError) return { ok: false, error: { code: error.code, message: error.message, hint: error.hint } };
      return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
    }
  });

  void app.whenReady().then(async () => {
    try {
      controller = await Controller.create(runtime);
    } catch (error) {
      // An update that can't start goes back to the previous version.
      if (globalThis.__gigacadStartFailed) globalThis.__gigacadStartFailed(error);
      else throw error;
      return;
    }
    for (const url of waiting.splice(0)) void controller.handleUrl(url);
  });
}
