import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Chimpbase",
  description: "Build complex backends with fewer moving parts.",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "Plugins", link: "/auth" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/" },
        ],
      },
      {
        text: "Plugins",
        items: [
          { text: "Auth", link: "/auth" },
          { text: "Webhooks", link: "/webhooks" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/chimpbase/chimpbase" },
    ],
  },
});
