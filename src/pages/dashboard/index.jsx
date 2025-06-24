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
  Hash
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

  // Mock data for development - replace with real API calls
  const mockBites = [
    {
      id: '1',
      order_number: '2543',
      whatsapp_number: '+1234567890',
      status: 'preparing',
      created_at: new Date(Date.now() - 5 * 60000).toISOString(),
      order_ready_at: null,
      customer_name: 'Maria G.'
    },
    {
      id: '2', 
      order_number: '2544',
      whatsapp_number: '+1234567891',
      status: 'ready',
      created_at: new Date(Date.now() - 15 * 60000).toISOString(),
      order_ready_at: new Date(Date.now() - 2 * 60000).toISOString(),
      customer_name: 'John D.'
    },
    {
      id: '3',
      order_number: '2545', 
      whatsapp_number: '+1234567892',
      status: 'pending',
      created_at: new Date(Date.now() - 1 * 60000).toISOString(),
      order_ready_at: null,
      customer_name: 'Sarah K.'
    },
    {
      id: '4',
      order_number: '2546',
      whatsapp_number: '+1234567893', 
      status: 'completed',
      created_at: new Date(Date.now() - 60 * 60000).toISOString(),
      order_ready_at: new Date(Date.now() - 45 * 60000).toISOString(),
      customer_name: 'Ahmed H.'
    }
  ];

  useEffect(() => {
    fetchBites();
  }, []);

  const fetchBites = async () => {
    setLoading(true);
    try {
      // For now using mock data - replace with actual Supabase query
      // const { data, error } = await supabase
      //   .from('bites')
      //   .select('*')
      //   .order('created_at', { ascending: false });
      
      // if (error) throw error;
      
      // Simulate API delay
      setTimeout(() => {
        setBites(mockBites);
        setLoading(false);
      }, 500);
    } catch (error) {
      console.error('Error fetching bites:', error);
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

      // TODO: Update in Supabase
      // const { error } = await supabase
      //   .from('bites')
      //   .update({ 
      //     status: newStatus,
      //     order_ready_at: newStatus === 'ready' ? new Date().toISOString() : null
      //   })
      //   .eq('id', biteId);
      
      // if (error) throw error;
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
                         bite.whatsapp_number.includes(searchTerm) ||
                         (bite.customer_name && bite.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));
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
          <div className="grid gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Manage your restaurant orders in real-time</p>
        </div>
        <Button 
          onClick={() => setIsCreateModalOpen(true)}
          size="lg"
          className="beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create a Bite
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">{statusCounts[stat.key]}</div>
              <div className="text-sm text-gray-600">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search by order number, phone, or customer name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" className="flex items-center gap-2">
          <Filter className="w-4 h-4" />
          Filters
        </Button>
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        {filteredBites.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="space-y-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <Hash className="w-8 h-8 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">No orders found</h3>
                <p className="text-gray-500">
                  {searchTerm ? 'Try adjusting your search terms' : 'Create your first bite to get started'}
                </p>
              </div>
              {!searchTerm && (
                <Button 
                  onClick={() => setIsCreateModalOpen(true)}
                  className="beepbite-gradient text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Bite
                </Button>
              )}
            </div>
          </Card>
        ) : (
          filteredBites.map((bite) => (
            <Card key={bite.id} className="hover:shadow-md transition-shadow duration-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                        <Hash className="w-6 h-6 text-orange-600" />
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Order #{bite.order_number}
                        </h3>
                        <Badge className={`${getStatusColor(bite.status)} capitalize`}>
                          <span className="flex items-center gap-1">
                            {getStatusIcon(bite.status)}
                            {bite.status}
                          </span>
                        </Badge>
                      </div>
                      
                      <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                        <span className="flex items-center">
                          <Phone className="w-4 h-4 mr-1" />
                          {bite.whatsapp_number}
                        </span>
                        {bite.customer_name && (
                          <span>{bite.customer_name}</span>
                        )}
                        <span>
                          Created {formatDistanceToNow(new Date(bite.created_at), { addSuffix: true })}
                        </span>
                        {bite.order_ready_at && (
                          <span>
                            Ready {formatDistanceToNow(new Date(bite.order_ready_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* Quick Status Actions */}
                    {bite.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateBiteStatus(bite.id, 'preparing')}
                        className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        Start Preparing
                      </Button>
                    )}
                    {bite.status === 'preparing' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateBiteStatus(bite.id, 'ready')}
                        className="text-green-600 border-green-200 hover:bg-green-50"
                      >
                        Mark Ready
                      </Button>
                    )}
                    {bite.status === 'ready' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateBiteStatus(bite.id, 'completed')}
                        className="text-gray-600 border-gray-200 hover:bg-gray-50"
                      >
                        Complete
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => updateBiteStatus(bite.id, 'pending')}>
                          Set to Pending
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateBiteStatus(bite.id, 'preparing')}>
                          Set to Preparing
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateBiteStatus(bite.id, 'ready')}>
                          Set to Ready
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateBiteStatus(bite.id, 'completed')}>
                          Set to Completed
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
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