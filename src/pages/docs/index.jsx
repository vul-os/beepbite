import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import DocsLayout from '@/components/layout/docs-layout';
import POSInterfacePreview from '@/components/previews/pos-interface-preview';
import WhatsAppPreview from '@/components/previews/whatsapp-preview';
import DashboardPreview from '@/components/previews/dashboard-preview';
import MenuManagementPreview from '@/components/previews/menu-management-preview';
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
  MessageSquare as MessageSquareIcon,
  CreditCard,
  Package,
  Settings,
  Play,
  Eye
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
      title: "Setup Your POS System",
      description: "Complete installation and configuration guide",
      href: "#getting-started",
      icon: <Settings className="w-6 h-6" />,
      color: "bg-orange-500"
    },
    {
      title: "Configure Payments",
      description: "Set up card processing and payment methods",
      href: "#payment-setup",
      icon: <CreditCard className="w-6 h-6" />,
      color: "bg-blue-500"
    },
    {
      title: "Enable WhatsApp Features",
      description: "Add WhatsApp ordering and digital pagers",
      href: "#whatsapp-setup", 
      icon: <WhatsAppIcon className="w-6 h-6" />,
      color: "bg-green-500"
    }
  ];

  const features = [
    {
      category: "Traditional POS Features",
      items: [
        { name: "Payment Processing", icon: <CreditCard className="w-4 h-4" /> },
        { name: "Inventory Management", icon: <Package className="w-4 h-4" /> },
        { name: "Staff Management", icon: <Users className="w-4 h-4" /> },
        { name: "Sales Reporting", icon: <BarChart3 className="w-4 h-4" /> }
      ]
    },
    {
      category: "Enhanced WhatsApp Features",
      items: [
        { name: "WhatsApp Ordering", icon: <WhatsAppIcon className="w-4 h-4" /> },
        { name: "Digital Restaurant Pagers", icon: <Clock className="w-4 h-4" /> },
        { name: "WhatsApp Payments", icon: <CreditCard className="w-4 h-4" /> },
        { name: "Customer Communication", icon: <MessageSquareIcon className="w-4 h-4" /> }
      ]
    }
  ];

  return (
    <DocsLayout title="BeepBite Documentation" description="Complete POS System with WhatsApp Integration">
      <div className="space-y-16 font-inter">
        
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-orange-100 text-orange-700 px-4 py-2 rounded-full text-sm font-medium mb-6 font-inter">
            <CreditCard className="w-4 h-4" />
            Complete POS System
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent font-inter">
            Traditional POS + WhatsApp
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed mb-8 font-inter">
            See exactly how BeepBite's complete restaurant POS system works, with interactive previews of the real interface, 
            WhatsApp integration, and powerful analytics dashboard.
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

        {/* Main POS Interface Preview */}
        <section>
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-medium mb-4">
              <Eye className="w-4 h-4" />
              Live Preview
            </div>
            <h2 className="text-3xl font-semibold mb-4 text-orange-800 font-inter">Your Complete POS System</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed font-inter">
              Experience the actual BeepBite interface. This is exactly what you'll see when managing orders, 
              processing payments, and running your restaurant.
            </p>
          </div>
          <POSInterfacePreview className="mb-8" />
          <div className="text-center">
            <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate('/signup')}>
              <Play className="mr-2 w-4 h-4" />
              Try Live Demo
            </Button>
          </div>
        </section>

        {/* WhatsApp Integration Preview */}
        <section>
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium mb-4">
              <MessageSquareIcon className="w-4 h-4" />
              Interactive Demo
            </div>
            <h2 className="text-3xl font-semibold mb-4 text-orange-800 font-inter">WhatsApp Digital Pagers in Action</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed font-inter">
              Watch a real customer order flow from WhatsApp message to pickup notification. 
              No more lost buzzers or confused customers.
            </p>
          </div>
          <WhatsAppPreview className="mb-8" />
        </section>

        {/* Dashboard Analytics Preview */}
        <section>
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm font-medium mb-4">
              <BarChart3 className="w-4 h-4" />
              Real-time Data
            </div>
            <h2 className="text-3xl font-semibold mb-4 text-orange-800 font-inter">Powerful Analytics Dashboard</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed font-inter">
              Track revenue, monitor performance, and understand customer behavior with comprehensive 
              analytics that update in real-time.
            </p>
          </div>
          <DashboardPreview className="mb-8" />
        </section>

        {/* Menu Management Preview */}
        <section>
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm font-medium mb-4">
              <Package className="w-4 h-4" />
              Menu Control
            </div>
            <h2 className="text-3xl font-semibold mb-4 text-orange-800 font-inter">Complete Menu Management</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed font-inter">
              Manage your entire menu, track inventory, set variations, and control availability 
              from one powerful interface.
            </p>
          </div>
          <MenuManagementPreview className="mb-8" />
        </section>

        {/* Complete Ecosystem Overview */}
        <section>
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold mb-4 text-orange-800 font-inter">Complete Restaurant Ecosystem</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed font-inter">
              Everything you need to run a modern restaurant, from traditional POS to cutting-edge WhatsApp integration.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8 mb-12">
            {/* Traditional POS Features */}
            <Card className="border border-orange-100 bg-white">
              <CardContent className="p-8">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="w-8 h-8 text-orange-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-orange-800 mb-2">Traditional POS Excellence</h3>
                  <p className="text-gray-600">All the features you expect from a modern POS system</p>
                </div>
                
                <div className="space-y-4">
                  {[
                    { icon: <CreditCard className="w-5 h-5" />, title: "Payment Processing", desc: "Card, cash, contactless, mobile wallets" },
                    { icon: <Package className="w-5 h-5" />, title: "Inventory Management", desc: "Real-time stock tracking and alerts" },
                    { icon: <Users className="w-5 h-5" />, title: "Staff Management", desc: "Roles, permissions, and access control" },
                    { icon: <BarChart3 className="w-5 h-5" />, title: "Comprehensive Reports", desc: "Sales, analytics, and business insights" }
                  ].map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center text-orange-600 flex-shrink-0">
                        {feature.icon}
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">{feature.title}</h4>
                        <p className="text-sm text-gray-600">{feature.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* WhatsApp Enhanced Features */}
            <Card className="border border-green-200 bg-gradient-to-br from-green-50 to-green-100">
              <CardContent className="p-8">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <WhatsAppIcon className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-green-800 mb-2">WhatsApp Revolution</h3>
                  <p className="text-green-700">Next-generation customer engagement and ordering</p>
                </div>
                
                <div className="space-y-4">
                  {[
                    { icon: <MessageSquareIcon className="w-5 h-5" />, title: "WhatsApp Ordering", desc: "Customers order directly via WhatsApp chat" },
                    { icon: <Clock className="w-5 h-5" />, title: "Digital Pagers", desc: "Smart notifications replace traditional buzzers" },
                    { icon: <CreditCard className="w-5 h-5" />, title: "WhatsApp Payments", desc: "Process payments through WhatsApp" },
                    { icon: <Users className="w-5 h-5" />, title: "Customer Engagement", desc: "Build relationships through messaging" }
                  ].map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center text-green-600 flex-shrink-0">
                        {feature.icon}
                      </div>
                      <div>
                        <h4 className="font-semibold text-green-900">{feature.title}</h4>
                        <p className="text-sm text-green-700">{feature.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Integration Benefits */}
          <Card className="bg-gradient-to-r from-orange-50 via-white to-green-50 border-2 border-orange-200">
            <CardContent className="p-8 text-center">
              <h3 className="text-2xl font-semibold mb-4 text-gray-900">The Power of Integration</h3>
              <p className="text-lg text-gray-600 mb-8 max-w-3xl mx-auto">
                Unlike other solutions that bolt on WhatsApp as an afterthought, BeepBite is built from the ground up 
                to seamlessly blend traditional POS with modern messaging capabilities.
              </p>
              
              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-lg border border-orange-100">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <Zap className="w-6 h-6 text-blue-600" />
                  </div>
                  <h4 className="font-semibold mb-2">Unified Experience</h4>
                  <p className="text-sm text-gray-600">All orders flow through one system, whether from POS or WhatsApp</p>
                </div>
                
                <div className="bg-white p-6 rounded-lg border border-orange-100">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="w-6 h-6 text-purple-600" />
                  </div>
                  <h4 className="font-semibold mb-2">Complete Analytics</h4>
                  <p className="text-sm text-gray-600">Track performance across all channels in one dashboard</p>
                </div>
                
                <div className="bg-white p-6 rounded-lg border border-orange-100">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <Heart className="w-6 h-6 text-green-600" />
                  </div>
                  <h4 className="font-semibold mb-2">Enhanced Customer Experience</h4>
                  <p className="text-sm text-gray-600">Customers enjoy convenience while you maintain control</p>
                </div>
              </div>
              
              <Button className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white px-8 py-3 text-lg">
                <Play className="mr-2 w-5 h-5" />
                Experience the Complete System
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">Quick Start Guide</h2>
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
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">Setting Up Your Complete POS System</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <div className="space-y-6">
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">1. Install BeepBite as Your Main POS</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Replace your current POS system with BeepBite's complete solution</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">2. Configure Traditional POS Features</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Set up payments, inventory, staff management, and menu configuration</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">3. Enable WhatsApp Integration</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Add WhatsApp ordering, payments, and digital pager notifications</p>
                </div>
                <div className="border-l-4 border-orange-400 pl-4">
                  <h4 className="font-semibold text-orange-800 font-inter">4. Start Operating Dual Channels</h4>
                  <p className="text-muted-foreground mt-1 font-inter">Handle both in-restaurant POS orders and WhatsApp remote orders</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Payment Setup */}
        <section id="payment-setup">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">Payment Processing Setup</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4 text-orange-700 font-inter">Traditional POS Payments</h3>
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200 mb-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-orange-600" />
                    <span className="font-medium">Card Payments: Credit, debit, contactless (tap-to-pay)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-orange-600" />
                    <span className="font-medium">Cash Management: Cash drawer integration and reconciliation</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-orange-600" />
                    <span className="font-medium">Mobile Wallets: Apple Pay, Google Pay, Samsung Pay</span>
                  </div>
                </div>
              </div>
              
              <h4 className="font-semibold mb-3 text-orange-700 font-inter">WhatsApp Payment Integration</h4>
              <ul className="text-sm text-muted-foreground space-y-2 ml-4 font-inter">
                <li>• Process payments via WhatsApp for remote orders</li>
                <li>• Payment links and QR code generation</li>
                <li>• Bank transfer integration</li>
                <li>• Unified payment reporting across all channels</li>
              </ul>
              
              <Button className="bg-orange-500 hover:bg-orange-600 text-white mt-4 font-inter">
                Configure Payment Methods
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* WhatsApp Setup */}
        <section id="whatsapp-setup">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800 font-inter">WhatsApp Integration Setup</h2>
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="border border-orange-100">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4 text-orange-700 flex items-center gap-2">
                  <WhatsAppIcon className="w-5 h-5 text-green-600" />
                  Digital Restaurant Pagers
                </h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Replace Buzzer Systems</p>
                      <p className="text-sm text-muted-foreground">No more lost or broken pagers</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Instant Notifications</p>
                      <p className="text-sm text-muted-foreground">Customers get WhatsApp notifications when food is ready</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Professional Messages</p>
                      <p className="text-sm text-muted-foreground">Branded pickup notifications with restaurant details</p>
                    </div>
                  </li>
                </ul>
              </CardContent>
            </Card>
            
            <Card className="border border-orange-100">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4 text-orange-700">WhatsApp Ordering Process</h3>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">1</span>
                    <span>Customer browses menu and places order via WhatsApp</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">2</span>
                    <span>Order appears in your main POS system alongside dine-in orders</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">3</span>
                    <span>Kitchen prepares order using same workflow as POS orders</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-medium">4</span>
                    <span>Customer receives WhatsApp notification when order is ready</span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Features Overview */}
        <section>
          <h2 className="text-2xl font-semibold mb-6 text-orange-800">Complete Feature Set</h2>
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

        {/* Key Benefits */}
        <section>
          <h2 className="text-2xl font-semibold mb-6 text-orange-800">Why Choose BeepBite Over Traditional POS?</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3 text-orange-700">✅ Everything Your Current POS Does</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Complete payment processing (card, cash, contactless)</li>
                    <li>• Full inventory management and tracking</li>
                    <li>• Staff management with roles and permissions</li>
                    <li>• Comprehensive reporting and analytics</li>
                    <li>• Menu management and pricing control</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-3 text-orange-700">➕ Plus Modern WhatsApp Features</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• WhatsApp remote ordering and payments</li>
                    <li>• Digital restaurant pagers (no more buzzers!)</li>
                    <li>• Dual order channels in one system</li>
                    <li>• Enhanced customer engagement</li>
                    <li>• Additional revenue streams</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting">
          <h2 className="text-2xl font-semibold mb-6 text-orange-800">Common Setup Issues</h2>
          <Card className="border border-orange-100">
            <CardContent className="p-6">
              <div className="space-y-4">
                {[
                  {
                    issue: "Payment processing not working",
                    solution: "Check payment processor credentials and internet connection. Verify SSL certificate is properly configured."
                  },
                  {
                    issue: "Inventory not tracking properly",
                    solution: "Ensure menu items are properly configured with inventory tracking enabled. Check for recent stock adjustments."
                  },
                  {
                    issue: "WhatsApp notifications not sending",
                    solution: "Verify WhatsApp Business API connection and check customer phone number format (+27123456789)."
                  },
                  {
                    issue: "Staff cannot access certain features",
                    solution: "Review user roles and permissions. Ensure staff accounts have appropriate access levels configured."
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
            <h2 className="text-2xl font-semibold mb-4 text-orange-800">Ready to Upgrade Your POS System?</h2>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Get all the features of your current POS system, plus modern WhatsApp capabilities that enhance customer experience and drive additional revenue.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate('/signup')}>
                Start Free Trial
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
                <Mail className="mr-2 w-4 h-4" />
                Get Setup Help
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsIndex; 