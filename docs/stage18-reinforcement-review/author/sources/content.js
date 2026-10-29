/** Rules and authored content shared by the simulation and interface. */
export const FACTIONS = {
  player: { id: 'player', name: 'The Concord', shortName: 'Concord', color: '#68d9cd', motto: 'Many worlds. One horizon.', trait: 'Civic mandate', description: 'A federation of survivors, united by a fragile promise. Receives one additional order each turn.', home: 'Solace', leader: 'First Speaker Mara Voss' },
  veyr: { id: 'veyr', name: 'Veyr Consortium', shortName: 'Veyr', color: '#e5b665', motto: 'Every star has its price.', trait: 'Merchant houses', description: 'Trade leagues that turn the frontier into opportunity. Earns 25% more credits.', home: 'Veyr Prime', leader: 'Director Cassian Rook' },
  khar: { id: 'khar', name: 'Khar Dominion', shortName: 'Khar', color: '#ef7e7a', motto: 'The void respects strength.', trait: 'War foundries', description: 'A martial society forged on hostile worlds. Warships deal 15% more damage.', home: 'Kharos', leader: 'High Marshal Sera Kade' },
  choir: { id: 'choir', name: 'The Luminous Choir', shortName: 'Choir', color: '#bca0ef', motto: 'The universe remembers.', trait: 'Shared consciousness', description: 'A communion seeking the intelligence behind the ancient gates. Produces 25% more science.', home: 'Lumen', leader: 'The Ninth Voice' },
};

export const PLANET_TYPES = {
  terran: { name: 'Terran', color: '#64bbbd', description: 'Temperate oceans and broad continental shelves.' },
  arid: { name: 'Arid', color: '#d9ac72', description: 'Mineral deserts beneath an amber sky.' },
  ocean: { name: 'Ocean', color: '#5a93d5', description: 'An unbroken sea, rich with unfamiliar life.' },
  ice: { name: 'Glacial', color: '#b5dce4', description: 'Ancient ice hides a warm subsurface ocean.' },
  volcanic: { name: 'Volcanic', color: '#df7259', description: 'Restless tectonics expose rich seams of ore.' },
  barren: { name: 'Barren', color: '#8b919f', description: 'A silent surface, untouched by an atmosphere.' },
};

export const TECHS = {
  logistics: { id: 'logistics', name: 'Deep-space Logistics', category: 'Engineering', cost: 55, requires: [], description: '+1 order each turn. Opens automated industry and larger hulls.' },
  ecology: { id: 'ecology', name: 'Adaptive Biospheres', category: 'Society', cost: 60, requires: [], description: 'Colonize harsh worlds with 30% habitability. Unlocks Habitation Domes.' },
  physics: { id: 'physics', name: 'Resonance Theory', category: 'Physics', cost: 60, requires: [], description: '+2 science per colony. The first step toward understanding the gates.' },
  weapons: { id: 'weapons', name: 'Coherent Lances', category: 'Military', cost: 70, requires: [], description: 'All warships deal 25% more damage.' },
  industry: { id: 'industry', name: 'Autonomous Industry', category: 'Engineering', cost: 220, requires: ['logistics'], description: 'Unlocks Manufactories, which add 6 production per turn.' },
  diplomacy: { id: 'diplomacy', name: 'Stellar Accords', category: 'Society', cost: 180, requires: ['ecology'], description: 'Trade treaties earn +4 additional credits each turn. Unlocks Civic Forums.' },
  shields: { id: 'shields', name: 'Deflector Fields', category: 'Military', cost: 220, requires: ['physics'], description: 'Incoming fleet damage is reduced by 20%. Unlocks Orbital Bastions.' },
  cruisers: { id: 'cruisers', name: 'Capital Ship Architecture', category: 'Military', cost: 360, requires: ['logistics', 'weapons'], description: 'Unlocks heavily armed cruisers.' },
  terraforming: { id: 'terraforming', name: 'Worldshaping', category: 'Society', cost: 600, requires: ['ecology', 'industry'], description: 'Colonize any world. All colonies grow 50% faster.' },
  computing: { id: 'computing', name: 'Quantum Archives', category: 'Physics', cost: 360, requires: ['physics'], description: 'Laboratories produce +4 science. Unlocks the final gate technology.' },
  command: { id: 'command', name: 'Distributed Command', category: 'Engineering', cost: 500, requires: ['logistics', 'diplomacy'], description: '+2 orders each turn. Warships gain one additional move per turn.' },
  singularity: { id: 'singularity', name: 'The Asterion Protocol', category: 'Physics', cost: 1000, requires: ['computing', 'industry'], description: 'Unlocks Asterion Beacons. Align three owned, unblocked beacon worlds for 10 cycles at 60 credits per cycle to achieve transcendence.' },
};

