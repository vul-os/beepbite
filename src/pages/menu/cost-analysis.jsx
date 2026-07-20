import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Calculator,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Search,
  Filter,
  BarChart3,
  PieChart,
  Target,
  Package,
  ChefHat,
  Utensils,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  RefreshCw
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMoney } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";

const CostAnalysis = ({ activeLocation }) => {
  const { format: formatMoneyValue, scale: currencyScaleValue } = useMoney();
  const [analysisData, setAnalysisData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('profit_margin');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showOnlyProblematic, setShowOnlyProblematic] = useState(false);
  const [costThreshold, setCostThreshold] = useState(1.00);

  useEffect(() => {
    if (activeLocation) {
      fetchAnalysisData();
    }
  }, [activeLocation]);

  const fetchAnalysisData = async () => {
    if (!activeLocation) return;
    
    setLoading(true);
    try {
      // Try to use the recipe_summary view first
      const { data: summaryData, error: summaryError } = await supabase
        .from('recipe_summary')
        .select('*')
        .order('recipe_complexity', { ascending: false })
        .order('cost_variance', { ascending: false });
      
      if (summaryError) throw summaryError;
      
      // Enhance with additional calculations
      const enhancedData = summaryData.map(item => {
        const profitMargin = item.listed_cost > 0 
          ? ((item.listed_cost - item.calculated_cost) / item.listed_cost * 100)
          : 0;
        
        const profitAmount = (item.listed_cost || 0) - (item.calculated_cost || 0);
        
        const status = determineStatus(item, profitMargin);
        
        return {
          ...item,
          profit_margin: profitMargin,
          profit_amount: profitAmount,
          status
        };
      });
      
      setAnalysisData(enhancedData);
    } catch (error) {
      console.error('Error fetching analysis data:', error);
      // Fallback to manual calculation
      await fetchAnalysisDataFallback();
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalysisDataFallback = async () => {
    try {
      const { data: items, error } = await supabase
        .from('items')
        .select(`
          id,
          name,
          price,
          cost_price,
          recipe_type,
          recipe_complexity,
          max_recipe_level,
          total_components,
          auto_calculate_cost,
          categories (
            id,
            name
          )
        `)
        .eq('location_id', activeLocation.id)
        .neq('recipe_type', 'simple');

      if (error) throw error;

      // Calculate costs manually for items that need it
      const enhancedData = await Promise.all(
        items.map(async (item) => {
          let calculatedCost = item.cost_price || 0;
          
          if (item.recipe_type !== 'simple') {
            try {
              const { data: costData } = await supabase.rpc('calculate_recipe_cost', {
                item_uuid: item.id
              });
              calculatedCost = costData || 0;
            } catch (costError) {
              console.warn('Failed to calculate cost for', item.name);
            }
          }
          
          const profitMargin = item.price > 0 
            ? ((item.price - calculatedCost) / item.price * 100)
            : 0;
          
          const profitAmount = (item.price || 0) - calculatedCost;
          const costVariance = Math.abs((item.cost_price || 0) - calculatedCost);
          
          const status = determineStatus({
            ...item,
            calculated_cost: calculatedCost,
            cost_variance: costVariance
          }, profitMargin);
          
          return {
            ...item,
            listed_cost: item.cost_price,
            calculated_cost: calculatedCost,
            cost_variance: costVariance,
            profit_margin: profitMargin,
            profit_amount: profitAmount,
            status
          };
        })
      );
      
      setAnalysisData(enhancedData);
    } catch (error) {
      console.error('Error in fallback analysis fetch:', error);
    }
  };

  const determineStatus = (item, profitMargin) => {
    if (item.cost_variance > costThreshold) return 'cost_mismatch';
    if (profitMargin < 10) return 'low_profit';
    if (profitMargin < 25) return 'moderate_profit';
    if (profitMargin >= 50) return 'high_profit';
    return 'good_profit';
  };

  const getStatusInfo = (status) => {
    switch (status) {
      case 'cost_mismatch':
        return {
          label: 'Cost Mismatch',
          color: 'bg-red-100 text-red-800',
          icon: AlertTriangle,
          description: 'Manual and calculated costs differ significantly'
        };
      case 'low_profit':
        return {
          label: 'Low Profit',
          color: 'bg-orange-100 text-orange-800',
          icon: TrendingDown,
          description: 'Profit margin below 10%'
        };
      case 'moderate_profit':
        return {
          label: 'Moderate Profit',
          color: 'bg-yellow-100 text-yellow-800',
          icon: Minus,
          description: 'Profit margin 10-25%'
        };
      case 'good_profit':
        return {
          label: 'Good Profit',
          color: 'bg-green-100 text-green-800',
          icon: CheckCircle,
          description: 'Profit margin 25-50%'
        };
      case 'high_profit':
        return {
          label: 'High Profit',
          color: 'bg-blue-100 text-blue-800',
          icon: TrendingUp,
          description: 'Profit margin above 50%'
        };
      default:
        return {
          label: 'Unknown',
          color: 'bg-gray-100 text-gray-800',
          icon: Info,
          description: 'Status unknown'
        };
    }
  };

  // Analysis amounts are major-unit floats, so scale up to minor units before
  // handing them to the minor-unit-based formatter.
  const formatCurrency = (amount) => {
    return formatMoneyValue(Math.round((amount || 0) * currencyScaleValue));
  };

  const formatPercentage = (value) => {
    return `${value.toFixed(1)}%`;
  };

  const getItemTypeIcon = (type) => {
    switch (type) {
      case 'recipe': return <ChefHat className="h-4 w-4" />;
      case 'component': return <Package className="h-4 w-4" />;
      default: return <Utensils className="h-4 w-4" />;
    }
  };

  // Filter and sort data
  const filteredData = analysisData
    .filter(item => {
      const matchesSearch = !searchTerm || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesProblematic = !showOnlyProblematic || 
        ['cost_mismatch', 'low_profit'].includes(item.status);
      
      return matchesSearch && matchesProblematic;
    })
    .sort((a, b) => {
      let aVal = a[sortBy] || 0;
      let bVal = b[sortBy] || 0;
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

  // Calculate summary statistics
  const totalItems = filteredData.length;
  const avgProfitMargin = totalItems > 0 
    ? filteredData.reduce((sum, item) => sum + item.profit_margin, 0) / totalItems 
    : 0;
  const totalProfit = filteredData.reduce((sum, item) => sum + item.profit_amount, 0);
  const problematicItems = filteredData.filter(item => 
    ['cost_mismatch', 'low_profit'].includes(item.status)
  ).length;

  if (!activeLocation) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Calculator className="h-8 w-8 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Please select a location to view cost analysis</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Profit Margin</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatPercentage(avgProfitMargin)}
                </p>
              </div>
              <Target className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Profit</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(totalProfit)}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Items Analyzed</p>
                <p className="text-2xl font-bold text-gray-900">{totalItems}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Needs Attention</p>
                <p className="text-2xl font-bold text-gray-900">{problematicItems}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profit_margin">Profit Margin</SelectItem>
                <SelectItem value="profit_amount">Profit Amount</SelectItem>
                <SelectItem value="cost_variance">Cost Variance</SelectItem>
                <SelectItem value="listed_cost">Listed Cost</SelectItem>
                <SelectItem value="calculated_cost">Calculated Cost</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Descending</SelectItem>
                <SelectItem value="asc">Ascending</SelectItem>
              </SelectContent>
            </Select>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="show-problematic"
                checked={showOnlyProblematic}
                onCheckedChange={setShowOnlyProblematic}
              />
              <Label htmlFor="show-problematic" className="text-sm">Problems only</Label>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAnalysisData}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Analysis Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Cost Analysis Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
              <span className="text-gray-600">Analyzing costs...</span>
            </div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-12">
              <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No analysis data found</h3>
              <p className="text-gray-600">
                {analysisData.length === 0 
                  ? 'No recipes found for analysis. Create some recipes first.'
                  : 'No items match your current filters. Try adjusting your search criteria.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredData.map((item) => {
                const statusInfo = getStatusInfo(item.status);
                const StatusIcon = statusInfo.icon;
                
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {getItemTypeIcon(item.recipe_type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900 truncate">{item.name}</h4>
                          <Badge variant="outline">{item.recipe_type}</Badge>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className={statusInfo.color}>
                                  <StatusIcon className="h-3 w-3 mr-1" />
                                  {statusInfo.label}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{statusInfo.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-gray-600">Selling Price</p>
                            <p className="font-semibold">{formatCurrency(item.price)}</p>
                          </div>
                          
                          <div>
                            <p className="text-gray-600">Cost (Manual)</p>
                            <p className="font-semibold">{formatCurrency(item.listed_cost)}</p>
                          </div>
                          
                          <div>
                            <p className="text-gray-600">Cost (Calculated)</p>
                            <p className="font-semibold">{formatCurrency(item.calculated_cost)}</p>
                          </div>
                          
                          <div>
                            <p className="text-gray-600">Profit Margin</p>
                            <div className="flex items-center gap-2">
                              <p className={cn(
                                "font-semibold",
                                item.profit_margin < 10 ? "text-red-600" :
                                item.profit_margin < 25 ? "text-yellow-600" :
                                "text-green-600"
                              )}>
                                {formatPercentage(item.profit_margin)}
                              </p>
                              {item.profit_margin >= 0 ? (
                                <ArrowUpRight className="h-3 w-3 text-green-600" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3 text-red-600" />
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {item.cost_variance > costThreshold && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm">
                            <div className="flex items-center gap-2 text-red-800">
                              <AlertTriangle className="h-4 w-4" />
                              <span className="font-medium">Cost Variance Alert</span>
                            </div>
                            <p className="text-red-700 mt-1">
                              Manual cost ({formatCurrency(item.listed_cost)}) differs from calculated cost 
                              ({formatCurrency(item.calculated_cost)}) by {formatCurrency(item.cost_variance)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900">
                        {formatCurrency(item.profit_amount)}
                      </div>
                      <div className="text-sm text-gray-600">profit</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profit Margin Distribution */}
      {filteredData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              Profit Margin Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(
                filteredData.reduce((acc, item) => {
                  const status = item.status;
                  if (!acc[status]) acc[status] = 0;
                  acc[status]++;
                  return acc;
                }, {})
              ).map(([status, count]) => {
                const statusInfo = getStatusInfo(status);
                const StatusIcon = statusInfo.icon;
                const percentage = (count / filteredData.length) * 100;
                
                return (
                  <div key={status} className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <StatusIcon className="h-4 w-4" />
                      <span className="text-sm font-medium">{statusInfo.label}</span>
                    </div>
                    <div className="text-2xl font-bold mb-1">{count}</div>
                    <Progress value={percentage} className="h-2 mb-1" />
                    <div className="text-xs text-gray-600">{formatPercentage(percentage)}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CostAnalysis; 