import { test, expect, chromium } from '@playwright/test';

test('Submit prompt to Antigravity agent', async () => {
  console.log('🚀 Připojuji se k běžící instanci Antigravity přes debugging port...');
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  if (contexts.length === 0) {
      throw new Error('No browser context found. Is the application running correctly?');
  }

  const context = contexts[0];
  
  // Debug: Log all pages
  console.log(`Context has ${context.pages().length} pages.`);
  for (const p of context.pages()) {
    console.log(` - Page title: "${await p.title()}", URL: "${p.url()}"`);
  }

  // Select the correct page (the one with 'workbench.html' in URL)
  let page = context.pages().find(p => p.url().includes('workbench.html'));

  if (!page) {
      console.log('Main workbench page not found among existing pages. Waiting for a new page...');
      // Fallback: wait for a new page if none match, though unlikely given the log
      page = await context.waitForEvent('page');
  }

  console.log(`✅ Connected to target application window: "${await page.title()}"`);
  console.log(`   URL: "${page.url()}"`);

  // Take a debug screenshot to see what's going on
  await page.screenshot({ path: 'debug-initial-state.png' });
  console.log('📸 Debug screenshot saved: debug-initial-state.png');

  // Wait for the Monaco Workbench to be visible
  console.log('⏳ Waiting for Workbench initialization...');
  const workbench = page.locator('.monaco-workbench');
  await workbench.waitFor({ state: 'visible', timeout: 60000 });
  console.log('✅ Workbench found via .monaco-workbench');

  // Debug: Dump HTML to find selectors
  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync('page_dump.html', html);
  console.log('📄 Page HTML dumped to page_dump.html');
  await page.screenshot({ path: 'debug-workbench-loaded.png' });

  // --- Agent interaction ---
  
  // 1. Open the Agent view if it's not already visible
  // We use the toggle button found in the dump
  console.log('⏳ looking for "Toggle Agent" button...');
  const toggleAgentBtn = page.locator('[aria-label="Toggle Agent (Ctrl+Alt+B)"]');
  if (await toggleAgentBtn.isVisible()) {
      await toggleAgentBtn.click();
      console.log('✅ Clicked "Toggle Agent" button.');
      // Give it time to open/render
      await page.waitForTimeout(2000); 
  } else {
      console.log('⚠️ "Toggle Agent" button not found. View might be already open or selector is wrong.');
  }

  // 2. Find the chat input
  // It might be in an iframe (Webview)
  console.log('⏳ Looking for agent chat input (checking main page and frames)...');
  
  let chatInput = page.locator('textarea:not(.xterm-helper-textarea)').first();
  let found = false;

  // Check frames
  console.log(`Checking ${page.frames().length} frames...`);
  const agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));
  
  if (agentFrame) {
      console.log('✅ Found Agent frame: cascade-panel.html');
      
      // Wait for frame content
      try {
        await agentFrame.waitForLoadState('domcontentloaded');
      } catch (e) {
        console.log('⚠️ Warning: Frame load state wait failed or timed out, proceeding anyway...');
      }

      // Dump frame content
      const fs = require('fs');
      fs.writeFileSync('frame_dump.html', await agentFrame.content());
      console.log('📄 Frame HTML dumped to frame_dump.html');

      // Try multiple selectors
      // We found it is a div with contenteditable="true" and data-lexical-editor="true"
      const frameInput = agentFrame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();
      try {
        await frameInput.waitFor({ state: 'visible', timeout: 5000 });
        console.log('✅ Found chat input in Agent frame!');
        chatInput = frameInput;
        found = true;
      } catch (e) {
          console.log('❌ Input element not visible in frame yet.');
      }
  } else {
      console.log('❌ Agent frame not found in page.frames() list.');
  }

  if (!found) {
      // Dump frames structure for debugging
       console.log('❌ Chat input not found in any frame. Dumping frame URLs:');
       page.frames().forEach(f => console.log(f.url()));
       throw new Error('Chat input not found');
  }

  const prompt = 'Hello, Antigravity agent!';
  await chatInput.fill(prompt);
  console.log(`💬 Typed prompt: "${prompt}"`);

  // 3. Send the message
  await chatInput.press('Enter');
  console.log('✅ Pressed Enter to send.');

  // Wait for some indication that the message was sent or a response is coming
  console.log('⏳ Waiting for message to appear in chat history...');
  
  // Look for the text in the frame, but NOT in the input
  // We can look for a div that contains the text
  const messageInChat = agentFrame.locator(`text="${prompt}"`).first();
  await messageInChat.waitFor({ state: 'visible', timeout: 10000 });
  
  console.log('✅ Message found in chat history! Success.');

  await browser.close();
  console.log('🔌 Disconnected from Antigravity (application still running).');
});
