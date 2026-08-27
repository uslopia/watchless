// Lanes pulling from a shared cursor, not fixed batches. With batches, one slow item holds its
// whole batch and the other lanes idle: measured on a 4-chunk video over 3 lanes, 7.8 s of the
// 35.9 s analyze phase were spent with two lanes doing nothing. Results keep the input order,
// whatever the completion order.
export async function pool<T, R>(
  items: T[],
  width: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await run(items[i] as T, i);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, lane));
  return out;
}
