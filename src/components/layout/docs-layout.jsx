import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { 
  Book, 
  FileText, 
  Shield, 
  Cookie, 
  HelpCircle, 
  Menu,
  ArrowLeft,
  Zap,
  MessageSquare,
  Settings,
  ExternalLink,
  User
} from 'lucide-react';
import Logo from '@/components/ui/logo';

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const DocsLayout = ({ children, title, description }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    {
      title: "Getting Started",
      items: [
        {
          title: "Documentation Home",
          href: "/docs",
          icon: <Book className="w-4 h-4" />,
          active: location.pathname === "/docs"
        },
        {
          title: "Quick Setup",
          href: "/docs#getting-started",
          icon: <Zap className="w-4 h-4" />,
          active: false
        },
        {
          title: "Message Templates",
          href: "/docs#templates",
          icon: <MessageSquare className="w-4 h-4" />,
          active: false
        }
      ]
    },
    {
      title: "Features",
      items: [
        {
          title: "Notification System",
          href: "/docs#notification-system",
          icon: <WhatsAppIcon className="w-4 h-4" />,
          active: false
        },
        {
          title: "Settings & Config",
          href: "/docs#configuration",
          icon: <Settings className="w-4 h-4" />,
          active: false
        }
      ]
    },
    {
      title: "Legal & Policies",
      items: [
        {
          title: "Privacy Policy",
          href: "/docs/privacy",
          icon: <Shield className="w-4 h-4" />,
          active: location.pathname === "/docs/privacy"
        },
        {
          title: "Terms of Service",
          href: "/docs/terms",
          icon: <FileText className="w-4 h-4" />,
          active: location.pathname === "/docs/terms"
        },
        {
          title: "Cookie Policy",
          href: "/docs/cookies",
          icon: <Cookie className="w-4 h-4" />,
          active: location.pathname === "/docs/cookies"
        }
      ]
    },
    {
      title: "Support",
      items: [
        {
          title: "Custom Avatar URLs",
          href: "/docs/custom-avatar-url",
          icon: <User className="w-4 h-4" />,
          active: location.pathname === "/docs/custom-avatar-url"
        },
        {
          title: "Troubleshooting",
          href: "/docs#troubleshooting",
          icon: <HelpCircle className="w-4 h-4" />,
          active: false
        },
        {
          title: "Contact Support",
          href: "mailto:support@beepbite.io",
          icon: <ExternalLink className="w-4 h-4" />,
          active: false,
          external: true
        }
      ]
    }
  ];

  const NavigationContent = ({ onItemClick = () => {} }) => (
    <nav className="space-y-6 font-inter">
      {navigation.map((section, sectionIdx) => (
        <div key={sectionIdx}>
          <h3 className="text-sm font-semibold text-orange-800 uppercase tracking-wider mb-3 font-inter">
            {section.title}
          </h3>
          <ul className="space-y-1">
            {section.items.map((item, itemIdx) => (
              <li key={itemIdx}>
                {item.external ? (
                  <a
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-orange-50 hover:text-orange-700 font-inter ${
                      item.active 
                        ? 'bg-orange-100 text-orange-700 font-medium border border-orange-200' 
                        : 'text-gray-600'
                    }`}
                    onClick={onItemClick}
                  >
                    {item.icon}
                    {item.title}
                  </a>
                ) : (
                  <button
                    onClick={() => {
                      if (item.href.includes('#')) {
                        navigate('/docs');
                        setTimeout(() => {
                          const element = document.getElementById(item.href.split('#')[1]);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth' });
                          }
                        }, 100);
                      } else {
                        navigate(item.href);
                      }
                      onItemClick();
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-orange-50 hover:text-orange-700 font-inter ${
                      item.active 
                        ? 'bg-orange-100 text-orange-700 font-medium border border-orange-200' 
                        : 'text-gray-600'
                    }`}
                  >
                    {item.icon}
                    {item.title}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50/30 via-white to-orange-50/20 font-inter">
      {/* Mobile Header */}
      <div className="lg:hidden border-b border-orange-100 bg-white/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="lg:hidden p-2">
                  <Menu className="w-4 h-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <VisuallyHidden>
                  <SheetTitle>Documentation Navigation</SheetTitle>
                </VisuallyHidden>
                <div className="p-4 border-b border-orange-100">
                  <Logo variant="minimal" />
                  <p className="text-xs text-muted-foreground mt-1 font-inter">Documentation</p>
                </div>
                <div className="p-4">
                  <NavigationContent onItemClick={() => setMobileMenuOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <h1 className="font-medium text-orange-800 text-sm truncate font-inter">{title || "Documentation"}</h1>
              {description && (
                <p className="text-xs text-muted-foreground truncate font-inter">{description}</p>
              )}
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigate('/')}
            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 px-2 text-xs font-inter"
          >
            <ArrowLeft className="w-3 h-3 mr-1" />
            Home
          </Button>
        </div>
      </div>

      <div className="flex">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex lg:w-80 lg:flex-col lg:fixed lg:inset-y-0 lg:top-16">
          <div className="flex flex-col flex-grow bg-white border-r border-orange-100 overflow-y-auto h-[calc(100vh-4rem)]">
            {/* Header */}
            <div className="flex-shrink-0 p-6 border-b border-orange-100">
              <p className="text-sm text-muted-foreground mt-2 font-inter">Complete documentation for BeepBite</p>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate('/')}
                className="mt-4 text-orange-600 border-orange-200 hover:bg-orange-50 font-inter"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </div>
            
            {/* Navigation */}
            <div className="flex-1 p-6 overflow-y-auto">
              <NavigationContent />
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 p-6 border-t border-orange-100 bg-orange-50/50">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-2 font-inter">Need help?</p>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => window.open('mailto:support@beepbite.io')}
                  className="text-orange-600 border-orange-200 hover:bg-orange-100 font-inter"
                >
                  Contact Support
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:pl-80 flex-1">
          <main className="py-8 lg:py-16">
            <div className="max-w-4xl mx-auto px-4 lg:px-8 font-inter">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default DocsLayout; 