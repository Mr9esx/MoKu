/** Keep partially typed values in the form; convert only valid decimal millimetres. */
export function parseMillimetres(
  raw: string,
  min: number,
  max: number,
): number | undefined {
  const value = raw.normalize("NFKC").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : undefined;
}
