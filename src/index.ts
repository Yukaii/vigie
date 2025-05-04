import { Hono } from "hono";
import type { Context, Next } from "hono";

const app = new Hono();

app.get("/api", (c: Context) => {
  return c.text("Hello Hono!");
});

export default app;