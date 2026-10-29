// The Mac's Ask box in the universal search strip (Phase 27 mocks; it replaced the SearchBar
// board's 38 px field in the same dock and slot). Typing still opens the results popover above
// it: Speech, Moments, then the clips, shorts and projects whose titles match, and "See all N
// results in the Gallery". ↑/↓ pick a row and ⏎ opens it; ⏎ with no row picked sends the request
// to Muse Spark, which reads it as a search (all results open), or a plan card above the box (a
// short, a guide, an upload, clips into a project, or "Did you mean…"). ⌘⏎ shows everything in
// the Gallery, Esc closes. + adds Gallery clips to the request or uploads; the mic is hold to talk.
// The shell provides `MacSearchProvider` (the focus action every screen reads through
// `useFocusSearch`, ⌘K from anywhere, the slot and the Ask queue) and draws `MacSearchDock` once:
// a page drawn in columns offers a slot in its middle column; any other page gets the bar at the
// bottom of the shell's page area.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { pillLabel, shownJob } from '../../core/ask/jobs';
import { ASK_CLIPS_MAX, intentTag, isAddClipsChoice, type PlanContext } from '../../core/ask/plan';
import { formatDuration } from '../../core/format';
import {
  BAR_MIN_QUERY,
  BAR_ROWS_PER_GROUP,
  barItems,
  EVERYTHING,
  hasShellSearchBar,
  highlightParts,
  itemPath,
  matchRanges,
  moveIndex,
  queryWords,
  scopeLabel,
  type BarChip,
  type BarHit,
  type BarItem,
  type SearchScope,
} from '../../core/search-bar';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { Spinner } from '../../design/Spinner';
import { useAsk } from '../../hooks/useAsk';
import { useClips } from '../../hooks/useClips';
import { usePickAndUpload } from '../../hooks/useDesktop';
import { BAR_DEBOUNCE_MS, MacSearchSlotContext, useBarResults, useDebounced, type RegisterSearchSlot } from '../../hooks/useMacSearch';
import { useMenu } from '../../hooks/useMenu';
import { useProjects } from '../../hooks/useProjects';
import { useRecentQueries } from '../../hooks/useSearch';
import { SearchBarContext, useFocusSearch } from '../../hooks/useSearchBar';
import type { ClipSummary, Project } from '../../services/api/types';
import { PickClipsSheet } from './AddClipsSheet';
import { AskPlanCard, type AskCardBox } from './AskPlanCard';
import { AskProvider } from './AskProvider';
import { AskQueuePill } from './AskQueuePill';
import { MacAskBox } from './MacAskBox';
import { projectColorClass, ProjectSwatch } from './ProjectSwatch';
import './MacSearchBar.css';

/** The bar's shared state: its input, what is typed, the clips added, and the slot it is drawn into. */
interface BarStore {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (draft: string) => void;
  /** The clips added with +, in the order they were added. */
  attached: readonly ClipSummary[];
  setAttached: (clips: readonly ClipSummary[]) => void;
  slot: HTMLElement | null;
}

const BarStoreContext = createContext<BarStore | null>(null);

/**
 * Wraps the Mac shell: provides the focus action, ⌘K from anywhere, the slot registration and
 * the Ask queue.
 * @param props - The shell.
 * @returns The providers.
 */
