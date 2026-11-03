import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e/m4',workers:1,fullyParallel:false,timeout:60000,
 use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:5173',headless:true,launchOptions:process.env.GLITCH_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.GLITCH_PLAYWRIGHT_EXECUTABLE}:undefined,trace:'on-first-retry',screenshot:'only-on-failure'},
 reporter:[['list'],['html',{outputFolder:'tests/e2e/artifacts/m4-report',open:'never'}]],
 outputDir:'tests/e2e/artifacts/m4-results',
 webServer:{command:'pnpm --filter @glitch/web dev',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:30000}
});
