/**
 * frontend/src/shared/components/errors/ResourceBarErrorBoundary.tsx
 *
 * UI component for ResourceBarErrorBoundary.
 * Handles rendering and interactions for the shared components.
 */

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ResourceBarErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ResourceBar error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when props change (e.g., switching pods)
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="resource-bar-container">
            <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>
              Unable to display metrics
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export default ResourceBarErrorBoundary;
