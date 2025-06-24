import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Logo from '@/components/ui/logo';
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
  MapPin
} from 'lucide-react';

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const LandingPage = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: <WhatsAppIcon className="w-5 h-5" />,
      title: "Instant WhatsApp Alerts",
      description: "Never miss an order with real-time WhatsApp notifications sent directly to your phone.",
      highlight: true
    },
    {
      icon: <Clock className="w-5 h-5" />,
      title: "Real-Time Order Tracking", 
      description: "Monitor order status from pending to ready with automated preparation time tracking.",
      highlight: false
    },
    {
      icon: <BarChart3 className="w-5 h-5" />,
      title: "Smart Analytics",
      description: "Identify peak hours, track performance metrics, and optimize your restaurant operations.",
      highlight: false
    },
    {
      icon: <Users className="w-5 h-5" />,
      title: "Team Management",
      description: "Invite staff with role-based access for seamless kitchen and front-of-house coordination.",
      highlight: false
    },
    {
      icon: <Star className="w-5 h-5" />,
      title: "Customer Reviews",
      description: "Collect and manage customer feedback to continuously improve service quality.",
      highlight: false
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "Reliable & Secure",
      description: "99.9% uptime with enterprise-grade security to keep your restaurant data safe.",
      highlight: false
    }
  ];

  const stats = [
    { number: "15,000+", label: "Orders Processed Daily", icon: <BarChart3 className="w-4 h-4" /> },
    { number: "800+", label: "Active Restaurants", icon: <Utensils className="w-4 h-4" /> },
    { number: "99.9%", label: "System Uptime", icon: <Shield className="w-4 h-4" /> },
    { number: "<1s", label: "Notification Speed", icon: <Zap className="w-4 h-4" /> }
  ];

  const testimonials = [
    {
      name: "Maria Rodriguez",
      restaurant: "Casa Maria Bistro",
      location: "Miami, FL",
      rating: 5,
      text: "BeepBite completely transformed our kitchen operations. We process 3x more orders during peak hours and never miss a single notification.",
      avatar: "MR"
    },
    {
      name: "Ahmed Hassan", 
      restaurant: "Spice Garden",
      location: "Houston, TX",
      rating: 5,
      text: "The WhatsApp integration is brilliant! Our entire team stays coordinated and customers love how quickly we prepare their orders.",
      avatar: "AH"
    },
    {
      name: "Sarah Chen",
      restaurant: "Golden Dragon",
      location: "San Francisco, CA", 
      rating: 5,
      text: "Analytics helped us identify our peak patterns and optimize staffing. Our revenue increased by 35% in just 3 months!",
      avatar: "SC"
    }
  ];

  const steps = [
    {
      step: "01",
      title: "Quick Setup",
      description: "Create your account and add restaurant details in under 5 minutes. No technical expertise required.",
      icon: <Utensils className="w-6 h-6" />
    },
    {
      step: "02", 
      title: "Connect WhatsApp",
      description: "Link your WhatsApp number to receive instant notifications when new orders arrive.",
      icon: <WhatsAppIcon className="w-6 h-6" />
    },
    {
      step: "03",
      title: "Manage & Grow",
      description: "Track orders in real-time, analyze performance, and scale your restaurant operations effortlessly.",
      icon: <TrendingUp className="w-6 h-6" />
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-orange-50/20">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZjc0MDAiIGZpbGwtb3BhY2l0eT0iMC4wMiI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iNCIvPjwvZz48L2c+PC9zdmc+')] opacity-40"></div>
        </div>
        
        <div className="relative pt-16 pb-8 lg:pt-20 lg:pb-12">
          <div className="w-full">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center px-6 lg:px-8">
              {/* Left Content */}
              <div className="space-y-6 lg:space-y-8">
                <div className="space-y-4">
                  <Badge className="inline-flex items-center gap-2 beepbite-gradient text-white px-3 py-1 text-xs font-medium rounded-full">
                    <Sparkles className="w-3 h-3" />
                    Trusted by 800+ Restaurants
                  </Badge>
                  
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight text-slate-900">
                    Never Miss an Order with{' '}
                    <span className="beepbite-gradient-text">BeepBite</span>
                  </h1>
                  
                  <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                    The most reliable restaurant order management system with instant WhatsApp notifications, 
                    real-time tracking, and powerful analytics to keep your kitchen running smoothly.
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button 
                    size="default" 
                    className="beepbite-gradient text-white shadow-md hover:shadow-lg transition-all duration-200 group h-11 px-6 text-sm font-semibold"
                    onClick={() => navigate('/signup')}
                  >
                    Start Free Trial
                    <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                  <Button 
                    size="default" 
                    variant="outline" 
                    className="border border-slate-300 text-slate-700 hover:bg-slate-50 transition-all duration-200 h-11 px-6 text-sm font-semibold group"
                  >
                    <Play className="mr-2 w-4 h-4 group-hover:scale-110 transition-transform" />
                    Watch Demo
                  </Button>
                </div>

                <div className="flex flex-wrap gap-4 pt-2">
                  {[
                    { icon: <WhatsAppIcon className="w-4 h-4 text-green-600" />, text: "WhatsApp alerts" },
                    { icon: <CheckCircle className="w-4 h-4 text-green-600" />, text: "No setup fees" },
                    { icon: <CheckCircle className="w-4 h-4 text-green-600" />, text: "Cancel anytime" }
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {item.icon}
                      <span className="text-xs font-medium text-slate-600">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Visual */}
              <div className="relative lg:justify-self-end">
                <div className="relative z-10 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-w-sm mx-auto lg:mx-0">
                  <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-4 py-3 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                      </div>
                      <h3 className="font-semibold text-slate-800 text-base">Live Orders</h3>
                      <Badge className="ml-auto bg-green-100 text-green-700 text-xs px-2 py-0.5">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"></div>
                        Live
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="p-4 space-y-3">
                    {[
                      { id: "#2847", customer: "Maria G.", items: "2x Spicy Burger, 1x Fries", time: "Just now", status: "new", urgent: true },
                      { id: "#2846", customer: "John D.", items: "1x Margherita Pizza", time: "3 min ago", status: "preparing", urgent: false },
                      { id: "#2845", customer: "Sarah K.", items: "3x Fish Tacos, 2x Drinks", time: "8 min ago", status: "ready", urgent: false }
                    ].map((order, i) => (
                      <div key={i} className={`p-3 rounded-lg border ${order.urgent ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-200'} transition-all duration-200 hover:shadow-sm`}>
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 text-sm">{order.id}</span>
                              <Badge 
                                variant={order.status === 'ready' ? 'default' : order.status === 'new' ? 'destructive' : 'secondary'} 
                                className="text-xs px-2 py-0.5"
                              >
                                {order.status}
                              </Badge>
                            </div>
                            <p className="font-medium text-slate-800 text-sm">{order.customer}</p>
                            <p className="text-xs text-slate-600">{order.items}</p>
                            <p className="text-xs text-slate-500">{order.time}</p>
                          </div>
                          <div className="ml-3">
                            <div className={`p-2 rounded-lg ${order.urgent ? 'bg-orange-100' : 'bg-slate-100'}`}>
                              <Bell className={`w-4 h-4 ${order.urgent ? 'text-orange-600 animate-pulse' : 'text-slate-500'}`} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Floating decorative elements */}
                <div className="absolute -top-6 -right-6 w-24 h-24 beepbite-gradient rounded-full opacity-8 animate-pulse"></div>
                <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-slate-100 rounded-full"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

     
      {/* Features Section */}
      <section className="bg-white pt-12 pb-8 lg:pt-16 lg:pb-12">
        <div className="w-full">
          <div className="text-center mb-12 lg:mb-16 px-6 lg:px-8">
            <Badge className="inline-flex items-center gap-2 bg-orange-100 text-orange-800 px-3 py-1 text-xs font-medium rounded-full mb-4">
              <Zap className="w-3 h-3" />
              Powerful Features
            </Badge>
            <h2 className="text-2xl lg:text-4xl font-bold mb-4 text-slate-900">
              Everything Your Restaurant Needs
            </h2>
            <p className="text-base lg:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              From instant notifications to comprehensive analytics, BeepBite provides all the tools 
              to streamline operations and deliver exceptional customer service.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 px-6 lg:px-8">
            {features.map((feature, i) => (
              <Card key={i} className={`group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border border-slate-200 ${feature.highlight ? 'ring-1 ring-orange-200 bg-orange-50/50' : ''}`}>
                <CardContent className="p-6 text-center">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition-transform duration-300 ${
                    feature.highlight 
                      ? 'beepbite-gradient text-white' 
                      : 'bg-slate-100 text-slate-600 group-hover:bg-orange-500 group-hover:text-white'
                  }`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold mb-3 text-slate-900">{feature.title}</h3>
                  <p className="text-slate-600 leading-relaxed text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-gradient-to-br from-slate-50 to-white pt-12 pb-8 lg:pt-16 lg:pb-12">
        <div className="w-full">
          <div className="text-center mb-12 lg:mb-16 px-6 lg:px-8">
            <Badge className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 text-xs font-medium rounded-full mb-4">
              <Clock className="w-3 h-3" />
              Quick Setup
            </Badge>
            <h2 className="text-2xl lg:text-4xl font-bold mb-4 text-slate-900">How BeepBite Works</h2>
            <p className="text-base lg:text-lg text-slate-600 max-w-xl mx-auto">Get started in minutes, not hours</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12 px-6 lg:px-8">
            {steps.map((step, i) => (
              <div key={i} className="text-center group">
                <div className="relative mb-6">
                  <div className="w-16 h-16 beepbite-gradient rounded-full flex items-center justify-center text-white mx-auto group-hover:scale-105 transition-transform duration-300 shadow-lg">
                    {step.icon}
                  </div>
                  <div className="absolute -top-2 -right-2 w-8 h-8 bg-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md">
                    {step.step}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-full w-full h-0.5 bg-gradient-to-r from-orange-300 to-transparent transform translate-x-6"></div>
                  )}
                </div>
                <h3 className="text-lg lg:text-xl font-semibold mb-3 text-slate-900">{step.title}</h3>
                <p className="text-slate-600 leading-relaxed text-sm">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-white pt-12 pb-8 lg:pt-16 lg:pb-12">
        <div className="w-full">
          <div className="text-center mb-12 lg:mb-16 px-6 lg:px-8">
            <Badge className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-3 py-1 text-xs font-medium rounded-full mb-4">
              <Star className="w-3 h-3" />
              Customer Success
            </Badge>
            <h2 className="text-2xl lg:text-4xl font-bold mb-4 text-slate-900">Loved by Restaurant Owners</h2>
            <p className="text-base lg:text-lg text-slate-600 max-w-xl mx-auto">See what our customers say about BeepBite</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 px-6 lg:px-8">
            {testimonials.map((testimonial, i) => (
              <Card key={i} className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border border-slate-200">
                <CardContent className="p-6">
                  <div className="flex items-center mb-4">
                    {[...Array(testimonial.rating)].map((_, j) => (
                      <Star key={j} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <blockquote className="text-slate-600 mb-4 leading-relaxed text-sm">
                    "{testimonial.text}"
                  </blockquote>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 beepbite-gradient rounded-full flex items-center justify-center text-white font-semibold text-sm">
                      {testimonial.avatar}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{testimonial.name}</div>
                      <div className="text-xs text-slate-600">{testimonial.restaurant}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1">
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

      {/* CTA Section */}
      <section className="beepbite-gradient text-white relative overflow-hidden py-12 lg:py-16">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative">
          <div className="w-full text-center">
            <div className="mx-auto space-y-6 px-6 lg:px-8">
              <Badge className="inline-flex items-center gap-2 bg-white/20 text-white px-3 py-1 text-xs font-medium rounded-full">
                <Sparkles className="w-3 h-3" />
                Join 800+ Restaurants
              </Badge>
              <h2 className="text-2xl lg:text-4xl font-bold leading-tight">
                Ready to Transform Your Restaurant Operations?
              </h2>
              <p className="text-base lg:text-lg opacity-90 max-w-2xl mx-auto leading-relaxed">
                Join thousands of restaurants using BeepBite to streamline operations, 
                reduce missed orders, and deliver exceptional customer service.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <Button 
                  size="default" 
                  variant="secondary"
                  className="bg-white text-orange-600 hover:bg-slate-50 shadow-md h-11 px-6 text-sm font-semibold"
                  onClick={() => navigate('/signup')}
                >
                  Start Your Free Trial
                </Button>
                <Button 
                  size="default" 
                  variant="outline"
                  className="border border-white text-white bg-transparent hover:bg-transparent hover:text-white h-11 px-6 text-sm font-semibold"
                >
                  Schedule a Demo
                </Button>
              </div>
              <div className="flex flex-wrap justify-center gap-6 pt-4 text-xs opacity-80">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  <span>Free 30-day trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  <span>Setup in 5 minutes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-10">
        <div className="w-full">
          <div className="grid md:grid-cols-5 gap-6 lg:gap-8 px-6 lg:px-8">
            <div className="col-span-2 space-y-4">
              <Logo variant="minimal" className="text-left" />
              <p className="text-slate-300 max-w-md leading-relaxed text-sm flex items-start gap-2">
                <WhatsAppIcon className="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0" />
                BeepBite helps restaurants manage orders efficiently with real-time WhatsApp notifications 
                and comprehensive analytics to grow your business.
              </p>
              <div className="flex space-x-3">
                {[
                  { icon: "M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z", href: "#" },
                  { icon: "M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 3.95-.36.1-.74.15-1.13.15-.27 0-.54-.03-.8-.08.54 1.69 2.11 2.95 4 2.98-1.46 1.16-3.31 1.84-5.33 1.84-.35 0-.69-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z", href: "#" },
                  { icon: "M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.174-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24.009c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z", href: "#" }
                ].map((social, i) => (
                  <a key={i} href={social.href} className="w-8 h-8 bg-slate-700 hover:bg-orange-500 rounded-lg flex items-center justify-center transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d={social.icon} />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4 text-base">Product</h4>
              <ul className="space-y-2 text-slate-300 text-sm">
                <li><a href="/docs/features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="/docs/api" className="hover:text-white transition-colors">API</a></li>
                <li><a href="#demo" className="hover:text-white transition-colors">Demo</a></li>
                <li><a href="/docs/integrations" className="hover:text-white transition-colors">Integrations</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4 text-base">Resources</h4>
              <ul className="space-y-2 text-slate-300 text-sm">
                <li><a href="/docs" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="/cookies" className="hover:text-white transition-colors">Cookie Policy</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4 text-base">Support</h4>
              <ul className="space-y-2 text-slate-300 text-sm">
                <li className="flex items-center gap-2">
                  <Mail className="w-3 h-3" />
                  <a href="mailto:support@beepbite.com" className="hover:text-white transition-colors">support@beepbite.com</a>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="w-3 h-3" />
                  <a href="tel:+1-555-BEEP-BITE" className="hover:text-white transition-colors">+1 (555) BEEP-BITE</a>
                </li>
                <li><a href="/docs/troubleshooting" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="https://status.beepbite.com" className="hover:text-white transition-colors">Status Page</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-slate-700 mt-8 pt-6 px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-3 md:space-y-0">
              <p className="text-slate-300 text-xs">
                &copy; {new Date().getFullYear()} BeepBite. All rights reserved.
              </p>
              <div className="flex flex-wrap justify-center md:justify-end gap-4 text-xs text-slate-300">
                <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
                <a href="/terms" className="hover:text-white transition-colors">Terms of Service</a>
                <a href="/cookies" className="hover:text-white transition-colors">Cookie Policy</a>
                <a href="/docs" className="hover:text-white transition-colors">Documentation</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
