// TabBar primitive (Mist): four labelled tabs around a centre "+" button that opens the create
// sheet; the active tab and the "+" use the accent, and the "+" gains a ring while it is open.
import { NavLink, useLocation } from 'react-router';
import { Icon, type IconName } from './Icon';
import './TabBar.css';

/** One labelled tab. `match` lists extra path prefixes that keep it active. */
export interface TabItem {
  to: string;
  label: string;
  icon: IconName;
  match?: readonly string[];
}

/** Props for `TabBar`. */
export interface TabBarProps {
  /** Tabs left of the centre button. */
  left: readonly TabItem[];
  /** Tabs right of the centre button. */
  right: readonly TabItem[];
  /** The centre button: its accessible name, whether what it opens is showing, and the tap. */
  centre: { label: string; isActive: boolean; onClick: () => void };
}

/**
 * True when `path` belongs to the tab.
 * @param tab - The tab.
 * @param path - Current pathname.
 * @returns Whether the tab is active.
 */
export function isTabActive(tab: Pick<TabItem, 'to' | 'match'>, path: string): boolean {
  const prefixes = [tab.to, ...(tab.match ?? [])];
  return prefixes.some((prefix) => (prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`)));
}

function Tab({ tab, path }: { tab: TabItem; path: string }) {
  const isActive = isTabActive(tab, path);
  return (
    <NavLink
      to={tab.to}
      className={isActive ? 'tab-bar__tab tab-bar__tab--active' : 'tab-bar__tab'}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon name={tab.icon} />
      <span className="tab-bar__label">{tab.label}</span>
    </NavLink>
  );
}

/**
 * Bottom tab bar above the home indicator.
 * @param props - See `TabBarProps`.
 * @returns The nav element.
 */
export function TabBar({ left, right, centre }: TabBarProps) {
  const path = useLocation().pathname;
  return (
    <nav className="tab-bar" aria-label="Main">
      {left.map((tab) => (
        <Tab key={tab.to} tab={tab} path={path} />
      ))}
      <button
        type="button"
        className="tab-bar__centre"
        aria-label={centre.label}
        aria-haspopup="dialog"
        aria-expanded={centre.isActive}
        onClick={centre.onClick}
      >
        <span className={centre.isActive ? 'tab-bar__fab tab-bar__fab--active' : 'tab-bar__fab'}>
          <Icon name="plus" />
        </span>
      </button>
      {right.map((tab) => (
        <Tab key={tab.to} tab={tab} path={path} />
      ))}
    </nav>
  );
}
