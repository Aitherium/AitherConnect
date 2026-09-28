/*
 * The products add-on catalog (shared/product-catalog.js) and its wiring.
 *
 * Behavioural half: the module runs in a vm sandbox (as the service worker
 * loads it) and the launcher-row merge is asserted -- launcher down means
 * "license unknown" + the shop, never a guessed licence; a non-https url the
 * launcher hands back is never what a card opens.
 * Wiring half: background.js imports it and answers both messages; the
 * sidepanel loads it and routes a product card's click to launch-product.
 *
 * Run: node tests/product-catalog.test.mjs   (exit 1 on failure)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'shared', 'product-catalog.js'), 'utf8')
const sandbox = { self: {} }
vm.runInNewContext(src, sandbox)
const cat = sandbox.self.AitherProductCatalog

let failed = 0
function t(name, fn) {
  try { fn(); console.log(`ok   ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`) }
}

t('four products, ids = shop slugs = pack ids', () => {
  assert.deepEqual([...cat.PRODUCTS.map(p => p.id)], ['deep-research', 'saga', 'agent-home', 'iris'])
  assert.deepEqual([...cat.PRODUCTS.map(p => p.pack)], ['deep-research', 'saga', 'agent-home', null])
  assert.equal(cat.shopUrl(cat.byId('saga')), 'https://aitherium.com/shop/saga')
})

t('launcher down: local = shop + license unknown, hosted = open', () => {
  const rows = cat.mergeStatus(null)
  const saga = rows.find(r => r.id === 'saga')
  assert.equal(saga.action, 'shop')
  assert.equal(saga.licensed, null)
  assert.equal(saga.url, 'https://aitherium.com/shop/saga')
  const iris = rows.find(r => r.id === 'iris')
  assert.equal(iris.action, 'open')
  assert.equal(iris.url, 'https://aitherium.com/iris')
})

t('launcher rows carry install + license; unknown ids dropped', () => {
  const rows = cat.mergeStatus([
    { id: 'deep-research', installed: true, licensed: true, action: 'launch', url: null },
    { id: 'agent-home', installed: false, licensed: true, action: 'install', url: 'https://aitherium.com/shop/agent-home' },
    { id: 'evil', action: 'launch' },
  ])
  assert.equal(rows.length, 4)
  const dr = rows.find(r => r.id === 'deep-research')
  assert.equal(dr.action, 'launch'); assert.equal(dr.licensed, true); assert.equal(dr.installed, true)
  assert.equal(rows.find(r => r.id === 'agent-home').action, 'install')
})

t('a non-https url from the launcher is replaced by the shop page', () => {
  const rows = cat.mergeStatus([{ id: 'saga', action: 'shop', url: 'javascript:alert(1)' }])
  assert.equal(rows.find(r => r.id === 'saga').url, 'https://aitherium.com/shop/saga')
})

t('app cards: product id, action, a route that renders as openable', () => {
  const cards = cat.appCards(cat.mergeStatus([{ id: 'saga', installed: true, licensed: true, action: 'launch' }]))
  const saga = cards.find(c => c.product === 'saga')
  assert.equal(saga.id, 'product-saga')
  assert.equal(saga.route, 'product:saga')
  assert.equal(saga.productAction, 'launch')
  assert.match(saga.desc, /installed · licensed/)
  for (const c of cards) assert.ok(c.route, `${c.id} has no route and would be hidden`)
})

t('background.js imports the catalog and answers both messages', () => {
  const bg = readFileSync(join(root, 'background.js'), 'utf8')
  assert.match(bg, /importScripts\([^)]*"shared\/product-catalog\.js"/)
  assert.match(bg, /case "products-status":/)
  assert.match(bg, /case "launch-product":/)
  assert.match(bg, /127\.0\.0\.1:8299\/products/)
})

t('sidepanel loads the catalog and routes product clicks', () => {
  const html = readFileSync(join(root, 'sidepanel', 'sidepanel.html'), 'utf8')
  assert.ok(html.indexOf('shared/product-catalog.js') < html.indexOf('sidepanel.js?'), 'catalog must load before sidepanel.js')
  const sp = readFileSync(join(root, 'sidepanel', 'sidepanel.js'), 'utf8')
  assert.match(sp, /type: "products-status"/)
  assert.match(sp, /type: "launch-product"/)
  assert.match(sp, /data-product=/)
})

if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('product-catalog: all passed')
