#!/usr/bin/env node
/**
 * Glint MCP - agent tools for real Capture + session validate + headless export.
 *
 * Claude Code / Cursor:
 *   { "mcpServers": { "glint": { "command": "node", "args": ["/path/to/Glint-MCP/src/index.js"] } } }
 *
 * Env:
 *   GLINT_CAPTURE_ROOT - path to Glint-Capture package (for init/capture shell)
 *   GLINT_WEB_ROOT - path to Glint-Web (for headless export)
 *   GLINT_WEB_BASE - running Web preview URL (default http://127.0.0.1:4173)
 *   GLINT_CDP_URL - Chrome DevTools URL for Copilot boards (default http://127.0.0.1:9222)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CDP,
  TIP_CDP,
  TIP_PAIR,
  connectCdp,
  listBoardsFromBrowser,
  withBoard,
} from './editorBoard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORG_ROOT = path.resolve(__dirname, '../..');
const CAPTURE_ROOT = process.env.GLINT_CAPTURE_ROOT || path.join(ORG_ROOT, 'Glint-Capture');
const WEB_ROOT = process.env.GLINT_WEB_ROOT || path.join(ORG_ROOT, 'Glint-Web');
const BRIDGE_ROOT = process.env.GLINT_BRIDGE_ROOT || path.join(ORG_ROOT, 'Glint-Bridge');
const WEB_BASE = process.env.GLINT_WEB_BASE || 'http://127.0.0.1:4173';

function run(cmd, args, opts = {}) {
  const timeout = opts.timeout || 120_000; // 2 minutes default
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Process timed out after ${timeout}ms: ${cmd} ${args.join(' ')}`));
    }, timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function validateSessionDir(sessionDir) {
  const abs = path.resolve(sessionDir);
  const sessionPath = path.join(abs, 'session.json');
  await access(sessionPath);
  const raw = await readFile(sessionPath, 'utf8');
  const session = JSON.parse(raw);
  const errors = [];
  if (!session.version && !session.screens && !session.screenshots) {
    errors.push('missing version/screens');
  }
  const screens = session.screens || session.screenshots || [];
  let resolved = 0;
  for (const s of screens) {
    const rel = typeof s === 'string' ? s : (s.path || s.file || s.filename);
    if (!rel || String(rel).startsWith('data:')) {
      resolved += 1;
      continue;
    }
    const candidates = [
      path.join(abs, rel),
      path.join(abs, path.basename(rel)),
    ];
    let ok = false;
    for (const c of candidates) {
      try {
        await access(c);
        ok = true;
        break;
      } catch { /* */ }
    }
    if (ok) resolved += 1;
    else errors.push(`missing file: ${rel}`);
  }
  if (!screens.length) {
    const pngs = (await readdir(abs)).filter((f) => /\.png$/i.test(f));
    if (!pngs.length) errors.push('no screens and no PNGs in folder');
    else resolved = pngs.length;
  }
  return {
    ok: errors.length === 0,
    dir: abs,
    app: session.app || null,
    store: session.store || null,
    screenCount: screens.length || resolved,
    resolved,
    errors,
    sessionKeys: Object.keys(session),
  };
}

const server = new McpServer({
  name: 'glint',
  version: '0.1.0',
});

server.tool(
  'glint_validate_session',
  'Validate a Glint session folder (session.json + PNG paths). Real UI only - never invent screens.',
  {
    sessionDir: z.string().describe('Directory containing session.json and PNGs'),
  },
  async ({ sessionDir }) => {
    try {
      const result = await validateSessionDir(sessionDir);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(err.message || err) }) }],
        isError: true,
      };
    }
  },
);

server.tool(
  'glint_init',
  'Run `glint init` in a Flutter app directory (requires glint CLI / Capture package).',
  {
    appDir: z.string().describe('Flutter app root'),
  },
  async ({ appDir }) => {
    const cwd = path.resolve(appDir);
    const result = await run('glint', ['init'], { cwd });
    if (result.code !== 0) {
      // try dart run from Capture package
      const alt = await run('dart', ['run', path.join(CAPTURE_ROOT, 'bin/glint.dart'), 'init'], { cwd });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: alt.code === 0,
            via: 'dart run',
            stdout: alt.stdout,
            stderr: alt.stderr,
            tip: 'Activate CLI: dart pub global activate --source git https://github.com/GlintShot/Glint-Capture.git',
          }, null, 2),
        }],
        isError: alt.code !== 0,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, stdout: result.stdout, stderr: result.stderr }, null, 2) }],
    };
  },
);

