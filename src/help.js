// Node-side help topics, shared by MCP pixel_help and `pixelbolt help <topic> [section]`: the quick start, the two
// guides, the recipe schema, a complete example, then the schema of each source format. The presets topics are built
// from examples/ when asked (presets.js), so they are listed here but served by the caller.
import { readFile } from 'node:fs/promises';
import { PixelError } from './core.js';

export const QUICK_START = '../docs/agent-quick-start.md';
export const HELP_TOPICS = {
  guide: '../docs/agent-guide.md', workflow: '../docs/art-workflow.md', craft: '../docs/agent-craft.md', schema: '../schema.json', example: '../examples/forest-spirit.json',
  poses: '../poses.schema.json', scenes: '../scene.schema.json', autotile: '../autotile.schema.json', fx: '../fx.schema.json', fluid: '../fluid.schema.json', wave: '../wave.schema.json', crystal: '../crystal.schema.json', powder: '../powder.schema.json', bodies: '../bodies.schema.json', normals: '../normals.schema.json'
};
export const TOPICS = [...Object.keys(HELP_TOPICS), 'presets', 'preset'];
// Topics whose file is JSON (the schemas and the example), which MCP returns parsed.
export const jsonTopic = topic => HELP_TOPICS[topic]?.endsWith('.json') ?? false;
// The guide and the workflow are long (the workflow passes 200 KB, and its fluid section 60), so a reply is never a
// whole document unless it is asked for:
// - without a `name`, the document's opening and the list of its `## ` sections with their sizes;
// - a `name` that starts a section's heading, that section under the document's title, or, for a section over
//   PART_BYTES that has `### ` parts, its opening and the list of those parts;
// - a `name` that starts a part's heading, that part;
// - any other `name`, the paragraphs that mention it: what a reader would otherwise search the file for;
// - "all" the whole document, and "<section> all" a whole section.
// The craft notes are the pixel art skill's checklists, read a section at a time.
export const SECTIONED = new Set(['guide', 'workflow', 'craft']);

// How each interface asks for one section, for the line that lists them.
const ASK = {
  mcp: topic => `call pixel_help with topic "${topic}" and name set to its heading`,
  cli: topic => `run pixelbolt help ${topic} "<heading>" (the start of a heading is enough)`
};
// The size past which a section with parts lists them, what a search returns at most, and the length past which a
// line gives only its sentences that mention the word.
const PART_BYTES = 12288, FOUND_BYTES = 6144, LONG_LINE = 900;
const kilobytes = lines => `${Math.ceil(Buffer.byteLength(lines.join('\n')) / 1024)} KB`;

