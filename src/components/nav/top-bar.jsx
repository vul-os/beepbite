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
  Bell,
  Menu,
  X
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
  const { user, signOut } = useAuth();
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
              <Logo variant="minimal" />
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

          {/* Right: User Menu or Sign In */}
          <div className="flex items-center gap-3 sm:gap-4">
            {user ? (
              <>
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
            className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={closeMobileMenu}
          />
          
          {/* Mobile Menu */}
          <div className="lg:hidden fixed top-16 inset-x-0 z-50 mx-4 mb-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-beepbite-light-alt overflow-hidden animate-in slide-in-from-top-2 duration-300">
              <div className="p-6 space-y-4">
                {/* Menu Header */}
                <div className="text-center pb-4 border-b border-gray-200">
                  <h3 className="text-lg font-bold text-gray-900">Navigation</h3>
                  <p className="text-sm text-gray-600">Quick access to your dashboard</p>
                </div>

                {/* Navigation Items */}
                <div className="space-y-2">
                  {navigationItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);
                    
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={closeMobileMenu}
                        className={cn(
                          "flex items-center gap-4 px-4 py-4 rounded-xl font-semibold transition-all duration-200 w-full group",
                          isActive 
                            ? "bg-orange-500 text-white shadow-lg" 
                            : "text-gray-700 hover:text-white hover:bg-orange-500 hover:shadow-md"
                        )}
                      >
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200",
                          isActive 
                            ? "bg-white/20" 
                            : "bg-orange-500/10 group-hover:bg-white/20"
                        )}>
                          <Icon className={cn(
                            "w-6 h-6",
                            isActive ? "text-white" : "text-orange-500 group-hover:text-white"
                          )} />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-base">{item.name}</span>
                          <span className={cn(
                            "text-sm",
                            isActive ? "text-white/80" : "text-gray-600 group-hover:text-white/80"
                          )}>{item.description}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Quick Actions */}
                <div className="pt-4 border-t border-gray-200">
                  <p className="text-sm font-semibold text-gray-600 mb-3">Quick Actions</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Link 
                      to="/settings" 
                      onClick={closeMobileMenu}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-100 hover:bg-orange-50 transition-colors duration-200 group"
                    >
                      <Settings className="w-6 h-6 text-gray-600 group-hover:text-orange-500" />
                      <span className="text-sm font-semibold text-gray-700">Settings</span>
                    </Link>
                    <Link 
                      to="/team" 
                      onClick={closeMobileMenu}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-100 hover:bg-orange-50 transition-colors duration-200 group"
                    >
                      <Users className="w-6 h-6 text-gray-600 group-hover:text-orange-500" />
                      <span className="text-sm font-semibold text-gray-700">Team</span>
                    </Link>
                  </div>
                </div>

                {/* Sign Out Button */}
                <div className="pt-4 border-t border-gray-200">
                  <Button
                    onClick={() => {
                      handleSignOut();
                      closeMobileMenu();
                    }}
                    variant="outline"
                    className="w-full justify-start gap-3 py-4 border-beepbite-accent/20 text-beepbite-accent hover:bg-beepbite-accent hover:text-white rounded-xl"
                  >
                    <LogOut className="w-5 h-5" />
                    <div className="text-left">
                      <div className="font-semibold">Sign Out</div>
                      <div className="text-xs opacity-80">End your session</div>
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