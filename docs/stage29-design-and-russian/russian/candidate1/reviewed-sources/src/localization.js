/** Presentation-only localization. Canonical English strings and campaign saves stay unchanged. */
import { russian } from './locales/ru.js';
import { bindings } from './locales/bindings.js';

const normalize = value => value.replace(/\s+/g, ' ').trim();
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const literal = new Map(Object.entries(russian).filter(([key]) => !/\{\d+\}/.test(key)));
const folded = new Map([...literal].map(([key, value]) => [key.toLocaleLowerCase('en'), value]));
const fragmentPattern = '(?:[^.!?;·]|\\.(?=\\d))*?';
function slotPattern(entry, key, slot) {
  if (!entry && /^\{\d+\} (?:orders?|ships?|fleets?|colon(?:y|ies)|jumps?|cycles?|rounds?|credits?|minerals?|science|production|combat power|hull|restored beacons?|beacons?)/.test(key)) entry = { kind: 'number' };
  if (entry?.kind === 'enum') return `(?:${entry.options.map(escapeRegExp).join('|')})`;
  if (entry?.kind === 'number') return '[+−\\-<>≥≤]?[\\d., /%–−\\-]+';
  if (entry?.kind === 'text') return '.*?';
  return fragmentPattern;
}
const templates = Object.entries(russian).filter(([key]) => /\{\d+\}/.test(key)).flatMap(([key, value]) => {
  const shapes = bindings[key] || [{}];
  return shapes.map(shape => {
    const slots = [], fragments = key.split(/(\{\d+\})/);
    const source = fragments.map(fragment => {
      const match = fragment.match(/^\{(\d+)\}$/);
      if (!match) return escapeRegExp(fragment);
      slots.push(match[1]);
      return `(${slotPattern(shape[match[1]], key, match[1])})`;
    }).join('');
    const anchors = fragments.filter(fragment => !/^\{\d+\}$/.test(fragment) && /[a-z]/i.test(fragment));
    return { key, value, slots, pattern: new RegExp(`^${source}$`), foldedPattern: new RegExp(`^${source}$`, 'i'), anchors, weight: anchors.join('').replace(/[^a-z]/gi, '').length };
  });
}).filter(entry => entry.weight > 1).sort((a, b) => b.weight - a.weight);
const cache = new Map();
const misses = new Set();

function matchTemplate(text, language, depth, minimumWeight = 0) {
  const lower = text.toLocaleLowerCase('en');
  for (const insensitive of [false, true]) {
    for (const entry of templates) {
      if (entry.weight < minimumWeight || !entry.anchors.every(anchor => lower.includes(anchor.toLocaleLowerCase('en')))) continue;
      const match = (insensitive ? entry.foldedPattern : entry.pattern).exec(text);
      if (!match) continue;
      const values = Object.fromEntries(entry.slots.map((slot, index) => [slot, match[index + 1]]));
      return entry.value.replace(/\{(\d+)\}/g, (_, slot) => translateText(values[slot] ?? '', language, depth + 1));
    }
  }
}

