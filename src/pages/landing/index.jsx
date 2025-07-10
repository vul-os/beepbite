import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Logo from '@/components/ui/logo';
import ScrollToTop from '@/components/ui/scroll-to-top';
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
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/services/supabase-client";

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const LandingPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
   // Demo modal state
  const [isDemoOpen, setIsDemoOpen] = React.useState(false);
  const [phoneNumber, setPhoneNumber] = React.useState('+27');
  const [isLoading, setIsLoading] = React.useState(false);
  const [demoError, setDemoError] = React.useState('');
  const [demoSuccess, setDemoSuccess] = React.useState(false);

  // Hero animation state
  const [heroStep, setHeroStep] = React.useState(0); // 0: initial, 1: completing, 2: notifications
  const [isAnimating, setIsAnimating] = React.useState(false);


  // Helper function to normalize phone numbers (remove + prefix)
  const normalizePhoneNumber = (phone) => {
    const trimmed = phone.trim();
    return trimmed.startsWith('+') ? trimmed.substring(1) : trimmed;
  };

  // Handle demo submission
  const handleDemoSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setDemoError('');
    
    try {
      // Normalize phone number before processing
      const normalizedPhone = normalizePhoneNumber(phoneNumber);

      // Validate phone number
      if (!normalizedPhone || normalizedPhone.length < 10) {
        setDemoError('Please enter a valid phone number');
        setIsLoading(false);
        return;
      }


      // Call Supabase function
      const { data, error } = await supabase.functions.invoke('landing-whatsapp-demo', {
        body: {
          recaptcha_token: "",
          action: 'whatsapp_demo',
          cell_number: normalizedPhone
        }
      });

      if (error) {
        setDemoError(error.message || 'Failed to send demo message');
        return;
      }

      if (!data.success) {
        setDemoError(data.error || 'Failed to send demo message');
        return;
      }

      setDemoSuccess(true);
      toast({
        title: "Demo sent successfully! 🎉",
        description: `Check your WhatsApp for a demo notification (template message)`,
      });

    } catch (error) {
      setDemoError(error.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetDemo = () => {
    setDemoSuccess(false);
    setDemoError('');
    setPhoneNumber('+27');
  };

  const openDemo = () => {
    resetDemo();
    setIsDemoOpen(true);
  };

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
      icon: <WhatsAppIcon className="w-6 h-6" />,
      title: "Complete POS + WhatsApp",
      description: "Full traditional point of sale system with all standard restaurant features, PLUS WhatsApp ordering, payments, and customer notifications.",
      highlight: true
    },
    {
      icon: <Clock className="w-6 h-6" />,
      title: "Digital Restaurant Pagers", 
      description: "Replace old buzzer systems with modern WhatsApp notifications. Works alongside your normal POS operations for dine-in and takeaway.",
      highlight: false
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Traditional POS Features",
      description: "Complete restaurant POS with inventory management, staff controls, reporting, and payment processing - everything you expect from a modern POS system.",
      highlight: false
    },
    {
      icon: <Star className="w-6 h-6" />,
      title: "Dual Order Channels",
      description: "Take orders normally through your POS terminal AND accept WhatsApp orders. One system handles both in-restaurant and remote customers.",
      highlight: false
    },
    {
      icon: <Heart className="w-6 h-6" />,
      title: "Standard + WhatsApp Payments",
      description: "Process card payments, cash, and contactless like any POS, plus accept payments directly through WhatsApp for remote orders.",
      highlight: false
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Enhanced Restaurant Operations",
      description: "Everything your current POS does - sales tracking, menu management, staff functions - enhanced with WhatsApp customer engagement.",
      highlight: false
    }
  ];

  const stats = [
    { number: "15,000+", label: "Orders Processed Daily", icon: <BarChart3 className="w-6 h-6" /> },
    { number: "800+", label: "Active Restaurants", icon: <Utensils className="w-6 h-6" /> },
    { number: "99.9%", label: "System Uptime", icon: <Shield className="w-6 h-6" /> },
    { number: "<1s", label: "WhatsApp Response Time", icon: <Zap className="w-6 h-6" /> }
  ];

  const testimonials = [
    {
      name: "Maria Rodriguez",
      restaurant: "Casa Maria Bistro",
      location: "Miami, FL",
      rating: 5,
      text: "BeepBite works perfectly as our main POS system for dine-in customers, but the WhatsApp ordering has opened up a whole new revenue stream. Best of both worlds!",
      avatar: "MR"
    },
    {
      name: "Ahmed Hassan", 
      restaurant: "Spice Garden",
      location: "Houston, TX",
      rating: 5,
      text: "We use it just like our old POS for normal restaurant operations, but now we can also take WhatsApp orders and send digital notifications. Game changer.",
      avatar: "AH"
    },
    {
      name: "Sarah Chen",
      restaurant: "Golden Dragon",
      location: "San Francisco, CA", 
      rating: 5,
      text: "Full POS functionality we need for daily operations, plus the WhatsApp features give us an edge over competitors. Finally ditched those buzzer pagers too!",
      avatar: "SC"
    }
  ];

  const steps = [
    {
      step: "01",
      title: "Setup Your Complete POS System",
      description: "Install BeepBite as your main restaurant POS - handles all traditional operations plus WhatsApp integration. Works for dine-in, takeaway, and remote orders.",
      icon: <Utensils className="w-8 h-8" />
    }
  ];

  const benefits = [
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Full Traditional POS",
      description: "Complete point of sale with all standard restaurant features you expect"
    },
    {
      icon: <Heart className="w-6 h-6" />,
      title: "Plus Digital Pagers",
      description: "Traditional POS operations enhanced with WhatsApp notifications"
    },
    {
      icon: <MessageSquare className="w-6 h-6" />,
      title: "Dual Order Channels",
      description: "In-restaurant POS orders AND WhatsApp remote orders in one system"
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Everything You Need",
      description: "Inventory, staff management, reporting, payments - standard POS plus more"
    }
  ];

  return (
    <div className="min-h-screen bg-white overflow-hidden relative">
      {/* Professional background elements */}
      <div className="fixed inset-0 z-0">
        {/* Subtle professional gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-orange-50/30"></div>
        
        {/* Sophisticated geometric shapes */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden">
          <div className="absolute top-20 -left-20 w-96 h-96 bg-gray-100/40 rounded-full blur-3xl"></div>
          <div className="absolute top-60 right-10 w-80 h-80 bg-orange-50/60 rounded-full blur-3xl"></div>
          <div className="absolute bottom-40 left-10 w-64 h-64 bg-gray-50/80 rounded-full blur-2xl"></div>
        </div>

        {/* Professional grid pattern */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDYwIDAgTCAwIDAgMCA2MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZjk3MzE2IiBzdHJva2Utd2lkdGg9IjAuMyIgb3BhY2l0eT0iMC4xIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIiAvPjwvc3ZnPg==')] opacity-30"></div>
        </div>

        {/* Minimal floating elements */}
        <div className="absolute top-32 right-16 w-2 h-2 bg-orange-400/40 rounded-full animate-pulse"></div>
        <div className="absolute top-96 left-20 w-1 h-1 bg-gray-400/50 rounded-full animate-pulse delay-1000"></div>
        <div className="absolute bottom-48 right-40 w-1.5 h-1.5 bg-orange-300/30 rounded-full animate-pulse delay-2000"></div>
      </div>

      {/* Hero Section with professional design */}
      <section id="home" className="relative min-h-screen flex items-center pt-20 lg:pt-24 pb-16 z-10">
        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Left Content with professional styling */}
              <div className="space-y-8 lg:space-y-10 text-center lg:text-left">
                <div className="space-y-6 lg:space-y-8">
                  <Badge className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2.5 text-sm font-semibold rounded-full shadow-lg border border-orange-600/20">
                    <Sparkles className="w-4 h-4" />
                    Complete POS System
                  </Badge>
                  
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight">
                    <span className="text-gray-900">Complete Restaurant POS with{' '}</span>
                    <span className="text-orange-500">WhatsApp Integration</span>
                  </h1>
                  
                  <p className="text-lg sm:text-xl lg:text-2xl text-gray-600 leading-relaxed max-w-2xl lg:max-w-none font-medium">
                    Full-featured point of sale system that restaurants rely on daily, enhanced with WhatsApp 
                    ordering, payments, and digital customer notifications.
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <Button 
                    size="lg" 
                    className="bg-orange-500 hover:bg-orange-600 text-white shadow-xl hover:shadow-2xl transition-all duration-300 group h-14 px-8 text-lg font-semibold rounded-xl border border-orange-600/20"
                    onClick={() => navigate('/signup')}
                  >
                    Start For Free
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Button>
                  <Button 
                    size="lg" 
                    variant="outline" 
                    className="border-2 border-gray-300 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 h-14 px-8 text-lg font-semibold rounded-xl group shadow-lg"
                    onClick={openDemo}
                  >
                    <Play className="mr-2 w-5 h-5 group-hover:scale-110 transition-transform text-orange-500" />
                    Try Demo Now
                  </Button>
                </div>

                <div className="flex flex-wrap justify-center lg:justify-start gap-6 pt-4">
                  {[
                    { icon: <WhatsAppIcon className="w-5 h-5 text-green-600" />, text: "Full POS System" },
                    { icon: <CheckCircle className="w-5 h-5 text-emerald-600" />, text: "Traditional + WhatsApp" },
                    { icon: <Zap className="w-5 h-5 text-amber-600" />, text: "Digital pagers" }
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-lg shadow-md border border-gray-200/50">
                      {item.icon}
                      <span className="text-sm font-semibold text-gray-700">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Visual - Professional Interactive Animation */}
              <div className="relative">
                {/* Professional backdrop */}
                <div className="absolute inset-0 bg-gradient-to-br from-gray-50/80 to-orange-50/40 rounded-3xl blur-3xl transform rotate-3"></div>
                
                {/* Step 0: Professional Dashboard */}
                {heroStep === 0 && (
                  <div className="relative z-10 bg-white rounded-3xl shadow-2xl border border-gray-200/80 overflow-hidden max-w-md mx-auto transform transition-all duration-700">
                    <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-6 py-4 border-b border-gray-700">
                      <div className="flex items-center gap-4">
                        <div className="flex gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-400"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                          <div className="w-3 h-3 rounded-full bg-green-400"></div>
                        </div>
                        <h3 className="font-bold text-white text-lg">WhatsApp POS Dashboard</h3>
                        <Badge className="ml-auto bg-green-500 text-white text-xs px-3 py-1 rounded-full font-semibold">
                          <div className="w-2 h-2 bg-green-200 rounded-full mr-2 animate-pulse"></div>
                          Live Orders
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="p-6 space-y-5">
                      <div className="p-5 rounded-xl border border-orange-200 bg-orange-50/50 shadow-lg">
                        <div className="flex items-start justify-between">
                          <div className="space-y-3 flex-1">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-gray-900 text-xl">#2847</span>
                              <Badge variant="default" className="text-xs px-3 py-1 rounded-full bg-orange-500 text-white font-semibold">
                                cooking
                              </Badge>
                            </div>
                            <p className="font-semibold text-gray-900">Maria G.</p>
                            <p className="text-sm text-gray-600 font-medium">2x Spicy Burger, 1x Fries • R180.00</p>
                            <p className="text-xs text-gray-500 font-medium">Paid via WhatsApp • 5 min ago</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-center pt-4">
                        <Button 
                          onClick={startHeroAnimation}
                          disabled={isAnimating}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-semibold shadow-lg transition-all duration-300 group"
                        >
                          <CheckCircle className="mr-2 w-5 h-5 group-hover:scale-110 transition-transform" />
                          Mark Order Ready
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Professional animation steps */}
                {heroStep === 1 && (
                  <div className="relative z-10 bg-white rounded-3xl shadow-2xl border border-emerald-200 overflow-hidden max-w-md mx-auto transform transition-all duration-700">
                    <div className="bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-4 border-b border-emerald-500">
                      <div className="flex items-center gap-4">
                        <div className="flex gap-2">
                          <div className="w-3 h-3 rounded-full bg-white/70 animate-pulse"></div>
                          <div className="w-3 h-3 rounded-full bg-white/70 animate-pulse delay-200"></div>
                          <div className="w-3 h-3 rounded-full bg-white/70 animate-pulse delay-400"></div>
                        </div>
                        <h3 className="font-bold text-white text-lg">Order Ready!</h3>
                        <Badge className="ml-auto bg-white/20 text-white text-xs px-3 py-1 rounded-full font-semibold">
                          <Zap className="w-3 h-3 mr-2" />
                          Sending WhatsApp
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="p-6 text-center space-y-6">
                      <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-xl">
                        <CheckCircle className="w-10 h-10 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Order #2847 Ready!</h3>
                        <p className="text-gray-600 font-medium">Sending pickup notification via WhatsApp...</p>
                      </div>
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                        <span className="text-sm text-gray-500 font-medium">Digital pager notification...</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Professional notification display */}
                {heroStep === 2 && (
                  <div className="relative z-10 space-y-5">
                    {/* Customer Phone with professional styling */}
                    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-5 animate-in slide-in-from-right-5 duration-700">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center shadow-lg">
                          <span className="text-white font-bold text-sm">MG</span>
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">Maria G.</div>
                          <div className="text-xs text-gray-500">+27 82 555 0123</div>
                        </div>
                        <WhatsAppIcon className="w-6 h-6 text-green-500 ml-auto" />
                      </div>
                      <div className="bg-green-50 rounded-xl p-4 border-l-4 border-green-500 shadow-sm">
                        <div className="flex items-start gap-2">
                          <div className="text-sm">
                            <div className="font-bold text-green-800 mb-1">🍔 BeepBite - Order Ready!</div>
                            <div className="text-gray-700 font-medium">Order #2847 (R180.00) is ready for pickup!</div>
                            <div className="text-xs text-gray-500 mt-1 font-medium">Just now • Digital notification</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Professional success display */}
                    <div className="bg-emerald-50 rounded-2xl p-6 text-center border-2 border-emerald-200 shadow-xl animate-in fade-in duration-1000">
                      <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <CheckCircle className="w-8 h-8 text-white" />
                      </div>
                      <h3 className="text-lg font-bold text-emerald-800 mb-2">Digital Pager Sent!</h3>
                      <p className="text-sm text-emerald-700 font-medium">Maria gets her pickup notification instantly - no lost buzzers!</p>
                      <div className="flex items-center justify-center gap-4 mt-4 text-sm text-emerald-600">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span className="font-medium">Instant notification</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Heart className="w-4 h-4" />
                          <span className="font-medium">Modern experience</span>
                        </div>
                      </div>
                    </div>

                    {/* Professional try again button */}
                    <div className="text-center pt-4">
                      <Button 
                        onClick={startHeroAnimation}
                        variant="outline"
                        className="border-2 border-orange-400 text-orange-600 bg-white hover:bg-orange-50 hover:border-orange-500 px-6 py-2 rounded-xl transition-all duration-300 font-semibold shadow-lg"
                      >
                        <Play className="mr-2 w-4 h-4" />
                        See it again
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Features Section with professional design */}
        <section id="features" className="py-16 lg:py-24 relative z-10 bg-gray-50/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <Badge className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2.5 text-sm font-semibold rounded-full mb-6 shadow-lg">
                <Zap className="w-4 h-4" />
                Full POS Features
              </Badge>
              <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900 leading-tight">
                Traditional POS + WhatsApp Innovation
              </h2>
              <p className="text-lg lg:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed font-medium">
                Complete restaurant point of sale system with all the features you expect, enhanced with WhatsApp 
                ordering, payments, and digital notifications. One system handles everything.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {features.map((feature, i) => (
                <Card key={i} className={`group hover:shadow-2xl transition-all duration-500 hover:-translate-y-1 border ${feature.highlight ? 'ring-2 ring-orange-200 bg-orange-50/50 border-orange-200' : 'border-gray-200 hover:border-orange-300 bg-white'} rounded-2xl overflow-hidden`}>
                  <CardContent className="p-8 text-center">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg ${
                      feature.highlight 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-gray-100 text-gray-600 group-hover:bg-orange-500 group-hover:text-white'
                    }`}>
                      {feature.icon}
                    </div>
                    <h3 className="text-xl lg:text-2xl font-bold mb-4 text-gray-900">{feature.title}</h3>
                    <p className="text-gray-600 leading-relaxed font-medium">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Professional Benefits Section */}
        <section id="benefits" className="py-16 lg:py-24 relative z-10 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <Badge className="inline-flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 text-sm font-semibold rounded-full mb-6 shadow-lg">
                <Clock className="w-4 h-4" />
                Easy Setup
              </Badge>
              <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900 leading-tight">
                Upgrade Your Current POS System
              </h2>
              <p className="text-lg lg:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed font-medium">
                Get all traditional POS features you need, plus WhatsApp capabilities your current system doesn't have.
              </p>
            </div>
            
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              {benefits.map((benefit, i) => (
                <div key={i} className="text-center group">
                  <div className="bg-gray-50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 group-hover:bg-orange-50 transition-all duration-300 shadow-lg border border-gray-200">
                    <div className="text-orange-500 group-hover:scale-110 transition-transform duration-300">
                      {benefit.icon}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-gray-900">{benefit.title}</h3>
                  <p className="text-gray-600 font-medium">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Professional How It Works */}
        <section id="how-it-works" className="py-16 lg:py-24 relative z-10 bg-gradient-to-br from-gray-50 to-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <Badge className="inline-flex items-center gap-2 bg-blue-500 text-white px-5 py-2.5 text-sm font-semibold rounded-full mb-6 shadow-lg">
                <Lightbulb className="w-4 h-4" />
                Easy Setup
              </Badge>
              <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900 leading-tight">Setup Your Enhanced POS System</h2>
              <p className="text-lg lg:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed font-medium">
                Replace your current POS with a system that does everything it does, plus WhatsApp integration
              </p>
            </div>

            <div className="flex justify-center">
              {steps.map((step, i) => (
                <div key={i} className="text-center group max-w-lg">
                  <div className="relative mb-10">
                    <div className="w-28 h-28 bg-orange-500 rounded-3xl flex items-center justify-center text-white mx-auto group-hover:scale-110 transition-transform duration-300 shadow-2xl">
                      {step.icon}
                    </div>
                    <div className="absolute -top-2 -right-2 w-12 h-12 bg-gray-900 text-white rounded-2xl flex items-center justify-center text-sm font-bold shadow-lg">
                      {step.step}
                    </div>
                  </div>
                  <h3 className="text-2xl lg:text-3xl font-bold mb-4 text-gray-900">{step.title}</h3>
                  <p className="text-gray-600 leading-relaxed text-lg font-medium">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Professional Testimonials */}
        <section id="testimonials" className="py-16 lg:py-24 relative z-10 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <Badge className="inline-flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 text-sm font-semibold rounded-full mb-6 shadow-lg">
                <Star className="w-4 h-4" />
                Customer Success
              </Badge>
              <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900 leading-tight">Real Restaurants, Real Results</h2>
              <p className="text-lg lg:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed font-medium">
                See how restaurants upgraded from traditional POS to BeepBite's enhanced system
              </p>
            </div>

            <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
              {testimonials.map((testimonial, i) => (
                <Card key={i} className="group hover:shadow-2xl transition-all duration-500 hover:-translate-y-1 border border-gray-200 hover:border-emerald-300 rounded-2xl overflow-hidden bg-white">
                  <CardContent className="p-8">
                    <div className="flex items-center mb-6">
                      {[...Array(testimonial.rating)].map((_, j) => (
                        <Star key={j} className="w-5 h-5 fill-orange-400 text-orange-400" />
                      ))}
                    </div>
                    <blockquote className="text-gray-600 mb-6 leading-relaxed text-lg italic font-medium">
                      "{testimonial.text}"
                    </blockquote>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center text-white font-bold shadow-lg">
                        {testimonial.avatar}
                      </div>
                      <div>
                        <div className="font-bold text-gray-900">{testimonial.name}</div>
                        <div className="text-sm text-gray-600 font-semibold">{testimonial.restaurant}</div>
                        <div className="text-sm text-gray-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {testimonial.location}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Professional Support Section */}
        <section id="support" className="py-16 lg:py-24 bg-gray-900 text-white relative overflow-hidden">
          {/* Subtle professional background */}
          <div className="absolute inset-0">
            <div className="absolute top-20 left-20 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-20 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl"></div>
          </div>
          
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <Badge className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white px-5 py-2.5 text-sm font-semibold rounded-full mb-6 border border-white/20">
                <WhatsAppIcon className="w-4 h-4" />
                Get Help
              </Badge>
              <h2 className="text-3xl lg:text-5xl font-bold mb-6">Need Support?</h2>
              <p className="text-lg lg:text-xl text-gray-300 max-w-3xl mx-auto font-medium">
                Our team helps restaurants transition from their current POS to BeepBite's enhanced system
              </p>
            </div>
            
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              <div className="text-center group">
                <div className="bg-orange-500/10 backdrop-blur-sm w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-orange-500/20 transition-colors duration-300 border border-orange-500/20 shadow-lg">
                  <WhatsAppIcon className="w-8 h-8 text-orange-400" />
                </div>
                <h3 className="text-xl font-bold mb-3">WhatsApp Support</h3>
                <p className="text-gray-400 mb-4 font-medium">Quick help via WhatsApp</p>
                <a 
                  href="https://wa.me/27118765432" 
                  className="inline-flex items-center gap-2 bg-orange-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-orange-600 hover:shadow-lg transition-all duration-300"
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  <WhatsAppIcon className="w-4 h-4" />
                  Message Us
                </a>
              </div>
              
              <div className="text-center group">
                <div className="bg-blue-500/10 backdrop-blur-sm w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-blue-500/20 transition-colors duration-300 border border-blue-500/20 shadow-lg">
                  <Mail className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="text-xl font-bold mb-3">Email Support</h3>
                <p className="text-gray-400 mb-4 font-medium">Get detailed assistance</p>
                <a 
                  href="mailto:support@beepbite.io" 
                  className="inline-flex items-center gap-2 bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-600 hover:shadow-lg transition-all duration-300"
                >
                  <Mail className="w-4 h-4" />
                  Email Us
                </a>
              </div>
              
              <div className="text-center group">
                <div className="bg-green-500/10 backdrop-blur-sm w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-green-500/20 transition-colors duration-300 border border-green-500/20 shadow-lg">
                  <Phone className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-xl font-bold mb-3">Phone Support</h3>
                <p className="text-gray-400 mb-4 font-medium">Speak directly with our team</p>
                <a 
                  href="tel:+27118765432" 
                  className="inline-flex items-center gap-2 bg-green-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-green-600 hover:shadow-lg transition-all duration-300"
                >
                  <Phone className="w-4 h-4" />
                  Call Us
                </a>
              </div>
              
              <div className="text-center group">
                <div className="bg-purple-500/10 backdrop-blur-sm w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-purple-500/20 transition-colors duration-300 border border-purple-500/20 shadow-lg">
                  <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Documentation</h3>
                <p className="text-gray-400 mb-4 font-medium">Self-service help guides</p>
                <a 
                  href="/docs" 
                  className="inline-flex items-center gap-2 bg-purple-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-purple-600 hover:shadow-lg transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  View Docs
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Professional CTA Section */}
        <section id="get-started" className="py-16 lg:py-24 relative overflow-hidden bg-orange-500">
          {/* Professional background overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-orange-600/20 to-orange-400/10"></div>
          
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
            <Badge className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm text-white px-5 py-2.5 text-sm font-semibold rounded-full mb-8 border border-white/30 shadow-lg">
              <Sparkles className="w-4 h-4" />
              Complete POS System
            </Badge>
            <h2 className="text-3xl lg:text-6xl font-bold leading-tight mb-8">
              Ready to Upgrade Your POS System?
            </h2>
            <p className="text-lg lg:text-2xl opacity-90 max-w-4xl mx-auto leading-relaxed mb-12 font-medium">
              Get all the POS features you currently use, plus WhatsApp ordering, payments, and digital notifications. 
              One system that handles traditional restaurant operations and modern customer engagement.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <Button 
                size="lg" 
                variant="secondary"
                className="bg-white text-orange-600 hover:bg-gray-50 shadow-xl h-16 px-10 text-xl font-bold rounded-2xl transition-all duration-300"
                onClick={() => navigate('/signup')}
              >
                <Sparkles className="mr-2 w-5 h-5" />
                Start For Free
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                className="border-2 border-white text-white bg-transparent hover:bg-white hover:text-orange-600 h-16 px-10 text-xl font-bold rounded-2xl transition-all duration-300"
              >
                <Play className="mr-2 w-5 h-5" />
                Schedule a Demo
              </Button>
            </div>
            <div className="flex flex-wrap justify-center gap-8 pt-8 text-sm opacity-90">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span className="font-semibold">Full POS features</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span className="font-semibold">Plus WhatsApp integration</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span className="font-semibold">Digital notifications</span>
              </div>
            </div>
          </div>
        </section>

        {/* Demo Modal with professional styling */}
        <Dialog open={isDemoOpen} onOpenChange={setIsDemoOpen}>
          <DialogContent className="w-[95vw] max-w-md mx-auto bg-white border border-gray-200 rounded-2xl shadow-2xl">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-center text-2xl font-bold text-gray-900">
                {demoSuccess ? "Demo Sent! 🎉" : "Try BeepBite Demo"}
              </DialogTitle>
            </DialogHeader>

            {demoSuccess ? (
              <div className="py-6 text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
                  <CheckCircle className="w-8 h-8 text-white" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-emerald-600">Check Your WhatsApp!</h3>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    You should receive a demo notification showing how BeepBite's enhanced POS system works. 
                    This demonstrates the WhatsApp features that work alongside traditional POS operations!
                  </p>
                </div>
                <Button 
                  onClick={() => setIsDemoOpen(false)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white w-full py-3 rounded-xl font-semibold shadow-lg transition-all duration-300"
                >
                  Got it!
                </Button>
              </div>
            ) : (
              <form onSubmit={handleDemoSubmit} className="space-y-6">
                <div className="text-center space-y-2">
                  <p className="text-gray-600 font-medium">
                    Test the WhatsApp features of BeepBite's enhanced POS system!
                  </p>
                  <p className="text-xs text-orange-600 font-bold bg-orange-50 px-3 py-2 rounded-lg border border-orange-200">
                    🇿🇦 South Africa only for now - check back next month, we're expanding rapidly!
                  </p>
                </div>

                {/* Error Alert */}
                {demoError && (
                  <Alert variant="destructive" className="bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm font-medium">{demoError}</AlertDescription>
                  </Alert>
                )}

                {/* Phone Number Input */}
                <div className="space-y-2">
                  <Label htmlFor="demo-phone" className="text-sm font-semibold text-gray-800">
                    WhatsApp Number
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      id="demo-phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+27123456789"
                      className="pl-10 h-12 text-lg border border-gray-300 rounded-xl bg-white focus:border-orange-400 font-medium"
                      required
                    />
                  </div>
                  <p className="text-xs text-gray-500 font-medium">
                    Enter your WhatsApp number to see how our enhanced POS system sends notifications
                  </p>
                </div>

                {/* Submit Button */}
                <Button 
                  type="submit"
                  disabled={isLoading}
                  className="bg-orange-500 hover:bg-orange-600 text-white w-full h-12 text-lg font-semibold rounded-xl shadow-lg transition-all duration-300"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                      Testing System...
                    </>
                  ) : (
                    <>
                      <WhatsAppIcon className="mr-2 w-5 h-5" />
                      Test Enhanced POS
                    </>
                  )}
                </Button>
              
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Professional Footer */}
        <footer className="bg-white border-t border-gray-200 py-12 lg:py-16 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
              <div className="col-span-2 md:col-span-1 space-y-6">
                <Logo variant="minimal" className="text-left" />
                <p className="text-gray-600 max-w-md leading-relaxed flex items-start gap-2 font-medium">
                  <WhatsAppIcon className="w-5 h-5 mt-1 text-green-500 flex-shrink-0" />
                  BeepBite is a complete restaurant POS system with all traditional features, enhanced with 
                  WhatsApp ordering, payments, and digital customer notifications.
                </p>
              </div>
              
              <div>
                <h4 className="font-bold mb-6 text-lg text-gray-900">Product</h4>
                <ul className="space-y-3 text-gray-600">
                  <li><button onClick={() => scrollToSection('features')} className="hover:text-orange-500 transition-colors text-left font-medium">Features</button></li>
                  <li><button onClick={() => scrollToSection('how-it-works')} className="hover:text-orange-500 transition-colors text-left font-medium">How It Works</button></li>
                  <li><button onClick={() => scrollToSection('testimonials')} className="hover:text-orange-500 transition-colors text-left font-medium">Reviews</button></li>
                  <li><button onClick={() => scrollToSection('get-started')} className="hover:text-orange-500 transition-colors text-left font-medium">Demo</button></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-bold mb-6 text-lg text-gray-900">Navigation</h4>
                <ul className="space-y-3 text-gray-600">
                  <li><button onClick={() => scrollToSection('home')} className="hover:text-orange-500 transition-colors text-left font-medium">Home</button></li>
                  <li><button onClick={() => scrollToSection('benefits')} className="hover:text-orange-500 transition-colors text-left font-medium">Benefits</button></li>
                  <li><button onClick={() => scrollToSection('support')} className="hover:text-orange-500 transition-colors text-left font-medium">Support</button></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-bold mb-6 text-lg text-gray-900">Resources</h4>
                <ul className="space-y-3 text-gray-600">
                  <li><a href="/docs" className="hover:text-orange-500 transition-colors font-medium">Documentation</a></li>
                  <li><a href="/docs/privacy" className="hover:text-orange-500 transition-colors font-medium">Privacy Policy</a></li>
                  <li><a href="/docs/terms" className="hover:text-orange-500 transition-colors font-medium">Terms of Service</a></li>
                  <li><a href="/docs/cookies" className="hover:text-orange-500 transition-colors font-medium">Cookie Policy</a></li>
                </ul>
              </div>
            </div>
            
            <div className="border-t border-gray-200 mt-12 pt-8">
              <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                <p className="text-gray-500 font-medium">
                  &copy; {new Date().getFullYear()} BeepBite Pty is a member of Exolution Technologies Pty
                </p>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => scrollToSection('home')} 
                    className="text-gray-500 hover:text-orange-500 transition-colors font-semibold"
                  >
                    Back to Top
                  </button>
                </div>
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