// The paragraphs of a document that mention a word, each cut to what mentions it: a table to its matching rows, a
// list to its matching items, a long line to its matching sentences. Those with the word as a name (`text`, "text")
// come first, then the rest, as far as FOUND_BYTES go; `more` counts what was left out, by section.
function mentions(lines, sections, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), has = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i'), named = new RegExp(`[\`"]${escaped}(?![A-Za-z0-9])|(?<![A-Za-z0-9])${escaped}[\`"]`, 'i');
  const cut = block => {
    if (block[0].startsWith('```')) return block.join('\n').length <= LONG_LINE * 2 ? block : block.filter((line, index) => index === 0 || index === block.length - 1 || has.test(line));
    const table = block.length > 2 && block.every(line => line.startsWith('|'));
    return block.filter((line, index) => (table && index < 2) || has.test(line)).map(line => (line.length <= LONG_LINE ? line : line.split(/(?<=[.)]) (?=[A-Z`])/).filter(sentence => has.test(sentence)).join(' … ')));
  };
  const found = [];
  [{ heading: '', index: 0, end: sections[0]?.index ?? lines.length }, ...sections].forEach(section => {
    let block = [], fenced = false;
    const flush = () => { if (block.length && has.test(block.join('\n'))) found.push({ heading: section.heading, text: cut(block).join('\n'), named: named.test(block.join('\n')) }); block = []; };
    for (const line of lines.slice(section.index + 1, section.end)) {
      if (line.startsWith('```')) { if (!fenced) flush(); fenced = !fenced; block.push(line); if (!fenced) flush(); }
      else if (!fenced && (line.trim() === '' || line.startsWith('#'))) flush();
      else block.push(line);
    }
    flush();
  });
  const order = [...found.filter(item => item.named), ...found.filter(item => !item.named)], kept = new Set();
  let bytes = 0;
  for (const item of order) { bytes += Buffer.byteLength(item.text); if (kept.size && bytes > FOUND_BYTES) break; kept.add(item); }
  const more = new Map();
  for (const item of found) if (!kept.has(item)) more.set(item.heading || 'the opening', (more.get(item.heading || 'the opening') ?? 0) + 1);
  return { found: found.filter(item => kept.has(item)), more };
}

export function helpDocument(topic, text, name, via = 'mcp') {
  // Sections (`## `) and, inside each, its parts (`### `), with the line each starts on and the line after its last.
  const lines = text.split('\n'), sections = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) sections.push({ heading: line.slice(3).trim(), index, parts: [] });
    else if (!fenced && line.startsWith('### ') && sections.length) sections.at(-1).parts.push({ heading: line.slice(4).trim(), index });
  });
  sections.forEach((section, i) => {
    section.end = sections[i + 1]?.index ?? lines.length;
    section.parts.forEach((part, k) => { part.end = section.parts[k + 1]?.index ?? section.end; });
  });
  const start = sections[0]?.index ?? lines.length, sized = item => `${item.heading} (${kilobytes(lines.slice(item.index, item.end))})`;
  const page = body => [lines[0], '', ...body].join('\n').trimEnd() + '\n';
  if (name === undefined) return page([`> ${kilobytes(lines)} in all. To read one section, ${ASK[via](topic)}: ${sections.map(sized).join('; ')}. A word that starts no heading returns the paragraphs that mention it, and "all" the whole document.`, ...lines.slice(1, start)]);
  const asked = name.trim().toLowerCase(), whole = asked === 'all' || asked.endsWith(' all'), wanted = whole ? asked.slice(0, -3).trim() : asked;
  if (whole && !wanted) return text;
  // The heading that is the name, else the first that starts with it: a section's before a part's.
  const pick = items => items.find(item => item.heading.toLowerCase() === wanted) ?? items.find(item => item.heading.toLowerCase().startsWith(wanted));
  const section = wanted ? pick(sections) : undefined;
  if (section) {
    const first = section.parts[0]?.index;
    if (whole || first === undefined || Buffer.byteLength(lines.slice(section.index, section.end).join('\n')) <= PART_BYTES) return page(lines.slice(section.index, section.end));
    return page([lines[section.index], '', `> ${kilobytes(lines.slice(section.index, section.end))} in this section, so here is its opening. Its parts, each read by its heading as a section is: ${section.parts.map(sized).join('; ')}. "${section.heading} all" is the whole section.`, ...lines.slice(section.index + 1, first)]);
  }
  for (const parent of wanted ? sections : []) {
    const part = pick(parent.parts);
    if (part) return page([lines[parent.index], '', ...lines.slice(part.index, part.end)]);
  }
  const { found, more } = wanted ? mentions(lines, sections, name.trim()) : { found: [] };
  if (!found.length) throw new PixelError('name', `topic ${topic} has no section "${name}" and no paragraph that mentions it; its sections are ${sections.map(item => item.heading).join(', ')}`);
  const out = [`> No section of ${topic} starts with "${name.trim()}". ${found.length === 1 ? 'The one paragraph that mentions it' : `The ${found.length} paragraphs that mention it`}${more.size ? `, of ${found.length + [...more.values()].reduce((sum, count) => sum + count, 0)} (the rest: ${[...more].map(([heading, count]) => `${heading} ${count}`).join(', ')}; a section's heading or a longer phrase narrows it)` : ''}:`];
  found.forEach((item, index) => { if (item.heading && item.heading !== found[index - 1]?.heading) out.push('', `## ${item.heading}`); out.push('', item.text); });
  return page(out);
}

// The quick start has a section for each interface, and a reader gets its own: an MCP client the tools, a shell the
// commands. The file itself holds both.
const NOT_FOR = { mcp: 'The commands', cli: 'The tools' };
export function quickStart(text, via = 'mcp') {
  const lines = text.replace(/\r\n/g, '\n').split('\n'), from = lines.indexOf(`## ${NOT_FOR[via]}`);
  if (from < 0) return text;
  const next = lines.findIndex((line, index) => index > from && line.startsWith('## '));
  return [...lines.slice(0, from), ...(next < 0 ? [] : lines.slice(next))].join('\n');
}

// A document topic as text: the quick start without a topic, a guide (its opening and sections, one section, or what
// mentions a word), a schema or the example as written.
export async function helpText(topic, name, via = 'mcp') {
  const file = topic === undefined ? QUICK_START : HELP_TOPICS[topic], text = await readFile(new URL(file, import.meta.url), 'utf8');
  if (topic === undefined) return quickStart(text, via);
  return SECTIONED.has(topic) ? helpDocument(topic, text.replace(/\r\n/g, '\n'), name, via) : text;
}
