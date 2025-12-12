import { test, expect, chromium } from '@playwright/test';

test('Antigravity IDE Startup Check', async () => {
  console.log('🚀 Připojuji se k běžící instanci Antigravity přes debugging port...');
  
  // Připojení k Electron aplikaci přes CDP
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  
  // Získáme existující kontexty (okna aplikace)
  const contexts = browser.contexts();
  if (contexts.length === 0) {
      throw new Error('Žádný browser context nenalezen. Běží aplikace správně?');
  }

  // Získáme první stránku z prvního kontextu
  // Electron aplikace má obvykle jedno hlavní okno, které je již otevřené
  const context = contexts[0];
  let page = context.pages()[0];

  if (!page) {
      // Pokud kontext nemá stránku (nepravděpodobné u hlavního okna), zkusíme počkat na event
      console.log('Stránka nenalezena, čekám na page event...');
      page = await context.waitForEvent('page');
  }

  console.log('✅ Připojeno k existujícímu oknu aplikace.');

  // 1. Navigace (pokud by bylo potřeba, ale primárně už jsme připojeni)
  // page.goto('') // V Electronu toto není potřeba, už jsme připojeni k existující instanci

  // 2. Čekání na jádro VS Code (Monaco Workbench)
  // Toto je nejspolehlivější indikátor, že IDE běží
  console.log('⏳ Čekám na inicializaci Workbench...');
  const workbench = page.locator('.monaco-workbench');
  await workbench.waitFor({ state: 'visible', timeout: 60000 });

  // 3. Kontrola specifických částí UI
  console.log('✅ Workbench nalezen via .monaco-workbench');

  // Status bar dole
  const statusBar = page.locator('.part.statusbar');
  await expect(statusBar).toBeVisible();
  console.log('✅ Status bar je viditelný');

  // Activity bar vlevo (ikony souborů, search atd.)
  // Používáme .first() nebo specifičtější selektor, protože existuje i auxiliary bar vpravo
  const activityBar = page.locator('.part.activitybar.left'); 
  await expect(activityBar).toBeVisible();
  console.log('✅ Activity bar je viditelný');

  // 4. Pořízení "důkazního" screenshotu
  await page.screenshot({ path: 'ide-state-electron.png', fullPage: false });
  console.log('📸 Screenshot uložen jako ide-state-electron.png');

  // Nyní se jen odpojíme. NEVOLAT page.close() - to by zavřelo okno aplikace!
  // browser.close() v režimu connectOverCDP funguje jako 'disconnect'
  await browser.close();
  console.log('🔌 Odpojeno od Antigravity (aplikace běží dál).');
});
