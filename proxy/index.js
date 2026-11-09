// Тарелка: dish photo lookup for the menu (Yandex Cloud Function, Node.js 22, entry point index.handler).
// GET ?q=<dish name>  →  {"img":"https://avatars.mds.yandex.net/i?id=…&n=13"}  (first Yandex Images result)
// The app cannot read Yandex Images itself (no CORS), so this function reads the results page and returns
// the first thumbnail address; the app then shows it with a plain <img>.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const cache = new Map();   // lives while the function instance is warm

const reply = (statusCode, obj, extra = {}) => ({ statusCode, headers: { ...CORS, ...extra }, body: JSON.stringify(obj) });

// Each result carries "thumb":{"url":"//avatars.mds.yandex.net/i?id=…"}. Results that are shop products
// (packaged goods: "shop_name"/"offer_url", or a store site) are skipped: we want a cooked dish.
const SHOP = /"shop_name"|"offer_url"|market\.yandex|ozon\.ru|wildberries|auchan|perekrestok|vkusvill|lavka|sbermarket|kuper\.ru|magnit/i;
function firstThumb(html) {
  const s = html.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const re = /"thumb":\{"url":"(\/\/avatars\.mds\.yandex\.net\/i\?id=[^"]+)"/g;
  const hits = []; let m;
  while ((m = re.exec(s))) hits.push({ url: m[1], at: m.index });
  // 1st choice: a photo from a recipe page (its title says «рецепт»), that is a cooked dish;
  // otherwise the first result that is not a shop product (shopScore is high for goods: 150+ vs 0–20 for articles)
  let fallback = null;
  for (let i = 0; i < hits.length && i < 30; i++) {
    const chunk = s.slice(hits[i].at, i + 1 < hits.length ? hits[i + 1].at : hits[i].at + 4000);
    const shop = SHOP.test(chunk) || +((chunk.match(/"shopScore":(\d+)/) || [])[1] || 0) >= 50;
    if (shop) continue;
    const title = (chunk.match(/"title":"([^"]*)/) || [])[1] || "";
    if (/рецепт|recipe|пошагов/i.test(title)) return "https:" + hits[i].url;
    if (!fallback) fallback = "https:" + hits[i].url;
  }
  return fallback;
}

module.exports.handler = async function (event) {
  if ((event.httpMethod || "GET") === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const q = String((event.queryStringParameters || {}).q || "").trim().slice(0, 120);
  if (!q) return reply(400, { error: "no q" });
  if (cache.has(q)) return reply(200, { img: cache.get(q) }, { "Cache-Control": "public, max-age=604800" });

  // same search as the app's «фото блюда» link, so the picture matches what that link shows
  const url = "https://yandex.ru/images/search?text=" + encodeURIComponent(q + " блюдо");
  let html;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(8000),
    });
    html = await r.text();
    if (/showcaptcha|captcha/i.test(r.url) || (!r.ok && /captcha/i.test(html))) return reply(503, { error: "captcha" });
  } catch (e) {
    return reply(502, { error: "fetch: " + e.message });
  }
  const img = firstThumb(html);
  if (!img) return reply(404, { error: /captcha/i.test(html) ? "captcha" : "not found" });
  if (cache.size > 500) cache.clear();
  cache.set(q, img);
  return reply(200, { img }, { "Cache-Control": "public, max-age=604800" });
};
