import { describe, expect, it } from 'vitest';
import { getSidebarWidthFromKey } from './useSidebarResize';

describe('getSidebarWidthFromKey', () => {
  it('resizes within bounds with arrows and jumps to bounds with Home and End', () => {
    expect(getSidebarWidthFromKey(250, 'ArrowLeft')).toBe(234);
    expect(getSidebarWidthFromKey(250, 'ArrowRight')).toBe(266);
    expect(getSidebarWidthFromKey(205, 'ArrowLeft')).toBe(200);
    expect(getSidebarWidthFromKey(495, 'ArrowRight')).toBe(500);
    expect(getSidebarWidthFromKey(350, 'Home')).toBe(200);
    expect(getSidebarWidthFromKey(350, 'End')).toBe(500);
    expect(getSidebarWidthFromKey(350, 'Enter')).toBeNull();
  });
});
