// The life of one branch, from checkout to release. Step numbers match the
// list rendered under it on the page.

const MAIN_Y = 176;
const BRANCH_Y = 72;

const pruned = [282, 304, 326, 420, 442, 464, 486, 580, 602];

const versions = [
  { x: 370, label: "Longer arms" },
  { x: 530, label: "Stiffer mount" },
];

function Step({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g className="diagram-step">
      <circle cx={x} cy={y} r={11} />
      <text x={x} y={y + 4.5} textAnchor="middle">
        {n}
      </text>
    </g>
  );
}

export function BranchDiagram() {
  return (
    <div className="diagram-scroll">
      <svg className="diagram" viewBox="0 0 1000 240" role="img" aria-labelledby="diagram-title">
        <title id="diagram-title">
          A branch forks from release v6, collects autosaves and two versions, and becomes v8 through
          release request 12.
        </title>

        <path className="diagram-main" d={`M20 ${MAIN_Y}H980`} />
        <path
          className="diagram-branch"
          d={`M120 ${MAIN_Y}C175 ${MAIN_Y} 170 ${BRANCH_Y} 232 ${BRANCH_Y}H736C804 ${BRANCH_Y} 812 ${MAIN_Y} 880 ${MAIN_Y}`}
        />

        {pruned.map((x) => (
          <circle key={x} className="diagram-autosave" cx={x} cy={BRANCH_Y} r={4} />
        ))}

        <rect className="diagram-checkout" x={236} y={BRANCH_Y - 6} width={12} height={12} rx={2} />
        <text className="diagram-label" x={242} y={BRANCH_Y - 22} textAnchor="middle">
          Check out
        </text>
        <Step n={1} x={242} y={BRANCH_Y - 48} />
        <Step n={2} x={304} y={BRANCH_Y + 34} />

        {versions.map((v, i) => (
          <g key={v.x}>
            <circle className="diagram-version" cx={v.x} cy={BRANCH_Y} r={7} />
            <text className="diagram-label" x={v.x} y={BRANCH_Y - 22} textAnchor="middle">
              {v.label}
            </text>
            {i === 0 && <Step n={3} x={v.x} y={BRANCH_Y - 48} />}
          </g>
        ))}

        <rect
          className="diagram-rr"
          x={684}
          y={BRANCH_Y - 7}
          width={14}
          height={14}
          rx={2}
          transform={`rotate(45 691 ${BRANCH_Y})`}
        />
        <text className="diagram-label" x={691} y={BRANCH_Y - 22} textAnchor="middle">
          Release request #12
        </text>
        <Step n={4} x={691} y={BRANCH_Y - 48} />

        {[
          { x: 120, label: "v6" },
          { x: 560, label: "v7" },
        ].map((r) => (
          <g key={r.x}>
            <circle className="diagram-release" cx={r.x} cy={MAIN_Y} r={8} />
            <text className="diagram-label is-mono" x={r.x} y={MAIN_Y + 32} textAnchor="middle">
              {r.label}
            </text>
          </g>
        ))}
        <circle className="diagram-release is-new" cx={880} cy={MAIN_Y} r={9} />
        <text className="diagram-label is-mono is-new" x={880} y={MAIN_Y + 32} textAnchor="middle">
          v8
        </text>
        <Step n={5} x={922} y={MAIN_Y - 30} />

        <text className="diagram-caption" x={20} y={MAIN_Y - 12}>
          main
        </text>
        <text className="diagram-caption" x={232} y={BRANCH_Y + 38} textAnchor="start" dx={96}>
          autosaves, cleared at each version
        </text>
      </svg>
    </div>
  );
}
