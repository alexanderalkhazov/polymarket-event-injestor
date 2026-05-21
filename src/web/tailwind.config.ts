import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./hooks/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dm-sans)", "sans-serif"],
        mono: ["var(--font-dm-mono)", "monospace"],
      },
      colors: {
        bg: "var(--bg)",
        bg1: "var(--bg1)",
        bg2: "var(--bg2)",
        bg3: "var(--bg3)",
        border: "var(--border)",
        border2: "var(--border2)",
        text: "var(--text)",
        muted: "var(--muted)",
        dim: "var(--dim)",
        green: "var(--green)",
        red: "var(--red)",
        amber: "var(--amber)",
        blue: "var(--blue)",
        purple: "var(--purple)",
      },
    },
  },
  plugins: [],
}

export default config
