import { NextResponse } from "next/server";
import { AIError } from "./gemini";

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Turn any failure into a message a creator can act on. Details go to server logs only. */
export function aiFailure(e: unknown) {
  console.error("[ai]", e);
  if (e instanceof AIError) {
    if (e.code === "no_key")
      return json({ error: "config", message: "The AI isn't connected right now. Please try again in a bit." }, 503);
    if (e.code === "blocked")
      return json(
        {
          error: "blocked",
          message: "We couldn't write copy for that. Try describing what you teach or sell in different words.",
        },
        422,
      );
    if (e.code === "rate_limited")
      return json({ error: "busy", message: "Lots of creators are building right now. Give it 30 seconds and try again." }, 503);
  }
  return json(
    { error: "ai_down", message: "Our AI took too long to answer. Your details are saved, so just tap Try again." },
    503,
  );
}
