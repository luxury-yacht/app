/**
 * frontend/src/shared/components/ToggleSwitch.tsx
 *
 * iOS-style on/off toggle. Drop-in replacement for boolean checkboxes.
 */

import './ToggleSwitch.css';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

function ToggleSwitch({
  checked,
  onChange,
  id,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  size = 'medium',
  className = '',
}: ToggleSwitchProps) {
  const handleClick = () => {
    if (disabled) return;
    onChange(!checked);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`toggle-switch toggle-switch--${size} ${checked ? 'toggle-switch--on' : 'toggle-switch--off'} ${className}`}
    >
      <span className="toggle-switch__thumb" aria-hidden="true" />
    </button>
  );
}

export default ToggleSwitch;
