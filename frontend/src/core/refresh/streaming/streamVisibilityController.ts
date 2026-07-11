export class StreamVisibilityController<T> {
  private readonly config: {
    captureActive: () => T[];
    suspendActive: (items: T[]) => void;
    resumeItems?: (suspendedItems: T[]) => T[];
    resumeItem: (item: T) => void;
  };
  private suspended = false;
  private suspendedItems: T[] = [];

  constructor(config: {
    captureActive: () => T[];
    suspendActive: (items: T[]) => void;
    resumeItems?: (suspendedItems: T[]) => T[];
    resumeItem: (item: T) => void;
  }) {
    this.config = config;
  }

  suspend = (): void => {
    if (this.suspended) {
      return;
    }
    this.suspended = true;
    this.suspendedItems = this.config.captureActive();
    if (this.suspendedItems.length > 0) {
      this.config.suspendActive(this.suspendedItems);
    }
  };

  resume = (): void => {
    if (!this.suspended) {
      return;
    }
    this.suspended = false;
    const items = this.config.resumeItems?.(this.suspendedItems) ?? this.suspendedItems;
    this.suspendedItems = [];
    for (const item of items) {
      this.config.resumeItem(item);
    }
  };
}
