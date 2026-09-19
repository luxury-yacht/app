/**
 * frontend/src/modules/port-forward/PortForwardModal.tsx
 *
 * Modal for configuring and starting a Kubernetes port-forward session. It
 * resolves target ports from a full object ref and submits the selected
 * container/local port mapping.
 */

import { buildObjectActionTarget, runStartPortForward } from '@shared/actions/objectActionClient';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { PortForwardIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { buildVersionedNamespacedRowKey } from '@shared/utils/resourceRowIdentity';
import { errorHandler } from '@utils/errorHandler';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { readTargetPortsForRef, requestData } from '@/core/data-access';
import './PortForwardModal.css';

/**
 * Represents a port available on a container
 */
export interface ContainerPort {
  port: number;
  name?: string;
  protocol?: string;
}

/**
 * Target resource for port forwarding
 */
export interface PortForwardTarget {
  kind: string;
  group: string;
  version: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName: string;
  ports: ContainerPort[];
}

interface PortForwardModalProps {
  /** The target resource to port forward to, or null to hide the modal */
  target: PortForwardTarget | null;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Optional callback when port forward is successfully started */
  onStarted?: (sessionId: string) => void;
  onMutationChange?: (inFlight: boolean) => void;
}

/**
 * Validates that a port number is within the valid range (1-65535)
 */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Calculates a default local port based on the container port.
 * Adds 8000 to privileged ports (< 1024) to avoid permission issues.
 */
function getDefaultLocalPort(containerPort: number): number {
  return containerPort < 1024 ? containerPort + 8000 : containerPort;
}

/**
 * Modal for configuring and starting port forwards to Kubernetes resources.
 * Supports both predefined container ports (via radio selection) and
 * custom port input when no ports are available.
 */
const PortForwardModalContent = ({
  target,
  onClose,
  onStarted,
  onMutationChange,
}: Omit<PortForwardModalProps, 'target'> & { target: PortForwardTarget }) => {
  const elementIdPrefix = useId();
  // An open draft belongs to this object, not to later discovery updates.
  const [initialTarget] = useState(target);
  const initialPort = initialTarget.ports[0]?.port ?? 0;
  // Selected container port (either from predefined list or manual input)
  const [containerPort, setContainerPort] = useState(initialPort);
  // Local port to forward to
  const [localPort, setLocalPort] = useState(
    initialPort > 0 ? getDefaultLocalPort(initialPort) : 0
  );
  // Loading state during submit
  const [isLoading, setIsLoading] = useState(false);
  // Loading state for fetching ports from backend
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);
  // Error message to display
  const [error, setError] = useState<string | null>(null);
  const [availablePorts, setAvailablePorts] = useState(initialTarget.ports);
  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref: modalRef,
    onEscape: () => {
      if (!isLoading) {
        onClose();
      }
      return true;
    },
  });

  useEffect(() => {
    if (initialTarget.ports.length > 0 || !initialTarget.clusterId) {
      return;
    }
    let cancelled = false;
    setIsLoadingPorts(true);
    requestData({
      resource: 'target-ports',
      reason: 'user',
      read: () => readTargetPortsForRef(initialTarget),
    })
      .then((ports) => {
        if (cancelled) {
          return;
        }
        const resolvedPorts = ports.status === 'executed' ? (ports.data ?? []) : [];
        if (resolvedPorts.length > 0) {
          setAvailablePorts(resolvedPorts);
          const firstPort = resolvedPorts[0].port;
          setContainerPort(firstPort);
          setLocalPort(getDefaultLocalPort(firstPort));
        } else {
          // No ports found - allow manual entry
          setContainerPort(0);
          setLocalPort(0);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.warn('Failed to fetch target ports:', err);
        // Allow manual entry if fetch fails
        setContainerPort(0);
        setLocalPort(0);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPorts(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialTarget]);

  // Update local port when container port changes
  const handleContainerPortChange = useCallback((port: number) => {
    setContainerPort(port);
    setLocalPort(getDefaultLocalPort(port));
    setError(null);
  }, []);

  // Handle manual container port input
  const handleContainerPortInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseInt(event.target.value, 10);
    const port = Number.isNaN(parsed) ? 0 : parsed;
    setContainerPort(port);
    if (port > 0) {
      setLocalPort(getDefaultLocalPort(port));
    }
    setError(null);
  }, []);

  // Handle local port input
  const handleLocalPortInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseInt(event.target.value, 10);
    setLocalPort(Number.isNaN(parsed) ? 0 : parsed);
    setError(null);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    // Validate ports
    if (!isValidPort(containerPort)) {
      setError('Container port must be between 1 and 65535');
      return;
    }
    if (!isValidPort(localPort)) {
      setError('Local port must be between 1 and 65535');
      return;
    }

    setIsLoading(true);
    onMutationChange?.(true);
    setError(null);

    try {
      const response = await runStartPortForward(
        buildObjectActionTarget(target, 'start port-forward for'),
        {
          containerPort,
          localPort,
        }
      );
      const sessionId = response.sessionId;
      if (!sessionId) {
        throw new Error('Backend did not return a port-forward session id');
      }

      // Notify parent of success
      onStarted?.(sessionId);
      onClose();
    } catch (err) {
      const details = errorHandler.handleInline(err, {
        action: 'startPortForward',
        source: 'PortForwardModal',
        clusterId: target.clusterId,
      });
      setError(details.message || 'Failed to start port forward');
    } finally {
      setIsLoading(false);
      onMutationChange?.(false);
    }
  }, [target, containerPort, localPort, onStarted, onClose, onMutationChange]);

  const hasPredefinedPorts = availablePorts.length > 0;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="port-forward-modal-title"
      onClose={onClose}
      containerClassName="port-forward-modal"
    >
      <ModalHeader
        title="Port Forward"
        titleId="port-forward-modal-title"
        icon={PortForwardIcon}
        onClose={onClose}
        closeLabel="Close modal"
        closeDisabled={isLoading}
      />

      {/* Body */}
      <div className="port-forward-modal-body">
        {/* Resource Information (read-only) */}
        <div className="port-forward-resource-info">
          <div className="port-forward-resource-info-row">
            <span className="port-forward-resource-info-label">Cluster:</span>
            <span className="port-forward-resource-info-value">{target.clusterName}</span>
          </div>
          <div className="port-forward-resource-info-row">
            <span className="port-forward-resource-info-label">Namespace:</span>
            <span className="port-forward-resource-info-value">{target.namespace}</span>
          </div>
          <div className="port-forward-resource-info-row">
            <span className="port-forward-resource-info-label">Resource:</span>
            <span className="port-forward-resource-info-value">
              {target.kind}/{target.name}
            </span>
          </div>
        </div>

        {/* Container Port Selection */}
        <div className="port-forward-field">
          <span className="port-forward-field-label">Container Port</span>
          {!!isLoadingPorts && (
            // Loading indicator while fetching ports
            <div className="port-forward-loading">Loading available ports...</div>
          )}
          {!isLoadingPorts && hasPredefinedPorts && (
            // Radio buttons for predefined ports
            <div className="port-forward-port-options">
              {availablePorts.map((portInfo) => (
                <label
                  key={portInfo.port}
                  className={`port-forward-port-option ${
                    containerPort === portInfo.port ? 'selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="containerPort"
                    value={portInfo.port}
                    checked={containerPort === portInfo.port}
                    onChange={() => handleContainerPortChange(portInfo.port)}
                    disabled={isLoading}
                  />
                  <span className="port-forward-port-option-label">
                    <span className="port-forward-port-number">{portInfo.port}</span>
                    {!!portInfo.name && (
                      <span className="port-forward-port-name">({portInfo.name})</span>
                    )}
                    {!!portInfo.protocol && (
                      <span className="port-forward-port-protocol">{portInfo.protocol}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {!isLoadingPorts && !hasPredefinedPorts && (
            // Manual input for container port
            <div className="port-forward-input-group">
              <input
                aria-label="Container port"
                type="number"
                className="port-forward-input"
                min={1}
                max={65535}
                value={containerPort || ''}
                onChange={handleContainerPortInput}
                placeholder="Enter port (1-65535)"
                disabled={isLoading}
                data-modal-initial-focus
              />
            </div>
          )}
        </div>

        {/* Local Port Input */}
        <div className="port-forward-field">
          <label htmlFor={`${elementIdPrefix}-port-forward-local-port`}>Local Port</label>
          <div className="port-forward-input-group">
            <input
              id={`${elementIdPrefix}-port-forward-local-port`}
              type="number"
              className="port-forward-input"
              min={1}
              max={65535}
              value={localPort || ''}
              onChange={handleLocalPortInput}
              placeholder="Enter local port (1-65535)"
              disabled={isLoading}
            />
          </div>
          <div className="port-forward-hint">
            Forwards localhost:{localPort || '...'} to {target.kind.toLowerCase()}:
            {containerPort || '...'}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {!!error && (
        <div className="port-forward-error">
          <ErrorSurface kind="status" message={error} />
        </div>
      )}

      {/* Footer */}
      <div className="port-forward-footer">
        <button type="button" className="button cancel" onClick={onClose} disabled={isLoading}>
          Cancel
        </button>
        <button
          type="button"
          className="button save"
          onClick={handleSubmit}
          disabled={
            isLoading || isLoadingPorts || !isValidPort(containerPort) || !isValidPort(localPort)
          }
        >
          {isLoading ? 'Starting...' : 'Start'}
        </button>
      </div>
    </ModalSurface>
  );
};

function PortForwardModal({ target, ...props }: PortForwardModalProps) {
  if (!target) return null;
  const key = buildVersionedNamespacedRowKey(
    target.clusterId,
    target.namespace,
    target.group,
    target.version,
    target.kind,
    target.name
  );
  return <PortForwardModalContent key={key} target={target} {...props} />;
}

export default PortForwardModal;
