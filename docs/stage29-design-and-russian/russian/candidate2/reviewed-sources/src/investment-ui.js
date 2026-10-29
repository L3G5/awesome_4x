const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
const percent = value => `${Math.round(value * 100)}%`;

function row(label, before, after, format = number, compare = true) {
  const change = compare && typeof before === 'number' && typeof after === 'number' ? after - before : 0;
  return `<tr><th scope="row">${label}</th><td>${escape(format(before))}</td><td class="${change > 0 ? 'investment-gain' : change < 0 ? 'investment-loss' : ''}">${escape(format(after))}</td></tr>`;
}

function throughputCell(side) {
  if (!side.available) return `<td class="throughput-unavailable">Unavailable<small>${escape(side.reason)}</small></td>`;
  return `<td><strong>${side.cycles} ${side.cycles === 1 ? 'cycle' : 'cycles'}</strong><small>◈ ${side.cost.credits} · ◇ ${side.cost.minerals}</small></td>`;
}

/** All values come from the copied current-conditions comparison. */
export function renderInvestmentComparison(comparison) {
  if (!comparison?.comparable) return '';
  const { before, after, project, construction, removed } = comparison;
  const effects = [
    row('Colony credits / cycle', before.colony.credits, after.colony.credits),
    row('Colony minerals / cycle', before.colony.minerals, after.colony.minerals),
    row('Colony science / cycle', before.colony.science, after.colony.science),
    row('Production / cycle', before.colony.production, after.colony.production),
    row('Population / capacity', `${before.colony.population} / ${before.colony.capacity}`, `${after.colony.population} / ${after.colony.capacity}`, String, false),
    row('Infrastructure slots used', `${before.infrastructure.used} / ${before.infrastructure.capacity}`, `${after.infrastructure.used} / ${after.infrastructure.capacity}`, String, false),
    row('Empire orders / cycle', before.empire.maxOrders, after.empire.maxOrders),
  ];
  if (before.colony.defense !== after.colony.defense) effects.push(row('Colony defenses', before.colony.defense, after.colony.defense));
  if (before.repair.capacity !== after.repair.capacity || before.repair.blocked) effects.push(row('Shared repair pool', before.repair.capacity, after.repair.capacity));
  if (before.militaryDiscount !== after.militaryDiscount) effects.push(row('Military mineral discount', before.militaryDiscount, after.militaryDiscount, percent));
  if (before.empire.beacons !== after.empire.beacons) effects.push(row('Owned beacons', before.empire.beacons, after.empire.beacons));
  const replaced = [removed.building?.name, removed.charter ? `${removed.charter.name} ${removed.charter.level === 2 ? 'II' : 'I'}` : null].filter(Boolean);
  const empireChanged = ['creditIncome', 'mineralIncome', 'scienceIncome'].some(key => before.empire[key] !== after.empire[key]);
  return `<details class="investment-comparison" data-investment="${escape(project.id)}"><summary>Compare investment <span>· current → completed</span></summary>
    <div class="investment-content"><div class="investment-project"><h3>${escape(project.name)}</h3><span>◈ ${project.cost.credits} credits · ◇ ${project.cost.minerals} minerals · ${project.orderCost} order</span></div><p class="investment-basis">At current population and technology. This compares the completed project with the colony as it is now.</p>
      <div class="investment-duration"><strong>${construction.cyclesAtCurrentRate} ${construction.cyclesAtCurrentRate === 1 ? 'cycle' : 'cycles'} to build this project</strong><span>${project.work} work at ${construction.production} production / cycle</span><small>Its new production cannot accelerate its own construction.</small></div>
      ${construction.queueBusy ? '<p class="investment-note">Finish or cancel the current project before commissioning. This estimate excludes that waiting time.</p>' : ''}
      ${replaced.length ? `<p class="investment-replacement">Replaced on completion: <strong>${escape(replaced.join(' and '))}</strong>. Existing benefits continue until then; the old investment is not refunded.</p>` : ''}
      <div class="investment-layout"><section class="investment-effects"><h4>Completed effects</h4><table class="investment-table"><caption class="sr-only">${escape(project.name)} effects at current population and technology</caption><thead><tr><th scope="col">Effect</th><th scope="col">Current</th><th scope="col">Completed</th></tr></thead><tbody>${effects.join('')}</tbody></table>
      ${after.colony.capacity < before.colony.capacity ? `<p class="investment-note">Population stays at ${after.colony.population}.${after.colony.growthPaused ? ' Natural growth is paused until capacity exceeds population.' : ''}</p>` : ''}
      ${before.empire.uncappedOrders !== after.empire.uncappedOrders && before.empire.maxOrders === after.empire.maxOrders ? `<p class="investment-note">The ${before.empire.orderLimit}-order cap keeps usable orders unchanged. Capacity before the cap: ${before.empire.uncappedOrders} → ${after.empire.uncappedOrders}.</p>` : ''}
      ${before.repair.capacity !== after.repair.capacity || before.repair.blocked ? `<p class="investment-note">Repair is one hull pool shared across formations each cycle.${after.repair.blocked ? ' Hostile fleets currently block repairs.' : ' Unused repair capacity does not carry over.'}</p>` : ''}
      ${empireChanged ? `<div class="investment-empire"><strong>Empire income / cycle</strong><span>Credits ${number(before.empire.creditIncome)} → ${number(after.empire.creditIncome)}</span><span>Minerals ${number(before.empire.mineralIncome)} → ${number(after.empire.mineralIncome)}</span><span>Science ${number(before.empire.scienceIncome)} → ${number(after.empire.scienceIncome)}</span><small>Includes current trade and fleet upkeep; excludes alignment funding. New income is collected from the cycle after completion.</small></div>` : ''}
      </section><section class="investment-future"><h4>One subsequent project</h4><p class="investment-basis">Build times at the current and completed production rates. Each project has its own payment; unused production does not carry into another commission.</p>
      <table class="investment-table investment-throughput"><thead><tr><th scope="col">Project</th><th scope="col">Current</th><th scope="col">Completed</th></tr></thead><tbody>${comparison.throughput.map(item => `<tr data-throughput="${escape(item.id)}"><th scope="row">${escape(item.name)}</th>${throughputCell(item.before)}${throughputCell(item.after)}</tr>`).join('')}</tbody></table>
      ${before.empire.beacons !== after.empire.beacons ? '<p class="investment-note">Beacon count alone does not guarantee alignment. The Protocol, three unblocked participating worlds and 60 credits per advancing cycle are still required.</p>' : ''}
      </section></div><p class="investment-limit">Growth, research and later events can change these rates and the completion time.</p>
    </div></details>`;
}
