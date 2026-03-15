const { webkit } = require('playwright');

(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));

  await page.goto('file:///Users/nere/Desktop/MAInD/Prototyping spatial experiences/Code test/v12/index.html');
  await page.waitForTimeout(2000);
  await browser.close();
})();