export const BUILDINGS = {
  mine: { id: 'mine', name: 'Orbital Extractor', icon: '◇', cost: { credits: 20, minerals: 25 }, work: 24, requires: [], description: '+5 minerals each turn.', minerals: 5 },
  lab: { id: 'lab', name: 'Research Enclave', icon: '✧', cost: { credits: 30, minerals: 30 }, work: 30, requires: [], description: '+5 science each turn.', science: 5 },
  market: { id: 'market', name: 'Exchange Port', icon: '◈', cost: { credits: 25, minerals: 20 }, work: 24, requires: [], description: '+7 credits each turn.', credits: 7 },
  shipyard: { id: 'shipyard', name: 'Orbital Shipyard', icon: '⌁', cost: { credits: 25, minerals: 35 }, work: 32, requires: [], description: 'Build ships here. Adds 4 hull to this colony’s shared repair capacity each cycle.' },
  habitat: { id: 'habitat', name: 'Habitation Domes', icon: '◎', cost: { credits: 40, minerals: 35 }, work: 36, requires: ['ecology'], description: '+4 maximum population and +40% population growth.' },
  factory: { id: 'factory', name: 'Manufactory', icon: '▥', cost: { credits: 35, minerals: 45 }, work: 40, requires: ['industry'], description: '+6 construction production each turn.', production: 6 },
  forum: { id: 'forum', name: 'Civic Forum', icon: '⌂', cost: { credits: 50, minerals: 30 }, work: 40, requires: ['diplomacy'], description: '+1 order each turn and +3 credits.', credits: 3, orders: 1 },
  bastion: { id: 'bastion', name: 'Orbital Bastion', icon: '⛨', cost: { credits: 45, minerals: 60 }, work: 50, requires: ['shields'], description: '+30 colony defense. Invading fleets suffer retaliatory fire.', defense: 30 },
  beacon: { id: 'beacon', name: 'Asterion Beacon', icon: '✦', cost: { credits: 180, minerals: 180 }, work: 140, requires: ['singularity'], description: 'A public node of the ancient network. Three owned, unblocked beacons align over 10 cycles at 60 credits per cycle; interruptions lose one cycle of progress.' },
  ancient_observatory: { id: 'ancient_observatory', name: 'Ancient Observatory', icon: '✧', cost: { credits: 80, minerals: 40 }, work: 60, requires: ['computing'], discovery: 'observatory', science: 8, description: '+8 science each turn. A unique planetary site; occupies one slot and does not replace a Research Enclave or support an Academy Charter.' },
  lattice_works: { id: 'lattice_works', name: 'Lattice Works', icon: '❖', cost: { credits: 80, minerals: 40 }, work: 60, requires: ['industry'], discovery: 'reef', minerals: 4, production: 4, description: '+4 minerals and +4 production each turn. A living planetary site; occupies one slot and does not replace charter-supporting infrastructure.' },
};

