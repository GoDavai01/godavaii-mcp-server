import { getDb, normalizeDrugName, resolveToGeneric, safeJsonParse } from "../db.js";

export const definition = {
  name: "check_pregnancy_safety",
  description:
    "Check if a medicine is safe during pregnancy. Returns restriction level, reason, trimester guidance, and safer alternatives.",
  inputSchema: {
    type: "object",
    properties: {
      medicine: {
        type: "string",
        description:
          "Medicine name (generic or brand, e.g. 'ibuprofen', 'Brufen')",
      },
    },
    required: ["medicine"],
  },
};

export async function handler({ medicine }) {
  const db = getDb();

  if (!medicine) {
    return {
      content: [{ type: "text", text: "Please provide a medicine name to check pregnancy safety." }],
    };
  }

  const normalized = normalizeDrugName(medicine);
  const genericName = resolveToGeneric(medicine) || normalized;

  // Get pregnancy restrictions from vulnerable_restrictions
  const restrictions = db
    .prepare(
      `SELECT * FROM vulnerable_restrictions
       WHERE LOWER(generic_name) = ? AND population_type = 'PREGNANCY'
       ORDER BY trimester`
    )
    .all(genericName.toLowerCase());

  // Also get medicine table pregnancy info
  const medicineInfo = db
    .prepare(
      `SELECT pregnancy_category, breastfeeding_safe, contraindications
       FROM medicines WHERE LOWER(generic_name) = ?`
    )
    .get(genericName.toLowerCase());

  // Also check nursing restrictions
  const nursingRestrictions = db
    .prepare(
      `SELECT restriction_level, reason FROM vulnerable_restrictions
       WHERE LOWER(generic_name) = ? AND population_type = 'NURSING'
       LIMIT 1`
    )
    .get(genericName.toLowerCase());

  if (!medicineInfo && restrictions.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No pregnancy safety data found for "${medicine}" (searched as: ${genericName}). Consult your doctor before taking any medicine during pregnancy.`,
        },
      ],
    };
  }

  const pregnancyCategoryDesc = {
    A: "Category A -- Controlled studies show no risk. Safe in pregnancy.",
    B: "Category B -- No evidence of risk in humans. Generally considered safe.",
    C: "Category C -- Risk cannot be ruled out. Use only if benefit outweighs risk.",
    D: "Category D -- Positive evidence of risk. Use only in life-threatening situations.",
    X: "Category X -- CONTRAINDICATED in pregnancy. Known to cause fetal harm.",
  };

  const restrictionSeverity = {
    CONTRAINDICATED: "[DANGER]",
    AVOID: "[WARNING]",
    CAUTION: "[CAUTION]",
    DOSE_REDUCE: "[ADJUST DOSE]",
    SAFE: "[OK]",
  };

  const lines = [
    `=== PREGNANCY SAFETY CHECK ===`,
    "",
    `Medicine: ${medicine}`,
    `Generic Name: ${genericName}`,
    "",
  ];

  // Pregnancy category from medicines table
  if (medicineInfo?.pregnancy_category) {
    const cat = medicineInfo.pregnancy_category.toUpperCase();
    lines.push(`--- FDA Pregnancy Category ---`);
    lines.push(pregnancyCategoryDesc[cat] || `Category ${cat}`);
    lines.push("");
  }

  // Detailed restrictions from vulnerable_restrictions
  if (restrictions.length > 0) {
    lines.push(`--- Pregnancy Restrictions ---`);
    for (const r of restrictions) {
      const icon = restrictionSeverity[r.restriction_level] || "[?]";
      lines.push(`${icon} Restriction: ${r.restriction_level}`);
      if (r.trimester) {
        lines.push(`Trimester: ${r.trimester}`);
      }
      if (r.reason) {
        // Truncate long reasons
        const reason =
          r.reason.length > 400 ? r.reason.slice(0, 400) + "..." : r.reason;
        lines.push(`Reason: ${reason}`);
      }
      if (r.alternative_drug) {
        lines.push(`Safer Alternative: ${r.alternative_drug}`);
      }
      lines.push("");
    }
  }

  // Breastfeeding info
  lines.push(`--- Breastfeeding ---`);
  if (medicineInfo?.breastfeeding_safe === 1) {
    lines.push("Generally considered safe during breastfeeding.");
  } else if (medicineInfo?.breastfeeding_safe === 0) {
    lines.push("NOT recommended during breastfeeding.");
  } else {
    lines.push("Breastfeeding safety data not available.");
  }

  if (nursingRestrictions) {
    const icon = restrictionSeverity[nursingRestrictions.restriction_level] || "[?]";
    lines.push(`${icon} Nursing Restriction: ${nursingRestrictions.restriction_level}`);
    if (nursingRestrictions.reason) {
      const reason =
        nursingRestrictions.reason.length > 300
          ? nursingRestrictions.reason.slice(0, 300) + "..."
          : nursingRestrictions.reason;
      lines.push(`Detail: ${reason}`);
    }
  }

  // Contraindications
  if (medicineInfo?.contraindications) {
    const contras = safeJsonParse(medicineInfo.contraindications, []);
    const pregnancyRelated = contras.filter(
      (c) =>
        /pregnan|fetal|fetus|trimester|gestation/i.test(c)
    );
    if (pregnancyRelated.length > 0) {
      lines.push("");
      lines.push("--- Pregnancy-Related Contraindications ---");
      pregnancyRelated.forEach((c) => lines.push(`  - ${c}`));
    }
  }

  lines.push("");
  lines.push(
    "IMPORTANT: Always consult your obstetrician/gynecologist before taking any medicine during pregnancy or breastfeeding."
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
