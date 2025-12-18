import * as YAML from 'yaml';

export interface ObjectIdentity {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string | null;
  resourceVersion: string | null;
}

export interface ValidationSuccess {
  isValid: true;
  normalizedYAML: string;
  parsedObject: Record<string, unknown>;
  resourceVersion: string | null;
}

export interface ValidationFailure {
  isValid: false;
  message: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const ensureNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const extractLinePos = (error: YAML.YAMLParseError) => {
  const pos = error.linePos?.[0];
  if (!pos) return null;
  const { line, col } = pos as { line: number; col: number };
  return { line: line + 1, column: col + 1 };
};

const reportDocError = (doc: YAML.Document.Parsed) => {
  const parseError = doc.errors[0];
  if (!parseError) {
    return 'Invalid YAML document.';
  }
  const location = extractLinePos(parseError);
  if (!location) {
    return `Invalid YAML: ${parseError.message}`;
  }
  return `Invalid YAML at line ${location.line}, column ${location.column}: ${parseError.message}`;
};

const normalizeNamespace = (value: unknown): string | null => {
  if (!ensureNonEmptyString(value)) {
    return null;
  }
  return value;
};

const normalizeResourceVersion = (value: unknown): string | null => {
  if (!ensureNonEmptyString(value)) {
    return null;
  }
  return value;
};

export const parseObjectIdentity = (yamlContent: string): ObjectIdentity | null => {
  if (!ensureNonEmptyString(yamlContent)) {
    return null;
  }

  const docs = YAML.parseAllDocuments(yamlContent);
  if (docs.length === 0) {
    return null;
  }

  const [doc] = docs;
  if (doc.errors.length > 0) {
    return null;
  }

  const parsed = doc.toJSON();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const apiVersion = (parsed as Record<string, unknown>).apiVersion;
  const kind = (parsed as Record<string, unknown>).kind;
  const metadata = (parsed as Record<string, unknown>).metadata as
    | Record<string, unknown>
    | undefined;
  const name = metadata?.name;
  const namespace = normalizeNamespace(metadata?.namespace);
  const resourceVersion = normalizeResourceVersion(metadata?.resourceVersion);

  if (
    !ensureNonEmptyString(apiVersion) ||
    !ensureNonEmptyString(kind) ||
    !ensureNonEmptyString(name)
  ) {
    return null;
  }

  return {
    apiVersion,
    kind,
    name,
    namespace,
    resourceVersion,
  };
};

export const validateYamlDraft = (
  draft: string,
  expectedIdentity: ObjectIdentity | null,
  baselineResourceVersion: string | null
): ValidationResult => {
  if (!ensureNonEmptyString(draft)) {
    return {
      isValid: false,
      message: 'YAML content is required.',
    };
  }

  const docs = YAML.parseAllDocuments(draft);
  if (docs.length === 0) {
    return {
      isValid: false,
      message: 'YAML content cannot be empty.',
    };
  }

  if (docs.length > 1) {
    return {
      isValid: false,
      message: 'Multiple YAML documents detected. Please edit one object at a time.',
    };
  }

  const [doc] = docs;
  if (doc.errors.length > 0) {
    return {
      isValid: false,
      message: reportDocError(doc),
    };
  }

  const parsed = doc.toJSON();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      isValid: false,
      message: 'YAML must evaluate to a Kubernetes object (mapping).',
    };
  }

  const record = parsed as Record<string, unknown>;
  const apiVersion = record.apiVersion;
  const kind = record.kind;
  const metadataRaw = record.metadata;
  const metadata =
    (metadataRaw && typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)
      ? (metadataRaw as Record<string, unknown>)
      : undefined) ?? {};
  const name = metadata.name;
  const namespace = normalizeNamespace(metadata.namespace);
  const resourceVersion = normalizeResourceVersion(metadata.resourceVersion);

  if (!ensureNonEmptyString(apiVersion)) {
    return { isValid: false, message: 'Missing apiVersion.' };
  }
  if (!ensureNonEmptyString(kind)) {
    return { isValid: false, message: 'Missing kind.' };
  }
  if (!ensureNonEmptyString(name)) {
    return { isValid: false, message: 'Missing metadata.name.' };
  }

  if (kind === 'List') {
    return {
      isValid: false,
      message: 'Kubernetes List objects are not editable here. Select a specific resource instead.',
    };
  }

  if (expectedIdentity) {
    if (expectedIdentity.apiVersion !== apiVersion) {
      return {
        isValid: false,
        message: `apiVersion mismatch. Expected ${expectedIdentity.apiVersion}, found ${apiVersion}.`,
      };
    }
    if (expectedIdentity.kind !== kind) {
      return {
        isValid: false,
        message: `kind mismatch. Expected ${expectedIdentity.kind}, found ${kind}.`,
      };
    }
    if (expectedIdentity.name !== name) {
      return {
        isValid: false,
        message: `metadata.name mismatch. Expected ${expectedIdentity.name}, found ${name}.`,
      };
    }

    const expectedNamespace = expectedIdentity.namespace ?? null;
    const actualNamespace = namespace ?? null;
    if (expectedNamespace !== actualNamespace) {
      const expectedLabel = expectedNamespace ?? '<cluster-scoped>';
      const actualLabel = actualNamespace ?? '<cluster-scoped>';
      return {
        isValid: false,
        message: `metadata.namespace mismatch. Expected ${expectedLabel}, found ${actualLabel}.`,
      };
    }
  }

  if (!resourceVersion) {
    return {
      isValid: false,
      message:
        'metadata.resourceVersion is required for edits to avoid overwriting concurrent changes.',
    };
  }

  if (baselineResourceVersion && resourceVersion !== baselineResourceVersion) {
    return {
      isValid: false,
      message: `metadata.resourceVersion (${resourceVersion}) differs from the value when edit mode began (${baselineResourceVersion}). Reload to get the latest version before saving.`,
    };
  }

  return {
    isValid: true,
    normalizedYAML: doc.toString({ lineWidth: 0 }),
    parsedObject: record,
    resourceVersion,
  };
};
