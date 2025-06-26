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
  
  // reCAPTCHA v3 Site Key
  const RECAPTCHA_SITE_KEY = '6Le4UG0rAAAAAJXfVlipl7lFPKVERsSX5cHqHy7B';
  
  // Demo modal state
  const [isDemoOpen, setIsDemoOpen] = React.useState(false);
  const [phoneNumber, setPhoneNumber] = React.useState('+27');
  const [isLoading, setIsLoading] = React.useState(false);
  const [demoError, setDemoError] = React.useState('');
  const [demoSuccess, setDemoSuccess] = React.useState(false);

  // Hero animation state
  const [heroStep, setHeroStep] = React.useState(0); // 0: initial, 1: completing, 2: notifications
  const [isAnimating, setIsAnimating] = React.useState(false);

  // Load reCAPTCHA script
  React.useEffect(() => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    document.head.appendChild(script);
    
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  // Handle demo submission
  const handleDemoSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setDemoError('');
    
    try {
      // Validate phone number
      if (!phoneNumber || phoneNumber.length < 10) {
        setDemoError('Please enter a valid phone number');
        setIsLoading(false);
        return;
      }

      // Get reCAPTCHA token
      const token = await new Promise((resolve, reject) => {
        if (typeof window.grecaptcha === 'undefined') {
          reject(new Error('reCAPTCHA not loaded'));
          return;
        }
        
        window.grecaptcha.ready(() => {
          window.grecaptcha.execute(RECAPTCHA_SITE_KEY, {
            action: 'whatsapp_demo'
          }).then(resolve).catch(reject);
        });
      });

      // Call Supabase function
      const { data, error } = await supabase.functions.invoke('landing-whatsapp-demo', {
        body: {
          recaptcha_token: token,
          action: 'whatsapp_demo',
          cell_number: phoneNumber
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
      title: "Instant WhatsApp Alerts",
      description: "Alert customers the moment their food is ready. No more cold meals or unhappy diners waiting around.",
      highlight: true
    },
    {
      icon: <Clock className="w-6 h-6" />,
      title: "Faster Food Delivery", 
      description: "Get hot food to customers quickly with automated pickup notifications sent directly to their phone.",
      highlight: false
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "No Devices Needed",
      description: "Works with your existing setup. No hardware to buy, install, or maintain. Just pure simplicity.",
      highlight: false
    },
    {
      icon: <Star className="w-6 h-6" />,
      title: "Private Customer Reviews",
      description: "Get honest feedback sent directly to you via WhatsApp instead of public review sites.",
      highlight: false
    },
    {
      icon: <Heart className="w-6 h-6" />,
      title: "Happier Customers",
      description: "No more complaints about cold food or long waits. Keep customers satisfied and coming back.",
      highlight: false
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Zero Setup Costs",
      description: "No upfront fees, no monthly contracts, no hidden costs. Start serving hot food faster today.",
      highlight: false
    }
  ];

  const stats = [
    { number: "15,000+", label: "Orders Processed Daily", icon: <BarChart3 className="w-6 h-6" /> },
    { number: "800+", label: "Active Restaurants", icon: <Utensils className="w-6 h-6" /> },
    { number: "99.9%", label: "System Uptime", icon: <Shield className="w-6 h-6" /> },
    { number: "<1s", label: "Notification Speed", icon: <Zap className="w-6 h-6" /> }
  ];

  const testimonials = [
    {
      name: "Maria Rodriguez",
      restaurant: "Casa Maria Bistro",
      location: "Miami, FL",
      rating: 5,
      text: "No more angry customers complaining about cold food! BeepBite gets them their meals while they're still hot. Game changer.",
      avatar: "MR"
    },
    {
      name: "Ahmed Hassan", 
      restaurant: "Spice Garden",
      location: "Houston, TX",
      rating: 5,
      text: "We love getting honest reviews directly to WhatsApp instead of nasty public reviews. Customers actually help us improve now.",
      avatar: "AH"
    },
    {
      name: "Sarah Chen",
      restaurant: "Golden Dragon",
      location: "San Francisco, CA", 
      rating: 5,
      text: "Setup took 2 minutes, no devices needed. Now our customers pick up food fast and we get zero complaints about wait times.",
      avatar: "SC"
    }
  ];

  const steps = [
    {
      step: "01",
      title: "Sign Up & Add Restaurant",
      description: "Create your account and add your restaurant details in under 2 minutes. That's it - you're ready to stop serving cold food!",
      icon: <Utensils className="w-8 h-8" />
    }
  ];

  const benefits = [
    {
      icon: <Zap className="w-6 h-6" />,
      title: "No More Cold Food",
      description: "Customers get notified instantly when food is ready for pickup"
    },
    {
      icon: <Heart className="w-6 h-6" />,
      title: "Stop Customer Complaints",
      description: "End frustration about long waits and cold meals"
    },
    {
      icon: <MessageSquare className="w-6 h-6" />,
      title: "Get Private Reviews",
      description: "Receive honest feedback directly instead of public criticism"
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Zero Equipment Costs",
      description: "No devices to buy, install, or maintain - works instantly"
    }
  ];

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero Section */}
      <section id="home" className="relative min-h-screen flex items-center bg-gradient-to-br from-gray-50/30 via-white to-orange-50/10">
        {/* Background Pattern */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZjZiMzUiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iNCIvPjwvZz48L2c+PC9zdmc+')] opacity-40"></div>
          {/* Floating Elements */}
          <div className="absolute top-20 right-10 w-20 h-20 beepbite-gradient rounded-full opacity-10 animate-pulse"></div>
          <div className="absolute bottom-32 left-10 w-32 h-32 bg-orange-500/5 rounded-full"></div>
          <div className="absolute top-1/3 right-1/4 w-16 h-16 bg-orange-500/5 rounded-full"></div>
        </div>
        
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Content */}
            <div className="space-y-8 text-center lg:text-left">
              <div className="space-y-6">
                <Badge className="inline-flex items-center gap-2 beepbite-gradient text-white px-4 py-2 text-sm font-semibold rounded-full shadow-lg">
                  <Sparkles className="w-4 h-4" />
                  No Setup Costs
                </Badge>
                
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight text-gray-900">
                  Stop Serving Cold Food with{' '}
                  <span className="beepbite-gradient-text">BeepBite</span>
                </h1>
                
                <p className="text-lg sm:text-xl lg:text-2xl text-gray-600 leading-relaxed max-w-2xl lg:max-w-none">
                  Get food to customers faster with instant WhatsApp notifications. 
                  No devices, no setup fees, no maintenance - just happier customers and hotter food.
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Button 
                  size="lg" 
                  className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-300 group h-14 px-8 text-lg font-semibold rounded-xl"
                  onClick={() => navigate('/signup')}
                >
                  Start For Free
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="border-2 border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white transition-all duration-300 h-14 px-8 text-lg font-semibold rounded-xl group"
                  onClick={openDemo}
                >
                  <Play className="mr-2 w-5 h-5 group-hover:scale-110 transition-transform" />
                  Try Demo Now
                </Button>
              </div>

              <div className="flex flex-wrap justify-center lg:justify-start gap-6 pt-4">
                {[
                  { icon: <WhatsAppIcon className="w-5 h-5 text-green-600" />, text: "WhatsApp alerts" },
                  { icon: <CheckCircle className="w-5 h-5 text-green-600" />, text: "No setup costs" },
                  { icon: <CheckCircle className="w-5 h-5 text-green-600" />, text: "No devices needed" }
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {item.icon}
                    <span className="text-sm font-semibold text-gray-700">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Visual - Interactive Animation */}
            <div className="relative">
              {/* Step 0: Initial Dashboard */}
              {heroStep === 0 && (
                <div className="relative z-10 bg-white rounded-3xl shadow-2xl border border-gray-200 overflow-hidden max-w-md mx-auto transform transition-all duration-700">
                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-400"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                        <div className="w-3 h-3 rounded-full bg-green-400"></div>
                      </div>
                      <h3 className="font-bold text-gray-900 text-lg">Kitchen Dashboard</h3>
                      <Badge className="ml-auto bg-green-100 text-green-700 text-sm px-3 py-1 rounded-full">
                        <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                        Live
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div className="p-4 rounded-xl border-2 bg-orange-50 border-orange-200 shadow-lg">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-900 text-lg">#2847</span>
                            <Badge variant="default" className="text-xs px-3 py-1 rounded-full bg-orange-500 text-white">
                              cooking
                            </Badge>
                          </div>
                          <p className="font-semibold text-gray-900">Maria G.</p>
                          <p className="text-sm text-gray-600">2x Spicy Burger, 1x Fries</p>
                          <p className="text-xs text-gray-500 font-medium">5 min ago</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-center pt-4">
                      <Button 
                        onClick={startHeroAnimation}
                        disabled={isAnimating}
                        className="beepbite-gradient text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 group"
                      >
                        <CheckCircle className="mr-2 w-5 h-5 group-hover:scale-110 transition-transform" />
                        Complete Order #2847
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: Order Completing */}
              {heroStep === 1 && (
                <div className="relative z-10 bg-white rounded-3xl shadow-2xl border border-gray-200 overflow-hidden max-w-md mx-auto transform transition-all duration-700">
                  <div className="bg-gradient-to-r from-green-50 to-green-100 px-6 py-4 border-b border-green-200">
                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                        <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                      </div>
                      <h3 className="font-bold text-green-800 text-lg">Order Completed!</h3>
                      <Badge className="ml-auto bg-green-200 text-green-800 text-sm px-3 py-1 rounded-full">
                        <Zap className="w-3 h-3 mr-2" />
                        Processing
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="p-6 text-center space-y-6">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
                      <CheckCircle className="w-10 h-10 text-green-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 mb-2">Order #2847 Ready!</h3>
                      <p className="text-gray-600">Sending WhatsApp notification to Maria...</p>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      <span className="text-sm text-gray-500">Notifying customer...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: WhatsApp Notifications */}
              {heroStep === 2 && (
                <div className="relative z-10 space-y-4">
                  {/* Customer Phone 1 */}
                  <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-4 animate-in slide-in-from-right-5 duration-700">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 beepbite-gradient rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-sm">MG</span>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">Maria G.</div>
                        <div className="text-xs text-gray-500">+27 82 555 0123</div>
                      </div>
                      <WhatsAppIcon className="w-6 h-6 text-green-500 ml-auto" />
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 border-l-4 border-green-400">
                      <div className="flex items-start gap-2">
                        <div className="text-sm">
                          <div className="font-semibold text-green-800 mb-1">🎉 BeepBite - Order Ready!</div>
                          <div className="text-gray-700">Your Order #2847 is ready for pickup!</div>
                          <div className="text-xs text-gray-500 mt-1">Just now</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Success Animation */}
                  <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-2xl p-6 text-center border-2 border-green-200 animate-in fade-in duration-1000">
                    <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-white animate-bounce" />
                    </div>
                    <h3 className="text-lg font-bold text-green-800 mb-2">Notification Sent!</h3>
                    <p className="text-sm text-green-700">Maria will get her hot food in minutes, not hours.</p>
                    <div className="flex items-center justify-center gap-4 mt-4 text-sm text-green-600">
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>Instant delivery</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Heart className="w-4 h-4" />
                        <span>Happy customer</span>
                      </div>
                    </div>
                  </div>

                  {/* Try Again Button */}
                  <div className="text-center pt-4">
                    <Button 
                      onClick={startHeroAnimation}
                      variant="outline"
                      className="border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white px-6 py-2 rounded-xl transition-all duration-300"
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

      {/* Features Section */}
      <section id="features" className="py-16 lg:py-24 bg-gradient-to-br from-gray-50/50 to-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="inline-flex items-center gap-2 bg-orange-100 text-orange-600 px-4 py-2 text-sm font-semibold rounded-full mb-6">
              <Zap className="w-4 h-4" />
              Core Benefits
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900">
              Stop Food From Going Cold
            </h2>
            <p className="text-lg lg:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              BeepBite solves the biggest problem in food service - getting hot food to customers fast 
              with zero hassle and no expensive equipment.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <Card key={i} className={`group hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 border-2 ${feature.highlight ? 'ring-2 ring-orange-200 bg-orange-50/50 border-orange-200' : 'border-gray-200 hover:border-orange-300'} rounded-2xl overflow-hidden`}>
                <CardContent className="p-8 text-center">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300 ${
                    feature.highlight 
                      ? 'beepbite-gradient text-white shadow-lg' 
                      : 'bg-gray-100 text-gray-600 group-hover:bg-orange-500 group-hover:text-white'
                  }`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-xl lg:text-2xl font-bold mb-4 text-gray-900">{feature.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="py-16 lg:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900">
              The Cold Food Problem, Solved
            </h2>
            <p className="text-lg lg:text-xl text-gray-600 max-w-3xl mx-auto">
              Stop losing customers to cold food and long waits. Get food to them faster with zero hassle.
            </p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {benefits.map((benefit, i) => (
              <div key={i} className="text-center group">
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                  <div className="text-orange-500">
                    {benefit.icon}
                  </div>
                </div>
                <h3 className="text-xl font-bold mb-3 text-gray-900">{benefit.title}</h3>
                <p className="text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-16 lg:py-24 bg-gradient-to-br from-gray-50/50 to-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="inline-flex items-center gap-2 bg-orange-100 text-orange-600 px-4 py-2 text-sm font-semibold rounded-full mb-6">
              <Clock className="w-4 h-4" />
              Super Simple
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900">Just 1 Simple Step</h2>
            <p className="text-lg lg:text-xl text-gray-600 max-w-2xl mx-auto">Sign up, add your restaurant, and start serving hot food</p>
          </div>

          <div className="flex justify-center">
            {steps.map((step, i) => (
              <div key={i} className="text-center group max-w-md">
                <div className="relative mb-8">
                  <div className="w-24 h-24 beepbite-gradient rounded-3xl flex items-center justify-center text-white mx-auto group-hover:scale-110 transition-transform duration-300 shadow-xl">
                    {step.icon}
                  </div>
                  <div className="absolute -top-3 -right-3 w-12 h-12 bg-gray-900 text-white rounded-2xl flex items-center justify-center text-sm font-bold shadow-lg">
                    {step.step}
                  </div>
                </div>
                <h3 className="text-xl lg:text-2xl font-bold mb-4 text-gray-900">{step.title}</h3>
                <p className="text-gray-600 leading-relaxed text-lg">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-16 lg:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-4 py-2 text-sm font-semibold rounded-full mb-6">
              <Star className="w-4 h-4" />
              Customer Success
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-6 text-gray-900">Real Results, Happy Customers</h2>
            <p className="text-lg lg:text-xl text-gray-600 max-w-2xl mx-auto">See how restaurants stopped cold food complaints</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {testimonials.map((testimonial, i) => (
              <Card key={i} className="group hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 border-2 border-gray-200 hover:border-orange-300 rounded-2xl overflow-hidden">
                <CardContent className="p-8">
                  <div className="flex items-center mb-6">
                    {[...Array(testimonial.rating)].map((_, j) => (
                      <Star key={j} className="w-5 h-5 fill-orange-400 text-orange-400" />
                    ))}
                  </div>
                  <blockquote className="text-gray-600 mb-6 leading-relaxed text-lg italic">
                    "{testimonial.text}"
                  </blockquote>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 beepbite-gradient rounded-2xl flex items-center justify-center text-white font-bold">
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

      {/* Support Section */}
      <section id="support" className="py-16 lg:py-24 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="inline-flex items-center gap-2 bg-white/10 text-white px-4 py-2 text-sm font-semibold rounded-full mb-6">
              <WhatsAppIcon className="w-4 h-4" />
              Get Help
            </Badge>
            <h2 className="text-3xl lg:text-5xl font-bold mb-6">Need Support?</h2>
            <p className="text-lg lg:text-xl text-gray-300 max-w-2xl mx-auto">
              Our team is here to help you get the most out of BeepBite
            </p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center group">
              <div className="bg-orange-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-orange-500/20 transition-colors duration-300">
                <WhatsAppIcon className="w-8 h-8 text-orange-400" />
              </div>
              <h3 className="text-xl font-bold mb-3">WhatsApp Support</h3>
              <p className="text-gray-400 mb-4">Quick help via WhatsApp</p>
              <a 
                href="https://wa.me/27118765432" 
                className="inline-flex items-center gap-2 beepbite-gradient text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg hover:text-white transition-all duration-300"
                target="_blank" 
                rel="noopener noreferrer"
              >
                <WhatsAppIcon className="w-4 h-4" />
                Message Us
              </a>
            </div>
            
            <div className="text-center group">
              <div className="bg-orange-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-orange-500/20 transition-colors duration-300">
                <Mail className="w-8 h-8 text-orange-400" />
              </div>
              <h3 className="text-xl font-bold mb-3">Email Support</h3>
              <p className="text-gray-400 mb-4">Get detailed assistance</p>
              <a 
                href="mailto:support@beepbite.io" 
                className="inline-flex items-center gap-2 beepbite-gradient text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg hover:text-white transition-all duration-300"
              >
                <Mail className="w-4 h-4" />
                Email Us
              </a>
            </div>
            
            <div className="text-center group">
              <div className="bg-orange-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-orange-500/20 transition-colors duration-300">
                <Phone className="w-8 h-8 text-orange-400" />
              </div>
              <h3 className="text-xl font-bold mb-3">Phone Support</h3>
              <p className="text-gray-400 mb-4">Speak directly with our team</p>
              <a 
                href="tel:+27118765432" 
                className="inline-flex items-center gap-2 beepbite-gradient text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg hover:text-white transition-all duration-300"
              >
                <Phone className="w-4 h-4" />
                Call Us
              </a>
            </div>
            
            <div className="text-center group">
              <div className="bg-orange-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-orange-500/20 transition-colors duration-300">
                <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Documentation</h3>
              <p className="text-gray-400 mb-4">Self-service help guides</p>
              <a 
                href="/docs" 
                className="inline-flex items-center gap-2 beepbite-gradient text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg hover:text-white transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View Docs
              </a>
            </div>
          </div>
          
          <div className="mt-16 text-center">
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
              <h3 className="text-2xl font-bold mb-4">Still Need Help?</h3>
              <p className="text-gray-300 mb-6">
                Our support team is available 24/7 to help you succeed with BeepBite
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button 
                  className="beepbite-gradient text-white font-semibold px-8 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
                  onClick={() => scrollToSection('get-started')}
                >
                  Schedule a Demo
                </Button>
                <Button 
                  variant="outline"
                  className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:border-orange-500 font-semibold px-8 py-3 rounded-xl transition-all duration-300"
                  onClick={() => window.open('https://wa.me/27118765432', '_blank')}
                >
                  <WhatsAppIcon className="w-4 h-4 mr-2" />
                  Chat Now
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="get-started" className="beepbite-gradient text-white relative overflow-hidden py-20 lg:py-32">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <Badge className="inline-flex items-center gap-2 bg-white/20 text-white px-4 py-2 text-sm font-semibold rounded-full mb-8">
            <Sparkles className="w-4 h-4" />
            No Setup Costs
          </Badge>
          <h2 className="text-3xl lg:text-6xl font-bold leading-tight mb-8">
            Ready to Stop Serving Cold Food?
          </h2>
          <p className="text-lg lg:text-2xl opacity-90 max-w-3xl mx-auto leading-relaxed mb-12">
            Join restaurants using BeepBite to get hot food to customers faster, 
            reduce complaints, and get honest feedback directly to WhatsApp.
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <Button 
              size="lg" 
              variant="secondary"
              className="bg-white text-orange-600 hover:bg-gray-100 shadow-lg h-16 px-10 text-xl font-bold rounded-2xl"
              onClick={() => navigate('/signup')}
            >
              Start For Free
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="border-2 border-white text-white bg-transparent hover:bg-white hover:text-orange-600 h-16 px-10 text-xl font-bold rounded-2xl"
            >
              Schedule a Demo
            </Button>
          </div>
          <div className="flex flex-wrap justify-center gap-8 pt-8 text-sm opacity-80">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>Start for free</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>No setup costs</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>No devices needed</span>
            </div>
          </div>
        </div>
      </section>

      {/* Demo Modal */}
      <Dialog open={isDemoOpen} onOpenChange={setIsDemoOpen}>
        <DialogContent className="w-[95vw] max-w-md mx-auto">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-center text-xl font-bold">
              {demoSuccess ? "Demo Sent! 🎉" : "Try BeepBite Demo"}
            </DialogTitle>
          </DialogHeader>

          {demoSuccess ? (
            <div className="py-6 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-green-600">Check Your WhatsApp!</h3>
                <p className="text-sm text-gray-600">
                  You should receive a "Hello World" template message showing that BeepBite's WhatsApp notification system is working. 
                  In production, this would be your custom order notification!
                </p>
              </div>
              <Button 
                onClick={() => setIsDemoOpen(false)}
                className="beepbite-gradient text-white w-full"
              >
                Got it!
              </Button>
            </div>
          ) : (
            <form onSubmit={handleDemoSubmit} className="space-y-6">
              <div className="text-center space-y-2">
                <p className="text-gray-600">
                  Test BeepBite's WhatsApp notification system!
                </p>
                <p className="text-xs text-orange-600 font-medium">
                  🇿🇦 South Africa only for now - check back next month, we're expanding rapidly!
                </p>
              </div>

              {/* Error Alert */}
              {demoError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">{demoError}</AlertDescription>
                </Alert>
              )}

              {/* Phone Number Input */}
              <div className="space-y-2">
                <Label htmlFor="demo-phone" className="text-sm font-medium">
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
                    className="pl-10 h-12 text-lg"
                    required
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Enter your WhatsApp number to receive a demo notification
                </p>
              </div>

              {/* Submit Button */}
              <Button 
                type="submit"
                disabled={isLoading}
                className="beepbite-gradient text-white w-full h-12 text-lg font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                    Testing System...
                  </>
                ) : (
                  <>
                    <WhatsAppIcon className="mr-2 w-5 h-5" />
                    Test WhatsApp System
                  </>
                )}
              </Button>
              
              <div className="text-center">
                <p className="text-xs text-gray-500">
                  Protected by reCAPTCHA • No spam, just a quick demo
                </p>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
            <div className="col-span-2 md:col-span-1 space-y-6">
              <Logo variant="minimal" className="text-left" />
              <p className="text-gray-600 max-w-md leading-relaxed flex items-start gap-2">
                <WhatsAppIcon className="w-5 h-5 mt-1 text-green-500 flex-shrink-0" />
                BeepBite helps restaurants stop serving cold food with instant WhatsApp notifications 
                and zero setup costs.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold mb-6 text-lg text-gray-900">Product</h4>
              <ul className="space-y-3 text-gray-600">
                <li><button onClick={() => scrollToSection('features')} className="hover:text-orange-500 transition-colors text-left">Features</button></li>
                <li><button onClick={() => scrollToSection('how-it-works')} className="hover:text-orange-500 transition-colors text-left">How It Works</button></li>
                <li><button onClick={() => scrollToSection('testimonials')} className="hover:text-orange-500 transition-colors text-left">Reviews</button></li>
                <li><button onClick={() => scrollToSection('get-started')} className="hover:text-orange-500 transition-colors text-left">Demo</button></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-6 text-lg text-gray-900">Navigation</h4>
              <ul className="space-y-3 text-gray-600">
                <li><button onClick={() => scrollToSection('home')} className="hover:text-orange-500 transition-colors text-left">Home</button></li>
                <li><button onClick={() => scrollToSection('stats')} className="hover:text-orange-500 transition-colors text-left">Stats</button></li>
                <li><button onClick={() => scrollToSection('benefits')} className="hover:text-orange-500 transition-colors text-left">Benefits</button></li>
                <li><button onClick={() => scrollToSection('support')} className="hover:text-orange-500 transition-colors text-left">Support</button></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-6 text-lg text-gray-900">Resources</h4>
              <ul className="space-y-3 text-gray-600">
                <li><a href="/docs" className="hover:text-orange-500 transition-colors">Documentation</a></li>
                <li><a href="/docs/privacy" className="hover:text-orange-500 transition-colors">Privacy Policy</a></li>
                <li><a href="/docs/terms" className="hover:text-orange-500 transition-colors">Terms of Service</a></li>
                <li><a href="/docs/cookies" className="hover:text-orange-500 transition-colors">Cookie Policy</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-200 mt-12 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <p className="text-gray-500">
                &copy; {new Date().getFullYear()} BeepBite Pty is a member of Exolution Technologies Pty
              </p>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => scrollToSection('home')} 
                  className="text-gray-500 hover:text-orange-500 transition-colors text-sm"
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
