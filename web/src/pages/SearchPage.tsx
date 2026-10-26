// Search page: natural-language search over every clip. Phase 0 shows the form shell only.
import { useState } from 'react';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import './SearchPage.css';

const EXAMPLES = ['latte art at the cafe', 'when Sam laughed', 'sunset from the bike'] as const;

/**
 * Search box with example queries; results arrive once clips are indexed.
 * @returns The page.
 */
export function SearchPage() {
  const [query, setQuery] = useState('');

  return (
    <>
      <PageHeader title="Search" />
      <form
        className="search-page__form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
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
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
      </form>
      <div className="search-page__examples">
        {EXAMPLES.map((example) => (
          <Chip
            key={example}
            onClick={() => {
              setQuery(example);
            }}
          >
            {example}
          </Chip>
        ))}
      </div>
      <EmptyState
        icon="search"
        title="Ask in plain words"
        body="Search by what you saw, heard or who was there. Results jump straight to the second it happened."
      />
    </>
  );
}
