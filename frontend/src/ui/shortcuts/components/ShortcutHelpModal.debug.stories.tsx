/**
 * THROWAWAY diagnosis harness for the Keyboard Shortcuts modal scroll report.
 * Renders the real modal with a Logs-tab-sized set of registrations.
 */

import type { Meta, StoryObj } from '@storybook/react';
import { KeyboardProvider, useShortcuts } from '@ui/shortcuts';
import { useMemo } from 'react';
import type { ShortcutModifiers } from '@/types/shortcuts';
import { ShortcutHelpModal } from './ShortcutHelpModal';

type Def = { key: string; description: string; category: string; modifiers?: ShortcutModifiers };

const cmd = { meta: true };
const DEFS: Def[] = [
  ...['Next control in region', 'Previous control in region', 'Focus next region', 'Focus previous region'].map(
    (description, i) => ({ key: `Tab${i}`, description, category: 'Navigation' })
  ),
  ...['Details', 'Logs', 'Events', 'YAML', 'Map', 'Shell'].map((label, i) => ({
    key: String(i + 1),
    description: `Switch to ${label} tab`,
    category: 'Navigation',
  })),
  ...['New Window', 'Open Cluster', 'Close', 'Close overlay/panel', 'Minimize', 'Toggle Sidebar', 'Quit'].map(
    (description, i) => ({ key: `w${i}`, modifiers: cmd, description, category: 'Windows & Panels' })
  ),
  ...['Zoom In', 'Zoom Out', 'Reset Zoom'].map((description, i) => ({
    key: `z${i}`,
    modifiers: cmd,
    description,
    category: 'Zoom',
  })),
  ...['Refresh current view', 'Diff Objects'].map((description, i) => ({
    key: `d${i}`,
    modifiers: cmd,
    description,
    category: 'Resource Data',
  })),
  ...[
    'Toggle auto-refresh',
    'Scroll container logs to top',
    'Scroll container logs to bottom',
    'Toggle API timestamps',
    'Toggle previous logs',
    'Toggle match highlighting',
    'Toggle inverse filtering',
    'Toggle regex filtering',
    'Toggle case-sensitive matching',
    'Toggle Parse/Raw mode',
    'Toggle pretty JSON',
    'Toggle ANSI colors',
    'Toggle text wrap',
    'Copy container logs to clipboard',
  ].map((description, i) => ({ key: `l${i}`, description, category: 'Logs' })),
  ...['Settings…', 'Show keyboard shortcuts help', 'Application Logs', 'Diagnostics Panel'].map(
    (description, i) => ({ key: `s${i}`, modifiers: cmd, description, category: 'Settings & Tools' })
  ),
];

const Registrar = () => {
  const shortcuts = useMemo(() => DEFS.map((def) => ({ ...def, handler: () => false })), []);
  useShortcuts(shortcuts);
  return null;
};

const meta: Meta = { title: 'Debug/ShortcutHelpModal', parameters: { layout: 'fullscreen' } };
export default meta;

export const Scroll: StoryObj = {
  render: () => (
    <KeyboardProvider>
      <Registrar />
      <ShortcutHelpModal isOpen onClose={() => undefined} />
    </KeyboardProvider>
  ),
};