server.tool(
  'glint_capture',
  'Run glint capture in a Flutter app (writes session.json + real widget screenshots at store sizes). If no rules exist yet, run glint_discover first or write rules manually. Soft launch: one device (pixel9) for clean Web frame mapping. set auto:true to discover + write + capture in one step.',
  {
    appDir: z.string().describe('Flutter app root'),
    auto: z.boolean().default(false).describe('Discover screens from lib/ then capture'),
  },
  async ({ appDir, auto }) => {
    const cwd = path.resolve(appDir);
    const captureArgs = auto ? ['capture', '--auto'] : ['capture'];
    let result = await run('glint', captureArgs, { cwd });
    if (result.code !== 0) {
      result = await run('dart', ['run', path.join(CAPTURE_ROOT, 'bin/glint.dart'), ...captureArgs], { cwd });
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: result.code === 0,
          auto,
          stdout: result.stdout.slice(-4000),
          stderr: result.stderr.slice(-4000),
          next: 'Import glint_screenshots/ into Glint Web, or call glint_export',
        }, null, 2),
      }],
      isError: result.code !== 0,
    };
  },
);

server.tool(
  'glint_discover',
  'Scan a Flutter app lib/ for the best marketing-worthy screens (home, feed, features, profile, settings). Ranks by visual richness (images, lists, cards, grids). Returns top 8 by default. If developer specified exact screens, skip this and write rules directly in test/glint_screenshots_test.dart.',
  {
    appDir: z.string().describe('Flutter app root'),
    write: z.boolean().default(true),
    maxScreens: z.number().int().min(1).max(20).default(8),
  },
  async ({ appDir, write, maxScreens }) => {
    const cwd = path.resolve(appDir);
    const args = [
      'discover',
      ...(write ? ['--write'] : []),
      '--max', String(maxScreens),
    ];
    let result = await run('glint', args, { cwd });
    if (result.code !== 0) {
      result = await run('dart', ['run', path.join(CAPTURE_ROOT, 'bin/glint.dart'), ...args], { cwd });
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: result.code === 0,
          stdout: result.stdout.slice(-5000),
          stderr: result.stderr.slice(-2000),
          next: result.code === 0 ? 'Review test/glint_screenshots_test.dart then glint_capture' : undefined,
        }, null, 2),
      }],
      isError: result.code !== 0,
    };
  },
);

server.tool(
  'glint_bridge_crawl',
  'Headless auto-crawl (CI or no-agent use). Heuristic scroll/tap needs Appium; --ai needs GLINT_AI_API_KEY. Inside an agentic IDE prefer the glint_bridge_* step tools below - YOU are the planner, no API key needed.',
  {
    target: z.string().describe('Android package (com.app) or URL for web crawl'),
    ai: z.boolean().default(false).describe('Server-side AI vision (needs key). Default false: heuristic.'),
    maxScreens: z.number().int().min(1).max(40).default(16),
  },
  async ({ target, ai, maxScreens }) => {
    const isWeb = /^https?:\/\//i.test(target);
    const args = [
      path.join(BRIDGE_ROOT, 'glint.py'),
      isWeb ? 'crawl-web' : 'crawl',
      ...(isWeb ? ['--url', target] : ['--package', target]),
      '--max-screens', String(maxScreens),
      ...(ai ? ['--ai'] : ['--no-ai']),
    ];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT, timeout: 300_000 });
    const outDir = path.join(BRIDGE_ROOT, 'output');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: result.code === 0,
          mode: isWeb ? 'web' : 'android',
          ai,
          outputDir: outDir,
          stdout: result.stdout.slice(-5000),
          stderr: result.stderr.slice(-2000),
          next: result.code === 0
            ? 'Import Glint-Bridge/output into Glint Web, or glint_export'
            : 'Need Appium (Android) or Playwright (web). For --ai set GLINT_AI_API_KEY. See Glint-Bridge README.',
        }, null, 2),
      }],
      isError: result.code !== 0,
    };
  },
);

server.tool(
  'glint_bridge_screenshot',
  'Agent crawl step: capture one raw screenshot via ADB (no Appium, no API key). YOU decide keep/reject - keep 5-8 store-worthy screens.',
  { serial: z.string().optional().describe('ADB serial (omit for single device)') },
  async ({ serial }) => {
    const args = [path.join(BRIDGE_ROOT, 'bridge/agent.py'), ...(serial ? ['--serial', serial] : []), 'screenshot'];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT });
    return { content: [{ type: 'text', text: result.stdout || result.stderr }], isError: result.code !== 0 };
  },
);

