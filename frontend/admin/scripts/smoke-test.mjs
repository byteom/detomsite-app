import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5174/dashboard',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.navigator = dom.window.navigator
globalThis.localStorage = dom.window.localStorage
globalThis.sessionStorage = dom.window.sessionStorage
globalThis.location = dom.window.location
globalThis.history = dom.window.history
globalThis.HTMLElement = dom.window.HTMLElement

// Set mock admin authentication
globalThis.localStorage.setItem('admin_token', 'mock_admin_token_for_smoke_test')
globalThis.localStorage.setItem(
  'admin_user',
  JSON.stringify({ id: 1, username: 'admin_demo', name: 'Demo Admin', role: 'admin' })
)

console.log('✓ DOM environment initialized successfully')
