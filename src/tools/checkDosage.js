import { getDb, normalizeDrugName, resolveToGeneric } from "../db.js";

export const definition = {
  name: "check_dosage_safety",
  description:
    "Check safe dosage limits for a medicine by population (adult, child, elderly, renal/hepatic impairment).",
  inputSchema: {
    type: "object",
    properties: {
      medicine: {
        type: "string",
        description:
          "Medicine name (generic or brand, e.g. 'paracetamol', 'Dolo', 'metformin')",
      },
      population: {
        type: "string",
        enum: ["adult", "child", "elderly"],
        description:
          "Target population for dosage information (optional, shows all if omitted)",
      },
    },
    required: ["medicine"],
  },
};

export async function handler({ medicine, population }) {
  const db = getDb();

  if (!medicine) {
    return {
      content: [{ type: "text", text: "Please provide a medicine name to check dosage safety." }],
    };
  }

  const genericName = resolveToGeneric(medicine) || normalizeDrugName(medicine);

  // Get dosage info from medicines table
  const medicineInfo = db
    .prepare(
      `SELECT generic_name, drug_class, schedule_india,
              adult_max_single_dose_mg, adult_max_daily_dose_mg,
              child_dose_per_kg_mg, child_max_daily_per_kg,
              elderly_max_daily_mg,
              renal_adjustment, hepatic_adjustment
       FROM medicines WHERE LOWER(generic_name) = ?`
    )
    .get(genericName.toLowerCase());

  if (!medicineInfo) {
    return {
      content: [
        {
          type: "text",
          text: `No dosage data found for "${medicine}" (searched as: ${genericName}). Try a different spelling or the generic name.`,
        },
      ],
    };
  }

  // Get population-specific restrictions from vulnerable_restrictions
  const populationTypes = [];
  if (!population || population === "child") populationTypes.push("PEDIATRIC");
  if (!population || population === "elderly") populationTypes.push("ELDERLY");
  if (!population) {
    populationTypes.push("RENAL", "CKD", "HEPATIC", "LIVER");
  }

  const restrictions = db
    .prepare(
      `SELECT population_type, restriction_level, reason, alternative_drug, age_limit_years, min_weight_kg
       FROM vulnerable_restrictions
       WHERE LOWER(generic_name) = ?
         AND population_type IN (${populationTypes.map(() => "?").join(",")})
       ORDER BY population_type`
    )
    .all(genericName.toLowerCase(), ...populationTypes);

  const lines = [
    `=== DOSAGE SAFETY: ${medicineInfo.generic_name.toUpperCase()} ===`,
    "",
    `Drug Class: ${medicineInfo.drug_class || "Not specified"}`,
    `Schedule (India): ${medicineInfo.schedule_india || "Not specified"}`,
    "",
  ];

  // Adult dosing
  if (!population || population === "adult") {
    lines.push("--- ADULT DOSING ---");
    lines.push(
      `Max Single Dose: ${medicineInfo.adult_max_single_dose_mg ? medicineInfo.adult_max_single_dose_mg + " mg" : "Not specified"}`
    );
    lines.push(
      `Max Daily Dose: ${medicineInfo.adult_max_daily_dose_mg ? medicineInfo.adult_max_daily_dose_mg + " mg" : "Not specified"}`
    );
    lines.push("");
  }

  // Child dosing
  if (!population || population === "child") {
    lines.push("--- PEDIATRIC DOSING ---");
    lines.push(
      `Dose per kg: ${medicineInfo.child_dose_per_kg_mg ? medicineInfo.child_dose_per_kg_mg + " mg/kg" : "Not specified"}`
    );
    lines.push(
      `Max Daily per kg: ${medicineInfo.child_max_daily_per_kg ? medicineInfo.child_max_daily_per_kg + " mg/kg/day" : "Not specified"}`
    );

    const pedRestrictions = restrictions.filter(
      (r) => r.population_type === "PEDIATRIC"
    );
    if (pedRestrictions.length > 0) {
      for (const r of pedRestrictions) {
        lines.push(`Restriction: ${r.restriction_level}`);
        if (r.age_limit_years) {
          lines.push(`  Min Age: ${r.age_limit_years} years`);
        }
        if (r.min_weight_kg) {
          lines.push(`  Min Weight: ${r.min_weight_kg} kg`);
        }
        if (r.reason) {
          const reason =
            r.reason.length > 300 ? r.reason.slice(0, 300) + "..." : r.reason;
          lines.push(`  Note: ${reason}`);
        }
      }
    }
    lines.push("");
  }

  // Elderly dosing
  if (!population || population === "elderly") {
    lines.push("--- ELDERLY DOSING ---");
    lines.push(
      `Max Daily Dose: ${medicineInfo.elderly_max_daily_mg ? medicineInfo.elderly_max_daily_mg + " mg" : "Not specified"}`
    );

    const elderlyRestrictions = restrictions.filter(
      (r) => r.population_type === "ELDERLY"
    );
    if (elderlyRestrictions.length > 0) {
      for (const r of elderlyRestrictions) {
        lines.push(`Restriction: ${r.restriction_level}`);
        if (r.reason) {
          const reason =
            r.reason.length > 300 ? r.reason.slice(0, 300) + "..." : r.reason;
          lines.push(`  Note: ${reason}`);
        }
        if (r.alternative_drug) {
          lines.push(`  Alternative: ${r.alternative_drug}`);
        }
      }
    }
    lines.push("");
  }

  // Renal and hepatic adjustments (always show unless population-specific)
  if (!population) {
    lines.push("--- RENAL IMPAIRMENT ---");
    lines.push(
      `Adjustment: ${medicineInfo.renal_adjustment || "Not specified"}`
    );

    const renalRestrictions = restrictions.filter(
      (r) => r.population_type === "RENAL" || r.population_type === "CKD"
    );
    for (const r of renalRestrictions) {
      lines.push(`Restriction: ${r.restriction_level}`);
      if (r.reason) {
        const reason =
          r.reason.length > 200 ? r.reason.slice(0, 200) + "..." : r.reason;
        lines.push(`  Note: ${reason}`);
      }
    }
    lines.push("");

    lines.push("--- HEPATIC IMPAIRMENT ---");
    lines.push(
      `Adjustment: ${medicineInfo.hepatic_adjustment || "Not specified"}`
    );

    const hepaticRestrictions = restrictions.filter(
      (r) => r.population_type === "HEPATIC" || r.population_type === "LIVER"
    );
    for (const r of hepaticRestrictions) {
      lines.push(`Restriction: ${r.restriction_level}`);
      if (r.reason) {
        const reason =
          r.reason.length > 200 ? r.reason.slice(0, 200) + "..." : r.reason;
        lines.push(`  Note: ${reason}`);
      }
    }
    lines.push("");
  }

  lines.push(
    "IMPORTANT: These are maximum recommended doses. Your doctor may prescribe different doses based on your specific condition."
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
