/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			// Restaurant-optimized BeepBite colors
  			beepbite: {
  				orange: 'hsl(var(--beepbite-orange))', // Primary Orange: #F97316
  				'orange-soft': 'hsl(var(--beepbite-orange-soft))', // Secondary Orange: #FB923C
  				accent: 'hsl(var(--beepbite-accent))', // Accent Orange: #FDBA74
  				'text-primary': 'hsl(var(--beepbite-text-primary))', // Primary Text: #1A1A1A
  				'text-secondary': 'hsl(var(--beepbite-text-secondary))', // Secondary Text: #4A4A4A
  				'text-tertiary': 'hsl(var(--beepbite-text-tertiary))', // Tertiary Text: #6B7280
  				background: 'hsl(var(--beepbite-background))', // Background White
  				'background-light': 'hsl(var(--beepbite-background-light))', // Background Light: #FAFAFA
  				'background-cream': 'hsl(var(--beepbite-background-cream))', // Background Cream: #FFF7ED
  				success: 'hsl(var(--beepbite-success))', // Success Green: #10B981
  				warning: 'hsl(var(--beepbite-warning))', // Warning Amber: #F59E0B
  				error: 'hsl(var(--beepbite-error))', // Error Red: #EF4444
  				'border-light': 'hsl(var(--beepbite-border-light))', // Border Light: #E5E7EB
  				'border-medium': 'hsl(var(--beepbite-border-medium))' // Border Medium: #D1D5DB
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
