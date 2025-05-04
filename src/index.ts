import { Hono } from "hono";
import type { Context, Next } from "hono";
import { env } from "hono/adapter";
import { serve } from "inngest/hono";
import { functions, inngest } from "./inngest";

const app = new Hono();

app.get("/api", (c: Context) => {
  return c.text("Hello Hono!");
});

app.on(["GET", "PUT", "POST"], "/api/inngest", (c: Context, next: Next) => {
  return serve({
    client: inngest,
    functions,
    signingKey: c.env.INNGEST_SIGNING_KEY,
  })(c);
});

export default app;
