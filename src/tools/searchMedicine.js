import { getDb, normalizeDrugName, safeJsonParse } from "../db.js";

export const definition = {
  name: "search_medicine",
  description:
    "Search GoDavaii's database of 13,000+ Indian medicines by name or brand. Returns generic name, brand names, drug class, dosing, safety info.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Medicine name to search (generic or brand name, e.g. 'paracetamol', 'Dolo', 'Crocin')",
      },
    },
    required: ["query"],
  },
};

export async function handler({ query }) {
  const db = getDb();
  const normalized = normalizeDrugName(query);

  if (!normalized) {
    return { content: [{ type: "text", text: "Please provide a medicine name to search." }] };
  }

  let medicine = null;

  // 1. Exact match on generic_name
  medicine = db
    .prepare("SELECT * FROM medicines WHERE LOWER(generic_name) = ?")
    .get(normalized);

  // 2. Brand name lookup via brand_generic_map
  if (!medicine) {
    const brandMatch = db
      .prepare("SELECT generic_name FROM brand_generic_map WHERE LOWER(brand_name) = ? LIMIT 1")
      .get(normalized);
    if (brandMatch) {
      medicine = db
        .prepare("SELECT * FROM medicines WHERE LOWER(generic_name) = ?")
        .get(brandMatch.generic_name.toLowerCase());
    }
  }

  // 3. LIKE search on generic_name
  if (!medicine) {
    medicine = db
      .prepare("SELECT * FROM medicines WHERE LOWER(generic_name) LIKE ? LIMIT 1")
      .get(`%${normalized}%`);
  }

  // 4. LIKE search on brand_generic_map brand_name
  if (!medicine) {
    const brandLike = db
      .prepare("SELECT generic_name FROM brand_generic_map WHERE LOWER(brand_name) LIKE ? LIMIT 1")
      .get(`%${normalized}%`);
    if (brandLike) {
      medicine = db
        .prepare("SELECT * FROM medicines WHERE LOWER(generic_name) = ?")
        .get(brandLike.generic_name.toLowerCase());
    }
  }

  if (!medicine) {
    // Try to find partial matches for suggestions
    const suggestions = db
      .prepare(
        "SELECT generic_name FROM medicines WHERE LOWER(generic_name) LIKE ? LIMIT 5"
      )
      .all(`%${normalized.slice(0, 3)}%`);

    let text = `No medicine found matching "${query}".`;
    if (suggestions.length > 0) {
      text += `\n\nDid you mean:\n${suggestions.map((s) => `  - ${s.generic_name}`).join("\n")}`;
    }
    return { content: [{ type: "text", text }] };
  }

  // Fetch all brand names from brand_generic_map for richer data
  const allBrands = db
    .prepare(
      "SELECT DISTINCT brand_name, manufacturer, strength_mg, is_otc FROM brand_generic_map WHERE LOWER(generic_name) = ? LIMIT 20"
    )
    .all(medicine.generic_name.toLowerCase());

  const brandNames = safeJsonParse(medicine.brand_names, []);
  const contraindications = safeJsonParse(medicine.contraindications, []);
  const sideEffects = safeJsonParse(medicine.common_side_effects, []);

  // Build formatted brand list
  let brandSection = "";
  if (allBrands.length > 0) {
    brandSection = allBrands
      .map((b) => {
        let entry = `  - ${b.brand_name}`;
        if (b.manufacturer) entry += ` (${b.manufacturer})`;
        if (b.strength_mg) entry += ` ${b.strength_mg}mg`;
        return entry;
      })
      .join("\n");
  } else if (brandNames.length > 0) {
    brandSection = brandNames.map((b) => `  - ${b}`).join("\n");
  }

  const text = [
    `=== ${medicine.generic_name.toUpperCase()} ===`,
    "",
    `Drug Class: ${medicine.drug_class || "Not specified"}`,
    `Schedule (India): ${medicine.schedule_india || "Not specified"}`,
    "",
    "--- Brand Names ---",
    brandSection || "  No brand data available",
    "",
    "--- Dosing ---",
    `Adult Max Single Dose: ${medicine.adult_max_single_dose_mg ? medicine.adult_max_single_dose_mg + " mg" : "Not specified"}`,
    `Adult Max Daily Dose: ${medicine.adult_max_daily_dose_mg ? medicine.adult_max_daily_dose_mg + " mg" : "Not specified"}`,
    `Child Dose (per kg): ${medicine.child_dose_per_kg_mg ? medicine.child_dose_per_kg_mg + " mg/kg" : "Not specified"}`,
    `Elderly Max Daily: ${medicine.elderly_max_daily_mg ? medicine.elderly_max_daily_mg + " mg" : "Not specified"}`,
    "",
    "--- Safety ---",
    `Pregnancy Category: ${medicine.pregnancy_category || "Not specified"}`,
    `Breastfeeding Safe: ${medicine.breastfeeding_safe === 1 ? "Yes" : medicine.breastfeeding_safe === 0 ? "No" : "Unknown"}`,
    `Renal Adjustment: ${medicine.renal_adjustment || "Not specified"}`,
    `Hepatic Adjustment: ${medicine.hepatic_adjustment || "Not specified"}`,
    "",
    "--- Contraindications ---",
    contraindications.length > 0
      ? contraindications.map((c) => `  - ${c}`).join("\n")
      : "  None listed",
    "",
    "--- Common Side Effects ---",
    sideEffects.length > 0
      ? sideEffects.map((s) => `  - ${s}`).join("\n")
      : "  None listed",
  ].join("\n");

  return { content: [{ type: "text", text }] };
}
