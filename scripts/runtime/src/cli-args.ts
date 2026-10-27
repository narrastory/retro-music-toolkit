/** Node parseArgs treats a separate negative number as another option. */
export function normalizeNumericArgs(args: string[]) {
  const result: string[] = [];
  const numeric = new Set(["--match-rms", "--from", "--to"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!,
      next = args[i + 1];
    if (
      numeric.has(arg) &&
      next &&
      /^-(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(next)
    ) {
      result.push(`${arg}=${next}`);
      i++;
    } else result.push(arg);
  }
  return result;
}
