// Isometric line art for CAD parts, generated from geometry so every drawing
// shares one projection, one stroke, and the drafting convention of dashed
// hidden edges. Occlusion between separate bodies is ignored; the shapes are
// chosen so that it doesn't show.

type P2 = [number, number];
type P3 = [number, number, number];

interface Stroke {
  d: string;
  hidden: boolean;
}

const COS30 = Math.cos(Math.PI / 6);
// Direction toward the viewer. A face is visible when its normal points this way.
const VIEW: P3 = [1, 1, 1];

function project([x, y, z]: P3): P2 {
  return [(x - y) * COS30, (x + y) * 0.5 - z];
}

const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function circle(cx: number, cy: number, r: number, segments = 48): P2[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2;
  });
}

function signedArea(pts: P2[]): number {
  let s = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  });
  return s / 2;
}

class Drawing {
  strokes: Stroke[] = [];
  private points: P2[] = [];

  polyline(pts: P3[], hidden = false, close = false) {
    const q = pts.map(project);
    this.points.push(...q);
    const d = "M" + q.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") + (close ? "Z" : "");
    this.strokes.push({ d, hidden });
  }

  /**
   * Extrudes a 2D profile. `map` places profile point (u, v) at extrusion
   * depth t in 3D and must be linear. Holes are drawn on both caps.
   */
  prism(
    profile: P2[],
    t0: number,
    t1: number,
    map: (u: number, v: number, t: number) => P3,
    holes: P2[][] = [],
  ) {
    const pts = signedArea(profile) < 0 ? [...profile].reverse() : profile;
    const n = pts.length;
    const origin = map(0, 0, 0);
    const axis = sub(map(0, 0, 1), origin);
    const capVisible = { [t0]: dot(axis, VIEW) < 0, [t1]: dot(axis, VIEW) > 0 };

    // Outward normal of each side face, from the CCW edge's 2D normal.
    const sideNormal = pts.map((p, i) => {
      const q = pts[(i + 1) % n]!;
      const du = q[0] - p[0];
      const dv = q[1] - p[1];
      return sub(map(dv, -du, 0), origin);
    });
    const sideVisible = sideNormal.map((nrm) => dot(nrm, VIEW) > 1e-6);

    for (const t of [t0, t1]) {
      if (capVisible[t]) {
        this.polyline(pts.map(([u, v]) => map(u, v, t)), false, true);
      } else {
        // Split the hidden cap's outline into visible and hidden runs.
        let run: P3[] = [];
        let runHidden: boolean | null = null;
        pts.forEach((p, i) => {
          const q = pts[(i + 1) % n]!;
          const hidden = !sideVisible[i];
          if (runHidden !== null && hidden !== runHidden) {
            this.polyline(run, runHidden);
            run = [];
          }
          if (run.length === 0) run.push(map(p[0], p[1], t));
          run.push(map(q[0], q[1], t));
          runHidden = hidden;
        });
        if (run.length > 1) this.polyline(run, runHidden ?? false);
      }
      for (const hole of holes) {
        this.polyline(hole.map(([u, v]) => map(u, v, t)), !capVisible[t], true);
      }
    }

    // Edges along the extrusion: silhouettes and real creases only, so round
    // profiles don't sprout a line per segment.
    pts.forEach((p, i) => {
      const prev = (i - 1 + n) % n;
      const a = sideVisible[prev];
      const b = sideVisible[i];
      const na = sideNormal[prev]!;
      const nb = sideNormal[i]!;
      const cos = dot(na, nb) / Math.sqrt(dot(na, na) * dot(nb, nb));
      const crease = cos < Math.cos((25 * Math.PI) / 180);
      const silhouette = a !== b;
      if (silhouette || (crease && (a || b))) {
        this.polyline([map(p[0], p[1], t0), map(p[0], p[1], t1)]);
      } else if (crease && n <= 12) {
        this.polyline([map(p[0], p[1], t0), map(p[0], p[1], t1)], true);
      }
    });
  }

  /** A circle lying on a horizontal face, e.g. a hole on top of a plate. */
  ring(cx: number, cy: number, z: number, r: number) {
    this.polyline(circle(cx, cy, r).map(([x, y]) => [x, y, z] as P3), false, true);
  }

