import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon16(props: IconProps) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props} />;
}

export function OverviewIcon() {
  return (
    <Icon16>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    </Icon16>
  );
}

export function SupervisionIcon() {
  return (
    <Icon16>
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </Icon16>
  );
}

export function AnalyticsIcon() {
  return (
    <Icon16>
      <rect x="1.6" y="9" width="3" height="5.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6.5" y="5.4" width="3" height="9" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.4" y="1.8" width="3" height="12.6" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </Icon16>
  );
}

export function UsersIcon() {
  return (
    <Icon16>
      <circle cx="6.4" cy="5.2" r="2.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.8 14c0-2.6 2-4.3 4.6-4.3s4.6 1.7 4.6 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.6 3.2a2.5 2.5 0 0 1 0 4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </Icon16>
  );
}

export function PagesIcon() {
  return (
    <Icon16>
      <rect x="1.6" y="2.4" width="12.8" height="11.2" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.6 6.2h12.8" stroke="currentColor" strokeWidth="1.4" />
    </Icon16>
  );
}

export function SettingsIcon() {
  return (
    <Icon16>
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 2.6" />
    </Icon16>
  );
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.8" stroke="#A2A8B3" strokeWidth="1.5" />
      <path d="M10.6 10.6 14 14" stroke="#A2A8B3" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <Icon16>
      <path d="M4 6.6a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z" stroke="#3F4653" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.6 13a1.6 1.6 0 0 0 2.8 0" stroke="#3F4653" strokeWidth="1.4" strokeLinecap="round" />
    </Icon16>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="m2 4 3 3 3-3" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Instagram outline; takes its colour from the surrounding tone (`currentColor`). */
export function InstagramGlyph({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.4" y="2.4" width="15.2" height="15.2" rx="4.6" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="14.6" cy="5.5" r="1.05" fill="currentColor" />
    </svg>
  );
}
