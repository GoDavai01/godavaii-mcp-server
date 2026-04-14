import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { getDb, closeDb } from "./db.js";

import {
  definition as searchMedicineDef,
  handler as searchMedicineHandler,
} from "./tools/searchMedicine.js";

import {
  definition as checkInteractionDef,
  handler as checkInteractionHandler,
} from "./tools/checkInteraction.js";

import {
  definition as getAlternativesDef,
  handler as getAlternativesHandler,
} from "./tools/getAlternatives.js";

import {
  definition as checkPregnancySafetyDef,
  handler as checkPregnancySafetyHandler,
} from "./tools/checkPregnancySafety.js";

import {
  definition as lookupLabTestDef,
  handler as lookupLabTestHandler,
} from "./tools/lookupLabTest.js";

import {
  definition as checkDosageDef,
  handler as checkDosageHandler,
} from "./tools/checkDosage.js";

export async function startServer() {
  // Verify database is accessible
  try {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM medicines").get();
    process.stderr.write(
      `[GoDavaii MCP] Database loaded: ${count.c} medicines\n`
    );
  } catch (err) {
    process.stderr.write(
      `[GoDavaii MCP] ERROR: Could not open database: ${err.message}\n`
    );
    process.stderr.write(
      `[GoDavaii MCP] Set GODAVAII_DB_PATH env variable to the safety.db path\n`
    );
    process.exit(1);
  }

  const server = new McpServer(
    {
      name: "godavaii-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // --- Tool 1: search_medicine ---
  server.registerTool(searchMedicineDef.name, {
    description: searchMedicineDef.description,
    inputSchema: {
      query: z.string().describe(
        "Medicine name to search (generic or brand name, e.g. 'paracetamol', 'Dolo', 'Crocin')"
      ),
    },
  }, async (args) => {
    try {
      return await searchMedicineHandler(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error searching medicine: ${err.message}` }],
        isError: true,
      };
    }
  });

  // --- Tool 2: check_drug_interaction ---
  server.registerTool(checkInteractionDef.name, {
    description: checkInteractionDef.description,
    inputSchema: {
      drug1: z.string().describe("First medicine name (generic or brand)"),
      drug2: z.string().describe("Second medicine name (generic or brand)"),
    },
  }, async (args) => {
    try {
      return await checkInteractionHandler(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error checking interaction: ${err.message}` }],
        isError: true,
      };
    }
  });

  // --- Tool 3: find_generic_alternatives ---
  server.registerTool(getAlternativesDef.name, {
    description: getAlternativesDef.description,
    inputSchema: {
      brand: z.string().describe(
        "Brand name of the medicine (e.g. 'Dolo', 'Crocin', 'Brufen')"
      ),
    },
  }, async (args) => {
    try {
      return await getAlternativesHandler(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error finding alternatives: ${err.message}` }],
        isError: true,
      };
    }
  });

  // --- Tool 4: check_pregnancy_safety ---
  server.registerTool(checkPregnancySafetyDef.name, {
    description: checkPregnancySafetyDef.description,
    inputSchema: {
      medicine: z.string().describe(
        "Medicine name (generic or brand, e.g. 'ibuprofen', 'Brufen')"
      ),
    },
  }, async (args) => {
    try {
      return await checkPregnancySafetyHandler(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error checking pregnancy safety: ${err.message}` }],
        isError: true,
      };
    }
  });

  // --- Tool 5: lookup_lab_test ---
  server.registerTool(lookupLabTestDef.name, {
    description: lookupLabTestDef.description,
    inputSchema: {
      test: z.string().describe(
        "Lab test name (e.g. 'HbA1c', 'TSH', 'creatinine', 'CBC')"
      ),
      gender: z.enum(["male", "female"]).optional().describe(
        "Patient gender for gender-specific ranges"
      ),
      ageGroup: z.string().optional().describe(
        "Age group for age-specific ranges (e.g. 'ADULT', 'CHILD_1_5', 'ADOLESCENT_13_17', 'ELDERLY')"
      ),
    },
  }, async (args) => {
    try {
      return await lookupLabTestHandler(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error looking up lab test: ${err.message}` }],
        isError: true,
      };
    }
  });

  // --- Tool 6: check_dosage_safety ---
  server.registerTool(checkDosageDef.name, {
    description: checkDosageDef.description,
    inputSchema: {
      medicine: z.string().describe(
        "Medicine name (generic or brand, e.g. 'paracetamol', 'Dolo', 'metformin')"
      ),
      population: z.enum(["adult", "child", "elderly"]).optional().describe(
        "Target population for dosage information (shows all if omitted)"
      ),
    },
  }, async (args) => {
    try {
      return await checkDosageHandler(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error checking dosage: ${err.message}` }],
        isError: true,
      };
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("[GoDavaii MCP] Server started on stdio\n");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    process.stderr.write("[GoDavaii MCP] Shutting down...\n");
    closeDb();
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    closeDb();
    await server.close();
    process.exit(0);
  });
}
