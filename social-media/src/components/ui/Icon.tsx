import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

import { palette } from '@/theme';

/**
 * Icon set. Feather matches the design's thin geometric glyphs, and the alias
 * map keeps screens talking about roles ("priority", "sync") rather than glyph
 * names - so the icon set can be swapped in one place.
 */
const aliases = {
  // Tab bar
  home: 'home',
  publications: 'file-text',
  comments: 'message-circle',
  analytics: 'pie-chart',
  more: 'more-horizontal',

  // Actions
  add: 'plus',
  sync: 'refresh-cw',
  refresh: 'rotate-cw',
  regenerate: 'refresh-cw',
  search: 'search',
  filter: 'sliders',
  calendar: 'calendar',
  edit: 'edit-2',
  editProfile: 'edit-3',
  delete: 'trash-2',
  copy: 'copy',
  send: 'send',
  save: 'check',
  close: 'x',
  back: 'chevron-left',
  forward: 'chevron-right',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  external: 'external-link',
  logout: 'log-out',
  settings: 'settings',
  moreVertical: 'more-vertical',

  // Media
  image: 'image',
  camera: 'camera',
  files: 'folder',
  replace: 'repeat',

  // Status & meaning
  notification: 'bell',
  priority: 'alert-triangle',
  urgent: 'alert-octagon',
  ai: 'zap',
  check: 'check',
  checkCircle: 'check-circle',
  cross: 'x-circle',
  clock: 'clock',
  scheduled: 'clock',
  draft: 'file',
  published: 'check-circle',
  failed: 'x-octagon',
  offline: 'wifi-off',
  lock: 'lock',
  shield: 'shield',
  eye: 'eye',
  eyeOff: 'eye-off',
  info: 'info',
  empty: 'inbox',
  user: 'user',
  brand: 'award',
  legal: 'file-text',
  trending: 'trending-up',
  trendingDown: 'trending-down',
  escalate: 'corner-up-right',
  ignore: 'slash',
  link: 'link-2',
  reach: 'users',
  reactions: 'heart',
  shares: 'share-2',
  impressions: 'eye',
} as const;

export type IconName = keyof typeof aliases;

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  style?: ComponentProps<typeof Feather>['style'];
};

export function Icon({ name, size = 18, color = palette.ink, style }: IconProps) {
  return <Feather name={aliases[name]} size={size} color={color} style={style} />;
}
