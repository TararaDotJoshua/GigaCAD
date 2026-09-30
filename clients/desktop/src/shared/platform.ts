// What things are called on each system, for text the main process and the window show.

export interface PlatformWords {
  /** "this Mac" / "this PC" */
  readonly thisComputer: string;
  /** "Finder" / "File Explorer" */
  readonly fileManager: string;
  /** "Show in Finder" / "Show in File Explorer" */
  readonly showInFileManager: string;
  /** "Finder’s right-click menu" / "the File Explorer right-click menu" */
  readonly rightClickMenu: string;
  /** "Terminal" / "the terminal" */
  readonly terminal: string;
}

export function platformWords(platform: string): PlatformWords {
  if (platform === 'win32') {
    return {
      thisComputer: 'this PC',
      fileManager: 'File Explorer',
      showInFileManager: 'Show in File Explorer',
      rightClickMenu: 'the File Explorer right-click menu',
      terminal: 'the terminal',
    };
  }
  return {
    thisComputer: 'this Mac',
    fileManager: 'Finder',
    showInFileManager: 'Show in Finder',
    rightClickMenu: 'Finder’s right-click menu',
    terminal: 'Terminal',
  };
}
