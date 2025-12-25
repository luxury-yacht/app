/**
 * frontend/src/shared/components/SegmentedButton.tsx
 *
 * UI component for SegmentedButton.
 * Handles rendering and interactions for the shared components.
 */

import './SegmentedButton.css';

interface SegmentedOption<T = string> {
  value: T;
  label: string;
  title?: string;
}

interface SegmentedButtonProps<T = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'small' | 'medium' | 'large';
}

function SegmentedButton<T = string>({
  options,
  value,
  onChange,
  className = '',
  size = 'medium',
}: SegmentedButtonProps<T>) {
  return (
    <div className={`segmented-button segmented-button--${size} ${className}`}>
      {options.map((option, index) => (
        <button
          key={index}
          className={`segmented-button__option ${value === option.value ? 'segmented-button__option--active' : ''}`}
          onClick={() => onChange(option.value)}
          title={option.title}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default SegmentedButton;
