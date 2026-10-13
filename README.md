<!-- mcp-name: io.github.payload-tools/revrule-mcp -->

# RevRule by Payload — MCP Server

An [MCP](https://modelcontextprotocol.io) server (stdio transport, Node.js standard library only, zero dependencies) that exposes **RevRule**, Payload's revenue-entitlement engine, to AI agents.

RevRule turns revenue sharing into declarative entitlement rules on the Payload rail: define who gets paid what, and every payout carries evidence linked back to the original entitlement ledger entry and its on-chain settlement. This server is a **read + dry-run** surface: there are deliberately no write/submit tools in v1. Every call goes to the live Payload rail (`https://payload-rail.fly.dev`) authenticated with **your own** rail API key (RevRule entitlement required).

## Tools

| Tool | Upstream route | What it does |
|------|---------------|--------------|
| `revrule_get_graph` | `GET /v1/graphs/{graph_id}` | Fetch one of your RevRule revenue entitlement graphs by id: its participants, rules, and ledger wiring. Read-only. |
| `revrule_list_payout_evidence` | `GET /v1/graphs/{graph_id}/payout-evidence` | List payout evidence recorded for a graph: verified payouts linked back to the original entitlement ledger entries (transaction hash, log index, block data, authorizing signature). Read-only. |
| `revrule_simulate_event` | `POST /v1/graphs/{graph_id}/simulate` | Dry-run a revenue event against a graph's rules and see what the rules would produce, with **zero side effects**: nothing is recorded, no payout is prepared or submitted. The event payload is passed through to the rail unchanged. |

## Install

### Via Smithery

Listed on Smithery as [kyler-simmons-partners/revrule](https://smithery.ai/servers/kyler-simmons-partners/revrule), or install the MCPB bundle from this repo (`revrule.mcpb`) in any MCPB-compatible client.

### From source

```bash
git clone https://github.com/Payloadhq/revrule-mcp
cd revrule-mcp
node mcp/index.js
```

Or run it straight from GitHub with npx:

```bash
npx -y github:Payloadhq/revrule-mcp
```

MCP client configuration (stdio):

```json
{
  "mcpServers": {
    "revrule": {
      "command": "node",
      "args": ["/path/to/revrule-mcp/mcp/index.js"],
      "env": {
        "PAYLOAD_RAIL_API_KEY": "your-rail-api-key"
      }
    }
  }
}
```

## Configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PAYLOAD_RAIL_API_KEY` | Required for tool calls | — | Your own Payload rail API key with a RevRule entitlement. Sent to the rail only as a Bearer `Authorization` header. |
| `PAYLOAD_RAIL_URL` | Optional | `https://payload-rail.fly.dev` | Payload rail base URL. |

**Fail-closed:** with no API key configured, the server still starts and lists its tools, and every tool call returns a clear `API key not configured` error. The key never leaves your machine except as the Authorization header to the rail.

## License

MIT — see [LICENSE](LICENSE).

---

RevRule is a product of [Payload](https://github.com/Payloadhq), separate from Veyline (Payload's authorization layer) and from [callx402 by Payload](https://github.com/Payloadhq/callx402), the MCP client layer for x402-priced actions.
