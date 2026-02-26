/** Minimal typed listener helper used internally by the connector. */
export class TypedEmitter<T> {
  private listeners: Array<(value: T) => void> = [];
  private errorListeners: Array<(err: unknown) => void> = [];
  private closed = false;

  on(listener: (value: T) => void): () => void {
    if (this.closed) return () => {};
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  onError(listener: (err: unknown) => void): () => void {
    if (this.closed) return () => {};
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    };
  }

  emit(value: T): void {
    if (this.closed) return;
    for (const l of [...this.listeners]) {
      try {
        l(value);
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  emitError(err: unknown): void {
    if (this.closed) return;
    for (const l of [...this.errorListeners]) {
      try {
        l(err);
      } catch {
        // swallow nested errors
      }
    }
  }

  close(): void {
    this.closed = true;
    this.listeners = [];
    this.errorListeners = [];
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
