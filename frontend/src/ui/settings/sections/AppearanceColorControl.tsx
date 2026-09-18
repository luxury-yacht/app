import { useRef, useState } from 'react';

export default function AppearanceColorControl({
  title,
  help,
  value,
  defaultColor,
  onChange,
  onReset,
}: Readonly<{
  title: string;
  help: string;
  value: string;
  defaultColor: string;
  onChange: (value: string) => void;
  onReset: () => void;
}>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraft(value || defaultColor);
    setIsEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitDraft = () => {
    let hex = draft.trim().toLowerCase();
    if (!hex.startsWith('#')) {
      hex = `#${hex}`;
    }
    if (/^#[0-9a-f]{3}$/.test(hex)) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(hex);
    }
    setIsEditing(false);
  };

  const cancelEditing = () => setIsEditing(false);

  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <div className="settings-row-label-title">{title}</div>
        <div className="settings-row-label-help">{help}</div>
      </div>
      <div className="settings-row-control">
        <div className="palette-color-field">
          <input
            type="color"
            className="palette-accent-swatch"
            value={value || defaultColor}
            onChange={(e) => onChange(e.target.value)}
          />
          {isEditing ? (
            <input
              ref={inputRef}
              className="color-swatch-value palette-hex-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEditing();
                } else {
                  e.stopPropagation();
                }
              }}
              onBlur={cancelEditing}
              maxLength={7}
            />
          ) : (
            <button
              type="button"
              className="color-swatch-value palette-hex-clickable"
              onClick={startEditing}
              title="Click to edit hex value"
            >
              {value || defaultColor}
            </button>
          )}
          <button
            type="button"
            className="palette-row-reset"
            onClick={onReset}
            disabled={!value}
            title={`Reset ${title}`}
          >
            ↺
          </button>
        </div>
      </div>
    </div>
  );
}
