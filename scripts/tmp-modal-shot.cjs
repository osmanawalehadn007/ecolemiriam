// Diagnostic temporaire : styles calculés de la modale + dropdown.
const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  try {
    await page.goto("http://127.0.0.1:3000/login/modal-test", {
      waitUntil: "commit",
      timeout: 60000,
    });
  } catch {}
  await page.waitForTimeout(8000);

  const info = await page.evaluate(() => {
    const out = {};
    const content = document.querySelector("[data-radix-dialog-content]");
    out.dialogPresent = !!content;
    if (content) {
      const cs = getComputedStyle(content);
      out.dialog = {
        backgroundColor: cs.backgroundColor,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        position: cs.position,
        transform: cs.transform,
        className: content.className.slice(0, 200),
      };
    }
    const overlay = document.querySelector("[data-radix-dialog-overlay]");
    out.overlayPresent = !!overlay;
    if (overlay) {
      const cs = getComputedStyle(overlay);
      out.overlay = { backgroundColor: cs.backgroundColor, zIndex: cs.zIndex };
    }
    // La classe bg-background est-elle bien définie dans le CSS chargé ?
    let bgBackgroundRule = null;
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === ".bg-background") {
            bgBackgroundRule = rule.cssText;
          }
        }
      } catch {}
    }
    out.bgBackgroundRule = bgBackgroundRule;
    const rootCs = getComputedStyle(document.documentElement);
    out.cssVarBackground = rootCs.getPropertyValue("--background");
    return out;
  });
  console.log(JSON.stringify(info, null, 2));

  // Tenter d'ouvrir le dropdown du select (post-hydration)
  const triggers = page.locator("[data-radix-select-trigger]");
  const n = await triggers.count();
  console.log("triggers:", n);
  if (n > 0) {
    await triggers.first().click();
    await page.waitForTimeout(800);
    const selInfo = await page.evaluate(() => {
      const sc = document.querySelector("[data-radix-select-content]");
      if (!sc) return { selectContent: false };
      const cs = getComputedStyle(sc);
      return {
        selectContent: true,
        backgroundColor: cs.backgroundColor,
        zIndex: cs.zIndex,
        position: cs.position,
      };
    });
    console.log("select:", JSON.stringify(selInfo));
    await page.screenshot({ path: "/tmp/modal-select-open.png" });
  }
  await browser.close();
})();
