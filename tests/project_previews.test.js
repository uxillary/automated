'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, resolveColorScheme, validateConfig } = require('../scripts/capture-project-previews');

const valid = () => ({
  defaults: { viewport: { width: 1440, height: 900 } },
  projects: [{ slug: 'example', name: 'Example', url: 'https://example.com', enabled: true, type: 'website' }]
});

test('accepts the project filter CLI option', () => {
  assert.deepEqual(parseArgs(['--project', 'example']), { project: 'example', validateOnly: false });
});

test('validates a minimal project preview configuration', () => {
  assert.equal(validateConfig(valid()).projects.length, 1);
});

test('accepts optional dark colour scheme and resolves it for the project', () => {
  const config = valid();
  config.projects[0].colorScheme = 'dark';
  assert.equal(validateConfig(config).projects.length, 1);
  assert.equal(resolveColorScheme(config.projects[0], config.defaults), 'dark');
});

test('projects without a colour scheme retain the existing configured default', () => {
  const config = valid();
  assert.equal(resolveColorScheme(config.projects[0], config.defaults), 'light');
  assert.equal(resolveColorScheme(config.projects[0], {}), 'light');
});

test('rejects invalid colour scheme values', () => {
  const config = valid();
  config.projects[0].colorScheme = 'sepia';
  assert.throws(() => validateConfig(config), /colorScheme is invalid/);
});

test('rejects unsafe URL protocols', () => {
  const config = valid();
  config.projects[0].url = 'file:///etc/passwd';
  assert.throws(() => validateConfig(config), /must use http or https/);
});

test('rejects duplicate and unsafe slugs', () => {
  const config = valid();
  config.projects.push({ ...config.projects[0] });
  assert.throws(() => validateConfig(config), /Duplicate project slug/);
  config.projects = [{ ...config.projects[0], slug: '../escape' }];
  assert.throws(() => validateConfig(config), /kebab-case/);
});
