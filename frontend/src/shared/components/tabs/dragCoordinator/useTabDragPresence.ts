import { useEffect, useState } from 'react';
import type { TabDragPayload } from './types';
import { type TabDragAcceptance, useTabDragAcceptance } from './useTabDragAcceptance';

/** Reveal otherwise absent destinations for local and incoming native tab drags. */
export function useTabDragPresence<K extends TabDragPayload['kind']>(
  options: TabDragAcceptance<K>
): boolean {
  const acceptsDrag = useTabDragAcceptance(options);
  const [present, setPresent] = useState(false);

  useEffect(() => {
    let enteredTarget: EventTarget | null = null;
    let dropCleanup: number | undefined;
    const reset = () => {
      window.clearTimeout(dropCleanup);
      enteredTarget = null;
      setPresent(false);
    };
    const observe = (event: DragEvent) => {
      window.clearTimeout(dropCleanup);
      setPresent(acceptsDrag(event));
    };
    const enter = (event: DragEvent) => {
      enteredTarget = event.target;
      observe(event);
    };
    const leave = (event: DragEvent) => {
      // Native dragenter for the new element precedes dragleave for the old one.
      if (event.target === enteredTarget) {
        reset();
      }
    };
    const finishDrop = () => {
      // Keep the target mounted until its own drop listener consumes the event.
      // Native dispatch can flush React updates between capture and target phases.
      dropCleanup = window.setTimeout(reset, 0);
    };
    // Bubble dragstart runs after the source writes its MIME markers and guard decision.
    document.addEventListener('dragstart', observe);
    document.addEventListener('dragenter', enter, true);
    document.addEventListener('dragover', observe, true);
    document.addEventListener('dragleave', leave, true);
    document.addEventListener('drop', finishDrop, true);
    document.addEventListener('dragend', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('dragstart', observe);
      document.removeEventListener('dragenter', enter, true);
      document.removeEventListener('dragover', observe, true);
      document.removeEventListener('dragleave', leave, true);
      document.removeEventListener('drop', finishDrop, true);
      document.removeEventListener('dragend', reset, true);
      window.removeEventListener('blur', reset);
      window.clearTimeout(dropCleanup);
    };
  }, [acceptsDrag]);

  return present;
}
