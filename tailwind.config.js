/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sand: '#f6f0e2',
        sunset: '#f0a06b',
        deep: '#063247',
        sky: '#0aafee',
        ash: '#636260',
        ink: '#082633'
      },
      fontFamily: {
        sans: ['Sora', 'Trebuchet MS', 'sans-serif']
      },
      boxShadow: {
        soft: '0 12px 28px rgba(6, 50, 71, 0.11)',
        button: '0 8px 18px rgba(6, 50, 71, 0.16)'
      },
      backgroundImage: {
        'event-shell':
          'radial-gradient(circle at 12% 18%, rgba(10, 175, 238, 0.25), transparent 38%), radial-gradient(circle at 86% 12%, rgba(240, 160, 107, 0.32), transparent 34%), linear-gradient(180deg, #f6f0e2 0%, #fff 55%, #f3f6f7 100%)',
        'brand-accent': 'linear-gradient(120deg, #f0a06b, #f7b987 55%, #0aafee)',
        'panel-tint': 'linear-gradient(180deg, rgba(246, 240, 226, 0.95), rgba(10, 175, 238, 0.08))',
        'bar-fill': 'linear-gradient(120deg, #0aafee, #f0a06b)'
      }
    }
  },
  plugins: []
};
