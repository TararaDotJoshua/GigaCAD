import { AssemblyIcon, DrawingIcon, FileIcon, PartIcon } from '../icons';

const KINDS: [RegExp, typeof PartIcon, string][] = [
  [/\.(sldasm|asm|iam|f3z)$/i, AssemblyIcon, 'Assembly'],
  [/\.(slddrw|drw|idw|dwg|dxf|pdf)$/i, DrawingIcon, 'Drawing'],
  [/\.(sldprt|prt|ipt|f3d|fcstd|step|stp|iges|igs|stl|3mf|obj|x_t)$/i, PartIcon, 'Part'],
];

/** A type glyph for a CAD file, or its thumbnail once the API has rendered one. */
export function FileGlyph({ path, thumbnailUrl }: { path: string; thumbnailUrl?: string | undefined }) {
  const [, Icon, label] = KINDS.find(([pattern]) => pattern.test(path)) ?? [null, FileIcon, 'File'];
  if (thumbnailUrl) {
    return (
      <span className="file-glyph has-thumbnail">
        <img src={thumbnailUrl} alt="" width={36} height={36} loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className="file-glyph" title={label}>
      <Icon className="icon" />
    </span>
  );
}