server.tool(
  'glint_bridge_hierarchy',
  'Agent crawl step: dump clickable/scrollable targets + on-screen text via ADB (no Appium, no API key). Bounds are [x1,y1][x2,y2] - tap the center.',
  {
    serial: z.string().optional().describe('ADB serial (omit for single device)'),
    package: z.string().default('').describe('App package to scope the dump'),
  },
  async ({ serial, package: pkg }) => {
    const args = [path.join(BRIDGE_ROOT, 'bridge/agent.py'), ...(serial ? ['--serial', serial] : []), 'hierarchy', ...(pkg ? ['--package', pkg] : [])];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT });
    return { content: [{ type: 'text', text: result.stdout || result.stderr }], isError: result.code !== 0 };
  },
);

server.tool(
  'glint_bridge_tap',
  'Agent crawl step: tap screen coordinates via ADB.',
  {
    x: z.number().int().describe('X pixel (center of hierarchy bounds)'),
    y: z.number().int().describe('Y pixel (center of hierarchy bounds)'),
    serial: z.string().optional(),
  },
  async ({ x, y, serial }) => {
    const args = [path.join(BRIDGE_ROOT, 'bridge/agent.py'), ...(serial ? ['--serial', serial] : []), 'tap', String(x), String(y)];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT });
    return { content: [{ type: 'text', text: result.stdout || result.stderr }], isError: result.code !== 0 };
  },
);

server.tool(
  'glint_bridge_scroll',
  'Agent crawl step: swipe to reveal content via ADB.',
  {
    direction: z.enum(['forward', 'backward']).default('forward'),
    serial: z.string().optional(),
  },
  async ({ direction, serial }) => {
    const args = [path.join(BRIDGE_ROOT, 'bridge/agent.py'), ...(serial ? ['--serial', serial] : []), 'scroll', direction];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT });
    return { content: [{ type: 'text', text: result.stdout || result.stderr }], isError: result.code !== 0 };
  },
);

server.tool(
  'glint_bridge_back',
  'Agent crawl step: system back button via ADB.',
  { serial: z.string().optional() },
  async ({ serial }) => {
    const args = [path.join(BRIDGE_ROOT, 'bridge/agent.py'), ...(serial ? ['--serial', serial] : []), 'back'];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT });
    return { content: [{ type: 'text', text: result.stdout || result.stderr }], isError: result.code !== 0 };
  },
);

server.tool(
  'glint_bridge_launch',
  'Agent crawl step: cold-launch an app package via ADB monkey.',
  {
    package: z.string().describe('Android package, e.g. com.example.app'),
    serial: z.string().optional(),
  },
  async ({ package: pkg, serial }) => {
    const args = [path.join(BRIDGE_ROOT, 'bridge/agent.py'), ...(serial ? ['--serial', serial] : []), 'launch', pkg];
    const result = await run('python3', args, { cwd: BRIDGE_ROOT });
    return { content: [{ type: 'text', text: result.stdout || result.stderr }], isError: result.code !== 0 };
  },
);

server.tool(
  'glint_render',
  'No-browser render: design.json + screenshots → store-ready PNG ZIP via @napi-rs/canvas (no Playwright, no Fabric, no browser). Returns ZIP path + metadata.',
  {
    design: z.object({
      template: z.string().describe('Template id (e.g. "blink-play", "play-pop", "warm-glow-play")'),
      screenshots: z.array(z.string()).default([]).describe('Screenshot file paths, one per slide slot'),
      overrides: z.object({
        slides: z.record(z.object({
          headline: z.string().optional(),
          subheadline: z.string().optional(),
          text: z.string().optional(),
          color: z.string().optional(),
          frame: z.string().optional().describe('Device bezel id (e.g. pixel9, iphone16-pro). Swap without scale keeps display size.'),
          scale: z.number().optional().describe('Bezel scale; omit when swapping frame to preserve prior size'),
          marginTop: z.number().optional(),
          position: z.string().optional(),
        }).passthrough()).optional(),
      }).default({}).optional(),
      store: z.string().optional().describe('Store target (e.g. "play/phone", "ios/iphone")'),
    }).describe('Design intent: template + screenshots + per-slide overrides'),
    out: z.string().default('glint.zip').describe('Output ZIP path'),
  },
  async ({ design, out }) => {
    const { writeFile: wf, mkdir: md } = await import('node:fs/promises');
    const tmpDir = path.join(WEB_ROOT, '.glint-render');
    await md(tmpDir, { recursive: true });
    const designPath = path.join(tmpDir, `design-${Date.now()}.json`);
    await wf(designPath, JSON.stringify(design, null, 2));
    const args = [
      path.join(WEB_ROOT, 'scripts/render.mjs'),
      '--design', designPath,
      '--screenshots', path.resolve(design.screenshots?.[0] ? path.dirname(design.screenshots[0]) : '.'),
      '--out', path.resolve(out),
      '--json',
    ];
    const result = await run('node', args, { cwd: WEB_ROOT, timeout: 60_000 });
    let meta = {};
    try { meta = JSON.parse(result.stdout.split('\n').filter(l => l.startsWith('{')).join('')); } catch {}
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: result.code === 0,
          out: path.resolve(out),
          template: design.template,
          slideCount: meta.count || 0,
          canvas: meta.canvas || null,
          stdout: result.stdout.slice(-2000),
          stderr: result.stderr.slice(-1000),
          tip: result.code !== 0
            ? 'cd Glint-Web && npm install (needs @napi-rs/canvas). No browser needed.'
            : undefined,
        }, null, 2),
      }],
      isError: result.code !== 0,
    };
  },
);