export function MacSearchProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<readonly ClipSummary[]>([]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const focus = useCallback((query?: string) => {
    if (query !== undefined) setDraft(query);
    // A bar that moves into a new page's slot is drawn on this render; focus it once it is there.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [focus]);
  const register = useCallback<RegisterSearchSlot>((element) => {
    if (element === null) return undefined;
    setSlot(element);
    return () => {
      setSlot((current) => (current === element ? null : current));
    };
  }, []);
  const store = useMemo(() => ({ inputRef, draft, setDraft, attached, setAttached, slot }), [draft, attached, slot]);
  return (
    <SearchBarContext.Provider value={focus}>
      <MacSearchSlotContext.Provider value={register}>
        <BarStoreContext.Provider value={store}>
          <AskProvider>{children}</AskProvider>
        </BarStoreContext.Provider>
      </MacSearchSlotContext.Provider>
    </SearchBarContext.Provider>
  );
}

/**
 * Draws the bar: into the page's slot when it offers one, else at the bottom of the shell's page
 * area (except on the pages that keep their own bottom action bar).
 * @returns The bar, or nothing.
 */
export function MacSearchDock() {
  const store = useContext(BarStoreContext);
  const path = useLocation().pathname;
  if (store === null) return null;
  if (store.slot !== null) return createPortal(<MacSearchBar store={store} />, store.slot);
  if (!hasShellSearchBar(path)) return null;
  return (
    <div className="mac-search-dock">
      <MacSearchBar store={store} />
    </div>
  );
}

/** The scope menu: the four kinds, then every project with its colour. */
function scopeEntries(scope: SearchScope, projects: readonly Project[], pick: (scope: SearchScope) => void): MenuEntry[] {
  const kinds: SearchScope[] = [EVERYTHING, { kind: 'speech' }, { kind: 'moments' }, { kind: 'faces' }];
  const kindEntries = kinds.map(
    (each): MenuEntry => ({
      kind: 'check',
      label: scopeLabel(each),
      isChecked: scope.kind === each.kind,
      onSelect: () => {
        pick(each);
      },
    }),
  );
  const projectEntries = projects.map(
    (project): MenuEntry => ({
      kind: 'check',
      label: project.name,
      isChecked: scope.kind === 'project' && scope.projectId === project.project_id,
      swatchClass: projectColorClass(project.color),
      onSelect: () => {
        pick({ kind: 'project', projectId: project.project_id, name: project.name });
      },
    }),
  );
  return projectEntries.length === 0 ? kindEntries : [...kindEntries, { kind: 'separator' }, ...projectEntries];
}

/**
 * The scope: what the owner picked, else the project the Gallery is kept to ("Search in this
 * project" opens `/?project=`), else Everything. A pick belongs to the project scope it was made
 * under, so a new "Search in this project" starts from that project again.
 */
function useScope(projects: readonly Project[]): [SearchScope, (scope: SearchScope) => void] {
  const location = useLocation();
  const [params] = useSearchParams();
  const urlProjectId = location.pathname === '/' ? params.get('project') : null;
  const [picked, setPicked] = useState<{ at: string | null; scope: SearchScope } | null>(null);
  const urlProject = urlProjectId === null ? undefined : projects.find((project) => project.project_id === urlProjectId);
  const fromUrl: SearchScope =
    urlProject === undefined ? EVERYTHING : { kind: 'project', projectId: urlProject.project_id, name: urlProject.name };
  const scope = picked !== null && picked.at === urlProjectId ? picked.scope : fromUrl;
  const pick = useCallback(
    (next: SearchScope) => {
      setPicked({ at: urlProjectId, scope: next });
    },
    [urlProjectId],
  );
  return [scope, pick];
}

/** The popover's index while no row is picked. */
const NO_ROW = -1;

const NO_CLIPS: readonly ClipSummary[] = [];

/** Handles a key from the input for the open popover; returns true when it used it. */
type KeyHandler = (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;

/** What sits above the box: the results, the + menu, the pill's list, or the card. */
type Above = 'popover' | 'plus' | 'list' | 'card' | null;

function MacSearchBar({ store }: { store: BarStore }) {
  const { inputRef, draft, setDraft, attached, setAttached } = store;
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { record } = useRecentQueries();
  const { state: projectsState } = useProjects();
  const projects = useMemo(() => (projectsState.status === 'ready' ? projectsState.data : []), [projectsState]);
  const { state: clipsState } = useClips();
  const clips = clipsState.status === 'ready' ? clipsState.data : NO_CLIPS;
  const [scope, pick] = useScope(projects);
  const [isFocused, setFocused] = useState(false);
  const menu = useMenu();
  const focusBar = useFocusSearch();
  const keysRef = useRef<KeyHandler | null>(null);
  const ask = useAsk();
  const { pick: pickUpload } = usePickAndUpload();
  const [isPlusOpen, setPlusOpen] = useState(false);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const [isListOpen, setListOpen] = useState(false);
  /** A request waiting for clips: an add-clips choice sends it again once clips are added. */
  const [resend, setResend] = useState<string | null>(null);
  /** The text just sent: the popover stays shut until the text changes. */
  const [sentText, setSentText] = useState<string | null>(null);
  /** The text last read as a search, for its tag. */
  const [searchedText, setSearchedText] = useState<string | null>(null);
  const query = useDebounced(draft.trim(), BAR_DEBOUNCE_MS);
  const isOpen = isFocused && !isPlusOpen && draft !== sentText && draft.trim().length >= BAR_MIN_QUERY && query.length >= BAR_MIN_QUERY;
  const job = shownJob(ask.jobs, ask.openId);
  const hasList = isListOpen && pillLabel(ask.jobs) !== null;
  let above: Above = null;
  if (isOpen) above = 'popover';
  else if (isPlusOpen) above = 'plus';
  else if (hasList) above = 'list';
  else if (job !== null) above = 'card';
  const ctx = useMemo<PlanContext>(
    () => ({
      projectName: (id) => projects.find((project) => project.project_id === id)?.name ?? null,
      projectClipCount: (id) => projects.find((project) => project.project_id === id)?.clip_count ?? null,
    }),
    [projects],
  );
  const clean = draft.trim();
  let tag: string | null = null;
  if (job !== null && job.text === clean) tag = intentTag(job.intent.kind);
  else if (clean !== '' && searchedText === clean) tag = intentTag('search');

  // "Search in this project" lands on `/?project=` without a query: the cursor goes to the bar.
  const landedInProject = location.pathname === '/' && params.has('project') && !params.has('q');
  useEffect(() => {
    if (landedInProject) inputRef.current?.focus();
  }, [landedInProject, location.key, inputRef]);

  const go = (item: BarItem) => {
    if (item.kind === 'all') {
      if (clean !== '') record(clean);
    } else {
      setDraft('');
    }
    inputRef.current?.blur();
    void navigate(itemPath(item, clean, scope));
  };

  const send = (text: string, clipIds: readonly string[]) => {
    const request = text.trim();
    if (request === '' || ask.isReading) return;
    setSentText(text);
    void ask.send(request, clipIds, scope).then((sent) => {
      if (sent !== 'search') return;
      setSearchedText(request);
      inputRef.current?.blur();
    });
  };
  const sendDraft = () => {
    send(draft, attached.map((clip) => clip.clip_id));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isPlusOpen) setPlusOpen(false);
      else inputRef.current?.blur();
      return;
    }
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault();
      if (clean !== '') go({ kind: 'all' });
      return;
    }
    if (isOpen && keysRef.current?.(event) === true) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendDraft();
    }
  };

  const cardBox: AskCardBox = {
    onCleared: () => {
      setDraft('');
      setAttached([]);
      setSentText(null);
    },
    onEdit: (text) => {
      setDraft(text);
      setSentText(null);
      focusBar();
    },
    onChoice: (choiceJob, choice) => {
      ask.dismiss(choiceJob.id);
      setDraft(choice.text);
      if (isAddClipsChoice(choice, choiceJob.text)) {
        setResend(choice.text);
        setPlusOpen(true);
        return;
      }
      send(choice.text, choiceJob.addedClipIds);
    },
    onFocusBox: () => {
      focusBar();
    },
  };

  const addClips = (picked: ClipSummary[]) => {
    setSheetOpen(false);
    setAttached(picked);
    if (resend === null) {
      focusBar();
      return;
    }
    setResend(null);
    send(resend, picked.map((clip) => clip.clip_id));
  };

  return (
    <div className="mac-search">
      <div className="mac-ask">
        <div className="mac-ask__above">
          {above === 'popover' && <SearchPopover query={query} scope={scope} keysRef={keysRef} onGo={go} />}
          {above === 'plus' && (
            <div className="mac-ask__plus" role="menu" aria-label="Add to your request">
              <button
                type="button"
                role="menuitem"
                className="mac-ask__plus-item"
                onClick={() => {
                  setPlusOpen(false);
                  setSheetOpen(true);
                }}
              >
                <Icon name="grid" size="sm" />
                Add clips from Gallery…
              </button>
              <button
                type="button"
                role="menuitem"
                className="mac-ask__plus-item"
                onClick={() => {
                  setPlusOpen(false);
                  setResend(null);
                  void pickUpload();
                }}
              >
                <Icon name="upload" size="sm" />
                Upload from Mac…
              </button>
              <span className="mac-ask__plus-note">Added clips tell nimbytes what to use</span>
            </div>
          )}
          {above === 'card' && job !== null && <AskPlanCard job={job} ctx={ctx} clips={clips} box={cardBox} />}
          {above !== 'popover' && above !== 'plus' && <AskQueuePill isListOpen={above === 'list'} onListOpen={setListOpen} />}
        </div>
        <MacAskBox
          inputRef={inputRef}
          draft={draft}
          onDraft={setDraft}
          isPopoverOpen={isOpen}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          chips={attached}
          onRemoveChip={(clipId) => {
            setAttached(attached.filter((clip) => clip.clip_id !== clipId));
          }}
          isPlusOpen={isPlusOpen}
          onPlus={() => {
            setPlusOpen(!isPlusOpen);
          }}
          tag={tag}
          scopeLabel={scopeLabel(scope)}
          onScope={menu.openFromButton}
          isSending={ask.isReading}
          onSend={sendDraft}
        />
      </div>
      <Menu
        anchor={menu.anchor}
        label="Search in"
        className="mac-search__menu"
        items={scopeEntries(scope, projects, (next) => {
          pick(next);
          focusBar();
        })}
        onClose={menu.close}
      />
      <PickClipsSheet
        open={isSheetOpen}
        added={attached.map((clip) => clip.clip_id)}
        max={ASK_CLIPS_MAX}
        onPick={addClips}
        onClose={() => {
          setSheetOpen(false);
          setResend(null);
        }}
      />
    </div>
  );
}

