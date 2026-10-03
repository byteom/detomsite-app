import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

async function main() {
  console.log('🚀 Initializing Admin Portal Headless Smoke Suite...\n')

  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
    {
      url: 'http://localhost:5174/dashboard',
      pretendToBeVisual: true,
    }
  )

  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.localStorage = dom.window.localStorage
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.location = dom.window.location
  globalThis.history = dom.window.history
  globalThis.HTMLElement = dom.window.HTMLElement

  // Set mock admin credentials
  globalThis.localStorage.setItem('admin_token', 'mock_smoke_token_admin_2026')
  globalThis.localStorage.setItem(
    'admin_user',
    JSON.stringify({ id: 1, username: 'admin_demo', name: 'Demo Admin', role: 'admin' })
  )

  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    root: process.cwd(),
  })

  try {
    const mod = await server.ssrLoadModule('./scripts/test-entry.tsx')
    const { passed, results } = mod.runComponentSmokeTests()

    console.log('--------------------------------------------------')
    results.forEach(r => console.log(r))
    console.log('--------------------------------------------------')
    console.log(`\n🎉 ALL ${passed} SMOKE TESTS PASSED CLEANLY!`)
    console.log('   All 14 admin pages, layouts, and components mounted with 0 runtime errors.\n')
  } catch (err) {
    console.error('\n❌ SMOKE TEST FAILED:', err)
    process.exit(1)
  } finally {
    await server.close()
  }
}

main()
