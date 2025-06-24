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
  TrendingUp
} from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: <Bell className="w-8 h-8" />,
      title: "Real-Time Notifications",
      description: "Instant WhatsApp alerts when new orders arrive. Never miss a bite!",
      gradient: "from-orange-500 to-red-500"
    },
    {
      icon: <Smartphone className="w-8 h-8" />,
      title: "WhatsApp Integration", 
      description: "Seamless integration with WhatsApp for order notifications and customer communication.",
      gradient: "from-green-500 to-emerald-500"
    },
    {
      icon: <BarChart3 className="w-8 h-8" />,
      title: "Order Analytics",
      description: "Track order patterns, peak hours, and customer reviews to optimize your restaurant.",
      gradient: "from-blue-500 to-purple-500"
    },
    {
      icon: <Users className="w-8 h-8" />,
      title: "Team Management",
      description: "Invite staff members with different roles - owners, managers, and kitchen staff.",
      gradient: "from-purple-500 to-pink-500"
    },
    {
      icon: <Clock className="w-8 h-8" />,
      title: "Order Tracking",
      description: "Track orders from pending to ready. Set preparation times and notify customers.",
      gradient: "from-yellow-500 to-orange-500"
    },
    {
      icon: <Star className="w-8 h-8" />,
      title: "Review System",
      description: "Collect and manage customer reviews to improve your service quality.",
      gradient: "from-orange-500 to-yellow-500"
    }
  ];

  const stats = [
    { number: "10,000+", label: "Orders Processed" },
    { number: "500+", label: "Happy Restaurants" },
    { number: "99.9%", label: "Uptime" },
    { number: "< 2s", label: "Notification Speed" }
  ];

  const testimonials = [
    {
      name: "Maria Rodriguez",
      restaurant: "Casa Maria Bistro",
      rating: 5,
      text: "BeepBite transformed our kitchen operations. We never miss orders anymore and our customers love the quick service!"
    },
    {
      name: "Ahmed Hassan", 
      restaurant: "Spice Garden",
      rating: 5,
      text: "The WhatsApp integration is genius! Our staff gets notified instantly and we can manage everything from one place."
    },
    {
      name: "Sarah Chen",
      restaurant: "Golden Dragon",
      rating: 5,
      text: "Order tracking and analytics helped us identify our peak hours and optimize staffing. Revenue is up 30%!"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-gray-50 via-white to-orange-50">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="container mx-auto px-4 py-20 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <Badge className="beepbite-gradient text-white px-4 py-2 text-sm font-medium">
                  🚀 Now with WhatsApp Integration
                </Badge>
                <h1 className="text-4xl md:text-6xl font-bold leading-tight">
                  Never Miss an Order with{' '}
                  <span className="beepbite-gradient-text">BeepBite</span>
                </h1>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  The most reliable restaurant order management system. Get instant WhatsApp notifications, 
                  track orders in real-time, and keep your kitchen running smoothly during peak hours.
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  size="lg" 
                  className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-300 group"
                  onClick={() => navigate('/signup')}
                >
                  Start Free Trial
                  <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="border-2 border-primary text-primary hover:bg-primary hover:text-white transition-all duration-300"
                >
                  Watch Demo
                </Button>
              </div>

              <div className="flex items-center space-x-6 pt-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">No setup fees</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">30-day free trial</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">Cancel anytime</span>
                </div>
              </div>
            </div>

            {/* Hero Visual */}
            <div className="relative">
              <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-6 border">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">Incoming Orders</h3>
                    <Badge className="bg-green-100 text-green-800">Live</Badge>
                  </div>
                  
                  {[
                    { order: "#2543", customer: "Maria G.", items: "2x Burger, 1x Fries", time: "2 min ago", status: "preparing" },
                    { order: "#2544", customer: "John D.", items: "1x Pizza Margherita", time: "5 min ago", status: "ready" },
                    { order: "#2545", customer: "Sarah K.", items: "3x Tacos, 2x Drinks", time: "Just now", status: "pending" }
                  ].map((order, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">{order.order}</span>
                          <Badge variant={order.status === 'ready' ? 'default' : 'secondary'} className="text-xs">
                            {order.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{order.customer} • {order.items}</p>
                        <p className="text-xs text-muted-foreground">{order.time}</p>
                      </div>
                      <Bell className="w-5 h-5 text-primary animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Floating elements */}
              <div className="absolute -top-4 -right-4 w-24 h-24 beepbite-gradient rounded-full opacity-20 animate-pulse"></div>
              <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-secondary rounded-full opacity-10"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-secondary text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-bold beepbite-gradient-text mb-2">
                  {stat.number}
                </div>
                <div className="text-sm text-gray-300">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Everything Your Restaurant Needs
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              From instant notifications to comprehensive analytics, BeepBite provides all the tools 
              to streamline your restaurant operations and delight customers.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <Card key={i} className="group hover:shadow-xl transition-all duration-300 hover:-translate-y-2 border-0 shadow-lg">
                <CardContent className="p-8">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform duration-300`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-gradient-to-br from-gray-50 to-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">How BeepBite Works</h2>
            <p className="text-xl text-muted-foreground">Get started in minutes, not hours</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Connect Your Restaurant",
                description: "Sign up and add your restaurant details. Invite your team members with appropriate roles.",
                icon: <Utensils className="w-8 h-8" />
              },
              {
                step: "02", 
                title: "Setup WhatsApp Notifications",
                description: "Configure your WhatsApp number to receive instant order notifications on your phone.",
                icon: <MessageSquare className="w-8 h-8" />
              },
              {
                step: "03",
                title: "Start Managing Orders",
                description: "Receive orders, track preparation status, and collect customer reviews seamlessly.",
                icon: <TrendingUp className="w-8 h-8" />
              }
            ].map((step, i) => (
              <div key={i} className="text-center group">
                <div className="relative mb-8">
                  <div className="w-20 h-20 beepbite-gradient rounded-full flex items-center justify-center text-white mx-auto group-hover:scale-110 transition-transform duration-300">
                    {step.icon}
                  </div>
                  <div className="absolute -top-2 -right-2 w-8 h-8 bg-secondary text-white rounded-full flex items-center justify-center text-sm font-bold">
                    {step.step}
                  </div>
                </div>
                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Loved by Restaurant Owners</h2>
            <p className="text-xl text-muted-foreground">See what our customers say about BeepBite</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, i) => (
              <Card key={i} className="group hover:shadow-xl transition-all duration-300">
                <CardContent className="p-8">
                  <div className="flex items-center mb-4">
                    {[...Array(testimonial.rating)].map((_, j) => (
                      <Star key={j} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-muted-foreground mb-6 leading-relaxed">"{testimonial.text}"</p>
                  <div>
                    <div className="font-semibold">{testimonial.name}</div>
                    <div className="text-sm text-muted-foreground">{testimonial.restaurant}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 beepbite-gradient text-white">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              Ready to Transform Your Restaurant?
            </h2>
            <p className="text-xl mb-8 opacity-90">
              Join thousands of restaurants already using BeepBite to streamline their operations 
              and deliver exceptional customer service.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                variant="secondary"
                className="bg-white text-primary hover:bg-gray-100 shadow-lg"
                onClick={() => navigate('/signup')}
              >
                Start Your Free Trial
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                className="border-white text-white hover:bg-white hover:text-primary"
              >
                Schedule a Demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-secondary text-white">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="col-span-2">
              <Logo className="mb-4 text-left" />
              <p className="text-gray-300 max-w-md">
                BeepBite helps restaurants manage orders efficiently with real-time notifications 
                and comprehensive analytics.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-300">
                <li>Features</li>
                <li>Pricing</li>
                <li>API</li>
                <li>Support</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-gray-300">
                <li>About</li>
                <li>Blog</li>
                <li>Careers</li>
                <li>Contact</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-8 pt-8 text-center text-gray-300">
            <p>&copy; {new Date().getFullYear()} BeepBite. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
