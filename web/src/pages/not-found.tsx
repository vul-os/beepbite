import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Logo from '@/components/ui/logo';
import { Home, ArrowLeft, Search } from 'lucide-react';

const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card className="border-border shadow-xl">
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
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Search className="w-8 h-8 text-primary" />
            </div>

            {/* Main Message */}
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Page Not Found
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
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
                className="w-full"
                size="lg"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go Back
              </Button>
            </div>

            {/* Additional Help */}
            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Need help? Contact our support team or visit our{' '}
                <button
                  onClick={() => navigate('/docs')}
                  className="text-primary hover:text-primary/80 font-medium underline"
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