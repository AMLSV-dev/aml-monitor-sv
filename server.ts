import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config();

const dbPath = process.env.VERCEL ? "/tmp/aml_monitor.db" : "aml_monitor.db";
let db;
try {
  db = new Database(dbPath);
  console.log(`>>> Database connected successfully at ${dbPath}.`);
} catch (error) {
  console.error(">>> CRITICAL: Failed to connect to database:", error);
  process.exit(1);
}

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
    activated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migración para agregar columna 'source' si no existe
try {
  db.exec("ALTER TABLE news ADD COLUMN source TEXT");
} catch (e) {
  // Ya existe
}

// Migración para agregar columna 'source' si no existe en raw_news
try {
  db.exec("ALTER TABLE raw_news ADD COLUMN source TEXT DEFAULT 'FGR'");
} catch (e) {
  // Ya existe
}

// Migración para permitir múltiples sujetos por URL si existe la restricción vieja
try {
  const indexList = db.prepare("PRAGMA index_list(news)").all();
  const hasOldUrlUnique = indexList.some((idx: any) => {
    if (idx.unique === 1 && idx.origin === 'u') {
      const info = db.prepare(`PRAGMA index_info('${idx.name}')`).all();
      const hasSubject = info.some((col: any) => col.name === 'subject');
      return !hasSubject;
    }
    return false;
  });
  
  if (hasOldUrlUnique) {
    console.log("Migrando tabla 'news' para soportar múltiples sujetos...");
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE news_new (
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
      INSERT OR IGNORE INTO news_new (date, subject, risk, crime, department, source, url, content, created_at)
      SELECT date, subject, risk, crime, department, source, url, content, created_at FROM news;
      DROP TABLE news;
      ALTER TABLE news_new RENAME TO news;
      COMMIT;
    `);
  }
} catch (e) {
  console.log("No se requirió migración o la tabla aún no existe.");
}

export const app = express();
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// API: Obtener noticias guardadas (analizadas)
app.get("/api/news", (req, res) => {
  const rows = db.prepare("SELECT * FROM news ORDER BY date DESC").all();
  res.json(rows);
});

// API: Obtener noticias crudas (sin analizar)
app.get("/api/raw-news", (req, res) => {
  const rows = db.prepare("SELECT * FROM raw_news ORDER BY date DESC").all();
  res.json(rows);
});

// API: Marcar noticia cruda como analizada
app.post("/api/raw-news/mark-analyzed", (req, res) => {
  const { id } = req.body;
  try {
    db.prepare("UPDATE raw_news SET analyzed = 1 WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Guardar noticia cruda (desde búsqueda digital)
app.post("/api/raw-news/save", (req, res) => {
  const { date, title, url, source } = req.body;
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO raw_news (date, title, url, source)
      VALUES (?, ?, ?, ?)
    `);
    const result = insert.run(date, title, url, source || 'Digital');
    res.json({ success: true, ignored: result.changes === 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Proxy para evitar CORS al leer contenido de noticias
app.get("/api/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL required" });
  
  const targetUrl = (url as string).split('#')[0];
  console.log(`>>> Proxy request to: ${targetUrl}`);

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8,en-US;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/'
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    const response = await fetch(targetUrl, { headers, signal: controller.signal });
    clearTimeout(timeoutId);

    console.log(`>>> Proxy response status: ${response.status} for ${targetUrl}`);

    if (response.status === 403) {
      console.error(`>>> Access Forbidden (403) for ${targetUrl}. Likely bot protection.`);
    }

    const html = await response.text();
    res.send(html);
  } catch (error: any) {
    console.error(`>>> Proxy error for ${targetUrl}:`, error.message);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: "Target URL timeout" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// API: Guardar noticia procesada desde el frontend
app.post("/api/news/save", (req, res) => {
  const { date, subject, risk, crime, department, source, url, content } = req.body;
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO news (date, subject, risk, crime, department, source, url, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(date, subject, risk, crime, department, source || 'FGR', url, content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Resetear hallazgos
app.post("/api/news/reset", (req, res) => {
  console.log(">>> POST /api/news/reset received");
  try {
    const result = db.prepare("DELETE FROM news").run();
    console.log(`>>> Deleted ${result.changes} rows from news.`);
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    console.error(">>> Error resetting news:", error);
    res.status(500).json({ error: error.message });
  }
});

// API: Resetear bandeja intermedia
app.post("/api/raw-news/reset", (req, res) => {
  console.log(">>> POST /api/raw-news/reset received");
  try {
    const result = db.prepare("DELETE FROM raw_news").run();
    console.log(`>>> Deleted ${result.changes} rows from raw_news.`);
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    console.error(">>> Error resetting raw_news:", error);
    res.status(500).json({ error: error.message });
  }
});

// API: Registrar activación de demo
app.post("/api/demo/activate", (req, res) => {
  const { clientName } = req.body;
  try {
    db.prepare("INSERT INTO demo_usage (client_name) VALUES (?)").run(clientName || 'Anónimo');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Obtener estadísticas de demo (Admin)
app.get("/api/admin/stats", (req, res) => {
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY && key !== 'admin123') {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const stats = db.prepare("SELECT * FROM demo_usage ORDER BY activated_at DESC").all();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Obtener lista de URLs para procesar
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
      'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/'
    };

    let stopScraping = false;

    for (let i = startPage; i <= endPage && !stopScraping; i += batchSize) {
      const currentBatch = [];
      for (let j = 0; j < batchSize && (i + j) <= endPage; j++) {
        currentBatch.push(i + j);
      }

      console.log(`Scraping batch: ${currentBatch.join(", ")}`);

      const batchResults = await Promise.all(currentBatch.map(async (p) => {
        try {
          const url = `https://www.fiscalia.gob.sv/sala-de-prensa/page/${p}/`;
          const response = await fetch(url, { headers });
          if (!response.ok) return { page: p, items: [], olderFound: true };
          const html = await response.text();
          console.log(`Scraping page ${p}, HTML length: ${html.length}`);
          
          const items = [];
          // Regex más flexible para capturar el bloque de cada noticia
          const blockRegex = /<div class="col-lg-8">([\s\S]+?)(?=<div class="col-lg-8"|class="pagination"|id="footer"|$)/g;
          let blockMatch;
          let blocksFound = 0;
          let olderFound = false;

          while ((blockMatch = blockRegex.exec(html)) !== null) {
            blocksFound++;
            const block = blockMatch[1];
            const linkTitleRegex = /<a\s+href="([^"]+)"[^>]*>([\s\S]+?)<\/a>/;
            const ltMatch = linkTitleRegex.exec(block);
            if (!ltMatch) continue;

            const link = ltMatch[1];
            // Limpiar el título de tags HTML
            const title = ltMatch[2].replace(/<[^>]+>/g, ' ').trim();
            
            // Regex para fecha: busca el patrón DD Mes YYYY
            const dateRegex = /(?:\|\s*)?(\d{1,2}\s+[a-zA-Z]{3,}\s+\d{4})/;
            const dMatch = dateRegex.exec(block);
            
            if (!dMatch) continue;
            const dateStr = dMatch[1];

            const itemDate = parseFGRDate(dateStr);
            if (isNaN(itemDate.getTime())) continue;

            if (fMin && itemDate < fMin) {
              olderFound = true;
              // No hacemos continue aquí para procesar si hay noticias mezcladas, 
              // pero marcamos que encontramos noticias antiguas.
            }
            
            if ((!fMin || itemDate >= fMin) && itemDate <= fMax) {
              items.push({ 
                url: link, 
                title, 
                date: itemDate.toISOString().split('T')[0] 
              });
            }
          }
          console.log(`Page ${p}: Found ${blocksFound} blocks, ${items.length} valid items.`);
          return { page: p, items, olderFound };
        } catch (e) {
          console.error(`Error on page ${p}:`, e);
          return { page: p, items: [], olderFound: false };
        }
      }));

      for (const res of batchResults) {
        for (const item of res.items) {
          db.prepare(`
            INSERT OR IGNORE INTO raw_news (date, title, url) 
            VALUES (?, ?, ?)
          `).run(item.date, item.title, item.url);
          newsList.push(item);
        }
        // Si una página entera tiene items más viejos que el rango, y no estamos forzando un rango de páginas, podríamos parar.
        // Pero si el usuario dio un rango de páginas, respetamos el rango.
        if (res.olderFound && !pageTo) {
          stopScraping = true;
        }
      }

      if (stopScraping) break;
      // Pequeño delay entre batches para no ser bloqueados
      await new Promise(r => setTimeout(r, 1000));
    }

    res.json({ newsList });
  } catch (error) {
    console.error("Scrape List Error:", error);
    res.status(500).json({ error: error.message });
  }
});

if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

if (!process.env.VERCEL) {
  app.listen(3000, "0.0.0.0", () => {
    console.log("Server running on http://localhost:3000");
  });
}

export default app;

function parseFGRDate(str: string) {
  const meses = {
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
