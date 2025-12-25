/**
 * frontend/src/shared/components/tabs/Tabs/index.tsx
 *
 * Barrel exports for Tabs.
 * Re-exports public APIs for the shared components.
 */

// This file imports the Tabs.css styles to make them available
// The actual tab components are implemented in their respective locations
// (e.g., ObjectPanel) but they all use these shared styles

import './Tabs.css';

// Export a simple hook to ensure the CSS is imported when used
export const useTabStyles = () => {
  // This hook ensures the CSS is loaded
  return true;
};