export const SHIPS = {
  scout: { id: 'scout', name: 'Pathfinder', role: 'Scout', icon: '△', cost: { credits: 20, minerals: 20 }, work: 20, requires: [], hp: 18, attack: 3, moves: 2, upkeep: 1, description: 'Fast exploration vessel. Two jumps per turn; best kept away from combat.' },
  colony: { id: 'colony', name: 'Colony Ark', role: 'Colony ship', icon: '⬡', cost: { credits: 45, minerals: 55 }, work: 38, requires: [], hp: 24, attack: 0, moves: 1, upkeep: 1, description: 'Found a new colony on a surveyed, habitable world. Consumed when settling.' },
  frigate: { id: 'frigate', name: 'Vanguard', role: 'Frigate', icon: '▴', cost: { credits: 25, minerals: 35 }, work: 26, requires: [], hp: 34, attack: 12, moves: 1, upkeep: 2, description: 'Versatile escort and invasion vessel. Combine frigates into task forces.' },
  cruiser: { id: 'cruiser', name: 'Sovereign', role: 'Cruiser', icon: '◆', cost: { credits: 65, minerals: 85 }, work: 65, requires: ['cruisers'], hp: 85, attack: 31, moves: 1, upkeep: 4, description: 'Heavy capital ship designed to break fortified systems.' },
};

