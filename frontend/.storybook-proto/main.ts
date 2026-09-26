import base from '../.storybook/main';

export default {
  ...base,
  stories: ['../src/ui/shortcuts/components/ShortcutHelpModal.debug.stories.tsx'],
  typescript: { ...(base as { typescript?: object }).typescript, reactDocgen: false },
};
