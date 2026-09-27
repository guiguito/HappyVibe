// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import sidebar from "./sidebar.json" with { type: "json" };

// ?embed=1 comes from the app's help links (src/renderer/src/docsLinks.ts). It is kept for the tab in
// sessionStorage, because links inside the guide drop the query. It is only ever set from the query,
// so a normal visit never inherits it.
const EMBED = `try{if(new URLSearchParams(location.search).has("embed"))sessionStorage.setItem("hv-embed","1");if(sessionStorage.getItem("hv-embed"))document.documentElement.dataset.embed=""}catch{}`;

export default defineConfig({
  site: "https://happyvibe.dev",
  base: "/docs",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "HappyVibe",
      logo: { src: "./src/assets/logo.svg" },
      editLink: { baseUrl: "https://github.com/guiguito/HappyVibe/edit/main/docs/guide/" },
      sidebar,
      head: [{ tag: "script", content: EMBED }],
      customCss: ["./src/styles/docs.css", "@fontsource-variable/gabarito", "@fontsource-variable/jetbrains-mono"],
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        PageTitle: "./src/components/PageTitle.astro",
      },
    }),
  ],
  // theme.css lives two levels up, in the app's renderer.
  vite: { plugins: [tailwindcss()], server: { fs: { allow: ["../.."] } } },
});
