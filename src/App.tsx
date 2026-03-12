import { useState, useEffect, useRef } from "react";
import { 
  Shield, 
  RefreshCw, 
  MapPin, 
  ExternalLink,
  Database,
  FileText,
  Table as TableIcon,
  Square,
  BookOpen,
  Terminal
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

import { ManualModal } from './components/ManualModal';
import { ErrorLogModal } from './components/ErrorLogModal';

interface NewsItem {
  id: number;
  date: string;
  subject: string;
  risk: string;
  crime: string;
  department: string;
  source: string;
  url: string;
  content: string;
}

interface RawNewsItem {
  id: number;
  date: string;
  title: string;
  url: string;
  source?: string;
  analyzed: number;
}

export default function App() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [rawNews, setRawNews] = useState<RawNewsItem[]>([]);
  const [viewMode, setViewMode] = useState<'analyzed' | 'raw'>('raw');
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [selectedRawIds, setSelectedRawIds] = useState<number[]>([]);
  const [scrapeProgress, setScrapeProgress] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [searchSource, setSearchSource] = useState<'fgr' | 'digital'>('fgr');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [modal, setModal] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [demoResultsLeft, setDemoResultsLeft] = useState(15);
  const [demoExpiry, setDemoExpiry] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>("");
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [errorLog, setErrorLog] = useState<string[]>([]);
  const stopSignal = useRef(false);

  const addErrorLog = (msg: string) => {
    setErrorLog(prev => [new Date().toLocaleTimeString() + ": " + msg, ...prev].slice(0, 50));
    setIsErrorModalOpen(true);
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchNews = async () => {
    console.log("[App] fetchNews started");
    setLoading(true);
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      console.log("[App] fetchNews data received:", data.length);
      setNews(data);
    } catch (err: any) {
      console.error("[App] fetchNews error:", err);
      addErrorLog("Error cargando hallazgos: " + err.message);
      showToast("Error al cargar hallazgos AML", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchRawNews = async () => {
    console.log("[App] fetchRawNews started");
    setLoading(true);
    try {
      const res = await fetch("/api/raw-news");
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      console.log("[App] fetchRawNews data received:", data.length);
      setRawNews(data);
    } catch (err: any) {
      console.error("[App] fetchRawNews error:", err);
      addErrorLog("Error cargando bandeja: " + err.message);
      showToast("Error al cargar bandeja de noticias", "error");
    } finally {
      setLoading(false);
    }
  };

  const startScrape = async () => {
    if (searchSource === 'fgr') {
      await startFGRScrape();
    } else {
      await startDigitalSearch();
    }
  };

  const startFGRScrape = async () => {
    if (!dateFrom) {
      showToast("Por favor selecciona una fecha inicial para el monitoreo.", "error");
      return;
    }
    setScraping(true);
    stopSignal.current = false;
    setScrapeProgress("Extrayendo noticias de la FGR...");
    
    try {
      const listRes = await fetch("/api/scrape/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, pageFrom: 1 })
      });
      const { newsList } = await listRes.json();

      if (!newsList || newsList.length === 0) {
        setScrapeProgress("No se encontraron noticias nuevas en este rango.");
      } else {
        setScrapeProgress(`Se extrajeron ${newsList.length} noticias a la base intermedia.`);
        await fetchRawNews();
      }
      
      setTimeout(() => setScrapeProgress(""), 4000);
    } catch (err) {
      console.error(err);
      setScrapeProgress("Error en la extracción.");
    } finally {
      setScraping(false);
    }
  };

  const startDigitalSearch = async () => {
    setScraping(true);
    setScrapeProgress("Buscando en medios digitales de El Salvador...");
    
    const today = new Date().toISOString().split('T')[0];
    const fromDate = dateFrom || '2026-03-01';
    const toDate = dateTo || today;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const prompt = `Actúa como un experto en cumplimiento AML y analista de noticias de El Salvador. 
      Tu objetivo es encontrar noticias RECIENTES en los principales periódicos digitales salvadoreños entre el ${fromDate} y el ${toDate}.
      
      MISIÓN: Encontrar el mayor número posible de noticias (mínimo 15-20) sobre capturas, procesos judiciales, investigaciones fiscales, condenas o hechos delictivos.
      
      REGLA CRÍTICA: EXCLUYE noticias de la Fiscalía General de la República (FGR) o su sitio web oficial, ya que se procesan por separado. Solo busca en periódicos independientes.
      
      INSTRUCCIONES DE BÚSQUEDA OBLIGATORIAS:
      1. Realiza MÚLTIPLES búsquedas en Google para cubrir diferentes medios y temas.
      2. Medios a cubrir: La Prensa Gráfica (laprensagrafica.com), El Diario de Hoy (elsalvador.com), El Mundo (elmundo.sv), Diario El Salvador (diarioelsalvador.com).
      3. Temas y palabras clave: "capturas", "estafa", "lavado de dinero", "narcotráfico", "agrupaciones ilícitas", "corrupción", "boletos aéreos falsos", "acusado", "procesado", "condenado".
      4. Ejemplo de búsquedas efectivas:
         - "noticias capturas El Salvador marzo 2026"
         - "site:laprensagrafica.com judicial marzo 2026"
         - "site:elsalvador.com estafa boletos"
         - "site:elmundo.sv capturado marzo 2026"
         - "estafas boletos aéreos El Salvador 2026"
      
      REQUISITOS DE SALIDA:
      1. Devuelve una lista EXTENSA de noticias. No te detengas en 2 o 3.
      2. Solo devuelve noticias con URL directa y válida. 
      3. IMPORTANTE: La URL debe ser la URL ORIGINAL del periódico, NO una URL de búsqueda de Google ni una URL inventada.
      4. Si no estás seguro de la URL exacta de una noticia, NO la incluyas. Es mejor tener 10 noticias con links que funcionen que 20 con links rotos.
      5. El campo "source" DEBE ser el nombre del periódico.
      6. Devuelve un JSON con una lista de noticias: title, url, date (YYYY-MM-DD), source.
      
      ADVERTENCIA: No inventes estructuras de URL como "/judicial/titulo-noticia" ni adivines categorías. Solo usa las URLs EXACTAS que aparezcan en los resultados de búsqueda de Google. Si el resultado de búsqueda muestra una URL, úsala tal cual.`;

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
            }
          }
        }
      });

      const data = JSON.parse(response.text || '{"news": []}');
      const foundNews = (data.news || []).filter((n: any) => {
        return n.url && 
               n.url.startsWith('http') && 
               n.url.includes('.') && 
               !n.url.includes('google.com/search') &&
               n.url.length > 15;
      });
      console.log(`[Digital Search] AI encontró ${foundNews.length} noticias válidas.`);
      
      // Filtrar noticias institucionales de la FGR que no son relevantes para esta sección
      const filteredNews = foundNews.filter((item: any) => {
        const lowerTitle = item.title.toLowerCase();
        const lowerUrl = item.url.toLowerCase();
        const isFGR = lowerTitle.includes("fgr") || lowerTitle.includes("fiscalía") || lowerUrl.includes("fiscalia.gob.sv");
        const isInstitutional = lowerTitle.includes("inaugura") || 
                                lowerTitle.includes("convenio") || 
                                lowerTitle.includes("firma") || 
                                lowerTitle.includes("discurso") || 
                                lowerTitle.includes("comunicado") ||
                                lowerTitle.includes("institucional");
        return !(isFGR && isInstitutional) && !lowerUrl.includes("fiscalia.gob.sv");
      });

      if (filteredNews.length > 0) {
        setScrapeProgress(`Procesando ${filteredNews.length} noticias encontradas...`);
        
        let savedCount = 0;
        // Save to raw_news
        for (const item of filteredNews) {
          const res = await fetch("/api/raw-news/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: item.date,
              title: item.title,
              url: item.url,
              source: item.source
            })
          });
          const result = await res.json();
          if (result.success && !result.ignored) {
            savedCount++;
          }
        }
        
        await fetchRawNews();
        setScrapeProgress(`Se añadieron ${filteredNews.length} noticias a la bandeja (incluyendo duplicados).`);
      } else {
        setScrapeProgress("No se encontraron noticias relevantes en medios digitales.");
      }
      
      setTimeout(() => setScrapeProgress(""), 4000);
    } catch (err: any) {
      console.error(err);
      addErrorLog("Error en búsqueda digital: " + err.message);
      setScrapeProgress("Error en la búsqueda digital.");
    } finally {
      setScraping(false);
    }
  };

  const analyzeManualUrl = async () => {
    if (!manualUrl) {
      showToast("Ingresa una URL válida para analizar.", "error");
      return;
    }

    setAnalyzing(true);
    setScrapeProgress("Analizando URL proporcionada...");
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || "" });
      
      let textToAnalyze = "";
      let useUrlContext = false;

      try {
        const contentRes = await fetch(`/api/proxy?url=${encodeURIComponent(manualUrl)}`);
        if (contentRes.ok) {
          const html = await contentRes.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('script, style, nav, footer, header, aside, .sidebar, .footer, .header, .ads, .publicidad, .social-share').forEach(el => el.remove());
          const mainContent = doc.querySelector('.entry-content, .post-content, article, .col-lg-8, #content, .content, .article-body, .news-content, .cuerpo-nota, .nota-body, .article-content, .text-content, .story-body, .article-body');
          textToAnalyze = mainContent 
            ? (mainContent.textContent || "").replace(/\s+/g, ' ').trim()
            : (doc.body.textContent || "").replace(/\s+/g, ' ').trim();
        }
      } catch (proxyError) {
        console.warn("[Manual] Error de proxy:", proxyError);
      }

      if (!textToAnalyze || textToAnalyze.length < 150) {
        console.warn("[Manual] Contenido insuficiente o bloqueado. Usando herramientas de búsqueda.");
        useUrlContext = true;
        textToAnalyze = `IMPORTANTE: El contenido de esta noticia no pudo ser extraído directamente. 
        DEBES utilizar tus herramientas (urlContext o googleSearch) para acceder a la noticia en: ${manualUrl} 
        y extraer la información solicitada.`;
      }
      
      const cleanText = textToAnalyze.substring(0, 10000);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `SISTEMA DE EXTRACCIÓN JUDICIAL - EL SALVADOR (ANÁLISIS MANUAL)
        
        URL: ${manualUrl}
        TEXTO: ${cleanText}
        
        MISIÓN:
        Extraer a las personas mencionadas en la noticia como acusadas, capturadas, detenidas, procesadas, investigadas o condenadas.
        Si la noticia NO contiene un hecho delictivo, captura o proceso judicial, devuelve un JSON con "isRelevant": false.
        
        REGLAS CRÍTICAS:
        1. IDENTIFICACIÓN: Captura nombres y apellidos. Si solo aparece un alias o nombre parcial, extráelo también.
        2. DEPARTAMENTOS: El departamento DEBE ser uno de los 14 de El Salvador.
        3. NO FILTRAR POR DELITO: Extrae a la persona sin importar si el delito es grave o leve.
        4. RIESGO: 
           - ALTO: Pandillas, Narcotráfico, Lavado, Corrupción, Homicidio, Extorsión, Estafas Masivas (> $10k).
           - MEDIO: Cualquier otro delito (Estafa, Hurto, etc.).`,
        config: {
          tools: useUrlContext ? [{ urlContext: {} }, { googleSearch: {} }] : undefined,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isRelevant: { type: Type.BOOLEAN },
              date: { type: Type.STRING },
              subject: { type: Type.STRING, description: "Nombre y apellido de la persona. NO usar descripciones genéricas." },
              risk: { type: Type.STRING, enum: ["ALTO", "MEDIO", "BAJO"] },
              crime: { type: Type.STRING },
              department: { type: Type.STRING, description: "Uno de los 14 departamentos de El Salvador en MAYÚSCULAS." },
              source: { type: Type.STRING },
              content: { type: Type.STRING, description: "Título breve de la noticia" }
            },
            required: ["isRelevant"]
          }
        }
      });

      const result = JSON.parse(response.text || "{}");
      if (result.isRelevant) {
        await fetch("/api/news/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: result.date || new Date().toISOString().split('T')[0],
            subject: result.subject,
            risk: result.risk,
            crime: result.crime,
            department: result.department,
            source: result.source || "Manual",
            url: manualUrl,
            content: result.content
          })
        });
        showToast("Noticia analizada y guardada con éxito.");
        setManualUrl("");
        await fetchNews();
        setViewMode('analyzed');
      } else {
        showToast("La noticia no parece contener información judicial relevante.", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error al analizar la URL.", "error");
    } finally {
      setAnalyzing(false);
      setScrapeProgress("");
    }
  };

  const analyzeNews = async () => {
    let pending: RawNewsItem[] = [];
    
    if (selectedRawIds.length > 0) {
      pending = rawNews.filter(n => selectedRawIds.includes(n.id) && !n.analyzed);
    } else {
      pending = rawNews.filter(n => n.analyzed === 0);
    }

    if (pending.length === 0) {
      showToast("Selecciona noticias pendientes en la bandeja para analizarlas.", "error");
      return;
    }

    if (isDemo && pending.length > demoResultsLeft) {
      showToast(`Límite de demo excedido. Solo puedes analizar ${demoResultsLeft} noticias más.`, "error");
      return;
    }

    setAnalyzing(true);
    stopSignal.current = false;
    setScrapeProgress(`Iniciando análisis de ${pending.length} noticias...`);

    let findingsCount = 0;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || "" });
      const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

      // Helper para fetch con timeout
      const fetchWithTimeout = async (url: string, options: any = {}, timeout = 15000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          clearTimeout(id);
          return response;
        } catch (e) {
          clearTimeout(id);
          throw e;
        }
      };

      const batchSize = 2;
      for (let i = 0; i < pending.length; i += batchSize) {
        if (stopSignal.current) {
          setScrapeProgress("Análisis detenido por el usuario.");
          break;
        }

        const currentBatch = pending.slice(i, i + batchSize);
        setScrapeProgress(`Analizando noticias ${i + 1}-${Math.min(i + batchSize, pending.length)} de ${pending.length}...`);

        await Promise.all(currentBatch.map(async (item) => {
          let retryCount = 0;
          const maxRetries = 2;
          let success = false;

          while (retryCount <= maxRetries && !success) {
            try {
              if (stopSignal.current) return;
              
              console.log(`[Análisis] Procesando (${retryCount}): ${item.url}`);
              let textToAnalyze = "";
              let useUrlContext = false;

              try {
                const contentRes = await fetchWithTimeout(`/api/proxy?url=${encodeURIComponent(item.url)}`, {}, 20000);
                
                if (contentRes.ok) {
                  const html = await contentRes.text();
                  const doc = new DOMParser().parseFromString(html, 'text/html');
                  
                  doc.querySelectorAll('script, style, nav, footer, header, aside, .sidebar, .footer, .header, .ads, .publicidad, .social-share').forEach(el => el.remove());

                  const mainContent = doc.querySelector('.entry-content, .post-content, article, .col-lg-8, #content, .content, .article-body, .news-content, .cuerpo-nota, .nota-body, .article-content, .text-content, .story-body, .article-body');
                  textToAnalyze = mainContent 
                    ? (mainContent.textContent || "").replace(/\s+/g, ' ').trim()
                    : (doc.body.textContent || "").replace(/\s+/g, ' ').trim();
                }
              } catch (proxyError) {
                console.warn(`[Análisis] Error de proxy para ${item.url}:`, proxyError);
              }
              
              if (!textToAnalyze || textToAnalyze.length < 150) {
                console.warn(`[Análisis] Contenido insuficiente o bloqueado para ${item.url}. Usando herramientas de búsqueda y contexto de URL.`);
                useUrlContext = true;
                textToAnalyze = `IMPORTANTE: El contenido de esta noticia no pudo ser extraído directamente debido a protecciones del sitio. 
                DEBES utilizar tus herramientas (urlContext o googleSearch) para acceder a la noticia en: ${item.url} 
                y extraer la información solicitada. Si no puedes acceder a la URL, busca el título "${item.title}" en Google para encontrar la misma noticia en otros medios o versiones caché.`;
              }

              const cleanText = textToAnalyze.substring(0, 10000);

              const prompt = `SISTEMA DE EXTRACCIÓN JUDICIAL - EL SALVADOR
              
              NOTICIA:
              Título: ${item.title}
              URL: ${item.url}
              Texto/Contexto: ${cleanText}
              
              MISIÓN:
              Extraer a TODAS las personas mencionadas en la noticia que estén vinculadas a un hecho delictivo, captura, proceso judicial, investigación o condena.
              
              REGLAS DE ORO (SIN RESTRICCIONES):
              1. EXTRACCIÓN TOTAL: No evalúes si la noticia es importante o no. Si hay nombres de personas acusadas o capturadas, DEBES extraerlos.
              2. IDENTIFICACIÓN FLEXIBLE: Captura nombres y apellidos completos. Si solo hay un alias (ej: "El Sirra") o un nombre parcial, extráelo también como sujeto.
              3. SIN FILTRO DE DELITO: No importa el tipo de delito (desde una multa hasta homicidio). Si hay un proceso judicial o captura, extráelo.
              4. DEPARTAMENTOS: Clasifica en uno de los 14 departamentos de El Salvador. Si no se menciona, usa "SAN SALVADOR" por defecto para procesos nacionales.
              5. RIESGO: 
                 - ALTO: Pandillas, Narcotráfico, Lavado, Corrupción, Homicidio, Extorsión.
                 - MEDIO: Cualquier otro delito (Estafa, Hurto, etc.).
              
              DEBES RESPONDER ÚNICAMENTE CON EL SIGUIENTE FORMATO JSON:
              {
                "findings": [
                  {
                    "subject": "NOMBRE COMPLETO O ALIAS",
                    "crime": "DELITO DETALLADO",
                    "department": "DEPARTAMENTO",
                    "risk": "ALTO" | "MEDIO"
                  }
                ]
              }`;

              // Timeout para la IA también (30s)
              const aiPromise = ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: {
                  tools: useUrlContext ? [{ urlContext: {} }, { googleSearch: {} }] : undefined,
                  responseMimeType: "application/json",
                  temperature: 0.1,
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      findings: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            subject: { type: Type.STRING, description: "Nombre completo, apellido o ALIAS de la persona vinculada al hecho. EVITA descripciones genéricas como 'Sujetos no identificados' o 'Estafador'." },
                            crime: { type: Type.STRING },
                            department: { type: Type.STRING, description: "Uno de los 14 departamentos de El Salvador en MAYÚSCULAS." },
                            risk: { type: Type.STRING, enum: ["ALTO", "MEDIO"] }
                          },
                          required: ["subject", "crime", "department", "risk"]
                        }
                      }
                    },
                    required: ["findings"]
                  }
                }
              });

              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("AI_TIMEOUT")), 60000)
              );

              const aiResponse: any = await Promise.race([aiPromise, timeoutPromise]);

              const data = JSON.parse(aiResponse.text || '{"findings": []}');
              
              if (data.findings && data.findings.length > 0) {
                console.log(`[Análisis] ${data.findings.length} hallazgos en ${item.url}`);
                for (const finding of data.findings) {
                  // Evitar guardar sujetos genéricos que no aportan valor
                  const genericTerms = ["sujeto", "desconocido", "identificado", "estafador", "acusado", "persona", "hombre", "mujer", "sujetos"];
                  const isGeneric = genericTerms.some(term => finding.subject.toLowerCase() === term || finding.subject.toLowerCase().includes(`${term} no`));
                  
                  if (isGeneric && finding.subject.length < 15) {
                    console.log(`[Análisis] Saltando sujeto genérico: ${finding.subject}`);
                    continue;
                  }

                  const normalizedSubject = finding.subject.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                  const saveRes = await fetch("/api/news/save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      date: item.date,
                      subject: normalizedSubject,
                      risk: finding.risk,
                      crime: finding.crime.toUpperCase(),
                      department: finding.department.toUpperCase(),
                      source: item.source || "FGR",
                      url: item.url,
                      content: item.title
                    })
                  });
                  if (saveRes.ok) {
                    findingsCount++;
                  }
                }
              }
              
              await fetch("/api/raw-news/mark-analyzed", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: item.id })
              });

              if (isDemo) updateDemoUsage(1);

              success = true;
            } catch (error: any) {
              console.error(`[Análisis] Error en ${item.url} (Intento ${retryCount}):`, error);
              if (error.message === "AI_TIMEOUT" || error.name === "AbortError") {
                console.warn(`[Análisis] Timeout en ${item.url}`);
              }
              if (error.message?.includes("429") || error.status === 429) {
                const waitTime = Math.pow(2, retryCount + 1) * 2000;
                await delay(waitTime);
              }
              retryCount++;
              if (retryCount > maxRetries) {
                // Si fallan todos los reintentos, marcamos como analizado para no trabar la cola
                // o simplemente dejamos que success sea false y el batch termine.
                // Aquí optamos por marcarlo para que el usuario no se quede con noticias "fantasma" que siempre fallan
                await fetch("/api/raw-news/mark-analyzed", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: item.id })
                }).catch(() => {});
              }
            }
          }
        }));
        await delay(500);
      }

      setScrapeProgress(`Análisis finalizado. Procesadas ${pending.length} noticias, generados ${findingsCount} hallazgos.`);
      await fetchNews();
      await fetchRawNews();
      setSelectedRawIds([]);
      if (findingsCount > 0) {
        setViewMode('analyzed');
      }
      setTimeout(() => setScrapeProgress(""), 5000);
    } catch (err: any) {
      console.error(err);
      addErrorLog("Error en análisis IA: " + err.message);
      setScrapeProgress("Error en el análisis.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleStop = () => {
    stopSignal.current = true;
  };

  useEffect(() => {
    fetchNews();
    fetchRawNews();
    checkApiKey();
    
    // Initialize or retrieve Device ID
    let dId = localStorage.getItem('aml_device_id');
    if (!dId) {
      dId = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('aml_device_id', dId);
    }
    setDeviceId(dId);

    // Check for demo mode in localStorage
    const demoData = localStorage.getItem('aml_demo_session');
    if (demoData) {
      const { expiry } = JSON.parse(demoData);
      if (new Date(expiry) > new Date()) {
        setIsDemo(true);
        setDemoExpiry(expiry);
        // Sync credits with backend
        fetch(`/api/demo/credits?deviceId=${dId}`)
          .then(r => r.json())
          .then(data => setDemoResultsLeft(data.creditsLeft))
          .catch(e => console.error("Error syncing credits:", e));
      } else {
        localStorage.removeItem('aml_demo_session');
      }
    }
  }, []);

  const activateDemo = async () => {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 2); // 2 days
    const demoSession = {
      expiry: expiry.toISOString()
    };
    localStorage.setItem('aml_demo_session', JSON.stringify(demoSession));
    setIsDemo(true);
    setDemoExpiry(demoSession.expiry);
    
    // Registrar en el backend para seguimiento de administración
    try {
      await fetch("/api/demo/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: "Usuario Demo", deviceId })
      });
      
      // Get initial credits
      const res = await fetch(`/api/demo/credits?deviceId=${deviceId}`);
      const data = await res.json();
      setDemoResultsLeft(data.creditsLeft);
    } catch (e) {
      console.error("Error tracking demo activation:", e);
    }

    showToast("Modo Demo activado por 48 horas", "success");
  };

  const updateDemoUsage = async (count: number) => {
    if (!isDemo) return;
    try {
      const res = await fetch("/api/demo/use-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId })
      });
      const data = await res.json();
      setDemoResultsLeft(data.creditsLeft);
    } catch (e) {
      console.error("Error updating demo usage:", e);
    }
  };

  const checkApiKey = async () => {
    if (window.aistudio?.hasSelectedApiKey) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
    }
  };

  const handleOpenKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const filteredNews = news.filter(item => {
    if (!item.date) return !dateFrom && !dateTo; // Solo mostrar si no hay filtros
    const matchesDateFrom = !dateFrom || item.date >= dateFrom;
    const matchesDateTo = !dateTo || item.date <= dateTo;
    return matchesDateFrom && matchesDateTo;
  });

  const filteredRawNews = rawNews.filter(item => {
    if (!item.date) return !dateFrom && !dateTo;
    const matchesDateFrom = !dateFrom || item.date >= dateFrom;
    const matchesDateTo = !dateTo || item.date <= dateTo;
    return matchesDateFrom && matchesDateTo;
  });

  const exportToExcel = () => {
    const source = viewMode === 'analyzed' ? filteredNews : filteredRawNews;
    const data = source.map(item => {
      if (viewMode === 'analyzed') {
        const n = item as NewsItem;
        return {
          Fecha: n.date,
          Sujeto: n.subject,
          "": "",
          " ": "",
          Fuente: n.source || "FGR",
          Delito: n.crime,
          Enlace: n.url,
          Noticia: n.content,
          Ubicacion: n.department
        };
      } else {
        const r = item as RawNewsItem;
        return {
          Fecha: r.date,
          Titulo: r.title,
          Enlace: r.url,
          Analizado: r.analyzed ? "SI" : "NO"
        };
      }
    });
    
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, viewMode === 'analyzed' ? "Hallazgos AML" : "Bandeja FGR");
    XLSX.writeFile(workbook, `Monitoreo_AML_${viewMode}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape for better fit
    doc.setFontSize(18);
    doc.text(`Reporte de Monitoreo AML - ${viewMode === 'analyzed' ? 'Hallazgos' : 'Bandeja FGR'}`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generado el: ${new Date().toLocaleString()}`, 14, 30);
    
    const source = viewMode === 'analyzed' ? filteredNews : filteredRawNews;
    const tableData = source.map(item => {
      if (viewMode === 'analyzed') {
        const n = item as NewsItem;
        return [n.date, n.subject, "", "", n.source || "FGR", n.crime, n.url, n.content, n.department];
      } else {
        const r = item as RawNewsItem;
        return [r.date, r.title, r.analyzed ? "SI" : "NO", r.url];
      }
    });

    autoTable(doc, {
      startY: 35,
      head: viewMode === 'analyzed' 
        ? [['Fecha', 'Sujeto', '', '', 'Fuente', 'Delito', 'Link', 'Título', 'Ubicación']]
        : [['Fecha', 'Título', 'Analizado', 'Link']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [20, 20, 20] },
      styles: { fontSize: 7, cellPadding: 2 },
      columnStyles: viewMode === 'analyzed' ? { 
        1: { cellWidth: 40 },
        6: { cellWidth: 30 },
        7: { cellWidth: 60 }
      } : {}
    });

    doc.save(`Reporte_AML_${viewMode}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const toggleSelectAll = () => {
    if (selectedRawIds.length === filteredRawNews.length) {
      setSelectedRawIds([]);
    } else {
      setSelectedRawIds(filteredRawNews.map(n => n.id));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedRawIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const resetFindings = async () => {
    setModal({
      open: true,
      title: "Borrar Hallazgos",
      message: "¿Estás seguro de que deseas borrar todos los hallazgos? Esta acción no se puede deshacer.",
      onConfirm: async () => {
        setModal(null);
        setLoading(true);
        try {
          const response = await fetch("/api/news/reset", { method: "POST" });
          if (response.ok) {
            const data = await response.json();
            await fetchNews();
            showToast(`Hallazgos eliminados correctamente. Registros borrados: ${data.deleted || 0}`);
          } else {
            const errText = await response.text();
            showToast("Error del servidor: " + errText, "error");
          }
        } catch (err) {
          showToast("Error de red al intentar resetear.", "error");
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const resetRawNews = async () => {
    setModal({
      open: true,
      title: "Vaciar Bandeja",
      message: "¿Estás seguro de que deseas vaciar la bandeja de noticias?",
      onConfirm: async () => {
        setModal(null);
        setLoading(true);
        try {
          const response = await fetch("/api/raw-news/reset", { method: "POST" });
          if (response.ok) {
            const data = await response.json();
            await fetchRawNews();
            showToast(`Bandeja vaciada correctamente. Registros borrados: ${data.deleted || 0}`);
          } else {
            const errText = await response.text();
            showToast("Error del servidor: " + errText, "error");
          }
        } catch (err) {
          showToast("Error de red al intentar resetear.", "error");
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const themeStyles = {
    light: {
      bg: "bg-slate-50",
      text: "text-slate-900",
      card: "bg-white border-slate-200",
      header: "bg-white/80 border-slate-200",
      accent: "bg-blue-600",
      accentText: "text-white",
      muted: "text-slate-400",
      subtle: "bg-slate-100 border-slate-200",
      rowHover: "hover:bg-slate-50",
      tableHeader: "bg-slate-50 border-slate-100",
      input: "bg-slate-50 border-slate-200 text-slate-900"
    },
    dark: {
      bg: "bg-[#0f172a]",
      text: "text-slate-100",
      card: "bg-[#1e293b] border-slate-700",
      header: "bg-[#0f172a]/90 border-slate-800",
      accent: "bg-indigo-500",
      accentText: "text-white",
      muted: "text-slate-400",
      subtle: "bg-slate-800 border-slate-700",
      rowHover: "hover:bg-slate-800/50",
      tableHeader: "bg-slate-800/50 border-slate-700",
      input: "bg-slate-800 border-slate-700 text-slate-100"
    },
    warm: {
      bg: "bg-[#fdfbf7]",
      text: "text-[#433422]",
      card: "bg-white border-[#e6dfd3]",
      header: "bg-[#fdfbf7]/90 border-[#e6dfd3]",
      accent: "bg-[#5a5a40]",
      accentText: "text-white",
      muted: "text-[#a69b8d]",
      subtle: "bg-[#f5f2ed] border-[#e6dfd3]",
      rowHover: "hover:bg-[#f5f2ed]",
      tableHeader: "bg-[#f5f2ed] border-[#e6dfd3]",
      input: "bg-[#fcfaf7] border-[#e6dfd3] text-[#433422]"
    }
  };

  const s = themeStyles[theme];

  return (
    <div className={`min-h-screen ${s.bg} ${s.text} font-sans selection:bg-blue-500/20 selection:text-blue-900 transition-colors duration-500`}>
      <ManualModal 
        isOpen={isManualOpen} 
        onClose={() => setIsManualOpen(false)} 
      />

      <ErrorLogModal 
        isOpen={isErrorModalOpen} 
        onClose={() => setIsErrorModalOpen(false)} 
        errorLog={errorLog}
      />

      <AnimatePresence>
        {isDemo && (
          <motion.div 
            initial={{ y: -50 }}
            animate={{ y: 0 }}
            className="bg-blue-600 text-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-6 sticky top-0 z-[60] shadow-md"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3" />
              <span>Modo Demo APNFD Activo</span>
            </div>
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3 h-3" />
              <span>Análisis Restantes: {demoResultsLeft}/15</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="w-3 h-3" />
              <span>Expira: {demoExpiry ? new Date(demoExpiry).toLocaleDateString() : ''}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal?.open && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-slate-200 p-8 rounded-3xl max-w-md w-full shadow-2xl"
            >
              <h3 className="text-xl font-serif text-slate-900 mb-4">{modal.title}</h3>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed">{modal.message}</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setModal(null)}
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-widest hover:bg-slate-200 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={modal.onConfirm}
                  className="flex-1 px-6 py-3 rounded-xl bg-red-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-red-500 transition-all shadow-lg shadow-red-900/20"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-white border-emerald-200 text-emerald-700 shadow-emerald-500/10' : 'bg-white border-red-200 text-red-700 shadow-red-500/10'
            }`}
          >
            {toast.type === 'success' ? <Shield className="w-5 h-5 text-emerald-500" /> : <Square className="w-5 h-5 text-red-500" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className={`border-b ${s.header} p-6 flex flex-col md:flex-row justify-between items-center sticky top-0 backdrop-blur-md z-30 gap-4 shadow-sm transition-colors duration-500`}>
        <div className="flex items-center gap-5">
          <div className={`w-12 h-12 ${s.accent} flex items-center justify-center rounded-2xl shadow-lg shadow-blue-900/20`}>
            <Shield className="text-white w-7 h-7" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold tracking-tight font-serif ${s.text}`}>Cumplimiento SV</h1>
            <p className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.3em]`}>Intelligence & AML Monitoring</p>
          </div>
        </div>

        <div className="flex-1 flex justify-center items-center gap-6">
          <button 
            onClick={() => setIsManualOpen(true)}
            className={`flex items-center gap-3 px-7 py-3.5 rounded-2xl border ${s.card} ${s.text} hover:bg-slate-50 hover:text-slate-900 text-[12px] font-bold uppercase tracking-widest transition-all shadow-sm`}
          >
            <BookOpen className="w-4 h-4" />
            MANUAL
          </button>

          {!isDemo && (
            <button 
              onClick={activateDemo}
              className="flex items-center gap-3 px-7 py-3.5 rounded-2xl border border-blue-200 text-blue-600 bg-blue-50 text-[12px] font-bold uppercase tracking-widest hover:bg-blue-100 transition-all shadow-sm"
            >
              <Shield className="w-4 h-4" />
              Demo Monitoreo
            </button>
          )}

          <div className={`flex ${s.subtle} p-2 rounded-[1.5rem] border shadow-inner transition-colors duration-500`}>
            <button 
              onClick={() => setViewMode('raw')}
              className={`px-7 py-3 rounded-2xl text-[12px] font-bold uppercase tracking-widest transition-all duration-300 ${viewMode === 'raw' ? (theme === 'dark' ? 'bg-slate-700 text-white' : 'bg-white text-slate-900 shadow-md border border-slate-200') : s.muted}`}
            >
              Bandeja
            </button>
            <button 
              onClick={() => setViewMode('analyzed')}
              className={`px-7 py-3 rounded-2xl text-[12px] font-bold uppercase tracking-widest transition-all duration-300 ${viewMode === 'analyzed' ? (theme === 'dark' ? 'bg-slate-700 text-white' : 'bg-white text-slate-900 shadow-md border border-slate-200') : s.muted}`}
            >
              Hallazgos
            </button>
          </div>
        </div>

        <div className="w-[200px] hidden md:block" /> {/* Spacer to balance the logo */}
      </header>

      <div className={`flex justify-center p-4 border-b ${s.header} transition-colors duration-500 sticky top-[96px] z-20`}>
        <div className={`flex ${s.subtle} p-1.5 rounded-2xl border transition-colors duration-500 shadow-sm`}>
          <button 
            onClick={() => setTheme('light')}
            className={`px-8 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${theme === 'light' ? 'bg-white text-slate-900 shadow-md' : s.muted}`}
          >
            Modo Claro
          </button>
          <button 
            onClick={() => setTheme('dark')}
            className={`px-8 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${theme === 'dark' ? 'bg-slate-700 text-white shadow-md' : s.muted}`}
          >
            Modo Nocturno
          </button>
        </div>
      </div>

      {scrapeProgress && (
        <div className="bg-blue-600 text-white px-8 py-3 text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-between sticky top-[96px] z-20 shadow-lg">
          <div className="flex items-center gap-4">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>{scrapeProgress}</span>
          </div>
        </div>
      )}

      <main className="p-10 max-w-[1600px] mx-auto">
        <div className={`relative mb-12 ${s.card} p-10 rounded-[2.5rem] border shadow-sm flex flex-col gap-10 transition-colors duration-500`}>
          <div className="flex flex-wrap gap-12 items-center justify-center">
            <div className="flex flex-col items-center">
              <label className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] mb-3`}>Fuente de Búsqueda</label>
              <div className={`flex ${s.subtle} p-1.5 rounded-2xl border transition-colors duration-500`}>
                <button 
                  onClick={() => setSearchSource('fgr')}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${searchSource === 'fgr' ? (theme === 'dark' ? 'bg-slate-700 text-white' : 'bg-white text-slate-900 border border-slate-200 shadow-sm') : s.muted}`}
                >
                  FGR SV
                </button>
                <button 
                  onClick={() => setSearchSource('digital')}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${searchSource === 'digital' ? (theme === 'dark' ? 'bg-slate-700 text-white' : 'bg-white text-slate-900 border border-slate-200 shadow-sm') : s.muted}`}
                >
                  Medios Digitales
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <label className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] mb-3`}>Rango de Monitoreo</label>
              <div className="flex items-center gap-4">
                <input type="date" className={`${s.input} border rounded-xl px-4 py-3.5 text-xs font-semibold outline-none focus:border-blue-500/50 transition-colors`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span className={`${s.muted} font-light`}>to</span>
                <input type="date" className={`${s.input} border rounded-xl px-4 py-3.5 text-xs font-semibold outline-none focus:border-blue-500/50 transition-colors`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            {viewMode === 'raw' && (
              <div className="flex flex-col items-center">
                <label className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] mb-3`}>Acciones de Procesamiento</label>
                <div className="flex gap-6">
                  {scraping || analyzing ? (
                    <button onClick={handleStop} className="flex items-center gap-3 px-8 py-3.5 rounded-2xl bg-red-50 text-red-600 text-[11px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all border border-red-100">
                      <Square className="w-4 h-4 fill-current" /> Detener Proceso
                    </button>
                  ) : (
                    <div className="flex gap-6">
                      <button onClick={startScrape} className={`flex items-center gap-3 px-8 py-3.5 rounded-2xl border ${s.subtle} ${s.text} text-[11px] font-bold uppercase tracking-widest hover:opacity-80 transition-all`}>
                        <RefreshCw className="w-4 h-4" /> {searchSource === 'fgr' ? 'Extraer FGR' : 'Buscar Medios'}
                      </button>
                      <button onClick={analyzeNews} className={`flex items-center gap-3 px-8 py-3.5 rounded-2xl ${s.accent} ${s.accentText} text-[11px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-blue-900/20`}>
                        <Shield className="w-4 h-4" /> Analizar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={`flex justify-end pt-4 border-t ${theme === 'dark' ? 'border-slate-700' : 'border-slate-50'}`}>
            <button 
              onClick={viewMode === 'analyzed' ? resetFindings : resetRawNews} 
              className={`px-6 py-3 rounded-xl border ${theme === 'dark' ? 'border-red-900/30 text-red-400' : 'border-red-100 text-red-500'} text-[9px] font-bold uppercase tracking-widest hover:bg-red-500/10 transition-all flex items-center gap-2 group opacity-60 hover:opacity-100`}
            >
              <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
              Resetear {viewMode === 'analyzed' ? 'Hallazgos' : 'Bandeja'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-12">
          <div className={`${s.card} p-8 rounded-[2rem] border shadow-sm flex items-center justify-between group hover:border-blue-200 transition-all`}>
            <div>
              <p className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] mb-2`}>Noticias en Bandeja</p>
              <p className={`text-5xl font-serif ${s.text}`}>{filteredRawNews.length}</p>
            </div>
            <div className={`w-16 h-16 ${s.subtle} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform border`}>
              <RefreshCw className={`${s.muted} w-8 h-8`} />
            </div>
          </div>
          <div className={`${s.card} p-8 rounded-[2rem] border shadow-sm flex items-center justify-between group hover:border-emerald-200 transition-all`}>
            <div>
              <p className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] mb-2`}>Hallazgos AML</p>
              <p className={`text-5xl font-serif ${s.text}`}>{filteredNews.length}</p>
            </div>
            <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform border border-emerald-100">
              <Shield className="text-emerald-500 w-8 h-8" />
            </div>
          </div>
          {isDemo && (
            <div className={`${s.card} p-8 rounded-[2rem] border shadow-sm flex flex-col justify-center group hover:border-blue-200 transition-all`}>
              <p className={`text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] mb-4`}>Proyección Uso Demo</p>
              <div className="flex items-end gap-2">
                <div className={`flex-1 h-2 ${s.subtle} rounded-full overflow-hidden`}>
                  <div 
                    className="h-full bg-blue-500 transition-all duration-1000" 
                    style={{ width: `${(demoResultsLeft / 15) * 100}%` }}
                  />
                </div>
                <span className={`text-[10px] font-bold ${s.text}`}>{demoResultsLeft}/15</span>
              </div>
            </div>
          )}

          <div className={`${s.accent} p-8 rounded-[2rem] border shadow-xl flex flex-col justify-center group hover:scale-[1.02] transition-all cursor-pointer`} onClick={() => window.location.href = 'mailto:monitoreo.aml.elsalvador@gmail.com'}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold text-white/70 uppercase tracking-[0.2em]">Acceso Ilimitado</p>
              <ExternalLink className="w-4 h-4 text-white/50" />
            </div>
            <p className="text-lg font-bold text-white leading-tight">Obtén la Versión Completa</p>
            <p className="text-[10px] text-white/60 mt-2 font-medium">monitoreo.aml.elsalvador@gmail.com</p>
          </div>
        </div>

        <AnimatePresence>
          {(viewMode === 'analyzed' ? filteredNews : filteredRawNews).length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="flex justify-center gap-6 mb-10"
            >
              <button 
                onClick={exportToExcel} 
                className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-emerald-400 border-2 border-amber-400 text-slate-900 text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-500/20 group relative overflow-hidden"
                style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.05) 1px, transparent 0)', backgroundSize: '8px 8px' }}
              >
                <TableIcon className="w-5 h-5" />
                <span>Exportar a Excel</span>
              </button>
              <button 
                onClick={exportToPDF} 
                className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-rose-300 border-2 border-rose-400 text-slate-900 text-[11px] font-bold uppercase tracking-widest hover:bg-rose-400 transition-all shadow-xl shadow-rose-500/10 group"
              >
                <FileText className="w-5 h-5" />
                <span>Exportar a PDF</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={`${s.card} rounded-[2.5rem] border shadow-sm overflow-hidden transition-colors duration-500`}>
          <div className={`grid ${viewMode === 'analyzed' ? 'grid-cols-[100px_1.2fr_120px_1fr_1fr_1.5fr_1fr_60px]' : 'grid-cols-[60px_120px_150px_1fr_140px_60px]'} border-b ${s.tableHeader} text-[10px] font-bold ${s.muted} uppercase tracking-[0.2em] p-6`}>
            {viewMode === 'raw' && (
              <div className="flex items-center justify-center">
                <input type="checkbox" className="w-5 h-5 rounded-lg border-slate-300 bg-white text-blue-600 focus:ring-blue-500" checked={selectedRawIds.length > 0 && selectedRawIds.length === filteredRawNews.length} onChange={toggleSelectAll} />
              </div>
            )}
            <div>Fecha</div>
            {viewMode === 'analyzed' ? (
              <>
                <div>Sujeto</div>
                <div>Fuente</div>
                <div>Delito</div>
                <div>Título de la Noticia</div>
                <div>Ubicación</div>
                <div>Riesgo</div>
              </>
            ) : (
              <>
                <div>Fuente</div>
                <div>Título de la Noticia</div>
                <div className="text-center">Estado</div>
              </>
            )}
            <div className="text-center">Link</div>
          </div>

          <div className="max-h-[800px] overflow-y-auto divide-y divide-slate-100">
            <AnimatePresence mode="popLayout">
              {(viewMode === 'analyzed' ? filteredNews : filteredRawNews).length === 0 ? (
                <div className="p-20 text-center">
                  <p className={`${s.muted} font-serif italic`}>No se encontraron registros {viewMode === 'analyzed' ? 'en hallazgos AML' : 'en la bandeja'}.</p>
                  <p className={`text-[10px] ${s.muted} opacity-70 uppercase tracking-widest mt-2`}>Inicia una búsqueda o ajusta los filtros de fecha.</p>
                </div>
              ) : (viewMode === 'analyzed' ? filteredNews : filteredRawNews).map((item) => (
                <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} key={item.id} className={`grid ${viewMode === 'analyzed' ? 'grid-cols-[100px_1.2fr_120px_1fr_1fr_1.5fr_1fr_60px]' : 'grid-cols-[60px_120px_150px_1fr_140px_60px]'} p-7 ${s.rowHover} transition-all group items-center`}>
                  {viewMode === 'raw' && (
                    <div className="flex items-center justify-center">
                      <input type="checkbox" className="w-5 h-5 rounded-lg border-slate-300 bg-white text-blue-600 focus:ring-blue-500" checked={selectedRawIds.includes(item.id)} onChange={() => toggleSelect(item.id)} />
                    </div>
                  )}
                  <div className={`text-[12px] font-semibold ${s.muted}`}>{item.date}</div>
                  {viewMode === 'analyzed' ? (
                    <>
                      <div className={`font-bold ${s.text} text-[14px] uppercase`}>{(item as NewsItem).subject}</div>
                      <div className="text-[11px] font-bold">
                        <span className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-tighter ${((item as NewsItem).source && (item as NewsItem).source !== 'FGR') ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                          {(item as NewsItem).source || 'FGR'}
                        </span>
                      </div>
                      <div className="text-[11px] font-bold text-amber-600 uppercase">{(item as NewsItem).crime}</div>
                      <div className={`text-[11px] ${s.muted} uppercase pr-6 leading-relaxed line-clamp-2`}>{(item as NewsItem).content}</div>
                      <div className={`flex items-center gap-2 text-[11px] font-bold ${s.muted} uppercase`}>
                        <MapPin className="w-3 h-3 opacity-50" /> {(item as NewsItem).department}
                      </div>
                      <div>
                        <span className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase ${
                          (item as NewsItem).risk === 'ALTO' ? 'bg-red-100 text-red-700 border border-red-200' : 
                          (item as NewsItem).risk === 'MEDIO' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 
                          'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>{(item as NewsItem).risk}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[11px] font-bold">
                        <span className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-tighter ${((item as RawNewsItem).source && (item as RawNewsItem).source !== 'FGR') ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                          {(item as RawNewsItem).source || 'FGR'}
                        </span>
                      </div>
                      <div className={`font-bold ${s.text} text-[15px] uppercase leading-snug pr-8`}>{(item as RawNewsItem).title}</div>
                      <div className="flex justify-center">
                        {(item as RawNewsItem).analyzed ? (
                          <span className="flex items-center gap-2 text-emerald-600 text-[10px] font-bold bg-emerald-50 px-4 py-1.5 rounded-full border border-emerald-200 uppercase">
                            <Shield className="w-3.5 h-3.5" /> Procesado
                          </span>
                        ) : (
                          <span className={`${s.muted} text-[10px] font-bold ${s.subtle} px-4 py-1.5 rounded-full border uppercase`}>Pendiente</span>
                        )}
                      </div>
                    </>
                  )}
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className={`flex items-center justify-center ${s.muted} hover:text-blue-600 transition-all hover:scale-125`}>
                    <ExternalLink className="w-5 h-5" />
                  </a>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="mt-20 flex flex-col md:flex-row justify-between items-center gap-8 border-t border-slate-200 pt-12">
          <div className={`text-[11px] font-bold ${s.muted} uppercase tracking-[0.3em]`}>
            Para soporte o licencias: <a href="mailto:monitoreo.aml.elsalvador@gmail.com" className="text-blue-500 hover:underline">monitoreo.aml.elsalvador@gmail.com</a>
          </div>
          <div className={`text-[11px] font-bold ${s.muted} uppercase tracking-[0.5em] text-center md:text-right`}>
            Cumplimiento SV © 2026
          </div>
        </div>
      </main>
    </div>
  );
}
