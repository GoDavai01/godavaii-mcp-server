#!/usr/bin/env node

import { startServer } from "./src/server.js";

startServer().catch((err) => {
  process.stderr.write(`[GoDavaii MCP] Fatal error: ${err.message}\n`);
  process.exit(1);
});
