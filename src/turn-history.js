import { command, endTurn } from './game.js';

// The campaign remains the ordinary save format. Browser-only history stores
// complete prior states so discoveries, combat RNG, IDs and escrow rewind too.
export class TurnHistory {
  constructor(validate) {
    this.validate = validate;
    this.clear();
  }

  get size() { return this.entries.length; }

  clear() {
    this.entries = [];
    this.current = null;
  }

  record(before, after, context = {}, message = '') {
    const previous = JSON.stringify(before), current = JSON.stringify(after);
    if (this.current !== null && this.current !== previous) this.clear();
    if (before.seed !== after.seed || before.turn !== after.turn) {
      this.clear();
      return false;
    }
    if (previous === current) return false;
    this.entries.push({ snapshot: previous, context: cleanContext(context), message: String(message) });
    this.current = current;
    return true;
  }

  undo(state) {
    if (!this.entries.length) return null;
    if (this.current !== JSON.stringify(state)) { this.clear(); return null; }
    const entry = this.entries.pop();
    const previous = JSON.parse(entry.snapshot);
    this.current = this.entries.length ? entry.snapshot : null;
    return { state: previous, context: entry.context, message: entry.message };
  }

  serialize(state) {
    if (!this.entries.length) return null;
    if (this.current !== JSON.stringify(state)) { this.clear(); return null; }
    return JSON.stringify({ version: 1, current: this.current, entries: this.entries });
  }

  restore(serialized, state) {
    this.clear();
    if (!serialized) return false;
    try {
      const record = JSON.parse(serialized);
      if (record.version !== 1 || record.current !== JSON.stringify(state) || !Array.isArray(record.entries) || !record.entries.length) return false;
      const entries = record.entries.map(entry => {
        if (typeof entry.snapshot !== 'string' || typeof entry.message !== 'string') throw new Error('Invalid history entry');
        const previous = JSON.parse(entry.snapshot);
        if (!this.validate(previous) || previous.seed !== state.seed || previous.turn !== state.turn) throw new Error('History belongs to another cycle');
        return { snapshot: entry.snapshot, context: cleanContext(entry.context), message: entry.message };
      });
      this.entries = entries;
      this.current = record.current;
      return true;
    } catch { return false; }
  }
}

function cleanContext(value) {
  const context = {};
  if (!value || typeof value !== 'object') return context;
  for (const key of ['selectedSystemId', 'selectedFleetId', 'selectedRivalId', 'page', 'colonySort', 'colonySortDirection', 'researchFilter', 'logFilter']) {
    if (typeof value[key] === 'string' || value[key] === null) context[key] = value[key];
  }
  for (const key of ['workspaceScroll', 'colonyScroll', 'inspectorScroll']) {
    if (Number.isFinite(value[key]) && value[key] >= 0) context[key] = value[key];
  }
  return context;
}

export function applyTurnCommand(state, action, history, context = {}) {
  const candidate = structuredClone(state);
  const result = command(candidate, action);
  if (!result.ok) return { state, result };
  history.record(state, candidate, context, result.message);
  return { state: candidate, result };
}

export function applyTurnBoundary(state, history) {
  const candidate = structuredClone(state);
  const result = endTurn(candidate);
  if (!result.ok) return { state, result };
  // A rival can win during resolution before the cycle counter increments.
  history.clear();
  return { state: candidate, result };
}

export function persistTurnHistory(storage, saveKey, historyKey, state, history) {
  // Free history space before autosaving: optional rewind data must never stop
  // the current campaign from being saved when the browser quota is nearly full.
  try { storage.removeItem(historyKey); } catch {}
  try { storage.setItem(saveKey, JSON.stringify(state)); }
  catch { return { saved: false, historySaved: false }; }
  const serialized = history.serialize(state);
  if (!serialized) return { saved: true, historySaved: true };
  try {
    storage.setItem(historyKey, serialized);
    return { saved: true, historySaved: true };
  } catch { return { saved: true, historySaved: false }; }
}
