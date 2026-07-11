/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx
 */

import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import SegmentedButton from '@shared/components/SegmentedButton';
import { YamlEditor } from '@shared/components/yaml';
import { errorHandler } from '@utils/errorHandler';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import * as YAML from 'yaml';
import { useRefreshDomainHandle } from '@/core/data-access';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import './ValuesTab.css';
import '../Yaml/YamlTab.css';

/** A single Helm value: primitive, array, or nested object. */
type HelmValue = string | number | boolean | null | HelmValue[] | HelmValueObject;

/** A Helm values object with string keys. */
type HelmValueObject = { [key: string]: HelmValue };

/** Top-level shape returned by the backend for Helm values. */
interface HelmValuesData {
  allValues?: HelmValueObject;
  userValues?: HelmValueObject;
  [key: string]: HelmValue | undefined;
}

interface ValuesTabProps {
  scope: string | null;
  isActive?: boolean;
}

const ownsKey = (value: HelmValueObject, key: string): boolean =>
  Object.getOwnPropertyDescriptor(value, key) !== undefined;

const ValuesTab: React.FC<ValuesTabProps> = ({ scope, isActive = false }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const [showMode, setShowMode] = useState<'defaults' | 'overrides' | 'merged'>('defaults');
  const { state: snapshot } = useRefreshDomainHandle({
    domain: 'object-helm-values',
    scope,
    enabled: Boolean(isActive && scope),
    preserveState: true,
    fetchOnEnable: isActive && scope ? 'startup' : false,
  });

  const valuesData = snapshot.data?.values as HelmValuesData | undefined;
  const valuesLoadingState = applyPassiveLoadingPolicy({
    loading:
      snapshot.status === 'loading' ||
      snapshot.status === 'initialising' ||
      (snapshot.status === 'updating' && !valuesData),
    hasLoaded: Boolean(snapshot.data),
    hasData: Boolean(valuesData),
    isPaused,
    isManualRefreshActive,
  });
  const valuesLoading = valuesLoadingState.loading;
  const showPausedValuesState = valuesLoadingState.showPausedEmptyState;
  const valuesError = snapshot.error ?? null;

  const hasPath = useCallback((obj: HelmValue | undefined, path: string[]): boolean => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return false;
    }
    let current: HelmValue = obj;
    for (const key of path) {
      if (
        current === null ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !ownsKey(current, key)
      ) {
        return false;
      }
      current = current[key];
    }
    return true;
  }, []);

  const getValueAtPath = useCallback(
    (obj: HelmValue | undefined, path: string[]): HelmValue | undefined => {
      let current: HelmValue | undefined = obj;
      for (const key of path) {
        if (
          current === null ||
          current === undefined ||
          typeof current !== 'object' ||
          Array.isArray(current) ||
          !ownsKey(current, key)
        ) {
          return undefined;
        }
        current = current[key];
      }
      return current;
    },
    []
  );

  const getDefaultValues = useCallback(
    (
      allVals: HelmValue | undefined,
      userVals: HelmValue | undefined,
      path: string[] = []
    ): HelmValue | undefined => {
      if (allVals === null || allVals === undefined) {
        return allVals;
      }
      if (typeof allVals !== 'object' || Array.isArray(allVals)) {
        if (hasPath(userVals, path)) {
          return undefined;
        }
        return allVals;
      }
      const result: HelmValueObject = {};
      for (const key of Object.keys(allVals)) {
        const newPath = [...path, key];
        const value = allVals[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const defaultVal = getDefaultValues(value, userVals, newPath);
          if (
            defaultVal !== undefined &&
            defaultVal !== null &&
            typeof defaultVal === 'object' &&
            !Array.isArray(defaultVal) &&
            Object.keys(defaultVal).length > 0
          ) {
            result[key] = defaultVal;
          }
        } else if (!hasPath(userVals, newPath)) {
          result[key] = value;
        }
      }
      return result;
    },
    [hasPath]
  );

  const markOverriddenValues = useCallback(
    (
      obj: HelmValue | undefined,
      userValues: HelmValue | undefined,
      path: string[] = []
    ): HelmValue | undefined => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      if (typeof obj !== 'object' || Array.isArray(obj)) {
        if (hasPath(userValues, path)) {
          return getValueAtPath(userValues, path);
        }
        return obj;
      }

      const result: HelmValueObject = {};
      for (const key of Object.keys(obj)) {
        const newPath = [...path, key];
        const value = obj[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          result[key] = markOverriddenValues(value, userValues, newPath) ?? null;
        } else if (hasPath(userValues, newPath)) {
          result[key] = getValueAtPath(userValues, newPath) ?? null;
        } else {
          result[key] = value;
        }
      }
      return result;
    },
    [getValueAtPath, hasPath]
  );

  const getActualOverrides = useCallback(
    (
      userVals: HelmValue | undefined,
      _allVals: HelmValue | undefined,
      path: string[] = []
    ): HelmValue | undefined => {
      if (userVals === null || userVals === undefined) {
        return userVals;
      }
      if (typeof userVals !== 'object' || Array.isArray(userVals)) {
        return userVals;
      }
      const allObj =
        _allVals !== null && typeof _allVals === 'object' && !Array.isArray(_allVals)
          ? _allVals
          : undefined;
      const result: HelmValueObject = {};
      for (const key of Object.keys(userVals)) {
        result[key] = getActualOverrides(userVals[key], allObj?.[key], [...path, key]) ?? null;
      }
      return result;
    },
    []
  );

  const displayContent = useMemo(() => {
    if (!valuesData) {
      return '';
    }

    const allValues: HelmValue = valuesData.allValues ?? (valuesData as HelmValueObject);
    const userValues: HelmValue = valuesData.userValues ?? {};

    let content: HelmValue | undefined;
    switch (showMode) {
      case 'defaults':
        content = getDefaultValues(allValues, userValues);
        break;
      case 'overrides':
        content = getActualOverrides(userValues, allValues);
        break;
      default:
        content = markOverriddenValues(allValues, userValues);
        break;
    }

    try {
      return YAML.stringify(content ?? {}, {
        indent: 2,
        lineWidth: 0,
        doubleQuotedAsJSON: false,
        singleQuote: false,
        defaultKeyType: 'PLAIN',
        defaultStringType: 'PLAIN',
      });
    } catch (e) {
      errorHandler.handle(e, { action: 'processHelmValues' });
      return YAML.stringify(content ?? {});
    }
  }, [valuesData, showMode, getDefaultValues, getActualOverrides, markOverriddenValues]);

  if (valuesLoading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading values..." />
      </div>
    );
  }

  if (showPausedValuesState) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }

  if (valuesError) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">Error loading values: {valuesError}</div>
        </div>
      </div>
    );
  }

  if (!valuesData) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No values available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="values-display">
        <YamlEditor
          value={displayContent}
          editable={false}
          active={isActive}
          shortcutLabel="Helm values search"
          shortcutPriority={20}
          ariaLabel="Helm values YAML"
          toolbarActions={
            <SegmentedButton
              options={[
                { label: 'Defaults', value: 'defaults' },
                { label: 'Overrides', value: 'overrides' },
                { label: 'Merged', value: 'merged' },
              ]}
              value={showMode}
              onChange={(value) => setShowMode(value as typeof showMode)}
            />
          }
        />
      </div>
    </div>
  );
};

export default ValuesTab;
