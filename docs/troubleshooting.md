# Troubleshooting Guide

This guide helps you resolve common issues with BeepBite quickly and efficiently.

## Quick Diagnostics

### System Check

Before troubleshooting specific issues, verify your system meets requirements:

```bash
# Check Node.js version (should be 18+)
node --version

# Check npm version
npm --version

# Check if BeepBite is running
curl http://localhost:5173
```

### Browser Compatibility

**Supported Browsers:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Clear Browser Data:**
1. Clear cache and cookies
2. Disable browser extensions
3. Try incognito/private mode

## Installation Issues

### Node.js Version Conflicts

**Problem**: Build fails with Node.js version errors

**Solution:**
```bash
# Install Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node.js 18
nvm install 18
nvm use 18

# Verify version
node --version
```

### Dependency Installation Failures

**Problem**: `npm install` fails with permission or network errors

**Solutions:**

#### Permission Issues (macOS/Linux)
```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules

# Or use a Node version manager (recommended)
```

#### Network/Proxy Issues
```bash
# Configure npm registry
npm config set registry https://registry.npmjs.org/

# For corporate networks
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080
```

#### Cache Issues
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Port Already in Use

**Problem**: Development server can't start on port 5173

**Solution:**
```bash
# Find process using port 5173
lsof -i :5173

# Kill the process
kill -9 <PID>

# Or use different port
npm run dev -- --port 3000
```

## Environment Configuration

### Environment Variables Not Loading

**Problem**: Configuration not working, API calls failing

**Checklist:**
1. ✅ Variables start with `VITE_`
2. ✅ `.env.local` file exists in root directory
3. ✅ No spaces around `=` in env file
4. ✅ Restart development server after changes

**Example `.env.local`:**
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_APP_URL=http://localhost:5173
```

**Debug Environment Variables:**
```javascript
// Add to your component
console.log('Environment:', {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  appUrl: import.meta.env.VITE_APP_URL
});
```

### Database Connection Issues

**Problem**: Can't connect to Supabase or Firebase

**Check:**
1. **Supabase URL and Key**: Verify in Supabase dashboard
2. **Network Access**: Check firewall/proxy settings
3. **Project Status**: Ensure Supabase project is active
4. **API Limits**: Check if you've exceeded rate limits

**Test Connection:**
```javascript
// Add to a component for testing
useEffect(() => {
  const testConnection = async () => {
    try {
      const { data, error } = await supabase.from('restaurants').select('count');
      console.log('Database connection:', data ? 'Success' : 'Failed', error);
    } catch (err) {
      console.error('Connection test failed:', err);
    }
  };
  testConnection();
}, []);
```

## Authentication Issues

### Login/Signup Not Working

**Problem**: Users can't authenticate

**Check:**
1. **Email Configuration**: Verify email provider settings
2. **Redirect URLs**: Ensure correct URLs in auth settings
3. **Network Issues**: Check if auth requests are blocked

**Debug Steps:**
```javascript
// Enable auth debugging
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event, session);
});
```

### Session Persistence Issues

**Problem**: Users get logged out frequently

**Solutions:**
1. **Check Storage**: Ensure localStorage/sessionStorage works
2. **Token Expiry**: Review token refresh settings
3. **Browser Settings**: Check if cookies are blocked

```javascript
// Check session status
console.log('Current session:', await supabase.auth.getSession());
```

### Password Reset Not Working

**Problem**: Password reset emails not received

**Check:**
1. **Spam Folder**: Often filtered by email providers
2. **Email Templates**: Verify in Supabase Auth settings
3. **SMTP Configuration**: Check email service setup

## WhatsApp Integration

### Notifications Not Sending

**Problem**: WhatsApp notifications fail to send

**Troubleshooting:**

#### 1. Verify Phone Number Format
```javascript
// Correct format: +[country code][phone number]
const phoneNumber = "+1234567890"; // ✅ Correct
const phoneNumber = "1234567890";   // ❌ Incorrect
const phoneNumber = "1-234-567-890"; // ❌ Incorrect
```

#### 2. Check WhatsApp Business API Status
```bash
# Test API endpoint
curl -X GET "https://graph.facebook.com/v17.0/YOUR_PHONE_NUMBER_ID" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### 3. Verify Webhook Configuration
```javascript
// Webhook endpoint should be publicly accessible
// Use ngrok for local testing
npx ngrok http 5173
```

