// TabBar primitive: fixed bottom navigation for the app's top-level sections.
import { NavLink } from 'react-router';
import { Icon, type IconName } from './Icon';
import './TabBar.css';

/** One tab: route, label and icon. */
export interface TabItem {
  /** Route path the tab opens. */
  to: string;
  /** Visible label (also the accessible name). */
  label: string;
  /** Icon drawn above the label. */
  icon: IconName;
}

/** Props for `TabBar`. */
export interface TabBarProps {
  /** Tabs in display order; `to` must be unique. */
  items: readonly TabItem[];
}

/**
 * Bottom tab bar that sits above the home indicator; the active tab uses the accent.
 * @param props - See `TabBarProps`.
 * @returns The nav element.
 */
export function TabBar({ items }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => (isActive ? 'tab-bar__tab tab-bar__tab--active' : 'tab-bar__tab')}
        >
          <Icon name={item.icon} />
          <span className="tab-bar__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
