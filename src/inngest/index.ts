import { Inngest, Context } from "inngest";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "vigie" });

const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }: Context) => {
    await step.sleep("wait-a-moment", "1s");
    return { message: `Hello ${event.data.email}!` };
  },
);

// Create an empty array where we'll export future Inngest functions
export const functions = [helloWorld];
