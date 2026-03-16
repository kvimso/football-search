/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        scout: {
          bg: "#0a0f0d",
          card: "#111916",
          accent: "#22c55e",
          border: "#1a2e1f",
        },
      },
      animation: {
        "slide-up": "slide-up 0.4s ease-out forwards",
      },
      keyframes: {
        "slide-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
