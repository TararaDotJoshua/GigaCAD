import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseCollisions, hashFile, listWorkingFiles } from '../src/scan.js';
import { workspacePath } from '../src/workspace.js';
import { tempDir } from './context.js';

async function tree(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), content);
  }
  return root;
}

const paths = async (root: string, tracked: string[] = []) => (await listWorkingFiles(root, tracked)).map((file) => file.path).sort();

describe('working tree scan', () => {
  it('skips .giga, CAD temp files, OS clutter, and .gigaignore patterns', async () => {
    const root = await tree({
      'Robot.SLDASM': 'asm',
      'parts/P1.SLDPRT': 'p1',
      'parts/~$P1.SLDPRT': 'lock',
      'parts/Backup of P1.SLDPRT': 'backup',
      '.DS_Store': 'x',
      '.giga/workspace.json': '{}',
      'renders/out.png': 'png',
      'notes.txt': 'n',
      '.gigaignore': 'renders/\n*.txt\n',
    });
    expect(await paths(root)).toEqual(['.gigaignore', 'parts/P1.SLDPRT', 'Robot.SLDASM'].sort());
  });

  it('keeps tracked files even when an ignore rule matches them', async () => {
    const root = await tree({ 'notes.txt': 'n', '.gigaignore': '*.txt\n' });
    expect(await paths(root, ['notes.txt'])).toEqual(['.gigaignore', 'notes.txt']);
  });

  it('rejects symbolic links unless they are ignored', async () => {
    const root = await tree({ 'A.SLDPRT': 'a' });
    await symlink(join(root, 'A.SLDPRT'), join(root, 'link.SLDPRT'));
    await expect(listWorkingFiles(root)).rejects.toMatchObject({ code: 'symlinks_not_supported', details: { paths: ['link.SLDPRT'] } });

    await writeFile(join(root, '.gigaignore'), 'link.SLDPRT\n');
    expect(await paths(root)).toEqual(['.gigaignore', 'A.SLDPRT']);
  });

  it('rejects names Windows cannot store', async () => {
    const root = await tree({ 'what?.SLDPRT': 'a', 'ok.SLDPRT': 'b' });
    await expect(listWorkingFiles(root)).rejects.toMatchObject({ code: 'invalid_file_names', details: { paths: ['what?.SLDPRT'] } });
  });

  it('finds paths that differ only in case', () => {
    expect(caseCollisions(['parts/P1.SLDPRT', 'Parts/p1.sldprt', 'P2.SLDPRT'])).toEqual(['parts/P1.SLDPRT', 'Parts/p1.sldprt']);
    expect(caseCollisions(['a', 'b'])).toEqual([]);
  });

  it('hashes files as SHA-256', async () => {
    const root = await tree({ 'a.txt': 'hello' });
    expect(await hashFile(join(root, 'a.txt'))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describe('workspace paths', () => {
  it('turns user paths into normalized workspace paths and refuses escapes', () => {
    const root = '/work/robot';
    expect(workspacePath(root, '/work/robot/parts', 'P1.SLDPRT')).toBe('parts/P1.SLDPRT');
    expect(workspacePath(root, '/work/robot', './parts//P2.SLDPRT')).toBe('parts/P2.SLDPRT');
    expect(() => workspacePath(root, '/work/robot', '../other/x')).toThrow(/not inside the workspace/);
    expect(() => workspacePath(root, '/work/robot', '.')).toThrow(/not inside the workspace/);
    expect(() => workspacePath(root, '/work/robot', '.giga/workspace.json')).toThrow(/\.giga/);
  });
});
