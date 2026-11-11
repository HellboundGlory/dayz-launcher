const DEBOUNCE_MS = 250;

export interface DebouncedLoader<T> {
  /** Send now, or once the requests have settled; either way a waiting send is dropped. */
  request(now: boolean, send: () => Promise<T>): void;
  /** Drop a waiting send, and any reply already on its way. */
  stop(): void;
}

/**
 * One request at a time, with the reply dropped unless it answers the newest
 * send — a slow answer must not overwrite a fresher one.
 */
export function createDebouncedLoader<T>(
  onValue: (value: T) => void,
  onFailure: () => void,
): DebouncedLoader<T> {
  let newest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const run = (send: () => Promise<T>) => {
    const id = ++newest;
    send().then(
      (value) => {
        if (id === newest) onValue(value);
      },
      () => {
        if (id === newest) onFailure();
      },
    );
  };

  return {
    request(now, send) {
      clear();
      if (!now) {
        timer = setTimeout(() => {
          timer = undefined;
          run(send);
        }, DEBOUNCE_MS);
        return;
      }
      run(send);
    },
    stop() {
      clear();
      newest++;
    },
  };
}
