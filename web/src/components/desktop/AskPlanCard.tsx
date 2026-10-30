// The Ask box's card above the box (Phase 27 mocks: plan, running, done, guide, unclear): the
// kind badge, the title and who planned it, the steps with their models, the setting chips, the
// "Did you mean…" choices, and the buttons. Nothing runs until Run.
import { useNavigate } from 'react-router';
import { barView, doneLine, rowViews, type AskJob } from '../../core/ask/jobs';
import {
  cardBadge,
  GUIDE_NOTE,
  MEMORY_NOTE,
  memoryPlanLine,
  PLAN_LINE,
  PLANNED_BY,
  planRows,
  planSettings,
  RUN_LINE,
  SHORT_NOTE,
  STOP_NOTE,
  unclearLine,
  type PlanContext,
} from '../../core/ask/plan';
import { SEGMENT_COPY } from '../../core/copy';
import { fromClipLine } from '../../core/guides';
import { openPath } from '../../core/search-bar';
import { Icon } from '../../design/Icon';
import { useAsk } from '../../hooks/useAsk';
import { guidePath } from '../../hooks/useGuides';
import { memoryPath } from '../../hooks/useMemories';
import type { ClipSummary, IntentChoice } from '../../services/api/types';
import { AskReadCard } from './AskReadCard';
import { AskBar, AskSteps } from './AskSteps';
import './MacColumns.css';
import './AskPlanCard.css';

/** What the card asks of the box around it. */
export interface AskCardBox {
  /** Run started or the card was dropped: the box empties (text and added clips). */
  onCleared: () => void;
  /** Edit request: the request goes back into the box. */
  onEdit: (text: string) => void;
  /** A "Did you mean…" choice was picked. */
  onChoice: (job: AskJob, choice: IntentChoice) => void;
  /** Make another: the cursor goes to the box. */
  onFocusBox: () => void;
}

/** Props for `AskPlanCard`. */
export interface AskPlanCardProps {
  job: AskJob;
  ctx: PlanContext;
  /** The clips the Gallery holds, for a guide's "From …" line. */
  clips: readonly ClipSummary[];
  box: AskCardBox;
}

interface Button {
  label: string;
  isPrimary?: boolean;
  go: () => void;
}

/** The header's right-hand words. */
function byLine(job: AskJob): string {
  if (job.intent.kind === 'unclear') return 'Muse Spark';
  switch (job.status) {
    case 'plan':
      return PLANNED_BY;
    case 'running':
      return 'Working';
    case 'done':
      return 'Ready';
    case 'failed':
      return 'Stopped';
  }
}

/**
 * The card; a letter to read has its own (`AskReadCard`).
 * @param props - See `AskPlanCardProps`.
 * @returns The card.
 */
export function AskPlanCard({ job, ctx, clips, box }: AskPlanCardProps) {
  if (job.intent.kind === 'read_document') return <AskReadCard job={job} ctx={ctx} box={box} />;
  return <PlanCard job={job} ctx={ctx} clips={clips} box={box} />;
}

