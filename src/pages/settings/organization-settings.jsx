import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import {
  Building2,
  MapPin,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Edit,
  FileText,
  ChevronRight,
} from 'lucide-react';
import BusinessInfoPage from './business-info';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const OrganizationSettings = () => {
  const { activeOrganization, user, fetchOrganizations } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('organization');
  const [locations, setLocations] = useState([]);
  const [formData, setFormData] = useState({
    // Organization data
    name: '',
    is_active: true
  });

  useEffect(() => {
    if (activeOrganization) {
      loadOrganizationData();
    }
  }, [activeOrganization]);

  const loadOrganizationData = async () => {
    if (!activeOrganization) return;

    setLoading(true);
    try {
      // Load organization data
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', activeOrganization.id)
        .single();

      if (orgError) {
        console.error('Error loading organization data:', orgError);
      }

      // Load locations for this organization
      const { data: locationsData, error: locationsError } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', activeOrganization.id)
        .order('name');

      if (locationsError) {
        console.error('Error loading locations:', locationsError);
      }

      setFormData({
        name: orgData?.name || '',
        is_active: orgData?.is_active ?? true
      });

      setLocations(locationsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const saveOrganizationSettings = async () => {
    if (!activeOrganization) return;

    setSaving(true);
    setSaveMessage('');

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        throw new Error('Organization name is required');
      }

      // Update organization
      const { error: orgError } = await supabase
        .from('organizations')
        .update({
          name: formData.name.trim(),
          is_active: formData.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeOrganization.id);

      if (orgError) throw orgError;

      setSaveMessage('Organization settings saved successfully!');

      // Refresh organizations in auth context
      await fetchOrganizations();

      // Reload data to reflect changes
      loadOrganizationData();

      setTimeout(() => {
        setSaveMessage('');
      }, 3000);

    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage(error.message || 'Failed to save settings. Please try again.');

      setTimeout(() => {
        setSaveMessage('');
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-[72px] w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </PageContainer>
    );
  }

  const isSuccess = saveMessage.includes('successfully');

  return (
    <PageContainer>
      {/* Page header */}
      <Reveal>
        <PageHeader
          eyebrow="Settings"
          title="Organization"
          description="Manage your organization profile and locations."
          icon={Building2}
          actions={
            <Button
              onClick={saveOrganizationSettings}
              disabled={saving || activeTab !== 'organization'}
              className={cn(
                'hidden sm:inline-flex shadow-sm transition-all duration-200',
                activeTab !== 'organization' && 'opacity-0 pointer-events-none'
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save changes
                </>
              )}
            </Button>
          }
        />
      </Reveal>

      {/* Save message */}
      {saveMessage && (
        <Reveal delay={0.05}>
          <div
            className={cn(
              'flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium',
              isSuccess
                ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            )}
          >
            {isSuccess ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{saveMessage}</span>
          </div>
        </Reveal>
      )}

      {/* Active org banner */}
      <Reveal delay={0.07}>
        <Card variant="feature" className="border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Building2 className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">{activeOrganization?.name || 'Unknown Organization'}</p>
                <p className="text-xs text-muted-foreground">Active organization</p>
              </div>
              <Badge variant={formData.is_active ? 'default' : 'secondary'} className="shrink-0">
                {formData.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {/* Settings tabs */}
      <Reveal delay={0.1}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted/60 rounded-xl">
            <TabsTrigger
              value="organization"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden xs:inline">Organization</span>
              <span className="xs:hidden">Org</span>
            </TabsTrigger>
            <TabsTrigger
              value="locations"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <MapPin className="w-4 h-4" />
              <span>Locations</span>
            </TabsTrigger>
            <TabsTrigger
              value="businessinfo"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden xs:inline">Business Info</span>
              <span className="xs:hidden">Info</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Organization tab ── */}
          <TabsContent value="organization" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Organization information</CardTitle>
                      <CardDescription className="mt-0.5">Your organization's name and operational status.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Name field */}
                  <div className="space-y-1.5">
                    <label htmlFor="org-name" className="block text-sm font-medium text-foreground">
                      Organization name <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="org-name"
                      placeholder="Your Organization Name"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      className="rounded-xl h-10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      The name of your organization that contains all your locations
                    </p>
                  </div>

                  {/* Status toggle */}
                  <div className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-xl border border-border/50">
                    <div>
                      <p className="text-sm font-medium text-foreground">Organization status</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Control whether this organization is active
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <input
                        type="checkbox"
                        id="is_active"
                        checked={formData.is_active}
                        onChange={(e) => handleInputChange('is_active', e.target.checked)}
                        className="w-4 h-4 accent-primary border-border rounded focus:ring-primary"
                      />
                      <label htmlFor="is_active" className="text-sm font-medium text-foreground cursor-pointer">
                        Active
                      </label>
                    </div>
                  </div>

                  {/* Summary info strip */}
                  <div className="grid grid-cols-3 gap-3 p-4 bg-primary/5 rounded-xl border border-primary/15">
                    <div className="text-center">
                      <p className="text-xl font-bold font-display text-foreground">{locations.length}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Total locations</p>
                    </div>
                    <div className="text-center border-x border-primary/15">
                      <p className="text-xl font-bold font-display text-primary">{locations.filter(l => l.is_active).length}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Active</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold font-display text-foreground">{formData.is_active ? 'On' : 'Off'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Org status</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save button */}
            <div className="sm:hidden">
              <Button
                onClick={saveOrganizationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Organization Settings
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Locations tab ── */}
          <TabsContent value="locations" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Location management</CardTitle>
                      <CardDescription className="mt-0.5">
                        Manage all locations in your organization. Each location can have its own delivery, pickup, and service preferences.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {locations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                        <MapPin className="w-6 h-6 text-muted-foreground" />
                      </span>
                      <p className="font-medium text-foreground">No locations yet</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Create locations to manage your business branches
                      </p>
                    </div>
                  ) : (
                    <Stagger className="space-y-2.5">
                      {locations.map((location) => (
                        <StaggerItem key={location.id}>
                          <div className="flex items-center justify-between gap-3 p-4 border border-border/60 rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all duration-150 group">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <MapPin className="w-4 h-4" />
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium text-foreground truncate">{location.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{location.address || 'No address set'}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                  <Badge variant={location.is_active ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                                    {location.is_active ? "Active" : "Inactive"}
                                  </Badge>
                                  {location.accepts_delivery && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">Delivery</Badge>
                                  )}
                                  {location.accepts_pickup && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">Pickup</Badge>
                                  )}
                                  {location.whatsapp_number && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">WhatsApp</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/settings/location/${location.id}`)}
                              className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg gap-1 group-hover:translate-x-0.5 transition-transform"
                            >
                              <Edit className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline text-xs">Edit</span>
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                          </div>
                        </StaggerItem>
                      ))}
                    </Stagger>
                  )}

                  {/* Stats strip */}
                  {locations.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t border-border/50">
                      {[
                        { label: 'Total', value: locations.length, accent: false },
                        { label: 'Active', value: locations.filter(l => l.is_active).length, accent: true },
                        { label: 'With delivery', value: locations.filter(l => l.accepts_delivery).length, accent: true },
                        { label: 'With pickup', value: locations.filter(l => l.accepts_pickup).length, accent: true },
                      ].map(({ label, value, accent }) => (
                        <div key={label} className="text-center p-3 rounded-xl bg-muted/40">
                          <p className={cn('text-2xl font-bold font-display', accent ? 'text-primary' : 'text-foreground')}>{value}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Reveal>
          </TabsContent>

          {/* ── Business info tab ── */}
          <TabsContent value="businessinfo" className="mt-5">
            <Reveal>
              <BusinessInfoPage />
            </Reveal>
          </TabsContent>
        </Tabs>
      </Reveal>

      {/* Mobile floating save button (org tab only) */}
      {activeTab === 'organization' && (
        <Button
          onClick={saveOrganizationSettings}
          disabled={saving}
          size="icon"
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-elevated hover:shadow-glow transition-all duration-300 z-40 sm:hidden"
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
        </Button>
      )}
    </PageContainer>
  );
};

export default OrganizationSettings;
