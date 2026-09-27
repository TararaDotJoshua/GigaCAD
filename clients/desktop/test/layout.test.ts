import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { locate, treeUrl, webUrlFor } from '../src/main/layout.js';

const folder = '/Users/alex/GigaCAD';
const app = 'https://app.gigacad.site';

describe('locate', () => {
  it('names each level of the GigaCAD folder', () => {
    expect(locate(folder, folder)).toMatchObject({ area: 'folder' });
    expect(locate(folder, join(folder, 'alex'))).toMatchObject({ area: 'owner', owner: 'alex' });
    expect(locate(folder, join(folder, 'alex', 'arm'))).toMatchObject({ area: 'project-root', owner: 'alex', project: 'arm', inner: '' });
    expect(locate(folder, join(folder, 'alex', 'arm', 'Branches'))).toMatchObject({ area: 'branches' });
    expect(locate(folder, join(folder, 'alex', 'arm', 'Releases'))).toMatchObject({ area: 'releases' });
  });

  it('finds root files, branches, and releases with their inner paths', () => {
    expect(locate(folder, join(folder, 'alex', 'arm', 'Quotes', 'steel.pdf'))).toMatchObject({
      area: 'project-root',
      inner: 'Quotes/steel.pdf',
      projectPath: 'Quotes/steel.pdf',
    });
    expect(locate(folder, join(folder, 'alex', 'arm', 'Branches', 'gripper', 'parts', 'Arm.SLDPRT'))).toMatchObject({
      area: 'branch',
      name: 'gripper',
      areaDir: join(folder, 'alex', 'arm', 'Branches', 'gripper'),
      inner: 'parts/Arm.SLDPRT',
      projectPath: 'Branches/gripper/parts/Arm.SLDPRT',
    });
    expect(locate(folder, join(folder, 'alex', 'arm', 'Releases', 'v3', 'Arm.SLDASM'))).toMatchObject({ area: 'release', releaseNumber: 3, inner: 'Arm.SLDASM' });
  });

  it('treats an oddly named folder in Releases as the Releases folder', () => {
    expect(locate(folder, join(folder, 'alex', 'arm', 'Releases', 'notes'))).toMatchObject({ area: 'releases' });
  });

  it('ignores paths outside the folder', () => {
    expect(locate(folder, '/Users/alex/Desktop/x.txt')).toBeUndefined();
    expect(locate(folder, '/Users/alex/GigaCAD-old/x')).toBeUndefined();
  });
});

describe('web links', () => {
  it('builds tree links like the web app, encoding each segment', () => {
    expect(treeUrl(app, 'alex', 'arm', '')).toBe(`${app}/alex/arm`);
    expect(treeUrl(app, 'alex', 'arm', 'Shop drawings/Laser')).toBe(`${app}/alex/arm/tree/Shop%20drawings/Laser`);
  });

  it('links a file to the folder holding it', () => {
    const file = locate(folder, join(folder, 'alex', 'arm', 'Branches', 'gripper', 'parts', 'Arm.SLDPRT'))!;
    expect(webUrlFor(app, file, true)).toBe(`${app}/alex/arm/tree/Branches/gripper/parts`);
    const top = locate(folder, join(folder, 'alex', 'arm', 'README.txt'))!;
    expect(webUrlFor(app, top, true)).toBe(`${app}/alex/arm`);
    const dir = locate(folder, join(folder, 'alex', 'arm', 'Releases', 'v2'))!;
    expect(webUrlFor(app, dir, false)).toBe(`${app}/alex/arm/tree/Releases/v2`);
    expect(webUrlFor(app, locate(folder, folder)!, false)).toBeUndefined();
  });
});
