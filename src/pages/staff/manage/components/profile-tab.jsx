import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  User,
  Mail,
  Phone,
  Calendar,
  Shield,
  CheckCircle,
  XCircle,
  AtSign,
} from 'lucide-react';

function getInitials(first, last) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

const ROLE_COLORS = {
  owner:   'bg-orange-100 text-orange-800 border-orange-200',
  admin:   'bg-purple-100 text-purple-800 border-purple-200',
  manager: 'bg-blue-100 text-blue-800 border-blue-200',
  cashier: 'bg-green-100 text-green-800 border-green-200',
  kitchen: 'bg-gray-100 text-gray-700 border-gray-200',
};

function Field({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 w-8 h-8 rounded-md bg-orange-50 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-orange-500" />
      </div>
      <div>
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-sm text-gray-800">{value}</p>
      </div>
    </div>
  );
}

export function ProfileTab({ staff }) {
  const hireDate = staff.hire_date
    ? new Date(staff.hire_date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const createdDate = staff.created_at
    ? new Date(staff.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="space-y-6">
      {/* avatar + name hero */}
      <Card className="border-orange-100 bg-gradient-to-br from-orange-50/40 to-white">
        <CardContent className="p-6 flex items-center gap-5">
          <Avatar className="h-16 w-16 border-2 border-orange-100">
            <AvatarFallback className="bg-orange-100 text-orange-700 text-xl font-bold">
              {getInitials(staff.first_name, staff.last_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-gray-900">
              {staff.first_name} {staff.last_name}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <Badge
                variant="outline"
                className={cn(
                  'capitalize text-xs',
                  ROLE_COLORS[staff.role] ?? 'bg-gray-50 text-gray-600 border-gray-200',
                )}
              >
                <Shield className="w-3 h-3 mr-1" />
                {staff.role}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  staff.is_active
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-red-50 text-red-600 border-red-200',
                )}
              >
                {staff.is_active ? (
                  <CheckCircle className="w-3 h-3 mr-1" />
                ) : (
                  <XCircle className="w-3 h-3 mr-1" />
                )}
                {staff.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* details grid */}
      <Card className="border-orange-100">
        <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field icon={AtSign}    label="Username"    value={staff.username ?? '—'} />
          <Field icon={Mail}      label="Email"       value={staff.email} />
          <Field icon={Phone}     label="Phone"       value={staff.phone} />
          <Field icon={User}      label="Employee ID" value={staff.employee_id} />
          <Field icon={Calendar}  label="Hire date"   value={hireDate} />
          <Field icon={Calendar}  label="Record created" value={createdDate} />
        </CardContent>
      </Card>

      {staff.notes && (
        <Card className="border-orange-100">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-gray-500 mb-1.5">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{staff.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
