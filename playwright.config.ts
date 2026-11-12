import {defineConfig,devices} from '@playwright/test'
import {generateKeyPairSync} from 'node:crypto'

// Browser smoke suite (e2e/). Runs against the production build served by `vite preview`, so it exercises what
// ships. Locally `PW_CHANNEL=chrome` uses an installed Chrome instead of downloading Playwright's Chromium.
const PORT=Number(process.env.PW_PORT)||4179

// Platform E2E: a throwaway ECDSA P-256 key pair per run. The public key is baked into this test build only; the
// private JWK stays in this process's environment (inherited by Playwright workers) to sign short-lived tickets.
if(!process.env.ZENIX_E2E_PLATFORM_JWK){
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'})
  const pub=publicKey.export({format:'jwk'})
  process.env.ZENIX_E2E_PLATFORM_JWK=JSON.stringify(privateKey.export({format:'jwk'}))
  process.env.VITE_PLATFORM_PUBLIC_KEY=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x!,'base64url'),Buffer.from(pub.y!,'base64url')]).toString('base64url')
}
const channel=process.env.PW_CHANNEL||undefined

export default defineConfig({
  testDir:'e2e',
  timeout:45_000,
  expect:{timeout:7_000},
  fullyParallel:false,
  workers:1,
  retries:process.env.CI?1:0,
  forbidOnly:Boolean(process.env.CI),
  reporter:process.env.CI?[['github'],['html',{open:'never'}]]:[['list']],
  use:{baseURL:`http://localhost:${PORT}`,trace:'retain-on-failure',screenshot:'only-on-failure',channel,locale:'uz-UZ'},
  webServer:{command:`npx vite build && npx vite preview --port ${PORT} --strictPort`,url:`http://localhost:${PORT}`,timeout:120_000,reuseExistingServer:!process.env.CI},
  projects:[
    {name:'setup',testMatch:/auth\.setup\.ts/,use:{...devices['Desktop Chrome'],channel}},
    {name:'desktop',testMatch:/.*\.spec\.ts/,dependencies:['setup'],use:{...devices['Desktop Chrome'],channel,viewport:{width:1366,height:900},storageState:'e2e/.auth/admin.json'}},
    {name:'mobile',testMatch:/.*\.spec\.ts/,dependencies:['setup'],use:{...devices['Pixel 7'],channel,storageState:'e2e/.auth/admin.json'}},
  ],
})
