import { describe, expect, it } from 'vitest';
import { previewFormat } from './preview';

describe('previewFormat', () => {
  it('knows the formats the browser can read', () => {
    expect(previewFormat('parts/bracket.STL')).toBe('stl');
    expect(previewFormat('a/b.step')).toBe('step');
    expect(previewFormat('a/b.STP')).toBe('step');
    expect(previewFormat('mesh.3mf')).toBe('3mf');
    expect(previewFormat('scan.obj')).toBe('obj');
    expect(previewFormat('old.igs')).toBe('iges');
  });

  it('leaves native CAD files to the add-in', () => {
    expect(previewFormat('Robot.SLDASM')).toBeNull();
    expect(previewFormat('P1.SLDPRT')).toBeNull();
    expect(previewFormat('notes.stl.txt')).toBeNull();
  });
});
