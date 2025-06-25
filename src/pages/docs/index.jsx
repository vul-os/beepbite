import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import DocsLayout from '@/components/layout/docs-layout';
import { 
  ArrowRight, 
  Search,
  Clock,
  CheckCircle,
  Zap,
  BarChart3,
  Heart,
  Users,
  Star,
  Mail,
  UserPlus,
  MessageSquare as MessageSquareIcon
} from 'lucide-react';

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const DocsIndex = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const quickActions = [
    {
      title: "Create Your Account",
      description: "Sign up and start in 2 minutes",
      href: "#getting-started",
      icon: <UserPlus className="w-6 h-6" />,
      color: "bg-orange-500"
    },
    {
      title: "Configure Templates",
      description: "Customize your notification messages",
      href: "#templates",
      icon: <MessageSquareIcon className="w-6 h-6" />,
      color: "bg-blue-500"
    },
    {
      title: "Start Notifying",
      description: "Send instant WhatsApp alerts",
      href: "#notification-system", 
      icon: <WhatsAppIcon className="w-6 h-6" />,
      color: "bg-green-500"
    }
  ];

  const features = [
    {
      category: "Core Features",
      items: [
        { name: "Instant WhatsApp Notifications", icon: <WhatsAppIcon className="w-4 h-4" /> },
        { name: "Order Ready Alerts", icon: <Clock className="w-4 h-4" /> },
        { name: "Customer Review Collection", icon: <Star className="w-4 h-4" /> },
        { name: "Delivery Tracking", icon: <BarChart3 className="w-4 h-4" /> }
      ]
    },
    {
      category: "Business Benefits",
      items: [
        { name: "Faster Food Pickup", icon: <Zap className="w-4 h-4" /> },
        { name: "Reduced Food Waste", icon: <Heart className="w-4 h-4" /> },
        { name: "Happy Customers", icon: <Users className="w-4 h-4" /> },
        { name: "No Cold Food Complaints", icon: <CheckCircle className="w-4 h-4" /> }
      ]
    }
  ];

  return (
    <DocsLayout title="BeepBite Documentation" description="Complete guide to WhatsApp notifications">
      <div className="space-y-12 font-inter">
        
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-orange-100 text-orange-700 px-4 py-2 rounded-full text-sm font-medium mb-6 font-inter">
            <WhatsAppIcon className="w-4 h-4" />
            WhatsApp Notification Service
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent font-inter">
            Stop Serving Cold Food
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed font-inter">
            Learn how to use BeepBite's WhatsApp notification service to get hot food to customers faster 
            and eliminate cold food complaints.
          </p>
          
          {/* Search Bar */}
          <div className="max-w-md mx-auto relative mb-8">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input 
              placeholder="Search documentation..." 
              className="pl-10 border-2 focus:border-orange-400 shadow-sm font-inter"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <section>
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">Quick Actions</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {quickActions.map((action, index) => (
              <Card 
                key={index} 
                className="group hover:shadow-lg transition-all duration-300 cursor-pointer border border-orange-100 hover:border-orange-300"
                onClick={() => {
                  if (action.href.includes('#')) {
                    const element = document.getElementById(action.href.split('#')[1]);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth' });
                    }
                  } else {
                    navigate(action.href);
                  }
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white ${action.color}`}>
                      {action.icon}
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
                  </div>
                  <h3 className="font-semibold mb-2 group-hover:text-orange-600 transition-colors font-inter">
                    {action.title}
                  </h3>
                  <p className="text-sm text-muted-foreground font-inter">
                    {action.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Getting Started */}
        <section id="getting-started">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">Getting Started</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <div className="space-y-6">
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">1. Sign Up for BeepBite</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Create your restaurant account - no WhatsApp Business setup needed</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">2. Add Your Restaurant Details</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Enter your restaurant name, phone number, and operating hours</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">3. Configure Notification Templates</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Customize the messages customers receive when orders are ready</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">4. Start Sending Notifications</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Mark orders as ready and watch WhatsApp notifications go out instantly</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Templates */}
        <section id="templates">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">Message Templates</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4 text-orange-700 font-inter">Default Order Ready Message</h3>
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200 mb-4">
                <div className="bg-white p-4 rounded border border-orange-200 font-mono text-sm">
                  🍽️ Hi [Customer Name]! Your order #[Order Number] is ready for pickup at [Restaurant Name]. 
                  Please collect within 15 minutes to ensure your food stays hot and fresh. Thank you!
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4 font-inter">
                Variables like [Customer Name] and [Order Number] are automatically replaced with real data from your orders.
              </p>
              
              <h4 className="font-semibold mb-3 text-orange-700 font-inter">Customization Options</h4>
              <ul className="text-sm text-muted-foreground space-y-2 ml-4 font-inter">
                <li>• Change the pickup time window (5, 10, 15, or 20 minutes)</li>
                <li>• Add your restaurant's special instructions</li>
                <li>• Include parking or location details</li>
                <li>• Set different messages for different order types</li>
              </ul>
              
              <Button className="bg-orange-500 hover:bg-orange-600 text-white mt-4 font-inter">
                Customize Templates
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Notification System */}
        <section id="notification-system">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">How Notifications Work</h2>
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="border border-orange-100">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4 text-orange-700 flex items-center gap-2">
                  <WhatsAppIcon className="w-5 h-5 text-green-600" />
                  Instant Delivery
                </h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Under 1 Second</p>
                      <p className="text-sm text-muted-foreground">Notifications sent instantly when you mark orders ready</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Direct to WhatsApp</p>
                      <p className="text-sm text-muted-foreground">Customers receive messages in their WhatsApp inbox</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">No App Required</p>
                      <p className="text-sm text-muted-foreground">Works with any phone that has WhatsApp</p>
                    </div>
                  </li>
                </ul>
              </CardContent>
            </Card>
            
            <Card className="border border-orange-100">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4 text-orange-700">Simple Process</h3>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">1</span>
                    <span>Customer places order and provides phone number</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">2</span>
                    <span>You prepare the food as normal</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">3</span>
                    <span>Click "Mark Ready" in BeepBite dashboard</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">4</span>
                    <span>Customer gets WhatsApp notification instantly</span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Features Overview */}
        <section>
          <h2 className="text-2xl font-semibold mb-6 text-orange-800">What BeepBite Does</h2>
          <div className="grid lg:grid-cols-2 gap-8">
            {features.map((category, idx) => (
              <Card key={idx} className="border border-orange-100">
                <CardContent className="p-6">
                  <h3 className="text-xl font-semibold mb-4 text-orange-700">{category.category}</h3>
                  <div className="space-y-3">
                    {category.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600">
                          {item.icon}
                        </div>
                        <span className="font-medium">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800">Common Issues</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <div className="space-y-4">
                {[
                  {
                    issue: "Notifications not sending",
                    solution: "Check customer phone number format (+27123456789) and internet connection"
                  },
                  {
                    issue: "Customers not receiving messages",
                    solution: "Verify phone numbers are correct and customers haven't blocked business messages"
                  },
                  {
                    issue: "Messages sending slowly",
                    solution: "Check your internet connection - notifications depend on network speed"
                  },
                  {
                    issue: "Can't mark orders as ready",
                    solution: "Refresh the page or check if you're logged in to your BeepBite account"
                  }
                ].map((item, idx) => (
                  <div key={idx} className="border-l-4 border-orange-300 pl-4">
                    <h4 className="font-semibold text-sm mb-1 text-orange-800">{item.issue}</h4>
                    <p className="text-sm text-muted-foreground">{item.solution}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTA */}
        <Card className="bg-gradient-to-r from-orange-50 to-orange-100 border-2 border-orange-200">
          <CardContent className="p-8 text-center">
            <h2 className="text-2xl font-semibold mb-4 text-orange-800">Ready to Stop Serving Cold Food?</h2>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Join restaurants using BeepBite to get hot food to customers faster with instant WhatsApp notifications.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate('/signup')}>
                Start Free Trial
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
                <Mail className="mr-2 w-4 h-4" />
                Get Help
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsIndex; 