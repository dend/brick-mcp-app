#!/usr/bin/env tsx
/**
 * generate-parts-index.ts
 *
 * Scans ldraw/parts/*.dat headers to build a lightweight JSON index
 * of all valid parts, grouped by category. Output: ldraw-parts-index.json
 *
 * Usage:
 *   tsx scripts/generate-parts-index.ts
 */

import fs from "node:fs";
import path from "node:path";

const LDRAW_DIR = path.resolve(import.meta.dirname, "..", "ldraw");
const PARTS_DIR = path.join(LDRAW_DIR, "parts");
const OUTPUT_FILE = path.resolve(import.meta.dirname, "..", "ldraw-parts-index.json");

interface PartEntry {
  id: string;
  name: string;
}

function main() {
  if (!fs.existsSync(PARTS_DIR)) {
    console.error(`LDraw parts directory not found: ${PARTS_DIR}`);
    console.error("Run 'npm run download:ldraw' first.");
    process.exit(1);
  }

  const files = fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith(".dat"));
  console.log(`Scanning ${files.length} .dat files...`);

  const categories: Record<string, PartEntry[]> = {};
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(PARTS_DIR, file);

    // Read only first 2KB — headers are at the top
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);

    const header = buf.toString("utf8", 0, bytesRead);
    const lines = header.split("\n");

    // Line 0: "0 <description>"
    const descLine = lines[0]?.trim() ?? "";
    if (!descLine.startsWith("0 ")) {
      skipped++;
      continue;
    }

    const name = descLine.slice(2).trim();

    // Filter out sub-parts, aliases, moved-to, physical colour, obsolete
    if (
      name.startsWith("~") || // sub-part
      name.startsWith("=") || // alias
      name.startsWith("_") || // physical colour shortcut
      name.startsWith("|") || // obsolete
      /moved to/i.test(name) // redirect
    ) {
      skipped++;
      continue;
    }

    // Extract part ID from filename (strip .dat)
    const id = file.replace(/\.dat$/i, "");

    // Find !CATEGORY line, otherwise derive from first word of name
    let category: string | undefined;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("0 !CATEGORY ")) {
        category = trimmed.slice("0 !CATEGORY ".length).trim();
        break;
      }
      // Stop scanning after we've passed the header metadata
      if (!trimmed.startsWith("0 ") && trimmed.length > 0) break;
    }

    if (!category) {
      // Derive from first word of name
      const firstWord = name.split(/\s+/)[0];
      if (firstWord) {
        category = firstWord;
      } else {
        category = "Other";
      }
    }

    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push({ id, name });
  }

  // Sort entries within each category by name
  for (const cat of Object.keys(categories)) {
    categories[cat].sort((a, b) => a.name.localeCompare(b.name));
  }

  const totalParts = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);

  const index = {
    categories,
    totalParts,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index));
  console.log(
    `Generated ${OUTPUT_FILE}\n  ${totalParts} parts across ${Object.keys(categories).length} categories (skipped ${skipped})`
  );
}

main();
