import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
  Folder
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

  // Top navigation items (2-3 most accessed)
  const topNavigationItems = [
    {
      name: 'Home',
      path: '/home',
      icon: Hash,
      description: 'Main home'
    },
    {
      name: 'Dashboard',
      path: '/dashboard',
      icon: PieChart,
      description: 'Main overview'
    },
    {
      name: 'Reviews',
      path: '/reviews',
      icon: MessageSquare,
      description: 'Customer feedback'
    }
  ];

  // Side navigation items (organized by category)
  const sideNavigationSections = [
    {
      title: 'Operations',
      items: [
        {
          name: 'Reports',
          path: '/reports',
          icon: BarChart3,
          description: 'Sales analytics'
        },
        {
          name: 'Menu',
          path: '/menu',
          icon: Menu,
          description: 'Menu management'
        },
        {
          name: 'Recipes',
          path: '/recipes',
          icon: ChefHat,
          description: 'Recipe database'
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
          icon: UserCircle,
          description: 'Organization-wide team'
        },
        {
          name: 'Staff',
          path: '/staff',
          icon: Users,
          description: 'Location staff'
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
          name: 'Location Settings',
          path: '/settings/location',
          icon: MapPin,
          description: 'Location-specific settings'
        }
      ]
    }
  ];

  const closeSideNav = () => {
    setIsSideNavOpen(false);
  };

  const toggleSideNav = () => {
    setIsSideNavOpen(!isSideNavOpen);
  };

  return (
    <>
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        isLandingPage 
          ? 'bg-transparent backdrop-blur-0 border-b-0 shadow-none' 
          : 'bg-white/95 backdrop-blur-lg border-b border-beepbite-light-alt/50 shadow-lg'
      }`}>
        <nav className="h-16 px-2 sm:px-3 lg:px-8">
          <div className="h-full flex items-center justify-between w-full">
            {/* Left: Logo and Navigation */}
            <div className="flex items-center gap-4 sm:gap-6">
              <Link to="/" className="flex items-center group">
                <div className="block sm:hidden">
                  {/* Mobile logo - enhanced for landing */}
                  <div className={`w-12 h-12 rounded-xl shadow-lg flex items-center justify-center border-2 transition-all duration-300 group-hover:scale-105 ${
                    isLandingPage 
                      ? 'bg-white/90 backdrop-blur-sm border-white/20 shadow-lg' 
                      : 'bg-white border-gray-200 shadow-sm'
                  }`}>
                    <img 
                      src="/icon.svg" 
                      alt="BeepBite" 
                      className="w-7 h-7"
                    />
                  </div>
                </div>
                <div className="hidden sm:block">
                  {/* Desktop logo - enhanced with transparent background */}
                  <div className={`flex items-center p-3 rounded-2xl transition-all duration-300 group-hover:scale-105 ${
                    isLandingPage 
                      ? 'bg-white/10 backdrop-blur-md border border-white/20' 
                      : 'bg-transparent'
                  }`}>
                    <div className={`w-10 h-10 rounded-xl shadow-md flex items-center justify-center border border-gray-200 ${
                      isLandingPage ? 'bg-white/95' : 'bg-white'
                    }`}>
                      <img 
                        src="/icon.svg" 
                        alt="BeepBite" 
                        className="w-6 h-6"
                      />
                    </div>
                    <span className="ml-3 text-2xl font-bold">
                      <span className="text-black">Beep</span>
                      <span className="text-orange-500">Bite</span>
                    </span>
                  </div>
                </div>
              </Link>

              {/* Desktop Navigation - Only show for authenticated users */}
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

              {/* Mobile Navigation - Show when no desktop nav */}
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
                            variant="ghost" 
                            className="h-9 px-3 text-sm font-medium flex items-center gap-2 border border-gray-200 text-gray-700 bg-white hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 focus-visible:bg-gray-100 focus-visible:text-gray-900 focus-visible:border-gray-300 data-[state=open]:bg-gray-100 data-[state=open]:text-gray-900 data-[state=open]:border-gray-300 transition-all duration-150 group"
                          >
                            <MapPin className="h-4 w-4 text-orange-500 transition-colors duration-150" />
                            <span className="max-w-[140px] truncate">
                              {activeLocation?.name || "Select Location"}
                            </span>
                            <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600 group-focus-visible:text-gray-600 group-data-[state=open]:text-gray-600 transition-colors duration-150" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Locations
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            {locations?.length > 0 ? (
                              locations.map((location) => (
                                <DropdownMenuItem
                                  key={location.id}
                                  onClick={() => handleSwitchLocation(location.id)}
                                  className={cn(
                                    "flex items-center gap-2 py-2",
                                    activeLocation?.id === location.id ? "bg-blue-50 text-blue-900" : ""
                                  )}
                                >
                                  <MapPin className="h-4 w-4 text-gray-500" />
                                  <div className="flex flex-col">
                                    <span className="font-medium">{location.name}</span>
                                    <span className="text-xs text-gray-500">Location</span>
                                  </div>
                                  {activeLocation?.id === location.id && (
                                    <div className="w-2 h-2 bg-blue-500 rounded-full ml-auto" />
                                  )}
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem disabled className="flex items-center gap-2 py-2 text-gray-500">
                                <MapPin className="h-4 w-4 text-gray-400" />
                                <div className="flex flex-col">
                                  <span className="font-medium">No locations</span>
                                  <span className="text-xs text-gray-400">Add a location to get started</span>
                                </div>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => navigate('/settings/location')}
                            className="flex items-center gap-2 py-2 text-orange-600 hover:bg-orange-50 hover:text-orange-700 font-medium"
                          >
                            <div className="w-4 h-4 rounded-sm bg-orange-100 flex items-center justify-center">
                              <Plus className="h-3 w-3 text-orange-600" />
                            </div>
                            <span className="font-medium">Manage Locations</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* Location Selector - Mobile */}
                  {!isLandingPage && (
                    <div className="md:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            className="h-9 px-2 text-sm font-medium flex items-center gap-1 border border-gray-200 text-gray-700 bg-white hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 focus-visible:bg-gray-100 focus-visible:text-gray-900 focus-visible:border-gray-300 data-[state=open]:bg-gray-100 data-[state=open]:text-gray-900 data-[state=open]:border-gray-300 transition-all duration-150 group"
                          >
                            <MapPin className="h-4 w-4 text-orange-500 transition-colors duration-150" />
                            <span className="max-w-[80px] truncate text-xs">
                              {activeLocation?.name || "Location"}
                            </span>
                            <ChevronDown className="h-3 w-3 text-gray-400 group-hover:text-gray-600 group-focus-visible:text-gray-600 group-data-[state=open]:text-gray-600 transition-colors duration-150" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent 
                          align="end" 
                          className="w-72 max-h-[70vh] overflow-y-auto"
                          sideOffset={8}
                        >
                          <DropdownMenuLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Locations
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            {locations?.length > 0 ? (
                              locations.map((location) => (
                                <DropdownMenuItem
                                  key={location.id}
                                  onClick={() => handleSwitchLocation(location.id)}
                                  className={cn(
                                    "flex items-center gap-3 py-3",
                                    activeLocation?.id === location.id ? "bg-blue-50 text-blue-900" : ""
                                  )}
                                >
                                  <div className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    activeLocation?.id === location.id ? "bg-blue-500" : "bg-gray-100"
                                  )}>
                                    <MapPin className={cn(
                                      "w-4 h-4",
                                      activeLocation?.id === location.id ? "text-white" : "text-gray-500"
                                    )} />
                                  </div>
                                  <div className="flex flex-col flex-1">
                                    <span className="font-medium">{location.name}</span>
                                    <span className="text-xs text-gray-500">Location</span>
                                  </div>
                                  {activeLocation?.id === location.id && (
                                    <div className="w-2 h-2 bg-blue-500 rounded-full" />
                                  )}
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem disabled className="flex items-center gap-3 py-3 text-gray-500">
                                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                                  <MapPin className="w-4 h-4 text-gray-400" />
                                </div>
                                <div className="flex flex-col flex-1">
                                  <span className="font-medium">No locations</span>
                                  <span className="text-xs text-gray-400">Add a location to get started</span>
                                </div>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => navigate('/settings/location')}
                            className="flex items-center gap-3 py-3 text-orange-600 hover:bg-orange-50 hover:text-orange-700 font-medium"
                          >
                            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                              <Plus className="w-4 h-4 text-orange-600" />
                            </div>
                            <div className="flex flex-col flex-1">
                              <span className="font-medium">Manage Locations</span>
                              <span className="text-xs text-orange-500">Location settings</span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* User Menu Button - Always show when authenticated */}
                  <Button 
                    variant="ghost" 
                    className="h-10 w-10 sm:h-12 sm:w-12 rounded-full p-0 border-2 border-gray-300 hover:border-orange-500 hover:bg-orange-50 hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg bg-white relative group"
                    aria-label="Open navigation menu"
                    onClick={toggleSideNav}
                  >
                    <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-full beepbite-gradient flex items-center justify-center relative">
                      <Avatar className="h-6 w-6 sm:h-9 sm:w-9 border-2 border-white/30">
                        <AvatarFallback className="bg-transparent text-white font-bold text-xs sm:text-sm">
                          {getUserInitials()}
                        </AvatarFallback>
                      </Avatar>
                      
                      {/* Menu indicator dots */}
                      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 sm:w-5 sm:h-5 bg-white rounded-full border-2 border-gray-200 flex items-center justify-center shadow-sm group-hover:border-orange-300 transition-all duration-200">
                        <div className="flex flex-col gap-0.5">
                          <div className="w-0.5 h-0.5 bg-gray-600 rounded-full"></div>
                          <div className="w-0.5 h-0.5 bg-gray-600 rounded-full"></div>
                          <div className="w-0.5 h-0.5 bg-gray-600 rounded-full"></div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Subtle pulse animation hint */}
                    <div className="absolute inset-0 rounded-full border-2 border-orange-500/30 animate-pulse opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/signin')}
                    className={`text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-300 ${
                      isLandingPage 
                        ? 'text-gray-900 bg-white/90 backdrop-blur-sm border border-white/20 hover:text-gray-900 hover:bg-white hover:border-white/30' 
                        : 'text-gray-700 bg-white hover:text-white hover:bg-orange-500 focus-visible:text-white focus-visible:bg-orange-500'
                    }`}
                  >
                    Sign In
                  </Button>
                  <Button
                    size="sm"
                    className={`font-semibold px-4 py-2 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 ${
                      isLandingPage 
                        ? 'bg-white text-orange-600 hover:bg-white/95' 
                        : 'beepbite-gradient text-white'
                    }`}
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

      {/* Side Navigation - only show when not on landing page */}
      {user && isSideNavOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998]"
            onClick={closeSideNav}
          />
          
          {/* Side Navigation Panel */}
          <div className={cn(
            "fixed top-0 right-0 h-full w-80 sm:w-96 bg-white shadow-2xl z-[9999] transform transition-transform duration-300 ease-out",
            "animate-in slide-in-from-right"
          )}>
            <div className="h-full flex flex-col">
              
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-white/30">
                      <AvatarFallback className="beepbite-gradient text-white font-bold">
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
                        {section.items.map((item) => {
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

                  {/* Organization Selector */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
                      Organization
                    </h3>
                    <div className="space-y-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            className="w-full h-12 px-4 text-sm font-medium flex items-center gap-3 border border-gray-200 text-gray-700 bg-white hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 focus-visible:bg-gray-100 focus-visible:text-gray-900 focus-visible:border-gray-300 data-[state=open]:bg-gray-100 data-[state=open]:text-gray-900 data-[state=open]:border-gray-300 transition-all duration-150 group rounded-xl"
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
                            <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600 group-focus-visible:text-gray-600 group-data-[state=open]:text-gray-600 transition-colors duration-150 flex-shrink-0" />
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
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              navigate('/create-organization');
                              closeSideNav();
                            }}
                            className="flex items-center gap-3 py-3 text-orange-600 hover:bg-orange-50 hover:text-orange-700 font-medium"
                          >
                            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                              <Plus className="w-5 h-5 text-orange-600" />
                            </div>
                            <div className="flex flex-col flex-1">
                              <span className="font-medium">Create Organization</span>
                              <span className="text-xs text-orange-500">Add new organization</span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fixed Bottom Sign Out */}
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