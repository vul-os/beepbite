import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SecuritySettings from "@/pages/settings/security";
import DataPrivacySettings from "@/pages/settings/account";
import {
  User,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  ExternalLink,
  Lock,
  Info
} from 'lucide-react';
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

  // Check if user signed in with Google
  const isGoogleAuth = user?.app_metadata?.provider === 'google';

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
        <div className="h-12 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-64 bg-gray-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <User className="w-8 h-8 text-orange-500" />
              Account Settings
            </h1>
            <p className="text-gray-600 mt-1">
              Manage your profile information and preferences
            </p>
          </div>
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg",
            saveMessage.includes('successfully') 
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          )}>
            {saveMessage.includes('successfully') ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            <span className="text-sm font-medium">{saveMessage}</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="privacy">Data &amp; Privacy</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6 mt-2">

      {/* Google Auth Warning */}
      {isGoogleAuth && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800 mb-1">
                  Google Account Connected
                </p>
                <p className="text-xs text-blue-700">
                  Since you signed in with Google, some profile fields cannot be edited directly. 
                  Your information is synced from your Google account.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Buttons */}
      {/* Save Button - Fixed for mobile */}
      <Button
        onClick={saveAccount}
        disabled={saving || isGoogleAuth}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
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
          disabled={saving || isGoogleAuth}
          className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50"
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
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-orange-500" />
              Profile Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name
                {isGoogleAuth && <Lock className="w-3 h-3 text-gray-400 inline ml-1" />}
              </label>
              <Input
                placeholder="Your full name"
                value={formData.full_name}
                onChange={(e) => handleInputChange('full_name', e.target.value)}
                disabled={isGoogleAuth}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                {isGoogleAuth 
                  ? "This field is managed by your Google account"
                  : "This is your display name shown to other users"
                }
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username
                {isGoogleAuth && <Lock className="w-3 h-3 text-gray-400 inline ml-1" />}
              </label>
              <Input
                placeholder="Choose a unique username"
                value={formData.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                disabled={isGoogleAuth}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                {isGoogleAuth 
                  ? "This field is managed by your Google account"
                  : "Must be at least 3 characters long and unique"
                }
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <Input
                value={user?.email || ''}
                disabled={true}
                className="w-full bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                Your email address cannot be changed
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Avatar Settings */}
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-orange-500" />
              Avatar Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current Avatar Preview */}
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-gray-200">
                <AvatarFallback className="bg-gray-100 text-gray-700 font-semibold text-lg">
                  {getInitials(formData.full_name, formData.username, user?.email)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-gray-900">Current Avatar</p>
                <p className="text-xs text-gray-500">
                  Using initials from your name or email
                </p>
              </div>
            </div>

            {/* Avatar Help */}
            <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-orange-800 mb-1">
                    Avatar Information
                  </p>
                  <ul className="text-xs text-orange-700 space-y-1">
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
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-orange-500" />
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-gray-700">Account Type</label>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={cn(
                  "text-xs font-medium",
                  isGoogleAuth 
                    ? "bg-blue-100 text-blue-800 border-blue-300"
                    : "bg-gray-100 text-gray-700 border-gray-300"
                )}>
                  {isGoogleAuth ? 'Google Account' : 'Email Account'}
                </Badge>
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700">Member Since</label>
              <p className="text-sm text-gray-600 mt-1">
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
    </div>
  );
};

export default Account; 