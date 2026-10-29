const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const amount = value => value > 0 && value < .01 ? '<0.01' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const signed = value => `${value >= 0 ? '+' : '−'}${amount(Math.abs(value))}`;

export function alignmentOutlookSummary(outlook) {
  if (!outlook) return '';
  if (!outlook.networkReady) return outlook.networkReason;
  if (!outlook.fundingCovered) return `Short ${amount(outlook.shortfall)} credits after current income.`;
  return 'Funding is covered after current income; the network is clear now.';
}

export function renderAlignmentFunding(outlook) {
  if (!outlook) return '';
  const result = outlook.ready
    ? `${amount(outlook.creditsAfterAlignment)} credits would remain if alignment advances.`
    : !outlook.fundingCovered ? `Short ${amount(outlook.shortfall)} credits after current income.`
    : `Funding is covered. ${outlook.networkReason}`;
  return `<div class="alignment-outlook" data-funding-covered="${outlook.fundingCovered}" data-network-ready="${outlook.networkReady}">
    <h4>Funding at current income</h4>
    <dl class="alignment-budget">
      <div><dt>Current treasury</dt><dd data-budget="treasury">${escape(amount(outlook.treasury))}</dd></div>
      <div><dt>Ordinary income <small>after ${escape(amount(outlook.upkeep))} fleet upkeep</small></dt><dd data-budget="income">${escape(signed(outlook.creditIncome))}</dd></div>
      <div><dt>Available after income <small>minimum zero</small></dt><dd data-budget="after-income">${escape(amount(outlook.creditsAfterIncome))}</dd></div>
      <div><dt>Required per advancing cycle</dt><dd data-budget="cost">${escape(amount(outlook.cost))}</dd></div>
    </dl>
    <p class="alignment-budget-result${!outlook.fundingCovered ? ' funding-short' : ''}">${escape(result)}</p>
    <p class="alignment-budget-assumption">Estimate holds current income and network conditions fixed. Rival actions, treaty changes and completed research or construction can change the result.</p>
  </div>`;
}
