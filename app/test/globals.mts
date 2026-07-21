import 'fake-indexeddb/auto'
import 'global-jsdom/register'
import { mock } from 'node:test'

// Node 26 no longer mirrors jsdom's Storage globals onto globalThis. Several
// application modules read localStorage during evaluation, so expose the jsdom
// instance before any test modules are loaded.
if (globalThis.localStorage === undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: window.localStorage,
  })
}

// These constants are defined by Webpack at build time, but since tests aren't
// built with Webpack we need to make sure these exist at runtime.
const packageInfo = await import('../package.json')
const { AppDisplayName } = await import('../app-info')

Object.assign(globalThis, {
  __DEV__: false,
  __TEST__: true,
  __DEV_SECRETS__: false,
  // Mirror production: `__APP_NAME__` is the user-visible display name
  // (`Desktop Material`), NOT the on-disk `productName` (`GitHub Desktop`).
  __APP_NAME__: AppDisplayName,
  __APP_VERSION__: packageInfo.version,
  __RELEASE_CHANNEL__: 'development',
  __UPDATES_URL__: '',
  __SHA__: 'test',
  __DARWIN__: process.platform === 'darwin',
  __WIN32__: process.platform === 'win32',
  __LINUX__: process.platform === 'linux',
  log: {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  },

  // The following types are part of the WebWorker support in Node.js and are a
  // common source of hangs in tests due to libraries creating them but not
  // properly cleaning them up. See for example
  // https://github.com/facebook/react/issues/20756, and
  // https://github.com/dexie/Dexie.js/pull/1577.
  //
  // We've upgraded Dexie already but react-dom is a bigger beast and we don't
  // need any of them to run our tests so we just delete them here. In fact,
  // this is exactly what the react-16-node-hanging-test-fix patch does, see
  // https://www.npmjs.com/package/react-16-node-hanging-test-fix?activeTab=code
  MessageChannel: undefined,
  MessagePort: undefined,
  BroadcastChannel: undefined,
})

mock.module('electron', {
  namedExports: {
    clipboard: { writeText: () => {} },
    shell: {},
    ipcRenderer: { on: mock.fn(x => {}) },
    ipcMain: {
      on: () => {},
      once: () => {},
      handle: () => {},
      removeListener: () => {},
    },
    // Present so main-process modules that reference these as values (e.g. the
    // notification-automation and release-transfer runners) link under ESM.
    // Tests inject their own transports; touching these throws clearly.
    net: {
      request: () => {
        throw new Error('electron.net.request is not available in tests')
      },
    },
    session: {
      fromPartition: () => ({}),
    },
  },
})
