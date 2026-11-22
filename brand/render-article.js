// Renders the X article images in both themes: night (article.html as is) and golden hour
// (same layout, colours swapped to the light palette, light map).
const { chromium } = require("playwright");
const fs = require("fs");
const dir = "/home/user/vice/brand";
const swap = {
  "0b1634": "fff3e4", "fff0f6": "2a0f22", "2a1250": "ffdcc4", "3a1670": "ffc7a6", "7b2ff7": "ff9a5c",
  "f5c451": "a87a12", "ff8a4c": "c2541f", "b8f04a": "5a8a10", "3fd9f5": "0f86a3", "3ff5ff": "0f8a9a",
  "ff4f8b": "e0336f", "8a7bb8": "8a5a6e", "b3a6e0": "8a5a6e", "101639": "fff3e4",
};
const dark = fs.readFileSync(`${dir}/article.html`, "utf8");
const light = dark
  .replace(/#([0-9a-fA-F]{6})/g, (m, h) => (swap[h.toLowerCase()] ? "#" + swap[h.toLowerCase()] : m))
  .replace(/#0008/g, "#5b234026")
  .replace(/map-clean\.png/g, "map-clean-light.png");
fs.writeFileSync(`${dir}/article-light.html`, light);
(async () => {
  const b = await chromium.launch();
  const pg = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
  for (const [file, suffix] of [["article.html", ""], ["article-light.html", "-light"]]) {
    await pg.goto(`file://${dir}/${file}`, { waitUntil: "networkidle" });
    await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(800);
    for (const id of ["cover", "districts", "flow", "hideout", "grow", "sunday", "trust"])
      await pg.locator("#" + id).screenshot({ path: `${dir}/article-${id}${suffix}.png` });
  }
  await b.close();
})();
