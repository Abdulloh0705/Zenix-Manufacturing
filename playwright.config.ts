import {defineConfig,devices} from '@playwright/test'

// Browser smoke suite (e2e/). Runs against the production build served by `vite preview`, so it exercises what
// ships. Locally `PW_CHANNEL=chrome` uses an installed Chrome instead of downloading Playwright's Chromium.
const PORT=4179
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
