/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "1.5rem", lg: "2rem" },
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // DARTH_BANKAI palette (from the brand guide)
        void:        "#07060B",
        deepspace:   "#0D0A14",
        nebula:      "#1A0A2E",
        sith:        "#B432FF",
        saber:       "#FF3388",
        darksith:    "#4411AA",
        holo:        "#2244CC",
        star:        "#E0D0F0",
        muted:       "#6F5C8E",

        // shadcn semantic mapping → brand tokens
        background:  "#07060B",
        foreground:  "#E0D0F0",
        primary: {
          DEFAULT: "#B432FF",
          foreground: "#F8FAFC",
        },
        secondary: {
          DEFAULT: "#FF3388",
          foreground: "#07060B",
        },
        accent: {
          DEFAULT: "#4411AA",
          foreground: "#E0D0F0",
        },
        destructive: {
          DEFAULT: "#FF3388",
          foreground: "#F8FAFC",
        },
        card: {
          DEFAULT: "#0D0A14",
          foreground: "#E0D0F0",
        },
        popover: {
          DEFAULT: "#0D0A14",
          foreground: "#E0D0F0",
        },
        border: "#2E1F4A",
        input:  "#1A0A2E",
        ring:   "#B432FF",

        // class-specific accents
        hunter:  "#4A8EFF",
        titan:   "#FF4242",
        warlock: "#B432FF",
      },
      fontFamily: {
        // brand guide: Orbitron · Kosugi Maru · Rajdhani
        display: ['"Orbitron"', "sans-serif"],
        body:    ['"Kosugi Maru"', "sans-serif"],
        ui:      ['"Rajdhani"', "sans-serif"],
        mono:    ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
      backgroundImage: {
        "signature-gradient":
          "linear-gradient(90deg, #B432FF 0%, #FF3388 50%, #4411AA 100%)",
        "cosmic-radial":
          "radial-gradient(ellipse at center, #1A0A2E 0%, #07060B 70%)",
      },
      keyframes: {
        "fade-up": {
          "0%":   { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%,100%": { opacity: 1 },
          "50%":     { opacity: 0.4 },
        },
      },
      animation: {
        "fade-up": "fade-up 400ms ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
