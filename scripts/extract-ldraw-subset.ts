#!/usr/bin/env tsx
/**
 * extract-ldraw-subset.ts
 *
 * Extracts a minimal subset of the LDraw parts library needed by the brick builder.
 * Recursively resolves sub-file references (primitives, sub-parts) so the subset
 * is self-contained.
 *
 * Usage:
 *   tsx scripts/extract-ldraw-subset.ts <path-to-full-ldraw-library>
 *
 * The full library can be downloaded from https://library.ldraw.org/updates?latest
 * Extract the zip so the path contains LDConfig.ldr, parts/, and p/ directories.
 */

import fs from 'node:fs';
import path from 'node:path';

const INITIAL_PARTS = [
  // Standard bricks
  '3005', '3004', '3622', '3010', '3009', '3008',
  '3003', '3002', '3001', '2456', '3007',
  // Plates
  '3024', '3023', '3710', '3022', '3020', '3795', '3031', '3958',
  // Large plates
  '3036',   // Plate 6x8
  '3035',   // Plate 4x8
  '3832',   // Plate 2x10 (closest to large plate)
  '4477',   // Plate 1x10
  // Slope
  '3039',
  // Technic
  '3700', '3701', '3894', '3702', '3709',
  // Corner bricks
  '2357', '2462',
];

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'ldraw');

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('Usage: tsx scripts/extract-ldraw-subset.ts <path-to-full-ldraw-library>');
    console.error('');
    console.error('Download the complete LDraw parts library from:');
    console.error('  https://library.ldraw.org/updates?latest');
    console.error('Extract the zip, then pass the path to the extracted folder.');
    process.exit(1);
  }

  const resolvedSrc = path.resolve(srcDir);
  if (!fs.existsSync(resolvedSrc)) {
    console.error(`Source directory not found: ${resolvedSrc}`);
    process.exit(1);
  }

  // Copy LDConfig.ldr
  const ldConfigSrc = findFile(resolvedSrc, 'LDConfig.ldr');
  if (ldConfigSrc) {
    fs.copyFileSync(ldConfigSrc, path.join(OUT_DIR, 'LDConfig.ldr'));
    console.log('Copied LDConfig.ldr');
  } else {
    console.warn('WARNING: LDConfig.ldr not found in source library');
  }

  // Track which files we need
  const needed = new Set<string>();
  const processed = new Set<string>();

  // Seed with initial parts
  for (const partId of INITIAL_PARTS) {
    needed.add(`parts/${partId}.dat`);
  }

  // Recursively resolve references
  while (needed.size > processed.size) {
    for (const filePath of [...needed]) {
      if (processed.has(filePath)) continue;
      processed.add(filePath);

      const srcPath = findFile(resolvedSrc, filePath);
      if (!srcPath) {
        // Try alternate locations
        const altPath = findFileAlternates(resolvedSrc, filePath);
        if (altPath) {
          const content = fs.readFileSync(altPath, 'utf-8');
          const destPath = path.join(OUT_DIR, filePath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(altPath, destPath);
          extractReferences(content, filePath, needed);
        } else {
          console.warn(`  WARNING: Not found: ${filePath}`);
        }
        continue;
      }

      const content = fs.readFileSync(srcPath, 'utf-8');
      const destPath = path.join(OUT_DIR, filePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);

      extractReferences(content, filePath, needed);
    }
  }

  console.log(`\nExtracted ${processed.size} files to ${OUT_DIR}`);
}

function findFile(baseDir: string, relativePath: string): string | null {
  // Try exact path
  const exact = path.join(baseDir, relativePath);
  if (fs.existsSync(exact)) return exact;

  // Try case-insensitive on Windows
  const lower = path.join(baseDir, relativePath.toLowerCase());
  if (fs.existsSync(lower)) return lower;

  return null;
}

function findFileAlternates(baseDir: string, relativePath: string): string | null {
  // LDraw files can reference sub-files in multiple locations
  const baseName = path.basename(relativePath);
  const tryPaths = [
    relativePath,
    `parts/${baseName}`,
    `p/${baseName}`,
    `parts/s/${baseName}`,
    `p/48/${baseName}`,
    `p/8/${baseName}`,
  ];

  for (const tryPath of tryPaths) {
    const result = findFile(baseDir, tryPath);
    if (result) return result;
  }
  return null;
}

function extractReferences(content: string, sourceFile: string, needed: Set<string>): void {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Line type 1 = sub-file reference:  1 <color> <x> <y> <z> <a> <b> <c> <d> <e> <f> <g> <h> <i> <file>
    if (trimmed.startsWith('1 ')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 15) {
        const refFile = parts.slice(14).join(' ').replace(/\\/g, '/');
        const resolved = resolveReference(refFile, sourceFile);
        if (resolved && !needed.has(resolved)) {
          needed.add(resolved);
        }
      }
    }
  }
}

function resolveReference(refFile: string, sourceFile: string): string | null {
  const normalized = refFile.replace(/\\/g, '/').toLowerCase();

  // If it starts with a known prefix, use as-is
  if (normalized.startsWith('parts/') || normalized.startsWith('p/')) {
    return normalized;
  }

  // Sub-parts (s/) go under parts/s/
  if (normalized.startsWith('s/')) {
    return `parts/${normalized}`;
  }

  // Primitives with resolution prefix (48/ or 8/)
  if (normalized.startsWith('48/') || normalized.startsWith('8/')) {
    return `p/${normalized}`;
  }

  // Plain filename — determine from context
  if (sourceFile.startsWith('parts/')) {
    // References from parts usually point to primitives
    return `p/${normalized}`;
  }

  // Default: treat as primitive
  return `p/${normalized}`;
}

main();
