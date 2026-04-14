import { getDb, normalizeDrugName } from "../db.js";

export const definition = {
  name: "lookup_lab_test",
  description:
    "Look up normal ranges and clinical significance for lab tests (blood tests, urine tests, etc.). Supports Indian clinical standards.",
  inputSchema: {
    type: "object",
    properties: {
      test: {
        type: "string",
        description:
          "Lab test name (e.g. 'HbA1c', 'TSH', 'creatinine', 'CBC')",
      },
      gender: {
        type: "string",
        enum: ["male", "female"],
        description: "Patient gender for gender-specific ranges (optional)",
      },
      ageGroup: {
        type: "string",
        description:
          "Age group for age-specific ranges (e.g. 'ADULT', 'CHILD_1_5', 'ADOLESCENT_13_17', 'ELDERLY')",
      },
    },
    required: ["test"],
  },
};

export async function handler({ test, gender, ageGroup }) {
  const db = getDb();

  if (!test) {
    return {
      content: [{ type: "text", text: "Please provide a lab test name to look up." }],
    };
  }

  const normalized = test.toLowerCase().trim();

  // Query by test_name or test_aliases
  let results;

  if (ageGroup) {
    results = db
      .prepare(
        `SELECT * FROM lab_references
         WHERE (LOWER(test_name) = ? OR LOWER(test_aliases) LIKE ?)
           AND LOWER(age_group) = ?
         ORDER BY age_group`
      )
      .all(normalized, `%${normalized}%`, ageGroup.toLowerCase());
  } else {
    results = db
      .prepare(
        `SELECT * FROM lab_references
         WHERE LOWER(test_name) = ? OR LOWER(test_aliases) LIKE ?
         ORDER BY age_group`
      )
      .all(normalized, `%${normalized}%`);
  }

  // If no exact match, try partial match on test_name
  if (results.length === 0) {
    if (ageGroup) {
      results = db
        .prepare(
          `SELECT * FROM lab_references
           WHERE LOWER(test_name) LIKE ?
             AND LOWER(age_group) = ?
           ORDER BY age_group`
        )
        .all(`%${normalized}%`, ageGroup.toLowerCase());
    } else {
      results = db
        .prepare(
          `SELECT * FROM lab_references
           WHERE LOWER(test_name) LIKE ?
           ORDER BY age_group`
        )
        .all(`%${normalized}%`);
    }
  }

  if (results.length === 0) {
    // Suggest similar tests
    const suggestions = db
      .prepare(
        "SELECT DISTINCT test_name FROM lab_references WHERE LOWER(test_name) LIKE ? LIMIT 10"
      )
      .all(`%${normalized.slice(0, 3)}%`);

    let text = `No lab test found matching "${test}".`;
    if (suggestions.length > 0) {
      text += `\n\nAvailable tests that might match:\n${suggestions.map((s) => `  - ${s.test_name}`).join("\n")}`;
    }
    return { content: [{ type: "text", text }] };
  }

  const lines = [
    `=== LAB TEST: ${results[0].test_name.toUpperCase()} ===`,
    "",
  ];

  if (results[0].test_aliases) {
    lines.push(`Also known as: ${results[0].test_aliases}`);
    lines.push("");
  }

  if (results[0].clinical_significance) {
    lines.push(`Clinical Significance: ${results[0].clinical_significance}`);
    lines.push("");
  }

  // Group results by age group
  const byAge = {};
  for (const r of results) {
    const ageKey = r.age_group || "GENERAL";
    if (!byAge[ageKey]) byAge[ageKey] = [];
    byAge[ageKey].push(r);
  }

  for (const [ageKey, entries] of Object.entries(byAge)) {
    lines.push(`--- ${ageKey} ---`);
    for (const entry of entries) {
      lines.push(`Unit: ${entry.unit || "Not specified"}`);

      // Show ranges based on gender filter
      if (!gender || gender === "male") {
        if (entry.normal_min_male != null || entry.normal_max_male != null) {
          lines.push(
            `Male Normal Range: ${entry.normal_min_male ?? "?"} - ${entry.normal_max_male ?? "?"} ${entry.unit || ""}`
          );
        }
      }

      if (!gender || gender === "female") {
        if (entry.normal_min_female != null || entry.normal_max_female != null) {
          lines.push(
            `Female Normal Range: ${entry.normal_min_female ?? "?"} - ${entry.normal_max_female ?? "?"} ${entry.unit || ""}`
          );
        }
      }

      // Indian-specific overrides
      if (entry.indian_override_min != null || entry.indian_override_max != null) {
        lines.push(
          `Indian Reference Range: ${entry.indian_override_min ?? "?"} - ${entry.indian_override_max ?? "?"} ${entry.unit || ""}`
        );
      }

      // Critical values
      if (entry.critical_low != null || entry.critical_high != null) {
        lines.push(`Critical Values:`);
        if (entry.critical_low != null) {
          lines.push(`  Critical Low: < ${entry.critical_low} ${entry.unit || ""}`);
        }
        if (entry.critical_high != null) {
          lines.push(`  Critical High: > ${entry.critical_high} ${entry.unit || ""}`);
        }
      }

      lines.push("");
    }
  }

  lines.push(
    "Note: Reference ranges may vary between laboratories. Always interpret results in clinical context."
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
