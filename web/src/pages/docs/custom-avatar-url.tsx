import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import DocsLayout from '@/components/layout/docs-layout';
import { Image, ExternalLink, AlertCircle, CheckCircle, User, Globe } from 'lucide-react';

const CustomAvatarUrlDocs = () => {
  return (
    <DocsLayout title="Custom Avatar URLs" description="Set up a custom avatar for your BeepBite profile">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">
            
            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Custom Avatar URLs
              </h1>
              <p className="text-lg text-muted-foreground">
                Learn how to set up a custom avatar for your BeepBite profile using direct image URLs
              </p>
            </div>

            <Separator className="bg-orange-100" />

            {/* Quick Requirements */}
            <section>
              <div className="flex items-start gap-4 p-6 bg-orange-50 rounded-lg border border-orange-200">
                <div className="w-12 h-12 rounded-lg beepbite-gradient flex items-center justify-center flex-shrink-0">
                  <Image className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-2">Quick Requirements</h2>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      Direct image URL (may or may not have file extension)
                    </li>
                    <li className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      Square aspect ratio (1:1) recommended
                    </li>
                    <li className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      Minimum 100x100 pixels, 400x400 pixels recommended
                    </li>
                    <li className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      Any hosting service that provides direct image links
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* What is a Direct Image URL */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800 flex items-center gap-2">
                <Globe className="w-6 h-6" />
                What is a Direct Image URL?
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                A direct image URL is a web address that points directly to an image file. When you visit the URL in your browser, 
                you should see only the image, not a webpage containing the image. While many URLs end with image file extensions 
                like .jpg, .png, .gif, or .webp, some services (like Google Drive) provide direct image links without visible extensions.
              </p>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Badge className="bg-green-100 text-green-800 border-green-300">
                    ✅ Good Examples
                  </Badge>
                  <div className="bg-green-50 rounded-lg p-4 space-y-2 border border-green-200">
                    <p className="text-sm font-mono text-green-800 break-all">
                      https://example.com/avatar.png
                    </p>
                    <p className="text-sm font-mono text-green-800 break-all">
                      https://cdn.example.com/user123.jpg
                    </p>
                    <p className="text-sm font-mono text-green-800 break-all">
                      https://i.imgur.com/abc123.png
                    </p>
                    <p className="text-sm font-mono text-green-800 break-all">
                      https://drive.google.com/uc?id=abc123
                    </p>
                    <p className="text-sm font-mono text-green-800 break-all">
                      https://lh3.googleusercontent.com/abc123
                    </p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <Badge className="bg-red-100 text-red-800 border-red-300">
                    ❌ Bad Examples
                  </Badge>
                  <div className="bg-red-50 rounded-lg p-4 space-y-2 border border-red-200">
                    <p className="text-sm font-mono text-red-800 break-all">
                      https://facebook.com/photo/123456
                    </p>
                    <p className="text-sm font-mono text-red-800 break-all">
                      https://example.com/profile-page
                    </p>
                    <p className="text-sm font-mono text-red-800 break-all">
                      https://drive.google.com/file/d/123/view
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Supported Image Hosting Services */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800 flex items-center gap-2">
                <ExternalLink className="w-6 h-6" />
                Recommended Image Hosting Services
              </h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    name: "Imgur",
                    url: "imgur.com",
                    description: "Free image hosting with direct links",
                    pros: ["Free", "No registration required", "Reliable"],
                    note: "Use 'Get share links' → 'Direct link'"
                  },
                  {
                    name: "Cloudinary",
                    url: "cloudinary.com",
                    description: "Professional image hosting and optimization",
                    pros: ["Fast CDN", "Image optimization", "Free tier"],
                    note: "Copy the direct image URL"
                  },
                  {
                    name: "GitHub",
                    url: "github.com",
                    description: "Upload to a repository and use raw links",
                    pros: ["Free with account", "Version control", "Reliable"],
                    note: "Use 'Raw' button to get direct link"
                  },
                  {
                    name: "Google Drive",
                    url: "drive.google.com",
                    description: "Use proper direct link format",
                    pros: ["Existing Google account", "Easy upload", "Reliable"],
                    note: "Use: drive.google.com/uc?id=FILE_ID"
                  },
                  {
                    name: "Discord CDN",
                    url: "cdn.discordapp.com",
                    description: "Upload to Discord and copy image link",
                    pros: ["Free", "Fast", "Easy to use"],
                    note: "Right-click image → 'Copy Link'"
                  },
                  {
                    name: "Your Website",
                    url: "yoursite.com",
                    description: "Host images on your own website",
                    pros: ["Full control", "No third-party dependency", "Custom domain"],
                    note: "Ensure direct access to image file"
                  }
                ].map((service, index) => (
                  <Card key={index} className="border-border hover:border-orange-200 transition-colors">
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-foreground mb-1">{service.name}</h3>
                      <p className="text-xs text-orange-600 mb-2">{service.url}</p>
                      <p className="text-sm text-muted-foreground mb-3">{service.description}</p>
                      {service.note && (
                        <p className="text-xs text-blue-600 mb-2 italic">{service.note}</p>
                      )}
                      <ul className="space-y-1">
                        {service.pros.map((pro, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-green-600" />
                            {pro}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Step by Step Guide */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800 flex items-center gap-2">
                <User className="w-6 h-6" />
                How to Set Up Your Avatar
              </h2>
              <div className="space-y-4">
                {[
                  {
                    step: 1,
                    title: "Choose Your Image",
                    description: "Select a square image (1:1 aspect ratio) that's at least 100x100 pixels. For best results, use 400x400 pixels or larger. PNG format is recommended for best quality."
                  },
                  {
                    step: 2,
                    title: "Upload to Image Host",
                    description: "Upload your image to one of the recommended services like Imgur, GitHub, Google Drive, or your own website."
                  },
                  {
                    step: 3,
                    title: "Get Direct Link",
                    description: "Copy the direct image URL. When visited, it should show only your image, not a webpage."
                  },
                  {
                    step: 4,
                    title: "Test the Link",
                    description: "Paste the URL in a new browser tab to verify it shows only your image, not a webpage."
                  },
                  {
                    step: 5,
                    title: "Add to BeepBite",
                    description: "Go to Account Settings, paste the URL in the Avatar URL field, and save your changes."
                  }
                ].map((item, index) => (
                  <div key={index} className="flex gap-4 p-4 bg-muted rounded-lg">
                    <div className="w-8 h-8 rounded-full beepbite-gradient flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Google Drive Special Instructions */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">Google Drive Setup</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Google Drive can work for avatars, but you need to use the proper direct link format:
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-blue-800">Step-by-step for Google Drive:</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-blue-700">
                  <li>Upload your image to Google Drive</li>
                  <li>Right-click the image and select "Get link"</li>
                  <li>Change permissions to "Anyone with the link can view"</li>
                  <li>Copy the File ID from the sharing URL</li>
                  <li>Use this format: <code className="bg-blue-100 px-1 rounded">https://drive.google.com/uc?id=YOUR_FILE_ID</code></li>
                </ol>
                <p className="text-xs text-blue-600 mt-2">
                  <strong>Example:</strong> If your share link is <code>https://drive.google.com/file/d/1abc123def456/view</code><br/>
                  Use: <code>https://drive.google.com/uc?id=1abc123def456</code>
                </p>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Common Issues */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800 flex items-center gap-2">
                <AlertCircle className="w-6 h-6" />
                Common Issues & Solutions
              </h2>
              <div className="space-y-4">
                <div className="border-l-4 border-red-500 pl-4 py-2 bg-red-50">
                  <h4 className="font-semibold text-red-800 mb-1">Avatar not showing</h4>
                  <p className="text-sm text-red-700">
                    Check that your URL is a direct image link and accessible from other browsers/devices. Test by opening the URL in a new tab.
                  </p>
                </div>
                
                <div className="border-l-4 border-yellow-500 pl-4 py-2 bg-yellow-50">
                  <h4 className="font-semibold text-yellow-800 mb-1">Image not loading</h4>
                  <p className="text-sm text-yellow-700">
                    Ensure the URL points directly to an image file. Some sharing links show a webpage instead of the raw image.
                  </p>
                </div>
                
                <div className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50">
                  <h4 className="font-semibold text-blue-800 mb-1">Image appears blurry</h4>
                  <p className="text-sm text-blue-700">
                    Use a higher resolution image (400x400 pixels minimum) for crisp display on all devices.
                  </p>
                </div>
                
                <div className="border-l-4 border-green-500 pl-4 py-2 bg-green-50">
                  <h4 className="font-semibold text-green-800 mb-1">How to test if URL works</h4>
                  <p className="text-sm text-green-700">
                    Paste the URL in a new browser tab. You should see only your image, not a webpage with the image on it.
                  </p>
                </div>
              </div>
            </section>

            <Separator className="bg-orange-100" />

            {/* Help */}
            <section>
              <div className="text-center bg-muted rounded-lg p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">Need Help?</h3>
                <p className="text-muted-foreground mb-4">
                  If you're still having trouble setting up your custom avatar, our support team is here to help.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <a
                    href="/account"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Go to Account Settings
                  </a>
                  <a
                    href="/docs"
                    className="inline-flex items-center gap-2 px-4 py-2 border border-border text-muted-foreground rounded-lg hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Browse Documentation
                  </a>
                </div>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default CustomAvatarUrlDocs; 