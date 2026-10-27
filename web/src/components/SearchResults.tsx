// The answer to one search, shared by the Search page and the Mac Library: a spinner with
// "Searching your clips…" until the final Muse Spark order arrives, then "N moments in M clips"
// with plain badges (refined by Muse Spark, asked before and free) and a Select button. Select
// mode gives every result a labelled checkbox and keeps a dark bar on screen that says what is
// picked ("2 moments · 0:15") and makes a short from it. Mount it with `key={query}` so picks
// reset for a new query.
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { momentsLine, searchBadges } from '../core/search-meta';
import type { SearchView } from '../core/search-progress';
import { pickedAmong, pickedSummary, toggleSelection, type EditorHandoff } from '../core/selection';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Spinner } from '../design/Spinner';
import { useFlipReorder } from '../hooks/useFlipReorder';
import { useSearch } from '../hooks/useSearch';
import type { SearchResponse, SearchResult } from '../services/api/types';
import { SearchResultCard } from './SearchResultCard';
import { SelectionBar } from './SelectionBar';
import './SearchResults.css';

interface MetaProps {
  view: SearchView;
  isSelecting: boolean;
  onToggleSelect: (() => void) | null;
}

function Meta({ view, isSelecting, onToggleSelect }: MetaProps) {
  return (
    <div className="search-results__head">
      <div className="search-results__meta" role="status">
        <span className="search-results__count">{momentsLine(view.response.results)}</span>
        {searchBadges(view).map((badge) => (
          <Chip key={badge.text} tone={badge.tone}>
            {badge.text}
          </Chip>
        ))}
      </div>
      {onToggleSelect !== null && (
        <Button variant="ghost" onClick={onToggleSelect}>
          {isSelecting ? 'Done' : 'Select'}
        </Button>
      )}
    </div>
  );
}

interface ListProps {
  response: SearchResponse;
  picked: string[];
  isSelecting: boolean;
  onOpen: (result: SearchResult) => void;
  onTogglePick: (id: string) => void;
}

function List({ response, picked, isSelecting, onOpen, onTogglePick }: ListProps) {
  const now = useMemo(() => new Date(), []);
  const list = useRef<HTMLUListElement>(null);
  useFlipReorder(list, response.results.map((result) => result.segment_id).join(' '));
  if (response.results.length === 0) {
    return (
      <EmptyState icon="search" title="No moments found" body="Try other words: what you saw, what someone said, or who was there." />
    );
  }
  return (
    <ul className="search-results__list" ref={list}>
      {response.results.map((result) => (
        <SearchResultCard
          key={result.segment_id}
          result={result}
          isSelecting={isSelecting}
          isPicked={picked.includes(result.segment_id)}
          isRefining={false}
          now={now}
          onOpen={onOpen}
          onTogglePick={onTogglePick}
        />
      ))}
    </ul>
  );
}

function Searching() {
  return (
    <div className="search-results__searching" aria-busy="true">
      <Spinner />
      <p role="status">Searching your clips…</p>
    </div>
  );
}

/** Props for `SearchResults`. */
export interface SearchResultsProps {
  /** The query to run; '' shows nothing. */
  query: string;
}

/**
 * Runs `query` and shows its answer.
 * @param props - See `SearchResultsProps`.
 * @returns The results, or null for an empty query.
 */
export function SearchResults({ query }: SearchResultsProps) {
  const navigate = useNavigate();
  const state = useSearch(query);
  const [picked, setPicked] = useState<string[]>([]);
  const [isSelecting, setSelecting] = useState(false);
  if (state.status === 'idle') return null;
  if (state.status === 'searching') return <Searching />;
  if (state.status === 'error') return <EmptyState icon="search" title="Search did not finish" body={state.message} />;
  const rows = state.response.results;
  const shownPicks = pickedAmong(picked, rows);
  const isPicking = isSelecting && rows.length > 0;
  return (
    <div className={isPicking ? 'search-results search-results--picking' : 'search-results'}>
      <Meta
        view={state}
        isSelecting={isPicking}
        onToggleSelect={
          rows.length === 0
            ? null
            : () => {
                if (isSelecting) setPicked([]);
                setSelecting(!isSelecting);
              }
        }
      />
      {isPicking && (
        <div className="search-results__hint">
          <span>Pick moments to cut into a short</span>
          <span className="search-results__picked">{`${String(shownPicks.length)} picked`}</span>
        </div>
      )}
      <List
        response={state.response}
        picked={picked}
        isSelecting={isPicking}
        onOpen={(result) => {
          void navigate(`/clips/${encodeURIComponent(result.clip_id)}?t=${String(result.start_s)}`);
        }}
        onTogglePick={(id) => {
          setPicked((current) => toggleSelection(current, id));
        }}
      />
      {isPicking && (
        <SelectionBar
          summary={pickedSummary(shownPicks, rows)}
          canMakeShort={shownPicks.length > 0}
          onMakeShort={() => {
            const handoff: EditorHandoff = {
              segmentIds: shownPicks,
              moments: shownPicks.flatMap((id) => rows.filter((row) => row.segment_id === id)),
            };
            void navigate('/editor', { state: handoff });
          }}
        />
      )}
    </div>
  );
}
