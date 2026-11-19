import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const results = [];
  for (const [name, url] of [
    ["horr", "https://horr.framer.website/"],
    ["launch", "https://fair-league-209168.framer.app/"],
    ["gameplay", "https://fair-league-209168.framer.app/gameplay"],
  ]) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const detail = await page.evaluate(() => ({
      title: document.title,
      text: document.body.innerText.slice(0, 12000),
      fonts: [...document.querySelectorAll("h1,h2,h3,p,a,button")]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .slice(0, 70)
        .map((e) => {
          const s = getComputedStyle(e);
          return {
            text: e.textContent.slice(0, 90),
            font: s.fontFamily,
            size: s.fontSize,
            weight: s.fontWeight,
            tracking: s.letterSpacing,
            line: s.lineHeight,
            color: s.color,
          };
        }),
      links: [...document.querySelectorAll("a[href]")]
        .map((a) => ({ text: a.innerText, href: a.href }))
        .filter((a) => /gameplay/i.test(a.text)),
    }));
    results.push({ name, url, ...detail });
    await page.screenshot({ path: `artifacts/reference-${name}.png` });
    if (name === "launch") {
      const section = page.getByText("Gameplay", { exact: true }).last();
      if (await section.count()) {
        await section.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: "artifacts/reference-launch-gameplay.png",
        });
      }
    }
    console.log(name, detail.title, JSON.stringify(detail.fonts.slice(0, 12)));
    await page.goto("about:blank");
  }
  await writeFile(
    "artifacts/design-references.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
}
