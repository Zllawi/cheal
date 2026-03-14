import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1f8f7",
          100: "#d6ece7",
          200: "#abd9ce",
          300: "#74bea9",
          400: "#4aa18e",
          500: "#358574",
          600: "#286a5d",
          700: "#22564c",
          800: "#1f463f",
          900: "#1b3c37"
        }
      }
    }
  },
  plugins: []
};

export default config;
