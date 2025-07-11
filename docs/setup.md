# Complete POS System Setup Guide

This guide will help you install and configure BeepBite as your restaurant's complete Point of Sale (POS) system, including traditional POS features and enhanced WhatsApp capabilities.

## Prerequisites

### System Requirements

- **Node.js** 18 or higher
- **npm** 8+ or **yarn** 1.22+
- **Modern web browser** (Chrome 90+, Firefox 88+, Safari 14+)
- **Internet connection** for real-time features
- **POS Hardware** (optional): Cash drawer, receipt printer, kitchen display, payment terminal

### Required Accounts

- **Supabase account** (for database and authentication)
- **Firebase account** (for additional services)
- **WhatsApp Business account** (for enhanced features)
- **Payment processor account** (for card transactions)

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

# Payment Processing
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_key
VITE_PAYMENT_PROCESSOR_URL=your_payment_url

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
- `restaurants` - Restaurant and POS configuration
- `users` - Staff accounts and roles
- `orders` - All orders (POS + WhatsApp)
- `inventory` - Stock management and tracking
- `menu_items` - Menu configuration and pricing
- `transactions` - Payment processing records
- `reviews` - Customer feedback
- `notifications` - WhatsApp and system alerts

#### Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication and Firestore
3. Add your domain to authorized domains in Authentication settings

### 4. Payment Processing Setup

#### Stripe Integration (Recommended)

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get your publishable key from the Stripe dashboard
3. Configure webhook endpoints for payment confirmations
4. Test payment processing in development mode

#### Alternative Payment Processors

BeepBite supports multiple payment processors:
- PayPal
- Square
- Adyen
- Local payment gateways

### 5. WhatsApp Business API Setup

#### Option A: WhatsApp Business API (Recommended for Production)

1. Apply for WhatsApp Business API access
2. Set up a webhook endpoint for receiving messages
3. Configure your phone number for sending notifications
4. Set up message templates for customer communications

#### Option B: WhatsApp Web Integration (Development)

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

## POS System Configuration

### Restaurant Setup

1. **Business Registration**:
   - Register your restaurant in the system
   - Complete business profile with tax information
   - Upload restaurant logo and branding
   - Configure operating hours and service areas

2. **POS Terminal Configuration**:
   - Set up payment methods (card, cash, contactless)
   - Configure tax rates and service charges
   - Connect hardware devices (printers, cash drawer)
   - Test payment processing functionality

3. **Menu and Inventory Setup**:
   - Import or create your menu items
   - Set up inventory tracking for ingredients
   - Configure pricing and modifiers
   - Set up categories and menu organization

### Staff Management Setup

1. **Create Staff Accounts**:
   - Set up Owner, Manager, Cashier, and Kitchen Staff accounts
   - Assign appropriate roles and permissions
   - Configure PINs and access controls
   - Set up shift schedules and time tracking

2. **Training and Onboarding**:
   - Train staff on POS system operations
   - Teach WhatsApp integration features
   - Establish operational procedures
   - Test system functionality with staff

### Hardware Configuration

#### Cash Drawer Setup

1. Connect cash drawer to POS terminal or printer
2. Configure opening triggers (start of shift, cash sale)
3. Test cash drawer functionality
4. Set up cash management procedures

#### Receipt Printer Configuration

1. Install printer drivers and connect via USB/Ethernet
2. Configure receipt templates and branding
3. Test printing functionality
4. Set up backup printing options

#### Kitchen Display System

1. Set up dedicated kitchen display screens
2. Configure order routing and priorities
3. Test order flow from POS to kitchen
4. Train kitchen staff on system usage

#### Payment Terminal Integration

1. Connect payment terminal to POS system
2. Configure supported payment methods
3. Test card processing and receipts
4. Set up fallback payment options

## WhatsApp Enhanced Features Setup

### WhatsApp Business Account

1. **Account Creation**:
   - Set up WhatsApp Business account
   - Verify business information
   - Configure business profile with hours and contact info
   - Upload business logo and description

2. **API Integration**:
   - Connect WhatsApp Business API to BeepBite
   - Set up webhook endpoints for message handling
   - Configure message templates for notifications
   - Test WhatsApp connectivity

### Customer Communication Setup

1. **Message Templates**:
   - Create order confirmation templates
   - Set up pickup notification messages
   - Configure delay and update notifications
   - Customize branding and tone

2. **Digital Pager System**:
   - Replace traditional buzzer systems
   - Configure pickup notification timing
   - Set up follow-up reminders
   - Train staff on digital pager workflow

### Remote Ordering Configuration

1. **WhatsApp Menu Setup**:
   - Configure menu for WhatsApp ordering
   - Set availability and pricing
   - Enable order customization options
   - Test remote ordering workflow

2. **Payment Integration**:
   - Set up WhatsApp payment processing
   - Configure payment confirmation system
   - Test remote payment functionality
   - Establish refund procedures

