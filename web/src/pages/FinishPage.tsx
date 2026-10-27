// Finish a story short (`/editor/:id/finish`): Privacy (blur the faces hidden in People, with how
// many of them appear in the cut), then "Render and publish", which starts the publish pack (all
// platforms) and opens Publish. The switch is saved at once; previews and renders made after
// follow it.
import { useNavigate, useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { LoadError } from '../components/LoadError';
import { pickBestVersion, shortName } from '../core/agent-trail';
import { PRODUCTION_COPY } from '../core/copy';
import { hiddenFacesLine } from '../core/hidden-faces';
import { BottomBar } from '../design/BottomBar';
import { Button } from '../design/Button';
import { Section } from '../design/Section';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { SwitchRow } from '../design/SwitchRow';
import { useShort } from '../hooks/useEditor';
import { useExports } from '../hooks/useExports';
import { useFinish } from '../hooks/useFinish';
import { usePeopleOverview } from '../hooks/useOverview';
import { PLATFORMS, type ShortDetail } from '../services/api/types';
import './FinishPage.css';

/** The clip of every shot of the best draft, in cut order. */
function shotClipIds(detail: ShortDetail): string[] {
  const n = pickBestVersion(detail.versions, detail.short.best_version);
  const version = detail.versions.find((v) => v.n === n);
  if (version === undefined) return [];
  return version.timeline.clips.flatMap((clip) => {
    const segment = detail.segments.find((s) => s.segment_id === clip.segment_id);
    return segment === undefined ? [] : [segment.clip_id];
  });
}

function Privacy({ detail }: { detail: ShortDetail }) {
  const { finish, update, isSaving } = useFinish(detail.short.short_id);
  const { state: people } = usePeopleOverview();
  const line =
    people.status === 'ready'
      ? hiddenFacesLine(
          people.data.hidden.map((face) => face.clip_id),
          shotClipIds(detail),
        )
      : 'Faces you hid in People';
  return (
    <Section title="Privacy">
      <SwitchRow
        title="Blur bystanders"
        description={line}
        checked={finish?.blur_bystanders ?? true}
        disabled={finish === null || isSaving}
        onChange={(on) => {
          void update({ blur_bystanders: on });
        }}
      />
    </Section>
  );
}

/**
 * The page.
 * @returns The Finish screen.
 */
export function FinishPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { state, refresh } = useShort(id);
  const exportsHandle = useExports(id);
  const back = `/editor/${encodeURIComponent(id)}`;
  const publish = `${back}/publish`;
  const hasPack = exportsHandle.state.status === 'ready' && exportsHandle.state.data.exports.length > 0;

  if (state.status === 'loading') {
    return (
      <div className="finish-page" aria-busy="true">
        <BackHeader title={PRODUCTION_COPY.finish} subtitle="" fallback={back} />
        <Skeleton kind="line" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="finish-page">
        <BackHeader title={PRODUCTION_COPY.finish} subtitle="" fallback={back} />
        <LoadError error={state.error} thing="short" onRetry={refresh} />
      </div>
    );
  }
  const detail = state.data;
  const shown = detail.versions.find((v) => v.n === pickBestVersion(detail.versions, detail.short.best_version));
  return (
    <div className="finish-page">
      <BackHeader title={PRODUCTION_COPY.finish} subtitle={shortName(shown)} fallback={back} />
      <Privacy detail={detail} />
      <BottomBar note="TikTok, Reels and Shorts at 9:16, the feed at the cut's frame">
        <Button
          size="lg"
          disabled={exportsHandle.state.status === 'loading'}
          onClick={() => {
            if (hasPack) {
              void navigate(publish);
              return;
            }
            void exportsHandle.start([...PLATFORMS]).then((started) => {
              if (started) void navigate(publish);
            });
          }}
        >
          {exportsHandle.state.status === 'loading' && <Spinner />}
          {PRODUCTION_COPY.renderAndPublish}
        </Button>
      </BottomBar>
    </div>
  );
}
