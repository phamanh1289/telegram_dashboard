/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS benchmark CLI. */
// node web/tests/uiflow-benchmark.cjs [engine-path] [output.json]
// Synthetic local browser baseline. Cold = fresh page/cache, warm = same page/cache.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const { chromium } = require('@playwright/test');
const engine = path.resolve(process.argv[2] || 'web/public/uiflow.js');
const datasetSource = fs.readFileSync(path.join(__dirname, 'uiflow-datasets.ts'), 'utf8');
const datasetModule = { exports: {} };
new Function('exports', ts.transpileModule(datasetSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(datasetModule.exports);
const packSource = fs.readFileSync(path.resolve(path.dirname(engine), '../src/features/youtrack/lib/uiflow.ts'), 'utf8').split('export const zeplinUrls')[1];
const browserPack = ts.transpileModule(('const zeplinUrls' + packSource).replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText.replace(/export /g, '');
(async () => {
  const browser = await chromium.launch();
  const report = { machine: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model, memoryGB: +(os.totalmem() / 2 ** 30).toFixed(1) }, browser: browser.version(), engine, viewport: '1440x900', samples: [], unavailable: ['ticket/story', 'Zeplin network/cache', 'AI latency/tokens', 'upload'], units: 'milliseconds', notes: 'Synthetic inline SVGs, headless Chromium; timings include no real network. Pack cold counts synthetic proxy requests; warm reuses pack cache.' };
  for (const count of [5, 20, 60]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let requests = 0, bytes = 0;
    const dataset = datasetModule.exports.flowDataset(count);
    await page.route('**/api/yt/flow/image?**', async route => {
      const src = new URL(route.request().url()).searchParams.get('u');
      const body = decodeURIComponent(src.split(',')[1]);
      requests++; bytes += Buffer.byteLength(body);
      await route.fulfill({ contentType: 'image/svg+xml', body });
    });
    await page.route('http://benchmark.local/', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('http://benchmark.local/');
    await page.setContent('<div id="host" style="position:fixed;inset:0"></div>');
    await page.addScriptTag({ path: engine });
    await page.addScriptTag({ content: browserPack + '; window.packShots = packShots;' });
    for (const cache of ['cold', 'warm']) {
      const startRequests = requests, startBytes = bytes;
      const result = await page.evaluate(async ({ flow, shots }) => {
        window.api?.destroy();
        const start = performance.now();
        window.api = window.UIFlow.mount(document.getElementById('host'), flow, { edit: true, shots });
        const mount = performance.now() - start;
        await new Promise(requestAnimationFrame);
        const packStart = performance.now();
        const packed = await window.packShots(flow, shots);
        const pack = performance.now() - packStart;
        document.querySelector('.uf-editbtn').click();
        const title = document.querySelector('.uf-screen .uf-title');
        title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        title.textContent = 'Synthetic property edit';
        const propertyStart = performance.now();
        title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const propertyCommit = performance.now() - propertyStart;
        const head = document.querySelector('.uf-head'), rect = head.getBoundingClientRect();
        const fire = (type, x, y) => head.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 99, clientX: x, clientY: y }));
        const frames = [];
        fire('pointerdown', rect.x + 20, rect.y + 10);
        let last = performance.now();
        for (let i = 1; i <= 20; i++) {
          fire('pointermove', rect.x + 20 + i * 3, rect.y + 10 + i);
          await new Promise(requestAnimationFrame);
          const now = performance.now(); frames.push(now - last); last = now;
        }
        const commitStart = performance.now(); fire('pointerup', rect.x + 80, rect.y + 30);
        const commit = performance.now() - commitStart;
        const view = document.querySelector('.uf-view');
        const panFrames = [];
        last = performance.now();
        for (let i = 0; i < 20; i++) {
          view.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: 4, deltaY: 2 }));
          await new Promise(requestAnimationFrame);
          const now = performance.now(); panFrames.push(now - last); last = now;
        }
        panFrames.sort((a, b) => a - b);
        frames.sort((a, b) => a - b);
        return { mount, pack, propertyCommit, packFailed: packed.failed, packedJsonCodeUnits: JSON.stringify(packed.shots).length, dragFrameP95: frames[Math.ceil(frames.length * .95) - 1], panFrameP95: panFrames[Math.ceil(panFrames.length * .95) - 1], commit };
      }, dataset);
      report.samples.push({ screens: count, edges: dataset.flow.links.length, cache, ...result, requests: requests - startRequests, imageBytes: bytes - startBytes });
    }
    await page.close();
  }
  await browser.close();
  const output = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[3]) fs.writeFileSync(process.argv[3], output);
  process.stdout.write(output);
})().catch(e => { console.error(e); process.exit(1); });
