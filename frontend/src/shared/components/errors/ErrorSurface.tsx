import { errorHandler } from '@utils/errorHandler';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';

interface OperationalErrorSurfaceProps {
  kind: 'operational';
  error: unknown;
  context?: Record<string, unknown>;
  customMessage?: string;
  message?: ReactNode;
}

interface ExpectedErrorSurfaceProps {
  kind: 'validation' | 'status' | 'reported';
  message: ReactNode;
  error?: never;
  context?: never;
  customMessage?: never;
}

export type ErrorSurfaceProps = OperationalErrorSurfaceProps | ExpectedErrorSurfaceProps;

const unreportedError = Symbol('unreported error');

/**
 * The only boundary for dynamic inline error text. Operational errors are
 * reported with their original value when the text is actually presented;
 * expected validation/status text and already-reported errors are explicit.
 */
export const ErrorSurface = (props: ErrorSurfaceProps) => {
  const operationalError = props.kind === 'operational' ? props.error : undefined;
  const operationalContext = props.kind === 'operational' ? props.context : undefined;
  const operationalCustomMessage = props.kind === 'operational' ? props.customMessage : undefined;
  const details = useMemo(
    () =>
      props.kind === 'operational'
        ? errorHandler.describe(operationalError, operationalContext, operationalCustomMessage)
        : null,
    [props.kind, operationalError, operationalContext, operationalCustomMessage]
  );
  const reportedErrorRef = useRef<unknown>(unreportedError);

  useEffect(() => {
    if (props.kind !== 'operational') {
      reportedErrorRef.current = unreportedError;
      return;
    }
    if (Object.is(reportedErrorRef.current, operationalError)) {
      return;
    }
    reportedErrorRef.current = operationalError;
    errorHandler.handleInline(operationalError, operationalContext, operationalCustomMessage);
  }, [props.kind, operationalError, operationalContext, operationalCustomMessage]);

  return <>{props.message ?? details?.message}</>;
};
