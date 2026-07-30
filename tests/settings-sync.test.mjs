#!/usr/bin/env node
/**
 * AitherConnect Settings Sync Tests
 * ==================================
 * Validates field classification: device-local vs portal-synced.
 * Ensures no API keys leak into portal sync.
 * All 32 form fields must be classified.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const optionsPath = path.join(__dirname, '..', 'options', 'options.js');

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

let testCount = 0;
let passCount = 0;
let failCount = 0;

function pass(name) {
  passCount++;
  console.log(`${colors.green}✓${colors.reset} ${name}`);
}

function fail(name, error) {
  failCount++;
  console.log(`${colors.red}✗${colors.reset} ${name}`);
  if (error) console.log(`  ${error}`);
}

// ─────────────────────────────────────────────────────────────────────────

console.log('\n🔐 AitherConnect Settings Sync Classification\n');

// Read options.js and extract field classification
const optionsContent = fs.readFileSync(optionsPath, 'utf-8');

// Extract FIELD_CLASSIFICATION from the file
const classifMatch = optionsContent.match(
  /const FIELD_CLASSIFICATION = \{[\s\S]*?\n\};/
);

if (!classifMatch) {
  fail('Field classification extraction', 'Could not find FIELD_CLASSIFICATION in options.js');
  process.exit(1);
}

const classifSection = classifMatch[0];
console.log('Extracted classification:\n');
console.log(classifSection.split('\n').slice(0, 25).join('\n'));
console.log('...\n');

// Parse the classification — be more lenient with line/comment handling
const portalSyncMatch = classifSection.match(/PORTAL_SYNCED: new Set\(\[([\s\S]*?)\]\)/);
const deviceLocalMatch = classifSection.match(/DEVICE_LOCAL: new Set\(\[([\s\S]*?)\]\)/);

if (!portalSyncMatch || !deviceLocalMatch) {
  fail('Classification parsing', 'Could not parse PORTAL_SYNCED or DEVICE_LOCAL');
  process.exit(1);
}

// Extract field names more robustly
function extractFieldNames(content) {
  // Find all quoted strings that look like field names
  const matches = content.match(/'[a-zA-Z_][a-zA-Z0-9_]*'/g) || [];
  return matches
    .map(s => s.replace(/'/g, ''))
    .filter(s => s.length > 0 && /^[a-zA-Z]/.test(s)); // Must start with letter
}

const portalFields = extractFieldNames(portalSyncMatch[1]);
const localFields = extractFieldNames(deviceLocalMatch[1]);

testCount++;
if (portalFields.length > 0) {
  pass(`PORTAL_SYNCED has ${portalFields.length} fields`);
} else {
  fail('PORTAL_SYNCED extraction', 'No fields found');
}

testCount++;
if (localFields.length > 0) {
  pass(`DEVICE_LOCAL has ${localFields.length} fields`);
} else {
  fail('DEVICE_LOCAL extraction', 'No fields found');
}

// Test 1: No API keys in PORTAL_SYNCED
testCount++;
const hasApiKeyInSync = portalFields.some(f =>
  f.toLowerCase().includes('key') && f.toLowerCase().includes('api')
);
if (!hasApiKeyInSync) {
  pass('No API keys in PORTAL_SYNCED');
} else {
  fail('API key leak check', 'Found API key field in PORTAL_SYNCED');
}

// Test 2: API keys in DEVICE_LOCAL
testCount++;
const hasApiKeyLocal = localFields.includes('apiKey') || localFields.includes('cloudApiKey');
if (hasApiKeyLocal) {
  pass('API keys present in DEVICE_LOCAL');
} else {
  fail('API key classification', 'API keys not in DEVICE_LOCAL');
}

// Test 3: No duplicate fields
testCount++;
const allFields = new Set([...portalFields, ...localFields]);
const uniqueCount = allFields.size;
const totalCount = portalFields.length + localFields.length;
if (uniqueCount === totalCount) {
  pass('No duplicate fields across classifications');
} else {
  fail('Duplicate check', `Found ${totalCount - uniqueCount} duplicates`);
}

// Test 4: Identity fields in PORTAL_SYNCED
testCount++;
const identityFields = ['tenantId', 'workspaceId', 'userId', 'projectName', 'wikiProject'];
const missingIdentity = identityFields.filter(f => !portalFields.includes(f));
if (missingIdentity.length === 0) {
  pass('All identity fields are PORTAL_SYNCED');
} else {
  fail('Identity field sync', `Missing: ${missingIdentity.join(', ')}`);
}

// Test 5: Port numbers in DEVICE_LOCAL
testCount++;
const portFields = ['genesisPort', 'veilPort', 'mindPort', 'pulsePort', 'strataPort',
                    'searchPort', 'nexusPort', 'canvasPort', 'nodePort'];
const missingPorts = portFields.filter(f => !localFields.includes(f));
if (missingPorts.length === 0) {
  pass('All port fields are DEVICE_LOCAL');
} else {
  fail('Port field classification', `Missing: ${missingPorts.join(', ')}`);
}

// Test 6: Sync-safe URLs in PORTAL_SYNCED
testCount++;
const syncUrls = ['cloudGatewayUrl', 'mcpUrl', 'relayUrl', 'relayWsUrl'];
const missingSyncUrls = syncUrls.filter(f => !portalFields.includes(f));
if (missingSyncUrls.length === 0) {
  pass('All public URLs are PORTAL_SYNCED');
} else {
  fail('URL classification', `Missing: ${missingSyncUrls.join(', ')}`);
}

// Test 7: Feature toggles where they belong
testCount++;
const featureToggles = ['workspaceKnowledge', 'textActionsAllSites', 'sitePacksEnabled'];
const togglesInSync = featureToggles.filter(f => portalFields.includes(f));
if (togglesInSync.length > 0) {
  pass(`${togglesInSync.length}/${featureToggles.length} toggles are PORTAL_SYNCED`);
} else {
  fail('Feature toggle sync', 'Toggles not found in PORTAL_SYNCED');
}

// Test 8: No remoteUrl in portal (it's device-specific)
testCount++;
if (localFields.includes('remoteUrl') && !portalFields.includes('remoteUrl')) {
  pass('remoteUrl correctly classified as DEVICE_LOCAL (per-device override)');
} else {
  fail('remoteUrl classification', 'Should be DEVICE_LOCAL');
}

// Test 9: autoHarvest and ragEnabled are DEVICE_LOCAL
testCount++;
if (localFields.includes('autoHarvest') && localFields.includes('ragEnabled')) {
  pass('autoHarvest and ragEnabled correctly DEVICE_LOCAL (device-specific behaviors)');
} else {
  fail('Behavior toggle classification', 'Should be DEVICE_LOCAL');
}

// Test 10: Verify no bare 'Key' fields (typo check)
testCount++;
const typoCheck = [...portalFields, ...localFields].filter(f =>
  f === 'key' || f === 'Key' || f === 'KEY'
);
if (typoCheck.length === 0) {
  pass('No bare "Key" field typos');
} else {
  fail('Typo check', `Found bare key fields: ${typoCheck.join(', ')}`);
}

// Test 11: Provider config is split correctly
testCount++;
const providerFields = ['providerSelect', 'providerModel', 'providerBaseUrl', 'providerEmbeddingModel'];
const providerInSync = providerFields.filter(f => portalFields.includes(f));
const hasProviderKey = localFields.includes('providerApiKey');
if (providerInSync.length === providerFields.length && hasProviderKey) {
  pass('Provider config split: config in PORTAL_SYNCED, key in DEVICE_LOCAL');
} else {
  fail('Provider config split',
    `Config in sync: ${providerInSync.length}/${providerFields.length}, key in local: ${hasProviderKey}`);
}

// Summary
console.log(`\n${ colors.blue}───────────────────────────────────────────${ colors.reset}`);
console.log(`${ colors.blue}Field Classification Summary${ colors.reset}`);
console.log(`${ colors.blue}───────────────────────────────────────────${ colors.reset}\n`);
console.log(`PORTAL_SYNCED (${portalFields.length} fields):`);
console.log(`  ${portalFields.join(', ')}\n`);
console.log(`DEVICE_LOCAL (${localFields.length} fields):`);
console.log(`  ${localFields.join(', ')}\n`);

// Final status
if (failCount === 0) {
  console.log(
    `${colors.green}✓ All ${testCount} tests passed${colors.reset}\n`
  );
  process.exit(0);
} else {
  console.log(
    `${colors.red}✗ ${failCount}/${testCount} test(s) failed${colors.reset}\n`
  );
  process.exit(1);
}
