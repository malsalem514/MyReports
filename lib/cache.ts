type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  staleUntil: number;
};

type CachifiedOptions<T> = {
  key: string;
  ttl: number;
  staleWhileRevalidate?: number;
  getFreshValue: () => Promise<T>;
};

const cacheStore = new Map<string, CacheEntry<unknown>>();
const pendingRefresh = new Map<string, Promise<unknown>>();

async function refresh<T>(key: string, options: CachifiedOptions<T>): Promise<T> {
  const existing = pendingRefresh.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const task = options
    .getFreshValue()
    .then((value) => {
      const now = Date.now();
      cacheStore.set(key, {
        value,
        expiresAt: now + options.ttl,
        staleUntil: now + options.ttl + (options.staleWhileRevalidate || 0),
      });
      return value;
    })
    .finally(() => {
      pendingRefresh.delete(key);
    });

  pendingRefresh.set(key, task);
  return task;
}

export async function cachified<T>(options: CachifiedOptions<T>): Promise<T> {
  const now = Date.now();
  const cached = cacheStore.get(options.key) as CacheEntry<T> | undefined;

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached && cached.staleUntil > now) {
    void refresh(options.key, options);
    return cached.value;
  }

  return refresh(options.key, options);
}
