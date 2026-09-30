import { useEffect } from 'react';
import type { AppState, SetupStep } from '../../shared/types.js';
import { platformWords } from '../../shared/platform.js';
import { act } from '../api.js';
import { CheckIcon } from '../icons.js';

/** The first-run checklist, and Settings → Repair. Every step can be run again. */
export function Setup({ state, firstRun = false }: { state: AppState; firstRun?: boolean }) {
  const words = platformWords(state.app.platform);
  // The first-run screen checks everything as soon as it appears.
  useEffect(() => {
    if (firstRun) void act('runSetup');
  }, [firstRun]);
  const running = state.setup.some((step) => step.status === 'running');
  const blocking = state.setup.some((step) => !step.optional && (step.status === 'error' || step.status === 'todo'));
  const body = (
    <>
      <ol className="steps">
        {state.setup.map((step) => (
          <li key={step.id}>
            <StepMark step={step} />
            <div>
              <div>
                {step.title}
                {step.optional ? <span className="faint"> · optional</span> : null}
              </div>
              {step.detail ? <div className="step-detail">{step.detail}</div> : null}
            </div>
            <StepAction step={step} />
          </li>
        ))}
      </ol>
      <div className="inline">
        <button type="button" className={`btn ${firstRun ? 'btn-secondary' : 'btn-primary'}`} disabled={running} onClick={() => void act('runSetup')}>
          {running ? 'Checking…' : firstRun ? 'Check again' : 'Repair'}
        </button>
        {firstRun ? (
          <button type="button" className="btn btn-primary" disabled={running} onClick={() => void act('finishSetup')}>
            {blocking ? 'Continue anyway' : 'Open GigaCAD'}
          </button>
        ) : null}
      </div>
    </>
  );
  if (!firstRun) return body;
  return (
    <div className="center drag">
      <div className="card card-wide">
        <h2 className="card-title">Set up GigaCAD on {words.thisComputer}</h2>
        <p className="lede">Each step can be run again later from Settings → Repair.</p>
        {body}
      </div>
    </div>
  );
}

function StepMark({ step }: { step: SetupStep }) {
  if (step.status === 'done') {
    return (
      <span className="step-mark is-done" aria-label="Done">
        <CheckIcon className="icon icon-small" />
      </span>
    );
  }
  if (step.status === 'error') return <span className="step-mark is-error" aria-label="Failed">!</span>;
  if (step.status === 'running') return <span className="step-mark is-running" aria-label="Running" />;
  if (step.status === 'skipped') return <span className="step-mark" aria-label="Skipped">–</span>;
  return <span className="step-mark" aria-label="To do" />;
}

function StepAction({ step }: { step: SetupStep }) {
  if (step.status !== 'todo' && step.status !== 'error') return <span />;
  if (step.id === 'applications') {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('moveToApplications')}>
        Move
      </button>
    );
  }
  if (step.id === 'cli') {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('installCli')}>
        Install…
      </button>
    );
  }
  if (step.id === 'signin') {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('signIn')}>
        Sign in
      </button>
    );
  }
  return <span />;
}
