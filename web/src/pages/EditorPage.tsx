// New short (not in the Mist mock; styled with its parts): back and "New short", the picked
// moments, what the post should be, its frame and length, then "Make it" in the bottom bar
// starts the editing agent. The flow is unchanged.
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatDuration } from '../core/format';
import { Button, buttonClassName } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
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

function Header({ subtitle }: { subtitle: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <header className="editor-page__header">
      <button
        type="button"
        className="editor-page__back"
        aria-label="Back"
        onClick={() => {
          if (location.key === 'default') void navigate('/search');
          else void navigate(-1);
        }}
      >
        <Icon name="back" size="md" />
      </button>
      <div className="editor-page__heading">
        <h1 className="editor-page__title">New short</h1>
        <span className="editor-page__subtitle">{subtitle}</span>
      </div>
    </header>
  );
}

function PickedStrip({ moments }: { moments: SearchResult[] }) {
  if (moments.length === 0) return null;
  return (
    <ol className="editor-page__strip">
      {moments.map((moment, index) => (
        <li key={moment.segment_id} className="editor-page__moment">
          <span className="editor-page__thumb">
            {moment.thumb_url !== null && <img src={moment.thumb_url} alt="" />}
            <span className="editor-page__order">{index + 1}</span>
          </span>
          <span className="editor-page__time">{`${formatDuration(moment.start_s)}–${formatDuration(moment.end_s)}`}</span>
          <span className="editor-page__reason">{moment.reason ?? moment.clip_title}</span>
        </li>
      ))}
    </ol>
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
  const count = segmentIds.length;

  if (count === 0) {
    return (
      <div className="editor-page">
        <Header subtitle="Pick moments first" />
        <EmptyState
          icon="shorts"
          title="Make a short"
          body="Pick moments in Search, say what you want to post, and the editor cuts, captions and critiques a draft for you."
          action={
            <Link to="/search" className={buttonClassName('primary', 'lg')}>
              <Icon name="search" size="sm" />
              Find moments
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <form
      className="editor-page"
      onSubmit={(event) => {
        event.preventDefault();
        void create({ prompt: prompt.trim(), segment_ids: segmentIds, aspect, target_s: target }).then((shortId) => {
          if (shortId !== null) void navigate(`/editor/${encodeURIComponent(shortId)}`);
        });
      }}
    >
      <Header subtitle={`${String(count)} ${count === 1 ? 'moment' : 'moments'} picked`} />
      <PickedStrip moments={moments} />
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
      <div className="editor-page__card">
        <div className="editor-page__row">
          <span className="editor-page__label">Frame</span>
          <SegmentedControl label="Frame" options={ASPECTS} value={aspect} onChange={setAspect} />
        </div>
        <label className="editor-page__field">
          <span className="editor-page__row">
            <span className="editor-page__label">Length</span>
            <span className="editor-page__mono">{`0:${String(target).padStart(2, '0')}`}</span>
          </span>
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
      </div>
      <div className="editor-page__bar">
        <Button type="submit" size="lg" disabled={prompt.trim() === '' || state.status === 'creating'}>
          <Icon name="sparkle" size="sm" />
          {state.status === 'creating' ? 'Starting…' : 'Make it'}
        </Button>
      </div>
    </form>
  );
}