#### 4. Test with WhatsApp API Tester
Use Facebook's API testing tools to verify setup.

### Message Template Issues

**Problem**: Messages rejected due to template violations

**Solutions:**
1. **Use Approved Templates**: Only use pre-approved message templates
2. **Variable Formatting**: Ensure variables match template exactly
3. **24-Hour Window**: Send template messages within 24 hours of user interaction

## Performance Issues

### Slow Page Loading

**Problem**: App takes too long to load

**Optimization Steps:**

#### 1. Check Bundle Size
```bash
# Analyze bundle
npm run build
npm run preview

# Use bundle analyzer
npm install --save-dev rollup-plugin-analyzer
```

#### 2. Enable Compression
```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    compression({
      algorithm: 'gzip'
    })
  ]
});
```

#### 3. Optimize Images
```bash
# Convert images to WebP
npm install --save-dev @squoosh/lib

# Use in build process or manually convert
```

### Memory Leaks

**Problem**: Browser becomes unresponsive after extended use

**Debug Steps:**

#### 1. Check for Uncleared Intervals/Timeouts
```javascript
// ❌ Bad - creates memory leak
useEffect(() => {
  const interval = setInterval(() => {
    // some work
  }, 1000);
  // Missing cleanup!
}, []);

// ✅ Good - proper cleanup
useEffect(() => {
  const interval = setInterval(() => {
    // some work
  }, 1000);
  return () => clearInterval(interval);
}, []);
```

#### 2. Check Event Listeners
```javascript
// ❌ Bad
useEffect(() => {
  window.addEventListener('resize', handleResize);
}, []);

// ✅ Good
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

## Network Issues

### API Requests Failing

**Problem**: Requests to backend APIs fail

**Debug Network Requests:**

#### 1. Check Browser Network Tab
1. Open Developer Tools (F12)
2. Go to Network tab
3. Reproduce the issue
4. Look for failed requests (red status codes)

#### 2. CORS Issues
**Error**: `Access to fetch at '...' from origin '...' has been blocked by CORS policy`

**Solution**: Configure CORS in your backend or use a proxy:

```javascript
// vite.config.js
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
```

#### 3. Network Timeouts
```javascript
// Add timeout to requests
const controller = new AbortController();
setTimeout(() => controller.abort(), 10000); // 10 second timeout

fetch('/api/orders', {
  signal: controller.signal
}).catch(err => {
  if (err.name === 'AbortError') {
    console.log('Request timed out');
  }
});
```

### Offline Functionality

**Problem**: App doesn't work without internet

**Solutions:**

#### 1. Enable Service Worker
```javascript
// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

#### 2. Cache API Responses
```javascript
// Use browser cache for offline support
const cache = await caches.open('beepbite-v1');
await cache.addAll(['/api/menu', '/api/restaurants']);
```

## Mobile Issues

### Touch/Gesture Problems

**Problem**: Touch interactions don't work properly

**Solutions:**

#### 1. Add Touch-Friendly CSS
```css
/* Improve touch targets */
.button {
  min-height: 44px; /* iOS recommended minimum */
  min-width: 44px;
}

/* Prevent zoom on input focus */
input {
  font-size: 16px; /* Prevents iOS zoom */
}
```

#### 2. Handle Touch Events
```javascript
// Add touch event handlers
const handleTouchStart = (e) => {
  // Handle touch start
};

<div onTouchStart={handleTouchStart}>
  Content
</div>
```

### PWA Installation Issues

**Problem**: "Add to Home Screen" not working

