/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#4F46E5",
        background: "#F9FAFB",
        surface: "#FFFFFF",
        text: "#111827",
        muted: "#6B7280",
        border: "#E5E7EB",
        success: "#10B981",
        warning: "#F59E0B",
      },
      fontFamily: {
        sans: ['Geist', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      borderRadius: {
        lg: '6px',
        md: '4px',
      }
    },
  },
  plugins: [],
}
