/**
 * frontend/src/ui/modals/create-resource/FormAffinityField.tsx
 *
 * Affinity editor for Kubernetes resource creation. Handles the deeply nested
 * affinity structure with three sections: Node Affinity, Pod Affinity, and
 * Pod Anti-Affinity. Each section supports required and preferred rules with
 * match expressions.
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

// ─── Types ──────────────────────────────────────────────────────────────

type AffinityValue = Record<string, unknown>;

interface FormAffinityFieldProps {
  dataFieldKey: string;
  value: AffinityValue;
  onChange: (newValue: AffinityValue) => void;
}

/** A single match expression entry. */
interface MatchExpression {
  key: string;
  operator: string;
  values: string[];
}

/** A node selector term (used in node affinity required rules). */
interface NodeSelectorTerm {
  matchExpressions: MatchExpression[];
}

/** A node affinity preferred rule with weight and preference. */
interface NodePreferredRule {
  weight: number;
  preference: {
    matchExpressions: MatchExpression[];
  };
}

/** A pod affinity/anti-affinity required rule. */
interface PodRequiredRule {
  labelSelector: {
    matchExpressions: MatchExpression[];
  };
  topologyKey: string;
}

/** A pod affinity/anti-affinity preferred rule. */
interface PodPreferredRule {
  weight: number;
  podAffinityTerm: {
    labelSelector: {
      matchExpressions: MatchExpression[];
    };
    topologyKey: string;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Operators available for node affinity expressions. */
const NODE_OPERATORS = [
  { value: 'In', label: 'In' },
  { value: 'NotIn', label: 'NotIn' },
  { value: 'Exists', label: 'Exists' },
  { value: 'DoesNotExist', label: 'DoesNotExist' },
  { value: 'Gt', label: 'Gt' },
  { value: 'Lt', label: 'Lt' },
];

/** Operators available for pod affinity/anti-affinity expressions. */
const POD_OPERATORS = [
  { value: 'In', label: 'In' },
  { value: 'NotIn', label: 'NotIn' },
  { value: 'Exists', label: 'Exists' },
  { value: 'DoesNotExist', label: 'DoesNotExist' },
];

/** Operators that do not take values. */
const VALUELESS_OPERATORS = new Set(['Exists', 'DoesNotExist']);

/** Default new match expression. */
const DEFAULT_EXPRESSION: MatchExpression = { key: '', operator: 'In', values: [] };

// ─── Helpers ────────────────────────────────────────────────────────────

/** Parse comma-separated values string into a trimmed array. */
function parseValues(raw: string): string[] {
  if (raw.trim() === '') return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/** Join values array into comma-separated display string. */
function joinValues(values: string[]): string {
  return values.join(', ');
}

/** Safely cast an unknown value to an array, defaulting to empty. */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Deep-clone a value using structured clone for immutability. */
function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Check whether the entire affinity value is effectively empty
 * (no rules in any section). If so, return {} to prune from YAML.
 */
function pruneEmptyAffinity(affinity: AffinityValue): AffinityValue {
  const result: AffinityValue = {};
  let hasContent = false;

  // Check nodeAffinity.
  const nodeAffinity = affinity.nodeAffinity as Record<string, unknown> | undefined;
  if (nodeAffinity) {
    const nodeResult: Record<string, unknown> = {};
    let nodeHasContent = false;

    const required = nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution as
      | { nodeSelectorTerms?: NodeSelectorTerm[] }
      | undefined;
    if (required?.nodeSelectorTerms && required.nodeSelectorTerms.length > 0) {
      nodeResult.requiredDuringSchedulingIgnoredDuringExecution = required;
      nodeHasContent = true;
    }

    const preferred = nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution as
      | NodePreferredRule[]
      | undefined;
    if (preferred && preferred.length > 0) {
      nodeResult.preferredDuringSchedulingIgnoredDuringExecution = preferred;
      nodeHasContent = true;
    }

    if (nodeHasContent) {
      result.nodeAffinity = nodeResult;
      hasContent = true;
    }
  }

  // Check podAffinity and podAntiAffinity.
  for (const sectionKey of ['podAffinity', 'podAntiAffinity'] as const) {
    const section = affinity[sectionKey] as Record<string, unknown> | undefined;
    if (section) {
      const sectionResult: Record<string, unknown> = {};
      let sectionHasContent = false;

      const required = section.requiredDuringSchedulingIgnoredDuringExecution as
        | PodRequiredRule[]
        | undefined;
      if (required && required.length > 0) {
        sectionResult.requiredDuringSchedulingIgnoredDuringExecution = required;
        sectionHasContent = true;
      }

      const preferred = section.preferredDuringSchedulingIgnoredDuringExecution as
        | PodPreferredRule[]
        | undefined;
      if (preferred && preferred.length > 0) {
        sectionResult.preferredDuringSchedulingIgnoredDuringExecution = preferred;
        sectionHasContent = true;
      }

      if (sectionHasContent) {
        result[sectionKey] = sectionResult;
        hasContent = true;
      }
    }
  }

  return hasContent ? result : {};
}

// ─── Extraction Helpers ─────────────────────────────────────────────────

/** Extract node affinity required rules (nodeSelectorTerms). */
function getNodeRequiredTerms(value: AffinityValue): NodeSelectorTerm[] {
  const nodeAffinity = value.nodeAffinity as Record<string, unknown> | undefined;
  if (!nodeAffinity) return [];
  const required = nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution as
    | { nodeSelectorTerms?: unknown }
    | undefined;
  if (!required) return [];
  return toArray<NodeSelectorTerm>(required.nodeSelectorTerms);
}

/** Extract node affinity preferred rules. */
function getNodePreferredRules(value: AffinityValue): NodePreferredRule[] {
  const nodeAffinity = value.nodeAffinity as Record<string, unknown> | undefined;
  if (!nodeAffinity) return [];
  return toArray<NodePreferredRule>(nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution);
}

/** Extract pod affinity or anti-affinity required rules. */
function getPodRequiredRules(
  value: AffinityValue,
  sectionKey: 'podAffinity' | 'podAntiAffinity'
): PodRequiredRule[] {
  const section = value[sectionKey] as Record<string, unknown> | undefined;
  if (!section) return [];
  return toArray<PodRequiredRule>(section.requiredDuringSchedulingIgnoredDuringExecution);
}

/** Extract pod affinity or anti-affinity preferred rules. */
function getPodPreferredRules(
  value: AffinityValue,
  sectionKey: 'podAffinity' | 'podAntiAffinity'
): PodPreferredRule[] {
  const section = value[sectionKey] as Record<string, unknown> | undefined;
  if (!section) return [];
  return toArray<PodPreferredRule>(section.preferredDuringSchedulingIgnoredDuringExecution);
}

// ─── Component ──────────────────────────────────────────────────────────

/**
 * FormAffinityField — renders the full affinity editor with Node Affinity,
 * Pod Affinity, and Pod Anti-Affinity sections. Each section supports
 * required and preferred scheduling rules with match expressions.
 */
export function FormAffinityField({
  dataFieldKey,
  value,
  onChange,
}: FormAffinityFieldProps): React.ReactElement {
  // ── Rebuild & emit helper ───────────────────────────────────────────

  /**
   * Build a new affinity value by replacing a specific part and emitting
   * the change. Prunes empty sections so the parent can omit the field.
   */
  const emitChange = (next: AffinityValue) => {
    onChange(pruneEmptyAffinity(next));
  };

  // ── Node affinity handlers ──────────────────────────────────────────

  const nodeRequiredTerms = getNodeRequiredTerms(value);
  const nodePreferredRules = getNodePreferredRules(value);

  /** Add a new node required rule with a default expression. */
  const handleAddNodeRequiredRule = () => {
    const terms = cloneDeep(nodeRequiredTerms);
    terms.push({ matchExpressions: [{ ...DEFAULT_EXPRESSION }] });
    const next = cloneDeep(value);
    if (!next.nodeAffinity) next.nodeAffinity = {};
    (next.nodeAffinity as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
      { nodeSelectorTerms: terms };
    emitChange(next);
  };

  /** Remove a node required rule by index. */
  const handleRemoveNodeRequiredRule = (ruleIdx: number) => {
    const terms = cloneDeep(nodeRequiredTerms);
    terms.splice(ruleIdx, 1);
    const next = cloneDeep(value);
    if (terms.length === 0) {
      // Remove the required section entirely.
      const nodeAffinity = next.nodeAffinity as Record<string, unknown>;
      delete nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
      if (Object.keys(nodeAffinity).length === 0) delete next.nodeAffinity;
    } else {
      (
        next.nodeAffinity as Record<string, unknown>
      ).requiredDuringSchedulingIgnoredDuringExecution = { nodeSelectorTerms: terms };
    }
    emitChange(next);
  };

  /** Add an expression to a node required rule. */
  const handleAddNodeReqExpr = (ruleIdx: number) => {
    const terms = cloneDeep(nodeRequiredTerms);
    terms[ruleIdx].matchExpressions.push({ ...DEFAULT_EXPRESSION });
    const next = cloneDeep(value);
    (next.nodeAffinity as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
      { nodeSelectorTerms: terms };
    emitChange(next);
  };

  /** Remove an expression from a node required rule. */
  const handleRemoveNodeReqExpr = (ruleIdx: number, exprIdx: number) => {
    const terms = cloneDeep(nodeRequiredTerms);
    terms[ruleIdx].matchExpressions.splice(exprIdx, 1);
    // If no expressions left, remove the whole rule.
    if (terms[ruleIdx].matchExpressions.length === 0) {
      terms.splice(ruleIdx, 1);
    }
    const next = cloneDeep(value);
    if (terms.length === 0) {
      const nodeAffinity = next.nodeAffinity as Record<string, unknown>;
      delete nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
      if (Object.keys(nodeAffinity).length === 0) delete next.nodeAffinity;
    } else {
      (
        next.nodeAffinity as Record<string, unknown>
      ).requiredDuringSchedulingIgnoredDuringExecution = { nodeSelectorTerms: terms };
    }
    emitChange(next);
  };

  /** Update a node required expression field. */
  const handleNodeReqExprChange = (
    ruleIdx: number,
    exprIdx: number,
    field: keyof MatchExpression,
    fieldValue: string | string[]
  ) => {
    const terms = cloneDeep(nodeRequiredTerms);
    const expr = terms[ruleIdx].matchExpressions[exprIdx];
    if (field === 'key') {
      expr.key = fieldValue as string;
    } else if (field === 'operator') {
      expr.operator = fieldValue as string;
      // Clear values when switching to a valueless operator.
      if (VALUELESS_OPERATORS.has(expr.operator)) {
        expr.values = [];
      }
    } else if (field === 'values') {
      expr.values = fieldValue as string[];
    }
    const next = cloneDeep(value);
    (next.nodeAffinity as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
      { nodeSelectorTerms: terms };
    emitChange(next);
  };

  /** Add a new node preferred rule. */
  const handleAddNodePreferredRule = () => {
    const rules = cloneDeep(nodePreferredRules);
    rules.push({
      weight: 1,
      preference: { matchExpressions: [{ ...DEFAULT_EXPRESSION }] },
    });
    const next = cloneDeep(value);
    if (!next.nodeAffinity) next.nodeAffinity = {};
    (next.nodeAffinity as Record<string, unknown>).preferredDuringSchedulingIgnoredDuringExecution =
      rules;
    emitChange(next);
  };

  /** Remove a node preferred rule by index. */
  const handleRemoveNodePreferredRule = (ruleIdx: number) => {
    const rules = cloneDeep(nodePreferredRules);
    rules.splice(ruleIdx, 1);
    const next = cloneDeep(value);
    if (rules.length === 0) {
      const nodeAffinity = next.nodeAffinity as Record<string, unknown>;
      delete nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution;
      if (Object.keys(nodeAffinity).length === 0) delete next.nodeAffinity;
    } else {
      (
        next.nodeAffinity as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
    }
    emitChange(next);
  };

  /** Update weight on a node preferred rule. */
  const handleNodePrefWeightChange = (ruleIdx: number, rawWeight: string) => {
    const rules = cloneDeep(nodePreferredRules);
    const parsed = parseInt(rawWeight, 10);
    rules[ruleIdx].weight = Number.isNaN(parsed) ? 1 : parsed;
    const next = cloneDeep(value);
    (next.nodeAffinity as Record<string, unknown>).preferredDuringSchedulingIgnoredDuringExecution =
      rules;
    emitChange(next);
  };

  /** Add an expression to a node preferred rule. */
  const handleAddNodePrefExpr = (ruleIdx: number) => {
    const rules = cloneDeep(nodePreferredRules);
    rules[ruleIdx].preference.matchExpressions.push({ ...DEFAULT_EXPRESSION });
    const next = cloneDeep(value);
    (next.nodeAffinity as Record<string, unknown>).preferredDuringSchedulingIgnoredDuringExecution =
      rules;
    emitChange(next);
  };

  /** Remove an expression from a node preferred rule. */
  const handleRemoveNodePrefExpr = (ruleIdx: number, exprIdx: number) => {
    const rules = cloneDeep(nodePreferredRules);
    rules[ruleIdx].preference.matchExpressions.splice(exprIdx, 1);
    if (rules[ruleIdx].preference.matchExpressions.length === 0) {
      rules.splice(ruleIdx, 1);
    }
    const next = cloneDeep(value);
    if (rules.length === 0) {
      const nodeAffinity = next.nodeAffinity as Record<string, unknown>;
      delete nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution;
      if (Object.keys(nodeAffinity).length === 0) delete next.nodeAffinity;
    } else {
      (
        next.nodeAffinity as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
    }
    emitChange(next);
  };

  /** Update a node preferred expression field. */
  const handleNodePrefExprChange = (
    ruleIdx: number,
    exprIdx: number,
    field: keyof MatchExpression,
    fieldValue: string | string[]
  ) => {
    const rules = cloneDeep(nodePreferredRules);
    const expr = rules[ruleIdx].preference.matchExpressions[exprIdx];
    if (field === 'key') {
      expr.key = fieldValue as string;
    } else if (field === 'operator') {
      expr.operator = fieldValue as string;
      if (VALUELESS_OPERATORS.has(expr.operator)) expr.values = [];
    } else if (field === 'values') {
      expr.values = fieldValue as string[];
    }
    const next = cloneDeep(value);
    (next.nodeAffinity as Record<string, unknown>).preferredDuringSchedulingIgnoredDuringExecution =
      rules;
    emitChange(next);
  };

  // ── Pod affinity / anti-affinity handlers ───────────────────────────

  /**
   * Build handlers for pod affinity or pod anti-affinity. The two sections
   * share identical structure, differing only by the top-level key and the
   * prefixes used for data-field-key attributes.
   */
  const buildPodHandlers = (sectionKey: 'podAffinity' | 'podAntiAffinity') => {
    const requiredRules = getPodRequiredRules(value, sectionKey);
    const preferredRules = getPodPreferredRules(value, sectionKey);

    /** Add a new pod required rule. */
    const addRequiredRule = () => {
      const rules = cloneDeep(requiredRules);
      rules.push({
        labelSelector: { matchExpressions: [{ ...DEFAULT_EXPRESSION }] },
        topologyKey: '',
      });
      const next = cloneDeep(value);
      if (!next[sectionKey]) next[sectionKey] = {};
      (next[sectionKey] as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
        rules;
      emitChange(next);
    };

    /** Remove a pod required rule. */
    const removeRequiredRule = (ruleIdx: number) => {
      const rules = cloneDeep(requiredRules);
      rules.splice(ruleIdx, 1);
      const next = cloneDeep(value);
      if (rules.length === 0) {
        const section = next[sectionKey] as Record<string, unknown>;
        delete section.requiredDuringSchedulingIgnoredDuringExecution;
        if (Object.keys(section).length === 0) delete next[sectionKey];
      } else {
        (
          next[sectionKey] as Record<string, unknown>
        ).requiredDuringSchedulingIgnoredDuringExecution = rules;
      }
      emitChange(next);
    };

    /** Update topology key on a pod required rule. */
    const updateRequiredTopo = (ruleIdx: number, topo: string) => {
      const rules = cloneDeep(requiredRules);
      rules[ruleIdx].topologyKey = topo;
      const next = cloneDeep(value);
      (next[sectionKey] as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
        rules;
      emitChange(next);
    };

    /** Add expression to a pod required rule. */
    const addRequiredExpr = (ruleIdx: number) => {
      const rules = cloneDeep(requiredRules);
      rules[ruleIdx].labelSelector.matchExpressions.push({ ...DEFAULT_EXPRESSION });
      const next = cloneDeep(value);
      (next[sectionKey] as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
        rules;
      emitChange(next);
    };

    /** Remove expression from a pod required rule. */
    const removeRequiredExpr = (ruleIdx: number, exprIdx: number) => {
      const rules = cloneDeep(requiredRules);
      rules[ruleIdx].labelSelector.matchExpressions.splice(exprIdx, 1);
      if (rules[ruleIdx].labelSelector.matchExpressions.length === 0) {
        rules.splice(ruleIdx, 1);
      }
      const next = cloneDeep(value);
      if (rules.length === 0) {
        const section = next[sectionKey] as Record<string, unknown>;
        delete section.requiredDuringSchedulingIgnoredDuringExecution;
        if (Object.keys(section).length === 0) delete next[sectionKey];
      } else {
        (
          next[sectionKey] as Record<string, unknown>
        ).requiredDuringSchedulingIgnoredDuringExecution = rules;
      }
      emitChange(next);
    };

    /** Update a pod required expression field. */
    const updateRequiredExpr = (
      ruleIdx: number,
      exprIdx: number,
      field: keyof MatchExpression,
      fieldValue: string | string[]
    ) => {
      const rules = cloneDeep(requiredRules);
      const expr = rules[ruleIdx].labelSelector.matchExpressions[exprIdx];
      if (field === 'key') {
        expr.key = fieldValue as string;
      } else if (field === 'operator') {
        expr.operator = fieldValue as string;
        if (VALUELESS_OPERATORS.has(expr.operator)) expr.values = [];
      } else if (field === 'values') {
        expr.values = fieldValue as string[];
      }
      const next = cloneDeep(value);
      (next[sectionKey] as Record<string, unknown>).requiredDuringSchedulingIgnoredDuringExecution =
        rules;
      emitChange(next);
    };

    /** Add a new pod preferred rule. */
    const addPreferredRule = () => {
      const rules = cloneDeep(preferredRules);
      rules.push({
        weight: 1,
        podAffinityTerm: {
          labelSelector: { matchExpressions: [{ ...DEFAULT_EXPRESSION }] },
          topologyKey: '',
        },
      });
      const next = cloneDeep(value);
      if (!next[sectionKey]) next[sectionKey] = {};
      (
        next[sectionKey] as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      emitChange(next);
    };

    /** Remove a pod preferred rule. */
    const removePreferredRule = (ruleIdx: number) => {
      const rules = cloneDeep(preferredRules);
      rules.splice(ruleIdx, 1);
      const next = cloneDeep(value);
      if (rules.length === 0) {
        const section = next[sectionKey] as Record<string, unknown>;
        delete section.preferredDuringSchedulingIgnoredDuringExecution;
        if (Object.keys(section).length === 0) delete next[sectionKey];
      } else {
        (
          next[sectionKey] as Record<string, unknown>
        ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      }
      emitChange(next);
    };

    /** Update weight on a pod preferred rule. */
    const updatePreferredWeight = (ruleIdx: number, rawWeight: string) => {
      const rules = cloneDeep(preferredRules);
      const parsed = parseInt(rawWeight, 10);
      rules[ruleIdx].weight = Number.isNaN(parsed) ? 1 : parsed;
      const next = cloneDeep(value);
      (
        next[sectionKey] as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      emitChange(next);
    };

    /** Update topology key on a pod preferred rule. */
    const updatePreferredTopo = (ruleIdx: number, topo: string) => {
      const rules = cloneDeep(preferredRules);
      rules[ruleIdx].podAffinityTerm.topologyKey = topo;
      const next = cloneDeep(value);
      (
        next[sectionKey] as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      emitChange(next);
    };

    /** Add expression to a pod preferred rule. */
    const addPreferredExpr = (ruleIdx: number) => {
      const rules = cloneDeep(preferredRules);
      rules[ruleIdx].podAffinityTerm.labelSelector.matchExpressions.push({
        ...DEFAULT_EXPRESSION,
      });
      const next = cloneDeep(value);
      (
        next[sectionKey] as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      emitChange(next);
    };

    /** Remove expression from a pod preferred rule. */
    const removePreferredExpr = (ruleIdx: number, exprIdx: number) => {
      const rules = cloneDeep(preferredRules);
      rules[ruleIdx].podAffinityTerm.labelSelector.matchExpressions.splice(exprIdx, 1);
      if (rules[ruleIdx].podAffinityTerm.labelSelector.matchExpressions.length === 0) {
        rules.splice(ruleIdx, 1);
      }
      const next = cloneDeep(value);
      if (rules.length === 0) {
        const section = next[sectionKey] as Record<string, unknown>;
        delete section.preferredDuringSchedulingIgnoredDuringExecution;
        if (Object.keys(section).length === 0) delete next[sectionKey];
      } else {
        (
          next[sectionKey] as Record<string, unknown>
        ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      }
      emitChange(next);
    };

    /** Update a pod preferred expression field. */
    const updatePreferredExpr = (
      ruleIdx: number,
      exprIdx: number,
      field: keyof MatchExpression,
      fieldValue: string | string[]
    ) => {
      const rules = cloneDeep(preferredRules);
      const expr = rules[ruleIdx].podAffinityTerm.labelSelector.matchExpressions[exprIdx];
      if (field === 'key') {
        expr.key = fieldValue as string;
      } else if (field === 'operator') {
        expr.operator = fieldValue as string;
        if (VALUELESS_OPERATORS.has(expr.operator)) expr.values = [];
      } else if (field === 'values') {
        expr.values = fieldValue as string[];
      }
      const next = cloneDeep(value);
      (
        next[sectionKey] as Record<string, unknown>
      ).preferredDuringSchedulingIgnoredDuringExecution = rules;
      emitChange(next);
    };

    return {
      requiredRules,
      preferredRules,
      addRequiredRule,
      removeRequiredRule,
      updateRequiredTopo,
      addRequiredExpr,
      removeRequiredExpr,
      updateRequiredExpr,
      addPreferredRule,
      removePreferredRule,
      updatePreferredWeight,
      updatePreferredTopo,
      addPreferredExpr,
      removePreferredExpr,
      updatePreferredExpr,
    };
  };

  const podAffinity = buildPodHandlers('podAffinity');
  const podAntiAffinity = buildPodHandlers('podAntiAffinity');

  // ── Expression row renderer ─────────────────────────────────────────

  /** Render a single match expression row. */
  const renderExpressionRow = (
    expr: MatchExpression,
    operators: typeof NODE_OPERATORS,
    keyPrefix: string,
    ruleIdx: number,
    exprIdx: number,
    onExprChange: (
      ruleIdx: number,
      exprIdx: number,
      field: keyof MatchExpression,
      value: string | string[]
    ) => void,
    onRemoveExpr: (ruleIdx: number, exprIdx: number) => void,
    removeFieldKey: string
  ) => {
    const hideValues = VALUELESS_OPERATORS.has(expr.operator);

    return (
      <div key={`${keyPrefix}-${ruleIdx}-${exprIdx}`} className="resource-form-affinity-expr-row">
        {/* Key input */}
        <div
          className="resource-form-affinity-expr-key"
          data-field-key={`${keyPrefix}Key-${ruleIdx}-${exprIdx}`}
        >
          <input
            type="text"
            className="resource-form-input"
            value={expr.key}
            placeholder="key"
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => onExprChange(ruleIdx, exprIdx, 'key', e.target.value)}
          />
        </div>

        {/* Operator dropdown */}
        <div
          className="resource-form-affinity-expr-operator"
          data-field-key={`${keyPrefix}Op-${ruleIdx}-${exprIdx}`}
        >
          <Dropdown
            options={operators}
            value={expr.operator}
            onChange={(next) => {
              const op = Array.isArray(next) ? next[0] : next;
              onExprChange(ruleIdx, exprIdx, 'operator', op);
            }}
            size="compact"
            ariaLabel={`${keyPrefix} operator ${ruleIdx}-${exprIdx}`}
          />
        </div>

        {/* Values input (hidden for Exists/DoesNotExist) */}
        {!hideValues && (
          <div
            className="resource-form-affinity-expr-values"
            data-field-key={`${keyPrefix}Values-${ruleIdx}-${exprIdx}`}
          >
            <input
              type="text"
              className="resource-form-input"
              value={joinValues(expr.values)}
              placeholder="val1, val2"
              {...INPUT_BEHAVIOR_PROPS}
              onChange={(e) =>
                onExprChange(ruleIdx, exprIdx, 'values', parseValues(e.target.value))
              }
            />
          </div>
        )}

        {/* Remove expression button */}
        <button
          type="button"
          className="resource-form-remove-btn resource-form-icon-btn"
          data-field-key={`${removeFieldKey}-${ruleIdx}-${exprIdx}`}
          aria-label="Remove expression"
          title="Remove expression"
          onClick={() => onRemoveExpr(ruleIdx, exprIdx)}
        >
          -
        </button>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div data-field-key={dataFieldKey} className="resource-form-affinity">
      {/* ── Node Affinity Section ──────────────────────────────────── */}
      <div className="resource-form-affinity-section">
        <div className="resource-form-affinity-section-title">Node Affinity</div>

        {/* Node Required */}
        <div className="resource-form-affinity-subsection">
          <div className="resource-form-affinity-subsection-title">Required</div>
          {nodeRequiredTerms.map((term, ruleIdx) => (
            <div key={`nodeReq-${ruleIdx}`} className="resource-form-affinity-rule">
              <div className="resource-form-affinity-rule-header">
                <span>Rule {ruleIdx + 1}</span>
                <button
                  type="button"
                  className="resource-form-remove-btn resource-form-icon-btn"
                  data-field-key={`removeNodeReqRule-${ruleIdx}`}
                  aria-label="Remove rule"
                  title="Remove rule"
                  onClick={() => handleRemoveNodeRequiredRule(ruleIdx)}
                >
                  -
                </button>
              </div>
              {term.matchExpressions.map((expr, exprIdx) =>
                renderExpressionRow(
                  expr,
                  NODE_OPERATORS,
                  'nodeReqExpr',
                  ruleIdx,
                  exprIdx,
                  handleNodeReqExprChange,
                  handleRemoveNodeReqExpr,
                  'removeNodeReqExpr'
                )
              )}
              <button
                type="button"
                className="resource-form-add-btn resource-form-icon-btn"
                data-field-key={`addNodeReqExpr-${ruleIdx}`}
                aria-label="Add expression"
                title="Add expression"
                onClick={() => handleAddNodeReqExpr(ruleIdx)}
              >
                +
              </button>
            </div>
          ))}
          <button
            type="button"
            className="resource-form-add-btn resource-form-icon-btn"
            data-field-key="addNodeRequiredRule"
            aria-label="Add node required rule"
            title="Add node required rule"
            onClick={handleAddNodeRequiredRule}
          >
            +
          </button>
        </div>

        {/* Node Preferred */}
        <div className="resource-form-affinity-subsection">
          <div className="resource-form-affinity-subsection-title">Preferred</div>
          {nodePreferredRules.map((rule, ruleIdx) => (
            <div key={`nodePref-${ruleIdx}`} className="resource-form-affinity-rule">
              <div className="resource-form-affinity-rule-header">
                <div data-field-key={`nodePrefWeight-${ruleIdx}`}>
                  <label className="resource-form-field-label">Weight</label>
                  <input
                    type="text"
                    className="resource-form-input"
                    value={String(rule.weight)}
                    placeholder="1"
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(e) => handleNodePrefWeightChange(ruleIdx, e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="resource-form-remove-btn resource-form-icon-btn"
                  data-field-key={`removeNodePrefRule-${ruleIdx}`}
                  aria-label="Remove rule"
                  title="Remove rule"
                  onClick={() => handleRemoveNodePreferredRule(ruleIdx)}
                >
                  -
                </button>
              </div>
              {rule.preference.matchExpressions.map((expr, exprIdx) =>
                renderExpressionRow(
                  expr,
                  NODE_OPERATORS,
                  'nodePrefExpr',
                  ruleIdx,
                  exprIdx,
                  handleNodePrefExprChange,
                  handleRemoveNodePrefExpr,
                  'removeNodePrefExpr'
                )
              )}
              <button
                type="button"
                className="resource-form-add-btn resource-form-icon-btn"
                data-field-key={`addNodePrefExpr-${ruleIdx}`}
                aria-label="Add expression"
                title="Add expression"
                onClick={() => handleAddNodePrefExpr(ruleIdx)}
              >
                +
              </button>
            </div>
          ))}
          <button
            type="button"
            className="resource-form-add-btn resource-form-icon-btn"
            data-field-key="addNodePreferredRule"
            aria-label="Add node preferred rule"
            title="Add node preferred rule"
            onClick={handleAddNodePreferredRule}
          >
            +
          </button>
        </div>
      </div>

      {/* ── Pod Affinity Section ───────────────────────────────────── */}
      {renderPodSection(
        'Pod Affinity',
        'pod',
        podAffinity,
        'addPodRequiredRule',
        'addPodPreferredRule'
      )}

      {/* ── Pod Anti-Affinity Section ──────────────────────────────── */}
      {renderPodSection(
        'Pod Anti-Affinity',
        'anti',
        podAntiAffinity,
        'addAntiRequiredRule',
        'addAntiPreferredRule'
      )}
    </div>
  );

  /**
   * Render a pod affinity or pod anti-affinity section. Shared between
   * the two sections since they have identical structure.
   */
  function renderPodSection(
    title: string,
    prefix: 'pod' | 'anti',
    handlers: ReturnType<typeof buildPodHandlers>,
    addRequiredKey: string,
    addPreferredKey: string
  ): React.ReactElement {
    return (
      <div className="resource-form-affinity-section">
        <div className="resource-form-affinity-section-title">{title}</div>

        {/* Required */}
        <div className="resource-form-affinity-subsection">
          <div className="resource-form-affinity-subsection-title">Required</div>
          {handlers.requiredRules.map((rule, ruleIdx) => (
            <div key={`${prefix}Req-${ruleIdx}`} className="resource-form-affinity-rule">
              <div className="resource-form-affinity-rule-header">
                <div data-field-key={`${prefix}ReqTopo-${ruleIdx}`}>
                  <label className="resource-form-field-label">Topology Key</label>
                  <input
                    type="text"
                    className="resource-form-input"
                    value={rule.topologyKey}
                    placeholder="kubernetes.io/hostname"
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(e) => handlers.updateRequiredTopo(ruleIdx, e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="resource-form-remove-btn resource-form-icon-btn"
                  data-field-key={`remove${prefix === 'pod' ? 'Pod' : 'Anti'}ReqRule-${ruleIdx}`}
                  aria-label="Remove rule"
                  title="Remove rule"
                  onClick={() => handlers.removeRequiredRule(ruleIdx)}
                >
                  -
                </button>
              </div>
              {rule.labelSelector.matchExpressions.map((expr, exprIdx) =>
                renderExpressionRow(
                  expr,
                  POD_OPERATORS,
                  `${prefix}ReqExpr`,
                  ruleIdx,
                  exprIdx,
                  handlers.updateRequiredExpr,
                  handlers.removeRequiredExpr,
                  `remove${prefix === 'pod' ? 'Pod' : 'Anti'}ReqExpr`
                )
              )}
              <button
                type="button"
                className="resource-form-add-btn resource-form-icon-btn"
                data-field-key={`add${prefix === 'pod' ? 'Pod' : 'Anti'}ReqExpr-${ruleIdx}`}
                aria-label="Add expression"
                title="Add expression"
                onClick={() => handlers.addRequiredExpr(ruleIdx)}
              >
                +
              </button>
            </div>
          ))}
          <button
            type="button"
            className="resource-form-add-btn resource-form-icon-btn"
            data-field-key={addRequiredKey}
            aria-label={`Add ${title.toLowerCase()} required rule`}
            title={`Add ${title.toLowerCase()} required rule`}
            onClick={handlers.addRequiredRule}
          >
            +
          </button>
        </div>

        {/* Preferred */}
        <div className="resource-form-affinity-subsection">
          <div className="resource-form-affinity-subsection-title">Preferred</div>
          {handlers.preferredRules.map((rule, ruleIdx) => (
            <div key={`${prefix}Pref-${ruleIdx}`} className="resource-form-affinity-rule">
              <div className="resource-form-affinity-rule-header">
                <div data-field-key={`${prefix}PrefWeight-${ruleIdx}`}>
                  <label className="resource-form-field-label">Weight</label>
                  <input
                    type="text"
                    className="resource-form-input"
                    value={String(rule.weight)}
                    placeholder="1"
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(e) => handlers.updatePreferredWeight(ruleIdx, e.target.value)}
                  />
                </div>
                <div data-field-key={`${prefix}PrefTopo-${ruleIdx}`}>
                  <label className="resource-form-field-label">Topology Key</label>
                  <input
                    type="text"
                    className="resource-form-input"
                    value={rule.podAffinityTerm.topologyKey}
                    placeholder="kubernetes.io/hostname"
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(e) => handlers.updatePreferredTopo(ruleIdx, e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="resource-form-remove-btn resource-form-icon-btn"
                  data-field-key={`remove${prefix === 'pod' ? 'Pod' : 'Anti'}PrefRule-${ruleIdx}`}
                  aria-label="Remove rule"
                  title="Remove rule"
                  onClick={() => handlers.removePreferredRule(ruleIdx)}
                >
                  -
                </button>
              </div>
              {rule.podAffinityTerm.labelSelector.matchExpressions.map((expr, exprIdx) =>
                renderExpressionRow(
                  expr,
                  POD_OPERATORS,
                  `${prefix}PrefExpr`,
                  ruleIdx,
                  exprIdx,
                  handlers.updatePreferredExpr,
                  handlers.removePreferredExpr,
                  `remove${prefix === 'pod' ? 'Pod' : 'Anti'}PrefExpr`
                )
              )}
              <button
                type="button"
                className="resource-form-add-btn resource-form-icon-btn"
                data-field-key={`add${prefix === 'pod' ? 'Pod' : 'Anti'}PrefExpr-${ruleIdx}`}
                aria-label="Add expression"
                title="Add expression"
                onClick={() => handlers.addPreferredExpr(ruleIdx)}
              >
                +
              </button>
            </div>
          ))}
          <button
            type="button"
            className="resource-form-add-btn resource-form-icon-btn"
            data-field-key={addPreferredKey}
            aria-label={`Add ${title.toLowerCase()} preferred rule`}
            title={`Add ${title.toLowerCase()} preferred rule`}
            onClick={handlers.addPreferredRule}
          >
            +
          </button>
        </div>
      </div>
    );
  }
}
