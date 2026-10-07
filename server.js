const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(m => m.default(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MARKETAUX_KEY = process.env.MARKETAUX_API_KEY;

const cache = {};
function cached(key, ttl, fn){
  const c = cache[key];
  if(c && Date.now() - c.at < ttl) return Promise.resolve(c.val);
  return fn().then(val => { cache[key] = { val, at: Date.now() }; return val; });
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    services: { deriv: true, ai: !!GEMINI_KEY, news: !!MARKETAUX_KEY, calendar: true }
  });
});

app.post("/api/gemini", async (req, res) => {
  try{
    if(!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not set" });
    const { prompt, model } = req.body;
    const useModel = model || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, topP: 0.9, maxOutputTokens: 2048, responseMimeType: "application/json" }
      })
    });
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    res.json({ text });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/api/news", async (req, res) => {
  try{
    if(!MARKETAUX_KEY) return res.status(500).json({ error: "MARKETAUX_API_KEY not set" });
    const symbols = req.query.symbols || "EUR,USD,GBP,JPY,XAU";
    const limit = req.query.limit || 20;
    const key = "news_" + symbols + "_" + limit;
    const data = await cached(key, 15 * 60 * 1000, async () => {
      const url = `https://api.marketaux.com/v1/news/all?symbols=${symbols}&filter_entities=true&language=en&limit=${limit}&api_token=${MARKETAUX_KEY}`;
      const r = await fetch(url);
      return r.json();
    });
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/api/calendar", async (req, res) => {
  try{
    const path = req.query.path || "/today";
    const key = "cal_" + path;
    const data = await cached(key, 30 * 60 * 1000, async () => {
      const r = await fetch("https://www.financecalendar.com/wp-json/fc/v1" + path);
      return r.json();
    });
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("FX Sentinel proxy running on port " + PORT));
