import ChatTextIcon from 'phosphor-svelte/lib/ChatTextIcon';
import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
import TextAaIcon from 'phosphor-svelte/lib/TextAaIcon';
import UserSwitchIcon from 'phosphor-svelte/lib/UserSwitchIcon';
import ListNumbersIcon from 'phosphor-svelte/lib/ListNumbersIcon';
import type { SettingsCategory } from '../registry';

export const personasCategory: SettingsCategory = {
  id: 'personas',
  name: 'personas.title',
  icon: UserSwitchIcon,
  sections: [{ id: 'persona-sending', name: 'settings.groups.sending' }],
  items: [
    {
      key: 'personaPicker',
      section: 'persona-sending',
      icon: UserSwitchIcon,
      name: 'personas.picker',
      type: 'boolean',
    },
    {
      key: 'personaPickerSortOrder',
      section: 'persona-sending',
      icon: ListNumbersIcon,
      name: 'personas.pickerSortOrder',
      type: 'select',
      options: [
        { value: 'manual', label: 'common.sortManual' },
        { value: 'alphabetical-asc', label: 'common.sortNameAsc' },
        { value: 'alphabetical-desc', label: 'common.sortNameDesc' },
        { value: 'recent', label: 'personas.sortNameRecentlyUsed' },
      ],
      gatedBy: 'personaPicker',
    },
    {
      key: 'personaPickerLeftSide',
      section: 'persona-sending',
      icon: PushPinIcon,
      name: 'personas.pickerLeftSide',
      type: 'boolean',
      gatedBy: 'personaPicker',
    },
    {
      key: 'personaProxying',
      section: 'persona-sending',
      icon: ChatTextIcon,
      name: 'personas.proxying',
      description: 'personas.proxyingHint',
      type: 'boolean',
    },
    {
      key: 'personaLatching',
      section: 'persona-sending',
      icon: PushPinIcon,
      name: 'personas.latching',
      type: 'select',
      options: [
        { value: 'off', label: 'common.never' },
        { value: 'room', label: 'personas.scopeLatchRoom' },
        { value: 'account', label: 'personas.scopeLatchAccount' },
      ],
      gatedBy: 'personaProxying',
    },
    {
      key: 'personaFallback',
      section: 'persona-sending',
      icon: TextAaIcon,
      name: 'personas.fallback',
      type: 'boolean',
    },
  ],
};
