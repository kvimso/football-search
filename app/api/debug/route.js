import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasKey = !!(apiKey && apiKey !== "your_anthropic_api_key_here");
  const keyPrefix = apiKey ? apiKey.substring(0, 10) + "..." : "NOT SET";

  if (!hasKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured", keyPrefix });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      messages: [{ role: "user", content: "Say hello in exactly 3 words." }],
    });
    return NextResponse.json({
      status: "ok",
      keyPrefix,
      response: message.content[0]?.text,
      model: message.model,
    });
  } catch (err) {
    return NextResponse.json({
      status: "error",
      keyPrefix,
      error: err.message,
      errorType: err.constructor.name,
    });
  }
}
