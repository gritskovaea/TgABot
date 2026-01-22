import fetch from "node-fetch";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

export async function analyze(messages: string[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "GEMINI_API_KEY не задан. Укажите ключ в .env.";
  }
  const prompt = `
Проанализируй сообщения пользователя и опиши:
- стиль общения
- основные темы
- активность
- тональность
- особенности

Сообщения:
${messages.join("\n")}
`;

  const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
  );

  if (res.ok === false) {
    const body = typeof res.text === "function" ? await res.text() : "";
    return `Ошибка Gemini API: ${res.status} ${res.statusText}\n${body}`;
  }

  const data = (await res.json()) as GeminiResponse;
  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text ??
    "Нет данных для анализа."
  );
}
