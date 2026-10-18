import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';
import { describe, expect, it } from 'vitest';
import { combine, parseModel, read3mf } from './viewer-3mf';

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** One triangle in the XY plane, as object `id`. */
const triangle = (id: string, extra = '') => `
  <object id="${id}" type="model"${extra}>
    <mesh>
      <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x='0' y='1' z='0' /></vertices>
      <triangles><triangle v1="0" v2="1" v3="2" pid="1" p1="0"/></triangles>
    </mesh>
  </object>`;

const model = (resources: string, build: string) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <!-- written by a test -->
  <resources>${resources}</resources>
  <build>${build}</build>
</model>`;

const archive = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));

describe('parseModel', () => {
  it('reads objects, components and build items', () => {
    const part = parseModel(
      model(
        `${triangle('1')}<object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>`,
        '<item objectid="2"/>',
      ),
    );
    expect([...part.objects.keys()]).toEqual(['1', '2']);
    expect(part.objects.get('1')).toMatchObject({ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] });
    expect(part.objects.get('2')?.components[0]).toMatchObject({ objectId: '1', transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 0] });
    expect(part.items).toEqual([{ objectId: '2', path: undefined, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }]);
  });

  it('ignores vertices outside an object’s mesh, like the slice extension’s', () => {
    const part = parseModel(model(`<s:slicestack id="9"><s:slice ztop="1"><s:vertices><s:vertex x="4" y="4"/></s:vertices></s:slice></s:slicestack>${triangle('1')}`, ''));
    expect(part.objects.get('1')?.vertices).toHaveLength(9);
  });
});

describe('combine', () => {
  it('applies the first transform, then the second', () => {
    const scale = [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0];
    const move = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
    // Scale then move: x' = 2x + 10. Move then scale: x' = 2(x + 10).
    expect(combine(scale, move)).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2, 10, 0, 0]);
    expect(combine(move, scale)).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2, 20, 0, 0]);
  });
});

describe('read3mf', () => {
  it('places each build item with its transform', () => {
    const bytes = archive({
      '_rels/.rels': RELS,
      '3D/3dmodel.model': model(triangle('1'), '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 7"/>'),
    });
    const meshes = read3mf(bytes);
    expect(meshes).toHaveLength(2);
    expect([...meshes[0]!.index!]).toEqual([0, 1, 2]);
    expect([...meshes[1]!.position]).toEqual([0, 0, 7, 1, 0, 7, 0, 1, 7]);
  });

  it('follows components into other model parts (the production extension)', () => {
    const bytes = archive({
      '_rels/.rels': RELS,
      '3D/3dmodel.model': model(
        '<object id="5" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 3 0 0"/></components></object>',
        '<item objectid="5" transform="2 0 0 0 2 0 0 0 2 0 0 0"/>',
      ),
      '3D/Objects/object_1.model': model(triangle('1'), ''),
      'Metadata/plate_1.png': 'not inflated',
    });
    const [mesh] = read3mf(bytes);
    // The component moves x by 3, then the item doubles everything.
    expect([...mesh!.position]).toEqual([6, 0, 0, 8, 0, 0, 6, 2, 0]);
  });

  it('drops triangles that point past the vertices', () => {
    const bad = `<object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
      <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="9"/><triangle v1="0" v2="1.5" v3="2"/></triangles></mesh></object>`;
    const [mesh] = read3mf(archive({ '_rels/.rels': RELS, '3D/3dmodel.model': model(bad, '<item objectid="1"/>') }));
    expect([...mesh!.index!]).toEqual([0, 1, 2]);
  });

  it('finds the model without relationships, and fails on archives without one', () => {
    expect(read3mf(archive({ '3D/3dmodel.model': model(triangle('1'), '<item objectid="1"/>') }))).toHaveLength(1);
    expect(() => read3mf(archive({ 'readme.txt': 'hello' }))).toThrow();
    expect(() => read3mf(strToU8('not a zip'))).toThrow();
  });
});
