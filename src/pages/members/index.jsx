import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Users, Mail, MoreHorizontal, UserPlus, Shield, Crown, User, Send, CheckCircle, Clock, XCircle, ChefHat, Building2, AlertCircle, Archive, Pencil, Phone } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from '@/hooks/use-toast';

// Form validation schema
const staffFormSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  role: z.enum(["staff", "manager", "admin", "owner"]),
  department: z.string().optional(),
  title: z.string().optional(),
});

const Members = () => {
  const { user, activeOrganization } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [removeConfirmMember, setRemoveConfirmMember] = useState(null);

  // Initialize form
  const form = useForm({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      full_name: "",
      email: "",
      phone: "",
      role: "staff",
      department: "",
      title: "",
    },
  });

  useEffect(() => {
    if (activeOrganization) {
      fetchMembers();
      fetchInvites();
    }
  }, [activeOrganization, showArchived]);

  useEffect(() => {
    if (selectedMember && isEditModalOpen) {
      form.reset({
        full_name: selectedMember.profiles?.full_name || "",
        email: selectedMember.profiles?.email || "",
        phone: selectedMember.profiles?.phone || "",
        role: selectedMember.role || "staff",
        department: selectedMember.profiles?.department || "",
        title: selectedMember.profiles?.title || "",
      });
    }
  }, [selectedMember, isEditModalOpen]);

  const fetchMembers = async () => {
    if (!activeOrganization) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('organization_members')
        .select(`
          id,
          role,
          profile_id,
          created_at,
          archived_at,
          profiles (
            id,
            full_name,
            username,
            email,
            avatar_url,
            phone,
            department,
            title
          )
        `)
        .eq('organization_id', activeOrganization.id)
        .is('archived_at', showArchived ? 'not.null' : null)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setMembers(data || []);
    } catch (error) {
      console.error('Error fetching members:', error);
      toast({ variant: 'destructive', title: 'Failed to fetch members' });
    } finally {
      setLoading(false);
    }
  };

  const fetchInvites = async () => {
    if (!activeOrganization) return;
    
    try {
      const { data, error } = await supabase
        .from('organization_invites')
        .select(`
          id,
          email,
          role,
          status,
          created_at,
          invited_by,
          profiles!organization_invites_invited_by_fkey (
            full_name
          )
        `)
        .eq('organization_id', activeOrganization.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setInvites(data || []);
    } catch (error) {
      console.error('Error fetching invites:', error);
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail || !activeOrganization) return;
    
    setInviteLoading(true);
    try {
      // Insert invite directly into the database
      const { data, error } = await supabase
        .from('organization_invites')
        .insert({
          organization_id: activeOrganization.id,
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          invited_by: user.id,
          status: 'pending'
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          throw new Error('This email has already been invited');
        }
        throw error;
      }

      setInviteEmail('');
      setInviteRole('staff');
      setIsInviteModalOpen(false);
      fetchInvites();
      
      // Here you would typically send an email notification
      // For now, we'll just show success
      toast({ title: 'Invitation sent successfully!' });
    } catch (error) {
      console.error('Error sending invite:', error);
      toast({ variant: 'destructive', title: 'Failed to send invitation', description: error.message });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleEditMember = async (values) => {
    if (!selectedMember) return;
    
    setActionLoading(selectedMember.id);
    try {
      // Update profile information
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: values.full_name,
          phone: values.phone,
          department: values.department,
          title: values.title,
        })
        .eq('id', selectedMember.profiles.id);

      if (profileError) throw profileError;

      // Update role if changed
      if (values.role !== selectedMember.role) {
        const { error: roleError } = await supabase
          .from('organization_members')
          .update({ role: values.role })
          .eq('id', selectedMember.id);

        if (roleError) throw roleError;
      }

      toast({ title: 'Member updated successfully' });
      setIsEditModalOpen(false);
      fetchMembers();
    } catch (error) {
      console.error('Error updating member:', error);
      toast({ variant: 'destructive', title: 'Failed to update member' });
    } finally {
      setActionLoading('');
    }
  };

  const handleArchiveMember = async (memberId) => {
    setActionLoading(memberId);
    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ 
          archived_at: new Date().toISOString(),
          archived_by: user.id
        })
        .eq('id', memberId);
      
      if (error) throw error;
      
      toast({ title: 'Member archived successfully' });
      fetchMembers();
    } catch (error) {
      console.error('Error archiving member:', error);
      toast({ variant: 'destructive', title: 'Failed to archive member' });
    } finally {
      setActionLoading('');
      setIsArchiveModalOpen(false);
    }
  };

  const handleRestoreMember = async (memberId) => {
    setActionLoading(memberId);
    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ 
          archived_at: null,
          archived_by: null
        })
        .eq('id', memberId);
      
      if (error) throw error;
      
      toast({ title: 'Member restored successfully' });
      fetchMembers();
    } catch (error) {
      console.error('Error restoring member:', error);
      toast({ variant: 'destructive', title: 'Failed to restore member' });
    } finally {
      setActionLoading('');
    }
  };

  const removeMember = (member) => {
    setRemoveConfirmMember(member);
  };

  const confirmRemoveMember = async () => {
    if (!removeConfirmMember) return;
    const memberId = removeConfirmMember.id;

    setActionLoading(memberId);
    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      fetchMembers();
    } catch (error) {
      console.error('Error removing member:', error);
      toast({ variant: 'destructive', title: 'Failed to remove member' });
    } finally {
      setActionLoading('');
      setRemoveConfirmMember(null);
    }
  };

  const updateMemberRole = async (memberId, newRole) => {
    setActionLoading(memberId);
    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ role: newRole })
        .eq('id', memberId);
      
      if (error) throw error;
      fetchMembers();
    } catch (error) {
      console.error('Error updating member role:', error);
      toast({ variant: 'destructive', title: 'Failed to update member role' });
    } finally {
      setActionLoading('');
    }
  };

  const cancelInvite = async (inviteId) => {
    setActionLoading(inviteId);
    try {
      const { error } = await supabase
        .from('organization_invites')
        .delete()
        .eq('id', inviteId);
      
      if (error) throw error;
      fetchInvites();
    } catch (error) {
      console.error('Error canceling invite:', error);
      toast({ variant: 'destructive', title: 'Failed to cancel invitation' });
    } finally {
      setActionLoading('');
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4" />;
      case 'admin':
        return <Shield className="w-4 h-4" />;
      case 'manager':
        return <ChefHat className="w-4 h-4" />;
      case 'staff':
        return <User className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner':
        return 'bg-primary/15 text-primary border-primary/30';
      case 'admin':
        return 'bg-foreground/5 text-foreground border-border';
      case 'manager':
        return 'bg-primary/5 text-primary border-primary/10';
      case 'staff':
        return 'bg-muted text-muted-foreground border-border';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-primary" />;
      case 'accepted':
        return <CheckCircle className="w-4 h-4 text-beepbite-success" />;
      case 'rejected':
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
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
    const department = member.profiles?.department || '';
    const title = member.profiles?.title || '';
    
    return name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           username.toLowerCase().includes(searchTerm.toLowerCase()) ||
           email.toLowerCase().includes(searchTerm.toLowerCase()) ||
           department.toLowerCase().includes(searchTerm.toLowerCase()) ||
           title.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const currentUserMember = members.find(m => m.profiles?.id === user?.id);
  const canManageMembers = currentUserMember?.role === 'owner' || currentUserMember?.role === 'admin';

  if (!activeOrganization) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">No Organization Selected</h2>
        <p className="text-muted-foreground">Please select an organization to manage members.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <PageContainer className="pb-20">
      <PageHeader
        title="Team Members"
        description="Manage your organization team and invite new members"
        icon={Users}
        actions={
          <Button
            variant="outline"
            onClick={() => setShowArchived(!showArchived)}
            className={cn(showArchived && "bg-primary/10 text-primary border-primary/30")}
          >
            <Archive className="w-4 h-4 mr-2" />
            {showArchived ? "Show Active" : "Show Archived"}
          </Button>
        }
      />

      {/* Search and Filter Bar */}
      <div className="flex gap-4 flex-col sm:flex-row">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <Input
            placeholder="Search by name, email, department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 text-base font-medium"
          />
        </div>

        {/* Desktop Invite Button */}
        {canManageMembers && !showArchived && (
          <Button
            onClick={() => setIsInviteModalOpen(true)}
            className="h-12"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      {/* FAB - Floating Action Button */}
      {canManageMembers && (
        <Button
          onClick={() => setIsInviteModalOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-xl hover:shadow-2xl transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
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
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Member
          </Button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="hover:border-primary/30 transition-colors hover:shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground">{members.length}</p>
                <p className="text-sm text-muted-foreground mt-1">Total Members</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/30 transition-colors hover:shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {invites.filter(i => i.status === 'pending').length}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Pending Invites</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Mail className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/30 transition-colors hover:shadow-md sm:col-span-2 lg:col-span-1">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-foreground truncate">{activeOrganization?.name || 'Organization'}</p>
                <p className="text-sm text-muted-foreground mt-1">Current Organization</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/15 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Members Grid */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">
          {showArchived ? "Archived Members" : "Active Members"}
        </h2>

        {filteredMembers.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                {showArchived ? (
                  <Archive className="w-8 h-8 text-primary/60" />
                ) : (
                  <Users className="w-8 h-8 text-primary/60" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {searchTerm
                  ? 'No members found'
                  : showArchived
                    ? 'No archived members'
                    : 'No members yet'
                }
              </h3>
              <p className="text-muted-foreground mb-6">
                {searchTerm
                  ? 'Try adjusting your search terms'
                  : showArchived
                    ? 'Archived members will appear here'
                    : 'Invite team members to get started'
                }
              </p>
              {!searchTerm && !showArchived && canManageMembers && (
                <Button onClick={() => setIsInviteModalOpen(true)}>
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
              const isLoading = actionLoading === member.id;

              return (
                <Card
                  key={member.id}
                  className={cn(
                    "hover:shadow-md transition-all duration-200",
                    isCurrentUser && "border-primary/30 bg-primary/5",
                    member.archived_at && "opacity-75"
                  )}
                >
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      {/* Member Info */}
                      <div className="flex items-start gap-4">
                        <Avatar className="h-14 w-14 border-2 border-primary/20 ring-2 ring-background">
                          <AvatarImage src={member.profiles?.avatar_url} />
                          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-lg">
                            {getInitials(member.profiles?.full_name, member.profiles?.username, member.profiles?.email)}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold text-foreground text-lg truncate">
                              {member.profiles?.full_name || member.profiles?.username || 'Unknown User'}
                              {isCurrentUser && (
                                <span className="text-sm text-primary font-normal ml-2">(You)</span>
                              )}
                            </h3>

                            {/* Action Menu */}
                            {canManageMembers && !isCurrentUser && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedMember(member);
                                      setIsEditModalOpen(true);
                                    }}
                                  >
                                    <Pencil className="w-4 h-4 mr-2" />
                                    Edit Details
                                  </DropdownMenuItem>
                                  {member.archived_at ? (
                                    <DropdownMenuItem
                                      onClick={() => handleRestoreMember(member.id)}
                                      className="text-primary"
                                    >
                                      <CheckCircle className="w-4 h-4 mr-2" />
                                      Restore Member
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedMember(member);
                                        setIsArchiveModalOpen(true);
                                      }}
                                      className="text-destructive"
                                    >
                                      <Archive className="w-4 h-4 mr-2" />
                                      Archive Member
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>

                          <p className="text-sm text-muted-foreground truncate mb-1">
                            {member.profiles?.email}
                          </p>

                          {member.profiles?.title && (
                            <p className="text-sm text-muted-foreground mb-1">
                              {member.profiles.title}
                              {member.profiles?.department && ` • ${member.profiles.department}`}
                            </p>
                          )}

                          <div className="flex items-center gap-2 flex-wrap mt-3">
                            <Badge
                              variant="outline"
                              className={cn("text-xs font-medium", getRoleColor(member.role))}
                            >
                              <span className="flex items-center gap-1.5">
                                {getRoleIcon(member.role)}
                                {member.role}
                              </span>
                            </Badge>

                            {member.archived_at && (
                              <Badge
                                variant="outline"
                                className="bg-muted text-muted-foreground border-border"
                              >
                                <Archive className="w-3 h-3 mr-1" />
                                Archived
                              </Badge>
                            )}
                          </div>

                          <p className="text-xs text-muted-foreground mt-2">
                            {member.archived_at
                              ? `Archived ${formatDistanceToNow(new Date(member.archived_at), { addSuffix: true })}`
                              : `Joined ${formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}`
                            }
                          </p>
                        </div>
                      </div>

                      {/* Contact Info */}
                      {member.profiles?.phone && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t border-border">
                          <Phone className="w-4 h-4" />
                          {member.profiles.phone}
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
          <h2 className="text-xl font-semibold text-foreground">Invitations</h2>

          <div className="space-y-3">
            {invites.map((invite) => (
              <Card key={invite.id} className="hover:shadow-md transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Mail className="w-5 h-5 text-primary" />
                      </div>
                      
                      <div>
                        <p className="font-medium text-foreground text-base">{invite.email}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <Badge
                            variant="outline"
                            className={cn("text-xs font-medium", getRoleColor(invite.role))}
                          >
                            <span className="flex items-center gap-1.5">
                              {getRoleIcon(invite.role)}
                              {invite.role}
                            </span>
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Invited {formatDistanceToNow(new Date(invite.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getStatusIcon(invite.status)}
                      <span className={cn(
                        "text-sm font-medium capitalize",
                        invite.status === 'pending' && "text-primary",
                        invite.status === 'accepted' && "text-beepbite-success",
                        invite.status === 'rejected' && "text-destructive"
                      )}>
                        {invite.status}
                      </span>

                      {/* Cancel Invite Button */}
                      {invite.status === 'pending' && canManageMembers && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cancelInvite(invite.id)}
                          disabled={actionLoading === invite.id}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              Invite New Member
            </DialogTitle>
            <DialogDescription>
              Send an invitation to join {activeOrganization?.name} as a team member.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
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
              <label className="text-sm font-medium text-foreground block mb-2">
                Role
              </label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-full">
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
                      <ChefHat className="w-4 h-4" />
                      Manager
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Admin
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
                disabled={inviteLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={sendInvite}
                disabled={!inviteEmail || inviteLoading}
                className="flex-1"
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

      {/* Edit Member Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Edit Member Details
            </DialogTitle>
            <DialogDescription>
              Update member information and role
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleEditMember)} className="space-y-4">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input {...field} type="tel" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Title</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="staff">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4" />
                            Staff
                          </div>
                        </SelectItem>
                        <SelectItem value="manager">
                          <div className="flex items-center gap-2">
                            <ChefHat className="w-4 h-4" />
                            Manager
                          </div>
                        </SelectItem>
                        {currentUserMember?.role === 'owner' && (
                          <>
                            <SelectItem value="admin">
                              <div className="flex items-center gap-2">
                                <Shield className="w-4 h-4" />
                                Admin
                              </div>
                            </SelectItem>
                            <SelectItem value="owner">
                              <div className="flex items-center gap-2">
                                <Crown className="w-4 h-4" />
                                Owner
                              </div>
                            </SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter className="gap-3 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={actionLoading === selectedMember?.id}
                >
                  {actionLoading === selectedMember?.id ? (
                    <Clock className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={isArchiveModalOpen} onOpenChange={setIsArchiveModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Archive className="w-5 h-5" />
              Archive Member
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to archive this member? They will lose access to the organization but their data will be preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-primary/5 border border-primary/10 rounded-lg p-4 mt-2">
            <p className="text-sm text-primary">
              <strong>Note:</strong> Archiving a member is reversible. You can restore their access later if needed.
            </p>
          </div>

          <DialogFooter className="gap-3 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsArchiveModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleArchiveMember(selectedMember?.id)}
              disabled={actionLoading === selectedMember?.id}
            >
              {actionLoading === selectedMember?.id ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Archive className="w-4 h-4 mr-2" />
              )}
              Archive Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation (destructive, non-reversible) */}
      <AlertDialog open={!!removeConfirmMember} onOpenChange={(open) => !open && setRemoveConfirmMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeConfirmMember?.profiles?.full_name || removeConfirmMember?.profiles?.email || 'this member'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove them from {activeOrganization?.name}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading === removeConfirmMember?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemoveMember}
              disabled={actionLoading === removeConfirmMember?.id}
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
};

export default Members;
