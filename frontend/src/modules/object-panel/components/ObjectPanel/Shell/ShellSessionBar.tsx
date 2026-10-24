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
  // A node shell runs in the debug pod the backend created for it.
  const subject = session?.debugPod?.name ?? container;
  return (
    <div className="shell-tab__session-bar">
      <span className="shell-tab__session-summary">
        {[subject, shell].filter(Boolean).join(' · ')}
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
