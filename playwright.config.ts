import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',testIgnore:['**/m4/**','**/m5/**'],workers:1,fullyParallel:false,
 timeout:30000,
 use:{...devices['Desktop Chrome'],headless:true,launchOptions:process.env.GLITCH_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.GLITCH_PLAYWRIGHT_EXECUTABLE}:undefined,trace:'on',screenshot:'on',video:'off'},
 reporter:[['list'],['html',{outputFolder:'tests/e2e/artifacts/report',open:'never'}]],
 outputDir:'tests/e2e/artifacts/results',
 webServer:[
  {command:'node test/browser-fixture.js',url:'http://127.0.0.1:3001',reuseExistingServer:false,timeout:30000},
  {command:'pnpm --filter @glitch/web dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:30000}
 ]
});