server.tool(
  'glint_export',
  'Headless export: session folder + template id → ZIP (requires Glint Web preview server + Playwright).',
  {
    sessionDir: z.string(),
    template: z.string().default('blink-play'),
    out: z.string().default('glint.zip'),
    layout: z.enum(['flat', 'fastlane']).default('flat'),
    locale: z.string().default('en-US'),
    app: z.string().default('glint'),
    base: z.string().optional(),
  },
  async ({ sessionDir, template, out, layout, locale, app, base }) => {
    const script = path.join(WEB_ROOT, 'scripts/headless-export.mjs');
    const args = [
      script,
      '--session', path.resolve(sessionDir),
      '--template', template,
      '--out', path.resolve(out),
      '--layout', layout,
      '--locale', locale,
      '--app', app,
      '--base', base || WEB_BASE,
      '--json',
    ];
    const result = await run('node', args, { cwd: WEB_ROOT });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: result.code === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          tip: result.code !== 0
            ? 'Start Web: cd Glint-Web && npm run build && npm run preview - then retry. Install: npx playwright install chromium'
            : undefined,
        }, null, 2),
      }],
      isError: result.code !== 0,
    };
  },
);

const EDITOR_OPS = [
  'getEditorState',
  'selectFrame',
  'selectDevice',
  'setDeviceScale',
  'setDeviceAngle',
  'setScreenshot',
  'matchDeviceTransform',
];

server.tool(
  'glint_editor_list_boards',
  'List open Glint Web Copilot boards (Allow agent on). Requires Chrome CDP. Guide the user: open editor → Allow agent → share board code.',
  {
    cdpUrl: z.string().optional().describe(`Chrome DevTools URL (default ${DEFAULT_CDP})`),
  },
  async ({ cdpUrl }) => {
    let browser;
    try {
      browser = await connectCdp(cdpUrl || DEFAULT_CDP);
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: err.code || 'cdp_unavailable',
            tip: err.tip || TIP_CDP,
          }, null, 2),
        }],
        isError: true,
      };
    }
    try {
      const boards = await listBoardsFromBrowser(browser);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            boards,
            tip: boards.length ? TIP_PAIR : `${TIP_PAIR} None found yet.`,
          }, null, 2),
        }],
      };
    } finally {
      await browser.close().catch(() => {});
    }
  },
);

