# Setup Guide

This guide will help you set up BeepBite for your restaurant, from installation to going live with order management.

## Prerequisites

### System Requirements

- **Node.js** 18 or higher
- **npm** 8+ or **yarn** 1.22+
- **Modern web browser** (Chrome 90+, Firefox 88+, Safari 14+)
- **Internet connection** for real-time features

### Required Accounts

- **Supabase account** (for database and authentication)
- **Firebase account** (for additional services)
- **WhatsApp Business account** (for notifications)

## Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/yourusername/beepbite-mono.git
cd beepbite-mono

# Install dependencies
npm install

# Or using yarn
yarn install
```

### 2. Environment Configuration

Create your environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Firebase Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# WhatsApp Configuration
VITE_WHATSAPP_API_URL=your_whatsapp_api_url
VITE_WHATSAPP_TOKEN=your_whatsapp_token

# App Configuration
VITE_APP_URL=http://localhost:5173
VITE_APP_NAME=BeepBite
```

### 3. Database Setup

#### Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Get your project URL and anon key from Settings > API
3. Run the database migration:

```bash
# Create tables using the provided SQL file
# Upload src/table.sql to Supabase SQL Editor and run it
```

The database schema includes:
- `restaurants` - Restaurant information
- `users` - User accounts and roles
- `orders` - Order data
- `reviews` - Customer reviews
- `notifications` - Notification settings

#### Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication and Firestore
3. Add your domain to authorized domains in Authentication settings

### 4. WhatsApp Business API

#### Option A: Using WhatsApp Business API (Recommended for Production)

1. Apply for WhatsApp Business API access
2. Set up a webhook endpoint for receiving messages
3. Configure your phone number for sending notifications

#### Option B: Using WhatsApp Web (Development Only)

For development, you can use a mock service or test with console logging.

## Development

### Start Development Server

```bash
npm run dev
# Or
yarn dev
```

The application will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
# Or
yarn build
```

### Preview Production Build

```bash
npm run preview
# Or
yarn preview
```

## Configuration

### Restaurant Setup

1. **Register your restaurant**:
   - Sign up at `/signup`
   - Complete restaurant profile
   - Verify your email address

2. **Team Management**:
   - Invite team members from Settings
   - Assign roles: Owner, Manager, Staff
   - Configure permissions

3. **WhatsApp Integration**:
   - Go to Settings > Notifications
   - Enter your WhatsApp number
   - Test the connection
   - Configure notification preferences

### Customization

#### Branding

Update branding elements in:
- `src/components/ui/logo.jsx` - Logo component
- `public/` - Favicon and images
- `tailwind.config.js` - Colors and themes

#### Notifications

Configure notification settings in:
- Settings > Notifications (UI)
- Environment variables for API endpoints
- Database `notification_settings` table

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

```bash
# Using Vercel CLI
npm i -g vercel
vercel --prod
```

### Netlify

1. Connect your repository to Netlify
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Configure environment variables

### Traditional Hosting

1. Build the project: `npm run build`
2. Upload `dist/` folder to your web server
3. Configure web server to serve `index.html` for all routes

## Post-Deployment Checklist

- [ ] Test user registration and login
- [ ] Verify WhatsApp notifications work
- [ ] Check order creation and updates
- [ ] Test team member invitations
- [ ] Verify analytics and reporting
- [ ] Test on mobile devices
- [ ] Configure backup and monitoring

## Troubleshooting

### Common Issues

1. **Build Errors**:
   - Clear node_modules: `rm -rf node_modules && npm install`
   - Check Node.js version: `node --version`

2. **Environment Variables Not Loading**:
   - Ensure variables start with `VITE_`
   - Restart development server after changes

3. **Database Connection Issues**:
   - Verify Supabase URL and key
   - Check network connectivity
   - Review Supabase project settings

4. **WhatsApp Integration Not Working**:
   - Verify API credentials
   - Check webhook configuration
   - Test with WhatsApp Business API validator

For more issues, see [Troubleshooting Guide](troubleshooting.md).

## Next Steps

- [User Guide](user-guide.md) - Learn how to use BeepBite
- [Features](features.md) - Explore all available features
- [API Documentation](api.md) - Backend integration details
- [Development Guide](development.md) - Contributing to the project 