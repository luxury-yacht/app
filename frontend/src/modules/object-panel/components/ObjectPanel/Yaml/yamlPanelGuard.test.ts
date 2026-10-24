import { describe, expect, it } from 'vitest';
import { getYamlPanelBlockReason, hasUnsavedYamlEdits } from './yamlPanelGuard';
import { prepareDraftYaml } from './yamlTabUtils';

describe('YAML panel lifecycle guard', () => {
  it('blocks unsaved edits and saving but allows unchanged edits and clean views', () => {
    expect(
      getYamlPanelBlockReason({ isEditing: true, isSaving: false, hasUnsavedEdits: true })
    ).toBe('unsaved-yaml');
    expect(
      getYamlPanelBlockReason({ isEditing: true, isSaving: false, hasUnsavedEdits: false })
    ).toBeNull();
    expect(
      getYamlPanelBlockReason({ isEditing: false, isSaving: false, hasUnsavedEdits: true })
    ).toBeNull();
    expect(
      getYamlPanelBlockReason({ isEditing: true, isSaving: true, hasUnsavedEdits: false })
    ).toBe('mutation-in-flight');
  });
});

describe('hasUnsavedYamlEdits', () => {
  it('reports a draft that differs from the YAML editing began from', () => {
    expect(
      hasUnsavedYamlEdits(
        'kind: Pod\nmetadata:\n  name: changed\n',
        'kind: Pod\nmetadata:\n  name: original\n'
      )
    ).toBe(true);
    expect(hasUnsavedYamlEdits('kind: Pod\n', 'kind: Pod\n')).toBe(false);
  });

  it('does not treat fields omitted from the editable draft as user changes', () => {
    const source = `apiVersion: v1
kind: Pod
metadata:
  name: demo
  resourceVersion: "42"
  managedFields:
    - manager: kubelet
spec:
  containers: []
`;

    expect(hasUnsavedYamlEdits(prepareDraftYaml(source, false), source)).toBe(false);
  });
});
