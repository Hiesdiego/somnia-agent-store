import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.GROQ_PROXY_PORT || 8787);
const groqApiKey = process.env.GROQ_API_KEY?.trim();
const defaultModel = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
const targetUrl = "https://api.groq.com/openai/v1/chat/completions";

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleChatCompletions(req: IncomingMessage, res: ServerResponse) {
  if (!groqApiKey) {
    sendJson(res, 500, { error: "Missing GROQ_API_KEY" });
    return;
  }

  const rawBody = await readBody(req);
  const payload = rawBody ? JSON.parse(rawBody) : {};

  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${groqApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      model: payload.model || defaultModel,
    }),
  });

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
  });
  res.end(await upstream.text());
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, provider: "groq", target: targetUrl });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChatCompletions(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(`Groq OpenAI-compatible proxy listening on http://localhost:${port}/v1`);
});
