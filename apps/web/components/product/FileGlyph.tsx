import { AssemblyIcon, DrawingIcon, FileIcon, PartIcon } from '../icons';

const KINDS: [RegExp, typeof PartIcon, string][] = [
  [/\.(sldasm|asm|iam|f3z)$/i, AssemblyIcon, 'Assembly'],
  [/\.(slddrw|drw|idw|dwg|dxf|pdf)$/i, DrawingIcon, 'Drawing'],
  [/\.(sldprt|prt|ipt|f3d|fcstd|step|stp|iges|igs|stl|3mf|obj|x_t)$/i, PartIcon, 'Part'],
];

/** A type glyph for a CAD file. Previews replace it once the worker renders thumbnails. */
export function FileGlyph({ path }: { path: string }) {
  const [, Icon, label] = KINDS.find(([pattern]) => pattern.test(path)) ?? [null, FileIcon, 'File'];
  return (
    <span className="file-glyph" title={label}>
      <Icon className="icon" />
    </span>
  );
}
