/**
 * frontend/src/shared/components/logs/LogResumeScrollingButton.tsx
 *
 * The log views' "Resume scrolling" button, shown while the view is scrolled
 * away from the newest line. The view decides what resuming does (follow the
 * tail again, restart auto-refresh when it is stopped).
 */

import './LogResumeScrollingButton.css';

const LogResumeScrollingButton = ({ onResume }: { onResume: () => void }) => (
  <button
    type="button"
    className="log-resume-scrolling"
    aria-label="Resume scrolling"
    onClick={onResume}
  >
    Resume scrolling
  </button>
);

export default LogResumeScrollingButton;
