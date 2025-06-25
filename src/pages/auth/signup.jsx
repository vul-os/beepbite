import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Mail, 
  Lock,
  AlertCircle,
  Utensils,
  Bell
} from 'lucide-react';
import Logo from '@/components/ui/logo';

const SignUpPage = () => {
  const navigate = useNavigate();
  const { signUp, signInWithGoogle } = useAuth();
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    agreeToTerms: false
  });

  const validateForm = () => {
    const newErrors = {};
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters with 1 number and 1 uppercase letter';
    }
    
    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = 'You must accept the terms and conditions';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: undefined
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validateForm()) {
      setIsLoading(true);
      try {
        await signUp(formData.email, formData.password);
        // Store email in localStorage for verify-email page
        localStorage.setItem('pendingVerificationEmail', formData.email);
        navigate('/verify-email');
      } catch (error) {
        setErrors(prev => ({
          ...prev,
          submit: error.message
        }));
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleGoogleSignUp = async () => {
    try {
      setIsLoading(true);
      await signInWithGoogle();
      // The redirect will be handled by the OAuth provider
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        submit: error.message
      }));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-8 relative overflow-hidden">
      {/* Background decorations - more subtle */}
      <div className="absolute inset-0 bg-grid-pattern opacity-3"></div>
      <div className="absolute top-10 right-10 w-20 h-20 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute bottom-10 left-10 w-16 h-16 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute top-1/4 right-20 w-12 h-12 bg-primary/10 rounded-full opacity-30"></div>
      
      <div className="w-full max-w-lg space-y-6 relative z-10">
        {/* Logo/Brand */}
        <div className="flex justify-center mb-4">
          <Logo />
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-2 pb-6 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight text-gray-900">
              Create Your Account
            </CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Join thousands of restaurants using BeepBite for WhatsApp notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {errors.submit && (
              <Alert variant="destructive" className="mb-4 border-l-4 border-red-500 bg-red-50/80">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <Button 
                variant="outline" 
                className="w-full flex items-center justify-center gap-3 h-11 border-gray-300 bg-white hover:bg-gray-50 transition-all duration-200 shadow-sm"
                onClick={handleGoogleSignUp}
                disabled={isLoading}
              >
                <div className="w-5 h-5 bg-white rounded flex items-center justify-center">
                  <img 
                    src="/google.png" 
                    alt="Google" 
                    className="w-4 h-4"
                  />
                </div>
                <span className="text-sm font-medium">Continue with Google</span>
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-white text-gray-500 font-medium">OR</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      className={`pl-10 h-10 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 ${errors.email ? "border-red-400" : ""}`}
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      disabled={isLoading}
                      placeholder="your.email@restaurant.com"
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-500">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-medium text-gray-700">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      className={`pl-10 h-10 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 ${errors.password ? "border-red-400" : ""}`}
                      value={formData.password}
                      onChange={handleInputChange}
                      required
                      disabled={isLoading}
                      placeholder="Create a secure password"
                    />
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500">{errors.password}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    8+ characters, 1 number, 1 uppercase letter
                  </p>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="agreeToTerms"
                    checked={formData.agreeToTerms}
                    onCheckedChange={(checked) => {
                      setFormData(prev => ({ ...prev, agreeToTerms: checked }));
                      if (errors.agreeToTerms) {
                        setErrors(prev => ({ ...prev, agreeToTerms: undefined }));
                      }
                    }}
                    className={`mt-0.5 ${errors.agreeToTerms ? "border-red-400" : ""}`}
                    disabled={isLoading}
                  />
                  <div className="space-y-1">
                    <label
                      htmlFor="agreeToTerms"
                      className="text-sm text-gray-700 leading-relaxed cursor-pointer"
                    >
                      I agree to the{' '}
                      <a href="/docs/terms" className="text-primary hover:text-primary/80 font-medium underline">
                        Terms of Service
                      </a>{' '}
                      and{' '}
                      <a href="/docs/privacy" className="text-primary hover:text-primary/80 font-medium underline">
                        Privacy Policy
                      </a>
                    </label>
                    {errors.agreeToTerms && (
                      <p className="text-xs text-red-500">{errors.agreeToTerms}</p>
                    )}
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Creating account...</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Utensils className="w-4 h-4" />
                      <span>Create Account</span>
                    </div>
                  )}
                </Button>
              </form>

              <div className="text-center pt-2">
                <span className="text-sm text-gray-600">Already have an account?{' '}</span>
                <Button
                  variant="link"
                  className="text-primary hover:text-primary/80 p-0 h-auto font-medium text-sm underline"
                  onClick={() => navigate('/signin')}
                  disabled={isLoading}
                >
                  Sign in here
                </Button>
              </div>
              
              <div className="text-center">
                <Button
                  variant="link"
                  className="text-gray-500 hover:text-gray-700 p-0 h-auto text-xs"
                  onClick={() => navigate('/forgot-password')}
                  disabled={isLoading}
                >
                  Forgot your password?
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Features preview - more compact */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center space-x-6 text-sm text-gray-600">
            <div className="flex items-center space-x-2">
              <Bell className="w-4 h-4 text-primary" />
              <span>WhatsApp Alerts</span>
            </div>
            <div className="flex items-center space-x-2">
              <Utensils className="w-4 h-4 text-primary" />
              <span>Order Tracking</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} BeepBite. Streamlining restaurant operations worldwide.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignUpPage;