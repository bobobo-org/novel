const FALLBACK_LOCKS = new Map<string, Promise<void>>();

type NavigatorWithLocks = Navigator & {
  locks?: {
    request<T>(
      name: string,
      options: { mode: "exclusive"; signal?: AbortSignal },
      callback: () => Promise<T>,
    ): Promise<T>;
  };
};

export async function withBrowserGpuLock<T>(input: {
  name?: string;
  signal?: AbortSignal;
  run: () => Promise<T>;
}): Promise<T> {
  const name = input.name ?? "novel-browser-sovereign-gpu";
  if (typeof navigator !== "undefined") {
    const locks = (navigator as NavigatorWithLocks).locks;
    if (locks?.request) {
      return locks.request(name, { mode: "exclusive", signal: input.signal }, input.run);
    }
  }

  const previous = FALLBACK_LOCKS.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  FALLBACK_LOCKS.set(name, tail);
  await previous;
  if (input.signal?.aborted) {
    release();
    throw new DOMException("Aborted", "AbortError");
  }
  try {
    return await input.run();
  } finally {
    release();
    if (FALLBACK_LOCKS.get(name) === tail) FALLBACK_LOCKS.delete(name);
  }
}
