# GoDavaii MCP Server

An MCP (Model Context Protocol) server that exposes GoDavaii's Indian health
knowledge base to MCP-compatible AI clients. Ships a TEASER subset of our
curated Indian medicine, drug-interaction, pregnancy-safety and lab-reference
database — safe for public distribution. The full knowledge base is available
exclusively through the GoDavaii app and website at
[godavaii.com](https://www.godavaii.com).

## What you get (TEASER build)

- **500** drug-drug interactions
- **200** curated Indian medicines with dosing limits
- **20** lab-test reference ranges
- Pregnancy-safety categories
- Generic alternative lookups for branded medicines

## Tools exposed

| Tool | Description |
|---|---|
| `search_medicine` | Search Indian medicines by name or brand |
| `check_drug_interaction` | Drug-drug interaction severity + clinical management |
| `find_generic_alternatives` | Cheaper generic alternatives for branded medicines |
| `check_pregnancy_safety` | Medicine safety during pregnancy |
| `lookup_lab_test` | Lab test normal ranges + clinical significance |
| `check_dosage_safety` | Safe dosage limits across populations (adult/pediatric/elderly) |

## Install

```bash
npm install -g godavaii-mcp-server
```

## Use with an MCP client

Add to your MCP client config (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "godavaii": {
      "command": "npx",
      "args": ["-y", "godavaii-mcp-server"]
    }
  }
}
```

## About GoDavaii

GoDavaii is an India-first health AI built for every Indian family —
multilingual, voice-first, free. Learn more at
[godavaii.com](https://www.godavaii.com).

## License

MIT
