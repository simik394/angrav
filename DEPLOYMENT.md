# Návod k nasazení: angrav-browser na server halvarm

> [!WARNING]
> **POZOR: `angrav` a `rsrch` jsou DVĚ ZCELA ODLIŠNÉ A SAMOSTATNÉ SLUŽBY!** 
> * **`angrav`** slouží k automatizaci agentů v Antigravity IDE (Windsurf).
> * **`rsrch`** slouží pro vyhledávací a podcastové workflow v headless prohlížeči.
> **Mají odlišné porty, odlišné konfigurace a odlišné Nomad joby! Nikdy je nezaměňujte!**

Tento návod popisuje kompletní a blbuvzdorný postup pro nasazení a správu `angrav-browser` na produkčním serveru `halvarm`. 

Projekt využívá automatizované nasazení **Git-Push-to-Nomad**. Kód se sestavuje přímo na serveru `halvarm`, což zamezuje přenášení obrovských Docker obrazů přes síť a zajišťuje maximální rychlost.

---

## 🏗️ 1. Architektura nasazení

Na serveru `halvarm` běží prohlížeč v izolovaném prostředí spravovaném přes **HashiCorp Nomad** jako job `angrav-browser` (**odlišná služba od `rsrch-browser`!**).

```
                     ┌───────────────────────────────────────┐
                     │            halvarm SERVER             │
                     │                                       │
                     │  ┌─────────────────────────────────┐  │
                     │  │      angrav-browser (Nomad)     │  │
                     │  │  - Xvfb :98 + fluxbox           │  │
                     │  │  - Antigravity IDE (GUI)        │  │
                     │  │  - x11vnc (port :5901)          │  │
                     │  │  - cdp proxy (port :9224)       │◄─┼── Spojení z klientských skriptů
                     │  └─────────────────────────────────┘  │
                     └───────────────────────────────────────┘
```

*   **VNC (Port 5901):** Umožňuje vizuální připojení k běžícímu IDE (např. pro přihlášení k Google účtu). **Pozor, `rsrch` běží na portu 5900 – jedná se o zcela odlišnou službu!**
*   **CDP Proxy (Port 9224):** Chrome DevTools Protocol port, přes který se připojují automatizační skripty a Windmill workery. **Pozor, `rsrch` používá port 9223 – jedná se o zcela odlišnou službu!**

---

## 🚀 2. První nastavení (Jednorázově)

Přidej produkční server jako git remote do svého lokálního repozitáře `/home/sim/Prods/01-pwf` (**ujisti se, že jsi v repozitáři angrav, ne rsrch! Jedná se o odlišné služby**):

```bash
git remote add prod ubuntu@halvarm:~/repos/angrav.git
```

---

## 🔄 3. Vývojový cyklus a nasazení (Git Push)

Kdykoliv chceš nasadit novou verzi do produkce:

1.  **Commitni své změny** lokálně.
2.  **Pushni do produkční větve** (**tento push ovlivní pouze službu `angrav`, nikoliv `rsrch`!**):
    ```bash
    git push prod tvoje-vetev:main
    ```
3.  **Co se stane na pozadí:**
    *   Server `halvarm` přijme změny přes git hook `post-receive`.
    *   Spustí se skript `scripts/deploy.sh` na serveru.
    *   Automaticky se sestaví `@agents/shared` knihovna.
    *   Nativně se sestaví produkční Docker obraz `angrav-browser:latest`.
    *   Obraz se nahraje do lokálního registru `localhost:5001`.
    *   Nomad job `angrav-browser` se restartuje s novým obrazem.

---

## 🔑 4. Synchronizace Google profilu (Autentizace)

Google na serverech blokuje automatické přihlašování. Pro úspěšné spuštění je nutné se přihlásit lokálně a profil přenést. **Profil pro `angrav` je zcela nezávislý na profilu pro `rsrch` (odlišné služby)!**

### Krok A: Lokální přihlášení
1. Spusť lokálně Chromium s prázdným profilem:
   ```bash
   mkdir -p /tmp/angrav-profile
   chromium-browser --user-data-dir=/tmp/angrav-profile "https://accounts.google.com"
   ```
2. Přihlas se ke svému Google účtu a plně projdi autorizací.
3. Prohlížeč kompletně zavři.

### Krok B: Přenos na server
Spusť připravený synchronizační skript ze složky `agents/shared` (**s prvním parametrem `angrav`, což skriptu řekne, že se jedná o tuto konkrétní odlišnou službu**):
```bash
./scripts/sync-profile.sh angrav /tmp/angrav-profile halvarm
```
*Tento skript automaticky zastaví běžící prohlížeč na serveru, vyčistí stará data, bezpečně synchronizuje profil přes rsync, opraví oprávnění a znovu nastartuje Nomad job.*

---

## 🛠️ 5. Údržba, diagnostika a příkazy

Všechny příkazy spouštěj ze svého lokálního terminálu pomocí SSH přístupu na `halvarm`. **Vždy ověřte, že manipulujete se službou `angrav-browser`, nikoliv s odlišnou službou `rsrch-browser`!**

*   **Kontrola stavu jobu:**
    ```bash
    ssh halvarm "nomad job status angrav-browser"
    ```
*   **Zobrazení logů prohlížeče:**
    ```bash
    ssh halvarm "nomad alloc logs -f -job angrav-browser"
    ```
*   **Ruční restartování prohlížeče:**
    ```bash
    ssh halvarm "nomad job restart angrav-browser"
    ```
*   **Kontrola volného místa na disku:**
    *(Důležité, halvarm má omezenou kapacitu!)*
    ```bash
    ssh halvarm "df -h"
    ```
*   **Vyčištění starých Docker vrstev:**
    *(Spusť, pokud dochází místo na disku)*
    ```bash
    ssh halvarm "docker system prune -f"
    ```

---

## 💻 6. Použití produkční CLI (angrav)

K interakci se službou lokálně už **nepoužívej** žádné vývojové příkazy jako `npx ts-node src/cli.ts`. Místo toho využij globálně nainstalovaný produkční nástroj `angrav`:

*   **Otevření VNC klienta:**
    ```bash
    angrav vnc
    ```
*   **Zjištění stavu:**
    ```bash
    angrav status
    ```
*(Poznámka: Pro správnou funkčnost musí být balíček nainstalován globálně přes `npm install -g .` v kořenové složce)*

---

## ⚠️ 6. Časté chyby a co NEDĚLAT

*   **❌ NIKDY nezaměňujte služby `angrav` a `rsrch`. Jedná se o naprosto odlišné služby s různými konfiguracemi.**
*   **❌ NIKDY neposílej Docker obrazy z lokálního počítače.** (Je to extrémně pomalé, build patří na server).
*   **❌ Nepoužívej `docker-compose` přímo na serveru `halvarm`.** (Správcem všech kontejnerů na halvarmu je výhradně Nomad).
*   **❌ Neměň ručně porty 9224 a 5901.** Tyto porty jsou pevně provázány se service discovery a sdíleným tab-poolem ostatních agentů.

