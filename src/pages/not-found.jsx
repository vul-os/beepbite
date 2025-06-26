import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Logo from '@/components/ui/logo';
import { Home, ArrowLeft, Search } from 'lucide-react';

const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card className="border-gray-200 shadow-xl">
          <CardContent className="p-8 text-center">
            {/* Logo */}
            <div className="mb-8">
              <Logo variant="minimal" className="justify-center" />
            </div>

            {/* 404 Number */}
            <div className="mb-6">
              <h1 className="text-8xl font-bold beepbite-gradient bg-clip-text text-transparent">
                404
              </h1>
            </div>

            {/* Icon */}
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-6">
              <Search className="w-8 h-8 text-orange-600" />
            </div>

            {/* Main Message */}
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Page Not Found
            </h2>
            <p className="text-gray-600 mb-8 leading-relaxed">
              Sorry, we couldn't find the page you're looking for. The page might have been moved, deleted, or the URL might be incorrect.
            </p>

            {/* Action Buttons */}
            <div className="space-y-3">
              <Button
                onClick={() => navigate('/')}
                className="w-full beepbite-gradient text-white shadow-lg hover:shadow-xl transition-all duration-200"
                size="lg"
              >
                <Home className="w-4 h-4 mr-2" />
                Go to Homepage
              </Button>
              
              <Button
                onClick={() => navigate(-1)}
                variant="outline"
                className="w-full border-gray-300 text-gray-700 hover:bg-gray-50"
                size="lg"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go Back
              </Button>
            </div>

            {/* Additional Help */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Need help? Contact our support team or visit our{' '}
                <button
                  onClick={() => navigate('/docs')}
                  className="text-orange-600 hover:text-orange-700 font-medium underline"
                >
                  documentation
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default NotFoundPage;