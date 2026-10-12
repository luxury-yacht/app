import type { types } from '@core/backend-api/models';

interface ShellSessionBarProps {
  session: types.ShellSession | null;
  container: string;
  fallbackShell: string;
  ending: boolean;
  onEnd: () => Promise<void>;
}

// Shown while a session is connected. End stays disabled until the session exists.
export default function ShellSessionBar({
  session,
  container,
  fallbackShell,
  ending,
  onEnd,
}: Readonly<ShellSessionBarProps>) {
  const shell = session?.command?.[0] ?? fallbackShell;
  return (
    <div className="shell-tab__session-bar">
      <span className="shell-tab__session-summary">
        {[container, shell].filter(Boolean).join(' · ')}
      </span>
      <button
        type="button"
        className="button generic shell-tab__end-session"
        onClick={() => void onEnd()}
        disabled={!session || ending}
      >
        End Session
      </button>
    </div>
  );
}
