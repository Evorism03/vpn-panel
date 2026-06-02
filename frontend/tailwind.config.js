/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        green: {
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          900: "#052e16",
        },
        surface: {
          DEFAULT: "rgba(255,255,255,0.04)",
          hover:   "rgba(255,255,255,0.07)",
          active:  "rgba(255,255,255,0.10)",
        },
      },
      backgroundImage: {
        "radial-green": "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(34,197,94,0.15), transparent)",
      },
      backdropBlur: { xs: "2px" },
      animation: {
        "fade-in": "fadeIn .25s ease-out",
        "slide-up": "slideUp .3s ease-out",
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "none" } },
      },
    },
  },
  plugins: [],
};
