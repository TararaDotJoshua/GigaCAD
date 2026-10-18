import { describe, expect, it } from 'vitest';
import { modelFor, pickModels } from './models';

const stl = { format: 'stl' as const, sha256: 's'.repeat(64), size: 10 };
const step = { format: 'step' as const, sha256: 'p'.repeat(64), size: 20 };

describe('modelFor', () => {
  it('opens mesh and CAD files themselves', () => {
    expect(modelFor('parts/Wheel.stl', 'b', [], 5)).toEqual({ sha256: 'b', format: 'stl', size: 5 });
    expect(modelFor('Arm.STEP', 'b')).toEqual({ sha256: 'b', format: 'step' });
  });

  it('opens a SolidWorks file through its STL export, with the STEP export behind it', () => {
    expect(modelFor('Arm.SLDPRT', 'b', [step, stl])).toEqual({ sha256: stl.sha256, format: 'stl', source: 'stl', size: 10, fallback: { sha256: step.sha256, format: 'step' } });
    expect(modelFor('Arm.SLDASM', 'b', [step])).toEqual({ sha256: step.sha256, format: 'step', source: 'step', size: 20 });
  });

  it('has nothing to open for other files', () => {
    expect(modelFor('Arm.SLDPRT', 'b')).toBeNull();
    expect(modelFor('notes.txt', 'b', [stl])).toBeNull();
  });
});

describe('pickModels', () => {
  const main = { format: 'stl' as const, sha256: 'm'.repeat(64), size: 30 };
  it('compares mesh files directly, and SolidWorks files through an export both versions have', () => {
    expect(pickModels('Wheel.stl', 'b', 'a', {})).toEqual({ model: { sha256: 'b', format: 'stl' }, compare: { sha256: 'a', path: 'Wheel.stl' } });
    expect(pickModels('Wheel.stl', 'b', 'b', {})).toEqual({ model: { sha256: 'b', format: 'stl' } });
    expect(pickModels('Arm.SLDPRT', 'b', 'a', { b: [step, stl], a: [main] })).toEqual({
      model: { sha256: stl.sha256, format: 'stl', source: 'stl', size: 10 },
      compare: { sha256: main.sha256, path: 'Arm.SLDPRT', size: 30 },
    });
  });

  it('previews the branch alone when main has no matching export, and nothing without one', () => {
    expect(pickModels('Arm.SLDPRT', 'b', 'a', { b: [step], a: [main] })).toEqual({ model: { sha256: step.sha256, format: 'step', source: 'step', size: 20 } });
    expect(pickModels('Arm.SLDPRT', 'b', null, { b: [stl] })?.compare).toBeUndefined();
    expect(pickModels('Arm.SLDPRT', 'b', 'a', { a: [main] })).toBeNull();
  });
});
