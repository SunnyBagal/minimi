/**
 * Runs `work` over `items` with at most `limit` tasks in flight, yielding each
 * result as it completes (completion order, not input order). Errors
 * propagate: the first rejection stops iteration and rethrows.
 */
export async function* pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): AsyncIterable<R> {
  // A limit below 1 would never launch; clamp it to sequential execution.
  const concurrency = Math.max(1, Math.floor(limit));
  const inFlight = new Map<number, Promise<R>>();
  let nextIndex = 0;

  const launch = () => {
    while (nextIndex < items.length && inFlight.size < concurrency) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) inFlight.set(index, Promise.resolve().then(() => work(item)));
    }
  };

  launch();
  while (inFlight.size > 0) {
    const winner = await Promise.race(
      [...inFlight.entries()].map(([index, task]) => task.then((value) => ({ index, value }))),
    );
    inFlight.delete(winner.index);
    launch();
    yield winner.value;
  }
}
