import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { hasCapability } from '@/services/pos';
import { LogOut, Users, ChevronDown, UserCircle, BarChart3, MessageSquare, Hash, X, MapPin, ChefHat, Building2, Check, Store, Folder, Receipt, MonitorPlay, Truck, LockKeyhole, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
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
  const { actor } = useActor();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);

  /**
   * Derive the best slug for /s/:slug staff-PIN login.
   * Prefer location-level slug if present, then org slug.
   * Fall back to /pos/login if neither is available.
   */
  const staffLoginPath = (() => {
    const slug = activeLocation?.slug || activeOrganization?.slug;
    return slug ? `/s/${slug}` : '/pos/login';
  })();

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
      name: 'Kitchen Display',
      path: '/kds/expo',
      icon: MonitorPlay,
      description: 'Full-screen kitchen wall'
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
          name: 'Kitchen Workspace',
          path: '/work',
          icon: LayoutDashboard,
          description: 'POS + Kitchen tabs with top bar'
        },
        {
          name: 'Kitchen Display (full screen)',
          path: '/kds/expo',
          icon: MonitorPlay,
          description: 'Wall-mount full-screen ticket view'
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
          description: 'Staff management & PINs'
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
          name: 'Settings',
          path: '/settings',
          icon: Building2,
          description: 'Organization, billing, storefront, system'
        },
        {
          name: 'Account',
          path: '/account',
          icon: UserCircle,
          description: 'Your personal account'
        }
      ]
    }
  ];

  return (
    <>
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isLandingPage
          ? 'bg-background/80 backdrop-blur-sm border-b border-border/60'
          : 'bg-background border-b border-border'
      }`}>
        <nav className="h-16 px-4 sm:px-6 lg:px-8 xl:px-12">
          <div className="h-full flex items-center justify-between max-w-content mx-auto">
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
                            ? "bg-primary text-primary-foreground shadow-lg"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
                            ? "bg-primary text-primary-foreground shadow-lg"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
                            className="text-sm font-medium flex items-center gap-2 border-border text-foreground hover:border-primary hover:text-primary"
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
                                  activeLocation?.id === loc.id && "bg-primary/10"
                                )}
                              >
                                {activeLocation?.id === loc.id && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                                <Store className="h-4 w-4" />
                                <span>{loc.name}</span>
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem disabled className="text-muted-foreground">
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
                    className="h-12 w-12 rounded-full p-0 bg-gradient-to-br from-card to-muted border-2 border-border shadow-lg hover:shadow-xl hover:border-primary/40 hover:from-primary/10 hover:to-card transition-all duration-300 hover:scale-105 active:scale-95"
                    aria-label="Open navigation menu"
                    onClick={toggleSideNav}
                  >
                    <Avatar className="h-9 w-9 ring-2 ring-background shadow-sm">
                      <AvatarImage src={userProfile?.avatar_url} alt="User" className="object-cover" />
                      <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-bold text-sm shadow-inner">
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
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    Sign In
                  </Button>
                  <Button
                    size="sm"
                    className="font-medium"
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
            "fixed top-0 right-0 h-full w-80 sm:w-96 bg-background shadow-2xl z-[9999] transform transition-transform duration-300 ease-out",
            "animate-in slide-in-from-right"
          )}>
            <div className="h-full flex flex-col">

              {/* Header - Clean brand styling */}
              <div className="bg-primary px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-primary-foreground/30">
                      <AvatarImage src={userProfile?.avatar_url} alt="User" />
                      <AvatarFallback className="bg-primary/80 text-primary-foreground font-bold">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-primary-foreground/90 text-sm truncate font-medium">
                        {user.email}
                      </p>
                      <p className="text-primary-foreground/70 text-xs truncate">
                        {activeLocation?.name || "No location selected"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={closeSideNav}
                    className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/20 p-2 rounded-xl transition-all duration-200"
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
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
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
                                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                                  : "text-foreground hover:bg-primary/10 hover:text-primary"
                              )}
                            >
                              <div className={cn(
                                "w-10 h-10 rounded-lg flex items-center justify-center",
                                isActive
                                  ? "bg-primary-foreground/20"
                                  : "bg-muted"
                              )}>
                                <Icon className={cn(
                                  "w-5 h-5",
                                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                                )} />
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-base font-semibold truncate">{item.name}</span>
                                <span className={cn(
                                  "text-sm truncate",
                                  isActive ? "text-primary-foreground/80" : "text-muted-foreground"
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
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                      Organization
                    </h3>
                    <div className="space-y-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="w-full h-12 px-4 text-sm font-medium flex items-center gap-3 border border-border text-foreground bg-background hover:bg-muted hover:text-foreground hover:border-border transition-all duration-150 group rounded-xl"
                          >
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Building2 className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex flex-col items-start flex-1 min-w-0">
                              <span className="text-base font-semibold truncate w-full text-left">
                                {activeOrganization?.name || "Select Organization"}
                              </span>
                              <span className="text-xs text-muted-foreground truncate w-full text-left">
                                Current organization
                              </span>
                            </div>
                            <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors duration-150 flex-shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80 max-h-[60vh] overflow-y-auto" sideOffset={8}>
                          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
                                    activeOrganization?.id === organization.id ? "bg-primary/10 text-primary" : ""
                                  )}
                                >
                                  <div className={cn(
                                    "w-10 h-10 rounded-lg flex items-center justify-center",
                                    activeOrganization?.id === organization.id ? "bg-primary" : "bg-muted"
                                  )}>
                                    <Building2 className={cn(
                                      "w-5 h-5",
                                      activeOrganization?.id === organization.id ? "text-primary-foreground" : "text-muted-foreground"
                                    )} />
                                  </div>
                                  <div className="flex flex-col flex-1">
                                    <span className="font-medium truncate">{organization.name}</span>
                                    <span className="text-xs text-muted-foreground truncate">Organization</span>
                                  </div>
                                  {activeOrganization?.id === organization.id && (
                                    <Check className="w-4 h-4 text-primary" />
                                  )}
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem disabled className="flex items-center gap-3 py-3 text-muted-foreground">
                                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                                  <Building2 className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div className="flex flex-col flex-1">
                                  <span className="font-medium">No organizations</span>
                                  <span className="text-xs text-muted-foreground">Create an organization to get started</span>
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

              {/* Fixed Bottom — Staff login + Sign Out */}
              <div className="flex-shrink-0 p-6 border-t border-border bg-muted/50 space-y-2">
                {/* Staff / employee PIN login — shared-terminal "switch user" */}
                <Button
                  onClick={() => {
                    closeSideNav();
                    navigate(staffLoginPath);
                  }}
                  variant="ghost"
                  className="w-full justify-start gap-4 py-4 px-4 text-primary hover:bg-primary/10 hover:text-primary rounded-xl font-medium"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <LockKeyhole className="w-5 h-5 text-primary" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-base font-medium truncate">Staff Login</div>
                    <div className="text-sm text-primary/80 truncate">Switch employee / enter PIN</div>
                  </div>
                </Button>

                <Button
                  onClick={() => {
                    handleSignOut();
                    closeSideNav();
                  }}
                  variant="ghost"
                  className="w-full justify-start gap-4 py-4 px-4 text-destructive hover:bg-destructive/10 hover:text-destructive rounded-xl font-medium"
                >
                  <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                    <LogOut className="w-5 h-5 text-destructive" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-base font-medium truncate">Sign Out</div>
                    <div className="text-sm text-destructive/80 truncate">End your session</div>
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