**Check:**
1. **HTTPS**: PWA requires secure connection
2. **Manifest File**: Verify `manifest.json` is correct
3. **Service Worker**: Must be registered
4. **Icons**: Required sizes must be available

```json
// public/manifest.json
{
  "name": "BeepBite",
  "short_name": "BeepBite",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ff6b35",
  "icons": [
    {
      "src": "/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

## Development Issues

### Hot Reload Not Working

**Problem**: Changes don't reflect automatically

**Solutions:**

#### 1. Clear Vite Cache
```bash
rm -rf node_modules/.vite
npm run dev
```

#### 2. Check File Watchers
```bash
# Increase file watcher limit (Linux)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

#### 3. Disable Antivirus Real-time Scanning
Temporarily disable real-time scanning for the project folder.

### Import/Export Errors

**Problem**: Module resolution fails

**Common Issues:**

#### 1. Incorrect Path Aliases
```javascript
// ❌ Wrong
import Button from 'components/ui/button';

// ✅ Correct
import Button from '@/components/ui/button';
```

#### 2. Missing File Extensions
```javascript
// ❌ Wrong
import utils from './utils';

// ✅ Correct
import utils from './utils.js';
```

#### 3. Case Sensitivity
```javascript
// ❌ Wrong (if file is Button.jsx)
import button from './Button';

// ✅ Correct
import Button from './Button';
```

### Build Failures

**Problem**: Production build fails

**Common Causes:**

#### 1. Environment Variables
```bash
# Ensure all required env vars are set
npm run build 2>&1 | grep "undefined"
```

#### 2. Memory Issues
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

#### 3. TypeScript Errors
```bash
# Check for type errors
npx tsc --noEmit
```

## Database Issues

### Supabase Connection Problems

**Problem**: Database queries fail

**Debug Steps:**

#### 1. Test Database Connection
```javascript
const testDb = async () => {
  const { data, error } = await supabase
    .from('restaurants')
    .select('count')
    .single();
  
  console.log('DB Test:', { data, error });
};
```

#### 2. Check Row Level Security (RLS)
```sql
-- Verify RLS policies in Supabase SQL editor
SELECT * FROM pg_policies WHERE tablename = 'orders';
```

#### 3. Query Performance
```javascript
// Add explain to slow queries
const { data, error } = await supabase
  .from('orders')
  .select('*')
  .explain({ analyze: true });
```

### Data Sync Issues

**Problem**: Real-time updates not working

**Solutions:**

#### 1. Check Realtime Subscription
```javascript
const subscription = supabase
  .channel('orders')
  .on('postgres_changes', 
    { event: '*', schema: 'public', table: 'orders' },
    (payload) => console.log('Change received!', payload)
  )
  .subscribe();

// Clean up
return () => subscription.unsubscribe();
```

#### 2. Verify Table Permissions
Enable realtime in Supabase dashboard for affected tables.

## Getting Additional Help

### Log Collection

When reporting issues, include:

```bash
# System information
npm --version
node --version
cat package.json | grep version

# Browser console errors
# Network tab errors
# Build output logs
```

### Support Channels

1. **GitHub Issues**: [github.com/yourusername/beepbite-mono/issues](https://github.com/yourusername/beepbite-mono/issues)
2. **Email Support**: support@beepbite.com
3. **Discord Community**: [discord.gg/beepbite](https://discord.gg/beepbite)
4. **Documentation**: [docs/](../)

### Emergency Contacts

- **Critical Production Issues**: emergency@beepbite.com
- **Security Issues**: security@beepbite.com
- **Phone Support**: +1-800-BEEPBITE (Enterprise plans only)

---

## Still Need Help?

If this guide doesn't resolve your issue:

1. **Search existing issues** on GitHub
2. **Create a detailed bug report** with:
   - Steps to reproduce
   - Expected vs actual behavior
   - System information
   - Console errors/logs
3. **Include screenshots** or screen recordings if helpful

Our support team typically responds within 24 hours for free plans and 4 hours for paid plans. 