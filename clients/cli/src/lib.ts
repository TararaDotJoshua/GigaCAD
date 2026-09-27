/**
 * The CLI as a library, for GigaCAD Desktop. The app runs real `giga` command lines in its
 * own process with `run(argv, ctx)`, and shares the saved sign-in and machine name with the
 * terminal `giga`, so both identify this computer the same way for checkout locks.
 */
export { run, VERSION } from './cli.js';
export type { Context, OutputStream } from './context.js';
export { Api, type BranchView, type BranchDetail, type ProjectSummary, type ReleaseView, type Profile } from './api.js';
export { configDir, DEFAULT_API_URL, loadConfig, machineName, normalizeApiUrl, type Credentials } from './config.js';
export { openSession, type Session } from './session.js';
export { findWorkspace, type Workspace, type WorkspaceState } from './workspace.js';
export { findRootWorkspace, type RootState } from './rootWorkspace.js';
