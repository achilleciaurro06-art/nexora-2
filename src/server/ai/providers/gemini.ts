import "server-only";
import { GoogleGenAI } from "@google/genai";
import { env } from "@/server/env";
import type { AiProvider, AiRequest, AiResponse } from "../provider";

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";

  async generate(req: AiRequest): Promise<AiResponse> {
    const e = env();
    if (!e.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY non configurata");
    const ai = new GoogleGenAI({ apiKey: e.GEMINI_API_KEY });

    const contents = req.messages.map((m, idx) => {
      const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [{ text: m.content }];
      if (req.attachment && idx === req.messages.length - 1 && m.role === "user") {
        parts.push({ inlineData: { mimeType: req.attachment.mimeType, data: Buffer.from(req.attachment.data).toString("base64") } });
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const res = await ai.models.generateContent({
      model: e.GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxOutputTokens ?? 1024,
        ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}),
      },
    });

    return {
      text: res.text ?? "",
      model: e.GEMINI_MODEL,
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