## Deployment

### Production Deployment

#### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Configure custom domain if needed
4. Deploy automatically on push to main branch

```bash
# Using Vercel CLI
npm i -g vercel
vercel --prod
```

#### Netlify Alternative

1. Connect your repository to Netlify
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Configure environment variables

#### Traditional Hosting

1. Build the project: `npm run build`
2. Upload `dist/` folder to your web server
3. Configure web server to serve `index.html` for all routes
4. Set up SSL certificate for secure payments

### Production Configuration

#### Security Setup

1. **SSL/HTTPS Configuration**:
   - Install SSL certificate
   - Redirect HTTP to HTTPS
   - Configure secure payment processing
   - Test security protocols

2. **Data Backup**:
   - Set up automated database backups
   - Configure backup retention policies
   - Test backup and restore procedures
   - Document recovery processes

3. **Access Control**:
   - Configure firewall and security rules
   - Set up VPN access if needed
   - Implement IP restrictions for admin access
   - Monitor system access logs

## Post-Deployment Setup

### System Testing

- [ ] **POS Functionality**: Test all POS operations (orders, payments, receipts)
- [ ] **Inventory Management**: Verify stock tracking and alerts
- [ ] **Staff Access**: Test all user roles and permissions
- [ ] **WhatsApp Integration**: Verify message sending and receiving
- [ ] **Payment Processing**: Test all payment methods
- [ ] **Kitchen Display**: Verify order flow to kitchen
- [ ] **Reporting**: Test analytics and report generation
- [ ] **Mobile Access**: Test on tablets and mobile devices

### Go-Live Checklist

- [ ] Staff training completed
- [ ] Hardware tested and operational
- [ ] Payment processing verified
- [ ] WhatsApp notifications working
- [ ] Backup systems tested
- [ ] Support contacts established
- [ ] Operating procedures documented
- [ ] Emergency procedures in place

### Monitoring and Maintenance

1. **System Monitoring**:
   - Set up uptime monitoring
   - Configure performance alerts
   - Monitor payment processing
   - Track system usage metrics

2. **Regular Maintenance**:
   - Schedule software updates
   - Perform regular backups
   - Review system performance
   - Update security measures

## Migration from Existing POS

### Data Migration

1. **Export from Current System**:
   - Export menu items and pricing
   - Extract customer data
   - Export historical sales data
   - Backup current system settings

2. **Import to BeepBite**:
   - Import menu items and categories
   - Configure pricing and modifiers
   - Set up inventory tracking
   - Import customer information

3. **Parallel Operation**:
   - Run both systems temporarily
   - Compare transaction records
   - Train staff gradually
   - Switch over incrementally

### Hardware Transition

1. **Hardware Assessment**:
   - Evaluate existing hardware compatibility
   - Plan hardware upgrades if needed
   - Configure new hardware connections
   - Test integrated systems

2. **Gradual Transition**:
   - Start with non-peak hours
   - Train staff on new system
   - Monitor performance closely
   - Full switch after confidence

## Troubleshooting

### Common Setup Issues

1. **Database Connection Problems**:
   - Verify Supabase URL and key
   - Check network connectivity
   - Review database permissions
   - Test with sample data

2. **Payment Processing Issues**:
   - Verify payment processor credentials
   - Check SSL certificate configuration
   - Test with small transactions
   - Review payment terminal setup

3. **WhatsApp Integration Problems**:
   - Verify API credentials
   - Check webhook configuration
   - Test with sample messages
   - Review message template compliance

4. **Hardware Integration Issues**:
   - Check hardware connections
   - Verify driver installations
   - Test hardware functionality
   - Review configuration settings

### Performance Optimization

1. **System Performance**:
   - Monitor response times
   - Optimize database queries
   - Configure caching strategies
   - Review hardware resources

2. **Network Optimization**:
   - Test internet connection speed
   - Configure QoS settings
   - Set up redundant connections
   - Monitor network stability

For detailed troubleshooting, see [Troubleshooting Guide](troubleshooting.md).

## Next Steps

After successful setup:

- [User Guide](user-guide.md) - Learn to operate your complete POS system
- [Features](features.md) - Explore all POS and WhatsApp features
- [API Documentation](api.md) - Integration and customization details
- [Development Guide](development.md) - Contributing to the project

## Support

### Setup Assistance

- **Free Setup Call**: Personal onboarding session included
- **Technical Support**: Setup assistance during business hours
- **Documentation**: Comprehensive setup guides and videos
- **Community Forum**: User discussions and best practices

### Ongoing Support

- **24/7 POS Support**: Critical system support
- **WhatsApp Support**: Quick help via WhatsApp
- **Email Support**: support@beepbite.com
- **Phone Support**: +27 11 876 5432

---

**Ready to replace your current POS?** BeepBite provides everything your existing POS system does, plus modern WhatsApp capabilities that enhance customer experience and drive additional revenue. 