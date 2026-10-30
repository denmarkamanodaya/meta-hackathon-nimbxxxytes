// iListen on the phone (`/ilisten`, mock frame 3), drawn with the iGuide list's rows as iRead is:
// "iListen", the Features switch (iGuide | Shorts | iRead | iListen), the add card ("Listen to a
// recording", Summary in, Choose a file), then one row per recording (a wave, the title, the
// languages heard → the output language, and the check score). A new recording opens at once and
// is listened to while it shows; a failed add says why under the button.
import { Link, useNavigate } from 'react-router';
import { FeaturesSwitch } from '../components/FeaturesSwitch';
import { LangChips, LanguageSelect } from '../components/ListenParts';
import { LoadError } from '../components/LoadError';
import { MediaPicker } from '../components/MediaPicker';
import { ILISTEN_COPY, listenPill, listenTitle } from '../core/ilisten/listens';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { listenPath, useAddListen, useListens, useListenTarget } from '../hooks/useListens';
import type { ListenSummary } from '../services/api/types';
import './GuidesPage.css';
import './IReadPage.css';
import './IListenPage.css';

function Row({ listen }: { listen: ListenSummary }) {
  const pill = listenPill(listen, true);
  return (
    <li>
      <Link className="guides-page__row" to={listenPath(listen.id)}>
        <span className="guides-page__thumb ilisten-page__wave">
          <Icon name="wave" size="md" />
        </span>
        <span className="guides-page__text">
          <span className="guides-page__title">{listenTitle(listen)}</span>
          <LangChips listen={listen} facts="" withShares={false} />
        </span>
        <Chip tone={pill.tone}>{pill.label}</Chip>
      </Link>
    </li>
  );
}

/**
 * The page.
 * @returns The iListen home.
 */
export function IListenPage() {
  const { state, refresh } = useListens();
  const { add, isAdding, error } = useAddListen();
  const { target, setTarget } = useListenTarget();
  const navigate = useNavigate();
  return (
    <div className="guides-page">
      <PageHeader title={ILISTEN_COPY.section} />
      <FeaturesSwitch view="ilisten" />
      <section className="ilisten-page__add">
        <span className="ilisten-page__add-title">{ILISTEN_COPY.phoneTitle}</span>
        <span className="ilisten-page__add-body">{ILISTEN_COPY.phoneBody}</span>
        <label className="ilisten-page__field">
          <span>{ILISTEN_COPY.summaryIn}</span>
          <LanguageSelect value={target} onChange={setTarget} label={ILISTEN_COPY.summaryIn} className="ilisten-page__select" isDisabled={isAdding} />
        </label>
        <MediaPicker
          className={buttonClassName('primary', 'lg')}
          isDisabled={isAdding}
          onFile={(file) => {
            void add(file, target).then((id) => {
              if (id === null) return;
              refresh();
              void navigate(listenPath(id));
            });
          }}
        >
          {isAdding ? <Spinner /> : <Icon name="wave" size="md" />}
          {isAdding ? ILISTEN_COPY.uploading : ILISTEN_COPY.chooseFile}
        </MediaPicker>
        {error !== null && (
          <p className="iread-page__error" role="alert">
            {`${ILISTEN_COPY.addFailed}: ${error}`}
          </p>
        )}
      </section>
      <h2 className="iread-page__group">{ILISTEN_COPY.yourRecordings}</h2>
      {state.status === 'loading' && (
        <div className="guides-page__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading your recordings…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="recordings" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && <EmptyState icon="wave" title={ILISTEN_COPY.emptyTitle} body={ILISTEN_COPY.emptyBody} />}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="guides-page__list">
          {state.data.map((listen) => (
            <Row key={listen.id} listen={listen} />
          ))}
        </ul>
      )}
    </div>
  );
}
