import React from 'react';
import { Gift } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { LookupCard } from './components/lookup-card';
import { IssueForm } from './components/issue-form';

/**
 * Gift Cards admin page — mounted at /gift-cards.
 *
 * Add to src/routes.jsx:
 *   { path: '/gift-cards', element: <GiftCardsPage /> }
 */
export default function GiftCardsPage() {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        icon={Gift}
        title="Gift Cards"
        description="Look up, reload, refund, or issue gift cards."
      />

      <Tabs defaultValue="lookup">
        <TabsList>
          <TabsTrigger value="lookup">Lookup</TabsTrigger>
          <TabsTrigger value="issue">Issue</TabsTrigger>
        </TabsList>

        <TabsContent value="lookup" className="mt-4">
          <LookupCard />
        </TabsContent>

        <TabsContent value="issue" className="mt-4">
          <IssueForm />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
