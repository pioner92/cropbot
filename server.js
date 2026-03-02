'use strict';

const express  = require('express');
const { execFile } = require('child_process');
const fs       = require('fs');
const fsp      = require('fs/promises');
const path     = require('path');
const os       = require('os');

const app  = express();
const PORT = 3000;

// ── COOP/COEP headers — required for SharedArrayBuffer ────────
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /compile ──────────────────────────────────────────────
app.post('/compile', async (req, res) => {
  const { code, gridW = 10, gridH = 10 } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'No code provided for compilation' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-'));

  try {
    // Read header template and inject current field size
    let header = await fsp.readFile(path.join(__dirname, 'drone_api.h'), 'utf8');
    header = header
      .replace('__GRID_W__', String(gridW))
      .replace('__GRID_H__', String(gridH));

    // Final source = header + user code
    // Auto-fix: void main() → int main() (JS mode allowed void)
    const fixedCode = code.replace(/\bvoid\s+(main\s*\()/g, 'int $1');
    const fullCode = header + '\n' + fixedCode;
    const srcPath  = path.join(tmpDir, 'main.cpp');
    const outPath  = path.join(tmpDir, 'out.wasm');

    await fsp.writeFile(srcPath, fullCode);

    const emcc = process.env.EMCC_PATH || 'emcc';

    await new Promise((resolve, reject) => {
      execFile(emcc, [
        srcPath,
        '-o',   outPath,
        '--no-entry',
        '-s',   'STANDALONE_WASM=1',
        '-s',   'EXPORTED_FUNCTIONS=["_main"]',
        '-s',   'ERROR_ON_UNDEFINED_SYMBOLS=0',
        '-s',   'WASM_BIGINT=0',
        '-O1',
        '-std=c++17',
        '-fno-exceptions',
      ], { timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) {
          // Remove tmp path from compiler error output
          const raw = stderr || stdout || err.message || '';
          const clean = raw.replace(new RegExp(tmpDir.replace(/[/\\]/g, '[/\\\\]'), 'g'), '');
          reject(new Error(clean.trim()));
        } else {
          resolve();
        }
      });
    });

    const wasm = await fsp.readFile(outPath);
    res.set('Content-Type', 'application/wasm');
    res.send(wasm);

  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('  🌾  Farm Drone — Compiler Server');
  console.log(`  ➜   http://localhost:${PORT}`);
  console.log('');
});
