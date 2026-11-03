import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const artifacts='tests/e2e/artifacts';
async function login(page:import('@playwright/test').Page,email:string){
 await page.goto('http://127.0.0.1:3001');
 await page.getByLabel('Email address').fill(email);
 await page.getByLabel('Password',{exact:true}).fill('local-browser-test-only');
 await page.getByRole('button',{name:'Sign in to GLITCH →'}).click();
}
test.beforeAll(async()=>{await mkdir(artifacts,{recursive:true});});
test('existing student saves and resumes personal work across logins',async({page})=>{
 await login(page,'student@glitch.test');
 await expect(page.getByRole('heading',{name:'Welcome back, QA.'})).toBeVisible();
 await page.screenshot({path:`${artifacts}/existing-student-dashboard.png`});
 await page.getByRole('link',{name:'My roadmap',exact:true}).click();
 await expect(page.getByRole('heading',{name:'See First. Explain Later.'})).toBeVisible();
 await page.screenshot({path:`${artifacts}/existing-student-roadmap.png`});
 await page.getByRole('link',{name:/Observe before you explain/}).click();
 await page.getByRole('button',{name:'Mark as complete →'}).click();
 await page.getByRole('link',{name:'Continue learning →'}).click();
 const answer='Observed five students in a queue; service speed needs measurement.';
 await page.getByLabel('Your work',{exact:true}).fill(answer);
 await page.getByRole('button',{name:'Save draft'}).click();
 await expect(page.getByText('Draft saved to your account')).toBeVisible();
 await page.reload();
 await expect(page.getByLabel('Your work',{exact:true})).toHaveValue(answer);
 await page.getByRole('button',{name:'Sign out ↗'}).click();
 await login(page,'student@glitch.test');
 await page.getByRole('link',{name:'My Work',exact:true}).click();
 await expect(page.getByText(answer)).toBeVisible();
});
test('existing administrator course management renders',async({page})=>{
 await login(page,'admin@glitch.test');
 await page.getByRole('link',{name:'Course management'}).click();
 await expect(page.getByRole('heading',{name:'Course management'})).toBeVisible();
 await page.screenshot({path:`${artifacts}/existing-admin.png`});
});
test('React admin application renders its login screen',async({page})=>{
 await page.goto('http://127.0.0.1:5173');
 await expect(page.getByRole('heading',{name:'Sign in to GLITCH'})).toBeVisible();
 await page.screenshot({path:`${artifacts}/m1-react-foundation.png`});
});
