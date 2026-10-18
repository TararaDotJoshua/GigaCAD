import { describe, expect, it } from 'vitest';
import {
  CONFIRM_PREVIEW_BYTES,
  MAX_PREVIEW_BYTES,
  PreviewError,
  confirmMessage,
  contentProblem,
  exportFilename,
  isFileProblem,
  isSolidWorks,
  previewFormat,
  previewGate,
  previewMessage,
  sniffContent,
} from './preview';

const text = (value: string) => new TextEncoder().encode(value);

function binaryStl(triangles: number, header = 'binary'): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * triangles);
  bytes.set(text(header));
  new DataView(bytes.buffer).setUint32(80, triangles, true);
  return bytes;
}

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

describe('exportFilename', () => {
  it('names an export after its SolidWorks file', () => {
    expect(exportFilename('parts/Bracket.SLDPRT', 'step')).toBe('Bracket.step');
    expect(exportFilename('Robot.v2.SLDASM', 'stl')).toBe('Robot.v2.stl');
    expect(isSolidWorks('a/Sheet.slddrw')).toBe(true);
    expect(isSolidWorks('a/part.step')).toBe(false);
  });
});

describe('previewGate', () => {
  it('previews small and unknown sizes straight away', () => {
    expect(previewGate(undefined, false)).toBe('ok');
    expect(previewGate(Number.NaN, false)).toBe('ok');
    expect(previewGate(2_000_000, false)).toBe('ok');
    expect(previewGate(CONFIRM_PREVIEW_BYTES, false)).toBe('ok');
  });

  it('asks before large files and refuses ones over the limit', () => {
    expect(previewGate(CONFIRM_PREVIEW_BYTES + 1, false)).toBe('confirm');
    expect(previewGate(CONFIRM_PREVIEW_BYTES + 1, true)).toBe('ok');
    expect(previewGate(MAX_PREVIEW_BYTES, true)).toBe('ok');
    expect(previewGate(MAX_PREVIEW_BYTES + 1, true)).toBe('too-large');
    expect(previewGate(MAX_PREVIEW_BYTES + 1, false)).toBe('too-large');
  });
});

describe('sniffContent', () => {
  it('recognises STEP, binary and text STL, IGES and ZIP', () => {
    expect(sniffContent(text('ISO-10303-21;\nHEADER;'))).toBe('step');
    expect(sniffContent(text('﻿  ISO-10303-21;\n'))).toBe('step');
    expect(sniffContent(text('solid part\n facet normal 0 0 1\n'))).toBe('stl');
    expect(sniffContent(binaryStl(3))).toBe('stl');
    expect(sniffContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('zip');
    expect(sniffContent(text(`${'Made by a CAD tool'.padEnd(72)}S      1\n${' '.repeat(72)}G      1\n`))).toBe('iges');
  });

  it('reads a binary STL by its size even when its header says "solid"', () => {
    expect(sniffContent(binaryStl(2, 'solid SolidWorks export'))).toBe('stl');
  });

  it('says nothing about files without a signature', () => {
    expect(sniffContent(text('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'))).toBeNull();
    expect(sniffContent(text(`# ${'An OBJ comment that happens to be long enough'.padEnd(70)}Something else\n`))).toBeNull();
    expect(sniffContent(new Uint8Array(0))).toBeNull();
  });
});

describe('contentProblem', () => {
  it('calls an empty file empty', () => {
    expect(contentProblem(new Uint8Array(0), 'stl')?.problem).toBe('empty');
  });

  it('catches an export holding a different format', () => {
    const problem = contentProblem(text('ISO-10303-21;\n'), 'stl');
    expect(problem?.problem).toBe('mismatch');
    expect(problem?.detail.actual).toBe('step');
    expect(contentProblem(binaryStl(1), 'step')?.detail.actual).toBe('stl');
  });

  it('needs a 3MF to be a ZIP archive', () => {
    expect(contentProblem(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), '3mf')).toBeNull();
    expect(contentProblem(text('not a zip at all'), '3mf')?.problem).toBe('unreadable');
    expect(contentProblem(text('solid x\n'), '3mf')?.problem).toBe('mismatch');
  });

  it('leaves files that match, or say nothing, to their parsers', () => {
    expect(contentProblem(binaryStl(1), 'stl')).toBeNull();
    expect(contentProblem(text('v 0 0 0\nf 1 1 1\n'), 'obj')).toBeNull();
    expect(contentProblem(text('garbage'), 'stl')).toBeNull();
  });
});