/** A line with the query's words in the accent. */
function Highlighted({ text, words }: { text: string; words: readonly string[] }) {
  return highlightParts(text, matchRanges(text, words)).map((part, index) =>
    part.isMatch ? (
      <b key={index} className="mac-search__match">
        {part.text}
      </b>
    ) : (
      part.text
    ),
  );
}

interface RowProps {
  hit: BarHit;
  words: readonly string[];
  isActive: boolean;
  onPick: () => void;
  onHover: () => void;
}

function HitRow({ hit, words, isActive, onPick, onHover }: RowProps) {
  return (
    <div role="option" aria-selected={isActive} className="mac-search__row" onClick={onPick} onMouseMove={onHover}>
      {hit.result.thumb_url === null ? (
        <span className="mac-search__thumb" aria-hidden="true" />
      ) : (
        <img className="mac-search__thumb" src={hit.result.thumb_url} alt="" />
      )}
      <span className="mac-search__text">
        <span className="mac-search__line">
          {hit.kind === 'speech' ? (
            <>
              “<Highlighted text={hit.line} words={words} />”
            </>
          ) : (
            <Highlighted text={hit.line} words={words} />
          )}
        </span>
        <span className="mac-search__meta">
          {`${hit.result.clip_title} · `}
          <span className="mac-search__time">{formatDuration(hit.at)}</span>
        </span>
      </span>
      {isActive && (
        <kbd className="mac-search__enter" aria-hidden="true">
          ⏎
        </kbd>
      )}
    </div>
  );
}

