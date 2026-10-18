/** One read of a page, tagged with the query it was started for. */
export interface PageRead {
  page: number;
  epoch: number;
}

/**
 * Decides which pages of the server list to read. A wanted page is read when it
 * is not loaded yet or a reload marked it stale. A page is never read twice at
 * once, and a failed page waits for `retry`.
 */
export class PageTracker {
  private epoch = 0;
  private wanted: number[] = [];
  private loaded = new Set<number>();
  private stale = new Set<number>();
  private reading = new Set<number>();
  private failed = new Set<number>();

  want(pages: number[]) {
    this.wanted = pages;
  }

  next(): number[] {
    return this.wanted.filter(
      (p) =>
        !this.reading.has(p) &&
        !this.failed.has(p) &&
        (!this.loaded.has(p) || this.stale.has(p)),
    );
  }

  started(page: number): PageRead {
    this.reading.add(page);
    this.stale.delete(page);
    return { page, epoch: this.epoch };
  }

  finished(read: PageRead, ok: boolean) {
    if (!this.isCurrent(read)) return;
    this.reading.delete(read.page);
    if (ok) this.loaded.add(read.page);
    else this.failed.add(read.page);
  }

  isCurrent(read: PageRead): boolean {
    return read.epoch === this.epoch;
  }

  /** A reload: loaded pages are read again, and a page in flight is read again once it lands. */
  invalidate() {
    for (const p of this.loaded) this.stale.add(p);
    for (const p of this.reading) this.stale.add(p);
  }

  retry(page: number) {
    this.failed.delete(page);
    this.stale.add(page);
  }

  hasFailures(): boolean {
    return this.failed.size > 0;
  }

  /** A query change: everything read so far is forgotten, including reads still in flight. */
  reset() {
    this.epoch += 1;
    this.wanted = [];
    this.loaded = new Set();
    this.stale = new Set();
    this.reading = new Set();
    this.failed = new Set();
  }
}
