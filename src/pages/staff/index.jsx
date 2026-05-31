import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Users,
  Search,
  UserPlus,
  Edit,
  Trash2,
  Shield,
  Crown,
  User,
  ChefHat,
  CreditCard,
  Clock,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  XCircle,
  Building2,
  Timer,
  PlayCircle,
  StopCircle,
  Coffee,
  ArrowLeftCircle,
  Hash,
  KeyRound,
  AlertTriangle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { api } from '@/lib/api-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format, parseISO } from 'date-fns';
import DriverInvitesPanel from '@/components/driver-invites-panel';
import MemberInvitesPanel from '@/components/member-invites-panel';

const Staff = () => {
  const { activeLocation, activeOrganization } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [activeTab, setActiveTab] = useState('staff');
  const [timeEntries, setTimeEntries] = useState([]);
  const [loadingTimeEntries, setLoadingTimeEntries] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState(null);

  // PIN management state
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinTargetStaff, setPinTargetStaff] = useState(null);
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [formData, setFormData] = useState({
    employee_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    role: 'cashier',
    hire_date: '',
    notes: '',
    is_active: true
  });

  useEffect(() => {
    if (activeLocation) {
      fetchStaff();
    } else {
      setStaff([]);
      setLoading(false);
    }
  }, [activeLocation]);

  const fetchStaff = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('location_id', activeLocation.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const resetForm = () => {
    setFormData({
      employee_id: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      password: '',
      role: 'cashier',
      hire_date: '',
      notes: '',
      is_active: true
    });
  };

  // ---- PIN management ----

  const openPinDialog = (staffMember) => {
    setPinTargetStaff(staffMember);
    setNewPin('');
    setPinError('');
    setPinSuccess(false);
    setPinDialogOpen(true);
  };

  const closePinDialog = () => {
    setPinDialogOpen(false);
    setPinTargetStaff(null);
    setNewPin('');
    setPinError('');
    setPinSuccess(false);
  };

  const handleSetPin = async (e) => {
    e.preventDefault();
    const trimmed = newPin.trim();
    if (trimmed.length < 4 || trimmed.length > 6 || !/^\d+$/.test(trimmed)) {
      setPinError('PIN must be 4–6 digits.');
      return;
    }
    setSavingPin(true);
    setPinError('');
    try {
      const { error } = await api.request('POST', `/staff/${pinTargetStaff.id}/set-pin`, {
        body: { pin: trimmed },
      });
      if (error) {
        setPinError(error.message || 'Failed to set PIN. Please try again.');
        return;
      }
      setPinSuccess(true);
    } finally {
      setSavingPin(false);
    }
  };

  const addStaff = async () => {
    if (!activeLocation || !formData.first_name || !formData.last_name || !formData.email || !formData.password) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      // In a real app, you'd hash the password on the backend
      const { data, error } = await supabase
        .from('staff')
        .insert({
          location_id: activeLocation.id,
          employee_id: formData.employee_id || null,
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.trim() || null,
          password_hash: formData.password, // In production, this should be hashed
          role: formData.role,
          hire_date: formData.hire_date || null,
          notes: formData.notes.trim() || null,
          is_active: formData.is_active
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('email')) {
            throw new Error('This email is already in use');
          } else if (error.message.includes('employee_id')) {
            throw new Error('This employee ID is already in use');
          }
        }
        throw error;
      }

      setIsAddModalOpen(false);
      resetForm();
      fetchStaff();
      alert('Staff member added successfully!');
    } catch (error) {
      console.error('Error adding staff:', error);
      alert(error.message || 'Failed to add staff member');
    } finally {
      setSaving(false);
    }
  };

  const editStaff = async () => {
    if (!editingStaff || !formData.first_name || !formData.last_name || !formData.email) {
      alert('Please fill in all required fields');
      return;
    }
    
    setSaving(true);
    try {
      const updateData = {
        employee_id: formData.employee_id || null,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim() || null,
        role: formData.role,
        hire_date: formData.hire_date || null,
        notes: formData.notes.trim() || null,
        is_active: formData.is_active,
        updated_at: new Date().toISOString()
      };

      // Only update password if provided
      if (formData.password) {
        updateData.password_hash = formData.password; // In production, hash this
      }

      const { error } = await supabase
        .from('staff')
        .update(updateData)
        .eq('id', editingStaff.id);

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('email')) {
            throw new Error('This email is already in use');
          } else if (error.message.includes('employee_id')) {
            throw new Error('This employee ID is already in use');
          }
        }
        throw error;
      }

      setIsEditModalOpen(false);
      setEditingStaff(null);
      resetForm();
      fetchStaff();
      alert('Staff member updated successfully!');
    } catch (error) {
      console.error('Error updating staff:', error);
      alert(error.message || 'Failed to update staff member');
    } finally {
      setSaving(false);
    }
  };

  const deleteStaff = async (staffId, staffName) => {
    if (!confirm(`Are you sure you want to delete ${staffName}? This action cannot be undone.`)) return;
    
    setActionLoading(staffId);
    try {
      const { error } = await supabase
        .from('staff')
        .delete()
        .eq('id', staffId);
      
      if (error) throw error;
      fetchStaff();
      alert('Staff member deleted successfully');
    } catch (error) {
      console.error('Error deleting staff:', error);
      alert('Failed to delete staff member');
    } finally {
      setActionLoading('');
    }
  };

  const toggleStaffStatus = async (staffId, currentStatus) => {
    setActionLoading(staffId);
    try {
      const { error } = await supabase
        .from('staff')
        .update({ 
          is_active: !currentStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', staffId);
      
      if (error) throw error;
      fetchStaff();
    } catch (error) {
      console.error('Error updating staff status:', error);
      alert('Failed to update staff status');
    } finally {
      setActionLoading('');
    }
  };

  const openEditModal = (staffMember) => {
    setEditingStaff(staffMember);
    setFormData({
      employee_id: staffMember.employee_id || '',
      first_name: staffMember.first_name || '',
      last_name: staffMember.last_name || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      password: '', // Don't pre-fill password
      role: staffMember.role || 'cashier',
      hire_date: staffMember.hire_date || '',
      notes: staffMember.notes || '',
      is_active: staffMember.is_active ?? true
    });
    setIsEditModalOpen(true);
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4" />;
      case 'admin':
        return <Shield className="w-4 h-4" />;
      case 'manager':
        return <ChefHat className="w-4 h-4" />;
      case 'cashier':
        return <CreditCard className="w-4 h-4" />;
      case 'kitchen':
        return <User className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'manager':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cashier':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'kitchen':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  const filteredStaff = staff.filter(member => {
    const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
    const email = member.email?.toLowerCase() || '';
    const employeeId = member.employee_id?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    
    return fullName.includes(search) || 
           email.includes(search) || 
           employeeId.includes(search);
  });

  // New functions for time and attendance
  const fetchTimeEntries = async (staffId = null) => {
    if (!activeLocation) return;
    
    setLoadingTimeEntries(true);
    try {
      let query = supabase
        .from('staff_time_entries')
        .select(`
          id,
          staff_id,
          entry_type,
          timestamp,
          notes,
          staff (
            first_name,
            last_name,
            employee_id
          )
        `)
        .eq('location_id', activeLocation.id)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (staffId) {
        query = query.eq('staff_id', staffId);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setTimeEntries(data || []);
    } catch (error) {
      console.error('Error fetching time entries:', error);
    } finally {
      setLoadingTimeEntries(false);
    }
  };

  const handleTimeEntry = async (staffId, entryType) => {
    if (!activeLocation) return;
    
    setActionLoading(staffId);
    try {
      const { data, error } = await supabase
        .from('staff_time_entries')
        .insert({
          staff_id: staffId,
          location_id: activeLocation.id,
          entry_type: entryType,
          timestamp: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      
      fetchTimeEntries(selectedStaffId);
    } catch (error) {
      console.error('Error recording time entry:', error);
      alert('Failed to record time entry');
    } finally {
      setActionLoading('');
    }
  };

  const getLatestTimeEntry = (staffId) => {
    return timeEntries.find(entry => entry.staff_id === staffId);
  };

  const getTimeEntryStatus = (staffId) => {
    const latestEntry = getLatestTimeEntry(staffId);
    if (!latestEntry) return 'out';
    
    switch (latestEntry.entry_type) {
      case 'clock_in':
        return 'in';
      case 'break_start':
        return 'break';
      case 'break_end':
        return 'in';
      case 'clock_out':
        return 'out';
      default:
        return 'out';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'in':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <Clock className="w-3 h-3 mr-1" />
            Clocked In
          </Badge>
        );
      case 'break':
        return (
          <Badge className="bg-orange-100 text-orange-800 border-orange-200">
            <Coffee className="w-3 h-3 mr-1" />
            On Break
          </Badge>
        );
      case 'out':
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-200">
            <StopCircle className="w-3 h-3 mr-1" />
            Clocked Out
          </Badge>
        );
      default:
        return null;
    }
  };

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Location Selected</h2>
        <p className="text-gray-600">Please select a location to manage staff members.</p>
      </div>
    );
  }

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

  const StaffForm = ({ isEdit = false }) => (
    <div className="space-y-4 mt-4 max-h-96 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            First Name <span className="text-red-500">*</span>
          </label>
          <Input
            placeholder="Enter first name"
            value={formData.first_name}
            onChange={(e) => handleInputChange('first_name', e.target.value)}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Last Name <span className="text-red-500">*</span>
          </label>
          <Input
            placeholder="Enter last name"
            value={formData.last_name}
            onChange={(e) => handleInputChange('last_name', e.target.value)}
            className="w-full"
            required
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Email <span className="text-red-500">*</span>
          </label>
          <Input
            type="email"
            placeholder="Enter email address"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Phone
          </label>
          <Input
            type="tel"
            placeholder="Enter phone number"
            value={formData.phone}
            onChange={(e) => handleInputChange('phone', e.target.value)}
            className="w-full"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Employee ID
          </label>
          <Input
            placeholder="Enter employee ID"
            value={formData.employee_id}
            onChange={(e) => handleInputChange('employee_id', e.target.value)}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Role <span className="text-red-500">*</span>
          </label>
          <Select value={formData.role} onValueChange={(value) => handleInputChange('role', value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cashier">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Cashier
                </div>
              </SelectItem>
              <SelectItem value="kitchen">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Kitchen Staff
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
              <SelectItem value="owner">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4" />
                  Owner
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Password {isEdit ? '' : <span className="text-red-500">*</span>}
          </label>
          <Input
            type="password"
            placeholder={isEdit ? "Leave blank to keep current password" : "Enter password"}
            value={formData.password}
            onChange={(e) => handleInputChange('password', e.target.value)}
            className="w-full"
            required={!isEdit}
          />
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Hire Date
          </label>
          <Input
            type="date"
            value={formData.hire_date}
            onChange={(e) => handleInputChange('hire_date', e.target.value)}
            className="w-full"
          />
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">
          Notes
        </label>
        <Textarea
          placeholder="Enter any additional notes..."
          value={formData.notes}
          onChange={(e) => handleInputChange('notes', e.target.value)}
          rows={3}
          className="w-full"
        />
      </div>
      
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => handleInputChange('is_active', e.target.checked)}
          className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
        />
        <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
          Active Employee
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="w-8 h-8 text-orange-500" />
              Staff Management
            </h1>
            <p className="text-gray-600 mt-1">
              Manage staff members for {activeLocation?.name}
            </p>
          </div>
          <Link to="/staff/manage">
            <Button
              variant="outline"
              className="border-orange-200 text-orange-700 hover:bg-orange-50 hover:border-orange-300"
            >
              <KeyRound className="w-4 h-4 mr-2" />
              Manage Staff (detailed)
            </Button>
          </Link>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="border-b border-orange-100 bg-transparent">
            <TabsTrigger 
              value="staff" 
              className="flex items-center gap-2 data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 data-[state=active]:border-orange-500"
            >
              <Users className="w-4 h-4" />
              Staff List
            </TabsTrigger>
            <TabsTrigger 
              value="attendance" 
              className="flex items-center gap-2 data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 data-[state=active]:border-orange-500"
              onClick={() => fetchTimeEntries(selectedStaffId)}
            >
              <Timer className="w-4 h-4" />
              Time & Attendance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="staff" className="space-y-6">
            {/* Search Bar */}
            <div className="relative max-w-2xl">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-orange-400 w-5 h-5" />
              <Input
                placeholder="Search staff by name, email, or employee ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-12 h-12 text-base font-medium border-orange-200 focus:border-orange-300 focus:ring-orange-200 bg-white"
              />
            </div>

            {/* FAB - Add Staff Button */}
            <Button
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-xl hover:shadow-2xl hover:from-orange-600 hover:to-orange-700 transition-all duration-300 z-40 flex items-center justify-center sm:hidden"
              size="lg"
            >
              <UserPlus className="w-6 h-6" />
            </Button>

            {/* Desktop Add Button */}
            <div className="hidden sm:flex justify-end">
              <Button 
                onClick={() => {
                  resetForm();
                  setIsAddModalOpen(true);
                }}
                className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Add Staff Member
              </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border-orange-100 hover:border-orange-200 transition-colors bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-3xl font-bold text-gray-900">{staff.length}</p>
                      <p className="text-sm text-gray-600 mt-1">Total Staff</p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                      <Users className="w-6 h-6 text-orange-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-orange-100 hover:border-orange-200 transition-colors bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-3xl font-bold text-orange-600">
                        {staff.filter(s => s.is_active).length}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">Active</p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-orange-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-orange-100 hover:border-orange-200 transition-colors bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-3xl font-bold text-orange-600">
                        {staff.filter(s => !s.is_active).length}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">Inactive</p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                      <XCircle className="w-6 h-6 text-orange-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="border-orange-100 hover:border-orange-200 transition-colors bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold text-gray-900 truncate">{activeLocation?.name}</p>
                      <p className="text-sm text-gray-600 mt-1">Current Location</p>
                    </div>
                    <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                      <MapPin className="w-6 h-6 text-orange-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Staff Grid */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Staff Members</h2>
              
              {filteredStaff.length === 0 ? (
                <Card className="border-orange-100 bg-white">
                  <CardContent className="p-12 text-center">
                    <div className="w-16 h-16 rounded-lg bg-orange-50 flex items-center justify-center mx-auto mb-4">
                      <Users className="w-8 h-8 text-orange-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      {searchTerm ? 'No staff found' : 'No staff members yet'}
                    </h3>
                    <p className="text-gray-600 mb-6">
                      {searchTerm 
                        ? 'Try adjusting your search terms' 
                        : 'Add staff members to manage your team'
                      }
                    </p>
                    {!searchTerm && (
                      <Button 
                        onClick={() => {
                          resetForm();
                          setIsAddModalOpen(true);
                        }}
                        className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
                      >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add First Staff Member
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                  {filteredStaff.map((staffMember) => {
                    const isLoading = actionLoading === staffMember.id;
                    
                    return (
                      <Card key={staffMember.id} className="border-orange-100 hover:border-orange-200 hover:shadow-md transition-all duration-200 bg-white">
                        <CardContent className="p-6">
                          <div className="space-y-4">
                            {/* Staff Info */}
                            <div className="flex items-start gap-4">
                              <Avatar className="h-14 w-14 border-2 border-orange-100">
                                <AvatarFallback className="bg-orange-50 text-orange-700 font-semibold text-lg">
                                  {getInitials(staffMember.first_name, staffMember.last_name)}
                                </AvatarFallback>
                              </Avatar>
                              
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-gray-900 text-lg truncate mb-1">
                                  {staffMember.first_name} {staffMember.last_name}
                                </h3>
                                <p className="text-sm text-gray-600 truncate mb-2">
                                  {staffMember.email}
                                </p>
                                
                                {staffMember.employee_id && (
                                  <p className="text-xs text-gray-600 mb-2">
                                    ID: {staffMember.employee_id}
                                  </p>
                                )}
                                
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge 
                                    variant="outline" 
                                    className={cn("text-xs font-medium bg-orange-50 text-orange-700 border-orange-200")}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      {getRoleIcon(staffMember.role)}
                                      {staffMember.role}
                                    </span>
                                  </Badge>
                                  
                                  <Badge 
                                    variant="outline"
                                    className={cn(
                                      "text-xs font-medium",
                                      staffMember.is_active 
                                        ? "bg-orange-50 text-orange-700 border-orange-200"
                                        : "bg-orange-50 text-orange-700 border-orange-200 opacity-75"
                                    )}
                                  >
                                    {staffMember.is_active ? 'Active' : 'Inactive'}
                                  </Badge>
                                </div>
                                
                                {staffMember.hire_date && (
                                  <p className="text-xs text-gray-600 mb-2">
                                    Hired: {format(new Date(staffMember.hire_date), 'MMM dd, yyyy')}
                                  </p>
                                )}
                                
                                <p className="text-xs text-gray-600">
                                  Added {formatDistanceToNow(new Date(staffMember.created_at), { addSuffix: true })}
                                </p>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="space-y-2 pt-4 border-t border-orange-100">
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditModal(staffMember)}
                                  disabled={isLoading}
                                  className="text-xs hover:bg-orange-50 border-orange-200 text-orange-700"
                                >
                                  <Edit className="w-3 h-3 mr-1" />
                                  Edit
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => toggleStaffStatus(staffMember.id, staffMember.is_active)}
                                  disabled={isLoading}
                                  className={cn(
                                    "text-xs",
                                    staffMember.is_active
                                      ? "hover:bg-orange-50 border-orange-200 text-orange-700"
                                      : "hover:bg-orange-50 border-orange-200 text-orange-700"
                                  )}
                                >
                                  {staffMember.is_active ? (
                                    <>
                                      <EyeOff className="w-3 h-3 mr-1" />
                                      Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="w-3 h-3 mr-1" />
                                      Activate
                                    </>
                                  )}
                                </Button>
                              </div>

                              {/* Set/Reset PIN — lets manager give staff a quick-login PIN */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openPinDialog(staffMember)}
                                disabled={isLoading}
                                className="w-full text-xs text-orange-700 hover:text-orange-800 hover:bg-orange-50 border-orange-200"
                              >
                                <Hash className="w-3 h-3 mr-1" />
                                {staffMember.pin_hash ? 'Reset PIN' : 'Set PIN'}
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => deleteStaff(staffMember.id, `${staffMember.first_name} ${staffMember.last_name}`)}
                                disabled={isLoading}
                                className="w-full text-xs text-orange-700 hover:text-orange-800 hover:bg-orange-50 border-orange-200"
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="attendance" className="space-y-6">
            {/* Time & Attendance Content */}
            <div className="flex flex-col gap-6">
              {/* Filter Controls */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Select 
                    value={selectedStaffId || 'all'} 
                    onValueChange={(value) => {
                      setSelectedStaffId(value === 'all' ? null : value);
                      fetchTimeEntries(value === 'all' ? null : value);
                    }}
                  >
                    <SelectTrigger className="border-orange-200 focus:ring-orange-200 focus:border-orange-300">
                      <SelectValue placeholder="Filter by staff member" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff Members</SelectItem>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.first_name} {member.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Time Entry Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {staff.filter(member => member.is_active).map((member) => {
                  const status = getTimeEntryStatus(member.id);
                  const isLoading = actionLoading === member.id;
                  
                  return (
                    <Card key={member.id} className="border-orange-100 hover:border-orange-200 hover:shadow-md transition-all duration-200 bg-white">
                      <CardContent className="p-6">
                        <div className="space-y-4">
                          {/* Staff Info */}
                          <div className="flex items-start gap-4">
                            <Avatar className="h-14 w-14 border-2 border-orange-100">
                              <AvatarFallback className="bg-orange-50 text-orange-700 font-semibold text-lg">
                                {getInitials(member.first_name, member.last_name)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-gray-900 text-lg truncate mb-2">
                                {member.first_name} {member.last_name}
                              </h3>
                              
                              {getStatusBadge(status)}
                              
                              {member.employee_id && (
                                <p className="text-xs text-gray-600 mt-2">
                                  ID: {member.employee_id}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Time Entry Actions */}
                          <div className="grid grid-cols-2 gap-2 pt-4 border-t border-orange-100">
                            {status === 'out' && (
                              <Button
                                size="sm"
                                onClick={() => handleTimeEntry(member.id, 'clock_in')}
                                disabled={isLoading}
                                className="text-xs bg-orange-500 hover:bg-orange-600 text-white shadow-sm hover:shadow"
                              >
                                <PlayCircle className="w-3 h-3 mr-1" />
                                Clock In
                              </Button>
                            )}
                            
                            {status === 'in' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleTimeEntry(member.id, 'break_start')}
                                  disabled={isLoading}
                                  className="text-xs bg-orange-500 hover:bg-orange-600 text-white shadow-sm hover:shadow"
                                >
                                  <Coffee className="w-3 h-3 mr-1" />
                                  Start Break
                                </Button>
                                
                                <Button
                                  size="sm"
                                  onClick={() => handleTimeEntry(member.id, 'clock_out')}
                                  disabled={isLoading}
                                  className="text-xs bg-orange-500 hover:bg-orange-600 text-white shadow-sm hover:shadow"
                                >
                                  <StopCircle className="w-3 h-3 mr-1" />
                                  Clock Out
                                </Button>
                              </>
                            )}
                            
                            {status === 'break' && (
                              <Button
                                size="sm"
                                onClick={() => handleTimeEntry(member.id, 'break_end')}
                                disabled={isLoading}
                                className="text-xs bg-orange-500 hover:bg-orange-600 text-white shadow-sm hover:shadow"
                              >
                                <ArrowLeftCircle className="w-3 h-3 mr-1" />
                                End Break
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Time Entry History */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Recent Time Entries</h3>
                
                {loadingTimeEntries ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 bg-orange-50 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : timeEntries.length === 0 ? (
                  <Card className="border-orange-100 bg-white">
                    <CardContent className="p-6 text-center">
                      <Clock className="w-12 h-12 text-orange-400 mx-auto mb-4" />
                      <p className="text-gray-600">No time entries found</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {timeEntries.map((entry) => (
                      <Card key={entry.id} className="border-orange-100 hover:border-orange-200 transition-colors bg-white">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-900">
                                {entry.staff.first_name} {entry.staff.last_name}
                              </p>
                              <p className="text-sm text-gray-600">
                                {format(parseISO(entry.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                              </p>
                            </div>
                            <Badge 
                              variant="outline"
                              className={cn(
                                "capitalize",
                                entry.entry_type === 'clock_in' && "bg-orange-50 text-orange-700 border-orange-200",
                                entry.entry_type === 'clock_out' && "bg-orange-50 text-orange-700 border-orange-200",
                                entry.entry_type.includes('break') && "bg-orange-50 text-orange-700 border-orange-200"
                              )}
                            >
                              {entry.entry_type.replace('_', ' ')}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Staff Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-orange-500" />
              Add New Staff Member
            </DialogTitle>
            <DialogDescription>
              Add a new staff member to {activeLocation?.name}.
            </DialogDescription>
          </DialogHeader>
          
          <StaffForm />
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsAddModalOpen(false)}
              className="flex-1 border-orange-200 text-orange-700 hover:bg-orange-50"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={addStaff}
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              Add Staff Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-orange-500" />
              Edit Staff Member
            </DialogTitle>
            <DialogDescription>
              Update information for {editingStaff?.first_name} {editingStaff?.last_name}.
            </DialogDescription>
          </DialogHeader>
          
          <StaffForm isEdit={true} />
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsEditModalOpen(false)}
              className="flex-1 border-orange-200 text-orange-700 hover:bg-orange-50"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button 
              onClick={editStaff}
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Edit className="w-4 h-4 mr-2" />
              )}
              Update Staff Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set / Reset PIN dialog */}
      <Dialog open={pinDialogOpen} onOpenChange={(v) => { if (!v) closePinDialog(); }}>
        <DialogContent className="max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hash className="w-5 h-5 text-orange-500" />
              {pinTargetStaff?.pin_hash ? 'Reset PIN' : 'Set PIN'}
            </DialogTitle>
            <DialogDescription>
              Set a 4–6 digit PIN for{' '}
              <span className="font-medium text-gray-800">
                {pinTargetStaff?.first_name} {pinTargetStaff?.last_name}
              </span>
              . They will use this to log in at the POS terminal.
            </DialogDescription>
          </DialogHeader>

          {pinSuccess ? (
            <div className="py-4 text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
              <p className="text-sm text-green-700 font-medium">PIN updated successfully.</p>
              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={closePinDialog}
              >
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSetPin} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="staff_pin">New PIN</Label>
                <Input
                  id="staff_pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  placeholder="4–6 digits"
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value.replace(/\D/g, ''));
                    setPinError('');
                  }}
                  required
                  className="border-orange-200 focus:border-orange-400"
                />
              </div>

              {pinError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {pinError}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 border-orange-200 text-orange-700 hover:bg-orange-50"
                  onClick={closePinDialog}
                  disabled={savingPin}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={savingPin}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                >
                  {savingPin ? (
                    <><Clock className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
                  ) : (
                    'Set PIN'
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Team members — invite by email+role + manage pending/active non-driver members */}
      <MemberInvitesPanel />

      {/* Drivers — invite by email + manage pending driver invites */}
      <DriverInvitesPanel />
    </div>
  );
};

export default Staff; 