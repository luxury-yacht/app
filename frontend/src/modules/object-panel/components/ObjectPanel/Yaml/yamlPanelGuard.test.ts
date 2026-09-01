import { describe, expect, it } from 'vitest';
import { getYamlPanelBlockReason } from './yamlPanelGuard';

describe('YAML panel lifecycle guard', () => {
  it('blocks changed drafts and saving but allows unchanged edits and clean views', () => {
    expect(
      getYamlPanelBlockReason({
        isEditing: true,
        isSaving: false,
        draftYaml: 'kind: Pod\nmetadata:\n  name: changed\n',
        baselineYaml: 'kind: Pod\nmetadata:\n  name: original\n',
      })
    ).toBe('unsaved-yaml');
    expect(
      getYamlPanelBlockReason({
        isEditing: true,
        isSaving: false,
        draftYaml: 'kind: Pod\n',
        baselineYaml: 'kind: Pod\n',
      })
    ).toBeNull();
    expect(
      getYamlPanelBlockReason({
        isEditing: true,
        isSaving: true,
        draftYaml: 'kind: Pod\n',
        baselineYaml: 'kind: Pod\n',
      })
    ).toBe('mutation-in-flight');
  });
});
