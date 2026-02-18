/**
 * frontend/src/shared/components/tabs/Tabs/index.tsx
 *
 * Barrel exports for Tabs.
 * Tab styles now live in styles/components/tabs.css (imported globally).
 * This hook is kept for backward-compatibility with existing consumers.
 */

// Export a simple hook to ensure the CSS is imported when used
export const useTabStyles = () => {
  // Shared tab styles are now imported globally via styles/index.css.
  return true;
};
