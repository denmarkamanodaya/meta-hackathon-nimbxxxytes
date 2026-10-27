// Search (Mist): "Search" label and field with a clear button; under it "N moments in M clips"
// and the search's time and cost; result cards with a pick toggle; a dark bar to make a short
// from the picked moments.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { SearchResultCard } from '../components/SearchResultCard';
import { SelectionBar } from '../components/SelectionBar';
import { costLine, momentsLine } from '../core/search-meta';
import { suggestedQueries } from '../core/recent-queries';
import { toggleSelection, type EditorHandoff } from '../core/selection';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { useRecentQueries, useSearch } from '../hooks/useSearch';
import type { SearchResponse, SearchResult } from '../services/api/types';
import './SearchPage.css';

interface SuggestionsProps {
  recent: string[];
  onPick: (query: string) => void;
  onClear: () => void;
}

function Suggestions({ recent, onPick, onClear }: SuggestionsProps) {
  return (
    <div className="search-page__suggest">
      <div className="search-page__suggest-head">
        <span>{recent.length > 0 ? 'Recent' : 'Try'}</span>
        {recent.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <div className="search-page__chips">
        {suggestedQueries(recent, 8).map((item) => (
          <Chip
            key={item}
            onClick={() => {
              onPick(item);
            }}
          >
            {item}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Meta({ response }: { response: SearchResponse }) {
  const cost = costLine(response);
  return (
    <div className="search-page__meta" role="status">
      <span>{momentsLine(response.results)}</span>
      <span className={cost.isCached ? 'search-page__cost search-page__cost--cached' : 'search-page__cost'}>{cost.text}</span>
    </div>
  );
}

interface ResultsProps {
  response: SearchResponse;
  picked: string[];
  onOpen: (result: SearchResult) => void;
  onTogglePick: (id: string) => void;
}

function Results({ response, picked, onOpen, onTogglePick }: ResultsProps) {
  const now = useMemo(() => new Date(), []);
  if (response.results.length === 0) {
    return (
      <EmptyState icon="search" title="No moments found" body="Try other words: what you saw, what someone said, or who was there." />
    );
  }
  return (
    <ul className="search-page__results">
      {response.results.map((result) => (
        <SearchResultCard
          key={result.segment_id}
          result={result}
          isPicked={picked.includes(result.segment_id)}
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
    <div aria-busy="true">
      <p className="visually-hidden" role="status">
        Searching your clips…
      </p>
      <ul className="search-page__results" aria-hidden="true">
        {['a', 'b', 'c'].map((key) => (
          <li key={key} className="search-page__skeleton">
            <span className="search-page__skeleton-thumb">
              <Skeleton kind="thumb" />
            </span>
            <span className="search-page__skeleton-text">
              <Skeleton kind="line" />
              <Skeleton kind="line" />
              <Skeleton kind="line-short" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Natural-language search over every clip.
 * @returns The page.
 */
export function SearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const state = useSearch(query);
  const { recent, record, clear } = useRecentQueries();
  const [draft, setDraft] = useState(query);
  const [picked, setPicked] = useState<string[]>([]);

  const run = (next: string) => {
    const clean = next.trim();
    if (clean === '') return;
    setDraft(clean);
    record(clean);
    setPicked([]);
    setParams({ q: clean });
  };
  const results = state.status === 'done' ? state.response : null;

  return (
    <div className={picked.length > 0 ? 'search-page search-page--picking' : 'search-page'}>
      <form
        className="search-page__header"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          run(draft);
        }}
      >
        <label htmlFor="search-query" className="search-page__title">
          Search
        </label>
        <div className="search-page__field">
          <Icon name="search" size="md" />
          <input
            id="search-query"
            className="search-page__input"
            type="search"
            enterKeyHint="search"
            placeholder="Describe a moment"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          {draft !== '' && (
            <button
              type="button"
              className="search-page__clear"
              aria-label="Clear search"
              onClick={() => {
                setDraft('');
                setPicked([]);
                setParams({});
              }}
            >
              <Icon name="close" size="xs" />
            </button>
          )}
        </div>
        {results !== null && <Meta response={results} />}
      </form>
      {state.status === 'idle' && <Suggestions recent={recent} onPick={run} onClear={clear} />}
      {state.status === 'searching' && <Searching />}
      {state.status === 'error' && <EmptyState icon="search" title="Search did not finish" body={state.message} />}
      {results !== null && (
        <Results
          response={results}
          picked={picked}
          onOpen={(result) => {
            void navigate(`/clips/${encodeURIComponent(result.clip_id)}?t=${String(result.start_s)}`);
          }}
          onTogglePick={(id) => {
            setPicked((current) => toggleSelection(current, id));
          }}
        />
      )}
      {picked.length > 0 && (
        <SelectionBar
          count={picked.length}
          onMakeShort={() => {
            const rows = results?.results ?? [];
            const handoff: EditorHandoff = {
              segmentIds: picked,
              moments: picked.flatMap((id) => rows.filter((row) => row.segment_id === id)),
            };
            void navigate('/editor', { state: handoff });
          }}
        />
      )}
    </div>
  );
}
