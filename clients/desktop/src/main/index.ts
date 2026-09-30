// The code bundle's entry point, started by the bootstrap (src/bootstrap/index.ts).
import { app, ipcMain } from 'electron';
import { COMMAND_NAMES, type CommandName, type CommandResult } from '../shared/types.js';
import { Controller } from './controller.js';
import { GigaError } from './cli.js';

app.setName('GigaCAD');
const runtime = globalThis.__gigacad;

if (!runtime || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: Controller | undefined;
  const waiting: string[] = [];

  // Quick Actions open gigacad:// links. They can arrive before the app is ready.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (controller) void controller.handleUrl(url);
    else waiting.push(url);
  });
  app.on('second-instance', () => controller?.showWindow());
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
