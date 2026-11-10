// The tool listing the plugin evals' mock server answers with (evals/mocks/pixelbolt/_tools.json) is the real
// server's, as a client without MCP Apps receives it. `node scripts/eval-mock.mjs` rewrites it after a tool's
// description or options change; a test compares the two, so the mock cannot fall behind.
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';

export const MOCK_TOOLS = fileURLToPath(new URL('../evals/mocks/pixelbolt/_tools.json', import.meta.url));

// The file's text: the tools/list result on one line.
export async function mockTools() {
  const input = new PassThrough(), output = new PassThrough(), replies = new Map();
  let buffer = '';
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); replies.get(message.id)?.(message.result); } });
  const running = startMCP({ input, output });
  const ask = (id, method, params) => new Promise(resolve => { replies.set(id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await ask(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'eval-mock', version: '1' } });
  const listing = await ask(2, 'tools/list', {});
  input.end(); await running;
  return JSON.stringify(listing) + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { await writeFile(MOCK_TOOLS, await mockTools()); console.log(`wrote ${MOCK_TOOLS}`); }
