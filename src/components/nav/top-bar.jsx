import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { hasCapability } from '@/services/pos';
import { 
  Settings, 
  LogOut, 
  Users, 
  ChevronDown, 
  UserCircle, 
  BarChart3,
  MessageSquare,
  Hash,
  X,
  MapPin,
  Menu,
  ChefHat,
  FileText,
  PieChart,
  Plus,
  Building2,
  Check,
  Store,
  Folder,
  Receipt,
  MonitorPlay,
  Truck
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import Logo from '@/components/ui/logo';

const TopBar = () => {
  const { 
    user, 
    userProfile,
    signOut, 
    locations,
    activeLocation,
    switchLocation,
    organizations,
    activeOrganization,
    switchOrganization
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);

  // Check if we're on the landing page
  const isLandingPage = location.pathname === '/';

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/signin');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleSwitchLocation = (locationId) => {
    try {
      switchLocation(locationId);
    } catch (error) {
      console.error("Error switching location:", error);
    }
  };

  const getUserInitials = () => {
    if (!user?.email) return 'U';
    return user.email
      .split('@')[0]
      .split('.')
      .map(part => part[0]?.toUpperCase())
      .join('')
      .slice(0, 2);
  };

  const isActivePath = (path) => {
    return location.pathname === path;
  };

  const closeSideNav = () => {
    setIsSideNavOpen(false);
  };

  const toggleSideNav = () => {
    setIsSideNavOpen(!isSideNavOpen);
  };

  // Top navigation items (2-3 most accessed)
  const topNavigationItems = [
    {
      name: 'Home',
      path: '/home',
      icon: Hash,
      description: 'Main home'
    },
    {
      name: 'POS',
      path: '/pos/workspace',
      icon: Receipt,
      description: 'Cashier workspace'
    },
    {
      name: 'Kitchen',
      path: '/kds/expo',
      icon: ChefHat,
      description: 'Kitchen Display'
    },
    {
      name: 'Reviews',
      path: '/reviews',
      icon: MessageSquare,
      description: 'Customer feedback'
    }
  ];

  // Side navigation items (organized by category) - Original structure
  const sideNavigationSections = [
    {
      title: 'Front of House',
      items: [
        {
          name: 'POS Workspace',
          path: '/pos/workspace',
          icon: Receipt,
          description: 'Take orders & open the register'
        },
        {
          name: 'Kitchen Display',
          path: '/kds/expo',
          icon: MonitorPlay,
          description: 'Live tickets, ingredients & prep steps'
        }
      ]
    },
    {
      title: 'Operations',
      items: [
        {
          name: 'Reports',
          path: '/reports',
          icon: BarChart3,
          description: 'Sales analytics',
          capability: 'can_view_reports',
        },
        {
          name: 'Menu',
          path: '/menu',
          icon: ChefHat,
          description: 'Menu management'
        },
        {
          name: 'Categories',
          path: '/categories',
          icon: Folder,
          description: 'Manage menu categories'
        }
      ]
    },
    {
      title: 'Team',
      items: [
        {
          name: 'Members',
          path: '/members',
          icon: Users,
          description: 'Loyalty program members'
        },
        {
          name: 'Staff',
          path: '/staff',
          icon: UserCircle,
          description: 'Staff management'
        },
        {
          name: 'Driver Portal',
          path: '/driver',
          icon: Truck,
          description: 'Active deliveries & online toggle'
        }
      ]
    },
    {
      title: 'Settings',
      items: [
        {
          name: 'Organization Settings',
          path: '/settings/organization',
          icon: Building2,
          description: 'Organization & business details'
        },
        {
          name: 'Account',
          path: '/account',
          icon: UserCircle,
          description: 'Account settings'
        }
      ]
    }
  ];

  return (
    <>
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isLandingPage 
          ? 'bg-white/80 backdrop-blur-sm border-b border-gray-100' 
          : 'bg-white border-b border-gray-200'
      }`}>
        <nav className="h-16 px-4 sm:px-6 lg:px-8">
          <div className="h-full flex items-center justify-between max-w-7xl mx-auto">
            {/* Left: Logo and Navigation */}
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center">
                {/* Clean logo component */}
                <Logo variant="minimal" />
              </Link>

              {/* Desktop Navigation - Show for authenticated users */}
              {user && (
                <nav className="hidden sm:flex items-center space-x-2">
                  {topNavigationItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);
                    
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          "flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200",
                          isActive 
                            ? "bg-orange-500 text-white shadow-lg" 
                            : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                        )}
                      >
                        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">{item.name}</span>
                      </Link>
                    );
                  })}
                </nav>
              )}

              {/* Mobile Navigation - Show for authenticated users */}
              {user && (
                <nav className="flex sm:hidden items-center space-x-1">
                  {topNavigationItems.slice(0, 2).map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);
                    
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-200",
                          isActive 
                            ? "bg-orange-500 text-white shadow-lg" 
                            : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>

            {/* Right: Location Selector and User Menu */}
            <div className="flex items-center gap-2">
              {user ? (
                <>
                  {/* Location Selector - Desktop */}
                  {!isLandingPage && (
                    <div className="hidden md:block">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="text-sm font-medium flex items-center gap-2 border-gray-300 text-gray-700 hover:border-orange-500 hover:text-orange-500"
                          >
                            <MapPin className="h-4 w-4" />
                            <span className="max-w-[120px] truncate">
                              {activeLocation?.name || "Select Location"}
                            </span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>Switch Location</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {locations?.length > 0 ? (
                            locations.map((loc) => (
                              <DropdownMenuItem
                                key={loc.id}
                                onClick={() => handleSwitchLocation(loc.id)}
                                className={cn(
                                  "flex items-center gap-2 cursor-pointer",
                                  activeLocation?.id === loc.id && "bg-orange-50"
                                )}
                              >
                                {activeLocation?.id === loc.id && (
                                  <Check className="h-4 w-4 text-orange-500" />
                                )}
                                <Store className="h-4 w-4" />
                                <span>{loc.name}</span>
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem disabled className="text-gray-500">
                              No locations available
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* User Menu Button - Enhanced with depth and visual appeal */}
                  <Button 
                    variant="ghost" 
                    className="h-12 w-12 rounded-full p-0 bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 shadow-lg hover:shadow-xl hover:border-orange-300 hover:from-orange-50 hover:to-white transition-all duration-300 hover:scale-105 active:scale-95"
                    aria-label="Open navigation menu"
                    onClick={toggleSideNav}
                  >
                    <Avatar className="h-9 w-9 ring-2 ring-white shadow-sm">
                      <AvatarImage src={userProfile?.avatar_url} alt="User" className="object-cover" />
                      <AvatarFallback className="bg-gradient-to-br from-orange-500 to-orange-600 text-white font-bold text-sm shadow-inner">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/signin')}
                    className="text-sm font-medium text-gray-700 hover:text-gray-900"
                  >
                    Sign In
                  </Button>
                  <Button
                    size="sm"
                    className="font-medium bg-orange-500 text-white hover:bg-orange-600"
                    onClick={() => navigate('/signup')}
                  >
                    Get Started
                  </Button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* Side Navigation - Original functionality with clean styling */}
      {user && isSideNavOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998]"
            onClick={closeSideNav}
          />
          
          {/* Side Navigation Panel - Clean styling */}
          <div className={cn(
            "fixed top-0 right-0 h-full w-80 sm:w-96 bg-white shadow-2xl z-[9999] transform transition-transform duration-300 ease-out",
            "animate-in slide-in-from-right"
          )}>
            <div className="h-full flex flex-col">
              
              {/* Header - Clean orange styling */}
              <div className="bg-orange-500 px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-white/30">
                      <AvatarImage src={userProfile?.avatar_url} alt="User" />
                      <AvatarFallback className="bg-orange-600 text-white font-bold">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/90 text-sm truncate font-medium">
                        {user.email}
                      </p>
                      <p className="text-white/70 text-xs truncate">
                        {activeLocation?.name || "No location selected"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={closeSideNav}
                    className="text-white/90 hover:text-white hover:bg-white/20 p-2 rounded-xl transition-all duration-200"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6">
                  {sideNavigationSections.map((section) => (
                    <div key={section.title} className="space-y-3">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
                        {section.title}
                      </h3>
                      <div className="space-y-1">
                        {section.items.filter((item) => !item.capability || hasCapability(item.capability)).map((item) => {
                          const Icon = item.icon;
                          const isActive = isActivePath(item.path);

                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              onClick={closeSideNav}
                              className={cn(
                                "flex items-center gap-4 px-4 py-3 rounded-xl font-medium transition-all duration-200 w-full",
                                isActive 
                                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/25" 
                                  : "text-gray-700 hover:bg-orange-50 hover:text-orange-600"
                              )}
                            >
                              <div className={cn(
                                "w-10 h-10 rounded-lg flex items-center justify-center",
                                isActive 
                                  ? "bg-white/20" 
                                  : "bg-gray-100"
                              )}>
                                <Icon className={cn(
                                  "w-5 h-5",
                                  isActive ? "text-white" : "text-gray-600"
                                )} />
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-base font-semibold truncate">{item.name}</span>
                                <span className={cn(
                                  "text-sm truncate",
                                  isActive ? "text-white/80" : "text-gray-500"
                                )}>{item.description}</span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Organization Selector - Clean styling */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
                      Organization
                    </h3>
                    <div className="space-y-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            className="w-full h-12 px-4 text-sm font-medium flex items-center gap-3 border border-gray-200 text-gray-700 bg-white hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 transition-all duration-150 group rounded-xl"
                          >
                            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                              <Building2 className="w-5 h-5 text-orange-600" />
                            </div>
                            <div className="flex flex-col items-start flex-1 min-w-0">
                              <span className="text-base font-semibold truncate w-full text-left">
                                {activeOrganization?.name || "Select Organization"}
                              </span>
                              <span className="text-xs text-gray-500 truncate w-full text-left">
                                Current organization
                              </span>
                            </div>
                            <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors duration-150 flex-shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80 max-h-[60vh] overflow-y-auto" sideOffset={8}>
                          <DropdownMenuLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Your Organizations
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            {organizations?.length > 0 ? (
                              organizations.map((organization) => (
                                <DropdownMenuItem
                                  key={organization.id}
                                  onClick={() => switchOrganization(organization.id)}
                                  className={cn(
                                    "flex items-center gap-3 py-3",
                                    activeOrganization?.id === organization.id ? "bg-orange-50 text-orange-900" : ""
                                  )}
                                >
                                  <div className={cn(
                                    "w-10 h-10 rounded-lg flex items-center justify-center",
                                    activeOrganization?.id === organization.id ? "bg-orange-500" : "bg-gray-100"
                                  )}>
                                    <Building2 className={cn(
                                      "w-5 h-5",
                                      activeOrganization?.id === organization.id ? "text-white" : "text-gray-500"
                                    )} />
                                  </div>
                                  <div className="flex flex-col flex-1">
                                    <span className="font-medium truncate">{organization.name}</span>
                                    <span className="text-xs text-gray-500 truncate">Organization</span>
                                  </div>
                                  {activeOrganization?.id === organization.id && (
                                    <Check className="w-4 h-4 text-orange-500" />
                                  )}
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem disabled className="flex items-center gap-3 py-3 text-gray-500">
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                                  <Building2 className="w-5 h-5 text-gray-400" />
                                </div>
                                <div className="flex flex-col flex-1">
                                  <span className="font-medium">No organizations</span>
                                  <span className="text-xs text-gray-400">Create an organization to get started</span>
                                </div>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fixed Bottom Sign Out - Clean styling */}
              <div className="flex-shrink-0 p-6 border-t border-gray-200 bg-gray-50/50">
                <Button
                  onClick={() => {
                    handleSignOut();
                    closeSideNav();
                  }}
                  variant="ghost"
                  className="w-full justify-start gap-4 py-4 px-4 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl font-medium"
                >
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                    <LogOut className="w-5 h-5 text-red-600" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-base font-medium truncate">Sign Out</div>
                    <div className="text-sm text-red-500 truncate">End your session</div>
                  </div>
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default TopBar;