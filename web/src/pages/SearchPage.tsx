// Search (Mist): "Search" label and field with a clear button; recent or suggested queries while
// empty; then the shared answer (`SearchResults`: spinner, then the final moments to pick from).
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { SearchResults } from '../components/SearchResults';
import { suggestedQueries } from '../core/recent-queries';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import { useRecentQueries } from '../hooks/useSearch';
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

/**
 * Natural-language search over every clip.
 * @returns The page.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const { recent, record, clear } = useRecentQueries();
  const [draft, setDraft] = useState(query);

  const run = (next: string) => {
    const clean = next.trim();
    if (clean === '') return;
    setDraft(clean);
    record(clean);
    setParams({ q: clean });
  };

  return (
    <div className="search-page">
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
                setParams({});
              }}
            >
              <Icon name="close" size="xs" />
            </button>
          )}
        </div>
      </form>
      {query === '' ? (
        <Suggestions recent={recent} onPick={run} onClear={clear} />
      ) : (
        <div className="search-page__answer">
          <SearchResults key={query} query={query} />
        </div>
      )}
    </div>
  );
}
