import CustomMetadataColumnEditor, {
	type CustomMetadataColumnEditorState,
} from "@shared/components/tables/CustomMetadataColumnEditor";
import { createCustomMetadataColumnDefinition } from "@shared/components/tables/customMetadataColumns";
import { KeyboardProvider } from "@ui/shortcuts";
import { act } from "react";
import * as ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	eventsOn: vi.fn(() => () => undefined),
}));

vi.mock("@core/desktop-runtime", () => ({
	desktopRuntimeAvailable: () => false,
	onEvent: runtimeMocks.eventsOn,
}));

describe("CustomMetadataColumnEditor", () => {
	let container: HTMLDivElement;
	let root: ReactDOM.Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = ReactDOM.createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		document.body.innerHTML = "";
		runtimeMocks.eventsOn.mockReset().mockReturnValue(() => undefined);
	});

	const renderEditor = async (
		state: CustomMetadataColumnEditorState,
		definitions = [
			createCustomMetadataColumnDefinition({
				source: "annotation",
				metadataKey: "example.com/revision",
				header: "Revision",
			}),
		],
		onChange = vi.fn(),
		availableKeys = [
			{
				source: "label" as const,
				metadataKey: "app.kubernetes.io/owner",
				sampleValues: ["platform", "payments"],
			},
			{
				source: "label" as const,
				metadataKey: "example.com/owner",
				sampleValues: ["platform"],
			},
			{
				source: "annotation" as const,
				metadataKey: "example.com/revision",
				sampleValues: ["7", "8"],
			},
		],
	) => {
		await act(async () => {
			root.render(
				<KeyboardProvider>
					<CustomMetadataColumnEditor
						state={state}
						definitions={definitions}
						availableKeys={availableKeys}
						onChange={onChange}
						onClose={vi.fn()}
					/>
				</KeyboardProvider>,
			);
			await Promise.resolve();
		});
		return { definitions, onChange };
	};

	const changeInput = async (input: HTMLInputElement, value: string) => {
		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			valueSetter?.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};

	const selectMetadataKey = async (key: string) => {
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Metadata Key"]')
				?.click();
		});
		const option = Array.from(
			document.body.querySelectorAll<HTMLElement>(".dropdown-option"),
		).find((candidate) => candidate.textContent?.includes(key));
		if (!option) {
			throw new Error(`expected metadata key option ${key}`);
		}
		await act(async () => option.click());
	};

	it("groups metadata keys, previews sample values, and derives its initial heading", async () => {
		const { onChange } = await renderEditor({ mode: "create" }, []);
		const headingInput =
			document.querySelector<HTMLInputElement>(".modal-input");

		expect(document.body.textContent).toContain(
			"Select a metadata Label or Annotation to use as a custom column.",
		);
		expect(document.body.textContent).not.toContain(
			"Values come from the exact metadata key.",
		);
		expect(document.body.textContent).toContain("Column name");
		expect(document.body.textContent).not.toContain("Column heading");
		expect(document.querySelector('input[value="label"]')).toBeNull();
		expect(document.querySelector('input[value="annotation"]')).toBeNull();
		await selectMetadataKey("app.kubernetes.io/owner");

		expect(document.body.textContent).toContain("Sample values");
		expect(document.body.textContent).toContain("platform");
		expect(document.body.textContent).toContain("payments");
		expect(headingInput?.value).toBe("Owner");
		expect(
			document.querySelector<HTMLButtonElement>('button[type="submit"]')
				?.textContent,
		).toBe("Add");
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[type="submit"]')
				?.click();
		});
		expect(onChange).toHaveBeenCalledWith([
			{
				key: "metadata:label:app.kubernetes.io/owner",
				source: "label",
				metadataKey: "app.kubernetes.io/owner",
				header: "Owner",
			},
		]);
	});

	it("blocks a duplicate source and metadata key", async () => {
		const existing = createCustomMetadataColumnDefinition({
			source: "label",
			metadataKey: "example.com/owner",
			header: "Owner",
		});
		const { onChange } = await renderEditor({ mode: "create" }, [existing]);
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Metadata Key"]')
				?.click();
		});
		const duplicateOption = Array.from(
			document.body.querySelectorAll<HTMLElement>(".dropdown-option"),
		).find((candidate) => candidate.textContent?.includes("example.com/owner"));

		expect(duplicateOption?.classList.contains("disabled")).toBe(true);
		expect(
			document.querySelector<HTMLButtonElement>('button[type="submit"]')
				?.disabled,
		).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("shows labels and annotations in one dropdown under separate groups", async () => {
		await renderEditor({ mode: "create" }, []);
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Metadata Key"]')
				?.click();
		});

		const groupLabels = Array.from(
			document.body.querySelectorAll<HTMLElement>(".dropdown-group-header"),
		).map((group) => group.textContent);
		expect(groupLabels).toEqual(["Labels", "Annotations"]);
		expect(document.body.textContent).toContain("example.com/revision");
		expect(document.body.textContent).toContain("app.kubernetes.io/owner");
	});

	it("explains when no metadata keys are available in the current table rows", async () => {
		await renderEditor({ mode: "create" }, [], vi.fn(), []);

		expect(
			document.querySelector<HTMLButtonElement>(
				'button[aria-label="Metadata Key"]',
			)?.textContent,
		).toContain("No metadata keys available");
		expect(document.body.textContent).toContain(
			"No label or annotation keys are available in the current rows.",
		);
		expect(
			document.querySelector<HTMLButtonElement>('button[type="submit"]')
				?.disabled,
		).toBe(true);
	});

	it("renames and removes an existing column without changing its identity", async () => {
		const definition = createCustomMetadataColumnDefinition({
			source: "annotation",
			metadataKey: "example.com/revision",
			header: "Revision",
		});
		const { onChange } = await renderEditor({ mode: "edit", definition }, [
			definition,
		]);
		const headingInput =
			document.querySelector<HTMLInputElement>(".modal-input");
		if (!headingInput) {
			throw new Error("expected column heading input");
		}
		expect(document.body.textContent).not.toContain(
			"Renaming keeps the column’s width, order, visibility, and favorite reference.",
		);

		await changeInput(headingInput, "Release revision");
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>('button[type="submit"]')
				?.click();
		});
		expect(onChange).toHaveBeenLastCalledWith([
			{ ...definition, header: "Release revision" },
		]);

		await renderEditor({ mode: "edit", definition }, [definition], onChange);
		await act(async () => {
			document
				.querySelector<HTMLButtonElement>(
					".custom-metadata-column-editor__remove",
				)
				?.click();
		});
		expect(onChange).toHaveBeenLastCalledWith([]);
	});
});
