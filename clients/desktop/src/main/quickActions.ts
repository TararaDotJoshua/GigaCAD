import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Finder Quick Actions (right-click → Quick Actions). Each one hands the selection to the app. */
export const QUICK_ACTIONS = [
  { title: 'Check Out', action: 'checkout', image: 'NSLockUnlockedTemplate' },
  { title: 'Check In', action: 'checkin', image: 'NSLockLockedTemplate' },
  { title: 'Commit Version…', action: 'commit', image: 'NSAddTemplate' },
  { title: 'Pull Latest', action: 'pull', image: 'NSRefreshTemplate' },
  { title: 'Download', action: 'download', image: 'NSFolder' },
  { title: 'Copy Link', action: 'copy-link', image: 'NSShareTemplate' },
  { title: 'Open on gigacad.site', action: 'open-web', image: 'NSFollowLinkFreestandingTemplate' },
  { title: 'Show in GigaCAD', action: 'show', image: 'NSApplicationIcon' },
] as const;

export type QuickAction = (typeof QUICK_ACTIONS)[number]['action'];

export const servicesDir = () => join(homedir(), 'Library', 'Services');
const workflowName = (title: string) => `GigaCAD: ${title}.workflow`;
const menuTitle = (title: string) => `GigaCAD: ${title}`;
/** Written into each workflow, so a newer app knows when to rewrite them. */
const VERSION_FILE = 'gigacad-version';

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The shell script a Quick Action runs. It only URL-encodes the first selected path (with the
 * built-in osascript, since python isn't on every Mac) and opens a gigacad:// link, so it
 * depends on nothing outside macOS and the app.
 */
export function commandFor(action: QuickAction): string {
  return [
    `p=$(/usr/bin/osascript -l JavaScript -e 'function run(argv) { return encodeURIComponent(argv[0]) }' "$1")`,
    `/usr/bin/open -g "gigacad://action/${action}?path=$p"`,
  ].join('\n');
}

export function infoPlist(title: string, image: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>${xml(image)}</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${xml(menuTitle(title))}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
}

/** An Automator "Run Shell Script" workflow that receives files and folders from Finder as arguments. */
export function documentWflow(command: string, image: string): string {
  const uuid = () => crypto.randomUUID().toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>534</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${xml(command)}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>${uuid()}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>${uuid()}</string>
				<key>UUID</key>
				<string>${uuid()}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>1</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>2</string>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>3</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>4</string>
					</dict>
				</dict>
				<key>conversionLabel</key>
				<integer>0</integer>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationBundleIDsByPath</key>
		<dict>
			<key>/System/Library/CoreServices/Finder.app</key>
			<string>com.apple.finder</string>
		</dict>
		<key>applicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>applicationPaths</key>
		<array>
			<string>/System/Library/CoreServices/Finder.app</string>
		</array>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>${xml(image)}</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}

/** The key macOS stores a service's on/off state under in the `pbs` defaults. */
export const serviceStatusKey = (title: string) => `(null) - ${menuTitle(title)} - runWorkflowAsService`;

/** Turns a Quick Action on in Finder's right-click menu and preview pane (new ones start off). */
export const SERVICE_STATUS = '{ "presentation_modes" = { ContextMenu = 1; FinderPreview = 1; ServicesMenu = 1; TouchBar = 0; }; }';

/** Whether this version's Quick Actions are all in place. */
export function quickActionsInstalled(version: string, dir = servicesDir()): boolean {
  return QUICK_ACTIONS.every(({ title }) => {
    const marker = join(dir, workflowName(title), 'Contents', VERSION_FILE);
    return existsSync(marker) && readFileSync(marker, 'utf8').trim() === version;
  });
}

/** Writes every Quick Action, turns them on, and asks macOS to reload its services. */
export async function installQuickActions(version: string, dir = servicesDir()): Promise<void> {
  for (const { title, action, image } of QUICK_ACTIONS) {
    const contents = join(dir, workflowName(title), 'Contents');
    await rm(join(dir, workflowName(title)), { recursive: true, force: true });
    await mkdir(contents, { recursive: true });
    await writeFile(join(contents, 'Info.plist'), infoPlist(title, image));
    await writeFile(join(contents, 'document.wflow'), documentWflow(commandFor(action), image));
    await writeFile(join(contents, VERSION_FILE), `${version}\n`);
  }
  if (dir !== servicesDir()) return;
  for (const { title } of QUICK_ACTIONS) {
    await run('/usr/bin/defaults', ['write', 'pbs', 'NSServicesStatus', '-dict-add', serviceStatusKey(title), SERVICE_STATUS]);
  }
  await run('/System/Library/CoreServices/pbs', ['-update']).catch(() => undefined);
}

/** Parses a gigacad://action/<name>?path=<encoded> link. */
export function parseActionUrl(url: string): { action: QuickAction; path: string } | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'gigacad:' || parsed.hostname !== 'action') return undefined;
    const action = parsed.pathname.replace(/^\//, '') as QuickAction;
    const path = parsed.searchParams.get('path');
    if (!path || !QUICK_ACTIONS.some((candidate) => candidate.action === action)) return undefined;
    return { action, path };
  } catch {
    return undefined;
  }
}
