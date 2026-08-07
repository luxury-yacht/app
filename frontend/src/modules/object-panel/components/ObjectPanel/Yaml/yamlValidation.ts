/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlValidation.ts
 */

import * as YAML from 'yaml';

export interface ObjectIdentity {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string | null;
  uid: string | null;
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
  if (!pos) {
    return null;
  }
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

const normalizeUID = (value: unknown): string | null => {
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
  const uid = normalizeUID(metadata?.uid);
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
    uid,
    resourceVersion,
  };
};

const validationFailure = (message: string): ValidationFailure => ({ isValid: false, message });

type ParsedDocumentResult = { isValid: true; document: YAML.Document.Parsed } | ValidationFailure;

const parseSingleYamlDocument = (draft: string): ParsedDocumentResult => {
  if (!ensureNonEmptyString(draft)) {
    return validationFailure('YAML content is required.');
  }
  const documents = YAML.parseAllDocuments(draft);
  if (documents.length === 0) {
    return validationFailure('YAML content cannot be empty.');
  }
  if (documents.length > 1) {
    return validationFailure('Multiple YAML documents detected. Please edit one object at a time.');
  }
  const document = documents[0];
  if (document.errors.length > 0) {
    return validationFailure(reportDocError(document));
  }
  return { isValid: true, document };
};

const yamlObjectRecord = (document: YAML.Document.Parsed): Record<string, unknown> | null => {
  const parsed = document.toJSON();
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
};

const yamlMetadata = (record: Record<string, unknown>): Record<string, unknown> => {
  const metadata = record.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
};

type ValidatedDraftIdentity = {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string | null;
  uid: string | null;
  resourceVersion: string | null;
};

type DraftIdentityResult = { isValid: true; identity: ValidatedDraftIdentity } | ValidationFailure;

const extractDraftIdentity = (record: Record<string, unknown>): DraftIdentityResult => {
  const metadata = yamlMetadata(record);
  const apiVersion = record.apiVersion;
  const kind = record.kind;
  const name = metadata.name;
  if (!ensureNonEmptyString(apiVersion)) {
    return validationFailure('Missing apiVersion.');
  }
  if (!ensureNonEmptyString(kind)) {
    return validationFailure('Missing kind.');
  }
  if (!ensureNonEmptyString(name)) {
    return validationFailure('Missing metadata.name.');
  }
  if (kind === 'List') {
    return validationFailure(
      'Kubernetes List objects are not editable here. Select a specific resource instead.'
    );
  }
  return {
    isValid: true,
    identity: {
      apiVersion,
      kind,
      name,
      namespace: normalizeNamespace(metadata.namespace),
      uid: normalizeUID(metadata.uid),
      resourceVersion: normalizeResourceVersion(metadata.resourceVersion),
    },
  };
};

const validateExpectedIdentity = (
  actual: ValidatedDraftIdentity,
  expected: ObjectIdentity
): ValidationFailure | null => {
  if (expected.apiVersion !== actual.apiVersion) {
    return validationFailure(
      `apiVersion mismatch. Expected ${expected.apiVersion}, found ${actual.apiVersion}.`
    );
  }
  if (expected.kind !== actual.kind) {
    return validationFailure(`kind mismatch. Expected ${expected.kind}, found ${actual.kind}.`);
  }
  if (expected.name !== actual.name) {
    return validationFailure(
      `metadata.name mismatch. Expected ${expected.name}, found ${actual.name}.`
    );
  }
  if ((expected.namespace ?? null) !== actual.namespace) {
    const expectedLabel = expected.namespace ?? '<cluster-scoped>';
    const actualLabel = actual.namespace ?? '<cluster-scoped>';
    return validationFailure(
      `metadata.namespace mismatch. Expected ${expectedLabel}, found ${actualLabel}.`
    );
  }
  if (expected.uid && actual.uid && expected.uid !== actual.uid) {
    return validationFailure(
      `metadata.uid mismatch. Expected ${expected.uid}, found ${actual.uid}.`
    );
  }
  return null;
};

export const validateYamlDraft = (
  draft: string,
  expectedIdentity: ObjectIdentity | null,
  _baselineResourceVersion: string | null
): ValidationResult => {
  const parsedDocument = parseSingleYamlDocument(draft);
  if (!parsedDocument.isValid) {
    return parsedDocument;
  }
  const record = yamlObjectRecord(parsedDocument.document);
  if (!record) {
    return validationFailure('YAML must evaluate to a Kubernetes object (mapping).');
  }
  const draftIdentity = extractDraftIdentity(record);
  if (!draftIdentity.isValid) {
    return draftIdentity;
  }
  const identityMismatch = expectedIdentity
    ? validateExpectedIdentity(draftIdentity.identity, expectedIdentity)
    : null;
  if (identityMismatch) {
    return identityMismatch;
  }

  return {
    isValid: true,
    normalizedYAML: parsedDocument.document.toString({ lineWidth: 0 }),
    parsedObject: record,
    resourceVersion: draftIdentity.identity.resourceVersion,
  };
};
