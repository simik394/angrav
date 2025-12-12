import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  /* Spustit testy v prohlížeči. */
  use: {
    /* Base URL - můžeme použít v testech jako relative path */
    baseURL: 'https://antigravity.google',

    /* Ignorovat chyby certifikátů pro lokální vývoj */
    ignoreHTTPSErrors: true,

    /* Sbírat trace při selhání pro ladění */
    trace: 'on-first-retry',

    /* Nastavení prohlížeče */
    launchOptions: {
        /* Zpomalení pro 'human-like' interakci, ale ne 5s */
        slowMo: 100,
    },
    
    /* IDE potřebuje větší okno */
    viewport: { width: 1920, height: 1080 },
  },
  
  /* Zvýšíme timeout pro testy na 60s kvůli pomalejšímu startu aplikace */
  timeout: 60000,

  /* Konfigurace projektů - použijeme Chrome/Chromium */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
