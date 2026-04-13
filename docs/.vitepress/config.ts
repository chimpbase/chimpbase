import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Chimpbase",
  description: "Build complex backends with fewer moving parts.",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "Primitives", link: "/actions" },
      { text: "Plugins", link: "/auth" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
        ],
      },
      {
        text: "Primitives",
        items: [
          { text: "Actions", link: "/actions" },
          { text: "Subscriptions", link: "/subscriptions" },
          { text: "Workers & Queues", link: "/workers" },
          { text: "Cron", link: "/cron" },
          { text: "Workflows", link: "/workflows" },
          { text: "HTTP Routes", link: "/routes" },
          { text: "Database", link: "/database" },
          { text: "Collections", link: "/collections" },
          { text: "KV Store", link: "/kv" },
          { text: "Streams", link: "/streams" },
          { text: "Telemetry", link: "/telemetry" },
          { text: "Plugins", link: "/plugins" },
        ],
      },
      {
        text: "Official Plugins",
        items: [
          { text: "Auth", link: "/auth" },
          { text: "Webhooks", link: "/webhooks" },
          { text: "REST Collections", link: "/rest-collections" },
        ],
      },
      {
        text: "Testing",
        items: [
          { text: "Contract Testing (Pact)", link: "/pact" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/chimpbase/chimpbase" },
    ],
  },
});
