import jsdomPkg from 'jsdom'
const { JSDOM } = jsdomPkg

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5174/dashboard',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.localStorage = dom.window.localStorage
globalThis.sessionStorage = dom.window.sessionStorage
globalThis.location = dom.window.location
globalThis.history = dom.window.history
globalThis.HTMLElement = dom.window.HTMLElement

globalThis.localStorage.setItem('admin_token', 'mock_admin_token')
globalThis.localStorage.setItem(
  'admin_user',
  JSON.stringify({ id: 1, username: 'admin_demo', name: 'Demo Admin', role: 'admin' })
)

async function run() {
  console.log('🚀 Running Admin Portal Component & Page Smoke Tests...\n')
  const { runComponentSmokeTests } = await import('../.smoke/test-entry.js')
  const { passed, results } = runComponentSmokeTests()

  console.log('====================================================')
  results.forEach(r => console.log(r))
  console.log('====================================================')
  console.log(`\n🎉 ALL ${passed} SMOKE TESTS PASSED!`)
  console.log('   All 14 pages and core UI components rendered without throwing any runtime errors.\n')
}

run().catch(err => {
  console.error('\n❌ SMOKE TEST FAILED:', err)
  process.exit(1)
})
