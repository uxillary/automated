#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.resolve(process.env.PREVIEW_CONFIG || path.join(ROOT, 'data/project-previews.json'));
const OUTPUT_DIR = path.resolve(process.env.PREVIEW_OUTPUT || path.join(ROOT, 'generated/project-previews'));
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT = 30_000;
const MAX_DELAY = 30_000;
const MOTION_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

function parseArgs(argv) {
  const args = { project: null, validateOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--project') args.project = argv[++index];
    else if (argv[index] === '--validate-config') args.validateOnly = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.project === undefined) throw new Error('--project requires a slug');
  return args;
}

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuration must be an object');
  if (!Array.isArray(config.projects)) throw new Error('Configuration must contain a projects array');
  const defaults = config.defaults || {};
  const defaultViewport = defaults.viewport || DEFAULT_VIEWPORT;
  assertInteger(defaultViewport.width, 'defaults.viewport.width', 320, 7680);
  assertInteger(defaultViewport.height, 'defaults.viewport.height', 240, 4320);
  const seen = new Set();

  for (const [index, project] of config.projects.entries()) {
    const label = `projects[${index}]`;
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error(`${label} must be an object`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug || '')) throw new Error(`${label}.slug must be a lowercase kebab-case filename`);
    if (seen.has(project.slug)) throw new Error(`Duplicate project slug: ${project.slug}`);
    seen.add(project.slug);
    if (typeof project.name !== 'string' || !project.name.trim()) throw new Error(`${label}.name is required`);
    let parsed;
    try { parsed = new URL(project.url); } catch { throw new Error(`${label}.url must be a valid URL`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label}.url must use http or https`);
    if (typeof project.enabled !== 'boolean') throw new Error(`${label}.enabled must be a boolean`);
    if (typeof project.type !== 'string') throw new Error(`${label}.type must be a string`);
    const viewport = project.viewport || defaultViewport;
    assertInteger(viewport.width, `${label}.viewport.width`, 320, 7680);
    assertInteger(viewport.height, `${label}.viewport.height`, 240, 4320);
    const delay = project.delay ?? defaults.delay ?? 1500;
    assertInteger(delay, `${label}.delay`, 0, MAX_DELAY);
    if (project.waitFor !== undefined && (typeof project.waitFor !== 'string' || !project.waitFor.trim())) throw new Error(`${label}.waitFor must be a non-empty selector`);
    if (project.hideSelectors !== undefined && (!Array.isArray(project.hideSelectors) || project.hideSelectors.some((item) => typeof item !== 'string' || !item.trim()))) throw new Error(`${label}.hideSelectors must be an array of selectors`);
    const theme = project.theme ?? defaults.theme ?? 'light';
    if (!['light', 'dark', 'no-preference'].includes(theme)) throw new Error(`${label}.theme is invalid`);
  }
  return { defaults, projects: config.projects };
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    throw new Error(`Cannot read ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function conciseError(error) {
  return String(error && error.message ? error.message : error).split('\n')[0].replace(process.cwd(), '.').slice(0, 300);
}

async function sameFile(file, buffer) {
  try { return Buffer.compare(await fs.readFile(file), buffer) === 0; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function captureProject(browser, project, defaults, previous) {
  const viewport = project.viewport || defaults.viewport || DEFAULT_VIEWPORT;
  const image = `${project.slug}.webp`;
  const imagePath = path.join(OUTPUT_DIR, image);
  const context = await browser.newContext({
    // Accommodates TLS-inspecting CI/network proxies; target URLs are still protocol-validated.
    ignoreHTTPSErrors: true,
    viewport,
    deviceScaleFactor: 1,
    colorScheme: project.theme ?? defaults.theme ?? 'light',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'UTC'
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    await page.goto(project.url, { waitUntil: 'domcontentloaded' });
    if (project.waitFor) await page.locator(project.waitFor).first().waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.addStyleTag({ content: MOTION_CSS });
    if (project.hideSelectors?.length) {
      await page.addStyleTag({ content: `${project.hideSelectors.join(',')} { visibility: hidden !important; }` });
    }
    await page.waitForTimeout(project.delay ?? defaults.delay ?? 1500);
    const png = await page.screenshot({ fullPage: project.fullPage ?? defaults.fullPage ?? false, type: 'png', animations: 'disabled' });
    const webp = await sharp(png).webp({ quality: 85, effort: 6 }).toBuffer();
    const unchanged = await sameFile(imagePath, webp);
    if (!unchanged) await fs.writeFile(imagePath, webp);
    const capturedAt = unchanged && previous?.status === 'success' ? previous.capturedAt : new Date().toISOString();
    console.log(`✓ ${project.name}: ${unchanged ? 'unchanged' : 'updated'} ${image}`);
    return { status: 'success', image, url: project.url, capturedAt, existingPreview: true };
  } catch (error) {
    const message = conciseError(error);
    let existingPreview = false;
    try { await fs.access(imagePath); existingPreview = true; } catch {}
    console.warn(`⚠ ${project.name}: ${message}`);
    const record = { status: 'failed', image, url: project.url, capturedAt: null, existingPreview, error: message };
    if (previous?.status === 'failed' && JSON.stringify(previous) === JSON.stringify(record)) return previous;
    return record;
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = validateConfig(await readJson(CONFIG_PATH));
  if (args.validateOnly) { console.log(`Valid configuration: ${config.projects.length} projects`); return; }
  let projects = config.projects.filter((project) => project.enabled && project.type === 'website');
  if (args.project) {
    projects = projects.filter((project) => project.slug === args.project);
    if (!projects.length) throw new Error(`No enabled website found with slug: ${args.project}`);
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const previousManifest = await readJson(MANIFEST_PATH, { projects: {} });
  const browser = await chromium.launch();
  const results = {};
  try {
    for (const project of projects) results[project.slug] = await captureProject(browser, project, config.defaults, previousManifest.projects?.[project.slug]);
  } finally { await browser.close(); }

  const allProjects = args.project ? { ...(previousManifest.projects || {}), ...results } : results;
  const core = { viewport: config.defaults.viewport || DEFAULT_VIEWPORT, projects: allProjects };
  const previousCore = { viewport: previousManifest.viewport, projects: previousManifest.projects };
  const generatedAt = JSON.stringify(core) === JSON.stringify(previousCore) && previousManifest.generatedAt
    ? previousManifest.generatedAt : new Date().toISOString();
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify({ generatedAt, ...core }, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { console.error(`Fatal: ${conciseError(error)}`); process.exitCode = 1; });
module.exports = { parseArgs, validateConfig };
