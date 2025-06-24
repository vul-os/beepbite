import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Book, 
  Users, 
  Code, 
  HelpCircle, 
  Star, 
  ArrowRight, 
  FileText, 
  Shield, 
  Cookie,
  Search,
  Settings,
  Smartphone,
  BarChart3,
  Zap,
  Clock,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  Phone,
  Mail,
  ExternalLink,
  Play,
  Download,
  Globe,
  Database,
  Terminal,
  Bug
} from 'lucide-react';

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const DocsIndex = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const documentationSections = [
    {
      id: 'features',
      icon: <Star className="w-5 h-5" />,
      title: "Features Overview",
      description: "Comprehensive guide to all BeepBite features",
      badge: "Essential",
      badgeColor: "bg-blue-600"
    },
    {
      id: 'setup',
      icon: <Settings className="w-5 h-5" />,
      title: "Setup & Installation",
      description: "Get BeepBite running in your restaurant",
      badge: "Start Here",
      badgeColor: "bg-green-600"
    },
    {
      id: 'user-guide',
      icon: <Book className="w-5 h-5" />,
      title: "User Guide",
      description: "Complete manual for restaurant operations",
      badge: "Popular",
      badgeColor: "bg-orange-600"
    },
    {
      id: 'api',
      icon: <Code className="w-5 h-5" />,
      title: "API Documentation",
      description: "Integration and development resources",
      badge: "Technical",
      badgeColor: "bg-purple-600"
    },
    {
      id: 'development',
      icon: <Terminal className="w-5 h-5" />,
      title: "Development Guide",
      description: "Contributing and customization",
      badge: "Advanced",
      badgeColor: "bg-slate-600"
    },
    {
      id: 'troubleshooting',
      icon: <Bug className="w-5 h-5" />,
      title: "Troubleshooting",
      description: "Solutions for common issues",
      badge: "Support",
      badgeColor: "bg-red-600"
    }
  ];

  const quickLinks = [
    {
      title: "Quick Start Guide",
      description: "Get up and running in 5 minutes",
      href: "#setup",
      icon: <Zap className="w-5 h-5" />,
      color: "text-green-600"
    },
    {
      title: "WhatsApp Setup",
      description: "Configure notifications",
      href: "#whatsapp-integration",
      icon: <WhatsAppIcon className="w-5 h-5" />,
      color: "text-green-600"
    },
    {
      title: "API Reference",
      description: "Complete API documentation",
      href: "#api",
      icon: <Code className="w-5 h-5" />,
      color: "text-blue-600"
    },
    {
      title: "Privacy Policy",
      description: "Data protection and privacy",
      href: "/privacy",
      icon: <Shield className="w-5 h-5" />,
      color: "text-slate-600"
    }
  ];

  const features = [
    {
      category: "Core Features",
      items: [
        { name: "Real-time WhatsApp Notifications", icon: <WhatsAppIcon className="w-4 h-4" /> },
        { name: "Order Management & Tracking", icon: <Clock className="w-4 h-4" /> },
        { name: "Team Collaboration", icon: <Users className="w-4 h-4" /> },
        { name: "Analytics & Reporting", icon: <BarChart3 className="w-4 h-4" /> }
      ]
    },
    {
      category: "Advanced Features",
      items: [
        { name: "Customer Review Management", icon: <Star className="w-4 h-4" /> },
        { name: "Custom Branding", icon: <Settings className="w-4 h-4" /> },
        { name: "API Integration", icon: <Code className="w-4 h-4" /> },
        { name: "Multi-platform Support", icon: <Smartphone className="w-4 h-4" /> }
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4">
              <Book className="w-4 h-4" />
              Complete Documentation Hub
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold mb-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-600 bg-clip-text text-transparent">
              BeepBite Documentation
            </h1>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-6 leading-relaxed">
              Complete documentation for BeepBite restaurant management system. 
              Everything from setup to advanced features and API integration.
            </p>
            
            {/* Search Bar */}
            <div className="max-w-md mx-auto relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input 
                placeholder="Search documentation..." 
                className="pl-10 border-2 focus:border-primary/50 shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
            <TabsList className="grid w-full grid-cols-7 h-12 p-1 bg-muted/50 rounded-xl shadow-sm">
              <TabsTrigger value="overview" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Overview</TabsTrigger>
              <TabsTrigger value="features" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Features</TabsTrigger>
              <TabsTrigger value="setup" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Setup</TabsTrigger>
              <TabsTrigger value="user-guide" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">User Guide</TabsTrigger>
              <TabsTrigger value="api" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">API</TabsTrigger>
              <TabsTrigger value="legal" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Legal</TabsTrigger>
              <TabsTrigger value="support" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Support</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-8">
              {/* Quick Links */}
              <section>
                <h2 className="text-2xl font-semibold mb-6">Quick Links</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {quickLinks.map((link, index) => (
                    <Card key={index} className="group hover:shadow-md transition-all duration-300 cursor-pointer">
                      <CardContent className="p-4">
                        <a href={link.href} className="block">
                          <div className="flex items-center justify-between mb-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${link.color} bg-current/10`}>
                              {link.icon}
                            </div>
                            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                          </div>
                          <h3 className="font-semibold mb-1 group-hover:text-primary transition-colors text-sm">
                            {link.title}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {link.description}
                          </p>
                        </a>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* Documentation Sections */}
              <section>
                <h2 className="text-2xl font-semibold mb-6">Documentation Sections</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {documentationSections.map((section, index) => (
                    <Card key={index} className="group hover:shadow-lg transition-all duration-300 cursor-pointer" 
                          onClick={() => setActiveTab(section.id)}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                            {section.icon}
                          </div>
                          <Badge className={`${section.badgeColor} text-white text-xs`}>
                            {section.badge}
                          </Badge>
                        </div>
                        <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
                          {section.title}
                        </h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {section.description}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            </TabsContent>

            {/* Features Tab */}
            <TabsContent value="features" className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-6">Features Overview</h2>
                <p className="text-lg text-muted-foreground mb-8">
                  BeepBite provides comprehensive restaurant management tools designed to streamline operations and enhance customer satisfaction.
                </p>

                {/* Core Features Grid */}
                <div className="grid lg:grid-cols-2 gap-8 mb-8">
                  {features.map((category, idx) => (
                    <Card key={idx}>
                      <CardContent className="p-6">
                        <h3 className="text-xl font-semibold mb-4">{category.category}</h3>
                        <div className="space-y-3">
                          {category.items.map((item, itemIdx) => (
                            <div key={itemIdx} className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
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

                {/* Feature Highlights */}
                <Card className="mb-8">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">WhatsApp Integration Highlights</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <WhatsAppIcon className="w-4 h-4 text-green-600" />
                          Instant Notifications
                        </h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Receive order alerts within seconds</li>
                          <li>• Formatted messages with order details</li>
                          <li>• Quick action buttons for Accept/Decline</li>
                          <li>• Team broadcast notifications</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                          Customer Communication
                        </h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Two-way customer messaging</li>
                          <li>• Order status updates</li>
                          <li>• Estimated completion times</li>
                          <li>• Professional message templates</li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Setup Tab */}
            <TabsContent value="setup" className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-6">Setup & Installation</h2>
                
                {/* Prerequisites */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">Prerequisites</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-2">System Requirements</h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Node.js 18 or higher</li>
                          <li>• npm 8+ or yarn 1.22+</li>
                          <li>• Modern web browser</li>
                          <li>• Internet connection</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">Required Accounts</h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Supabase account (database)</li>
                          <li>• Firebase account (services)</li>
                          <li>• WhatsApp Business account</li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Installation Steps */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">Installation Steps</h3>
                    <div className="space-y-4">
                      <div className="border-l-4 border-primary pl-4">
                        <h4 className="font-semibold">1. Clone and Install</h4>
                        <div className="bg-muted p-3 rounded-md mt-2 font-mono text-sm">
                          git clone https://github.com/yourusername/beepbite-mono.git<br/>
                          cd beepbite-mono<br/>
                          npm install
                        </div>
                      </div>
                      <div className="border-l-4 border-primary pl-4">
                        <h4 className="font-semibold">2. Environment Setup</h4>
                        <div className="bg-muted p-3 rounded-md mt-2 font-mono text-sm">
                          cp .env.example .env.local<br/>
                          # Edit .env.local with your configuration
                        </div>
                      </div>
                      <div className="border-l-4 border-primary pl-4">
                        <h4 className="font-semibold">3. Start Development</h4>
                        <div className="bg-muted p-3 rounded-md mt-2 font-mono text-sm">
                          npm run dev<br/>
                          # App will be available at http://localhost:5173
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* User Guide Tab */}
            <TabsContent value="user-guide" className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-6">User Guide</h2>
                
                {/* Getting Started */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">Getting Started</h3>
                    <div className="grid lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-3">Creating Your Account</h4>
                        <ol className="text-sm text-muted-foreground space-y-2">
                          <li>1. Click "Start Free Trial" on the homepage</li>
                          <li>2. Enter your email and create a password</li>
                          <li>3. Verify your email address</li>
                          <li>4. Complete your restaurant profile</li>
                          <li>5. Set operating hours and contact info</li>
                        </ol>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-3">Dashboard Overview</h4>
                        <ul className="text-sm text-muted-foreground space-y-2">
                          <li>• <strong>Active Orders:</strong> Current orders being prepared</li>
                          <li>• <strong>Today's Stats:</strong> Revenue, order count, prep time</li>
                          <li>• <strong>Recent Activity:</strong> Latest orders and updates</li>
                          <li>• <strong>Quick Actions:</strong> Common tasks and shortcuts</li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Order Management */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">Order Management Workflow</h3>
                    <div className="grid md:grid-cols-4 gap-4">
                      {[
                        { status: "Pending", desc: "New order received", color: "bg-yellow-100 text-yellow-800" },
                        { status: "Confirmed", desc: "Order accepted", color: "bg-blue-100 text-blue-800" },
                        { status: "Preparing", desc: "Being cooked", color: "bg-orange-100 text-orange-800" },
                        { status: "Ready", desc: "Ready for pickup", color: "bg-green-100 text-green-800" }
                      ].map((step, idx) => (
                        <div key={idx} className="text-center p-4 border rounded-lg">
                          <Badge className={`${step.color} mb-2`}>{step.status}</Badge>
                          <p className="text-sm text-muted-foreground">{step.desc}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* API Tab */}
            <TabsContent value="api" className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-6">API Documentation</h2>
                
                {/* API Overview */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">REST API Overview</h3>
                    <div className="grid lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-2">Base URLs</h4>
                        <div className="bg-muted p-3 rounded-md text-sm font-mono">
                          Production: https://api.beepbite.com/v1<br/>
                          Staging: https://staging-api.beepbite.com/v1
                        </div>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">Authentication</h4>
                        <div className="bg-muted p-3 rounded-md text-sm font-mono">
                          Authorization: Bearer YOUR_API_KEY<br/>
                          Content-Type: application/json
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* API Endpoints */}
                <Card className="mb-6">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">Main Endpoints</h3>
                    <div className="space-y-4">
                      {[
                        { method: "GET", endpoint: "/orders", desc: "Retrieve orders with filtering" },
                        { method: "POST", endpoint: "/orders", desc: "Create a new order" },
                        { method: "PATCH", endpoint: "/orders/{id}/status", desc: "Update order status" },
                        { method: "GET", endpoint: "/customers", desc: "Get customer list" },
                        { method: "GET", endpoint: "/menu", desc: "Retrieve menu items" },
                        { method: "GET", endpoint: "/analytics/orders", desc: "Get order analytics" }
                      ].map((api, idx) => (
                        <div key={idx} className="flex items-center gap-4 p-3 border rounded-lg">
                          <Badge variant="outline" className="font-mono text-xs">
                            {api.method}
                          </Badge>
                          <code className="flex-1 text-sm">{api.endpoint}</code>
                          <span className="text-sm text-muted-foreground">{api.desc}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Legal Tab */}
            <TabsContent value="legal" className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-6">Legal Documents</h2>
                <p className="text-lg text-muted-foreground mb-8">
                  Important legal information and policies governing the use of BeepBite services.
                </p>
                
                {/* Legal Document Cards */}
                <div className="grid md:grid-cols-3 gap-6 mb-8">
                  {[
                    {
                      title: "Privacy Policy",
                      description: "How we collect, use, and protect your personal data in compliance with privacy regulations",
                      href: "/privacy",
                      icon: <Shield className="w-6 h-6" />,
                      color: "text-blue-600",
                      bgColor: "bg-blue-50",
                      updated: "Updated March 2024"
                    },
                    {
                      title: "Terms of Service",
                      description: "Legal terms and conditions that govern your use of BeepBite platform and services",
                      href: "/terms",
                      icon: <FileText className="w-6 h-6" />,
                      color: "text-green-600",
                      bgColor: "bg-green-50",
                      updated: "Updated March 2024"
                    },
                    {
                      title: "Cookie Policy",
                      description: "Information about cookies, tracking technologies, and your privacy choices",
                      href: "/cookies",
                      icon: <Cookie className="w-6 h-6" />,
                      color: "text-orange-600",
                      bgColor: "bg-orange-50",
                      updated: "Updated March 2024"
                    }
                  ].map((doc, idx) => (
                    <Card key={idx} className="group hover:shadow-lg transition-all duration-300 cursor-pointer">
                      <CardContent className="p-6">
                        <a href={doc.href} className="block">
                          <div className="flex items-center justify-between mb-4">
                            <div className={`w-12 h-12 ${doc.bgColor} rounded-lg flex items-center justify-center ${doc.color}`}>
                              {doc.icon}
                            </div>
                            <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                          <h3 className="text-lg font-semibold mb-3 group-hover:text-primary transition-colors">
                            {doc.title}
                          </h3>
                          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                            {doc.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{doc.updated}</span>
                            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                          </div>
                        </a>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Legal Summary */}
                <Card className="bg-gradient-to-r from-slate-50 to-slate-100">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      Your Rights & Our Commitments
                    </h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-3 text-slate-800">Data Protection</h4>
                        <ul className="text-sm text-muted-foreground space-y-2">
                          <li>• GDPR & CCPA compliant data handling</li>
                          <li>• End-to-end encryption for sensitive data</li>
                          <li>• Right to data portability and deletion</li>
                          <li>• Regular security audits and assessments</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-3 text-slate-800">Service Terms</h4>
                        <ul className="text-sm text-muted-foreground space-y-2">
                          <li>• Clear service level agreements</li>
                          <li>• Transparent pricing and billing</li>
                          <li>• Fair usage policies</li>
                          <li>• Account termination procedures</li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Contact Legal */}
                <Card className="border-l-4 border-primary">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-3">Legal Inquiries</h3>
                    <p className="text-muted-foreground mb-4">
                      Have questions about our legal policies or need to exercise your data rights? 
                      Contact our legal team for assistance.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button variant="outline" size="sm" asChild>
                        <a href="mailto:legal@beepbite.com">
                          <Mail className="w-4 h-4 mr-2" />
                          legal@beepbite.com
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href="mailto:privacy@beepbite.com">
                          <Shield className="w-4 h-4 mr-2" />
                          privacy@beepbite.com
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Support Tab */}
            <TabsContent value="support" className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-6">Support & Resources</h2>
                
                {/* Contact Options */}
                <div className="grid md:grid-cols-3 gap-6 mb-8">
                  <Card>
                    <CardContent className="p-6 text-center">
                      <Mail className="w-8 h-8 text-primary mx-auto mb-3" />
                      <h3 className="font-semibold mb-2">Email Support</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Get help via email within 24 hours
                      </p>
                      <Button variant="outline" size="sm">
                        <Mail className="w-4 h-4 mr-2" />
                        support@beepbite.com
                      </Button>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="p-6 text-center">
                      <MessageSquare className="w-8 h-8 text-primary mx-auto mb-3" />
                      <h3 className="font-semibold mb-2">Live Chat</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Chat with our support team
                      </p>
                      <Button variant="outline" size="sm">
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Start Chat
                      </Button>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="p-6 text-center">
                      <Phone className="w-8 h-8 text-primary mx-auto mb-3" />
                      <h3 className="font-semibold mb-2">Phone Support</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Call us for urgent issues
                      </p>
                      <Button variant="outline" size="sm">
                        <Phone className="w-4 h-4 mr-2" />
                        +1 (555) BEEP-BITE
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Common Issues */}
                <Card>
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-4">Common Issues & Solutions</h3>
                    <div className="space-y-4">
                      {[
                        {
                          issue: "WhatsApp notifications not working",
                          solution: "Verify phone number format and API credentials"
                        },
                        {
                          issue: "Orders not appearing in dashboard",
                          solution: "Check internet connection and refresh the page"
                        },
                        {
                          issue: "Team members can't access the system",
                          solution: "Ensure proper role assignments and invitation emails"
                        },
                        {
                          issue: "Slow performance or loading issues",
                          solution: "Clear browser cache and check internet speed"
                        }
                      ].map((item, idx) => (
                        <div key={idx} className="border-l-4 border-orange-300 pl-4">
                          <h4 className="font-semibold text-sm mb-1">{item.issue}</h4>
                          <p className="text-sm text-muted-foreground">{item.solution}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>

          {/* Footer CTA */}
          <Card className="mt-12 bg-gradient-to-r from-primary/5 to-secondary/5">
            <CardContent className="p-8 text-center">
              <h2 className="text-2xl font-semibold mb-4">Ready to Get Started?</h2>
              <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                Have questions not covered in the documentation? Our support team is here to help you succeed with BeepBite.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild>
                  <a href="/signup">
                    Start Free Trial
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="mailto:support@beepbite.com">
                    Contact Support
                    <Mail className="ml-2 w-4 h-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DocsIndex; 