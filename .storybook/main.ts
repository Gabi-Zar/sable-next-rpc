import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
  framework: '@storybook/sveltekit',
  stories: ['../src/lib/ui/**/*.stories.svelte', '../src/lib/features/**/*.stories.svelte'],
  addons: ['@storybook/addon-svelte-csf', '@storybook/addon-docs', '@storybook/addon-a11y'],
  staticDirs: ['../static'],
};

export default config;
