import React from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const StatusFilters = ({ statusFilter, onFilterChange, statusCounts }) => {
  const statusOptions = [
    { key: 'current', label: 'Current', count: statusCounts.current, color: 'bg-orange-100 text-orange-800' },
    { key: 'all', label: 'All', count: statusCounts.all, color: 'bg-gray-100 text-gray-800' },
    { key: 'pending', label: 'Pending', count: statusCounts.pending, color: 'bg-yellow-100 text-yellow-800' },
    { key: 'preparing', label: 'Preparing', count: statusCounts.preparing, color: 'bg-blue-100 text-blue-800' },
    { key: 'ready', label: 'Ready', count: statusCounts.ready, color: 'bg-green-100 text-green-800' },
    { key: 'completed', label: 'Completed', count: statusCounts.completed, color: 'bg-gray-100 text-gray-800' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {statusOptions.map((status) => (
        <Button
          key={status.key}
          variant={statusFilter === status.key ? "default" : "outline"}
          size="sm"
          onClick={() => onFilterChange(status.key)}
          className={`whitespace-nowrap h-10 px-4 ${
            statusFilter === status.key 
              ? 'beepbite-gradient text-white' 
              : 'hover:bg-gray-50'
          }`}
        >
          <span className="font-medium">{status.label}</span>
          <Badge variant="secondary" className="ml-2 text-xs">
            {status.count}
          </Badge>
        </Button>
      ))}
    </div>
  );
};

export default StatusFilters; 