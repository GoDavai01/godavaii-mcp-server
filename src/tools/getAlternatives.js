import { getDb, normalizeDrugName } from "../db.js";

export const definition = {
  name: "find_generic_alternatives",
  description:
    "Find cheaper generic alternatives for a branded Indian medicine. Shows all brands with the same composition.",
  inputSchema: {
    type: "object",
    properties: {
      brand: {
        type: "string",
        description:
          "Brand name of the medicine (e.g. 'Dolo', 'Crocin', 'Brufen')",
      },
    },
    required: ["brand"],
  },
};

export async function handler({ brand }) {
  const db = getDb();
  const normalized = normalizeDrugName(brand);

  if (!normalized) {
    return {
      content: [{ type: "text", text: "Please provide a brand name to search for alternatives." }],
    };
  }

  // Look up brand in brand_generic_map to find the generic name
  let genericName = null;

  const exactMatch = db
    .prepare(
      "SELECT generic_name FROM brand_generic_map WHERE LOWER(brand_name) = ? LIMIT 1"
    )
    .get(normalized);

  if (exactMatch) {
    genericName = exactMatch.generic_name;
  } else {
    // Try partial match
    const partialMatch = db
      .prepare(
        "SELECT generic_name FROM brand_generic_map WHERE LOWER(brand_name) LIKE ? LIMIT 1"
      )
      .get(`%${normalized}%`);

    if (partialMatch) {
      genericName = partialMatch.generic_name;
    } else {
      // Maybe they entered a generic name directly
      const genericDirect = db
        .prepare(
          "SELECT generic_name FROM medicines WHERE LOWER(generic_name) = ? LIMIT 1"
        )
        .get(normalized);

      if (genericDirect) {
        genericName = genericDirect.generic_name;
      }
    }
  }

  if (!genericName) {
    return {
      content: [
        {
          type: "text",
          text: `No medicine found matching brand name "${brand}". Try searching with a different spelling or the generic name.`,
        },
      ],
    };
  }

  // Find all brand alternatives with the same generic name
  const alternatives = db
    .prepare(
      `SELECT brand_name, manufacturer, strength_mg, is_otc, schedule_india
       FROM brand_generic_map
       WHERE LOWER(generic_name) = ?
       ORDER BY brand_name
       LIMIT 50`
    )
    .all(genericName.toLowerCase());

  // Get medicine info
  const medicineInfo = db
    .prepare("SELECT drug_class, schedule_india FROM medicines WHERE LOWER(generic_name) = ?")
    .get(genericName.toLowerCase());

  const lines = [
    `=== GENERIC ALTERNATIVES ===`,
    "",
    `Generic Name: ${genericName}`,
    `Drug Class: ${medicineInfo?.drug_class || "Not specified"}`,
    `Schedule (India): ${medicineInfo?.schedule_india || "Not specified"}`,
    `Total Alternatives Found: ${alternatives.length}`,
    "",
    "--- Available Brands ---",
  ];

  if (alternatives.length === 0) {
    lines.push("  No brand alternatives found in the database.");
  } else {
    // Group by manufacturer if available
    const withMfr = alternatives.filter((a) => a.manufacturer);
    const withoutMfr = alternatives.filter((a) => !a.manufacturer);

    for (const alt of alternatives) {
      let entry = `  - ${alt.brand_name}`;
      if (alt.strength_mg) entry += ` (${alt.strength_mg} mg)`;
      if (alt.manufacturer) entry += ` -- ${alt.manufacturer}`;
      if (alt.is_otc === 1) entry += ` [OTC]`;
      lines.push(entry);
    }

    if (alternatives.length === 50) {
      lines.push("");
      lines.push(`  ... and more. Showing first 50 results.`);
    }
  }

  lines.push("");
  lines.push(
    "Note: All listed brands contain the same generic composition. Consult your pharmacist about availability and pricing."
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
