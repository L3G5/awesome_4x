import { FACTIONS } from './content.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const amount = value => value > 0 && Math.round(value * 10) === 0 ? '&lt;0.1' : Number.isInteger(value) ? value : value.toFixed(1);

function renderSide(side, participant) {
  const modifiers = [];
  if (side.weaponsFactor !== 1) modifiers.push(`Weapons ×${side.weaponsFactor}`);
  if (side.factionFactor !== 1) modifiers.push(`${escape(FACTIONS[participant.owner].shortName)} doctrine ×${side.factionFactor}`);
  return `<div class="exchange-side" data-role="${participant.role}" style="--side-color:${FACTIONS[participant.owner].color}">
    <div class="exchange-formation"><span>${participant.role}</span><strong>${escape(participant.name)}</strong></div>
    <dl class="exchange-values"><div><dt>Volley fired</dt><dd>${amount(side.rawHit)}</dd></div><div><dt>Ships</dt><dd>${side.shipsBefore} <span>→</span> ${side.shipsAfter}</dd></div><div><dt>Hull</dt><dd>${amount(side.hullBefore)} <span>→</span> ${amount(side.hullAfter)}</dd></div></dl>
    <p class="exchange-power">Nominal firepower ${amount(side.firepower)}${modifiers.length ? ` · ${modifiers.join(' · ')}` : ''}</p>
    <p class="exchange-shield">${side.shieldFactor < 1 ? `Shields reduce incoming fire by ${Math.round((1 - side.shieldFactor) * 100)}%` : 'No shield reduction'}</p>
  </div>`;
}

/** Render only recorded battle-time values; no live fleets or technology. */
export function renderCombatRounds(report) {
  if (report.kind !== 'fleet') return '';
  if (!report.rounds) return '<p class="exchange-unavailable">Round detail was not recorded for this engagement.</p>';
  const rounds = report.rounds;
  const ending = report.outcome === 'contested'
    ? rounds.length === 4 ? 'Four-round limit reached. Both formations remain in orbit.' : 'Neither formation could deal damage. Both remain in orbit.'
    : report.outcome === 'mutual-destruction' ? 'Both formations are destroyed in the same exchange.'
      : report.outcome === 'attacker-destroyed' ? 'The attacking formation is destroyed. Its attack ends here.'
        : 'The defender is destroyed. A surviving attacker can face the next formation.';
  return `<details class="combat-exchanges"><summary>Inspect exchanges <span>· ${rounds.length} ${rounds.length === 1 ? 'round' : 'rounds'}</span></summary>
    <p class="exchange-explanation">Both formations fire from their strength at the start of each round. Ships lost reduce the next round’s firepower. Volley is shown before the target’s shields; hull loss is limited by remaining hull. Displayed values are rounded.</p>
    <ol class="exchange-list">${rounds.map(round => `<li class="combat-round" data-round="${round.number}"><h4>Round ${round.number}<span>Simultaneous fire</span></h4><div class="exchange-pair">${renderSide(round.attacker, report.participants[0])}${renderSide(round.defender, report.participants[1])}</div></li>`).join('')}</ol>
    <p class="exchange-ending">${ending}</p>
  </details>`;
}
