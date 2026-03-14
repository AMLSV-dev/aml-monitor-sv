import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// Initialize AI with the key injected by the platform
const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("API_KEY_NOT_CONFIGURED");
  }
  return new GoogleGenAI({ apiKey });
};

export interface NewsFinding {
  subject: string;
  crime: string;
  department: string;
  risk: "ALTO" | "MEDIO" | "BAJO";
  content: string;
  date?: string;
  source?: string;
}

export interface AnalysisResult {
  isRelevant: boolean;
  date: string;
  findings: NewsFinding[];
  source?: string;
  content?: string;
}

export interface DigitalSearchResult {
  news: {
    title: string;
    url: string;
    date: string;
    source: string;
  }[];
}

export const analyzeNewsContent = async (text: string, url: string): Promise<AnalysisResult> => {
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
        required: ["isRelevant", "date", "findings"]
      }
    }
  });

  if (!response.text) {
    throw new Error("El modelo no devolvió resultados.");
  }

  return JSON.parse(response.text);
};

export const searchDigitalMedia = async (fromDate: string, toDate: string): Promise<DigitalSearchResult> => {
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

  return JSON.parse(response.text);
};