describe('previewMessage', () => {
  it('says plainly what went wrong with the file', () => {
    expect(previewMessage(new PreviewError('empty'), 'stl')).toBe('This file is empty.');
    expect(previewMessage(new PreviewError('unreadable'), 'stl')).toBe('This STL file couldn’t be read. It may be damaged.');
    expect(previewMessage(new PreviewError('unreadable'), '3mf')).toBe('This 3MF file couldn’t be read. It may be damaged.');
    expect(previewMessage(new PreviewError('no-geometry'), 'obj')).toBe('This file has no geometry to show.');
    expect(previewMessage(new PreviewError('mismatch', { actual: 'step' }), 'stl')).toBe('This file isn’t really an STL file. It looks like a STEP file.');
    expect(previewMessage(new PreviewError('mismatch', { actual: 'zip' }), 'iges')).toBe('This file isn’t really an IGES file. It looks like a ZIP archive.');
    expect(previewMessage(new PreviewError('mismatch', { actual: 'step' }), 'stl', true)).toBe('This STL export isn’t really an STL file. It looks like a STEP file.');
  });

  it('says when the file is a SolidWorks file’s export', () => {
    expect(previewMessage(new PreviewError('empty'), 'stl', true)).toBe('This STL export is empty.');
    expect(previewMessage(new PreviewError('unreadable'), 'step', true)).toBe('This STEP export couldn’t be read. It may be damaged.');
    expect(previewMessage(new PreviewError('too-large', { size: 160 * 1024 * 1024 }), 'stl', true)).toBe('This STL export is 160 MB, too large to preview. Download it instead.');
  });

  it('gives the size of files too large to preview', () => {
    expect(previewMessage(new PreviewError('too-large', { size: 157 * 1024 * 1024 }), 'stl')).toBe('This file is 157 MB, too large to preview. Download it instead.');
    expect(previewMessage(new PreviewError('too-large'), 'stl')).toBe('This file is too large to preview. Download it instead.');
  });

  it('covers the CAD reader and the download', () => {
    expect(previewMessage(new PreviewError('reader-timeout'), 'step')).toBe('The CAD reader stopped responding. Download the file instead.');
    expect(previewMessage(new PreviewError('reader'), 'iges')).toBe('The CAD reader failed to load. Download the file instead.');
    expect(previewMessage(new PreviewError('download', { message: 'This file is not available.' }), 'stl')).toBe('This file is not available.');
    expect(previewMessage(new PreviewError('download'), 'stl')).toBe('The file couldn’t be loaded.');
  });

  it('never shows a raw exception', () => {
    expect(previewMessage(new RangeError('Offset is outside the bounds of the DataView'), 'stl')).toBe('The preview failed. Download the file instead.');
    expect(previewMessage(new Error('Error creating WebGL context.'), 'stl')).toBe('This browser can’t show 3D previews. Download the file instead.');
    expect(previewMessage('nope', 'stl')).toBe('The preview failed. Download the file instead.');
  });
});

describe('isFileProblem', () => {
  it('tries the fallback only when the file itself is the problem', () => {
    expect(isFileProblem(new PreviewError('unreadable'))).toBe(true);
    expect(isFileProblem(new PreviewError('mismatch'))).toBe(true);
    expect(isFileProblem(new PreviewError('too-large'))).toBe(true);
    expect(isFileProblem(new PreviewError('download'))).toBe(false);
    expect(isFileProblem(new PreviewError('reader-timeout'))).toBe(false);
    expect(isFileProblem(new Error('unreadable'))).toBe(false);
  });
});

describe('confirmMessage', () => {
  it('gives the size before a long load', () => {
    expect(confirmMessage(125 * 1024 * 1024, 'stl')).toBe('This file is 125 MB. Previewing it may take a while.');
    expect(confirmMessage(60 * 1024 * 1024, 'stl', true)).toBe('This STL export is 60 MB. Previewing it may take a while.');
  });
});
