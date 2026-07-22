import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import SecuritySettings from "@/pages/settings/security";
import DataPrivacySettings from "@/pages/settings/account";
import { User, Save, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const Account = () => {
  const { user, fetchUserProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [formData, setFormData] = useState({
    full_name: '',
    username: ''
  });

  useEffect(() => {
    if (user) {
      loadUserData();
    }
  }, [user]);

  const loadUserData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, username')
        .eq('id', user.id)
        .single();
      
      if (error) {
        console.error('Error loading user data:', error);
      } else {
        setFormData({
          full_name: data?.full_name || '',
          username: data?.username || ''
        });
      }
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
    
    // Clear save message when user starts typing
    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const validateForm = () => {
    const errors = [];
    
    // Username validation
    if (formData.username.length < 3) {
      errors.push('Username must be at least 3 characters long');
    }
    
    return errors;
  };

  const saveAccount = async () => {
    if (!user) return;
    
    const errors = validateForm();
    if (errors.length > 0) {
      setSaveMessage(errors[0]);
      setTimeout(() => setSaveMessage(''), 5000);
      return;
    }
    
    setSaving(true);
    setSaveMessage('');
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name || null,
          username: formData.username
        })
        .eq('id', user.id);
      
      if (error) throw error;
      
      setSaveMessage('Account updated successfully!');
      
      // Clear message after 3 seconds
      setTimeout(() => {
        setSaveMessage('');
      }, 3000);
      
      await fetchUserProfile();
      
    } catch (error) {
      console.error('Error saving account:', error);
      
      if (error.code === '23505') {
        setSaveMessage('Username is already taken. Please choose a different one.');
      } else {
        setSaveMessage('Failed to update account. Please try again.');
      }
      
      setTimeout(() => {
        setSaveMessage('');
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name, username, email) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (username) {
      return username.slice(0, 2).toUpperCase();
    }
    if (email) {
      return email.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded" />
        <Skeleton className="h-64 w-full rounded" />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Account Settings"
        description="Manage your profile information and preferences"
        icon={User}
      />

      {/* Save Message */}
      {saveMessage && (
        <div className={cn(
          "flex items-center gap-2 px-4 py-3 rounded-lg",
          saveMessage.includes('successfully')
            ? "bg-beepbite-success/10 text-beepbite-success border border-beepbite-success/30"
            : "bg-destructive/10 text-destructive border border-destructive/30"
        )}>
          {saveMessage.includes('successfully') ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">{saveMessage}</span>
        </div>
      )}

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="privacy">Data &amp; Privacy</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6 mt-2">

      {/* Save Buttons */}
      {/* Save Button - Fixed for mobile */}
      <Button
        onClick={saveAccount}
        disabled={saving}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-primary-foreground shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
        size="lg"
      >
        {saving ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Save className="w-6 h-6" />
        )}
      </Button>

      {/* Desktop Save Button */}
      <div className="hidden sm:flex justify-end">
        <Button 
          onClick={saveAccount}
          disabled={saving}
          className="beepbite-gradient text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>

      {/* Account Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Profile Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Full Name
              </label>
              <Input
                placeholder="Your full name"
                value={formData.full_name}
                onChange={(e) => handleInputChange('full_name', e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
This is your display name shown to other users
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Username
              </label>
              <Input
                placeholder="Choose a unique username"
                value={formData.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
Must be at least 3 characters long and unique
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Email Address
              </label>
              <Input
                value={user?.email || ''}
                disabled={true}
                className="w-full bg-muted"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Your email address cannot be changed
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Avatar Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Avatar Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current Avatar Preview */}
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-border">
                <AvatarFallback className="bg-muted text-foreground font-semibold text-lg">
                  {getInitials(formData.full_name, formData.username, user?.email)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-foreground">Current Avatar</p>
                <p className="text-xs text-muted-foreground">
                  Using initials from your name or email
                </p>
              </div>
            </div>

            {/* Avatar Help */}
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-primary mb-1">
                    Avatar Information
                  </p>
                  <ul className="text-xs text-primary/80 space-y-1">
                    <li>• Avatars are automatically generated from your name or email</li>
                    <li>• Your initials will be displayed in a colored circle</li>
                    <li>• No need to upload or link to external images</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-foreground">Account Type</label>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs font-medium bg-muted text-foreground border-border">
                  Email Account
                </Badge>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Member Since</label>
              <p className="text-sm text-muted-foreground mt-1">
                {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-2">
          <SecuritySettings />
        </TabsContent>

        <TabsContent value="privacy" className="mt-2">
          <DataPrivacySettings />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
};

export default Account; 