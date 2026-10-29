/** Keep living and damaged fleets distinct at the chosen display precision. */
export function formatHull(current, maximum, precision = 1) {
  const factor = 10 ** precision;
  const rounded = Math.round(current * factor) / factor;
  const number = value => value.toLocaleString(undefined, { maximumFractionDigits: precision });
  const limit = number(maximum);
  const amount = current > 0 && rounded === 0 ? `<${number(1 / factor)}`
    : current < maximum && rounded >= maximum ? `<${limit}`
    : number(rounded);
  return `${amount} / ${limit}`;
}
