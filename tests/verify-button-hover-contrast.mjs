import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

const fixtureRoot = '/private/tmp/script-ui-analysis-light-20261001';
const repoRoot = '/Users/yang/Desktop/code/movie/a-22';
const artifactDir = '/Users/yang/.gemini/antigravity/brain/577ee285-433f-43f3-9721-9096aff9d983';

// 1. Start Vite server on port 3017
const server = await createServer({
  configFile: false,
  root: fixtureRoot,
  cacheDir: `${fixtureRoot}/.vite-cache`,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1', port: 3017, strictPort: true, hmr: false,
    fs: { allow: [repoRoot, fixtureRoot] },
  },
});
await server.listen();
console.log('Vite server running at http://127.0.0.1:3017/');

// 2. Start Headless Chrome with remote debugging
const chromePort = 9224;
const chromeUserData = `/tmp/chrome-test-profile-${Date.now()}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${chromeUserData}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
]);

// Wait for Chrome remote debugging endpoint
let wsEndpoint = '';
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
    const data = await res.json();
    wsEndpoint = data.webSocketDebuggerUrl;
    if (wsEndpoint) break;
  } catch (e) {
    await new Promise((r) => setTimeout(r, 200));
  }
}
if (!wsEndpoint) throw new Error('Failed to connect to Chrome CDP');

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }
  async init() {
    return new Promise((resolve) => {
      this.ws.onopen = () => resolve();
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(JSON.stringify(msg.error)));
          else cb.resolve(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }
  async screenshot() {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(res.data, 'base64');
  }
  close() {
    this.ws.close();
  }
}

// Helper to compute luminance and contrast
function parseColor(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

function relativeLuminance(r, g, b) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Create new target tab
const newTabRes = await fetch(`http://127.0.0.1:${chromePort}/json/new?http://127.0.0.1:3017/`, { method: 'PUT' });
const newTab = await newTabRes.json();
const client = new CDP(newTab.webSocketDebuggerUrl);
await client.init();
await client.send('Page.enable');
await client.send('Runtime.enable');
await client.send('DOM.enable');
await client.send('Emulation.setDeviceMetricsOverride', {
  width: 1200,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
});

await new Promise((r) => setTimeout(r, 2500));

// Test function for a given theme
async function testTheme(themeName) {
  console.log(`\n================ Testing ${themeName} theme ================`);
  await client.evaluate(`document.documentElement.className = '${themeName}';`);
  await new Promise((r) => setTimeout(r, 300));

  // Get button info in normal and hover states
  const buttonMetrics = await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('提出修改候选'));
      if (!btn) return { error: 'Button not found' };
      
      const normalStyle = window.getComputedStyle(btn);
      const normalBg = normalStyle.backgroundColor;
      const normalColor = normalStyle.color;
      const normalOpacity = normalStyle.opacity;

      // Simulate hover by dispatching mouseenter/mouseover and checking rules
      btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      // Also get hover styles using :hover pseudo simulation or matched CSS rules
      // For accurate hover style check in CDP:
      return {
        text: btn.textContent.trim(),
        normalBg,
        normalColor,
        normalOpacity,
        classes: btn.className,
      };
    })()
  `);
  console.log('Button normal metrics:', buttonMetrics);

  // Now hover mouse cursor over the button using CDP Input.dispatchMouseEvent
  const btnBox = await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('提出修改候选'));
      const rect = btn.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `);
  
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: btnBox.x,
    y: btnBox.y,
  });
  await new Promise((r) => setTimeout(r, 200));

  const hoverMetrics = await client.evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('提出修改候选'));
      const hoverStyle = window.getComputedStyle(btn);
      return {
        hoverBg: hoverStyle.backgroundColor,
        hoverColor: hoverStyle.color,
        hoverOpacity: hoverStyle.opacity,
      };
    })()
  `);
  console.log('Button hover metrics:', hoverMetrics);

  // Compute contrast
  const normalBgRgb = parseColor(buttonMetrics.normalBg);
  const normalColorRgb = parseColor(buttonMetrics.normalColor);
  const normalRatio = contrastRatio(normalBgRgb, normalColorRgb);

  const hoverBgRgb = parseColor(hoverMetrics.hoverBg);
  const hoverColorRgb = parseColor(hoverMetrics.hoverColor);
  const hoverRatio = contrastRatio(hoverBgRgb, hoverColorRgb);

  console.log(`Normal contrast ratio: ${normalRatio.toFixed(2)}:1`);
  console.log(`Hover contrast ratio: ${hoverRatio.toFixed(2)}:1`);

  // Capture screenshot
  const screenshotBuf = await client.screenshot();
  const screenshotPath = path.join(artifactDir, `screenshot_button_hover_${themeName}.png`);
  fs.writeFileSync(screenshotPath, screenshotBuf);
  console.log(`Screenshot saved to: ${screenshotPath}`);

  return { normalRatio, hoverRatio };
}

const lightResults = await testTheme('light');
const darkResults = await testTheme('dark');

console.log('\n================ SUMMARY ================');
console.log('Light normal contrast:', lightResults.normalRatio.toFixed(2));
console.log('Light hover contrast:', lightResults.hoverRatio.toFixed(2), '(previously 1.036:1)');
console.log('Dark normal contrast:', darkResults.normalRatio.toFixed(2));
console.log('Dark hover contrast:', darkResults.hoverRatio.toFixed(2), '(previously 1.164:1)');

client.close();
chrome.kill();
await server.close();
process.exit(0);
