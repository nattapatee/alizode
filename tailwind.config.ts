import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      colors: {
        neon: {
          green: "#39ff14",
          cyan: "#00fff5",
          magenta: "#ff00ff",
          amber: "#ffbf00",
          red: "#ff3131",
        },
        surface: {
          0: "#09090b",
          1: "#18181b",
          2: "#27272a",
          3: "#3f3f46",
        },
      },
    },
  },
  plugins: [typography],
} satisfies Config;
