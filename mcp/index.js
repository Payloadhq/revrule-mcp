#!/usr/bin/env node
'use strict';
/**
 * RevRule MCP server — node stdlib ONLY, zero dependencies.
 *
 * Exposes the Payload rail's RevRule REST API as MCP tools over stdio
 * (JSON-RPC 2.0), per the MCP 2024-11-05 protocol surface:
 *   initialize / notifications/initialized / tools/list / tools/call
 *
 * v1 surface is READ + DRY-RUN only — no write/submit paths:
 *   revrule_get_graph          GET  /v1/graphs/{graph_id}
 *   revrule_list_payout_evidence
 *                              GET  /v1/graphs/{graph_id}/payout-evidence
 *   revrule_simulate_event     POST /v1/graphs/{graph_id}/simulate
 *                              (dry-run an event against the graph's rules;
 *                              zero side effects)
 *
 * All calls go to the LIVE rail ({PAYLOAD_RAIL_URL}) authenticated with the
 * USER's own rail API key (Bearer, RevRule entitlement-gated).
 *
 * Env:
 *   PAYLOAD_RAIL_API_KEY  required for tool calls; tools fail closed with a
 *                         clear "API key not configured" error when absent
 *   PAYLOAD_RAIL_URL      optional; default https://payload-rail.fly.dev
 */
const readline = require('node:readline');

const VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'revrule';
const DEFAULT_RAIL_URL = 'https://payload-rail.fly.dev';
const TIMEOUT_MS = 30000;

const API_KEY_MISSING =
  'API key not configured: set PAYLOAD_RAIL_API_KEY to your own Payload rail ' +
  'API key (with a RevRule entitlement) and retry. This server never ships ' +
  'with a bundled key.';

function railUrl() {
  const u = (process.env.PAYLOAD_RAIL_URL || '').trim();
  return (u || DEFAULT_RAIL_URL).replace(/\/+$/, '');
}

function apiKey() {
  return (process.env.PAYLOAD_RAIL_API_KEY || '').trim();
}

/* ------------------------------------------------------------------ */
/* Rail REST transport.                                                */
/* ------------------------------------------------------------------ */
async function railRequest(method, path, body) {
  const key = apiKey();
  if (!key) return { isError: true, text: JSON.stringify({ error: API_KEY_MISSING }) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${railUrl()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e && e.name === 'AbortError'
      ? `rail request timed out after ${TIMEOUT_MS}ms`
      : `rail request failed: ${e && e.message ? e.message : String(e)}`;
    return { isError: true, text: JSON.stringify({ error: msg }) };
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }

  if (!res.ok) {
    return {
      isError: true,
      text: JSON.stringify({
        error: `rail HTTP ${res.status}`,
        body: parsed !== undefined ? parsed : raw.slice(0, 2000),
      }),
    };
  }
  return {
    isError: false,
    text: JSON.stringify(parsed !== undefined ? parsed : { raw: raw.slice(0, 2000) }, null, 2),
  };
}

/* ------------------------------------------------------------------ */
/* Tool definitions: read + dry-run only (no write/submit paths).     */
/* ------------------------------------------------------------------ */
const TOOLS = [
  {
    name: 'revrule_get_graph',
    description:
      'Fetch one of your RevRule revenue entitlement graphs by id: its ' +
      'participants, rules, and ledger wiring. Read-only. ' +
      '(Rail route: GET /v1/graphs/{graph_id}.)',
    inputSchema: {
      type: 'object',
      properties: {
        graph_id: { type: 'string', description: 'The RevRule graph id.' },
      },
      required: ['graph_id'],
    },
    run: (args) => railRequest('GET', `/v1/graphs/${encodeURIComponent(args.graph_id)}`),
  },
  {
    name: 'revrule_list_payout_evidence',
    description:
      'List payout evidence recorded for a graph: verified payouts linked ' +
      'back to the original entitlement ledger entries (transaction hash, ' +
      'log index, block data, authorizing signature). Read-only. ' +
      '(Rail route: GET /v1/graphs/{graph_id}/payout-evidence.)',
    inputSchema: {
      type: 'object',
      properties: {
        graph_id: { type: 'string', description: 'The RevRule graph id.' },
      },
      required: ['graph_id'],
    },
    run: (args) =>
      railRequest('GET', `/v1/graphs/${encodeURIComponent(args.graph_id)}/payout-evidence`),
  },
  {
    name: 'revrule_simulate_event',
    description:
      'Dry-run a revenue event against a graph\'s rules and see what the ' +
      'rules would produce, with ZERO side effects: nothing is recorded, ' +
      'no payout is prepared or submitted. The event payload is passed ' +
      'through to the rail unchanged. ' +
      '(Rail route: POST /v1/graphs/{graph_id}/simulate.)',
    inputSchema: {
      type: 'object',
      properties: {
        graph_id: { type: 'string', description: 'The RevRule graph id.' },
        event: {
          type: 'object',
          description: 'The revenue event payload to simulate, passed through to the rail as-is.',
        },
      },
      required: ['graph_id', 'event'],
    },
    run: (args) =>
      railRequest('POST', `/v1/graphs/${encodeURIComponent(args.graph_id)}/simulate`, args.event),
  },
];

/* ------------------------------------------------------------------ */
/* JSON-RPC over stdio (framing mirrors the callx402 MCP server).      */
/* ------------------------------------------------------------------ */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handleToolsCall(id, params) {
  const name = params && params.name;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    error(id, -32602, `unknown tool '${name}'`);
    return;
  }
  const args = (params && params.arguments) || {};
  try {
    const out = await tool.run(args);
    result(id, { content: [{ type: 'text', text: out.text }], isError: out.isError });
  } catch (e) {
    result(id, {
      content: [{ type: 'text', text: JSON.stringify({ error: e && e.message ? e.message : String(e) }) }],
      isError: true,
    });
  }
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      });
      break;
    case 'notifications/initialized':
      break; // no response for notifications
    case 'tools/list':
      result(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      break;
    case 'tools/call':
      if (id === undefined || id === null) break;
      await handleToolsCall(id, params);
      break;
    case 'ping':
      result(id, {});
      break;
    default:
      if (id !== undefined && id !== null) error(id, -32601, `method not found: ${method}`);
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let buffer = '';
  rl.on('line', (line) => {
    buffer += line;
    // Handle one complete JSON message per line (MCP stdio framing).
    try {
      const msg = JSON.parse(buffer);
      buffer = '';
      handleMessage(msg).catch((e) => {
        if (msg && msg.id !== undefined && msg.id !== null) error(msg.id, -32603, String((e && e.message) || e));
      });
    } catch {
      // Incomplete JSON — keep buffering. Guard against unbounded growth.
      if (buffer.length > 4 * 1024 * 1024) buffer = '';
    }
  });
  rl.on('close', () => process.exit(0));
}

if (require.main === module) main();
module.exports = { TOOLS, SERVER_NAME, VERSION, PROTOCOL_VERSION };
