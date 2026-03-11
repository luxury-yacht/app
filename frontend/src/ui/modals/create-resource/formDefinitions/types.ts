/**
 * Type definitions for declarative resource creation forms.
 *
 * Each definition describes which YAML paths map to which form fields.
 * The generic ResourceForm renderer uses these definitions to render
 * the appropriate inputs.
 */

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  /** Unique field identifier within the definition. */
  key: string;
  /** Display label shown next to the input. */
  label: string;
  /** YAML path to read/write this field's value, e.g. ['spec', 'replicas']. */
  path: string[];
  /** Input type. */
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'namespace-select'
    | 'textarea'
    | 'key-value-list'
    | 'selector-list'
    | 'group-list'
    | 'container-resources'
    | 'volume-source'
    | 'tri-state-boolean'
    | 'boolean-toggle'
    | 'string-list'
    | 'command-input'
    | 'probe';
  /** Placeholder text for text/number inputs. */
  placeholder?: string;
  /** Optional minimum value for number inputs. */
  min?: number;
  /** Optional maximum value for number inputs. */
  max?: number;
  /** Whether number values must be integers. */
  integer?: boolean;
  /** Whether this field is required. */
  required?: boolean;
  /** Options for 'select' type fields. */
  options?: FormFieldOption[];
  /** Custom parser for the raw input value before persisting (e.g., string to integer). */
  parseValue?: (rawValue: string) => unknown;
  /** Custom formatter for converting the stored value to a display string. */
  formatValue?: (value: unknown) => string;
  /** Sub-field definitions for 'group-list' type fields. */
  fields?: FormFieldDefinition[];
  /** Default value for the field when creating a new list item. */
  defaultValue?: unknown;
  /** Additional map paths kept in sync with this field's map value. */
  mirrorPaths?: string[][];
  /** Map path whose keys should be excluded from this field's editable rows. */
  excludedKeysSourcePath?: string[];
  /** If true, empty string values are removed from YAML instead of persisted. */
  omitIfEmpty?: boolean;
  /**
   * Alternate YAML path for text fields with a toggle (e.g., subPath/subPathExpr).
   * When set, a toggle checkbox is shown that switches between path and alternatePath.
   */
  alternatePath?: string[];
  /** Label for the alternate path toggle checkbox (e.g., 'Use Expression'). */
  alternateLabel?: string;
  /**
   * YAML path to an array whose items provide dynamic options for select fields.
   * The renderer reads this path from the document root and extracts option values.
   */
  dynamicOptionsPath?: string[];
  /** Field name within each dynamic options item to use as value and label. */
  dynamicOptionsField?: string;

  // --- Renderer configuration ---
  // These properties let the form definition control renderer behavior
  // that was previously hardcoded against specific field keys.

  /** Whether to include an empty "-----" option in select dropdowns. Defaults true. */
  includeEmptyOption?: boolean;
  /** Implicit default value for select fields when none is set in YAML (e.g., 'TCP'). */
  implicitDefault?: string;
  /** Sub-field key used as the group-list card header title (e.g., 'name' for containers). */
  itemTitleField?: string;
  /** Fallback title shown when itemTitleField value is empty (e.g., 'Container'). */
  itemTitleFallback?: string;
  /** Label for the add button in lists (e.g., 'Add Label'). */
  addLabel?: string;
  /** Ghost helper text shown next to empty-state add actions. */
  addGhostText?: string;
  /** Ghost text shown when adding is disabled (e.g., dynamic options are empty). */
  disabledGhostText?: string;
  /** Whether key-value rows render with inline "Key"/"Value" labels. */
  inlineLabels?: boolean;
  /** Whether empty-state add actions are left-aligned. */
  leftAlignEmptyActions?: boolean;
  /** Whether new entries use blank keys instead of auto-generated 'key-N' names. */
  blankNewKeys?: boolean;

  // --- Tri-state boolean ---
  // Used by 'tri-state-boolean' fields (e.g., volume source optional/readOnly).

  /** Label shown when value is undefined/null. */
  emptyLabel?: string;
  /** Label for the true option. */
  trueLabel?: string;
  /** Label for the false option. */
  falseLabel?: string;

  // --- Layout / sizing ---
  // Drive input widths and nested-list layout from the definition
  // instead of coupling CSS selectors to specific data-field-key values.

  /** Fixed CSS width for the input element (e.g., '6ch', 'calc(5ch + 20px)'). */
  inputWidth?: string;
  /** Fixed CSS width for the dropdown wrapper (e.g., 'calc(5ch + 40px)'). */
  dropdownWidth?: string;
  /** Flex shorthand for nested group-list field wrappers (e.g., '0 0 auto', '0 0 100%'). */
  fieldFlex?: string;
  /** Use wide gap between nested group-list fields (var(--spacing-xl) instead of default). */
  fieldGap?: 'wide';
  /** Wrap nested group-list fields to multiple lines. */
  wrapFields?: boolean;
  /** Align nested group-list rows to the start (top) instead of center. */
  rowAlign?: 'start';
  /** Minimum width for nested field labels (e.g., '4rem'). */
  labelWidth?: string;
  /** Whether this field should use full-width layout (spanning the entire section). */
  fullWidth?: boolean;
  /** Group this field with the next field on the same row (shares a single FormFieldRow). */
  groupWithNext?: boolean;
  /** Tooltip text shown via a circled "i" icon next to the label. */
  tooltip?: string;
  /** Indent this field so it appears as a child of the field above. Hides the label and uses empty space in its place. */
  indented?: boolean;
  /** Additional YAML paths to unset when this field is cleared (e.g., parent object paths). */
  clearPaths?: string[][];
  /** YAML paths to unset when specific values are selected (e.g., remove rollingUpdate when Recreate). */
  clearPathsOnValues?: Record<string, string[][]>;
  /** Only show this field when the value at the given YAML path matches one of the listed values. */
  visibleWhen?: {
    path: string[];
    values: string[];
  };
}

export interface FormSectionDefinition {
  /** Section heading displayed above the fields. */
  title: string;
  /** Fields in this section. */
  fields: FormFieldDefinition[];
  /** Override min-width for field labels in this section (e.g., '10rem'). */
  labelWidth?: string;
}

export interface ResourceFormDefinition {
  /** Kubernetes kind this form applies to. */
  kind: string;
  /** Sections of the form, rendered top-to-bottom. */
  sections: FormSectionDefinition[];
}
