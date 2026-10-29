const plates = {
  veyr: { file: 'veyr-consortium', position: '62% 42%', alt: 'Amber glass exchange halls and orbital terraces above a Veyr world.' },
  khar: { file: 'khar-dominion', position: '64% 45%', alt: 'A Khar commander overlooking immense foundries lit by molten metal.' },
  choir: { file: 'luminous-choir', position: '50% 52%', alt: 'The Choir gathered around a luminous shared consciousness beneath an ancient gate.' },
  observatory: { file: 'last-observatory', position: '58% 35%', alt: 'An expedition beneath a mountain encounters a great astronomical lens and a ring of ancient mirrors.' },
  reef: { file: 'patient-reef', position: '52% 48%', alt: 'An expedition studies tools grown inside a pale living mineral lattice.' },
};

/** Call only after the observer has learned this civilization or discovery. */
export function renderIllustration(id, { wide = false } = {}) {
  const plate = plates[id];
  if (!plate) return '';
  const base = import.meta.env?.BASE_URL || './';
  const position = wide && id === 'observatory' ? '58% 28%' : plate.position;
  return `<figure class="narrative-illustration" data-illustration="${id}"><img src="${base}art/${plate.file}.webp" width="1536" height="1024" loading="lazy" decoding="async" alt="${plate.alt}" style="object-position:${position}" /></figure>`;
}
