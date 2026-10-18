import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

const fixtureRoot = '/private/tmp/script-ui-directory-memory-20261001';
const repoRoot = '/Users/yang/Desktop/code/movie/a-22';
const artifactDir = '/Users/yang/.gemini/antigravity/brain/577ee285-433f-43f3-9721-9096aff9d983';

// 1. Start Vite server on port 3037
const server = await createServer({
  configFile: false,
  root: fixtureRoot,
  cacheDir: `${fixtureRoot}/.vite-cache`,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1', port: 3037, strictPort: true, hmr: false,
    fs: { allow: [repoRoot, fixtureRoot] },
  },
});
await server.listen();

const chromePort = 9225;
const chromeUserData = `/tmp/chrome-test-profile-${Date.now()}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${chromeUserData}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
]);

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

const newTabRes = await fetch(`http://127.0.0.1:${chromePort}/json/new?http://127.0.0.1:3037/`, { method: 'PUT' });
const newTab = await newTabRes.json();
const client = new CDP(newTab.webSocketDebuggerUrl);
await client.init();
await client.send('Page.enable');
await client.send('Runtime.enable');
await client.send('DOM.enable');
await client.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
});

await new Promise((r) => setTimeout(r, 2500));

// Open "目录管理与篇幅设置"
await client.evaluate(`
  (() => {
    const summaryBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('目录管理与篇幅设置'));
    if (summaryBtn) summaryBtn.click();
  })()
`);
await new Promise((r) => setTimeout(r, 300));

async function checkButtonsForTheme(theme) {
  console.log(`\n=== Checking Buttons in ${theme} Theme ===`);
  await client.evaluate(`
    document.documentElement.className = '${theme}';
    document.querySelectorAll('button').forEach(b => b.style.transition = 'none');
  `);
  await new Promise((r) => setTimeout(r, 200));

  const buttons = ['全部场景', '添加', '下一步：分场规划'];
  for (const label of buttons) {
    const coords = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('${label}'));
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        const normalStyle = window.getComputedStyle(btn);
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          normalBg: normalStyle.backgroundColor,
          normalColor: normalStyle.color,
          normalOpacity: normalStyle.opacity,
        };
      })()
    `);

    if (!coords) {
      console.log(`Button "${label}" not found`);
      continue;
    }

    // Move mouse over button
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: coords.x,
      y: coords.y,
    });
    await new Promise((r) => setTimeout(r, 150));

    const hoverStyle = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('${label}'));
        const style = window.getComputedStyle(btn);
        return {
          hoverBg: style.backgroundColor,
          hoverColor: style.color,
          hoverOpacity: style.opacity,
        };
      })()
    `);

    const normalRatio = contrastRatio(parseColor(coords.normalBg), parseColor(coords.normalColor));
    const hoverRatio = contrastRatio(parseColor(hoverStyle.hoverBg), parseColor(hoverStyle.hoverColor));

    console.log(`Button "${label}":`);
    console.log(`  Normal: bg=${coords.normalBg} color=${coords.normalColor} ratio=${normalRatio.toFixed(2)}:1`);
    console.log(`  Hover:  bg=${hoverStyle.hoverBg} color=${hoverStyle.hoverColor} ratio=${hoverRatio.toFixed(2)}:1`);
  }

  // Take screenshot
  const shot = await client.screenshot();
  const filePath = path.join(artifactDir, `screenshot_outline_buttons_${theme}.png`);
  fs.writeFileSync(filePath, shot);
  console.log(`Screenshot saved to: ${filePath}`);
}

await checkButtonsForTheme('light');
await checkButtonsForTheme('dark');

client.close();
chrome.kill();
await server.close();
process.exit(0);
