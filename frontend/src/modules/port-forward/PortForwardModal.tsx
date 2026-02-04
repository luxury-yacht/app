/**
 * frontend/src/modules/port-forward/PortForwardModal.tsx
 *
 * Modal component for configuring and starting port forwards.
 * Allows users to select container ports and configure local port mappings.
 */

import { useState, useEffect, useCallback } from 'react';
import { StartPortForward } from '@wailsjs/go/backend/App';
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
const PortForwardModal = ({ target, onClose, onStarted }: PortForwardModalProps) => {
  // Selected container port (either from predefined list or manual input)
  const [containerPort, setContainerPort] = useState<number>(0);
  // Local port to forward to
  const [localPort, setLocalPort] = useState<number>(0);
  // Loading state during submit
  const [isLoading, setIsLoading] = useState(false);
  // Loading state for fetching ports from backend
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);
  // Error message to display
  const [error, setError] = useState<string | null>(null);
  // Fetched ports stored in local state (not mutating the target prop)
  const [fetchedPorts, setFetchedPorts] = useState<ContainerPort[]>([]);

  // Create a stable key to track when the target actually changes
  const targetKey = target
    ? `${target.clusterId}:${target.namespace}:${target.kind}:${target.name}`
    : '';

  // Handle Escape key to close modal
  useEffect(() => {
    if (!target) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [target, isLoading, onClose]);

  // Reset form state when target changes, fetch ports if not provided
  useEffect(() => {
    if (!target) return;

    setError(null);
    setFetchedPorts([]);

    // If ports provided in target, use them directly
    if (target.ports.length > 0) {
      const initialContainerPort = target.ports[0].port;
      setContainerPort(initialContainerPort);
      setLocalPort(initialContainerPort > 0 ? getDefaultLocalPort(initialContainerPort) : 0);
      return;
    }

    // Otherwise fetch from backend (if we have a cluster ID)
    if (!target.clusterId) {
      // No cluster ID - allow manual entry without fetching
      setContainerPort(0);
      setLocalPort(0);
      return;
    }

    setIsLoadingPorts(true);
    import('@wailsjs/go/backend/App').then(({ GetTargetPorts }) => {
      GetTargetPorts(target.clusterId, target.namespace, target.kind, target.name)
        .then((ports) => {
          if (ports && ports.length > 0) {
            // Store fetched ports in local state
            const mappedPorts = ports.map((p) => ({
              port: p.port,
              name: p.name,
              protocol: p.protocol,
            }));
            setFetchedPorts(mappedPorts);
            const firstPort = ports[0].port;
            setContainerPort(firstPort);
            setLocalPort(getDefaultLocalPort(firstPort));
          } else {
            // No ports found - allow manual entry
            setContainerPort(0);
            setLocalPort(0);
          }
        })
        .catch((err) => {
          console.warn('Failed to fetch target ports:', err);
          // Allow manual entry if fetch fails
          setContainerPort(0);
          setLocalPort(0);
        })
        .finally(() => {
          setIsLoadingPorts(false);
        });
    });
    // targetKey provides stable identity tracking; target included for linter compliance
  }, [target, targetKey]);

  // Update local port when container port changes
  const handleContainerPortChange = useCallback((port: number) => {
    setContainerPort(port);
    setLocalPort(getDefaultLocalPort(port));
    setError(null);
  }, []);

  // Handle manual container port input
  const handleContainerPortInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(event.target.value, 10);
    const port = Number.isNaN(parsed) ? 0 : parsed;
    setContainerPort(port);
    if (port > 0) {
      setLocalPort(getDefaultLocalPort(port));
    }
    setError(null);
  }, []);

  // Handle local port input
  const handleLocalPortInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(event.target.value, 10);
    setLocalPort(Number.isNaN(parsed) ? 0 : parsed);
    setError(null);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!target) return;

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
    setError(null);

    try {
      const sessionId = await StartPortForward(target.clusterId, {
        namespace: target.namespace,
        targetKind: target.kind,
        targetName: target.name,
        containerPort,
        localPort,
      });

      // Notify parent of success
      onStarted?.(sessionId);
      onClose();
    } catch (err) {
      // Extract error message without showing a toast - the modal displays the error
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to start port forward');
    } finally {
      setIsLoading(false);
    }
  }, [target, containerPort, localPort, onStarted, onClose]);

  // Handle backdrop click (close only when clicking the overlay, not the modal content)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isLoading) {
        onClose();
      }
    },
    [isLoading, onClose]
  );

  // Don't render if no target
  if (!target) {
    return null;
  }

  // Use fetched ports if available, otherwise use ports from target
  const availablePorts = fetchedPorts.length > 0 ? fetchedPorts : target.ports;
  const hasPredefinedPorts = availablePorts.length > 0;

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-container port-forward-modal">
        {/* Header */}
        <div className="modal-header">
          <h2>Port Forward</h2>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close modal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

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
            <label>Container Port</label>
            {isLoadingPorts ? (
              // Loading indicator while fetching ports
              <div className="port-forward-loading">Loading available ports...</div>
            ) : hasPredefinedPorts ? (
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
                      {portInfo.name && (
                        <span className="port-forward-port-name">({portInfo.name})</span>
                      )}
                      {portInfo.protocol && (
                        <span className="port-forward-port-protocol">{portInfo.protocol}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              // Manual input for container port
              <div className="port-forward-input-group">
                <input
                  type="number"
                  className="port-forward-input"
                  min={1}
                  max={65535}
                  value={containerPort || ''}
                  onChange={handleContainerPortInput}
                  placeholder="Enter port (1-65535)"
                  disabled={isLoading}
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Local Port Input */}
          <div className="port-forward-field">
            <label htmlFor="port-forward-local-port">Local Port</label>
            <div className="port-forward-input-group">
              <input
                id="port-forward-local-port"
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
        {error && <div className="port-forward-error">{error}</div>}

        {/* Footer */}
        <div className="port-forward-footer">
          <button className="button cancel" onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button
            className="button save"
            onClick={handleSubmit}
            disabled={
              isLoading || isLoadingPorts || !isValidPort(containerPort) || !isValidPort(localPort)
            }
          >
            {isLoading ? 'Starting...' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortForwardModal;
