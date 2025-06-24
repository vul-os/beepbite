import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search, 
  Bell, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Filter,
  MoreHorizontal,
  Phone,
  Hash,
  Play,
  Check,
  MessageSquare,
  Eye,
  ArrowRight,
  ChefHat,
  Utensils
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import CreateBiteModal from '@/components/modals/create-bite-modal';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { formatDistanceToNow } from 'date-fns';

const Dashboard = () => {
  const { user } = useAuth();
  const [bites, setBites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [currentBistro, setCurrentBistro] = useState(null);

  useEffect(() => {
    fetchCurrentBistro();
  }, [user]);

  useEffect(() => {
    if (currentBistro) {
      fetchBites();
    }
  }, [currentBistro]);

  const fetchCurrentBistro = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('bistro_members')
        .select(`
          bistro_id,
          role,
          bistros (
            id,
            name,
            description
          )
        `)
        .eq('profile_id', user.id)
        .single();

      if (error) throw error;
      setCurrentBistro(data.bistros);
    } catch (error) {
      console.error('Error fetching bistro:', error);
    }
  };

  const fetchBites = async () => {
    if (!currentBistro) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bites')
        .select('*')
        .eq('bistro_id', currentBistro.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setBites(data || []);
    } catch (error) {
      console.error('Error fetching bites:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateBiteStatus = async (biteId, newStatus) => {
    try {
      // Update local state immediately for better UX
      setBites(prev => prev.map(bite => 
        bite.id === biteId 
          ? { 
              ...bite, 
              status: newStatus,
              order_ready_at: newStatus === 'ready' ? new Date().toISOString() : bite.order_ready_at
            }
          : bite
      ));

      const updateData = { 
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      if (newStatus === 'ready') {
        updateData.order_ready_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('bites')
        .update(updateData)
        .eq('id', biteId);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error updating bite status:', error);
      // Revert optimistic update on error
      fetchBites();
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'preparing':
        return <AlertCircle className="w-4 h-4" />;
      case 'ready':
        return <Bell className="w-4 h-4" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'preparing':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ready':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'completed':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const filteredBites = bites.filter(bite => {
    const matchesSearch = bite.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         bite.whatsapp_number.includes(searchTerm);
    const matchesStatus = statusFilter === 'all' || bite.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: bites.length,
    pending: bites.filter(b => b.status === 'pending').length,
    preparing: bites.filter(b => b.status === 'preparing').length,
    ready: bites.filter(b => b.status === 'ready').length,
    completed: bites.filter(b => b.status === 'completed').length,
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="h-8 bg-gray-200 rounded w-48 animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded w-32 animate-pulse"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-48 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-3 sm:space-y-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 sm:space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm sm:text-base text-gray-600">
            {currentBistro ? `${currentBistro.name} - Manage your orders in real-time` : 'Manage your restaurant orders in real-time'}
          </p>
        </div>
        <Button 
          onClick={() => setIsCreateModalOpen(true)}
          size="lg"
          className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-300 w-full sm:w-auto"
        >
          <Plus className="w-4 sm:w-5 h-4 sm:h-5 mr-2" />
          <span className="text-sm sm:text-base">Create a Bite</span>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {[
          { key: 'all', label: 'Total Orders', color: 'bg-gray-50 border-gray-200' },
          { key: 'pending', label: 'Pending', color: 'bg-yellow-50 border-yellow-200' },
          { key: 'preparing', label: 'Preparing', color: 'bg-blue-50 border-blue-200' },
          { key: 'ready', label: 'Ready', color: 'bg-green-50 border-green-200' },
          { key: 'completed', label: 'Completed', color: 'bg-gray-50 border-gray-200' },
        ].map((stat) => (
          <Card 
            key={stat.key}
            className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
              statusFilter === stat.key ? 'ring-2 ring-orange-500' : ''
            } ${stat.color}`}
            onClick={() => setStatusFilter(stat.key)}
          >
            <CardContent className="p-3 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-bold">{statusCounts[stat.key]}</div>
              <div className="text-xs sm:text-sm text-gray-600 leading-tight">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col space-y-3 sm:space-y-0 sm:flex-row sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search by order number or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 text-sm sm:text-base"
          />
        </div>
        <Button variant="outline" className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4" />
          <span className="text-sm sm:text-base">Filters</span>
        </Button>
      </div>

      {/* Orders Grid */}
      <div className="space-y-4">
        {filteredBites.length === 0 ? (
          <Card className="p-8 sm:p-12 text-center">
            <div className="space-y-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <Hash className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-medium text-gray-900">No orders found</h3>
                <p className="text-sm sm:text-base text-gray-500">
                  {searchTerm ? 'Try adjusting your search terms' : 'Create your first bite to get started'}
                </p>
              </div>
              {!searchTerm && (
                <Button 
                  onClick={() => setIsCreateModalOpen(true)}
                  className="beepbite-gradient text-white w-full sm:w-auto"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Bite
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredBites.map((bite) => (
              <Card key={bite.id} className="hover:shadow-lg transition-all duration-200 border-l-4 border-l-orange-500">
                <CardHeader className="pb-2 sm:pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                      <Hash className="w-4 sm:w-5 h-4 sm:h-5 text-orange-600" />
                      <span className="truncate">{bite.order_number}</span>
                    </CardTitle>
                    <Badge className={`${getStatusColor(bite.status)} capitalize text-xs sm:text-sm shrink-0`}>
                      <span className="flex items-center gap-1">
                        {getStatusIcon(bite.status)}
                        <span className="hidden sm:inline">{bite.status}</span>
                      </span>
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-3 sm:space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center text-xs sm:text-sm text-gray-600">
                      <Phone className="w-3 sm:w-4 h-3 sm:h-4 mr-2 text-gray-400 shrink-0" />
                      <span className="truncate">{bite.whatsapp_number}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Created {formatDistanceToNow(new Date(bite.created_at), { addSuffix: true })}
                    </div>
                    {bite.order_ready_at && (
                      <div className="text-xs text-green-600">
                        Ready {formatDistanceToNow(new Date(bite.order_ready_at), { addSuffix: true })}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-3">
                    {/* Primary Action Button */}
                    <div className="space-y-2">
                      {bite.status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => updateBiteStatus(bite.id, 'preparing')}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all duration-200 hover:shadow-md"
                        >
                          <ChefHat className="w-4 h-4 mr-2" />
                          Start Preparing
                        </Button>
                      )}
                      {bite.status === 'preparing' && (
                        <Button
                          size="sm"
                          onClick={() => updateBiteStatus(bite.id, 'ready')}
                          className="w-full bg-green-600 hover:bg-green-700 text-white shadow-sm transition-all duration-200 hover:shadow-md"
                        >
                          <Bell className="w-4 h-4 mr-2" />
                          Mark Ready
                        </Button>
                      )}
                      {bite.status === 'ready' && (
                        <Button
                          size="sm"
                          onClick={() => updateBiteStatus(bite.id, 'completed')}
                          className="w-full bg-orange-600 hover:bg-orange-700 text-white shadow-sm transition-all duration-200 hover:shadow-md"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Complete Order
                        </Button>
                      )}
                      {bite.status === 'completed' && (
                        <div className="w-full px-3 py-2 bg-gray-100 text-gray-700 rounded-md text-center text-sm font-medium">
                          <CheckCircle className="w-4 h-4 inline mr-2 text-green-600" />
                          Order Completed
                        </div>
                      )}
                    </div>

                    {/* Secondary Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 transition-all duration-200"
                        onClick={() => {
                          // Add notification/WhatsApp functionality
                          console.log('Send notification for order:', bite.order_number);
                        }}
                      >
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Notify
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all duration-200"
                        onClick={() => {
                          // Add view details functionality
                          console.log('View details for order:', bite.order_number);
                        }}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        Details
                      </Button>
                    </div>

                    {/* More Actions Dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all duration-200 border border-gray-200 hover:border-gray-300"
                        >
                          <MoreHorizontal className="w-3 sm:w-4 h-3 sm:h-4 mr-1" />
                          More Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem 
                          onClick={() => updateBiteStatus(bite.id, 'pending')}
                          className="flex items-center gap-2 hover:bg-yellow-50"
                        >
                          <Clock className="w-4 h-4 text-yellow-600" />
                          Set to Pending
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => updateBiteStatus(bite.id, 'preparing')}
                          className="flex items-center gap-2 hover:bg-blue-50"
                        >
                          <ChefHat className="w-4 h-4 text-blue-600" />
                          Set to Preparing
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => updateBiteStatus(bite.id, 'ready')}
                          className="flex items-center gap-2 hover:bg-green-50"
                        >
                          <Bell className="w-4 h-4 text-green-600" />
                          Set to Ready
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => updateBiteStatus(bite.id, 'completed')}
                          className="flex items-center gap-2 hover:bg-gray-50"
                        >
                          <CheckCircle className="w-4 h-4 text-gray-600" />
                          Set to Completed
                        </DropdownMenuItem>
                        <div className="border-t border-gray-100 my-1"></div>
                        <DropdownMenuItem className="flex items-center gap-2 hover:bg-orange-50 text-orange-700">
                          <MessageSquare className="w-4 h-4" />
                          Send WhatsApp Update
                        </DropdownMenuItem>
                        <DropdownMenuItem className="flex items-center gap-2 hover:bg-blue-50 text-blue-700">
                          <Eye className="w-4 h-4" />
                          View Full Details
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Bite Modal */}
      <CreateBiteModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onBiteCreated={fetchBites}
      />
    </div>
  );
};

export default Dashboard; 