import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { SyncStatusBadge } from "@/components/ui/sync-status";
import { cn } from "@/lib/utils";
import Logo from '@/components/ui/logo';

const TopBar = () => {
  const { t } = useTranslation();
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
    { name: t('nav.topBar.home'), path: '/home', icon: Hash, description: t('nav.topBar.homeDesc') },
    { name: t('nav.topBar.pos'), path: '/pos/workspace', icon: Receipt, description: t('nav.topBar.posDesc') },
    { name: t('nav.topBar.kitchen'), path: '/kds/expo', icon: MonitorPlay, description: t('nav.topBar.kitchenDesc') },
    { name: t('nav.topBar.reviews'), path: '/reviews', icon: MessageSquare, description: t('nav.topBar.reviewsDesc') },
  ];

  // Side navigation items (organized by category)
  const sideNavigationSections = [
    {
      title: t('nav.sideBar.frontOfHouse'),
      items: [
        { name: t('nav.sideBar.posWorkspace'), path: '/pos/workspace', icon: Receipt, description: t('nav.sideBar.posWorkspaceDesc') },
        { name: t('nav.sideBar.kitchenWorkspace'), path: '/work', icon: LayoutDashboard, description: t('nav.sideBar.kitchenWorkspaceDesc') },
        { name: t('nav.sideBar.kitchenDisplay'), path: '/kds/expo', icon: MonitorPlay, description: t('nav.sideBar.kitchenDisplayDesc') },
      ]
    },
    {
      title: t('nav.sideBar.operations'),
      items: [
        { name: t('nav.sideBar.reports'), path: '/reports', icon: BarChart3, description: t('nav.sideBar.reportsDesc'), capability: 'can_view_reports' },
        { name: t('nav.sideBar.menu'), path: '/menu', icon: ChefHat, description: t('nav.sideBar.menuDesc') },
        { name: t('nav.sideBar.categories'), path: '/categories', icon: Folder, description: t('nav.sideBar.categoriesDesc') },
      ]
    },
    {
      title: t('nav.sideBar.team'),
      items: [
        { name: t('nav.sideBar.members'), path: '/members', icon: Users, description: t('nav.sideBar.membersDesc') },
        { name: t('nav.sideBar.staff'), path: '/staff', icon: UserCircle, description: t('nav.sideBar.staffDesc') },
        { name: t('nav.sideBar.driverPortal'), path: '/driver', icon: Truck, description: t('nav.sideBar.driverPortalDesc') },
      ]
    },
    {
      title: t('nav.sideBar.settings'),
      items: [
        { name: t('nav.sideBar.orgSettings'), path: '/settings', icon: Building2, description: t('nav.sideBar.orgSettingsDesc') },
        { name: t('nav.sideBar.account'), path: '/account', icon: UserCircle, description: t('nav.sideBar.accountDesc') },
      ]
    }
  ];

  return (
    <>
      <header className={cn(
        'fixed top-0 left-0 right-0 z-50 border-b-2 transition-colors',
        isLandingPage
          ? 'border-border/60 bg-background/90 backdrop-blur-sm'
          : 'border-border bg-background',
      )}>
        <nav className="h-16 px-4 sm:px-6 lg:px-8 xl:px-12">
          <div className="h-full flex items-center justify-between max-w-content mx-auto">
            {/* Left: Logo and Navigation */}
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center" aria-label="BeepBite home">
                <Logo variant="minimal" />
              </Link>

              {/* Desktop Navigation - Show for authenticated users */}
              {user && (
                <nav className="hidden sm:flex items-center gap-1.5" aria-label="Primary">
                  {topNavigationItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);

                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          "flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-md text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="w-4 h-4 sm:w-[1.1rem] sm:h-[1.1rem]" aria-hidden="true" />
                        <span className="hidden sm:inline">{item.name}</span>
                      </Link>
                    );
                  })}
                </nav>
              )}

              {/* Mobile Navigation - Show for authenticated users */}
              {user && (
                <nav className="flex sm:hidden items-center gap-1" aria-label="Primary">
                  {topNavigationItems.slice(0, 2).map((item) => {
                    const Icon = item.icon;
                    const isActive = isActivePath(item.path);

                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={item.name}
                        className={cn(
                          "flex items-center justify-center w-9 h-9 rounded-md text-xs font-semibold transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>

            {/* Right: Sync status, location, user menu */}
            <div className="flex items-center gap-2">
              {user ? (
                <>
                  {/* Sync status — always visible, not tucked in a menu. See
                      src/components/ui/sync-status.jsx: offline queueing is
                      real (src/offline/queue.js) and staff need to see it. */}
                  {!isLandingPage && <SyncStatusBadge className="hidden md:inline-flex" />}

                  {/* Location Selector - Desktop */}
                  {!isLandingPage && (
                    <div className="hidden md:block">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-sm font-medium flex items-center gap-2"
                          >
                            <MapPin className="h-4 w-4" aria-hidden="true" />
                            <span className="max-w-[120px] truncate">
                              {activeLocation?.name || t('nav.topBar.selectLocation')}
                            </span>
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>{t('nav.topBar.switchLocation')}</DropdownMenuLabel>
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
                                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                                )}
                                <Store className="h-4 w-4" aria-hidden="true" />
                                <span>{loc.name}</span>
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem disabled className="text-muted-foreground">
                              {t('nav.topBar.noLocations')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* User Menu Button */}
                  <Button
                    variant="outline"
                    className="h-11 w-11 rounded-md p-0"
                    aria-label={t('auth.openNavMenu')}
                    aria-expanded={isSideNavOpen}
                    onClick={toggleSideNav}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={userProfile?.avatar_url} alt="" className="object-cover" />
                      <AvatarFallback className="bg-primary text-primary-foreground font-bold text-sm">
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
                    {t('auth.signIn.title')}
                  </Button>
                  <Button
                    size="sm"
                    className="font-medium"
                    onClick={() => navigate('/signup')}
                  >
                    {t('auth.signUp.submitButton')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* Side Navigation */}
      {user && isSideNavOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-[9998]"
            onClick={closeSideNav}
            aria-hidden="true"
          />

          {/* Side Navigation Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('auth.openNavMenu')}
            className="fixed top-0 right-0 h-full w-80 sm:w-96 bg-background border-l-2 border-border shadow-2xl z-[9999] animate-in slide-in-from-right duration-200"
          >
            <div className="h-full flex flex-col">

              {/* Header */}
              <div className="bg-primary px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10 border-2 border-primary-foreground/40">
                      <AvatarImage src={userProfile?.avatar_url} alt="" />
                      <AvatarFallback className="bg-primary-foreground/20 text-primary-foreground font-bold">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-primary-foreground text-sm truncate font-semibold">
                        {user.email}
                      </p>
                      <p className="text-primary-foreground/75 text-xs truncate">
                        {activeLocation?.name || t('nav.topBar.selectLocation')}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={closeSideNav}
                    aria-label={t('common.close')}
                    className="text-primary-foreground hover:bg-primary-foreground/15 shrink-0"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </Button>
                </div>
                {/* Sync status repeated here — mobile users don't see the top-bar badge. */}
                <div className="mt-3 md:hidden">
                  <SyncStatusBadge className="bg-primary-foreground/15 text-primary-foreground [&_svg]:text-primary-foreground" />
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6">
                  {sideNavigationSections.map((section) => (
                    <div key={section.title} className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
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
                              aria-current={isActive ? 'page' : undefined}
                              className={cn(
                                "flex items-center gap-3.5 px-3 py-2.5 rounded-md font-medium transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "text-foreground hover:bg-muted"
                              )}
                            >
                              <div className={cn(
                                "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                                isActive ? "bg-primary-foreground/20" : "bg-muted"
                              )}>
                                <Icon className={cn(
                                  "w-[1.125rem] h-[1.125rem]",
                                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                                )} aria-hidden="true" />
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-sm font-semibold truncate">{item.name}</span>
                                <span className={cn(
                                  "text-xs truncate",
                                  isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                                )}>{item.description}</span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Organization Selector */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                      {t('nav.sideBar.organization')}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full h-auto py-3 px-3 flex items-center gap-3 justify-start"
                        >
                          <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="w-[1.125rem] h-[1.125rem] text-primary" aria-hidden="true" />
                          </div>
                          <div className="flex flex-col items-start flex-1 min-w-0">
                            <span className="text-sm font-semibold truncate w-full text-left">
                              {activeOrganization?.name || t('nav.sideBar.organization')}
                            </span>
                            <span className="text-xs text-muted-foreground truncate w-full text-left">
                              {t('nav.sideBar.currentOrganization')}
                            </span>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-80 max-h-[60vh] overflow-y-auto" sideOffset={8}>
                        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {t('nav.sideBar.yourOrganizations')}
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
                                  "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                                  activeOrganization?.id === organization.id ? "bg-primary" : "bg-muted"
                                )}>
                                  <Building2 className={cn(
                                    "w-[1.125rem] h-[1.125rem]",
                                    activeOrganization?.id === organization.id ? "text-primary-foreground" : "text-muted-foreground"
                                  )} aria-hidden="true" />
                                </div>
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="font-medium truncate">{organization.name}</span>
                                </div>
                                {activeOrganization?.id === organization.id && (
                                  <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                                )}
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem disabled className="flex items-center gap-3 py-3 text-muted-foreground">
                              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                                <Building2 className="w-[1.125rem] h-[1.125rem] text-muted-foreground" aria-hidden="true" />
                              </div>
                              <div className="flex flex-col flex-1">
                                <span className="font-medium">{t('nav.sideBar.noOrganizations')}</span>
                                <span className="text-xs text-muted-foreground">{t('nav.sideBar.noOrganizationsHint')}</span>
                              </div>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              {/* Fixed Bottom — Staff login + Sign Out */}
              <div className="flex-shrink-0 p-4 border-t-2 border-border bg-muted/40 space-y-1.5">
                {/* Staff / employee PIN login — shared-terminal "switch user" */}
                <button
                  type="button"
                  onClick={() => {
                    closeSideNav();
                    navigate(staffLoginPath);
                  }}
                  className="flex w-full items-center gap-3.5 rounded-md px-3 py-3 text-primary hover:bg-primary/10 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <LockKeyhole className="w-[1.125rem] h-[1.125rem] text-primary" aria-hidden="true" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{t('nav.sideBar.staffLogin')}</div>
                    <div className="text-xs text-primary/75 truncate">{t('nav.sideBar.staffLoginHint')}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSignOut();
                    closeSideNav();
                  }}
                  className="flex w-full items-center gap-3.5 rounded-md px-3 py-3 text-destructive hover:bg-destructive/10 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                >
                  <div className="w-9 h-9 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
                    <LogOut className="w-[1.125rem] h-[1.125rem] text-destructive" aria-hidden="true" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{t('auth.signOut')}</div>
                    <div className="text-xs text-destructive/75 truncate">{t('auth.signOutHint')}</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default TopBar;
