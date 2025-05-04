import { Hono } from "hono";
import type { Context, Next } from "hono";
import { serve } from "inngest/hono";
import { functions, inngest } from "./inngest";

const app = new Hono();

app.get("/api", (c: Context) => {
  return c.text("Hello Hono!");
});

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({
    client: inngest,
    functions,
  }),
);

export default app;
