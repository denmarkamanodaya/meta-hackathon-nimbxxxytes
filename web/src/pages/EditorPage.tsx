// Editor compose screen: the moments picked on Search, what the post should be, its frame and
// length, then "Make it" starts the editing agent.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatDuration } from '../core/format';
import { Button, buttonClassName } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { SegmentedControl } from '../design/SegmentedControl';
import { useCreateShort, useEditorHandoff } from '../hooks/useEditor';
import type { Aspect, SearchResult } from '../services/api/types';
import './EditorPage.css';

const ASPECTS = [
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
] as const;
const MIN_TARGET_S = 10;
const MAX_TARGET_S = 30;

function PickedStrip({ moments, count }: { moments: SearchResult[]; count: number }) {
  return (
    <div className="editor-page__picked">
      <p className="editor-page__label">{`${String(count)} ${count === 1 ? 'moment' : 'moments'} picked`}</p>
      {moments.length > 0 && (
        <ol className="editor-page__strip">
          {moments.map((moment, index) => (
            <li key={moment.segment_id} className="editor-page__moment">
              <span className="editor-page__thumb">
                {moment.thumb_url === null ? <Icon name="play" /> : <img src={moment.thumb_url} alt="" />}
                <span className="editor-page__order">{index + 1}</span>
              </span>
              <span className="editor-page__reason">
                {moment.reason ?? `${moment.clip_filename} · ${formatDuration(moment.start_s)}`}
              </span>
            </li>
          ))}
        </ol>
      )}
      <Link to="/search" className="editor-page__change">
        Change selection
      </Link>
    </div>
  );
}

/**
 * Compose a short from picked moments; with none, points to Search.
 * @returns The page.
 */
export function EditorPage() {
  const navigate = useNavigate();
  const { segmentIds, moments } = useEditorHandoff();
  const { state, create } = useCreateShort();
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [target, setTarget] = useState(15);

  if (segmentIds.length === 0) {
    return (
      <>
        <PageHeader title="Editor" />
        <EmptyState
          icon="editor"
          title="Make a short"
          body="Pick moments, say what you want to post, and the editor cuts, captions and critiques a draft for you."
          action={
            <Link to="/search" className={buttonClassName('primary')}>
              <Icon name="search" />
              Find moments
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="New short" />
      <form
        className="editor-page__form"
        onSubmit={(event) => {
          event.preventDefault();
          void create({ prompt: prompt.trim(), segment_ids: segmentIds, aspect, target_s: target }).then(
            (shortId) => {
              if (shortId !== null) void navigate(`/editor/${encodeURIComponent(shortId)}`);
            },
          );
        }}
      >
        <PickedStrip moments={moments} count={segmentIds.length} />
        <label className="editor-page__field">
          <span className="editor-page__label">What should the post be?</span>
          <textarea
            className="editor-page__prompt"
            rows={3}
            required
            placeholder="15-second reel of my morning, start with the coffee"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
          />
        </label>
        <div className="editor-page__row">
          <span className="editor-page__label">Frame</span>
          <SegmentedControl label="Frame" options={ASPECTS} value={aspect} onChange={setAspect} />
        </div>
        <label className="editor-page__field">
          <span className="editor-page__label">{`Length · ${String(target)} s`}</span>
          <input
            className="editor-page__range"
            type="range"
            min={MIN_TARGET_S}
            max={MAX_TARGET_S}
            step={1}
            value={target}
            onChange={(event) => {
              setTarget(Number(event.target.value));
            }}
          />
        </label>
        <Button type="submit" disabled={prompt.trim() === '' || state.status === 'creating'}>
          <Icon name="sparkle" />
          {state.status === 'creating' ? 'Starting…' : 'Make it'}
        </Button>
      </form>
    </>
  );
}
