import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const TermsOfService = () => {
  const lastUpdated = "January 15, 2024";

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
            <p className="text-lg text-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          </div>

          <Card>
            <CardContent className="p-8 space-y-8">
              
              {/* Introduction */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">1. Introduction and Acceptance</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Welcome to BeepBite, a restaurant order management platform provided by BeepBite Inc. ("Company," "we," "our," or "us"). These Terms of Service ("Terms") govern your access to and use of our website, mobile applications, and related services (collectively, the "Service").
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  By accessing or using our Service, you agree to be bound by these Terms and our Privacy Policy. If you do not agree to these Terms, you may not access or use our Service.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  We may modify these Terms at any time. Your continued use of the Service constitutes acceptance of any changes to these Terms.
                </p>
              </section>

              <Separator />

              {/* Definitions */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">2. Definitions</h2>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium">Service:</h4>
                    <p className="text-muted-foreground">The BeepBite platform, including all software, applications, tools, and features provided.</p>
                  </div>
                  <div>
                    <h4 className="font-medium">User/You:</h4>
                    <p className="text-muted-foreground">Any individual or entity that accesses or uses the Service.</p>
                  </div>
                  <div>
                    <h4 className="font-medium">Restaurant:</h4>
                    <p className="text-muted-foreground">A food service establishment that uses our Service to manage orders.</p>
                  </div>
                  <div>
                    <h4 className="font-medium">Customer:</h4>
                    <p className="text-muted-foreground">End users who place orders through restaurants using our Service.</p>
                  </div>
                  <div>
                    <h4 className="font-medium">Content:</h4>
                    <p className="text-muted-foreground">All data, information, text, images, and other materials uploaded to or transmitted through the Service.</p>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Eligibility and Account Registration */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">3. Eligibility and Account Registration</h2>
                
                <h3 className="text-xl font-medium mb-3">3.1 Eligibility</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You must be at least 18 years old and have the legal capacity to enter into binding agreements. If you are using the Service on behalf of an organization, you represent that you have the authority to bind that organization to these Terms.
                </p>

                <h3 className="text-xl font-medium mb-3">3.2 Account Registration</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  To use certain features of the Service, you must create an account. You agree to:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Provide accurate, current, and complete information</li>
                  <li>Maintain and update your account information</li>
                  <li>Keep your account credentials secure and confidential</li>
                  <li>Notify us immediately of any unauthorized access</li>
                  <li>Accept responsibility for all activities under your account</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">3.3 Account Suspension</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We reserve the right to suspend or terminate your account if you violate these Terms or engage in activities that harm our Service or other users.
                </p>
              </section>

              <Separator />

              {/* Service Description */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">4. Service Description</h2>
                
                <h3 className="text-xl font-medium mb-3">4.1 Platform Overview</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  BeepBite provides a comprehensive restaurant management platform that includes:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Real-time order management and tracking</li>
                  <li>WhatsApp and multi-channel notifications</li>
                  <li>Analytics and reporting tools</li>
                  <li>Team management and role-based access</li>
                  <li>Customer review management</li>
                  <li>Integration with third-party services</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">4.2 Service Availability</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We strive to maintain high service availability but do not guarantee uninterrupted access. We may experience downtime for maintenance, updates, or unforeseen technical issues. We will provide reasonable notice of planned maintenance.
                </p>

                <h3 className="text-xl font-medium mb-3">4.3 Service Modifications</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable notice. We will not be liable for any modifications or discontinuation of the Service.
                </p>
              </section>

              <Separator />

              {/* User Responsibilities */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">5. User Responsibilities and Prohibited Uses</h2>
                
                <h3 className="text-xl font-medium mb-3">5.1 Acceptable Use</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You agree to use the Service in accordance with all applicable laws and regulations. You are responsible for:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Ensuring all information you provide is accurate and truthful</li>
                  <li>Complying with food safety and business regulations</li>
                  <li>Maintaining appropriate licenses and permits for your restaurant</li>
                  <li>Protecting customer data and privacy</li>
                  <li>Using the Service only for legitimate business purposes</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">5.2 Prohibited Activities</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You agree not to:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Use the Service for any illegal or fraudulent purposes</li>
                  <li>Attempt to gain unauthorized access to our systems</li>
                  <li>Reverse engineer, decompile, or modify our software</li>
                  <li>Distribute malware or engage in harmful activities</li>
                  <li>Violate intellectual property rights</li>
                  <li>Send spam or unsolicited communications</li>
                  <li>Share account credentials with unauthorized parties</li>
                  <li>Use the Service to compete directly with BeepBite</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">5.3 Content Responsibility</h3>
                <p className="text-muted-foreground leading-relaxed">
                  You are solely responsible for all content you upload or transmit through the Service. You warrant that you have all necessary rights to use such content and that it does not violate any third-party rights.
                </p>
              </section>

              <Separator />

              {/* Payment Terms */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">6. Payment Terms and Billing</h2>
                
                <h3 className="text-xl font-medium mb-3">6.1 Subscription Plans</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Our Service is offered through various subscription plans with different features and pricing. Current pricing is available on our website and may be updated from time to time.
                </p>

                <h3 className="text-xl font-medium mb-3">6.2 Payment Processing</h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>All payments are processed through secure third-party payment processors</li>
                  <li>Subscription fees are billed in advance on a recurring basis</li>
                  <li>You authorize us to charge your payment method for applicable fees</li>
                  <li>Failed payments may result in service suspension</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">6.3 Refunds and Cancellations</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You may cancel your subscription at any time through your account settings. Cancellations take effect at the end of the current billing period. We do not provide refunds for partial months or unused services, except as required by law.
                </p>

                <h3 className="text-xl font-medium mb-3">6.4 Price Changes</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We may change our pricing at any time. We will provide at least 30 days' notice of price increases to existing subscribers. Continued use of the Service after a price change constitutes acceptance of the new pricing.
                </p>
              </section>

              <Separator />

              {/* Intellectual Property */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">7. Intellectual Property Rights</h2>
                
                <h3 className="text-xl font-medium mb-3">7.1 Our Intellectual Property</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  The Service, including all software, technology, designs, logos, and trademarks, is owned by BeepBite or our licensors. We grant you a limited, non-exclusive, non-transferable license to use the Service solely for your business purposes.
                </p>

                <h3 className="text-xl font-medium mb-3">7.2 Your Content</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You retain ownership of content you upload to the Service. By uploading content, you grant us a worldwide, royalty-free license to use, store, and process your content solely to provide the Service.
                </p>

                <h3 className="text-xl font-medium mb-3">7.3 Feedback and Suggestions</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Any feedback, suggestions, or ideas you provide about the Service become our property and may be used without compensation or attribution.
                </p>
              </section>

              <Separator />

              {/* Privacy and Data Protection */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">8. Privacy and Data Protection</h2>
                
                <h3 className="text-xl font-medium mb-3">8.1 Privacy Policy</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Our collection and use of personal information is governed by our Privacy Policy, which is incorporated into these Terms by reference.
                </p>

                <h3 className="text-xl font-medium mb-3">8.2 Data Security</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We implement reasonable security measures to protect your data. However, no system is completely secure, and you acknowledge the inherent risks in transmitting data over the internet.
                </p>

                <h3 className="text-xl font-medium mb-3">8.3 Data Processing</h3>
                <p className="text-muted-foreground leading-relaxed">
                  For users in the European Union, we process personal data in accordance with the General Data Protection Regulation (GDPR) and other applicable data protection laws.
                </p>
              </section>

              <Separator />

              {/* Third-Party Services */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">9. Third-Party Services and Integrations</h2>
                
                <h3 className="text-xl font-medium mb-3">9.1 Third-Party Integrations</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Our Service may integrate with third-party services such as:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>WhatsApp Business API</li>
                  <li>Payment processors (Stripe, PayPal)</li>
                  <li>Analytics and monitoring tools</li>
                  <li>Cloud storage providers</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">9.2 Third-Party Terms</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Your use of third-party services is subject to their respective terms and conditions. We are not responsible for the availability, functionality, or policies of third-party services.
                </p>

                <h3 className="text-xl font-medium mb-3">9.3 API Usage</h3>
                <p className="text-muted-foreground leading-relaxed">
                  If you use our API, you agree to comply with our API documentation and usage guidelines. API access may be subject to rate limits and additional terms.
                </p>
              </section>

              <Separator />

              {/* Disclaimers and Limitations */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">10. Disclaimers and Limitations of Liability</h2>
                
                <h3 className="text-xl font-medium mb-3">10.1 Service Disclaimer</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND. WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
                </p>

                <h3 className="text-xl font-medium mb-3">10.2 Limitation of Liability</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, DATA LOSS, OR BUSINESS INTERRUPTION.
                </p>

                <h3 className="text-xl font-medium mb-3">10.3 Maximum Liability</h3>
                <p className="text-muted-foreground leading-relaxed">
                  OUR TOTAL LIABILITY TO YOU FOR ANY CLAIMS ARISING FROM OR RELATED TO THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
                </p>
              </section>

              <Separator />

              {/* Indemnification */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">11. Indemnification</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You agree to indemnify, defend, and hold harmless BeepBite, its officers, directors, employees, and agents from any claims, damages, losses, or expenses arising from:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Your use of the Service</li>
                  <li>Your violation of these Terms</li>
                  <li>Your violation of any third-party rights</li>
                  <li>Your negligent or wrongful conduct</li>
                  <li>Content you upload or transmit through the Service</li>
                </ul>
              </section>

              <Separator />

              {/* Termination */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">12. Termination</h2>
                
                <h3 className="text-xl font-medium mb-3">12.1 Termination by You</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You may terminate your account at any time by canceling your subscription through your account settings or by contacting us.
                </p>

                <h3 className="text-xl font-medium mb-3">12.2 Termination by Us</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may suspend or terminate your account immediately if:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>You violate these Terms</li>
                  <li>You fail to pay applicable fees</li>
                  <li>We reasonably believe your account has been compromised</li>
                  <li>Your use of the Service poses security or legal risks</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">12.3 Effect of Termination</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Upon termination, your access to the Service will cease immediately. We may delete your data in accordance with our data retention policies, but we are not obligated to return or transfer your data.
                </p>
              </section>

              <Separator />

              {/* Governing Law */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">13. Governing Law and Dispute Resolution</h2>
                
                <h3 className="text-xl font-medium mb-3">13.1 Governing Law</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  These Terms are governed by the laws of the State of California, United States, without regard to conflict of law principles.
                </p>

                <h3 className="text-xl font-medium mb-3">13.2 Dispute Resolution</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Most disputes can be resolved informally. Please contact us first at legal@beepbite.com to discuss any concerns.
                </p>

                <h3 className="text-xl font-medium mb-3">13.3 Arbitration</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If informal resolution fails, disputes will be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. The arbitration will be conducted in San Francisco, California.
                </p>

                <h3 className="text-xl font-medium mb-3">13.4 Class Action Waiver</h3>
                <p className="text-muted-foreground leading-relaxed">
                  You agree that disputes will be resolved on an individual basis and waive any right to participate in class action lawsuits or representative proceedings.
                </p>
              </section>

              <Separator />

              {/* General Provisions */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">14. General Provisions</h2>
                
                <h3 className="text-xl font-medium mb-3">14.1 Entire Agreement</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  These Terms, together with our Privacy Policy, constitute the entire agreement between you and BeepBite regarding the Service.
                </p>

                <h3 className="text-xl font-medium mb-3">14.2 Severability</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If any provision of these Terms is found to be unenforceable, the remaining provisions will remain in full force and effect.
                </p>

                <h3 className="text-xl font-medium mb-3">14.3 Waiver</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Our failure to enforce any provision of these Terms does not constitute a waiver of our right to enforce such provision in the future.
                </p>

                <h3 className="text-xl font-medium mb-3">14.4 Assignment</h3>
                <p className="text-muted-foreground leading-relaxed">
                  You may not assign these Terms without our written consent. We may assign these Terms without restriction.
                </p>
              </section>

              <Separator />

              {/* Contact Information */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">15. Contact Information</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you have questions about these Terms of Service, please contact us:
                </p>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <p><strong>Email:</strong> legal@beepbite.com</p>
                  <p><strong>Mailing Address:</strong></p>
                  <p>BeepBite Inc.<br />
                     Legal Department<br />
                     123 Tech Street, Suite 100<br />
                     San Francisco, CA 94105<br />
                     United States</p>
                  <p><strong>Phone:</strong> +1 (555) 123-4567</p>
                </div>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  We will respond to legal inquiries within 15 business days.
                </p>
              </section>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService; 