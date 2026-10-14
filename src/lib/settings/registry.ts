import type { Component } from 'svelte';
import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUpIcon';
import GifIcon from 'phosphor-svelte/lib/GifIcon';
import GridFourIcon from 'phosphor-svelte/lib/GridFourIcon';
import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
import SpeakerHighIcon from 'phosphor-svelte/lib/SpeakerHighIcon';
import SmileyIcon from 'phosphor-svelte/lib/SmileyIcon';
import UsersIcon from 'phosphor-svelte/lib/UsersIcon';
import type { FreeTextPreference, Preferences, RangePreference } from './preferences.svelte';
import { appearanceCategory } from './registry/appearance';
import { callsCategory } from './registry/calls';
import { composerCategory } from './registry/composer';
import { desktopCategories } from './registry/desktop';
import { developerCategory } from './registry/developer';
import { mediaCategory } from './registry/media';
import { notificationsCategory } from './registry/notifications';
import { personasCategory } from './registry/personas';
import { privacyCategory } from './registry/privacy';
import { timelineCategory } from './registry/timeline';

export { enterSettingLabels } from './registry/composer';

export type BooleanPreference = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

export type SelectPreference = Exclude<
  {
    [K in keyof Preferences]: Preferences[K] extends string ? K : never;
  }[keyof Preferences],
  FreeTextPreference
>;

export interface SettingOption {
  value: string;
  label: string;
  literal?: true;
}

interface BaseSetting {
  name: string;
  icon: Component;
  description?: string;
  section: string;
  /** Rendered disabled until this preference is on. */
  gatedBy?: BooleanPreference;
  /** The feature behind this setting does not exist yet; shown disabled. */
  unavailable?: true;
  /** Left out entirely where the platform has nothing for it to switch. */
  supported?: () => boolean;
  terms?: readonly string[];
  requiresReload?: true;
  panel?: true;
}

export interface BooleanSetting extends BaseSetting {
  type: 'boolean';
  key: BooleanPreference;
  onChange?: (value: boolean) => void;
}

export interface SelectSetting extends BaseSetting {
  type: 'select';
  key: SelectPreference;
  options: SettingOption[];
  getValue?: () => string;
  setValue?: (value: string) => void;
  onChange?: (value: string) => void;
}

export interface RangeSetting extends BaseSetting {
  type: 'range';
  key: RangePreference;
  step: number;
  applyOnCommit?: true;
  onChange?: (value: number) => void;
}

export type SettingDefinition = BooleanSetting | SelectSetting | RangeSetting;
export type SettingType = SettingDefinition['type'];

export interface SettingsSectionDefinition {
  id: string;
  name: string;
}

export interface SettingsCategory {
  id: string;
  name: string;
  description?: string;
  icon: Component;
  sections: SettingsSectionDefinition[];
  items: SettingDefinition[];
}

/** The one settings section that is not preference-driven. */
export const SETTINGS_DEVICES_SECTION = 'devices';
/** Stored as account data on the homeserver. */
export const SETTINGS_ACCOUNT_SECTION = 'account';
export const SETTINGS_EMOTES_SECTION = 'emotes';

export const STANDALONE_PAGE_NAMES: Partial<Record<string, string>> = {
  [SETTINGS_DEVICES_SECTION]: 'settings.security',
  keyboard: 'settings.keyboard',
  about: 'settings.about',
};

const MERGED_SECTIONS: Record<string, string> = {
  accessibility: 'appearance',
  sync: SETTINGS_ACCOUNT_SECTION,
  time: 'timeline',
  updates: 'about',
};

export function canonicalSection(id: string): string {
  return MERGED_SECTIONS[id] ?? id;
}

export function findCategory(id: string | undefined): SettingsCategory | undefined {
  return settingsCategories.find((category) => category.id === id);
}

/** Stable anchor for `/settings/<category>?focus=<id>` permalinks. */
export function settingFocusId(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function findSettingsSection(
  id: string
): { category: SettingsCategory; section: SettingsSectionDefinition } | undefined {
  for (const category of settingsCategories) {
    const section = category.sections.find((entry) => entry.id === id);
    if (section) return { category, section };
  }
  return undefined;
}

export function findSettingByFocusId(
  focus: string
): { category: SettingsCategory; setting: SettingDefinition } | undefined {
  for (const category of settingsCategories) {
    const setting = category.items.find((item) => settingFocusId(item.key) === focus);
    if (setting) return { category, setting };
  }
  return undefined;
}

export const settingsCategories: SettingsCategory[] = [
  {
    id: SETTINGS_ACCOUNT_SECTION,
    name: 'settings.account',
    icon: CloudArrowUpIcon,
    sections: [
      { id: 'profile-changes', name: 'settings.profileChangesTitle' },
      { id: 'sync', name: 'settings.syncTitle' },
    ],
    items: [
      {
        key: 'profileChangePropagation',
        section: 'profile-changes',
        icon: UsersIcon,
        name: 'settings.profileChangePropagation',
        type: 'select',
        options: [
          { value: 'all', label: 'settings.profileChangePropagationAll' },
          { value: 'unchanged', label: 'settings.profileChangePropagationUnchanged' },
          { value: 'none', label: 'settings.profileChangePropagationNone' },
        ],
      },
      {
        key: 'settingsSync',
        section: 'sync',
        icon: CloudArrowUpIcon,
        name: 'settings.settingsSync',
        description: 'settings.settingsSyncHint',
        type: 'boolean',
      },
      {
        key: 'syncDrafts',
        section: 'sync',
        icon: PencilSimpleIcon,
        name: 'settings.syncDrafts',
        description: 'settings.syncDraftsHint',
        type: 'boolean',
        gatedBy: 'settingsSync',
      },
    ],
  },
  {
    id: SETTINGS_EMOTES_SECTION,
    name: 'settings.emotes',
    icon: SmileyIcon,
    sections: [
      { id: 'emoji-images', name: 'settings.groups.emojiImages' },
      { id: 'gif-picker', name: 'settings.groups.gifPicker' },
    ],
    items: [
      {
        key: 'twitterEmoji',
        section: 'emoji-images',
        icon: SmileyIcon,
        name: 'settings.twitterEmoji',
        terms: ['settings.terms.twitterEmoji'],
        type: 'boolean',
      },
      {
        key: 'pixelatedImages',
        section: 'emoji-images',
        icon: GridFourIcon,
        name: 'settings.pixelatedImages',
        description: 'settings.pixelatedImagesHint',
        type: 'select',
        options: [
          { value: 'always', label: 'common.always' },
          { value: 'smart', label: 'settings.pixelatedImagesSmart' },
          { value: 'never', label: 'common.never' },
        ],
      },
      {
        key: 'gifProvider',
        section: 'gif-picker',
        icon: GifIcon,
        name: 'settings.gifProvider',
        type: 'select',
        options: [
          { value: 'default', label: 'settings.gifProviderDefault' },
          { value: 'klipy', label: 'settings.gifProviderKlipy' },
          { value: 'tenor', label: 'settings.gifProviderTenor' },
          { value: 'giphy', label: 'settings.gifProviderGiphy' },
        ],
      },
    ],
  },
  appearanceCategory,
  timelineCategory,
  composerCategory,
  privacyCategory,
  mediaCategory,
  notificationsCategory,
  callsCategory,
  {
    id: 'sounds',
    name: 'sounds.title',
    icon: SpeakerHighIcon,
    sections: [{ id: 'volumes', name: 'sounds.volumeCategory' }],
    items: [],
  },
  personasCategory,
  ...desktopCategories,
  developerCategory,
];
