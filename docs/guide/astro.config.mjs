// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import sidebar from "./sidebar.json" with { type: "json" };

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
      customCss: ["./src/styles/docs.css", "@fontsource-variable/gabarito", "@fontsource-variable/jetbrains-mono"],
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
    }),
  ],
  // theme.css lives two levels up, in the app's renderer.
  vite: { plugins: [tailwindcss()], server: { fs: { allow: ["../.."] } } },
});
