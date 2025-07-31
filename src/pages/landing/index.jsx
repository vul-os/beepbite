import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Logo from '@/components/ui/logo';
import ScrollToTop from '@/components/ui/scroll-to-top';
// Import preview components
import DashboardPreview from '@/components/previews/dashboard-preview';
import MenuManagementPreview from '@/components/previews/menu-management-preview';
import WhatsAppPreview from '@/components/previews/whatsapp-preview';
import POSInterfacePreview from '@/components/previews/pos-interface-preview';
import { 
  Bell, 
  Smartphone, 
  Clock, 
  Users, 
  Star, 
  CheckCircle, 
  ArrowRight,
  BarChart3,
  Shield,
  Zap,
  MessageSquare,
  Utensils,
  TrendingUp,
  Sparkles,
  Play,
  Phone,
  Mail,
  MapPin,
  Award,
  Lightbulb,
  Target,
  Heart,
  X,
  Loader2,
  AlertCircle
} from 'lucide-react';

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const LandingPage = () => {
  const navigate = useNavigate();
  
  // Hero animation state
  const [heroStep, setHeroStep] = React.useState(0); // 0: initial, 1: completing, 2: notifications
  const [isAnimating, setIsAnimating] = React.useState(false);

  // Hero animation handler
  const startHeroAnimation = async () => {
    if (isAnimating) return;
    
    setIsAnimating(true);
    setHeroStep(1); // Start completing order
    
    // Step 1: Order completion (2 seconds)
    setTimeout(() => {
      setHeroStep(2); // Show notifications
    }, 2000);
    
    // Step 2: Reset after showing notifications (4 seconds)
    setTimeout(() => {
      setHeroStep(0);
      setIsAnimating(false);
    }, 6000);
  };

  // Smooth scroll function
  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const features = [
    {
      icon: <WhatsAppIcon className="w-5 h-5" />,
      title: "Complete POS + WhatsApp",
      description: "Full traditional point of sale system with all standard restaurant features, PLUS WhatsApp ordering, payments, and customer notifications."
    },
    {
      icon: <Clock className="w-5 h-5" />,
      title: "Digital Restaurant Pagers", 
      description: "Replace old buzzer systems with modern WhatsApp notifications. Works alongside your normal POS operations for dine-in and takeaway."
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "Traditional POS Features",
      description: "Complete restaurant POS with inventory management, staff controls, reporting, and payment processing - everything you expect from a modern POS system."
    },
    {
      icon: <Star className="w-5 h-5" />,
      title: "Dual Order Channels",
      description: "Take orders normally through your POS terminal AND accept WhatsApp orders. One system handles both in-restaurant and remote customers."
    },
    {
      icon: <Heart className="w-5 h-5" />,
      title: "Standard + WhatsApp Payments",
      description: "Process card payments, cash, and contactless like any POS, plus accept payments directly through WhatsApp for remote orders."
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: "Enhanced Restaurant Operations",
      description: "Everything your current POS does - sales tracking, menu management, staff functions - enhanced with WhatsApp customer engagement."
    }
  ];

  const stats = [
    { number: "Ready", label: "For Your Restaurant", icon: <BarChart3 className="w-5 h-5" /> },
    { number: "Complete", label: "POS System", icon: <Utensils className="w-5 h-5" /> },
    { number: "Modern", label: "WhatsApp Integration", icon: <Shield className="w-5 h-5" /> },
    { number: "Instant", label: "Setup Available", icon: <Zap className="w-5 h-5" /> }
  ];

  const steps = [
    {
      step: "01",
      title: "Setup Your Complete POS System",
      description: "Install BeepBite as your main restaurant POS - handles all traditional operations plus WhatsApp integration. Works for dine-in, takeaway, and remote orders.",
      icon: <Utensils className="w-6 h-6" />
    }
  ];

  const benefits = [
    {
      icon: <Zap className="w-5 h-5" />,
      title: "Full Traditional POS",
      description: "Complete point of sale with all standard restaurant features you expect"
    },
    {
      icon: <Heart className="w-5 h-5" />,
      title: "Plus Digital Pagers",
      description: "Traditional POS operations enhanced with WhatsApp notifications"
    },
    {
      icon: <MessageSquare className="w-5 h-5" />,
      title: "Dual Order Channels",
      description: "In-restaurant POS orders AND WhatsApp remote orders in one system"
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "Everything You Need",
      description: "Inventory, staff management, reporting, payments - standard POS plus more"
    }
  ];

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Hero Section - Mobile responsive */}
      <section id="home" className="relative pt-20 pb-12 sm:py-16 lg:py-24 xl:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
              {/* Left Content - Mobile optimized */}
              <div className="space-y-6 lg:space-y-8">
                <div className="space-y-4 lg:space-y-6">
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight text-gray-900">
                    Complete Restaurant POS with <span className="text-orange-500">WhatsApp Integration</span>
                  </h1>
                  
                  <p className="text-lg sm:text-xl text-gray-600 leading-relaxed">
                    Full-featured point of sale system designed for restaurants, enhanced with WhatsApp 
                    ordering, payments, and digital customer notifications.
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button 
                    size="lg" 
                    className="bg-orange-500 hover:bg-orange-600 text-white px-6 sm:px-8 py-3 sm:py-4 text-base rounded-lg transition-colors w-full sm:w-auto"
                    onClick={() => navigate('/signup')}
                  >
                    Start Free Trial
                  </Button>
                  <Button 
                    size="lg" 
                    variant="outline" 
                    className="border-2 border-gray-300 text-gray-700 px-6 sm:px-8 py-3 sm:py-4 text-base rounded-lg hover:border-orange-500 hover:text-orange-500 transition-colors w-full sm:w-auto"
                    onClick={() => navigate('/signup')}
                  >
                    Learn More
                  </Button>
                </div>

                {/* Mobile optimized trust indicators */}
                <div className="flex flex-wrap gap-4 sm:gap-6 pt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <span className="text-sm text-gray-600 font-medium">Full POS System</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <span className="text-sm text-gray-600 font-medium">WhatsApp Integration</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <span className="text-sm text-gray-600 font-medium">Digital Pagers</span>
                  </div>
                </div>
              </div>

              {/* Right Visual - Mobile responsive */}
              <div className="relative max-w-md mx-auto lg:max-w-none">
                {/* Step 0: Clean Dashboard with orange highlights */}
                {heroStep === 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-lg">
                    <div className="bg-gray-50 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-2">
                          <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-red-400"></div>
                          <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-yellow-400"></div>
                          <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-green-400"></div>
                        </div>
                        <h3 className="font-medium text-gray-900 text-sm sm:text-base">BeepBite POS</h3>
                        <Badge className="ml-auto bg-green-100 text-green-800 text-xs">
                          Live Orders
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="p-4 sm:p-6 space-y-4">
                      <div className="p-3 sm:p-4 rounded-lg border border-orange-200 bg-orange-50">
                        <div className="space-y-2 sm:space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-900 text-sm sm:text-base">#2847</span>
                            <Badge className="bg-orange-500 text-white text-xs">
                              cooking
                            </Badge>
                          </div>
                          <p className="font-medium text-gray-900 text-sm sm:text-base">Maria G.</p>
                          <p className="text-xs sm:text-sm text-gray-600">2x Spicy Burger, 1x Fries • R180.00</p>
                          <p className="text-xs text-gray-500">Paid via WhatsApp • 5 min ago</p>
                        </div>
                      </div>

                      <div className="text-center pt-2 sm:pt-4">
                        <Button 
                          onClick={startHeroAnimation}
                          disabled={isAnimating}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-4 sm:px-6 py-2 rounded-lg text-sm w-full sm:w-auto"
                        >
                          Mark Order Ready
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Animation steps with orange accents - Mobile optimized */}
                {heroStep === 1 && (
                  <div className="bg-white rounded-2xl border border-orange-200 overflow-hidden shadow-lg">
                    <div className="bg-orange-50 px-4 sm:px-6 py-3 sm:py-4 border-b border-orange-200">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-2">
                          <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-orange-400"></div>
                          <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-orange-400"></div>
                          <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-orange-400"></div>
                        </div>
                        <h3 className="font-medium text-gray-900 text-sm sm:text-base">Order Ready!</h3>
                      </div>
                    </div>
                    
                    <div className="p-4 sm:p-6 text-center space-y-4">
                      <div className="w-10 sm:w-12 h-10 sm:h-12 bg-orange-500 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900">Order #2847 Ready!</h3>
                        <p className="text-gray-600 text-sm sm:text-base">Sending pickup notification via WhatsApp...</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Final notification state - Mobile optimized */}
                {heroStep === 2 && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-gray-200 p-3 sm:p-4 shadow-lg">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-6 sm:w-8 h-6 sm:h-8 bg-orange-500 rounded-full flex items-center justify-center">
                          <span className="text-white font-medium text-xs">MG</span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Maria G.</div>
                          <div className="text-xs text-gray-500">+27 82 555 0123</div>
                        </div>
                        <WhatsAppIcon className="w-4 h-4 text-green-500 ml-auto" />
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                        <div className="text-sm">
                          <div className="font-medium text-green-800 mb-1">🍔 BeepBite - Order Ready!</div>
                          <div className="text-gray-700 text-xs sm:text-sm">Order #2847 (R180.00) is ready for pickup!</div>
                          <div className="text-xs text-gray-500 mt-1">Just now</div>
                        </div>
                      </div>
                    </div>

                    <div className="text-center">
                      <Button 
                        onClick={startHeroAnimation}
                        variant="outline"
                        className="border border-orange-500 text-orange-500 px-4 py-2 rounded-lg text-sm hover:bg-orange-50 w-full sm:w-auto"
                      >
                        See it again
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Trust indicators - Mobile responsive */}
        <section className="py-12 sm:py-16 border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 text-center">
              {stats.map((stat, i) => (
                <div key={i} className="space-y-2 sm:space-y-3">
                  <div className="flex justify-center mb-2 sm:mb-3">
                    <div className="text-orange-500">
                      {stat.icon}
                    </div>
                  </div>
                  <div className="text-lg sm:text-xl font-semibold text-gray-900">
                    {stat.number}
                  </div>
                  <div className="text-xs sm:text-sm text-gray-600 leading-tight">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section - Mobile responsive */}
        <section id="features" className="py-16 sm:py-20 lg:py-24 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 sm:mb-6 text-gray-900">
                Everything you need to run your restaurant
              </h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Modern restaurant point of sale system with all the features you need, enhanced with <span className="text-orange-500 font-semibold">WhatsApp ordering, payments, and digital notifications.</span>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {features.map((feature, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8 hover:border-orange-200 transition-colors">
                  <div className="mb-4 sm:mb-6">
                    <div className="w-10 sm:w-12 h-10 sm:h-12 bg-orange-50 rounded-lg flex items-center justify-center text-orange-500">
                      {feature.icon}
                    </div>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">{feature.title}</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Product Previews Section - Hidden on mobile */}
        <section id="product-previews" className="hidden lg:block py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl lg:text-5xl font-bold mb-6 text-gray-900">
                See <span className="text-orange-500">BeepBite</span> in action
              </h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Interactive previews of our complete POS system and WhatsApp integration features
              </p>
            </div>

            <div className="space-y-24">
              {/* Dashboard Analytics Preview */}
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-5 h-5 text-orange-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900">Real-time Analytics Dashboard</h3>
                  </div>
                  <p className="text-lg text-gray-600 leading-relaxed">
                    Monitor your restaurant's performance with comprehensive analytics. Track revenue, orders, 
                    customer data, and channel performance across both traditional POS and WhatsApp orders.
                  </p>
                  <ul className="space-y-2 text-gray-600">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Live order tracking and revenue metrics
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Channel performance comparison (POS vs WhatsApp)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Top-selling items and inventory insights
                    </li>
                  </ul>
                </div>
                <div className="lg:order-first">
                  <div className="w-full overflow-hidden rounded-2xl relative">
                    <div className="transform scale-95 md:scale-100 lg:scale-100 origin-top-left transition-transform duration-300">
                      <DashboardPreview className="w-full" style={{ maxWidth: '650px' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Menu Management Preview */}
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <Star className="w-5 h-5 text-orange-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900">Smart Menu Management</h3>
                  </div>
                  <p className="text-lg text-gray-600 leading-relaxed">
                    Manage your restaurant's menu items, pricing, and inventory from one central location. 
                    Changes sync instantly across both your POS system and WhatsApp ordering.
                  </p>
                  <ul className="space-y-2 text-gray-600">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Real-time inventory tracking
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Instant menu updates across all channels
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Low stock alerts and management
                    </li>
                  </ul>
                </div>
                <div>
                  <div className="w-full overflow-hidden rounded-2xl relative">
                    <div className="transform scale-90 md:scale-95 lg:scale-100 origin-top-left transition-transform duration-300">
                      <MenuManagementPreview className="w-full" style={{ maxWidth: '700px' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* POS Interface Preview */}
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <Utensils className="w-5 h-5 text-orange-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900">Complete POS Interface</h3>
                  </div>
                  <p className="text-lg text-gray-600 leading-relaxed">
                    Full-featured point of sale system with order management, menu browsing, and cart functionality. 
                    Handle both walk-in customers and WhatsApp orders from one unified interface.
                  </p>
                  <ul className="space-y-2 text-gray-600">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Unified order management for all channels
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Quick menu item selection and search
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Real-time order status tracking
                    </li>
                  </ul>
                </div>
                <div>
                  <div className="w-full overflow-hidden rounded-2xl relative">
                    <div className="transform scale-95 md:scale-100 lg:scale-100 origin-top-left transition-transform duration-300">
                      <POSInterfacePreview className="w-full" style={{ maxWidth: '550px' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* WhatsApp Integration Preview */}
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-green-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900">WhatsApp Digital Pagers</h3>
                  </div>
                  <p className="text-lg text-gray-600 leading-relaxed">
                    Replace traditional buzzer systems with smart WhatsApp notifications. Customers can order 
                    directly through WhatsApp and receive automatic pickup notifications when their food is ready.
                  </p>
                  <ul className="space-y-2 text-gray-600">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Direct WhatsApp ordering and payment
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Automatic order ready notifications
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Professional branded messaging
                    </li>
                  </ul>
                </div>
                <div className="lg:order-first">
                  <div className="w-full overflow-hidden rounded-2xl relative">
                    <div className="transform scale-95 md:scale-100 lg:scale-100 origin-top-left transition-transform duration-300">
                      <WhatsAppPreview className="w-full" style={{ maxWidth: '550px' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Call to Action within previews */}
            <div className="text-center mt-16 pt-12 border-t border-gray-100">
              <h3 className="text-2xl font-bold mb-4 text-gray-900">Ready to try BeepBite?</h3>
              <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
                Experience all these features and more with our free trial. No credit card required.
              </p>
              <Button 
                size="lg" 
                className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-lg"
                onClick={() => navigate('/signup')}
              >
                Start Free Trial
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </section>

        {/* Benefits Section - Mobile responsive */}
        <section id="benefits" className="py-16 sm:py-20 lg:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 sm:mb-6 text-gray-900">
                Why choose <span className="text-orange-500">BeepBite</span>
              </h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Get all traditional POS features you need, plus WhatsApp capabilities your current system doesn't have.
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
              {benefits.map((benefit, i) => (
                <div key={i} className="text-center">
                  <div className="mb-4 flex justify-center">
                    <div className="w-10 sm:w-12 h-10 sm:h-12 bg-orange-50 rounded-lg flex items-center justify-center text-orange-500">
                      {benefit.icon}
                    </div>
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold mb-3 text-gray-900">{benefit.title}</h3>
                  <p className="text-gray-600 text-sm sm:text-base">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works - Mobile responsive */}
        <section id="how-it-works" className="py-16 sm:py-20 lg:py-24 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 sm:mb-6 text-gray-900">How it works</h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Replace your current POS with a system that does everything it does, plus <span className="text-orange-500 font-semibold">WhatsApp integration</span>
              </p>
            </div>

            <div className="max-w-2xl mx-auto text-center">
              {steps.map((step, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
                  <div className="mb-4 sm:mb-6">
                    <div className="w-12 sm:w-16 h-12 sm:h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto text-orange-500">
                      {step.icon}
                    </div>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-semibold mb-3 sm:mb-4 text-gray-900">{step.title}</h3>
                  <p className="text-gray-600 leading-relaxed text-base sm:text-lg">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Support Section - Mobile responsive */}
        <section id="support" className="py-16 sm:py-20 lg:py-24 bg-gray-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 sm:mb-6">Need help?</h2>
              <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto">
                Our team helps restaurants transition from their current POS to BeepBite's enhanced system
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 max-w-4xl mx-auto">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                    <WhatsAppIcon className="w-4 sm:w-5 h-4 sm:h-5 text-green-400" />
                  </div>
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-3">WhatsApp Support</h3>
                <p className="text-gray-400 mb-4 text-sm sm:text-base">Quick help via WhatsApp</p>
                <a 
                  href="https://wa.me/27118765432" 
                  className="inline-flex items-center gap-2 bg-green-600 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm hover:bg-green-700 transition-colors w-full justify-center sm:w-auto"
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Message Us
                </a>
              </div>
              
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                    <Mail className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400" />
                  </div>
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-3">Email Support</h3>
                <p className="text-gray-400 mb-4 text-sm sm:text-base">Get detailed assistance</p>
                <a 
                  href="mailto:support@beepbite.io" 
                  className="inline-flex items-center gap-2 bg-orange-500 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm hover:bg-orange-600 transition-colors w-full justify-center sm:w-auto"
                >
                  Email Us
                </a>
              </div>
              
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                    <Phone className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400" />
                  </div>
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-3">Phone Support</h3>
                <p className="text-gray-400 mb-4 text-sm sm:text-base">Speak directly with our team</p>
                <a 
                  href="tel:+27118765432" 
                  className="inline-flex items-center gap-2 bg-orange-500 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm hover:bg-orange-600 transition-colors w-full justify-center sm:w-auto"
                >
                  Call Us
                </a>
              </div>
              
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                    <svg className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-3">Documentation</h3>
                <p className="text-gray-400 mb-4 text-sm sm:text-base">Self-service help guides</p>
                <a 
                  href="/docs" 
                  className="inline-flex items-center gap-2 bg-gray-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm hover:bg-gray-600 transition-colors border border-gray-600 w-full justify-center sm:w-auto"
                >
                  View Docs
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section - Mobile responsive */}
        <section id="get-started" className="py-16 sm:py-20 lg:py-24 bg-orange-500 text-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl lg:text-6xl font-bold mb-6 sm:mb-8">
              Ready to upgrade your POS system?
            </h2>
            <p className="text-lg sm:text-xl text-orange-100 mb-8 sm:mb-12 max-w-2xl mx-auto">
              Modern POS system with all the features you need, plus WhatsApp ordering, payments, and digital notifications.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                className="bg-white text-orange-500 hover:bg-gray-50 px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg rounded-lg font-semibold w-full sm:w-auto"
                onClick={() => navigate('/signup')}
              >
                Start Free Trial
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                className="border-2 border-white text-white :bg-white hover:text-orange-500 px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg rounded-lg font-semibold w-full sm:w-auto"
                onClick={() => navigate('/signup')}
              >
                Get Started
              </Button>
            </div>
          </div>
        </section>

        {/* Footer - Mobile responsive */}
        <footer className="bg-white border-t border-gray-200 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
              <div className="col-span-2 md:col-span-1">
                <Logo variant="minimal" className="text-left mb-4" />
                <p className="text-gray-600 text-sm leading-relaxed">
                  Complete restaurant POS system with <span className="text-orange-500 font-medium">WhatsApp ordering, payments, and digital customer notifications.</span>
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold mb-3 sm:mb-4 text-gray-900 text-sm sm:text-base">Product</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  <li><button onClick={() => scrollToSection('features')} className="hover:text-orange-500 transition-colors">Features</button></li>
                  <li><button onClick={() => scrollToSection('how-it-works')} className="hover:text-orange-500 transition-colors">How It Works</button></li>
                  <li><button onClick={() => scrollToSection('get-started')} className="hover:text-orange-500 transition-colors">Get Started</button></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold mb-3 sm:mb-4 text-gray-900 text-sm sm:text-base">Company</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  <li><button onClick={() => scrollToSection('home')} className="hover:text-orange-500 transition-colors">Home</button></li>
                  <li><button onClick={() => scrollToSection('benefits')} className="hover:text-orange-500 transition-colors">Benefits</button></li>
                  <li><button onClick={() => scrollToSection('support')} className="hover:text-orange-500 transition-colors">Support</button></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold mb-3 sm:mb-4 text-gray-900 text-sm sm:text-base">Legal</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  <li><a href="/docs/privacy" className="hover:text-orange-500 transition-colors">Privacy Policy</a></li>
                  <li><a href="/docs/terms" className="hover:text-orange-500 transition-colors">Terms of Service</a></li>
                  <li><a href="/docs" className="hover:text-orange-500 transition-colors">Documentation</a></li>
                </ul>
              </div>
            </div>
            
            <div className="border-t border-gray-200 mt-8 sm:mt-12 pt-6 sm:pt-8">
              <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                <p className="text-gray-500 text-xs sm:text-sm text-center md:text-left">
                  &copy; {new Date().getFullYear()} BeepBite Pty, a member of Exolution Technologies Pty
                </p>
                <button 
                  onClick={() => scrollToSection('home')} 
                  className="text-gray-500 hover:text-orange-500 text-xs sm:text-sm transition-colors"
                >
                  Back to Top
                </button>
              </div>
            </div>
          </div>
        </footer>

        {/* Scroll to Top Button */}
        <ScrollToTop />
      </div>
    );
  };

  export default LandingPage;
