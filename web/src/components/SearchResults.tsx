// The answer to one search, shared by the Search page and the Mac Library: a spinner with
// "Searching your clips…" until the final Muse Spark order arrives, then "N moments in M clips"
// with the time and cost, result cards with a pick toggle, and a dark bar to make a short from the
// picked moments. Mount it with `key={query}` so picks reset for a new query.
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { momentsLine, viewCostLine } from '../core/search-meta';
import type { SearchView } from '../core/search-progress';
import { pickedAmong, toggleSelection, type EditorHandoff } from '../core/selection';
import { EmptyState } from '../design/EmptyState';
import { Spinner } from '../design/Spinner';
import { useFlipReorder } from '../hooks/useFlipReorder';
import { useSearch } from '../hooks/useSearch';
import type { SearchResponse, SearchResult } from '../services/api/types';
import { SearchResultCard } from './SearchResultCard';
import { SelectionBar } from './SelectionBar';
import './SearchResults.css';

function Meta({ view }: { view: SearchView }) {
  const cost = viewCostLine(view);
  return (
    <div className="search-results__meta" role="status">
      <span>{momentsLine(view.response.results)}</span>
      <span className={cost.isCached ? 'search-results__cost search-results__cost--cached' : 'search-results__cost'}>{cost.text}</span>
    </div>
  );
}

interface ListProps {
  response: SearchResponse;
  picked: string[];
  onOpen: (result: SearchResult) => void;
  onTogglePick: (id: string) => void;
}

function List({ response, picked, onOpen, onTogglePick }: ListProps) {
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
  if (state.status === 'idle') return null;
  if (state.status === 'searching') return <Searching />;
  if (state.status === 'error') return <EmptyState icon="search" title="Search did not finish" body={state.message} />;
  const rows = state.response.results;
  const shownPicks = pickedAmong(picked, rows);
  return (
    <div className={shownPicks.length > 0 ? 'search-results search-results--picking' : 'search-results'}>
      <Meta view={state} />
      <List
        response={state.response}
        picked={picked}
        onOpen={(result) => {
          void navigate(`/clips/${encodeURIComponent(result.clip_id)}?t=${String(result.start_s)}`);
        }}
        onTogglePick={(id) => {
          setPicked((current) => toggleSelection(current, id));
        }}
      />
      {shownPicks.length > 0 && (
        <SelectionBar
          count={shownPicks.length}
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
