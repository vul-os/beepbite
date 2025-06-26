import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search, 
  Users, 
  Mail,
  MoreHorizontal,
  UserPlus,
  Shield,
  Crown,
  User,
  Trash2,
  Send,
  CheckCircle,
  Clock,
  XCircle,
  ChefHat,
  Building2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

const Members = () => {
  const { user, activeBistro } = useAuth();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    if (activeBistro) {
      fetchMembers();
      fetchInvites();
    }
  }, [activeBistro]);

  const fetchMembers = async () => {
    if (!activeBistro) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bistro_members')
        .select(`
          id,
          role,
          created_at,
          profiles (
            id,
            full_name,
            username,
            email,
            avatar_url
          )
        `)
        .eq('bistro_id', activeBistro.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInvites = async () => {
    if (!activeBistro) return;
    
    try {
      const { data, error } = await supabase
        .from('bistro_invites')
        .select(`
          id,
          email,
          role,
          status,
          created_at,
          invited_by:profiles!bistro_invites_invited_by_fkey (
            full_name
          )
        `)
        .eq('bistro_id', activeBistro.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setInvites(data || []);
    } catch (error) {
      console.error('Error fetching invites:', error);
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail || !activeBistro) return;
    
    setInviteLoading(true);
    try {
      const { data, error } = await supabase.rpc('send_invitation', {
        p_bistro_id: activeBistro.id,
        p_email: inviteEmail,
        p_role: inviteRole
      });

      if (error) throw error;

      if (data.success) {
        setInviteEmail('');
        setInviteRole('staff');
        setIsInviteModalOpen(false);
        fetchInvites();
      } else {
        alert(data.error || 'Failed to send invitation');
      }
    } catch (error) {
      console.error('Error sending invite:', error);
      alert('Failed to send invitation');
    } finally {
      setInviteLoading(false);
    }
  };

  const removeMember = async (memberId) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    
    try {
      const { error } = await supabase
        .from('bistro_members')
        .delete()
        .eq('id', memberId);
      
      if (error) throw error;
      fetchMembers();
    } catch (error) {
      console.error('Error removing member:', error);
      alert('Failed to remove member');
    }
  };

  const updateMemberRole = async (memberId, newRole) => {
    try {
      const { error } = await supabase
        .from('bistro_members')
        .update({ role: newRole })
        .eq('id', memberId);
      
      if (error) throw error;
      fetchMembers();
    } catch (error) {
      console.error('Error updating member role:', error);
      alert('Failed to update member role');
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4" />;
      case 'manager':
        return <Shield className="w-4 h-4" />;
      case 'staff':
        return <User className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'manager':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'staff':
        return 'bg-gray-50 text-gray-600 border-gray-150';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-orange-500" />;
      case 'accepted':
        return <CheckCircle className="w-4 h-4 text-gray-600" />;
      case 'rejected':
        return <XCircle className="w-4 h-4 text-gray-400" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
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

  const filteredMembers = members.filter(member => {
    const name = member.profiles?.full_name || '';
    const username = member.profiles?.username || '';
    const email = member.profiles?.email || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           username.toLowerCase().includes(searchTerm.toLowerCase()) ||
           email.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const currentUserMember = members.find(m => m.profiles?.id === user?.id);
  const canManageMembers = currentUserMember?.role === 'owner' || currentUserMember?.role === 'manager';

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-gray-200 rounded animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
          ))}
        </div>
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
              <Users className="w-8 h-8 text-orange-500" />
              Team Members
            </h1>
            <p className="text-gray-600 mt-1">
              Manage your bistro team and invite new members
            </p>
          </div>
        </div>

        {/* Large Search Bar */}
        <div className="relative max-w-2xl">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            placeholder="Search team members by name, username, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 text-base font-medium border-gray-200 focus:border-orange-300 focus:ring-orange-200"
          />
        </div>
      </div>

      {/* FAB - Floating Action Button */}
      {canManageMembers && (
        <Button
          onClick={() => setIsInviteModalOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full beepbite-gradient text-white shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
          size="lg"
        >
          <UserPlus className="w-6 h-6" />
        </Button>
      )}

      {/* Desktop Invite Button */}
      {canManageMembers && (
        <div className="hidden sm:flex justify-end">
          <Button 
            onClick={() => setIsInviteModalOpen(true)}
            className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-200"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Member
          </Button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-gray-200 hover:border-orange-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-gray-900">{members.length}</p>
                <p className="text-sm text-gray-600 mt-1">Total Members</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                <Users className="w-6 h-6 text-gray-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-orange-200 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-gray-900">
                  {invites.filter(i => i.status === 'pending').length}
                </p>
                <p className="text-sm text-gray-600 mt-1">Pending Invites</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                <Mail className="w-6 h-6 text-gray-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-gray-200 hover:border-orange-200 transition-colors sm:col-span-2 lg:col-span-1">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-gray-900 truncate">{activeBistro?.name || 'Bistro'}</p>
                <p className="text-sm text-gray-600 mt-1">Current Bistro</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Members Grid */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">Active Members</h2>
        
        {filteredMembers.length === 0 ? (
          <Card className="border-gray-200">
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {searchTerm ? 'No members found' : 'No members yet'}
              </h3>
              <p className="text-gray-600 mb-6">
                {searchTerm 
                  ? 'Try adjusting your search terms' 
                  : 'Invite team members to get started'
                }
              </p>
              {!searchTerm && canManageMembers && (
                <Button 
                  onClick={() => setIsInviteModalOpen(true)}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Invite First Member
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredMembers.map((member) => {
              const isCurrentUser = member.profiles?.id === user?.id;
              
              return (
                <Card key={member.id} className="border-gray-200 hover:border-orange-200 hover:shadow-md transition-all duration-200">
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      {/* Member Info */}
                      <div className="flex items-start gap-4">
                        <Avatar className="h-14 w-14 border-2 border-gray-100">
                          <AvatarImage 
                            src={member.profiles?.avatar_url} 
                            alt={`${member.profiles?.full_name || member.profiles?.username || 'User'} avatar`}
                          />
                          <AvatarFallback className="bg-gray-100 text-gray-700 font-semibold text-lg">
                            {getInitials(member.profiles?.full_name, member.profiles?.username, member.profiles?.email)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 text-lg truncate mb-1">
                            {member.profiles?.full_name || member.profiles?.username || 'Unknown User'}
                            {isCurrentUser && (
                              <span className="text-sm text-orange-600 font-normal ml-2">(You)</span>
                            )}
                          </h3>
                          <p className="text-sm text-gray-600 truncate mb-3">
                            {member.profiles?.email}
                          </p>
                          
                          <Badge 
                            variant="outline" 
                            className={cn("text-xs font-medium", getRoleColor(member.role))}
                          >
                            <span className="flex items-center gap-1.5">
                              {getRoleIcon(member.role)}
                              {member.role}
                            </span>
                          </Badge>
                          
                          <p className="text-xs text-gray-500 mt-2">
                            Joined {formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      {canManageMembers && !isCurrentUser && (
                        <div className="space-y-2 pt-4 border-t border-gray-100">
                          {/* Role Change Buttons */}
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              variant={member.role === 'staff' ? "default" : "outline"}
                              onClick={() => updateMemberRole(member.id, 'staff')}
                              className={cn(
                                "text-xs",
                                member.role === 'staff' 
                                  ? "bg-gray-600 hover:bg-gray-700 text-white" 
                                  : "hover:bg-gray-50"
                              )}
                            >
                              <User className="w-3 h-3 mr-1" />
                              Staff
                            </Button>
                            
                            <Button
                              size="sm"
                              variant={member.role === 'manager' ? "default" : "outline"}
                              onClick={() => updateMemberRole(member.id, 'manager')}
                              className={cn(
                                "text-xs",
                                member.role === 'manager' 
                                  ? "bg-gray-600 hover:bg-gray-700 text-white" 
                                  : "hover:bg-gray-50"
                              )}
                            >
                              <Shield className="w-3 h-3 mr-1" />
                              Manager
                            </Button>
                          </div>

                          {/* Owner Button (only for current owners) */}
                          {currentUserMember?.role === 'owner' && (
                            <Button
                              size="sm"
                              variant={member.role === 'owner' ? "default" : "outline"}
                              onClick={() => updateMemberRole(member.id, 'owner')}
                              className={cn(
                                "w-full text-xs",
                                member.role === 'owner' 
                                  ? "bg-orange-500 hover:bg-orange-600 text-white" 
                                  : "hover:bg-orange-50 border-orange-200 text-orange-700"
                              )}
                            >
                              <Crown className="w-3 h-3 mr-1" />
                              Make Owner
                            </Button>
                          )}

                          {/* Remove Button */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeMember(member.id)}
                            className="w-full text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Remove Member
                          </Button>
                        </div>
                      )}

                      {/* Current User Info */}
                      {isCurrentUser && (
                        <div className="pt-4 border-t border-gray-100">
                          <p className="text-xs text-gray-500 text-center">
                            This is your account
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Invitations</h2>
          
          <div className="space-y-3">
            {invites.map((invite) => (
              <Card key={invite.id} className="border-gray-200 hover:border-orange-200 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Mail className="w-5 h-5 text-gray-600" />
                      </div>
                      
                      <div>
                        <p className="font-medium text-gray-900 text-base">{invite.email}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <Badge 
                            variant="outline" 
                            className={cn("text-xs font-medium", getRoleColor(invite.role))}
                          >
                            {invite.role}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            Invited {formatDistanceToNow(new Date(invite.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {getStatusIcon(invite.status)}
                      <span className={cn(
                        "text-sm font-medium capitalize",
                        invite.status === 'pending' && "text-orange-600",
                        invite.status === 'accepted' && "text-gray-600",
                        invite.status === 'rejected' && "text-gray-500"
                      )}>
                        {invite.status}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Invite Member Dialog */}
      <Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-orange-500" />
              Invite New Member
            </DialogTitle>
            <DialogDescription>
              Send an invitation to join {activeBistro?.name} as a team member.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Email Address
              </label>
              <Input
                type="email"
                placeholder="Enter email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full"
              />
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Role
              </label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Staff
                    </div>
                  </SelectItem>
                  <SelectItem value="manager">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Manager
                    </div>
                  </SelectItem>
                  {currentUserMember?.role === 'owner' && (
                    <SelectItem value="owner">
                      <div className="flex items-center gap-2">
                        <Crown className="w-4 h-4" />
                        Owner
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-3 pt-4">
              <Button 
                variant="outline" 
                onClick={() => setIsInviteModalOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                onClick={sendInvite}
                disabled={!inviteEmail || inviteLoading}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              >
                {inviteLoading ? (
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Send Invite
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Members;
