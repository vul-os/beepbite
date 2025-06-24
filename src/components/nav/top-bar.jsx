import React from 'react';
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
  Bell
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

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200/80 shadow-sm backdrop-blur-sm">
      <nav className="h-16 px-4">
        <div className="h-full flex items-center justify-between max-w-7xl mx-auto">
          {/* Left: Logo and Navigation */}
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center">
              <Logo variant="minimal" />
            </Link>

            {/* Main Navigation - Only show for authenticated users */}
            {user && (
              <nav className="hidden md:flex items-center space-x-1">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isActivePath(item.path);
                  
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        isActive 
                          ? "bg-orange-100 text-orange-700 border border-orange-200" 
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          {/* Right: User Menu or Sign In */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {/* Mobile Navigation Menu */}
                <div className="md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="flex items-center gap-2">
                        <Hash className="w-4 h-4" />
                        Menu
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>Navigation</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {navigationItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <DropdownMenuItem key={item.path} asChild>
                            <Link 
                              to={item.path} 
                              className={cn(
                                "flex items-center gap-2",
                                isActivePath(item.path) && "bg-orange-50 text-orange-700"
                              )}
                            >
                              <Icon className="w-4 h-4" />
                              <div className="flex flex-col">
                                <span>{item.name}</span>
                                <span className="text-xs text-gray-500">{item.description}</span>
                              </div>
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* User Avatar Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      className="h-9 w-9 rounded-full p-0 border border-gray-200/80 hover:border-gray-300 hover:bg-gray-50/80 transition-colors"
                      aria-label="Open user menu"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="beepbite-gradient text-white">
                          {getUserInitials()}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64" align="end">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <div className="flex items-center gap-2">
                          <UserCircle className="h-4 w-4 text-gray-500" />
                          <p className="text-sm font-medium leading-none">Restaurant Account</p>
                        </div>
                        <p className="text-xs leading-none text-gray-500 truncate">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem asChild>
                        <Link to="/dashboard" className="flex items-center gap-2 cursor-pointer">
                          <Hash className="h-4 w-4 text-orange-600" />
                          <div className="flex flex-col">
                            <span className="font-medium">Dashboard</span>
                            <span className="text-xs text-gray-500">Manage your orders</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/settings" className="flex items-center gap-2 cursor-pointer">
                          <Settings className="h-4 w-4 text-gray-500" />
                          <div className="flex flex-col">
                            <span>Settings</span>
                            <span className="text-xs text-gray-500">Restaurant preferences</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/team" className="flex items-center gap-2 cursor-pointer">
                          <Users className="h-4 w-4 text-gray-500" />
                          <div className="flex flex-col">
                            <span>Team Members</span>
                            <span className="text-xs text-gray-500">Manage restaurant staff</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={handleSignOut}
                      className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Sign out</span>
                        <span className="text-xs text-red-500">End your session</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => navigate('/signin')}
                >
                  Sign In
                </Button>
                <Button
                  className="beepbite-gradient text-white"
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
  );
};

export default TopBar;