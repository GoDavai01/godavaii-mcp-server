import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.GODAVAII_DB_PATH ||
  path.resolve(__dirname, "..", "data", "safety.db");

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000"); // 64MB cache
  }
  return db;
}

/**
 * Normalize a drug name for consistent matching:
 * - lowercase
 * - remove parenthetical notes like (sustained release)
 * - remove dosage suffixes like 500mg, 10%, 0.5ml
 * - strip special characters
 * - collapse whitespace
 */
export function normalizeDrugName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // remove (parenthetical notes)
    .replace(/\d+(\.\d+)?\s*(mg|mcg|ml|g|%|iu)\b/gi, "") // remove dosage suffixes
    .replace(/[^a-z0-9\s-]/g, "") // strip special chars except hyphens
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

/**
 * Resolve a brand name to its generic name via brand_generic_map.
 * Returns the generic name if found, otherwise null.
 */
export function resolveToGeneric(name) {
  const db = getDb();
  const normalized = normalizeDrugName(name);

  // First try exact match on generic_name in medicines table
  const directMatch = db
    .prepare("SELECT generic_name FROM medicines WHERE LOWER(generic_name) = ? LIMIT 1")
    .get(normalized);
  if (directMatch) return directMatch.generic_name;

  // Then try brand_generic_map
  const brandMatch = db
    .prepare("SELECT generic_name FROM brand_generic_map WHERE LOWER(brand_name) = ? LIMIT 1")
    .get(normalized);
  if (brandMatch) return brandMatch.generic_name;

  // Try partial match on brand_generic_map
  const partialBrand = db
    .prepare("SELECT generic_name FROM brand_generic_map WHERE LOWER(brand_name) LIKE ? LIMIT 1")
    .get(`%${normalized}%`);
  if (partialBrand) return partialBrand.generic_name;

  // Try partial match on medicines generic_name
  const partialGeneric = db
    .prepare("SELECT generic_name FROM medicines WHERE LOWER(generic_name) LIKE ? LIMIT 1")
    .get(`%${normalized}%`);
  if (partialGeneric) return partialGeneric.generic_name;

  return null;
}

/**
 * Safely parse JSON, returning fallback on failure.
 */
export function safeJsonParse(str, fallback = []) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
