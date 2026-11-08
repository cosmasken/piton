/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#050505',
        surface: '#0d0d0d',
        panel:   '#111',
        border:  '#1a1a1a',
        accent:  '#00ff88',
        red:     '#ff4466',
        muted:   '#3a5a3a',
        dim:     '#555',
        text:    '#e0ffe0',
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        mono:    ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
