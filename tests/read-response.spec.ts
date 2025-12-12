import { test, chromium } from '@playwright/test';
import * as fs from 'fs';

test('Dump Antigravity chat to analyze response structure', async () => {
  console.log('🚀 Connecting to Antigravity...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('workbench.html'));

  if (!page) {
      throw new Error('Main workbench page not found');
  }

  console.log('✅ Connected to workbench.');

  // Find the agent frame
  const agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));
  if (!agentFrame) {
      throw new Error('Agent frame (cascade-panel.html) not found. Is the Agent view open?');
  }

  console.log('✅ Found Agent frame.');

  // Wait a bit to ensure everything is rendered
  await agentFrame.waitForLoadState('domcontentloaded');

  // Define the prompt we are looking for
  const promptText = "Hello, Antigravity agent!";

  // Find the LAST user message with this text
  // The structure is complex, so we look for the text and then find the container
  const userMessages = agentFrame.locator(`span[data-lexical-text="true"]:has-text("${promptText}")`);
  const count = await userMessages.count();
  
  if (count === 0) {
      throw new Error(`User message "${promptText}" not found in chat history.`);
  }

  // Get the last one
  const lastUserMessage = userMessages.nth(count - 1);
  console.log(`✅ Found ${count} user messages. targeting the last one.`);

  // We need to find the container of the user message to get the NEXT sibling (Agent response)
  // The user message is deep inside. We traverse up to the main message row.
  // Based on dump: <div class="flex w-full flex-row bg-ide-chat-background"> is the row
  const userMessageRow = lastUserMessage.locator('xpath=ancestor::div[contains(@class, "flex w-full flex-row bg-ide-chat-background")]');
  
  // The Agent response should be the NEXT sibling element in the list
  // The structure is flattened in the virtual list or container
  // Let's try to find the container of all messages first?
  // Or just use xpath following-sibling
  
  // XPath to find the next sibling div which contains the agent response
  // The agent response seems to be in <div class="flex flex-col">
  const agentResponseContainer = userMessageRow.locator('xpath=following-sibling::div[contains(@class, "flex flex-col")]').first();

  await agentResponseContainer.waitFor({ state: 'visible', timeout: 5000 });
  console.log('✅ Found Agent response container.');

  // --- Extract Thoughts ---
  const thoughtButton = agentResponseContainer.locator('button:has-text("Thought")');
  if (await thoughtButton.isVisible()) {
      console.log('🤔 Found "Thought" section. expanding...');
      await thoughtButton.click();
      
      // Wait for the thought content to be visible/expanded
      // The content is in a div that follows the button (roughly)
      // Look for the prose div inside the expanded area
      // The dump shows: <div class="pl-6 ..."> ... <div class="... prose ...">
      const thoughtContent = agentResponseContainer.locator('.pl-6 .prose');
      await thoughtContent.waitFor({ state: 'visible', timeout: 2000 });
      
      const thoughtText = await thoughtContent.innerText();
      console.log('\n--- 🧠 Agent Thoughts ---');
      console.log(thoughtText);
      console.log('-------------------------\n');
  } else {
      console.log('ℹ️ No "Thought" section found.');
  }

  // --- Extract Answer ---
  // The answer is in a .prose div that is NOT inside the .pl-6 (thought) container
  // We can select the last .prose in the container, or exclude the thought one
  // Based on dump, the answer is a direct child of the flex-col or similar
  
  // Let's find all .prose elements in the response container
  const proseElements = agentResponseContainer.locator('.prose');
  const proseCount = await proseElements.count();
  
  let answerText = "";
  
  if (proseCount > 0) {
      // If thoughts exist, the answer is likely the LAST prose element
      // If thoughts don't exist, it's likely the ONLY prose element
      // Or we can check if the prose is inside .pl-6
      
      const lastProse = proseElements.last();
      answerText = await lastProse.innerText();
  }

  console.log('--- 🤖 Agent Answer ---');
  console.log(answerText);
  console.log('-----------------------\n');

  await browser.close();
});
