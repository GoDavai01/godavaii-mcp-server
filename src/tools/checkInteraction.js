import { getDb, normalizeDrugName, resolveToGeneric } from "../db.js";

export const definition = {
  name: "check_drug_interaction",
  description:
    "Check drug-drug interaction between two medicines. Returns severity (CRITICAL/MAJOR/MODERATE), clinical effect, and management advice.",
  inputSchema: {
    type: "object",
    properties: {
      drug1: {
        type: "string",
        description: "First medicine name (generic or brand)",
      },
      drug2: {
        type: "string",
        description: "Second medicine name (generic or brand)",
      },
    },
    required: ["drug1", "drug2"],
  },
};

export async function handler({ drug1, drug2 }) {
  const db = getDb();

  if (!drug1 || !drug2) {
    return {
      content: [{ type: "text", text: "Please provide two medicine names to check for interactions." }],
    };
  }

  // Resolve both drug names to generics
  const generic1 = resolveToGeneric(drug1) || normalizeDrugName(drug1);
  const generic2 = resolveToGeneric(drug2) || normalizeDrugName(drug2);

  // Query interactions in both directions
  const interactions = db
    .prepare(
      `SELECT * FROM drug_interactions
       WHERE (LOWER(drug_a) = ? AND LOWER(drug_b) = ?)
          OR (LOWER(drug_a) = ? AND LOWER(drug_b) = ?)
       ORDER BY
         CASE severity
           WHEN 'CRITICAL' THEN 1
           WHEN 'MAJOR' THEN 2
           WHEN 'MODERATE' THEN 3
           WHEN 'MINOR' THEN 4
           ELSE 5
         END
       LIMIT 5`
    )
    .all(
      generic1.toLowerCase(),
      generic2.toLowerCase(),
      generic2.toLowerCase(),
      generic1.toLowerCase()
    );

  if (interactions.length === 0) {
    // Try partial matching as fallback
    const partialInteractions = db
      .prepare(
        `SELECT * FROM drug_interactions
         WHERE (LOWER(drug_a) LIKE ? AND LOWER(drug_b) LIKE ?)
            OR (LOWER(drug_a) LIKE ? AND LOWER(drug_b) LIKE ?)
         ORDER BY
           CASE severity
             WHEN 'CRITICAL' THEN 1
             WHEN 'MAJOR' THEN 2
             WHEN 'MODERATE' THEN 3
             WHEN 'MINOR' THEN 4
             ELSE 5
           END
         LIMIT 5`
      )
      .all(
        `%${generic1.toLowerCase()}%`,
        `%${generic2.toLowerCase()}%`,
        `%${generic2.toLowerCase()}%`,
        `%${generic1.toLowerCase()}%`
      );

    if (partialInteractions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: [
              `=== DRUG INTERACTION CHECK ===`,
              "",
              `Drug 1: ${drug1}${generic1 !== normalizeDrugName(drug1) ? ` (${generic1})` : ""}`,
              `Drug 2: ${drug2}${generic2 !== normalizeDrugName(drug2) ? ` (${generic2})` : ""}`,
              "",
              `Result: No known interaction found between these medicines in the GoDavaii database.`,
              "",
              `Note: Absence of a listed interaction does not guarantee safety. Always consult a healthcare professional.`,
            ].join("\n"),
          },
        ],
      };
    }

    return formatInteractions(drug1, drug2, generic1, generic2, partialInteractions);
  }

  return formatInteractions(drug1, drug2, generic1, generic2, interactions);
}

function formatInteractions(drug1, drug2, generic1, generic2, interactions) {
  const severityIcon = {
    CRITICAL: "[!!!]",
    MAJOR: "[!!]",
    MODERATE: "[!]",
    MINOR: "[i]",
  };

  const lines = [
    `=== DRUG INTERACTION CHECK ===`,
    "",
    `Drug 1: ${drug1}${generic1 !== normalizeDrugName(drug1) ? ` (generic: ${generic1})` : ""}`,
    `Drug 2: ${drug2}${generic2 !== normalizeDrugName(drug2) ? ` (generic: ${generic2})` : ""}`,
    `Interactions Found: ${interactions.length}`,
    "",
  ];

  for (const ix of interactions) {
    const icon = severityIcon[ix.severity] || "[?]";
    lines.push(`--- ${icon} ${ix.severity || "UNKNOWN"} INTERACTION ---`);
    lines.push(`Between: ${ix.drug_a} + ${ix.drug_b}`);

    if (ix.clinical_effect) {
      // Truncate very long clinical effects to a reasonable summary
      const effect =
        ix.clinical_effect.length > 300
          ? ix.clinical_effect.slice(0, 300) + "..."
          : ix.clinical_effect;
      lines.push(`Clinical Effect: ${effect}`);
    }

    if (ix.mechanism) {
      lines.push(`Mechanism: ${ix.mechanism}`);
    }

    if (ix.management) {
      const mgmt =
        ix.management.length > 300
          ? ix.management.slice(0, 300) + "..."
          : ix.management;
      lines.push(`Management: ${mgmt}`);
    }

    if (ix.confidence_score != null) {
      lines.push(`Confidence: ${(ix.confidence_score * 100).toFixed(0)}%`);
    }

    lines.push("");
  }

  lines.push(
    "Note: Always consult a healthcare professional before combining medications."
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function normalizeDrugNameLocal(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\d+(\.\d+)?\s*(mg|mcg|ml|g|%|iu)\b/gi, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
