import express from "express";
import Database from "better-sqlite3";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";
import path from "path";
import { createServer as createViteServer } from "vite";

dotenv.config();

const dbPath = process.env.VERCEL ? "/tmp/aml_monitor.db" : "aml_monitor.db";
let db: any;
try {
  db = new Database(dbPath);
  console.log(`>>> Database connected successfully at ${dbPath}.`);
} catch (error) {
  console.error(">>> CRITICAL: Failed to connect to database:", error);
  // In serverless, we might not want to exit, but the function will fail anyway
}

function removeAccents(str: string): string {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

if (db) {
  // Inicializar DB
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      subject TEXT,
      risk TEXT,
      crime TEXT,
      department TEXT,
      source TEXT,
      url TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(url, subject)
    );

    CREATE TABLE IF NOT EXISTS raw_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      title TEXT,
      url TEXT UNIQUE,
      source TEXT DEFAULT 'FGR',
      analyzed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS demo_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT,
      email TEXT,
      company TEXT,
      mode TEXT,
      device_id TEXT,
      activated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS demo_limits (
      device_id TEXT PRIMARY KEY,
      credits_left INTEGER DEFAULT 15,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS access_keys (
      key_value TEXT PRIMARY KEY,
      mode TEXT, -- 'demo', 'admin', 'full'
      description TEXT
    );

    -- Insert default keys if they don't exist
    INSERT OR IGNORE INTO access_keys (key_value, mode, description) VALUES ('demo2026', 'demo', 'Acceso Demo Pública');
    INSERT OR IGNORE INTO access_keys (key_value, mode, description) VALUES ('admin99', 'admin', 'Acceso Administración');
    INSERT OR IGNORE INTO access_keys (key_value, mode, description) VALUES ('corp77', 'full', 'Acceso Corporativo');
  `);

  // Migraciones básicas
  try { db.exec("ALTER TABLE news ADD COLUMN source TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE raw_news ADD COLUMN source TEXT DEFAULT 'FGR'"); } catch (e) {}
  try { db.exec("ALTER TABLE demo_usage ADD COLUMN email TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE demo_usage ADD COLUMN company TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE demo_usage ADD COLUMN mode TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE demo_usage ADD COLUMN device_id TEXT"); } catch (e) {}
}

const app = express();
app.use(express.json());

function getAI() {
  // Intentar obtener la llave de varias fuentes comunes
  let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
  
  // Limpiar la llave de posibles comillas o espacios accidentales
  if (apiKey) {
    apiKey = apiKey.trim().replace(/^["']|["']$/g, "");
  }

  const foundKeys = Object.keys(process.env).filter(k => k.includes("KEY") || k.includes("API"));

  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "" || apiKey.length < 10) {
    console.error(">>> ERROR: API Key no válida o no configurada.");
    console.log(">>> Variables de entorno detectadas:", foundKeys);
    
    const errorMsg = `API Key no configurada correctamente. 
      Detectadas: [${foundKeys.join(", ")}]. 
      Por favor, ve a Settings > Secrets y añade GEMINI_API_KEY con tu llave de Google AI Studio.`;
    
    throw new Error(errorMsg);
  }

  const maskedKey = `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
  console.log(`>>> Usando API Key: ${maskedKey} (Longitud: ${apiKey.length})`);

  return new GoogleGenAI({ apiKey });
}

// API Routes
app.get("/api/news", (req, res) => {
  const rows = db.prepare("SELECT * FROM news ORDER BY date DESC").all();
  res.json(rows);
});

app.get("/api/debug-env", (req, res) => {
  const keys = Object.keys(process.env).filter(k => k.includes("KEY") || k.includes("API") || k.includes("GEMINI"));
  res.json({ 
    detected_keys: keys,
    node_env: process.env.NODE_ENV,
    has_gemini_key: !!process.env.GEMINI_API_KEY
  });
});

app.post("/api/digital-search", async (req, res) => {
  const { fromDate, toDate } = req.body;
  
  try {
    const ai = getAI();
    const prompt = `Actúa como un experto en cumplimiento AML y analista de noticias de El Salvador. 
    Encuentra noticias RECIENTES en periódicos digitales salvadoreños entre el ${fromDate} y el ${toDate}.
    Busca capturas, procesos judiciales, estafas, lavado de dinero.
    EXCLUYE noticias de la FGR.
    Devuelve un JSON con una lista de noticias: title, url, date (YYYY-MM-DD), source.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            news: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING },
                  date: { type: Type.STRING },
                  source: { type: Type.STRING }
                },
                required: ["title", "url", "date", "source"]
              }
            }
          },
          required: ["news"]
        }
      }
    });

    if (!response.text) {
      throw new Error("El modelo no devolvió resultados.");
    }

    res.json(JSON.parse(response.text));
  } catch (error: any) {
    console.error(">>> Error en búsqueda digital:", error);
    // Extraer mensaje de error de Google si existe
    const errorMessage = error.message || "Error desconocido en la búsqueda";
    res.status(500).json({ error: errorMessage });
  }
});

app.post("/api/analyze-news", async (req, res) => {
  const { text, url } = req.body;
  
  try {
    const ai = getAI();
    const prompt = `Analiza la siguiente noticia judicial de El Salvador y extrae hallazgos de personas naturales mencionadas como acusadas, procesadas o capturadas.
    
    NOTICIA:
    ${text}
    
    URL: ${url}
    
    REGLAS:
    1. Solo extrae personas que sean SUJETOS de la investigación (acusados, capturados, procesados).
    2. NO extraigas fiscales, jueces, policías o víctimas.
    3. Para cada persona, determina el nivel de riesgo (ALTO si es lavado de dinero, narcotráfico o corrupción; MEDIO para otros delitos).
    4. Devuelve un JSON con: isRelevant (boolean), date (YYYY-MM-DD), findings (array de objetos con subject, crime, department, risk, content).`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isRelevant: { type: Type.BOOLEAN },
            date: { type: Type.STRING },
            findings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  subject: { type: Type.STRING },
                  crime: { type: Type.STRING },
                  department: { type: Type.STRING },
                  risk: { type: Type.STRING, enum: ["ALTO", "MEDIO", "BAJO"] },
                  content: { type: Type.STRING }
                },
                required: ["subject", "crime", "department", "risk"]
              }
            }
          },
          required: ["isRelevant"]
        }
      }
    });

    if (!response.text) {
      throw new Error("El modelo no devolvió resultados de análisis.");
    }

    res.json(JSON.parse(response.text));
  } catch (error: any) {
    console.error(">>> Error en análisis backend:", error);
    const errorMessage = error.message || "Error interno en el análisis";
    res.status(500).json({ error: errorMessage });
  }
});

app.get("/api/raw-news", (req, res) => {
  const rows = db.prepare("SELECT * FROM raw_news ORDER BY date DESC").all();
  res.json(rows);
});

app.post("/api/raw-news/mark-analyzed", (req, res) => {
  const { id } = req.body;
  try {
    db.prepare("UPDATE raw_news SET analyzed = 1 WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/raw-news/save", (req, res) => {
  const { date, title, url, source } = req.body;
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO raw_news (date, title, url, source)
      VALUES (?, ?, ?, ?)
    `);
    const result = insert.run(
      date, 
      removeAccents(title), 
      url, 
      removeAccents(source || 'Digital')
    );
    res.json({ success: true, ignored: result.changes === 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL required" });
  const targetUrl = (url as string).split('#')[0];
  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();
    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/news/save", (req, res) => {
  const { date, subject, risk, crime, department, source, url, content } = req.body;
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO news (date, subject, risk, crime, department, source, url, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      date, 
      removeAccents(subject), 
      risk, 
      removeAccents(crime), 
      removeAccents(department), 
      removeAccents(source || 'FGR'), 
      url, 
      removeAccents(content)
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/news/reset", (req, res) => {
  try {
    db.prepare("DELETE FROM news").run();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/raw-news/reset", (req, res) => {
  try {
    db.prepare("DELETE FROM raw_news").run();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/validate", (req, res) => {
  const { code, userInfo, deviceId } = req.body;
  try {
    const row = db.prepare("SELECT mode FROM access_keys WHERE key_value = ?").get(code);
    if (row) {
      // Record access
      db.prepare("INSERT INTO demo_usage (client_name, email, company, mode, device_id) VALUES (?, ?, ?, ?, ?)")
        .run(
          userInfo?.name || 'Anónimo', 
          userInfo?.email || '', 
          userInfo?.company || '', 
          row.mode,
          deviceId || null
        );

      // Handle demo credits if applicable
      if (row.mode === 'demo' && deviceId) {
        const existing = db.prepare("SELECT * FROM demo_limits WHERE device_id = ?").get(deviceId);
        if (!existing) {
          db.prepare("INSERT INTO demo_limits (device_id, credits_left) VALUES (?, 15)").run(deviceId);
        }
      }

      res.json({ success: true, mode: row.mode });
    } else {
      res.status(401).json({ success: false, error: "Código inválido" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/demo/activate", (req, res) => {
  const { clientName, deviceId } = req.body;
  try {
    db.prepare("INSERT INTO demo_usage (client_name) VALUES (?)").run(clientName || 'Anónimo');
    
    if (deviceId) {
      const existing = db.prepare("SELECT * FROM demo_limits WHERE device_id = ?").get(deviceId);
      if (!existing) {
        db.prepare("INSERT INTO demo_limits (device_id, credits_left) VALUES (?, 15)").run(deviceId);
      }
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/demo/credits", (req, res) => {
  const { deviceId } = req.query;
  try {
    const row = db.prepare("SELECT credits_left FROM demo_limits WHERE device_id = ?").get(deviceId);
    res.json({ creditsLeft: row ? row.credits_left : 15 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/demo/use-credit", (req, res) => {
  const { deviceId } = req.body;
  try {
    const row = db.prepare("SELECT credits_left FROM demo_limits WHERE device_id = ?").get(deviceId);
    const current = row ? row.credits_left : 15;
    const next = Math.max(0, current - 1);
    
    db.prepare("INSERT OR REPLACE INTO demo_limits (device_id, credits_left, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
      .run(deviceId, next);
      
    res.json({ success: true, creditsLeft: next });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/stats", (req, res) => {
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY && key !== 'admin123') {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const stats = db.prepare("SELECT * FROM demo_usage ORDER BY activated_at DESC").all();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/reset-demos", (req, res) => {
  const { key } = req.body;
  if (key !== process.env.ADMIN_KEY && key !== 'admin123' && key !== 'admin99') {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    db.prepare("DELETE FROM demo_limits").run();
    res.json({ success: true, message: "Todos los límites de demo han sido reseteados." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/scrape/list", async (req, res) => {
  const { dateFrom, dateTo, pageFrom, pageTo } = req.body;
  const fMin = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
  const fMax = dateTo ? new Date(dateTo + "T23:59:59") : new Date();
  
  const startPage = parseInt(pageFrom) || 1;
  const endPage = parseInt(pageTo) || 200;
  const batchSize = 5;

  try {
    const newsList: any[] = [];
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8,en-US;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/'
    };

    let stopScraping = false;

    for (let i = startPage; i <= endPage && !stopScraping; i += batchSize) {
      const currentBatch = [];
      for (let j = 0; j < batchSize && (i + j) <= endPage; j++) {
        currentBatch.push(i + j);
      }

      const batchResults = await Promise.all(currentBatch.map(async (p) => {
        try {
          const url = `https://www.fiscalia.gob.sv/sala-de-prensa/page/${p}/`;
          const response = await fetch(url, { headers });
          if (!response.ok) return { page: p, items: [], olderFound: true };
          const html = await response.text();
          
          const items = [];
          const blockRegex = /<div class="col-lg-8">([\s\S]+?)(?=<div class="col-lg-8"|class="pagination"|id="footer"|$)/g;
          let blockMatch;
          let olderFound = false;

          while ((blockMatch = blockRegex.exec(html)) !== null) {
            const block = blockMatch[1];
            const linkTitleRegex = /<a\s+href="([^"]+)"[^>]*>([\s\S]+?)<\/a>/;
            const ltMatch = linkTitleRegex.exec(block);
            if (!ltMatch) continue;

            const link = ltMatch[1];
            const title = ltMatch[2].replace(/<[^>]+>/g, ' ').trim();
            const dateRegex = /(?:\|\s*)?(\d{1,2}\s+[a-zA-Z]{3,}\s+\d{4})/;
            const dMatch = dateRegex.exec(block);
            if (!dMatch) continue;
            
            const itemDate = parseFGRDate(dMatch[1]);
            if (isNaN(itemDate.getTime())) continue;

            if (fMin && itemDate < fMin) olderFound = true;
            
            if ((!fMin || itemDate >= fMin) && itemDate <= fMax) {
              items.push({ url: link, title, date: itemDate.toISOString().split('T')[0] });
            }
          }
          return { page: p, items, olderFound };
        } catch (e) {
          return { page: p, items: [], olderFound: false };
        }
      }));

      for (const res of batchResults) {
        for (const item of res.items) {
          db.prepare(`INSERT OR IGNORE INTO raw_news (date, title, url) VALUES (?, ?, ?)`)
            .run(item.date, removeAccents(item.title), item.url);
          newsList.push(item);
        }
        if (res.olderFound && !pageTo) stopScraping = true;
      }
      if (stopScraping) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    res.json({ newsList });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function parseFGRDate(str: string) {
  const meses: any = {
    'ene':0, 'feb':1, 'mar':2, 'abr':3, 'may':4, 'jun':5, 
    'jul':6, 'ago':7, 'sep':8, 'oct':9, 'nov':10, 'dic':11,
    'enero':0, 'febrero':1, 'marzo':2, 'abril':3, 'mayo':4, 'junio':5,
    'julio':6, 'agosto':7, 'septiembre':8, 'octubre':9, 'noviembre':10, 'diciembre':11
  };
  const p = str.trim().split(/\s+/);
  if (p.length < 3) return new Date(NaN);
  const day = parseInt(p[0]);
  const monthStr = p[1].toLowerCase().replace(/[.,]/g, '');
  const year = parseInt(p[2]);
  const month = meses[monthStr] ?? meses[monthStr.substring(0, 3)];
  return new Date(year, month, day);
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:3000`);
  });
}

startServer();

export default app;
