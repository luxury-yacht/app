/**
 * frontend/src/shared/utils/forEachWithLimit.ts
 *
 * Runs an async step over a list without starting them all at once.
 */

/** Visits every item, at most `limit` at a time. */
export const forEachWithLimit = async <T>(
  items: readonly T[],
  limit: number,
  visit: (item: T) => Promise<void>
): Promise<void> => {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await visit(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, () => worker()));
};