function PlanCard({ job, ctx, clips, box }: AskPlanCardProps) {
  const { run, dismiss, stop } = useAsk();
  const navigate = useNavigate();
  const { intent } = job;
  const rows = rowViews(job, ctx);
  const isGuide = intent.kind === 'make_guide';
  const isMemory = intent.kind === 'memory_lane';
  const canStop = intent.kind === 'make_short' || isGuide || isMemory;
  const guideClip = isGuide ? clips.find((clip) => clip.clip_id === intent.clip_ids[0]) : undefined;

  const close = () => {
    dismiss(job.id);
  };
  const openDone = () => {
    close();
    if (job.shortId !== null) void navigate(openPath('short', job.shortId));
    else if (job.guideId !== null) void navigate(guidePath(job.guideId));
    else if (job.projectId !== null) void navigate(openPath('project', job.projectId));
    else if (job.memoryId !== null) void navigate(memoryPath(job.memoryId));
    else void navigate('/');
  };
  const openLabel = job.shortId !== null ? 'Open short' : job.guideId !== null ? 'Open iGuide' : job.projectId !== null ? SEGMENT_COPY.open : job.memoryId !== null ? 'Play session' : 'Open Gallery';

  let line: string;
  let note = '';
  let buttons: Button[];
  if (intent.kind === 'unclear') {
    line = unclearLine(job.text);
    buttons = [{ label: 'Cancel', go: () => { close(); box.onCleared(); } }];
  } else if (job.status === 'plan') {
    line = isGuide ? `${fromClipLine(guideClip?.title ?? null, guideClip?.duration_s ?? null)}.` : isMemory ? memoryPlanLine(intent, ctx) : PLAN_LINE;
    note = intent.kind === 'make_short' ? SHORT_NOTE : isGuide ? GUIDE_NOTE : isMemory ? MEMORY_NOTE : '';
    const cancel = { label: 'Cancel', go: () => { close(); box.onCleared(); } };
    const start = () => {
      run(job.id);
      box.onCleared();
    };
    buttons = isGuide
      ? [cancel, { label: 'Make iGuide', isPrimary: true, go: start }]
      : isMemory
      ? [cancel, { label: 'Make memory session', isPrimary: true, go: start }]
      : [cancel, { label: 'Edit request', go: () => { close(); box.onEdit(job.text); } }, { label: 'Run', isPrimary: true, go: start }];
  } else if (job.status === 'running') {
    line = RUN_LINE;
    note = canStop ? STOP_NOTE : '';
    buttons = canStop ? [{ label: 'Stop', go: () => { stop(job.id); } }] : [];
  } else if (job.status === 'done') {
    line = doneLine(job, ctx);
    buttons = [
      { label: 'Make another', go: () => { close(); box.onFocusBox(); } },
      { label: openLabel, isPrimary: true, go: openDone },
    ];
  } else {
    line = job.error ?? 'It stopped.';
    buttons = [
      { label: 'Close', go: close },
      { label: 'Edit request', isPrimary: true, go: () => { close(); box.onEdit(job.text); } },
    ];
  }

  const settings = job.status === 'plan' ? planSettings(intent, ctx) : [];
  const hasBar = (job.status === 'running' || job.status === 'done') && rows.length > 0;
  const bar = hasBar ? barView(job, planRows(intent, ctx)) : null;

  return (
    <section className="ask-card" aria-label={intent.kind === 'unclear' ? 'Did you mean' : intent.title}>
      <div className="ask-card__head">
        <span className="ask-card__badge">{cardBadge(intent.kind)}</span>
        <h2 className="ask-card__title">{intent.kind === 'unclear' ? 'Did you mean…' : intent.title}</h2>
        <span className="ask-card__by">{byLine(job)}</span>
      </div>
      <p className="ask-card__line" role={job.status === 'failed' ? 'alert' : undefined}>
        {line}
      </p>
      {bar !== null && <AskBar bar={bar} isDone={job.status === 'done'} />}
      {rows.length > 0 && <AskSteps rows={rows} />}
      {settings.length > 0 && (
        <div className="ask-card__settings">
          {settings.map((setting) => (
            <span key={setting.label} className="ask-card__setting">
              <span className="ask-card__setting-label">{setting.label}</span>
              {setting.value}
              <Icon name="chevron-down" size="xs" />
            </span>
          ))}
        </div>
      )}
      {intent.kind === 'unclear' && intent.choices.length > 0 && (
        <div className="ask-card__choices">
          {intent.choices.map((choice) => (
            <button
              key={`${choice.label}|${choice.text}`}
              type="button"
              className="ask-card__choice"
              onClick={() => {
                box.onChoice(job, choice);
              }}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
      <div className="ask-card__foot">
        <span className="ask-card__note">{note}</span>
        {buttons.map((button) => (
          <button
            key={button.label}
            type="button"
            className={button.isPrimary === true ? 'mac-button mac-button--primary' : 'mac-button'}
            onClick={button.go}
          >
            {button.label}
          </button>
        ))}
      </div>
    </section>
  );
}
