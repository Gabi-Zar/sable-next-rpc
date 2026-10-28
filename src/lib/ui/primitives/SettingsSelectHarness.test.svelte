<script lang="ts">
  import Select from './Select.svelte';
  import { setSettingsChoices } from './Switcher.svelte';
  let {
    items,
    forceDropdown = false,
  }: {
    items: { value: string; label: string }[];
    forceDropdown?: boolean;
  } = $props();
  setSettingsChoices(true);
</script>

<Select {items} {forceDropdown} value={items[0].value} aria-label="Setting" />