/** Translate one rendered text run; only explicit catalog entries/templates are interpreted. */
export function translateText(value, language = 'en', depth = 0) {
  const original = String(value ?? '');
  if (language !== 'ru' || !/[a-z]/i.test(original) || depth > 12) return original;
  const text = normalize(original);
  if (!text) return original;
  let translated = cache.get(text);
  if (translated === undefined) {
    translated = literal.get(text);
    if (translated === undefined) {
      const alternative = folded.get(text.toLocaleLowerCase('en'));
      if (alternative !== undefined) {
        translated = text === text.toUpperCase() ? alternative.toUpperCase() : alternative;
        if (text !== text.toUpperCase() && alternative === alternative.toUpperCase()) {
          translated = alternative.toLocaleLowerCase('ru');
          if (text[0] === text[0].toUpperCase()) translated = translated[0].toLocaleUpperCase('ru') + translated.slice(1);
        }
      }
    }
    // Full authored sentences take precedence over the independently composed summary fields.
    if (translated === undefined) translated = matchTemplate(text, language, depth, 20);
    if (translated === undefined && /\s[·+]\s/.test(text)) {
      const parts = text.split(/(\s+·\s+|\s+\+\s+)/);
      const result = parts.map(part => translateText(part, language, depth + 1)).join('');
      if (result !== text) translated = result;
    }
    if (translated === undefined) {
      const decorated = text.match(/^([◇⌁✧▥◎⌂⛨✦▲▴△◆⬡↳↓↑✓●]+\s*)?(.+?)(\s*[→↗←]+)?$/);
      if (decorated && (decorated[1] || decorated[3])) {
        const middle = translateText(decorated[2], language, depth + 1);
        if (middle !== decorated[2]) translated = (decorated[1] || '') + middle + (decorated[3] || '');
      }
    }
    if (translated === undefined && /[.!?;] (?=[A-Z])/.test(text)) {
      const parts = text.split(/(?<=[.!?;]) (?=[A-Z])/);
      const result = parts.map(part => translateText(part, language, depth + 1)).join(' ');
      if (result !== text) translated = result;
    }
    if (translated === undefined) translated = matchTemplate(text, language, depth);
    if (translated === undefined) {
      translated = text;
      if (depth === 0) misses.add(text);
    }
    if (cache.size > 5000) cache.clear();
    cache.set(text, translated);
  }
  if (translated === text) return original;
  return original.replace(/\S(?:[\s\S]*\S)?/, () => translated);
}

/** Localize text/accessible names without replacing elements, listeners, values, or focus. */
export function localizeInterface(root, initialLanguage = 'en') {
  let language = initialLanguage === 'ru' ? 'ru' : 'en';
  const englishTitle = document.title;
  const sourceText = new WeakMap(), sourceAttributes = new WeakMap();
  const attributes = ['title', 'aria-label', 'placeholder', 'alt'];
  const skip = node => node.parentElement?.closest('[data-i18n-skip], [translate="no"], script, style, textarea, input');
  function textNode(node) {
    if (skip(node)) return;
    const previous = sourceText.get(node);
    const source = previous && node.data === previous.rendered ? previous.source : node.data;
    const rendered = translateText(source, language);
    sourceText.set(node, { source, rendered });
    if (node.data !== rendered) node.data = rendered;
  }
  function element(node) {
    if (!node.matches('[data-action="language"]') && node.closest('[data-i18n-skip], [translate="no"], script, style')) return;
    let records = sourceAttributes.get(node);
    if (!records) { records = {}; sourceAttributes.set(node, records); }
    for (const name of attributes) {
      if (!node.hasAttribute(name)) continue;
      const current = node.getAttribute(name), previous = records[name];
      const source = previous && current === previous.rendered ? previous.source : current;
      const rendered = translateText(source, language);
      records[name] = { source, rendered };
      if (current !== rendered) node.setAttribute(name, rendered);
    }
    if (node.matches('[data-action="language"]')) {
      node.textContent = language === 'ru' ? 'English' : 'Русский';
      node.setAttribute('lang', language === 'ru' ? 'en' : 'ru');
      node.setAttribute('aria-label', language === 'ru' ? 'Switch interface to English' : 'Переключить интерфейс на русский');
      node.title = language === 'ru' ? 'Switch interface to English' : 'Переключить интерфейс на русский';
    }
  }
  function visit(node) {
    if (!node.isConnected) return;
    if (node.nodeType === Node.TEXT_NODE) return textNode(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    element(node);
    if (node.matches('[data-i18n-skip], [translate="no"], script, style, textarea, input, [data-action="language"]')) return;
    for (const child of node.childNodes) visit(child);
  }
  const observe = () => observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: attributes });
  const observer = new MutationObserver(records => {
    observer.disconnect();
    const nodes = new Set();
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) nodes.add(node);
      else nodes.add(record.target);
    }
    for (const node of nodes) visit(node);
    observe();
  });
  function setLanguage(value) {
    language = value === 'ru' ? 'ru' : 'en';
    observer.disconnect();
    document.documentElement.lang = language;
    document.title = language === 'ru' ? 'Asterion Reach — Космическая 4X' : englishTitle;
    visit(root);
    observe();
  }
  setLanguage(language);
  return {
    setLanguage,
    get language() { return language; },
    getUntranslated: () => [...misses].sort(),
    disconnect: () => observer.disconnect(),
  };
}
