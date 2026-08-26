interface HorizontalDropElement {
  getBoundingClientRect: () => Pick<DOMRect, 'left' | 'width'>;
}

interface DragTypeSource {
  types: ArrayLike<string>;
}

export function getHorizontalDropInsertIndex(
  elements: ArrayLike<HorizontalDropElement>,
  clientX: number
): number {
  for (let index = 0; index < elements.length; index += 1) {
    const rect = elements[index].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return index;
    }
  }
  return elements.length;
}

/** DataTransfer.types stays readable while the HTML drag data store is protected. */
export function hasDragDataType(dataTransfer: DragTypeSource | null, type: string): boolean {
  if (!dataTransfer) {
    return false;
  }
  for (const dragType of Array.from(dataTransfer.types)) {
    if (dragType === type) {
      return true;
    }
  }
  return false;
}
