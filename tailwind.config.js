/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sage: {
          50: '#f4f7f4',
          100: '#e6ede6',
          200: '#cfddcf',
          300: '#abc4ab',
          400: '#81a581',
          500: '#618861',
          600: '#4c6e4c',
          700: '#3e583e',
          800: '#344734',
          900: '#2b3b2b',
        },
        sand: {
          50: '#fbf9f6',
          100: '#f6f1eb',
          200: '#ede2d5',
          300: '#dfcdb7',
          400: '#ccb194',
          500: '#bd9a77',
        },
        blush: {
          50: '#fff5f5',
          100: '#feebe8',
          200: '#fed7d2',
          300: '#fdb5ad',
          400: '#fa8579',
          500: '#f15a4b',
        }
      },
      fontFamily: {
        sans: [
          '"Hiragino Sans"',
          '"Hiragino Kaku Gothic ProN"',
          '"Noto Sans JP"',
          'Meiryo',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