export const ANOMALIES = {
  archive: { id: 'archive', name: 'The Silent Archive', description: 'A moon-sized vault broadcasts a sequence of prime numbers. Its last inhabitants left two gifts, but the failing power core can preserve only one.', choices: [{ id: 'study', label: 'Recover their knowledge', description: 'Gain 50 science.', gain: { science: 50 } }, { id: 'salvage', label: 'Salvage the vault', description: 'Gain 65 minerals.', gain: { minerals: 65 } }] },
  pilgrims: { id: 'pilgrims', name: 'A Thousand Sleeping Voices', description: 'A drifting ark carries refugees in failing cryopods. Their destination has been dust for centuries.', choices: [{ id: 'welcome', label: 'Bring them home', description: 'Spend 20 credits; your capital gains 1 population.', cost: { credits: 20 }, population: 1 }, { id: 'supplies', label: 'Restore their navigation', description: 'Gain 25 science and 15 credits from their grateful archivist.', gain: { science: 25, credits: 15 } }] },
  forge: { id: 'forge', name: 'The Hollow Sun', description: 'Inside a shattered asteroid, autonomous foundries continue an order issued ten thousand years ago.', choices: [{ id: 'ore', label: 'Redirect the foundries', description: 'Gain 85 minerals.', gain: { minerals: 85 } }, { id: 'ship', label: 'Finish the ancient escort', description: 'An intact frigate joins your expedition.', ship: 'frigate' }] },
  garden: { id: 'garden', name: 'Garden Between Stars', description: 'A biosphere of impossible geometry grows beneath the surface. Its caretakers wait for a signal.', choices: [{ id: 'preserve', label: 'Wake the caretakers', description: 'Habitability rises by 25 points; gain 20 science.', habitability: 25, gain: { science: 20 } }, { id: 'harvest', label: 'Harvest the exotic compounds', description: 'Gain 65 credits and 25 minerals.', gain: { credits: 65, minerals: 25 } }] },
  echo: { id: 'echo', name: 'Echo of the First Gate', description: 'Your instruments detect a door folded into the fabric of space. For a moment, you hear your own voice answering from the other side.', choices: [{ id: 'listen', label: 'Map the resonance', description: 'Gain 75 science.', gain: { science: 75 } }, { id: 'reach', label: 'Reach through the echo', description: 'Chart every star within two jumps of this system.', reveal: 2 }] },
  wreck: { id: 'wreck', name: 'A Banner in the Dark', description: 'A forgotten flagship drifts through a field of broken weapons. Its cargo manifests survive alongside a surprisingly intact reactor.', choices: [{ id: 'credit', label: 'Claim the lost treasury', description: 'Gain 90 credits.', gain: { credits: 90 } }, { id: 'reactor', label: 'Study the reactor', description: 'Gain 40 science and 30 minerals.', gain: { science: 40, minerals: 30 } }] },
  observatory: {
    id: 'observatory', name: 'The Last Observatory', multiStage: true, support: 'lab', siteId: 'ancient_observatory',
    description: 'Beneath a mountain, a ring of mirrors still follows stars that no longer exist. One instrument has stopped moving. Its lens is pointed at your expedition.',
    matureDescription: 'The observatory’s final atlas is complete. Its instruments can preserve the measurements here, or compress their remaining precision into one portable record.',
    continuation: 'Settle this world and operate a Research Enclave for three completed cycles without hostile warships in orbit. Then choose 140 science and 30 credits, or restore an Ancient Observatory for 80 credits, 40 minerals and 60 work. Restoration requires Quantum Archives and one infrastructure slot (or explicit replacement), producing +8 science. The opportunity stays with the world if another empire takes it; progress never expires.',
    choices: [
      { id: 'salvage', label: 'Take the timing core', description: 'Gain 65 minerals and 20 science. Exhaust the observatory permanently.', gain: { minerals: 65, science: 20 } },
      { id: 'preserve', label: 'Let the observatory finish', description: 'Spend 40 credits and 20 minerals to begin restoration research.', cost: { credits: 40, minerals: 20 }, requires: ['physics'], preserve: true },
    ],
    finalChoices: [
      { id: 'restore', label: 'Keep the sky here', description: 'Commission an Ancient Observatory: 80 credits, 40 minerals, 60 work, one slot; +8 science each turn. Cancelling construction preserves the restoration plan but never reopens salvage.', buildingId: 'ancient_observatory' },
      { id: 'harvest', label: 'Publish the last atlas', description: 'Gain 140 science and 30 credits. Exhaust the observatory permanently.', gain: { science: 140, credits: 30 } },
    ],
  },
  reef: {
    id: 'reef', name: 'The Patient Reef', multiStage: true, support: 'mine', siteId: 'lattice_works',
    description: 'A pale lattice grows through the planet’s crust. Each branch encloses a tool. None contains a weapon. Far below, something waits for permission to continue.',
    matureDescription: 'The reef has learned your machines. Its new chambers contain unfinished bridges and empty workshops. It can grow with this settlement, or surrender one final harvest.',
    continuation: 'Settle this world and operate an Orbital Extractor for three completed cycles without hostile warships in orbit. Then choose 120 minerals and 20 science, or grow Lattice Works for 80 credits, 40 minerals and 60 work. Restoration requires Autonomous Industry and one infrastructure slot (or explicit replacement), producing +4 minerals and +4 production. The opportunity stays with the world if another empire takes it; progress never expires.',
    choices: [
      { id: 'salvage', label: 'Quarry the lattice', description: 'Gain 85 minerals. Exhaust the reef permanently.', gain: { minerals: 85 } },
      { id: 'preserve', label: 'Feed the root', description: 'Spend 35 credits and 20 minerals to preserve the living structure.', cost: { credits: 35, minerals: 20 }, requires: ['ecology'], preserve: true },
    ],
    finalChoices: [
      { id: 'restore', label: 'Grow a living foundry', description: 'Commission Lattice Works: 80 credits, 40 minerals, 60 work, one slot; +4 minerals and +4 production each turn. Cancelling construction preserves the restoration plan but never reopens salvage.', buildingId: 'lattice_works' },
      { id: 'harvest', label: 'Harvest its final bloom', description: 'Gain 120 minerals and 20 science. Exhaust the reef permanently.', gain: { minerals: 120, science: 20 } },
    ],
  },
};

export const SYSTEM_NAMES = ['Solace', 'Veyr Prime', 'Kharos', 'Lumen', 'Meridian', 'Hesper', 'Aurelia', 'Nacre', 'Caldera', 'Velorum', 'Ashfall', 'Carina', 'Eidolon', 'Sable', 'Ilyra', 'Kepler', 'Stillwater', 'Orison', 'Cinder', 'Bellatrix', 'Sundrift', 'Thalassa', 'Ophion', 'Tethys', 'Corvus', 'Elysian', 'Aster', 'Nyx', 'Haven', 'Aldebaran', 'Caelum', 'Vesper', 'Iona', 'Halcyon', 'Antares', 'Seraph', 'Peregrine', 'Morrow', 'Zenith', 'Eos', 'Terminus', 'Asterion'];
