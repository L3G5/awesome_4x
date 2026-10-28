import { FACTIONS, SHIPS } from './content.js';
import { shipImage } from './ship-art.js';

export function renderShipPortrait(type, factionId = 'player', ancient = false) {
  if (!SHIPS[type]) return '';
  const source = shipImage(type, { color: FACTIONS[factionId]?.color || FACTIONS.player.color, ancient });
  return `<img class="ship-portrait" src="${source}" width="512" height="320" alt="${ancient ? 'Ancient ' : ''}${SHIPS[type].name} hull" decoding="async" />`;
}
