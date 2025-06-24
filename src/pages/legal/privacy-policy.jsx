import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const PrivacyPolicy = () => {
  const lastUpdated = "January 15, 2024";

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
            <p className="text-lg text-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          </div>

          <Card>
            <CardContent className="p-8 space-y-8">
              
              {/* Introduction */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Welcome to BeepBite ("we," "our," or "us"). We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our restaurant order management platform and related services (the "Service").
                </p>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  By using our Service, you agree to the collection and use of information in accordance with this Privacy Policy. If you do not agree with the terms of this Privacy Policy, please do not use our Service.
                </p>
              </section>

              <Separator />

              {/* Information We Collect */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>
                
                <h3 className="text-xl font-medium mb-3">2.1 Personal Information</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may collect personally identifiable information that you provide directly to us, including:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Name and contact information (email address, phone number)</li>
                  <li>Restaurant business information (name, address, operating hours)</li>
                  <li>Payment information (processed securely through third-party payment processors)</li>
                  <li>Account credentials (username, encrypted passwords)</li>
                  <li>Profile information and preferences</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">2.2 Order and Customer Data</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  When you use our Service to manage orders, we collect:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Order details (items, quantities, prices, special instructions)</li>
                  <li>Customer information (names, contact details, delivery addresses)</li>
                  <li>Transaction data and payment status</li>
                  <li>Order history and analytics data</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">2.3 Technical Information</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We automatically collect certain technical information, including:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>IP address and device information</li>
                  <li>Browser type and version</li>
                  <li>Operating system and platform details</li>
                  <li>Usage patterns and feature interactions</li>
                  <li>Log data and error reports</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">2.4 Communication Data</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We collect information related to communications, including:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>WhatsApp messages and notifications</li>
                  <li>Email communications</li>
                  <li>Customer support interactions</li>
                  <li>Review and feedback data</li>
                </ul>
              </section>

              <Separator />

              {/* How We Use Information */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">3. How We Use Your Information</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We use the collected information for the following purposes:
                </p>
                
                <h3 className="text-xl font-medium mb-3">3.1 Service Provision</h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Facilitate order management and processing</li>
                  <li>Send real-time notifications via WhatsApp and other channels</li>
                  <li>Provide analytics and reporting features</li>
                  <li>Manage user accounts and authentication</li>
                  <li>Process payments and billing</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">3.2 Communication</h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Send service updates and important announcements</li>
                  <li>Provide customer support and technical assistance</li>
                  <li>Respond to inquiries and feedback</li>
                  <li>Send marketing communications (with your consent)</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">3.3 Improvement and Development</h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Analyze usage patterns to improve our services</li>
                  <li>Develop new features and functionality</li>
                  <li>Conduct research and analytics</li>
                  <li>Troubleshoot and resolve technical issues</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">3.4 Legal and Security</h3>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Comply with legal obligations and regulations</li>
                  <li>Prevent fraud and ensure security</li>
                  <li>Protect our rights and those of our users</li>
                  <li>Enforce our terms of service</li>
                </ul>
              </section>

              <Separator />

              {/* Information Sharing */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">4. Information Sharing and Disclosure</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We do not sell, trade, or rent your personal information to third parties. We may share your information in the following circumstances:
                </p>

                <h3 className="text-xl font-medium mb-3">4.1 Service Providers</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may share information with trusted third-party service providers who assist us in:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Payment processing (Stripe, PayPal)</li>
                  <li>Cloud hosting and data storage (Supabase, Firebase)</li>
                  <li>Communication services (WhatsApp Business API)</li>
                  <li>Analytics and monitoring tools</li>
                  <li>Customer support platforms</li>
                </ul>

                <h3 className="text-xl font-medium mb-3 mt-6">4.2 Business Transfers</h3>
                <p className="text-muted-foreground leading-relaxed">
                  In the event of a merger, acquisition, or sale of all or a portion of our assets, your information may be transferred as part of the transaction.
                </p>

                <h3 className="text-xl font-medium mb-3 mt-6">4.3 Legal Requirements</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We may disclose your information if required by law, legal process, or to protect the rights, property, or safety of BeepBite, our users, or others.
                </p>

                <h3 className="text-xl font-medium mb-3 mt-6">4.4 Consent</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We may share your information with your explicit consent for specific purposes not covered in this policy.
                </p>
              </section>

              <Separator />

              {/* Data Security */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">5. Data Security</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>End-to-end encryption for sensitive data transmission</li>
                  <li>Secure socket layer (SSL) encryption for web communications</li>
                  <li>Regular security audits and vulnerability assessments</li>
                  <li>Access controls and authentication measures</li>
                  <li>Data backup and recovery procedures</li>
                  <li>Staff training on data protection practices</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your information, we cannot guarantee absolute security.
                </p>
              </section>

              <Separator />

              {/* Data Retention */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">6. Data Retention</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We retain your personal information for as long as necessary to fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required or permitted by law. Specific retention periods include:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li><strong>Account Information:</strong> Retained while your account is active and for 3 years after deactivation</li>
                  <li><strong>Order Data:</strong> Retained for 7 years for tax and legal compliance</li>
                  <li><strong>Communication Records:</strong> Retained for 2 years for customer service purposes</li>
                  <li><strong>Technical Logs:</strong> Retained for 12 months for security and troubleshooting</li>
                </ul>
              </section>

              <Separator />

              {/* Your Rights */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">7. Your Rights and Choices</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Depending on your location, you may have the following rights regarding your personal information:
                </p>

                <h3 className="text-xl font-medium mb-3">7.1 Access and Portability</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You have the right to request access to your personal information and receive a copy in a portable format.
                </p>

                <h3 className="text-xl font-medium mb-3">7.2 Correction and Updates</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can update your account information through your dashboard or by contacting us to correct inaccurate data.
                </p>

                <h3 className="text-xl font-medium mb-3">7.3 Deletion</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You may request deletion of your personal information, subject to legal and contractual obligations.
                </p>

                <h3 className="text-xl font-medium mb-3">7.4 Marketing Communications</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can opt out of marketing communications at any time by using the unsubscribe link in emails or contacting us directly.
                </p>

                <h3 className="text-xl font-medium mb-3">7.5 Complaint Rights</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You have the right to lodge a complaint with a supervisory authority if you believe we have violated your privacy rights.
                </p>
              </section>

              <Separator />

              {/* International Transfers */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">8. International Data Transfers</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place, including:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Adequacy decisions by relevant authorities</li>
                  <li>Standard contractual clauses approved by regulatory bodies</li>
                  <li>Binding corporate rules and certification schemes</li>
                  <li>Explicit consent where required</li>
                </ul>
              </section>

              <Separator />

              {/* Third-Party Services */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">9. Third-Party Services</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Our Service may contain links to third-party websites or integrate with third-party services. This Privacy Policy does not apply to these external services. We encourage you to review the privacy policies of any third-party services you access.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Key third-party integrations include WhatsApp Business API, payment processors, and analytics providers. Each has their own privacy practices and data handling procedures.
                </p>
              </section>

              <Separator />

              {/* Children's Privacy */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">10. Children's Privacy</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Our Service is not intended for children under the age of 13 (or the minimum age in your jurisdiction). We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately.
                </p>
              </section>

              <Separator />

              {/* Changes to Policy */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">11. Changes to This Privacy Policy</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may update this Privacy Policy from time to time to reflect changes in our practices or for legal, operational, or regulatory reasons. We will notify you of any material changes by:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Posting the updated policy on our website</li>
                  <li>Sending an email notification to registered users</li>
                  <li>Displaying a prominent notice in our Service</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  The updated policy will be effective upon posting unless otherwise specified. Your continued use of our Service after the effective date constitutes acceptance of the updated Privacy Policy.
                </p>
              </section>

              <Separator />

              {/* Contact Information */}
              <section>
                <h2 className="text-2xl font-semibold mb-4">12. Contact Us</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
                </p>
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <p><strong>Email:</strong> privacy@beepbite.com</p>
                  <p><strong>Mailing Address:</strong></p>
                  <p>BeepBite Privacy Team<br />
                     123 Tech Street<br />
                     Suite 100<br />
                     San Francisco, CA 94105<br />
                     United States</p>
                  <p><strong>Phone:</strong> +1 (555) 123-4567</p>
                </div>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  We will respond to your inquiries within 30 days or as required by applicable law.
                </p>
              </section>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy; 