function ChipIcon({ chip }: { chip: BarChip }) {
  if (chip.kind === 'project') return chip.color === null ? null : <ProjectSwatch color={chip.color} />;
  return <Icon name={chip.kind === 'clip' ? 'film' : 'scissors'} size="xs" />;
}

/** Props for `SearchPopover`. */
interface PopoverProps {
  query: string;
  scope: SearchScope;
  /** Where the popover puts its key handler for the input. */
  keysRef: RefObject<KeyHandler | null>;
  onGo: (item: BarItem) => void;
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p className="mac-search__status" role="status">
      {children}
    </p>
  );
}

function SearchPopover({ query, scope, keysRef, onGo }: PopoverProps) {
  const state = useBarResults(query, scope);
  const words = useMemo(() => queryWords(query), [query]);
  const resetKey = `${query}|${scopeLabel(scope)}`;
  // No row is picked until ↑/↓, so ⏎ sends the request instead of opening the first row.
  const [active, setActive] = useState({ key: resetKey, index: NO_ROW });
  const index = active.key === resetKey ? active.index : NO_ROW;
  const view = state.status === 'done' ? state.view : null;
  const items = useMemo(() => (view === null ? [] : barItems(view)), [view]);
  const hasRows = view !== null && (view.speech.length > 0 || view.moments.length > 0 || view.chips.length > 0);

  useLayoutEffect(() => {
    keysRef.current = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = index === NO_ROW ? (step === 1 ? 0 : items.length - 1) : moveIndex(index, items.length, step);
        setActive({ key: resetKey, index: next });
        return true;
      }
      const item = items[index];
      if (event.key === 'Enter' && hasRows && item !== undefined) {
        event.preventDefault();
        onGo(item);
        return true;
      }
      return false;
    };
    return () => {
      keysRef.current = null;
    };
  }, [keysRef, items, index, resetKey, hasRows, onGo]);

  const rowProps = (item: BarItem, at: number) => ({
    isActive: at === index,
    onPick: () => {
      onGo(item);
    },
    onHover: () => {
      if (at !== index) setActive({ key: resetKey, index: at });
    },
  });

  let body: ReactNode;
  if (state.status === 'idle' || state.status === 'searching') {
    body = (
      <Status>
        <Spinner />
        Searching your clips…
      </Status>
    );
  } else if (state.status === 'error') {
    body = <Status>{`Search did not finish: ${state.message}`}</Status>;
  } else if (view === null || !hasRows) {
    body = <Status>No moments found. Try other words: what you saw, what someone said, or who was there.</Status>;
  } else {
    const speech = view.speech.slice(0, BAR_ROWS_PER_GROUP);
    const moments = view.moments.slice(0, BAR_ROWS_PER_GROUP);
    const chipStart = speech.length + moments.length;
    const allAt = items.length - 1;
    body = (
      <>
        {speech.length > 0 && <span className="mac-search__group">{`Speech · ${String(view.speech.length)}`}</span>}
        {speech.map((hit, at) => (
          <HitRow key={hit.result.segment_id} hit={hit} words={words} {...rowProps({ kind: 'hit', hit }, at)} />
        ))}
        {moments.length > 0 && <span className="mac-search__group">{`Moments · ${String(view.moments.length)}`}</span>}
        {moments.map((hit, at) => (
          <HitRow key={hit.result.segment_id} hit={hit} words={words} {...rowProps({ kind: 'hit', hit }, speech.length + at)} />
        ))}
        {view.chips.length > 0 && (
          <>
            <span className="mac-search__group">Clips, shorts and projects</span>
            <div className="mac-search__chips">
              {view.chips.map((chip, at) => {
                const props = rowProps({ kind: 'chip', chip }, chipStart + at);
                return (
                  <div
                    key={`${chip.kind}:${chip.id}`}
                    role="option"
                    aria-selected={props.isActive}
                    className="mac-search__chip"
                    onClick={props.onPick}
                    onMouseMove={props.onHover}
                  >
                    <ChipIcon chip={chip} />
                    <span className="mac-search__chip-label">{chip.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {(() => {
          const props = rowProps({ kind: 'all' }, allAt);
          return (
            <div role="option" aria-selected={props.isActive} className="mac-search__all" onClick={props.onPick} onMouseMove={props.onHover}>
              {`See all ${String(view.total)} ${view.total === 1 ? 'result' : 'results'} in the Gallery`}
              <kbd className="mac-search__all-kbd">⌘⏎</kbd>
            </div>
          );
        })()}
      </>
    );
  }
  return (
    <div
      id="mac-search-results"
      className="mac-search__popover"
      role="listbox"
      aria-label="Search results"
      onMouseDown={(event) => {
        // Keeps the cursor in the bar, so a click lands on the row before the popover closes.
        event.preventDefault();
      }}
    >
      {body}
    </div>
  );
}
