import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Settings, LogOut, Users, CreditCard, ChevronDown, Scale, Building2, Briefcase, UserCircle, Search } from 'lucide-react';
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

const TOP_BAR_HEIGHT = '4rem';

const TopBar = () => {
  const { 
    user, 
    signOut, 
    firms, 
    activeFirm,
    switchFirm
  } = useAuth();
  const navigate = useNavigate();
  
  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/signin');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleSwitchFirm = (firmId) => {
    try {
      switchFirm(firmId);
    } catch (error) {
      console.error("Error switching firm:", error);
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

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200/80 shadow-sm backdrop-blur-sm">
      <nav className="h-16 px-4">
        <div className="h-full flex items-center justify-between max-w-7xl mx-auto">
          {/* Left: App Name and Logo */}
          <Link to="/" className="flex items-center group">
            <div className="flex items-center -space-x-1">
              <span className="text-2xl font-serif font-bold tracking-tight text-gray-900 group-hover:text-indigo-800 transition-colors">
                Case
              </span>
              <img 
                src="/icon.svg" 
                alt="CaseOn Logo" 
                className="h-10 w-10 mt-2 text-indigo-800 transition-colors group-hover:text-indigo-700" 
              />
            </div>
            <span className="hidden sm:inline-block ml-2 text-[10px] font-medium tracking-wider text-gray-500 uppercase">
              Legal Intelligence
            </span>
          </Link>

          {/* Right: Firm Selector and Avatar */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {/* Firm Selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      className="h-9 px-3 text-sm font-medium flex items-center gap-2 border border-gray-200/80 hover:border-gray-300 hover:bg-gray-50/80 transition-colors"
                    >
                      <Building2 className="h-4 w-4 text-gray-500" />
                      <span className="max-w-[120px] truncate">
                        {activeFirm?.name || "Select Firm"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Your Law Firms
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      {firms.map((firm) => (
                        <DropdownMenuItem
                          key={firm.id}
                          onClick={() => handleSwitchFirm(firm.id)}
                          className={cn(
                            "flex items-center gap-2 py-2",
                            activeFirm?.id === firm.id ? "bg-indigo-50 text-indigo-900" : ""
                          )}
                        >
                          <Briefcase className="h-4 w-4 text-gray-500" />
                          <div className="flex flex-col">
                            <span className="font-medium">{firm.name}</span>
                            <span className="text-xs text-gray-500">{firm.type || "Law Firm"}</span>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/firms/new" className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700">
                        <Building2 className="h-4 w-4" />
                        <span>Add New Firm</span>
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* User Avatar Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      className="h-9 w-9 rounded-full p-0 border border-gray-200/80 hover:border-gray-300 hover:bg-gray-50/80 transition-colors"
                      aria-label="Open user menu"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white">
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
                          <p className="text-sm font-medium leading-none">Account</p>
                        </div>
                        <p className="text-xs leading-none text-gray-500 truncate">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem asChild>
                        <Link to="/search" className="flex items-center gap-2 cursor-pointer bg-indigo-50/80 hover:bg-indigo-100/80">
                          <Search className="h-4 w-4 text-indigo-600" />
                          <div className="flex flex-col">
                            <span className="font-medium text-indigo-700">Search</span>
                            <span className="text-xs text-indigo-500">Search legal documents</span>
                          </div>
                          <kbd className="ml-auto hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-white px-1.5 font-mono text-[10px] font-medium text-indigo-600">
                            ⌘K
                          </kbd>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/members" className="flex items-center gap-2 cursor-pointer">
                          <Users className="h-4 w-4 text-gray-500" />
                          <div className="flex flex-col">
                            <span>Members</span>
                            <span className="text-xs text-gray-500">Manage firm members</span>
                          </div>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/billing" className="flex items-center gap-2 cursor-pointer">
                          <CreditCard className="h-4 w-4 text-gray-500" />
                          <div className="flex flex-col">
                            <span>Billing</span>
                            <span className="text-xs text-gray-500">Manage subscription</span>
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
              <Button
                variant="default"
                className="h-9 px-4 text-sm font-medium flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => navigate('/signin')}
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
};

export default TopBar;