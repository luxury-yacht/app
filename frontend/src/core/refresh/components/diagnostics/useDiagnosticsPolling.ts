import { errorHandler } from '@utils/errorHandler';
import { useEffect, useRef, useState } from 'react';
import {
  fetchKubernetesAPIClientDiagnostics,
  fetchSelectionDiagnostics,
  fetchTelemetrySummary,
  type KubernetesAPIClientDiagnostics,
  type NormalizedTelemetrySummary,
  type SelectionDiagnostics,
} from '../../client';

interface DiagnosticsTarget<T> {
  key: string;
  action: string;
  fallbackMessage: string;
  setData: (value: T) => void;
  setError: (message: string | null) => void;
}

// The three reads settle as one polling cycle, but retain data and recover their
// failure reports independently. Closing the panel invalidates the whole cycle.
export const useDiagnosticsPolling = (isOpen: boolean) => {
  const [telemetrySummary, setTelemetrySummary] = useState<NormalizedTelemetrySummary | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [selectionDiagnostics, setSelectionDiagnostics] = useState<SelectionDiagnostics | null>(
    null
  );
  const [selectionDiagnosticsError, setSelectionDiagnosticsError] = useState<string | null>(null);
  const [kubernetesAPIDiagnostics, setKubernetesAPIDiagnostics] = useState<
    KubernetesAPIClientDiagnostics[]
  >([]);
  const [kubernetesAPIDiagnosticsError, setKubernetesAPIDiagnosticsError] = useState<string | null>(
    null
  );
  const reportedDiagnosticsFailuresRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!isOpen) {
      reportedDiagnosticsFailuresRef.current.clear();
      setTelemetrySummary(null);
      setTelemetryError(null);
      setSelectionDiagnostics(null);
      setSelectionDiagnosticsError(null);
      setKubernetesAPIDiagnostics([]);
      setKubernetesAPIDiagnosticsError(null);
      return;
    }

    let cancelled = false;
    let polling = false;

    const applyResult = <T>(result: PromiseSettledResult<T>, target: DiagnosticsTarget<T>) => {
      if (result.status === 'fulfilled') {
        reportedDiagnosticsFailuresRef.current.delete(target.key);
        target.setData(result.value);
        target.setError(null);
        return;
      }
      let message = reportedDiagnosticsFailuresRef.current.get(target.key);
      if (message === undefined) {
        const error =
          result.reason instanceof Error ? result.reason : new Error(target.fallbackMessage);
        const details = errorHandler.handleInline(error, {
          action: target.action,
          source: 'DiagnosticsPanel',
        });
        message = details.message;
        reportedDiagnosticsFailuresRef.current.set(target.key, message);
      }
      target.setError(message);
    };

    const loadDiagnostics = async () => {
      if (cancelled || polling) return;
      polling = true;
      const [telemetryResult, selectionResult, kubernetesAPIResult] = await Promise.allSettled([
        fetchTelemetrySummary(),
        fetchSelectionDiagnostics(),
        fetchKubernetesAPIClientDiagnostics(),
      ]);

      polling = false;
      if (cancelled) {
        return;
      }

      applyResult(telemetryResult, {
        key: 'telemetry',
        action: 'loadTelemetryDiagnostics',
        fallbackMessage: 'Failed to load telemetry',
        setData: setTelemetrySummary,
        setError: setTelemetryError,
      });
      applyResult(selectionResult, {
        key: 'selection',
        action: 'loadSelectionDiagnostics',
        fallbackMessage: 'Failed to load selection diagnostics',
        setData: setSelectionDiagnostics,
        setError: setSelectionDiagnosticsError,
      });
      applyResult(kubernetesAPIResult, {
        key: 'kubernetes-api',
        action: 'loadKubernetesAPIDiagnostics',
        fallbackMessage: 'Failed to load Kubernetes API client diagnostics',
        setData: setKubernetesAPIDiagnostics,
        setError: setKubernetesAPIDiagnosticsError,
      });
    };

    void loadDiagnostics();
    const intervalId = window.setInterval(loadDiagnostics, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isOpen]);

  return {
    telemetrySummary,
    telemetryError,
    selectionDiagnostics,
    selectionDiagnosticsError,
    kubernetesAPIDiagnostics,
    kubernetesAPIDiagnosticsError,
  };
};
