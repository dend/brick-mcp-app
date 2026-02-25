#!/usr/bin/env tsx
/**
 * download-ldraw-parts.ts
 *
 * Downloads the complete LDraw parts library from the official source.
 * Extracts to ldraw/ in the project root.
 *
 * Usage:
 *   tsx scripts/download-ldraw-parts.ts [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LDRAW_DIR = path.resolve(import.meta.dirname, '..', 'ldraw');
const MARKER_FILE = path.join(LDRAW_DIR, 'LDConfig.ldr');
const COMPLETE_ZIP_URL = 'https://library.ldraw.org/library/updates/complete.zip';

async function main() {
  const force = process.argv.includes('--force');

  if (!force && fs.existsSync(MARKER_FILE)) {
    console.log('LDraw library already exists at ldraw/. Use --force to re-download.');
    return;
  }

  const tmpZip = path.join(LDRAW_DIR, '..', 'ldraw-complete.zip');

  try {
    // Download
    console.log(`Downloading LDraw complete library...`);
    console.log(`  ${COMPLETE_ZIP_URL}`);
    const response = await fetch(COMPLETE_ZIP_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tmpZip, buffer);
    console.log(`  Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    // Clean existing directory if force
    if (force && fs.existsSync(LDRAW_DIR)) {
      console.log('Removing existing ldraw/ directory...');
      fs.rmSync(LDRAW_DIR, { recursive: true });
    }

    // Extract — the zip contains a top-level ldraw/ folder
    console.log('Extracting...');
    const projectRoot = path.resolve(import.meta.dirname, '..');
    execSync(`unzip -qo "${tmpZip}" -d "${projectRoot}"`, { stdio: 'inherit' });

    // Verify
    if (!fs.existsSync(MARKER_FILE)) {
      throw new Error('Extraction failed: LDConfig.ldr not found after unzip');
    }

    const partsDir = path.join(LDRAW_DIR, 'parts');
    const primDir = path.join(LDRAW_DIR, 'p');
    const partCount = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).length : 0;
    const primCount = fs.existsSync(primDir) ? fs.readdirSync(primDir).length : 0;
    console.log(`Done! Extracted to ldraw/ (${partCount} parts, ${primCount} primitives)`);
  } finally {
    // Clean up zip
    if (fs.existsSync(tmpZip)) {
      fs.unlinkSync(tmpZip);
    }
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
