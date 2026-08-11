/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#4338CA",
        background: "#FFFFFF",
        surface: "#FAFAFA",
        text: "#171717",
        muted: "#8F8F8F",
        border: "#EAEAEA",
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
