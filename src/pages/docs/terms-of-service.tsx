import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import DocsLayout from '@/components/layout/docs-layout';

const DocsTermsOfService = () => {
  const lastUpdated = "July 2026";

  return (
    <DocsLayout title="Terms of Service" description="Template terms for self-hosted BeepBite deployments">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">

            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Terms of Service
              </h1>
              <p className="text-lg text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            </div>

            <Separator className="bg-orange-100" />

            {/* About this document */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">1. About this document</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong>BeepBite is open-source, self-hosted point-of-sale software</strong> — MIT
                licensed, part of the VulOS project (<a href="https://github.com/vul-os/beepbite" className="text-orange-600 underline">github.com/vul-os/beepbite</a>).
                It is not a hosted service and there is no "BeepBite" company operating it: whoever
                installs and runs the software (the "operator") runs it on their own hardware, under
                their own control.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Because of that, this page is a <strong>template</strong>. If you operate a BeepBite
                deployment, adapt it for your own business and legal jurisdiction before presenting it
                to your customers. It is not legal advice, and neither VulOS nor the software's
                authors are a party to any agreement between you and the people you serve.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* The software and its licence */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">2. The software and its licence</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                The software is provided under the <a href="https://github.com/vul-os/beepbite/blob/main/LICENSE" className="text-orange-600 underline">MIT License</a>.
                You are free to run, copy, modify and distribute it, subject to that licence. In
                particular, the MIT License provides the software <strong>"as is", without warranty
                of any kind</strong>, and limits the authors' liability — those terms govern the
                software itself and are repeated in plain terms in sections 5 and 6 below.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                "BeepBite" and the associated marks belong to the VulOS project. The MIT licence
                covers the code; it does not grant rights to the name or branding beyond describing
                the software accurately.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* What the software does */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">3. What the software does</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite is a restaurant point-of-sale system. It handles front-of-house ordering,
                the kitchen display, floor plans, inventory, delivery and reporting, and it can take
                orders through whichever channels the operator configures — a table QR code, the web,
                and messaging channels such as WhatsApp.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                BeepBite <strong>records tenders; it does not process payments.</strong> "Card" means
                the operator's own card machine was used — the software never touches card data, holds
                no payment credentials, and carries no PCI scope.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Operator responsibilities */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">4. Operator responsibilities</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                If you run a BeepBite deployment, you are responsible for it. That includes:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>the hardware, database and network the software runs on, and their security and backups;</li>
                <li>your relationship with your own customers and staff, and any terms you offer them;</li>
                <li>legal and tax compliance in your jurisdiction, including data-protection obligations as the data controller (see the <a href="/docs/privacy" className="text-orange-600 underline">Privacy Policy</a>);</li>
                <li>any third-party services you choose to connect (for example WhatsApp/Meta or a maps provider), which you configure with <strong>your own</strong> credentials and use subject to <strong>their</strong> terms.</li>
              </ul>
            </section>

            <Separator className="bg-orange-100" />

            {/* No warranty */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">5. No warranty</h2>
              <p className="text-muted-foreground leading-relaxed">
                THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
                INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
                PARTICULAR PURPOSE AND NON-INFRINGEMENT. The authors and the VulOS project do not
                guarantee that the software is error-free or that any deployment will be available or
                uninterrupted.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Limitation of liability */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">6. Limitation of liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
                OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
                OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. Any
                agreement about running a specific deployment is between the operator and their own
                customers, not with the software's authors or the VulOS project.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Governing law */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">7. Governing law</h2>
              <p className="text-muted-foreground leading-relaxed">
                The MIT License imposes no jurisdiction. Any terms an operator offers to their own
                customers are governed by the law the operator chooses and states here. This template
                deliberately names no jurisdiction — set your own.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Source and contact */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">8. Source, issues and contact</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite is developed in the open. Source code, issues and security reports:
              </p>
              <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                <p><strong>Project:</strong> <a href="https://github.com/vul-os/beepbite" className="text-orange-600 underline">github.com/vul-os/beepbite</a> — part of <a href="https://github.com/vul-os" className="text-orange-600 underline">VulOS</a></p>
                <p><strong>Licence:</strong> MIT</p>
                <p><strong>Operator contact:</strong> for a running deployment, the operator of that deployment is your point of contact — not the VulOS project.</p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsTermsOfService;