  helix(r: number, pitch: number, turns: number) {
    const steps = Math.round(turns * 64);
    let run: P3[] = [];
    let runHidden: boolean | null = null;
    for (let i = 0; i <= steps; i++) {
      const a = (i / 64) * Math.PI * 2;
      const p: P3 = [r * Math.cos(a), r * Math.sin(a), (pitch * a) / (Math.PI * 2)];
      const hidden = Math.cos(a) + Math.sin(a) < 0;
      if (runHidden !== null && hidden !== runHidden) {
        run.push(p);
        this.polyline(run, runHidden);
        run = [];
      }
      run.push(p);
      runHidden = hidden;
    }
    if (run.length > 1) this.polyline(run, runHidden ?? false);
  }

  viewBox(pad = 6): string {
    const xs = this.points.map((p) => p[0]);
    const ys = this.points.map((p) => p[1]);
    const x0 = Math.min(...xs) - pad;
    const y0 = Math.min(...ys) - pad;
    return [x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0].map(fmt).join(" ");
  }
}

const xy = (u: number, v: number, t: number): P3 => [u, v, t];

function gearProfile(teeth: number, rOuter: number, rRoot: number): P2[] {
  const pts: P2[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    // Root, flank up, tip land, flank down: a trapezoidal tooth.
    for (const [f, r] of [
      [0, rRoot],
      [0.18, rRoot],
      [0.32, rOuter],
      [0.58, rOuter],
      [0.72, rRoot],
    ] as const) {
      pts.push([r * Math.cos(a + f * step), r * Math.sin(a + f * step)]);
    }
  }
  return pts;
}

function stadium(length: number, r: number): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI / 2 + (i / 24) * Math.PI;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI;
    pts.push([length + r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

const builders = {
  bracket(d: Drawing) {
    // L profile in the xz plane, extruded along y.
    const W = 70, H = 56, T = 9, D = 44;
    d.prism(
      [[0, 0], [W, 0], [W, T], [T, T], [T, H], [0, H]],
      0,
      D,
      (u, v, t) => [u, t, v],
    );
    d.ring(W * 0.62, D * 0.5, T, 7);
    d.ring(W * 0.62, D * 0.5, T, 4);
  },
  gear(d: Drawing) {
    d.prism(gearProfile(16, 44, 37), 0, 12, xy, [circle(0, 0, 11)]);
  },
  shaft(d: Drawing) {
    d.prism(circle(0, 0, 26), 0, 12, xy);
    d.prism(circle(0, 0, 12), 12, 64, xy);
  },
  nut(d: Drawing) {
    const hex = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      return [30 * Math.cos(a), 30 * Math.sin(a)] as P2;
    });
    d.prism(hex, 0, 18, xy, [circle(0, 0, 14)]);
  },
  plate(d: Drawing) {
    const W = 96, L = 64;
    d.prism([[0, 0], [W, 0], [W, L], [0, L]], 0, 6, xy, [
      circle(12, 12, 4, 32),
      circle(W - 12, 12, 4, 32),
      circle(12, L - 12, 4, 32),
      circle(W - 12, L - 12, 4, 32),
      circle(W / 2, L / 2, 14),
    ]);
  },
  spring(d: Drawing) {
    d.helix(18, 11, 5.5);
  },
  springLong(d: Drawing) {
    d.helix(18, 11, 8.5);
  },
  arm(d: Drawing) {
    d.prism(stadium(92, 12), 0, 8, xy, [circle(0, 0, 5, 32), circle(92, 0, 5, 32)]);
  },
  assembly(d: Drawing) {
    // A shaft through a gear, drawn as one sketch.
    d.prism(gearProfile(12, 34, 28), 0, 10, xy, [circle(0, 0, 8)]);
    d.prism(circle(0, 0, 8), -18, 40, xy);
  },
} satisfies Record<string, (d: Drawing) => void>;

export type PartName = keyof typeof builders;

const drawings = Object.fromEntries(
  Object.entries(builders).map(([name, build]) => {
    const d = new Drawing();
    build(d);
    return [name, { strokes: d.strokes, viewBox: d.viewBox() }];
  }),
) as Record<PartName, { strokes: Stroke[]; viewBox: string }>;

export function PartArt({
  part,
  className,
  strokeWidth = 1.5,
}: {
  part: PartName;
  className?: string;
  strokeWidth?: number;
}) {
  const { strokes, viewBox } = drawings[part];
  return (
    <svg
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          d={s.d}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          {...(s.hidden ? { strokeDasharray: "3 3", strokeOpacity: 0.35 } : {})}
        />
      ))}
    </svg>
  );
}
