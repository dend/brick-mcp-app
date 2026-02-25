#!/usr/bin/env tsx
/**
 * download-ldraw-parts.ts
 *
 * Downloads the minimal set of LDraw parts needed by the brick builder
 * from the official LDraw parts library and a GitHub mirror.
 *
 * Usage:
 *   tsx scripts/download-ldraw-parts.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'ldraw');

// Sources to try (in order of preference)
const SOURCES = [
  // Official LDraw library
  (p: string) => `https://library.ldraw.org/library/official/${p}`,
  // GitHub mirror by ctiller
  (p: string) => `https://raw.githubusercontent.com/ctiller/ldraw/master/${p}`,
];

const INITIAL_PARTS = [
  '3005', '3004', '3622', '3010', '3009', '3008',
  '3003', '3002', '3001', '2456', '3007',
  '3024', '3023', '3710', '3022', '3020', '3795', '3031', '3958',
  '3036', '3035', '4477',
  '3039',
  '3700', '3701', '3894', '3702', '3709',
  '2357', '2462',
];

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doRequest = (url: string, redirects: number) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const mod = url.startsWith('https') ? https : https;
      mod.get(url, { headers: { 'User-Agent': 'brick-mcp-app/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          doRequest(res.headers.location!, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    };
    doRequest(url, 0);
  });
}

async function downloadFile(relativePath: string): Promise<string | null> {
  const destPath = path.join(OUT_DIR, relativePath);
  if (fs.existsSync(destPath)) {
    return fs.readFileSync(destPath, 'utf-8');
  }

  for (const makeUrl of SOURCES) {
    const url = makeUrl(relativePath);
    try {
      const content = await fetchUrl(url);
      // Basic validation: LDraw files should contain text data
      if (content.length > 0 && !content.includes('<html') && !content.includes('<!DOCTYPE')) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, content);
        console.log(`  OK: ${relativePath}`);
        return content;
      }
    } catch {
      // Try next source
    }
  }

  return null;
}

function extractReferences(content: string): string[] {
  const refs: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('1 ')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 15) {
        const refFile = parts.slice(14).join(' ').replace(/\\/g, '/');
        refs.push(refFile);
      }
    }
  }
  return refs;
}

function getSearchPaths(ref: string): string[] {
  const normalized = ref.replace(/\\/g, '/');
  const paths: string[] = [];

  if (normalized.startsWith('s/') || normalized.startsWith('S/')) {
    paths.push(`parts/s/${normalized.slice(2)}`);
  } else if (normalized.startsWith('48/') || normalized.startsWith('8/')) {
    paths.push(`p/${normalized}`);
  } else if (normalized.startsWith('parts/') || normalized.startsWith('p/')) {
    paths.push(normalized);
  } else {
    // Could be a primitive or sub-part
    paths.push(`p/${normalized}`);
    paths.push(`parts/s/${normalized}`);
    paths.push(`parts/${normalized}`);
  }

  return paths;
}

async function main() {
  console.log('Downloading LDraw parts subset...\n');

  fs.mkdirSync(path.join(OUT_DIR, 'parts'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'p'), { recursive: true });

  // Download LDConfig.ldr first
  console.log('Downloading LDConfig.ldr...');
  await downloadFile('LDConfig.ldr');

  // Track files
  const toProcess: string[] = INITIAL_PARTS.map(id => `parts/${id}.dat`);
  const processed = new Set<string>();
  const downloaded = new Set<string>();
  const failed = new Set<string>();

  while (toProcess.length > 0) {
    const filePath = toProcess.shift()!;
    if (processed.has(filePath)) continue;
    processed.add(filePath);

    const content = await downloadFile(filePath);
    if (content) {
      downloaded.add(filePath);
      // Extract and queue references
      for (const ref of extractReferences(content)) {
        const searchPaths = getSearchPaths(ref);
        let found = false;
        for (const sp of searchPaths) {
          if (processed.has(sp) || toProcess.includes(sp)) {
            found = true;
            break;
          }
        }
        if (!found && searchPaths.length > 0) {
          // Add all candidates; we'll skip already-processed ones
          toProcess.push(searchPaths[0]);
        }
      }
    } else {
      // Try alternate paths
      const baseName = path.basename(filePath);
      const alts = getSearchPaths(baseName).filter(a => a !== filePath && !processed.has(a));
      let resolved = false;
      for (const alt of alts) {
        const altContent = await downloadFile(alt);
        if (altContent) {
          downloaded.add(alt);
          processed.add(alt);
          resolved = true;
          for (const ref of extractReferences(altContent)) {
            const searchPaths = getSearchPaths(ref);
            const already = searchPaths.some(sp => processed.has(sp) || toProcess.includes(sp));
            if (!already && searchPaths.length > 0) {
              toProcess.push(searchPaths[0]);
            }
          }
          break;
        }
      }
      if (!resolved) {
        failed.add(filePath);
        console.log(`  MISSING: ${filePath}`);
      }
    }
  }

  console.log(`\nDone! Downloaded ${downloaded.size} files, ${failed.size} missing.`);
  if (failed.size > 0) {
    console.log('Missing files:');
    for (const f of [...failed].sort()) console.log(`  - ${f}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
