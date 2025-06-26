import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  Settings, 
  LogOut, 
  Users, 
  ChevronDown, 
  Building2, 
  UserCircle, 
  BarChart3,
  MessageSquare,
  Hash,
  Menu,
  X,
  ChefHat
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import Logo from '@/components/ui/logo';

const TopBar = () => {
  const { 
    user, 
    signOut, 
    bistros, 
    activeBistro,
    switchBistro
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/signin');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleSwitchBistro = (bistroId) => {
    try {
      switchBistro(bistroId);
    } catch (error) {
      console.error("Error switching bistro:", error);
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

  const navigationItems = [
    {
      name: 'Dashboard',
      path: '/dashboard',
      icon: Hash,
      description: 'Manage orders'
    },
    {
      name: 'Reports',
      path: '/reports',
      icon: BarChart3,
      description: 'View analytics'
    },
    {
      name: 'Reviews',
      path: '/reviews',
      icon: MessageSquare,
      description: 'Customer feedback'
    }
  ];

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-lg border-b border-beepbite-light-alt/50 shadow-lg">
      <nav className="h-16 px-4 sm:px-6 lg:px-8">
        <div className="h-full flex items-center justify-between max-w-7xl mx-auto">
          {/* Left: Logo and Navigation */}
          <div className="flex items-center gap-6 sm:gap-8">
            <Link to="/" className="flex items-center">
              <div className="block sm:hidden">
                {/* Mobile logo - just icon */}
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">B</span>
                </div>
              </div>
              <div className="hidden sm:block">
                {/* Desktop logo - with text */}
                <Logo variant="minimal" />
              </div>
            </Link>

            {/* Desktop Navigation - Only show for authenticated users */}
            {user && (
              <nav className="hidden lg:flex items-center space-x-2">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isActivePath(item.path);
                  
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200",
                        isActive 
                          ? "bg-orange-500 text-white shadow-lg" 
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                      )}
                    >
                      <Icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          {/* Right: Bistro Selector and User Menu */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {/* Bistro Selector - Desktop */}
                <div className="hidden md:block">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="h-9 px-3 text-sm font-medium flex items-center gap-2 border border-gray-200/80 hover:border-orange-300 hover:bg-orange-50/80 transition-colors"
                      >
                        <Building2 className="h-4 w-4 text-orange-500" />
                        <span className="max-w-[120px] truncate">
                          {activeBistro?.name || "Select Bistro"}
                        </span>
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Your Bistros
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        {bistros?.map((bistro) => (
                          <DropdownMenuItem
                            key={bistro.id}
                            onClick={() => handleSwitchBistro(bistro.id)}
                            className={cn(
                              "flex items-center gap-2 py-2",
                              activeBistro?.id === bistro.id ? "bg-orange-50 text-orange-900" : ""
                            )}
                          >
                            <ChefHat className="h-4 w-4 text-gray-500" />
                            <div className="flex flex-col">
                              <span className="font-medium">{bistro.name}</span>
                              <span className="text-xs text-gray-500">Restaurant</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Bistro Selector - Mobile */}
                <div className="md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="h-9 px-2 text-sm font-medium flex items-center gap-1 border border-gray-200/80 hover:border-orange-300 hover:bg-orange-50/80 transition-colors"
                      >
                        <Building2 className="h-4 w-4 text-orange-500" />
                        <span className="max-w-[80px] truncate text-xs">
                          {activeBistro?.name || "Bistro"}
                        </span>
                        <ChevronDown className="h-3 w-3 text-gray-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent 
                      align="end" 
                      className="w-72 max-h-[70vh] overflow-y-auto"
                      sideOffset={8}
                    >
                      <DropdownMenuLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Your Bistros
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        {bistros?.map((bistro) => (
                          <DropdownMenuItem
                            key={bistro.id}
                            onClick={() => handleSwitchBistro(bistro.id)}
                            className={cn(
                              "flex items-center gap-3 py-3",
                              activeBistro?.id === bistro.id ? "bg-orange-50 text-orange-900" : ""
                            )}
                          >
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center",
                              activeBistro?.id === bistro.id ? "bg-orange-500" : "bg-gray-100"
                            )}>
                              <ChefHat className={cn(
                                "w-4 h-4",
                                activeBistro?.id === bistro.id ? "text-white" : "text-gray-500"
                              )} />
                            </div>
                            <div className="flex flex-col flex-1">
                              <span className="font-medium">{bistro.name}</span>
                              <span className="text-xs text-gray-500">Restaurant</span>
                            </div>
                            {activeBistro?.id === bistro.id && (
                              <div className="w-2 h-2 bg-orange-500 rounded-full" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Mobile Menu Button */}
                <div className="lg:hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all duration-200",
                      isMobileMenuOpen 
                        ? "bg-orange-500 text-white border-orange-500 shadow-lg" 
                        : "text-gray-700 border-gray-200 hover:border-orange-300 hover:bg-orange-50"
                    )}
                  >
                    {isMobileMenuOpen ? (
                      <X className="w-5 h-5" />
                    ) : (
                      <Menu className="w-5 h-5" />
                    )}
                    <span className="hidden sm:inline font-semibold">Menu</span>
                  </Button>
                </div>

                {/* User Avatar Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      className="h-11 w-11 rounded-xl p-0 border-2 border-beepbite-light-alt hover:border-beepbite-orange hover:bg-beepbite-orange/5 transition-all duration-200"
                      aria-label="Open user menu"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="beepbite-gradient text-white font-bold">
                          {getUserInitials()}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64 p-2" align="end">
                    <DropdownMenuLabel className="font-normal p-3">
                      <div className="flex flex-col space-y-2">
                        <div className="flex items-center gap-3">
                          <UserCircle className="h-5 w-5 text-orange-500" />
                          <p className="text-base font-bold leading-none text-gray-900">Restaurant Account</p>
                        </div>
                        <p className="text-sm leading-none text-gray-600 truncate">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup className="space-y-1">
                      <DropdownMenuItem asChild>
                        <Link to="/dashboard" className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-orange-50">
                          <Hash className="h-5 w-5 text-orange-500" />
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-900">Dashboard</span>
                            <span className="text-xs text-gray-600">Manage your orders</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/settings" className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-orange-50">
                          <Settings className="h-5 w-5 text-gray-600" />
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-900">Settings</span>
                            <span className="text-xs text-gray-600">Restaurant preferences</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/team" className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-orange-50">
                          <Users className="h-5 w-5 text-gray-600" />
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-900">Team Members</span>
                            <span className="text-xs text-gray-600">Manage restaurant staff</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={handleSignOut}
                      className="flex items-center gap-3 text-beepbite-accent hover:text-white hover:bg-beepbite-accent p-3 rounded-lg cursor-pointer"
                    >
                      <LogOut className="h-5 w-5" />
                      <div className="flex flex-col">
                        <span className="font-semibold">Sign out</span>
                        <span className="text-xs opacity-80">End your session</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/signin')}
                  className="text-sm font-semibold text-gray-700 hover:text-orange-500 hover:bg-orange-50 px-4 py-2 rounded-xl"
                >
                  Sign In
                </Button>
                <Button
                  size="sm"
                  className="beepbite-gradient text-white font-semibold px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                  onClick={() => navigate('/signup')}
                >
                  Get Started
                </Button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile Navigation Menu */}
      {user && isMobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            onClick={closeMobileMenu}
          />
          
          {/* Mobile Menu */}
          <div className="lg:hidden fixed top-0 inset-x-0 z-[250] mx-4 mt-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in slide-in-from-top-2 duration-300 max-h-[calc(100vh-2rem)] overflow-y-auto">
              
              {/* User Info Header */}
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 sticky top-0 z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-white/30">
                      <AvatarFallback className="bg-white/20 text-white font-bold">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/90 text-sm truncate font-medium">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={closeMobileMenu}
                    className="text-white hover:bg-white/20 p-2 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              <div className="p-6">
                {/* Main Navigation */}
                <div className="space-y-3 mb-6">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Main Menu
                  </h3>
                  {navigationItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);
                    
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={closeMobileMenu}
                        className={cn(
                          "flex items-center gap-4 px-4 py-4 rounded-xl font-medium transition-all duration-200 w-full",
                          isActive 
                            ? "bg-orange-500 text-white shadow-lg shadow-orange-500/25" 
                            : "text-gray-700 hover:bg-orange-50 hover:text-orange-600 active:bg-orange-100"
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
                        <div className="flex flex-col">
                          <span className="text-base font-semibold">{item.name}</span>
                          <span className={cn(
                            "text-sm",
                            isActive ? "text-white/80" : "text-gray-500"
                          )}>{item.description}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Account Section */}
                <div className="space-y-3 mb-6">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Account
                  </h3>
                  <div className="space-y-2">
                    <Link 
                      to="/settings" 
                      onClick={closeMobileMenu}
                      className="flex items-center gap-4 px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-200"
                    >
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Settings className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <span className="text-base font-medium">Settings</span>
                        <p className="text-sm text-gray-500">Restaurant preferences</p>
                      </div>
                    </Link>
                    
                    <Link 
                      to="/team" 
                      onClick={closeMobileMenu}
                      className="flex items-center gap-4 px-4 py-3 rounded-xl text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-200"
                    >
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Users className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <span className="text-base font-medium">Team Members</span>
                        <p className="text-sm text-gray-500">Manage restaurant staff</p>
                      </div>
                    </Link>
                  </div>
                </div>

                {/* Sign Out */}
                <div className="pt-4 border-t border-gray-200">
                  <Button
                    onClick={() => {
                      handleSignOut();
                      closeMobileMenu();
                    }}
                    variant="ghost"
                    className="w-full justify-start gap-4 py-4 px-4 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl font-medium"
                  >
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                      <LogOut className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="text-left">
                      <div className="text-base font-medium">Sign Out</div>
                      <div className="text-sm text-red-500">End your session</div>
                    </div>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
};

export default TopBar;