// Search page: one box, recent queries, ranked moments with reasons. Tap a moment to open the
// clip at that second; select moments (Select button or long press) to make a short.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { SearchResultCard } from '../components/SearchResultCard';
import { SelectionBar } from '../components/SelectionBar';
import { toggleSelection, type EditorHandoff } from '../core/selection';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Spinner } from '../design/Spinner';
import { useRecentQueries, useSearch } from '../hooks/useSearch';
import type { SearchResponse, SearchResult } from '../services/api/types';
import './SearchPage.css';

const EXAMPLES = ['latte art at the cafe', 'when Sam laughed', 'sunset from the bike'] as const;

interface SuggestionsProps {
  recent: string[];
  onPick: (query: string) => void;
  onClear: () => void;
}

function Suggestions({ recent, onPick, onClear }: SuggestionsProps) {
  const items = recent.length > 0 ? recent : EXAMPLES;
  return (
    <>
      <div className="search-page__suggest-head">
        <span>{recent.length > 0 ? 'Recent' : 'Try'}</span>
        {recent.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <div className="search-page__chips">
        {items.map((item) => (
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
    </>
  );
}

function Understood({ response }: { response: SearchResponse }) {
  const { keywords, filters } = response.rewritten;
  const terms = [...filters.people, ...(filters.place === null ? [] : [filters.place]), ...keywords];
  if (terms.length === 0) return null;
  return (
    <div className="search-page__understood" aria-label="What the search looked for">
      <Icon name="sparkle" />
      {terms.map((term) => (
        <Chip key={term} tone={filters.people.includes(term) ? 'accent' : 'neutral'}>
          {term}
        </Chip>
      ))}
    </div>
  );
}

interface ResultsProps {
  response: SearchResponse;
  selected: string[];
  isSelectMode: boolean;
  onOpen: (result: SearchResult) => void;
  onToggle: (id: string) => void;
  onLongPress: (id: string) => void;
}

function Results({ response, selected, isSelectMode, ...handlers }: ResultsProps) {
  const now = useMemo(() => new Date(), []);
  if (response.results.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No moments found"
        body="Try other words: what you saw, what someone said, or who was there."
      />
    );
  }
  return (
    <ul className="search-page__results">
      {response.results.map((result) => (
        <SearchResultCard
          key={result.segment_id}
          result={result}
          isSelectMode={isSelectMode}
          isSelected={selected.includes(result.segment_id)}
          now={now}
          {...handlers}
        />
      ))}
    </ul>
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
  const [isSelectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const run = (next: string) => {
    const clean = next.trim();
    if (clean === '') return;
    setDraft(clean);
    record(clean);
    setSelected([]);
    setSelectMode(false);
    setParams({ q: clean });
  };
  const toggle = (id: string) => {
    setSelected((current) => toggleSelection(current, id));
  };
  const cancelSelect = () => {
    setSelectMode(false);
    setSelected([]);
  };
  const results = state.status === 'done' ? state.response : null;

  return (
    <div className={isSelectMode ? 'search-page search-page--selecting' : 'search-page'}>
      <PageHeader
        title="Search"
        trailing={
          results !== null && results.results.length > 0 && !isSelectMode ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSelectMode(true);
              }}
            >
              Select
            </Button>
          ) : undefined
        }
      />
      <form
        className="search-page__form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          run(draft);
        }}
      >
        <label className="search-page__field">
          <span className="visually-hidden">Search your clips</span>
          <Icon name="search" />
          <input
            className="search-page__input"
            type="search"
            enterKeyHint="search"
            placeholder="Describe a moment"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </label>
      </form>
      {state.status === 'idle' && <Suggestions recent={recent} onPick={run} onClear={clear} />}
      {state.status === 'searching' && (
        <p className="search-page__note" role="status">
          <Spinner /> Searching your clips…
        </p>
      )}
      {state.status === 'error' && (
        <EmptyState icon="search" title="Search did not finish" body={state.message} />
      )}
      {results !== null && (
        <>
          <Understood response={results} />
          <p className="search-page__note" role="status">
            {`${String(results.results.length)} ${results.results.length === 1 ? 'moment' : 'moments'}`}
            {!results.reranked && ' · in fused order (reasons unavailable)'}
          </p>
          <Results
            response={results}
            selected={selected}
            isSelectMode={isSelectMode}
            onOpen={(result) => {
              void navigate(
                `/clips/${encodeURIComponent(result.clip_id)}?t=${String(result.start_s)}`,
              );
            }}
            onToggle={toggle}
            onLongPress={(id) => {
              setSelectMode(true);
              toggle(id);
            }}
          />
        </>
      )}
      {isSelectMode && (
        <SelectionBar
          count={selected.length}
          onCancel={cancelSelect}
          onMakeShort={() => {
            const handoff: EditorHandoff = { segmentIds: selected };
            void navigate('/editor', { state: handoff });
          }}
        />
      )}
    </div>
  );
}
