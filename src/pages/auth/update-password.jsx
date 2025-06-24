import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, AlertCircle, Eye, EyeOff, Utensils } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Logo from '@/components/ui/logo';

const UpdatePasswordPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdated, setIsUpdated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const validateForm = () => {
    const newErrors = {};
    
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters with 1 number and 1 uppercase letter';
    }
    
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
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

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      // Here you would typically make an API call to update the password
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      console.log('Password updated successfully');
      setIsUpdated(true);
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        submit: 'Failed to update password. Please try again.'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-8 relative overflow-hidden">
      {/* Background decorations - more subtle */}
      <div className="absolute inset-0 bg-grid-pattern opacity-3"></div>
      <div className="absolute top-10 right-10 w-20 h-20 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute bottom-10 left-10 w-16 h-16 bg-primary/5 rounded-full opacity-50"></div>
      <div className="absolute top-1/3 left-20 w-12 h-12 bg-primary/10 rounded-full opacity-30"></div>
      
      <div className="w-full max-w-lg space-y-6 relative z-10">
        {/* Logo/Brand */}
        <div className="flex justify-center mb-4">
          <Logo />
        </div>

        <Card className="border border-gray-200 shadow-xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-2 pb-6 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight text-gray-900">
              Update Your Password
            </CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Choose a strong new password for your restaurant account
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {!isUpdated ? (
              <div className="space-y-5">
                {errors.submit && (
                  <Alert variant="destructive" className="border-l-4 border-red-500 bg-red-50/80">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{errors.submit}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        name="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter new password"
                        className={`pl-10 pr-10 h-10 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 ${errors.password ? "border-red-400" : ""}`}
                        value={formData.password}
                        onChange={handleInputChange}
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-xs text-red-500">{errors.password}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        name="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirm new password"
                        className={`pl-10 pr-10 h-10 bg-white border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200 ${errors.confirmPassword ? "border-red-400" : ""}`}
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <p className="text-xs text-red-500">{errors.confirmPassword}</p>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 space-y-1 py-2">
                    <p className="font-medium">Password requirements:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>At least 8 characters</li>
                      <li>At least 1 uppercase letter</li>
                      <li>At least 1 number</li>
                    </ul>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Updating password...</span>
                      </div>
                    ) : (
                      'Update Password'
                    )}
                  </Button>
                </form>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-lg bg-green-50/80 p-4 border border-green-200/60">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-900">Password updated</h3>
                      <div className="mt-2 text-sm text-green-800">
                        <p>
                          Your password has been successfully updated. You can now sign in with your new password.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <Button
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
                  onClick={() => navigate('/signin')}
                >
                  <div className="flex items-center space-x-2">
                    <Utensils className="w-4 h-4" />
                    <span>Sign In to Dashboard</span>
                  </div>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features preview - more compact */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center space-x-6 text-sm text-gray-600">
            <div className="flex items-center space-x-2">
              <Utensils className="w-4 h-4 text-primary" />
              <span>Secure Restaurant Management</span>
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

export default UpdatePasswordPage;