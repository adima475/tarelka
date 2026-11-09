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

function firstThumb(html) {
  const s = html.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  // each result carries "thumb":{"url":"//avatars.mds.yandex.net/i?id=…","w":…}; the first one is result #1
  const m = s.match(/"thumb":\{"url":"(\/\/avatars\.mds\.yandex\.net\/i\?id=[^"]+)"/)
         || s.match(/"image":"(\/\/avatars\.mds\.yandex\.net\/i\?id=[^"]+)"/);
  return m ? "https:" + m[1] : null;
}

module.exports.handler = async function (event) {
  if ((event.httpMethod || "GET") === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const q = String((event.queryStringParameters || {}).q || "").trim().slice(0, 120);
  if (!q) return reply(400, { error: "no q" });
  if (cache.has(q)) return reply(200, { img: cache.get(q) }, { "Cache-Control": "public, max-age=604800" });

  const url = "https://yandex.ru/images/search?text=" + encodeURIComponent(q);
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
