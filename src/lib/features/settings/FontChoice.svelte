<script lang="ts">
  import { tick } from 'svelte';
  import { i18n } from '#lib/i18n.js';
  import SettingsAnchorLink from '#lib/ui/primitives/SettingsAnchorLink.svelte';
  import Select from '#lib/ui/primitives/Select.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';

  interface Props {
    id: string;
    title: string;
    hint: string;
    value: string;
    systemFamily: string;
    example: string;
    onValueChange: (value: string) => void;
  }

  let { id, title, hint, value, systemFamily, example, onValueChange }: Props = $props();
  let editingCustom = $state(false);
  let customDraft = $state('');
  const mode = $derived(
    editingCustom
      ? 'custom'
      : value.trim().toLowerCase() === systemFamily
        ? 'system'
        : value.trim()
          ? 'custom'
          : 'default'
  );
  const items = $derived([
    { value: 'default', label: i18n.t('settings.fontDefault') },
    { value: 'system', label: i18n.t('common.system') },
    { value: 'custom', label: i18n.t('settings.fontCustom') },
  ]);

  async function choose(next: string): Promise<void> {
    if (mode === 'custom') customDraft = value;
    editingCustom = next === 'custom';
    onValueChange(next === 'default' ? '' : next === 'system' ? systemFamily : customDraft);
    if (next === 'custom') {
      await tick();
      document.getElementById(`${id}-name`)?.focus();
    }
  }
</script>

<div class="font-choice" role="group" aria-labelledby={`${id}-label`}>
  <div class="settings-heading-row">
    <label id={`${id}-label`} for={id}>{title}</label>
    <SettingsAnchorLink anchor={id} />
  </div>
  <Select {id} {items} value={mode} aria-label={title} onValueChange={choose} />
  <p class="settings-note">{hint}</p>
  {#if mode === 'custom'}
    <label for={`${id}-name`}>{i18n.t('settings.fontName')}</label>
    <TextInput
      id={`${id}-name`}
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      {value}
      placeholder={example}
      aria-describedby={`${id}-hint`}
      oninput={(event) => {
        editingCustom = true;
        customDraft = event.currentTarget.value;
        onValueChange(customDraft);
      }}
    />
    <p id={`${id}-hint`} class="settings-note">{i18n.t('settings.fontCustomHint')}</p>
  {/if}
</div>

<style>
  .font-choice {
    display: grid;
    gap: var(--space-150);
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }

  label {
    font-size: var(--font-size-label);
    font-weight: var(--font-weight-medium);
  }
</style>
