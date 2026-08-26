import CustomMetadataColumnEditor, {
  type CustomMetadataColumnEditorState,
} from '@shared/components/tables/CustomMetadataColumnEditor';
import { createCustomMetadataColumnDefinition } from '@shared/components/tables/customMetadataColumns';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(() => () => undefined),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: runtimeMocks.eventsOn,
}));

describe('CustomMetadataColumnEditor', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    runtimeMocks.eventsOn.mockReset().mockReturnValue(() => undefined);
  });

  const renderEditor = async (
    state: CustomMetadataColumnEditorState,
    definitions = [
      createCustomMetadataColumnDefinition({
        source: 'annotation',
        metadataKey: 'example.com/revision',
        header: 'Revision',
      }),
    ],
    onChange = vi.fn()
  ) => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <CustomMetadataColumnEditor
            state={state}
            definitions={definitions}
            onChange={onChange}
            onClose={vi.fn()}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    return { definitions, onChange };
  };

  const changeInput = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('creates a source-specific column and derives its initial heading', async () => {
    const { onChange } = await renderEditor({ mode: 'create' }, []);
    const inputs = document.querySelectorAll<HTMLInputElement>('.modal-input');

    await changeInput(inputs[0], 'app.kubernetes.io/owner');

    expect(inputs[1].value).toBe('Owner');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    expect(onChange).toHaveBeenCalledWith([
      {
        key: 'metadata:label:app.kubernetes.io/owner',
        source: 'label',
        metadataKey: 'app.kubernetes.io/owner',
        header: 'Owner',
      },
    ]);
  });

  it('blocks a duplicate source and metadata key', async () => {
    const existing = createCustomMetadataColumnDefinition({
      source: 'label',
      metadataKey: 'example.com/owner',
      header: 'Owner',
    });
    const { onChange } = await renderEditor({ mode: 'create' }, [existing]);
    const keyInput = document.querySelector<HTMLInputElement>('.modal-input');

    if (!keyInput) {
      throw new Error('expected metadata key input');
    }
    await changeInput(keyInput, 'example.com/owner');

    expect(document.body.textContent).toContain('Already added');
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renames and removes an existing column without changing its identity', async () => {
    const definition = createCustomMetadataColumnDefinition({
      source: 'annotation',
      metadataKey: 'example.com/revision',
      header: 'Revision',
    });
    const { onChange } = await renderEditor({ mode: 'edit', definition }, [definition]);
    const headingInput = document.querySelectorAll<HTMLInputElement>('.modal-input')[1];

    await changeInput(headingInput, 'Release revision');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    expect(onChange).toHaveBeenLastCalledWith([{ ...definition, header: 'Release revision' }]);

    await renderEditor({ mode: 'edit', definition }, [definition], onChange);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.custom-metadata-column-editor__remove')?.click();
    });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
