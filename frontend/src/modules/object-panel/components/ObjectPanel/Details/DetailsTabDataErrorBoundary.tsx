/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabDataErrorBoundary.tsx
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

class DetailsTabDataErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('DataSection error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when props change (e.g., switching between resources)
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="object-panel-section">
            <div className="object-panel-section-title">
              <span className="collapse-icon">▶</span>
              Data
              <span
                style={{
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--font-size-small)',
                  marginLeft: 'var(--spacing-sm)',
                }}
              >
                (Error loading data)
              </span>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export default DetailsTabDataErrorBoundary;