server.tool(
  'glint_editor_state',
  'Read live editor state for a Copilot board (frames, scale, angle). Pass the user board code. Do not open a new Glint tab.',
  {
    pairCode: z.string().describe('4-letter board code from Allow agent'),
    cdpUrl: z.string().optional(),
  },
  async ({ pairCode, cdpUrl }) => {
    const result = await withBoard(pairCode, async (page, code) => {
      const state = await page.evaluate(async (c) => {
        const g = window.__GLINT_COPILOT__;
        if (!g?.isThisBoard?.(c)) return { ok: false, error: 'wrong_board' };
        return g.getEditorState();
      }, code);
      return { ok: !!state?.ok, pairCode: code, ...state };
    }, { cdpUrl: cdpUrl || DEFAULT_CDP });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

server.tool(
  'glint_editor_dispatch',
  'Run one canvas op on a live Copilot board (shows agent cursor). Ops: selectFrame, selectDevice, setDeviceScale, setDeviceAngle, setScreenshot, matchDeviceTransform, getEditorState.',
  {
    pairCode: z.string(),
    op: z.enum(EDITOR_OPS),
    args: z.record(z.any()).optional().describe('Op args, e.g. { frameIndex: 0, pct: 90 }'),
    present: z.boolean().optional().default(true),
    paceMs: z.number().optional(),
    cdpUrl: z.string().optional(),
  },
  async ({ pairCode, op, args, present, paceMs, cdpUrl }) => {
    const result = await withBoard(pairCode, async (page, code) => {
      return page.evaluate(async ({ c, opName, opArgs, presentFlag, pace }) => {
        const g = window.__GLINT_COPILOT__;
        if (!g?.isThisBoard?.(c)) return { ok: false, error: 'wrong_board', pairCode: g?.pairCode };
        return g.dispatch(opName, opArgs || {}, {
          pairCode: c,
          present: presentFlag !== false,
          paceMs: pace,
        });
      }, {
        c: code,
        opName: op,
        opArgs: args || {},
        presentFlag: present,
        pace: paceMs,
      });
    }, { cdpUrl: cdpUrl || DEFAULT_CDP });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

server.tool(
  'glint_editor_board_pass',
  'Copilot board pass: walk every frame left→right with the agent cursor, copying scale/angle from the source frame (shared knowledge across screenshots).',
  {
    pairCode: z.string(),
    sourceIndex: z.number().int().optional().describe('Source frame index (default: active or 0)'),
    paceMs: z.number().optional().default(420),
    cdpUrl: z.string().optional(),
  },
  async ({ pairCode, sourceIndex, paceMs, cdpUrl }) => {
    const result = await withBoard(pairCode, async (page, code) => {
      return page.evaluate(async ({ c, src, pace }) => {
        const g = window.__GLINT_COPILOT__;
        if (!g?.isThisBoard?.(c)) return { ok: false, error: 'wrong_board', pairCode: g?.pairCode };
        return g.boardPass({
          pairCode: c,
          sourceIndex: src,
          paceMs: pace,
        });
      }, { c: code, src: sourceIndex, pace: paceMs });
    }, { cdpUrl: cdpUrl || DEFAULT_CDP });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

server.tool(
  'glint_ecosystem_info',
  'Return Glint ecosystem info: paths, tools, and decision guide for screenshot capture.',
  {},
  async () => {
    const info = {
      principle: 'Real UI only - never invent App Store screenshots',
      loop: 'Capture/Bridge → session.json → Web → ZIP → View',
      decisionGuide: {
        flutterApp: 'Use glint_discover (auto) or write rules manually → glint_capture → output/ → Glint Web',
        androidDevice: 'Agentic IDE: glint_bridge_launch → loop glint_bridge_screenshot + glint_bridge_hierarchy + tap/scroll/back, keep 5-8 best → output/ → Glint Web. Headless CI: glint_bridge_crawl (heuristic or --ai with key).',
        specifyScreens: 'Write rules directly in test/glint_screenshots_test.dart, skip discover',
        noScreensSpecified: 'Run glint_discover --write to auto-find best marketing screens',
        copilot: 'User opens Glint Web → Allow agent → share board code → glint_editor_* tools (Chrome CDP). Never open a second editor tab.',
      },
      goldenPath: path.join(ORG_ROOT, 'Glint-Docs/guides/golden-path.md'),
      smoke: path.join(ORG_ROOT, 'Glint-Docs/guides/smoke-checklist.md'),
      captureRoot: CAPTURE_ROOT,
      webRoot: WEB_ROOT,
      bridgeRoot: BRIDGE_ROOT,
      webBase: WEB_BASE,
      cdpUrl: DEFAULT_CDP,
      tools: [
        'glint_init', 'glint_discover', 'glint_capture',
        'glint_bridge_crawl', 'glint_bridge_launch', 'glint_bridge_screenshot',
        'glint_bridge_hierarchy', 'glint_bridge_tap', 'glint_bridge_scroll', 'glint_bridge_back',
        'glint_render', 'glint_validate_session', 'glint_export',
        'glint_editor_list_boards', 'glint_editor_state', 'glint_editor_dispatch', 'glint_editor_board_pass',
        'glint_ecosystem_info',
      ],
      agentNote: 'Agent is the intelligence: drive Bridge step tools yourself (no API key). Mode 2: glint_export / glint_render. Mode 3 Copilot: glint_editor_* via CDP on the user board code.',
      tipCdp: TIP_CDP,
      tipPair: TIP_PAIR,
    };
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
